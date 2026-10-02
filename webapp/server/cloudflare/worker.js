// POST /gotd  { d: YYYYMMDD, t: ms, b: bin }  ->  { n, sum, below, cnt, best }
// GET  /stats?from=YYYYMMDD&to=YYYYMMDD  ->  { days: [{ d, n, sum, bins: [[bin, n]], best: [ms], seeds: [ms] }] }  (read-only aggregates, <= 90 days)
// POST /seed  Authorization: Bearer <SEED_PLAYERS_SECRET>  { d, ms: [ms], bins: [bin] }  ->  { status: 'ok', n, sum } | 409 { status: 'exists' }
//   adds 1..SEED_MAX synthetic players to a day, once per day (tools/gotd-seed.mjs); a repeat changes nothing
// One D1 batch (= one transaction): 2 upserts + best-10 maintenance + reads. Constants mirror src/core/hist.js.
import { NB, TOP_K, MIN_MS, MAX_MS, SEED_MAX } from '../../src/core/hist.js';

const DAY_MS = 86400000, isInt = Number.isInteger;
const dayNumber = ymd => { // YYYYMMDD -> days since epoch, or null if not a real date
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100, ms = Date.UTC(y, m - 1, d);
  const c = new Date(ms);
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? ms / DAY_MS : null;
};

// Returns { d, t, b } or null. The day must be within +-1 UTC day of `now` (clock skew, late submissions).
export function validate(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;
  const { d, t, b } = body;
  if (![d, t, b].every(Number.isInteger) || t < MIN_MS || t > MAX_MS || b < 0 || b >= NB) return null;
  const dn = dayNumber(d);
  return dn !== null && Math.abs(dn - Math.floor(now / DAY_MS)) <= 1 ? { d, t, b } : null;
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
export async function authorized(req, env) {
  const secret = String(env.SEED_PLAYERS_SECRET || '').trim(); // stored from a file it may end in a newline; the client trims its copy too
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
    if (req.method !== 'POST' || pathname !== '/gotd') return reply(404, { error: 'not found' });
    if (Number(req.headers.get('content-length') || 0) > 256) return reply(400, { error: 'too large' });
    let body; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: 'bad json' }); }
    const v = validate(body);
    if (!v) return reply(400, { error: 'invalid' });
    try { return reply(200, await submit(env.DB, v)); } catch (e) { return reply(500, { error: 'db' }); }
  },
};
