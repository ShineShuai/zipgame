// POST /gotd  { d: YYYYMMDD, t: ms, b: bin }  ->  { n, sum, below, cnt, best }   (d: today, +1, or up to REPLAY_DAYS + 1 days back: live play and replays)
// GET  /stats?from=YYYYMMDD&to=YYYYMMDD  ->  { days: [{ d, n, sum, bins: [[bin, n]], best: [ms], seeds: [ms] }] }  (read-only aggregates, <= 90 days)
// POST /seed  Authorization: Bearer <SEED_PLAYERS_SECRET>  { d, ms: [ms], bins: [bin] }  ->  { status: 'ok', n, sum } | 409 { status: 'exists' }
//   adds 1..SEED_MAX synthetic players to a day, once per day (tools/gotd-seed.mjs); a repeat changes nothing
// POST /play  { day, ms, u, deep, s, pz, ev, v }  (pz / ev: base64url or null)  ->  200 { status: 'ok' } | 503 { status: 'closed' } | 400 { error: 'invalid' }
//   one anonymous behaviour row (src/core/behaviour.js). 'closed' = the ceiling in play_cfg is reached or set to 0 (the off switch).
// GET  /play-export?after=ID&limit=N  Authorization: Bearer <PLAY_ADMIN_SECRET>  ->  { rows: [{ id, ...columns }], next: ID | null, columns? }  (tools/behaviour.mjs)
// POST /play-delete   Authorization: Bearer <PLAY_ADMIN_SECRET>  { ids: [row id] }  ->  { deleted: n }   (1..500 ids; the only way a row goes)
// One D1 batch (= one transaction): 2 upserts + best-10 maintenance + reads. Constants mirror src/core/hist.js.
import { NB, TOP_K, MIN_MS, MAX_MS, SEED_MAX, REPLAY_DAYS } from '../../src/core/hist.js';
import { COLUMN_NAMES, INSERT_SQL, rowArgs, validateRow, fromWire, toB64u } from '../../src/core/behaviour.js';

const DAY_MS = 86400000, isInt = Number.isInteger;
const dayNumber = ymd => { // YYYYMMDD -> days since epoch, or null if not a real date
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100, ms = Date.UTC(y, m - 1, d);
  const c = new Date(ms);
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? ms / DAY_MS : null;
};

// Returns { d, t, b } or null. The day must be at most `back` UTC days before `now` and at most 1 after it (clock skew, late submissions).
// back = 1 (default): the live Game of Day, and seeding. POST /gotd passes REPLAY_DAYS + 1: the replay of a missed day (the app offers the last
// REPLAY_DAYS days; +1 because a replay started before UTC midnight is finished after it). Temporary: set it back to 1 to stop accepting replays.
export function validate(body, now = Date.now(), back = 1) {
  if (!body || typeof body !== 'object') return null;
  const { d, t, b } = body;
  if (![d, t, b].every(Number.isInteger) || t < MIN_MS || t > MAX_MS || b < 0 || b >= NB) return null;
  const dn = dayNumber(d);
  const today = Math.floor(now / DAY_MS);
  return dn !== null && dn >= today - back && dn <= today + 1 ? { d, t, b } : null;
}

// [statement, bound values]; ?1 = day, ?2 = t (ms) or bin
const STATEMENTS = ({ d, t, b }) => [
  ['INSERT INTO day (day, n, sum_ms) VALUES (?1, 1, ?2) ON CONFLICT (day) DO UPDATE SET n = n + 1, sum_ms = sum_ms + ?2 RETURNING n, sum_ms', [d, t]],
  ['INSERT INTO bin (day, bin, n) VALUES (?1, ?2, 1) ON CONFLICT (day, bin) DO UPDATE SET n = n + 1 RETURNING n', [d, b]],
  [`INSERT INTO best (day, ms) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM best WHERE day = ?1) < ${TOP_K} OR ?2 < (SELECT MAX(ms) FROM best WHERE day = ?1)`, [d, t]],
  [`DELETE FROM best WHERE day = ?1 AND rowid NOT IN (SELECT rowid FROM best WHERE day = ?1 ORDER BY ms LIMIT ${TOP_K})`, [d]],
  [`SELECT ms FROM best WHERE day = ?1 ORDER BY ms LIMIT ${TOP_K}`, [d]],
  ['SELECT COALESCE(SUM(n), 0) AS below FROM bin WHERE day = ?1 AND bin < ?2', [d, b]],
];

// Returns { d, ms, bins } or null: 1..SEED_MAX times with one bin each, every (d, t, b) valid like a submit.
export function validateSeed(body, now = Date.now()) {
  if (!body || !Array.isArray(body.ms) || !Array.isArray(body.bins) || body.ms.length < 1 || body.ms.length > SEED_MAX || body.ms.length !== body.bins.length) return null;
  return body.ms.every((t, i) => validate({ d: body.d, t, b: body.bins[i] }, now)) ? { d: body.d, ms: body.ms, bins: body.bins } : null;
}

// The seed row goes in FIRST: a second seeding of the day violates its primary key and rolls the whole batch back.
const seedStatements = ({ d, ms, bins }) => {
  const perBin = new Map(); for (const b of bins) perBin.set(b, (perBin.get(b) || 0) + 1);
  return [
    ['INSERT INTO seed (day, ms) VALUES (?1, ?2)', [d, JSON.stringify(ms)]],
    ['INSERT INTO day (day, n, sum_ms) VALUES (?1, ?2, ?3) ON CONFLICT (day) DO UPDATE SET n = n + ?2, sum_ms = sum_ms + ?3', [d, ms.length, ms.reduce((a, t) => a + t, 0)]],
    ...[...perBin].map(([b, c]) => ['INSERT INTO bin (day, bin, n) VALUES (?1, ?2, ?3) ON CONFLICT (day, bin) DO UPDATE SET n = n + ?3', [d, b, c]]),
    ...ms.map(t => ['INSERT INTO best (day, ms) VALUES (?1, ?2)', [d, t]]),
    [`DELETE FROM best WHERE day = ?1 AND rowid NOT IN (SELECT rowid FROM best WHERE day = ?1 ORDER BY ms LIMIT ${TOP_K})`, [d]],
    ['SELECT n, sum_ms FROM day WHERE day = ?1', [d]],
  ];
};

// Authorization: Bearer <SEED_PLAYERS_SECRET>, compared as SHA-256 digests so the time taken does not reveal how many characters matched.
const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export async function authorized(req, env, name = 'SEED_PLAYERS_SECRET') {
  const secret = String(env[name] || '').trim(); // stored from a file it may end in a newline; the client trims its copy too
  if (!secret) return false;
  const [a, b] = await Promise.all([digest(req.headers.get('authorization') || ''), digest('Bearer ' + secret)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Returns { from, to } or null: two real YYYYMMDD dates, from <= to, at most 90 days inclusive.
export function validateRange(from, to) {
  const a = isInt(from) ? dayNumber(from) : null, b = isInt(to) ? dayNumber(to) : null;
  return a !== null && b !== null && b >= a && b - a <= 89 ? { from, to } : null;
}

export async function read(db, { from, to }) {
  const q = (sql) => db.prepare(sql).bind(from, to);
  const [days, bins, best] = (await db.batch([
    q('SELECT day AS d, n, sum_ms AS sum FROM day WHERE day BETWEEN ?1 AND ?2 ORDER BY day'),
    q('SELECT day, bin, n FROM bin WHERE day BETWEEN ?1 AND ?2 ORDER BY day, bin'),
    q('SELECT day, ms FROM best WHERE day BETWEEN ?1 AND ?2 ORDER BY day, ms'),
  ])).map(r => r.results);
  // Its own batch: a database without the seed table yet (schema.sql not re-run) still answers, just without seeds.
  const seeds = await db.batch([q('SELECT day, ms FROM seed WHERE day BETWEEN ?1 AND ?2')]).then(r => r[0].results, () => []);
  const byDay = new Map(days.map(x => [x.d, { ...x, bins: [], best: [], seeds: [] }]));
  for (const x of bins) byDay.get(x.day)?.bins.push([x.bin, x.n]);
  for (const x of best) byDay.get(x.day)?.best.push(x.ms);
  for (const x of seeds) if (byDay.has(x.day)) byDay.get(x.day).seeds = JSON.parse(x.ms).sort((a, b) => a - b);
  return { days: [...byDay.values()] };
}

export async function submit(db, req) {
  const r = await db.batch(STATEMENTS(req).map(([sql, args]) => db.prepare(sql).bind(...args)));
  const day = r[0].results[0];
  return { n: day.n, sum: day.sum_ms, below: r[5].results[0].below, cnt: r[1].results[0].n, best: r[4].results.map(x => x.ms) };
}

export async function seed(db, req) { // -> { status: 'ok', n, sum } | { status: 'exists' }
  if ((await db.batch([db.prepare('SELECT 1 AS x FROM seed WHERE day = ?1').bind(req.d)]))[0].results.length) return { status: 'exists' };
  try {
    const r = await db.batch(seedStatements(req).map(([sql, args]) => db.prepare(sql).bind(...args))), day = r.at(-1).results[0];
    return { status: 'ok', n: day.n, sum: day.sum_ms };
  } catch (e) {
    if (/UNIQUE constraint failed: seed\.day/.test(String(e && e.message))) return { status: 'exists' }; // lost a race with a parallel seeding
    throw e;
  }
}

// ---------- behaviour rows ----------
const ROOM_SQL = 'SELECT COALESCE((SELECT cap FROM play_cfg WHERE id = 1), 0) - COALESCE((SELECT max(rowid) FROM play), 0) AS room'; // O(1); <= 0 = closed
const asBuffer = v => (v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v); // D1 binds a BLOB as an ArrayBuffer
// -> 'ok' | 'closed'. The row is already valid (validateRow). The check and the insert are two batches: the ceiling is soft by a row or two.
export async function addPlay(db, row) {
  const room = (await db.batch([db.prepare(ROOM_SQL).bind()]))[0].results[0];
  if (!room || room.room <= 0) return 'closed';
  await db.batch([db.prepare(INSERT_SQL).bind(...rowArgs(row).map(asBuffer))]);
  return 'ok';
}
const blobOut = v => (v == null ? null : toB64u(Array.isArray(v) ? Uint8Array.from(v) : v instanceof ArrayBuffer ? new Uint8Array(v) : v)); // D1 reads a BLOB as an array of bytes
// The rows with id > after, at most `limit`, in id order, and the table's real columns (`columns`, on the first page). A column of
// src/core/behaviour.js that the table does not have yet (ALTER TABLE not run) comes out as null, so that tools/behaviour.mjs migrate can still read.
export async function readPlay(db, { after, limit }) {
  const columns = (await db.batch([db.prepare('PRAGMA table_info(play)').bind()]))[0].results.map(c => c.name), have = COLUMN_NAMES.filter(n => columns.includes(n));
  const rows = (await db.batch([db.prepare(`SELECT rowid AS id, ${have.join(', ')} FROM play WHERE rowid > ?1 ORDER BY rowid LIMIT ?2`).bind(after, limit)]))[0].results
    .map(r => Object.fromEntries([['id', r.id], ...COLUMN_NAMES.map(n => [n, n === 'pz' || n === 'ev' ? blobOut(r[n]) : r[n] === undefined ? null : r[n]])]));
  const out = { rows, next: rows.length === limit ? rows[rows.length - 1].id : null };
  if (after === 0) out.columns = columns;
  return out;
}
const DELETE_CHUNK = 90; // D1 allows 100 bound values per statement
const validIds = ids => Array.isArray(ids) && ids.length >= 1 && ids.length <= 500 && ids.every(i => Number.isInteger(i) && i >= 1);
export async function deletePlay(db, ids) { // -> { deleted }: how many of the ids were rows
  const chunks = []; for (let i = 0; i < ids.length; i += DELETE_CHUNK) chunks.push(ids.slice(i, i + DELETE_CHUNK));
  const where = c => `FROM play WHERE rowid IN (${c.map((_, i) => '?' + (i + 1)).join(', ')})`;
  const r = await db.batch([...chunks.map(c => db.prepare(`SELECT COUNT(*) AS c ${where(c)}`).bind(...c)), ...chunks.map(c => db.prepare(`DELETE ${where(c)}`).bind(...c))]);
  return { deleted: r.slice(0, chunks.length).reduce((a, x) => a + Number(x.results[0].c), 0) };
}

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const reply = (status, body, extra = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
    if (req.method === 'OPTIONS') return reply(204);
    const { pathname, searchParams } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/stats') {
      const range = validateRange(...['from', 'to'].map(k => Number(searchParams.get(k) ?? NaN)));
      if (!range) return reply(400, { error: 'invalid' });
      try { return reply(200, await read(env.DB, range), { 'Cache-Control': 'public, max-age=120' }); } catch (e) { return reply(500, { error: 'db' }); }
    }
    if (req.method === 'POST' && pathname === '/seed') {
      if (!(await authorized(req, env))) return reply(401, { error: 'unauthorized' });
      if (Number(req.headers.get('content-length') || 0) > 1024) return reply(400, { error: 'too large' });
      let body; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: 'bad json' }); }
      const v = validateSeed(body);
      if (!v) return reply(400, { error: 'invalid' });
      try { const r = await seed(env.DB, v); return reply(r.status === 'exists' ? 409 : 200, r); } catch (e) { return reply(500, { error: 'db' }); }
    }
    if (req.method === 'POST' && pathname === '/play') {
      if (Number(req.headers.get('content-length') || 0) > 512) return reply(400, { error: 'too large' });
      let text = await req.text(), body; if (text.length > 512) return reply(400, { error: 'too large' });
      try { body = JSON.parse(text); } catch { return reply(400, { error: 'bad json' }); }
      const row = validateRow(fromWire(body));
      if (!row) return reply(400, { error: 'invalid' });
      try { const status = await addPlay(env.DB, row); return reply(status === 'ok' ? 200 : 503, { status }); } catch (e) { return reply(500, { error: 'db' }); }
    }
    if (pathname === '/play-export' || pathname === '/play-delete') {
      if (req.method !== (pathname === '/play-export' ? 'GET' : 'POST')) return reply(404, { error: 'not found' });
      if (!(await authorized(req, env, 'PLAY_ADMIN_SECRET'))) return reply(401, { error: 'unauthorized' });
      if (pathname === '/play-export') {
        const after = Number(searchParams.get('after') ?? 0), limit = Number(searchParams.get('limit') ?? 1000);
        if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) return reply(400, { error: 'invalid' });
        try { return reply(200, await readPlay(env.DB, { after, limit })); } catch (e) { return reply(500, { error: 'db' }); }
      }
      let body; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: 'bad json' }); }
      if (!body || !validIds(body.ids)) return reply(400, { error: 'invalid' });
      try { return reply(200, await deletePlay(env.DB, body.ids)); } catch (e) { return reply(500, { error: 'db' }); }
    }
    if (req.method !== 'POST' || pathname !== '/gotd') return reply(404, { error: 'not found' });
    if (Number(req.headers.get('content-length') || 0) > 256) return reply(400, { error: 'too large' });
    let body; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: 'bad json' }); }
    const v = validate(body, Date.now(), REPLAY_DAYS + 1);
    if (!v) return reply(400, { error: 'invalid' });
    try { return reply(200, await submit(env.DB, v)); } catch (e) { return reply(500, { error: 'db' }); }
  },
};
