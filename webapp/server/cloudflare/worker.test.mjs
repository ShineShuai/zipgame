// Runs the real worker code against SQLite (node:sqlite, Node >= 22.5) standing in for D1. Run: node server/cloudflare/worker.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker, { submit, validate, validateRange, read, validateSeed, seed } from './worker.js';
import { binOf, summarize, TOP_K, SEED_MAX, REPLAY_DAYS } from '../../src/core/hist.js';

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

await test('validate(back): a replay day is accepted up to back days before now; the future limit stays +1; seeding stays +-1', () => {
  const ok = { d: ymd, t: 42130, b: 37 }, back = REPLAY_DAYS + 1, dayOf = k => Number(new Date(now + k * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
  for (let k = -back; k <= 1; k++) assert.ok(validate({ ...ok, d: dayOf(k) }, now, back), `day ${k}`);
  for (const k of [-back - 1, -30, 2]) assert.equal(validate({ ...ok, d: dayOf(k) }, now, back), null, `day ${k}`);
  assert.equal(validate({ ...ok, d: dayOf(-2) }, now), null, 'default back = 1 is unchanged');
  assert.equal(validateSeed({ d: dayOf(-2), ms: [9000], bins: [binOf(9000)] }, now), null, 'seeding never goes back');
  const jan = Date.UTC(2026, 0, 1, 23), dayFrom = k => Number(new Date(jan + k * 86400000).toISOString().slice(0, 10).replaceAll('-', '')); // the window crosses the year boundary
  assert.ok(validate({ ...ok, d: dayFrom(-back) }, jan, back)); assert.equal(validate({ ...ok, d: dayFrom(-back - 1) }, jan, back), null);
});

await test('schema.sql (Supabase) accepts REPLAY_DAYS + 1 days back for submit_gotd and still +-1 for seed_gotd: change the number there with REPLAY_DAYS', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.deepEqual([...sql.matchAll(/v_today - v_date > (\d+)/g)].map(m => Number(m[1])), [REPLAY_DAYS + 1], 'submit_gotd: days back = REPLAY_DAYS + 1');
  assert.equal(sql.split('abs(v_date - v_today) > 1').length - 1, 1, 'seed_gotd keeps its +-1 day check');
});

await test('POST /gotd accepts a missed day of the replay window and rejects an older one', async () => {
  const db = fakeD1(), day = k => Number(new Date(Date.now() + k * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
  const post = d => worker.fetch(new Request('https://w.example/gotd', { method: 'POST', body: JSON.stringify({ d, t: 42130, b: binOf(42130) }) }), { DB: db });
  for (const k of [-1, -REPLAY_DAYS, -REPLAY_DAYS - 1]) assert.equal((await post(day(k))).status, 200, `day ${k}`);
  for (const k of [-REPLAY_DAYS - 2, 2]) assert.equal((await post(day(k))).status, 400, `day ${k}`);
  assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM day').get().c, 3);
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

// ---- seeds (tools/gotd-seed.mjs) ----
const seedReq = ms => ({ d: ymd, ms, bins: ms.map(binOf) });
const dayOf = async (db, d = ymd) => (await read(db, { from: d, to: d })).days[0];

await test('validateSeed: 1..SEED_MAX valid times with one bin each, day within +-1', () => {
  const ok = seedReq([30000, 45000, 61000]);
  assert.deepEqual(validateSeed(ok, now), ok);
  assert.ok(validateSeed(seedReq(Array(SEED_MAX).fill(9000)), now) && validateSeed(seedReq([9000]), now));
  for (const bad of [seedReq([]), seedReq(Array(SEED_MAX + 1).fill(9000)), { ...ok, bins: [1, 2] }, { ...ok, ms: [30000, 45000, 499] }, { ...ok, ms: [30000, 45000, 3600001] }, { ...ok, ms: [30000, 45000, 1.5] },
    { ...ok, bins: [binOf(30000), binOf(45000), 80] }, { ...ok, d: 20260927 }, { ...ok, d: 20260231 }, { ...ok, ms: 'x' }, { ...ok, bins: null }, { d: ymd }, null, 'x', []]) assert.equal(validateSeed(bad, now), null, JSON.stringify(bad));
});

await test('seed: day, bins, best and seeds equal a brute-force model, with real players before and after', async () => {
  const db = fakeD1(), real = [], seeds = [41000, 9000, 120000, 41000, 66000]; let rs = 5;
  const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 2 ** 32, solve = async () => { const t = Math.round(1000 * Math.exp(rnd() * Math.log(500))); real.push(t); await submit(db, { d: ymd, t, b: binOf(t) }); };
  for (let i = 0; i < 4; i++) await solve();
  assert.deepEqual(await seed(db, seedReq(seeds)), { status: 'ok', n: 9, sum: [...real, ...seeds].reduce((a, x) => a + x, 0) });
  for (let i = 0; i < 20; i++) await solve();
  const all = [...real, ...seeds], day = await dayOf(db), counts = new Map(); for (const t of all) counts.set(binOf(t), (counts.get(binOf(t)) || 0) + 1);
  assert.equal(day.n, all.length); assert.equal(day.sum, all.reduce((a, x) => a + x, 0));
  assert.deepEqual(day.bins, [...counts].sort((a, b) => a[0] - b[0])); assert.deepEqual(day.best, [...all].sort((a, b) => a - b).slice(0, TOP_K));
  assert.deepEqual(day.seeds, [...seeds].sort((a, b) => a - b));
  assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM best WHERE day = ?').get(ymd).c, TOP_K);
});

await test('seed is idempotent per day: a repeat changes nothing, another day still works; parallel calls seed once', async () => {
  const db = fakeD1(), a = seedReq([30000, 50000, 70000]);
  assert.equal((await seed(db, a)).status, 'ok');
  const before = JSON.stringify(await dayOf(db));
  assert.deepEqual(await seed(db, seedReq([1000, 2000, 3000])), { status: 'exists' });
  assert.equal(JSON.stringify(await dayOf(db)), before);
  assert.equal((await seed(db, { ...a, d: 20260930 })).status, 'ok');
  const racers = await Promise.all([seed(db, seedReq([5000, 6000])).then(r => r.status), seed(db, { ...seedReq([5000, 6000]), d: 20260928 }).then(r => r.status), seed(db, { ...seedReq([5000, 6000]), d: 20260928 }).then(r => r.status)]);
  assert.deepEqual(racers.slice(1).sort(), ['exists', 'ok']); assert.equal((await dayOf(db, 20260928)).n, 2);
});

await test('seed: a failed batch rolls back and the day can be seeded on the retry', async () => {
  const db = fakeD1(); db.raw.exec('ALTER TABLE best RENAME TO best_gone');
  await assert.rejects(() => seed(db, seedReq([30000, 50000, 70000])));
  assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM seed').get().c, 0); assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM day').get().c, 0);
  db.raw.exec('ALTER TABLE best_gone RENAME TO best');
  assert.equal((await seed(db, seedReq([30000, 50000, 70000]))).status, 'ok');
});

await test('GET /stats without the seed table (schema.sql not re-run): same answer, seeds []', async () => {
  const db = fakeD1(); await submit(db, { d: ymd, t: 5000, b: binOf(5000) }); db.raw.exec('DROP TABLE seed');
  assert.deepEqual((await dayOf(db)).seeds, []);
});

await test('http POST /seed: bearer token, status codes, seeds visible in /stats', async () => {
  const env = { DB: fakeD1(), ALLOWED_ORIGIN: 'https://u.github.io', SEED_PLAYERS_SECRET: 's3cret' };
  const call = (body, auth, e = env, headers = {}) => worker.fetch(new Request('https://w.example/seed', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { ...(auth ? { Authorization: auth } : {}), ...headers } }), e);
  const today = Number(new Date().toISOString().slice(0, 10).replaceAll('-', '')), good = { d: today, ms: [30000, 50000, 70000], bins: [30000, 50000, 70000].map(binOf) };
  for (const auth of [undefined, '', 'Bearer', 'Bearer wrong', 's3cret', 'bearer s3cret', 'Bearer s3cre', 'Bearer s3cretx']) assert.equal((await call(good, auth)).status, 401, String(auth));
  assert.equal((await call(good, 'Bearer s3cret', { ...env, SEED_PLAYERS_SECRET: undefined })).status, 401, 'no token configured: closed');
  assert.equal((await call(good, 'Bearer ', { ...env, SEED_PLAYERS_SECRET: ' \n' })).status, 401, 'blank secret: closed, not open to an empty bearer');
  assert.equal((await call({ ...good, d: good.d }, 'Bearer s3cret', { ...env, DB: fakeD1(), SEED_PLAYERS_SECRET: 's3cret\n' })).status, 200, 'secret stored with a trailing newline (from a file) still matches');
  assert.equal((await call('nope', 'Bearer s3cret')).status, 400); assert.equal((await call({ ...good, ms: [1] }, 'Bearer s3cret')).status, 400);
  assert.equal((await call('x'.repeat(2000), 'Bearer s3cret', env, { 'content-length': '2000' })).status, 400);
  let r = await call(good, 'Bearer s3cret'); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'ok', n: 3, sum: 150000 });
  r = await call(good, 'Bearer s3cret'); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { status: 'exists' });
  const stats = await (await worker.fetch(new Request(`https://w.example/stats?from=${today}&to=${today}`), env)).json();
  assert.deepEqual(stats.days.map(x => [x.n, x.seeds]), [[3, [30000, 50000, 70000]]]);
  assert.equal((await worker.fetch(new Request('https://w.example/seed', { method: 'GET' }), env)).status, 404);
  assert.equal((await call({ ...good, d: today + 0 }, 'Bearer s3cret', { DB: { prepare() { throw new Error('x'); } }, SEED_PLAYERS_SECRET: 's3cret' })).status, 500);
});

console.log(`${n} passed`);
