// POST /gotd  { d: YYYYMMDD, t: ms, b: bin }  ->  { n, sum, below, cnt, best }
// GET  /stats?from=YYYYMMDD&to=YYYYMMDD  ->  { days: [{ d, n, sum, bins: [[bin, n]], best: [ms] }] }  (read-only aggregates, <= 90 days)
// One D1 batch (= one transaction): 2 upserts + best-10 maintenance + reads. Constants mirror src/core/hist.js.
import { NB, TOP_K, MIN_MS, MAX_MS } from '../../src/core/hist.js';

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
  const byDay = new Map(days.map(x => [x.d, { ...x, bins: [], best: [] }]));
  for (const x of bins) byDay.get(x.day)?.bins.push([x.bin, x.n]);
  for (const x of best) byDay.get(x.day)?.best.push(x.ms);
  return { days: [...byDay.values()] };
}

export async function submit(db, req) {
  const r = await db.batch(STATEMENTS(req).map(([sql, args]) => db.prepare(sql).bind(...args)));
  const day = r[0].results[0];
  return { n: day.n, sum: day.sum_ms, below: r[5].results[0].below, cnt: r[1].results[0].n, best: r[4].results.map(x => x.ms) };
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
    if (req.method !== 'POST' || pathname !== '/gotd') return reply(404, { error: 'not found' });
    if (Number(req.headers.get('content-length') || 0) > 256) return reply(400, { error: 'too large' });
    let body; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: 'bad json' }); }
    const v = validate(body);
    if (!v) return reply(400, { error: 'invalid' });
    try { return reply(200, await submit(env.DB, v)); } catch (e) { return reply(500, { error: 'db' }); }
  },
};
