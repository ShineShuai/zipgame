// Runs the real worker code against SQLite (node:sqlite, Node >= 22.5) standing in for D1. Run: node server/cloudflare/worker.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker, { submit, validate, validateRange, read } from './worker.js';
import { binOf, summarize, TOP_K } from '../../src/core/hist.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const fakeD1 = () => { // prepare().bind() / batch() as a single transaction, like D1
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  return {
    prepare: sql => ({ bind: (...args) => ({ sql, args }) }),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map(s => ({ results: db.prepare(s.sql).all(...s.args) })); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    raw: db,
  };
};

const now = Date.UTC(2026, 8, 29, 12), ymd = 20260929;
let n = 0; const test = async (name, fn) => { await fn(); n++; console.log('ok   ', name); };

await test('validate: accepts today +-1 day, rejects everything else', () => {
  const ok = { d: ymd, t: 42130, b: 37 };
  assert.deepEqual(validate(ok, now), ok);
  assert.ok(validate({ ...ok, d: 20260928 }, now) && validate({ ...ok, d: 20260930 }, now));
  for (const bad of [{ ...ok, d: 20260927 }, { ...ok, d: 20261001 }, { ...ok, d: 20260231 }, { ...ok, d: 20261301 }, { ...ok, t: 499 }, { ...ok, t: 3600001 },
    { ...ok, b: -1 }, { ...ok, b: 80 }, { ...ok, t: 1.5 }, { ...ok, t: '42130' }, { d: ymd }, null, 'x', []]) assert.equal(validate(bad, now), null, JSON.stringify(bad));
  assert.ok(validate({ ...ok, d: 20260101 }, Date.UTC(2025, 11, 31, 23)), 'year boundary +1 day');
});

await test('submit matches a brute-force model over 400 random solves (n, sum, below, cnt, best, summary)', async () => {
  const db = fakeD1(), times = []; let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 400; i++) {
    const t = Math.round(1000 * Math.exp(rnd() * Math.log(2000))), b = binOf(t);
    times.push(t);
    const r = await submit(db, { d: ymd, t, b });
    assert.equal(r.n, times.length); assert.equal(r.sum, times.reduce((a, x) => a + x, 0));
    assert.equal(r.below, times.filter(x => binOf(x) < b).length); assert.equal(r.cnt, times.filter(x => binOf(x) === b).length);
    assert.deepEqual(r.best, [...times].sort((x, y) => x - y).slice(0, TOP_K));
    const s = summarize(r), others = times.length - 1;
    if (others) assert.equal(s.pct, Math.round(100 * (times.filter(x => binOf(x) > b).length + (r.cnt - 1) / 2) / others));
  }
  const rows = t => db.raw.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  assert.equal(rows('day'), 1); assert.equal(rows('best'), TOP_K); assert.ok(rows('bin') <= 80);
});

await test('days are independent', async () => {
  const db = fakeD1();
  await submit(db, { d: 20260928, t: 5000, b: binOf(5000) });
  const r = await submit(db, { d: ymd, t: 9000, b: binOf(9000) });
  assert.deepEqual([r.n, r.sum, r.below, r.cnt, r.best], [1, 9000, 0, 1, [9000]]);
});

await test('failed batch rolls back (no partial counts)', async () => {
  const db = fakeD1(); db.raw.exec('DROP TABLE best');
  await assert.rejects(() => submit(db, { d: ymd, t: 5000, b: 1 }));
  assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM day').get().c, 0);
});

await test('http handler: routing, validation, CORS, size guard, db error', async () => {
  const env = { DB: fakeD1(), ALLOWED_ORIGIN: 'https://u.github.io' };
  const call = (method, path, body, headers = {}) => worker.fetch(new Request('https://w.example' + path, { method, body, headers }), env);
  const today = Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));
  let r = await call('POST', '/gotd', JSON.stringify({ d: today, t: 42130, b: binOf(42130) }), { 'Content-Type': 'text/plain;charset=UTF-8' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://u.github.io');
  assert.deepEqual(await r.json(), { n: 1, sum: 42130, below: 0, cnt: 1, best: [42130] });
  r = await call('OPTIONS', '/gotd'); assert.equal(r.status, 204); assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/);
  assert.equal((await call('GET', '/gotd')).status, 404); assert.equal((await call('POST', '/x', '{}')).status, 404);
  assert.equal((await call('POST', '/gotd', 'nope')).status, 400);
  assert.equal((await call('POST', '/gotd', JSON.stringify({ d: today, t: 10, b: 0 }))).status, 400);
  assert.equal((await call('POST', '/gotd', 'x'.repeat(300), { 'content-length': '300' })).status, 400);
  assert.equal((await worker.fetch(new Request('https://w.example/gotd', { method: 'POST', body: JSON.stringify({ d: today, t: 5000, b: 1 }) }), { DB: { prepare() { throw new Error('x'); } } })).status, 500);
});

await test('validateRange: real dates, ordered, <= 90 days inclusive', () => {
  assert.deepEqual(validateRange(20260702, 20260929), { from: 20260702, to: 20260929 }); // exactly 90 days
  assert.deepEqual(validateRange(20260929, 20260929), { from: 20260929, to: 20260929 });
  for (const [a, b] of [[20260701, 20260929], [20260929, 20260928], [20260231, 20260301], [20261301, 20261302], [0, 20260929], [NaN, 20260929], [20260929, 1.5], [null, null], ['20260929', '20260929']]) assert.equal(validateRange(a, b), null, `${a}..${b}`);
});

await test('GET /stats: days, bins and best equal a brute-force model; empty days omitted; CORS + cache headers', async () => {
  const env = { DB: fakeD1(), ALLOWED_ORIGIN: 'https://u.github.io' }, model = new Map(); let seed = 99;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 150; i++) {
    const d = [20260927, 20260929, 20260930][i % 3], t = Math.round(1000 * Math.exp(rnd() * Math.log(2000)));
    await submit(env.DB, { d, t, b: binOf(t) }); model.set(d, [...(model.get(d) || []), t]);
  }
  const get = q => worker.fetch(new Request('https://w.example/stats?' + q), env);
  let r = await get('from=20260928&to=20260930');
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://u.github.io'); assert.match(r.headers.get('cache-control'), /max-age=120/);
  const { days } = await r.json();
  assert.deepEqual(days.map(x => x.d), [20260929, 20260930]);
  for (const x of days) {
    const ts = model.get(x.d), counts = new Map(); for (const t of ts) counts.set(binOf(t), (counts.get(binOf(t)) || 0) + 1);
    assert.equal(x.n, ts.length); assert.equal(x.sum, ts.reduce((a, t) => a + t, 0));
    assert.deepEqual(x.bins, [...counts].sort((a, b) => a[0] - b[0])); assert.deepEqual(x.best, [...ts].sort((a, b) => a - b).slice(0, TOP_K));
  }
  assert.deepEqual(await (await get('from=20260901&to=20260910')).json(), { days: [] });
  assert.deepEqual(await read(env.DB, { from: 20260927, to: 20260927 }).then(x => x.days.map(d => d.n)), [50]);
  for (const q of ['', 'from=20260929', 'from=20260930&to=20260929', 'from=20260101&to=20260929', 'from=x&to=y', 'from=&to=']) assert.equal((await get(q)).status, 400, q);
  assert.equal((await worker.fetch(new Request('https://w.example/stats?from=20260929&to=20260929'), { DB: { prepare() { throw new Error('x'); } } })).status, 500);
  assert.equal((await worker.fetch(new Request('https://w.example/stats?from=20260929&to=20260929', { method: 'POST', body: '{}' }), env)).status, 404);
});

console.log(`${n} passed`);
