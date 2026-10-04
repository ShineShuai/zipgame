// Runs schema.sql (the Turso database side) on SQLite (node:sqlite, Node >= 22.5) through the REAL client adapter (tursoBackend of src/platform/leaderboard.js)
// and compares it with the real Worker code: same replies, same stats, same accepted days. A small stand-in for Turso's HTTP API sits between the two.
// Run: node server/turso/schema.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { submit, read, seed } from '../cloudflare/worker.js';
import { binOf, NB, MIN_MS, MAX_MS, REPLAY_DAYS } from '../../src/core/hist.js';
import { binEdges, binEdgeBlock, blockOf, withBlock } from '../../tools/print-bin-edge.mjs';
import { tursoBackend, createLeaderboard, TURSO_SQL } from '../../src/platform/leaderboard.js';
import { parseDays } from '../../src/core/stats-merge.js';

const tursoSchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const cloudflareSchema = readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8');
const DAY_MS = 86400000;
const dayOf = k => Number(new Date(Date.now() + k * DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''));
const today = dayOf(0);
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok   ', name);
};

const open = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(tursoSchema);
  return db;
};
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c);

// Stands for Turso's POST /v2/pipeline: runs every statement of the request on `db` and answers in the Hrana envelope (errors inside an HTTP 200).
const hranaValue = v => (v === null ? { type: 'null' } : typeof v === 'bigint' || Number.isInteger(v) ? { type: 'integer', value: String(v) } : typeof v === 'number' ? { type: 'float', value: v } : { type: 'text', value: v });
const fakeTurso = (db, token = 'public-token') => async (url, init) => {
  assert.ok(url.endsWith('/v2/pipeline'), url);
  assert.equal(init.headers.Authorization, 'Bearer ' + token);
  const results = JSON.parse(init.body).requests.map(r => {
    if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
    try {
      const args = r.stmt.args.map(a => (a.type === 'integer' ? BigInt(a.value) : a.value));
      const stmt = db.prepare(r.stmt.sql);
      stmt.setReadBigInts(true);
      if (!/^\s*(SELECT|WITH)/i.test(r.stmt.sql)) return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(stmt.run(...args).changes) } } };
      const rows = stmt.all(...args);
      return { type: 'ok', response: { type: 'execute', result: { cols: stmt.columns().map(c => ({ name: c.name })), rows: rows.map(row => Object.values(row).map(hranaValue)), affected_row_count: 0 } } };
    } catch (e) {
      return { type: 'error', error: { message: 'SQLite error: ' + e.message } };
    }
  });
  return { ok: true, status: 200, json: async () => ({ baton: null, base_url: null, results }) };
};
const backend = tursoBackend({ url: 'https://zipgame-x.turso.io/', key: 'public-token' }, 'turso-asia');
// one solve through the adapter: -> the decoded reply ({ n, sum, below, cnt, best } or { rejected: true }); throws like the client would (= failed)
const send = async (db, req) => {
  const { url, init } = backend.request(req);
  return backend.decode('submit', await (await fakeTurso(db)(url, init)).json());
};
const solve = (db, uid, day, ms, bin = binOf(ms)) => send(db, { d: day, t: ms, b: bin, u: uid });
const readDays = async (db, from, to) => {
  const { url, init } = backend.read({ from, to });
  return parseDays(backend.decode('read', await (await fakeTurso(db)(url, init)).json()));
};

// the Worker side: D1 on a second SQLite database
const cloudflareDb = () => {
  const cloudflare = new DatabaseSync(':memory:');
  cloudflare.exec(cloudflareSchema);
  return {
    cloudflare,
    d1: {
      prepare: sql => ({ bind: (...args) => ({ sql, args }) }),
      async batch(statements) {
        cloudflare.exec('BEGIN');
        const out = statements.map(s => ({ results: cloudflare.prepare(s.sql).all(...s.args) }));
        cloudflare.exec('COMMIT');
        return out;
      },
    },
  };
};
const seedBoth = async (turso, d1, d, ms) => {
  const expected = await seed(d1, { d, ms, bins: ms.map(binOf) });
  const r = turso.prepare('INSERT OR IGNORE INTO seed (day, ms) VALUES (?, ?)').run(d, JSON.stringify(ms));
  return { expected, changes: Number(r.changes) };
};

await test('schema.sql can be run twice', () => {
  const db = open();
  db.exec(tursoSchema);
  assert.equal(count(db, 'bin_edge'), NB);
});

await test('the bin_edge block of schema.sql is the one tools/print-bin-edge.mjs makes from hist.js (stale: node tools/print-bin-edge.mjs --write)', () => {
  assert.equal(blockOf(tursoSchema).text, binEdgeBlock());
  assert.equal(withBlock(tursoSchema), tursoSchema, '--write would change nothing');
  const edges = binEdges();
  assert.equal(edges.length, NB);
  assert.deepEqual([edges[0].lo, edges.at(-1).hi], [0, '4611686018427387904']);
  assert.ok(edges.every((e, k) => e.bin === k && (k === 0 || e.lo === edges[k - 1].hi) && Number(e.hi) > e.lo), 'contiguous, non-empty, in order');
});

await test('changed bins: re-running schema.sql replaces the boundaries, drops bins that no longer exist and never leaves the table empty', () => {
  const db = open();
  db.exec(`UPDATE bin_edge SET lo = lo + 1, hi = hi + 1 WHERE bin = 5; INSERT INTO bin_edge (bin, lo, hi) VALUES (${NB}, 1, 2), (${NB + 1}, 2, 3)`);
  db.exec(tursoSchema);
  assert.equal(count(db, 'bin_edge'), NB);
  const row = db.prepare('SELECT lo, hi FROM bin_edge WHERE bin = 5').get();
  assert.deepEqual([Number(row.lo), Number(row.hi)], [binEdges()[5].lo, Number(binEdges()[5].hi)]);
  const body = blockOf(tursoSchema).text.split('\n');
  assert.ok(body.findIndex(l => l.startsWith('INSERT OR REPLACE')) < body.findIndex(l => l.startsWith('DELETE FROM')), 'the rows are written before stale ones are deleted');
});

await test('print-bin-edge refuses a schema without exactly one begin and one end marker line', () => {
  assert.throws(() => withBlock('no markers here'), /exactly one/);
  assert.throws(() => withBlock('-- bin_edge:end\n-- bin_edge:begin'), /exactly one/);
});

await test('bin_edge gives binOf(ms) for every accepted time', () => {
  const db = open();
  const query = db.prepare('SELECT bin, lo, hi FROM bin_edge ORDER BY bin');
  query.setReadBigInts(true);
  const edges = query.all();
  let bin = 0;
  for (let ms = 0; ms <= MAX_MS; ms++) {
    while (BigInt(ms) >= edges[bin].hi) bin++;
    assert.equal(bin, binOf(ms), `bin of ${ms} ms`);
  }
});

await test('the trigger only reads and raises: the public token needs no write permission besides submit', () => {
  const db = open();
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger'").all().map(r => r.sql).join('\n');
  assert.match(sql, /RAISE\(ABORT, 'invalid'\)/);
  assert.doesNotMatch(sql.slice(sql.indexOf('BEGIN')), /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i, 'the body of the trigger (after its header AFTER INSERT ON)');
  assert.equal(count(db, "sqlite_master WHERE type = 'trigger'"), 1);
});

await test('600 random solves + seeds: every reply and the stats are identical to worker.js', async () => {
  const turso = open(), { d1 } = cloudflareDb();
  const days = [today, dayOf(-1), dayOf(-5)];
  let rng = 7;
  const random = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const first = await seedBoth(turso, d1, today, [4100, 9500, 61000]);
  assert.deepEqual([first.expected.status, first.changes], ['ok', 1]);
  for (let i = 0; i < 600; i++) {
    const ms = Math.round(MIN_MS + (MAX_MS - MIN_MS) * random() ** 6), d = days[i % 3];
    const expected = await submit(d1, { d, t: ms, b: binOf(ms) });
    assert.deepEqual(await solve(turso, 'uid-' + String(i).padStart(6, '0'), d, ms), expected, `solve ${i} (${ms} ms)`);
    if (i === 300) await seedBoth(turso, d1, dayOf(-1), [7000, 22000]);
  }
  assert.deepEqual(await readDays(turso, dayOf(-8), dayOf(1)), parseDays(await read(d1, { from: dayOf(-8), to: dayOf(1) })));
  const only = await readDays(turso, dayOf(-1), dayOf(-1));
  assert.deepEqual(only.map(x => x.d), [dayOf(-1)], 'the range limits the days');
  assert.deepEqual(only[0].seeds, [7000, 22000]);
  assert.equal(only[0].n, 202, '200 real players + 2 seeds');
});

await test('a second seeding of a day changes nothing (the seed row is the gate)', async () => {
  const turso = open(), { d1 } = cloudflareDb();
  assert.equal((await seedBoth(turso, d1, today, [5000, 6000])).changes, 1);
  const again = await seedBoth(turso, d1, today, [9000]);
  assert.deepEqual([again.expected.status, again.changes], ['exists', 0]);
  assert.deepEqual((await readDays(turso, today, today))[0].seeds, [5000, 6000]);
  assert.throws(() => turso.prepare('INSERT INTO seed (day, ms) VALUES (?, ?)').run(dayOf(1), '[1,2,3,4,5,6,7,8,9]'), /CHECK/);
  assert.throws(() => turso.prepare('INSERT INTO seed (day, ms) VALUES (?, ?)').run(dayOf(1), 'not json'), /CHECK/);
});

await test('days: today, tomorrow and up to REPLAY_DAYS + 1 back are accepted; everything else is rejected', async () => {
  const db = open();
  for (let k = -(REPLAY_DAYS + 1); k <= 1; k++) {
    assert.equal((await solve(db, `window-${k + 100}`, dayOf(k), 5000)).n, 1, `day ${k}`);
  }
  const before = [count(db, 'submit'), count(db, 'solve')];
  for (const k of [-(REPLAY_DAYS + 2), -40, 2]) {
    assert.deepEqual(await solve(db, `outside-${k + 100}`, dayOf(k), 5000), { rejected: true }, `day ${k}`);
  }
  for (const day of [20260231, 20261301, 20260100, 20260132, 0, 99999999]) {
    assert.deepEqual(await solve(db, 'not-a-date-1', day, 5000), { rejected: true }, `day ${day}`);
  }
  assert.deepEqual([count(db, 'submit'), count(db, 'solve')], before, 'rejected rows leave no trace');
});

await test('invalid rows are rejected with OR IGNORE too, and write nothing', async () => {
  const db = open();
  const bad = [
    ['ms 499', 'good-uid-01', today, 499, 0],
    ['ms 3600001', 'good-uid-02', today, MAX_MS + 1, 79],
    ['short uid', 'short', today, 5000, binOf(5000)],
    ['long uid', 'x'.repeat(65), today, 5000, binOf(5000)],
    ['bin of another time', 'good-uid-03', today, 5000, binOf(5000) + 1],
    ['bin -1', 'good-uid-04', today, 5000, -1],
    [`bin ${NB}`, 'good-uid-05', today, 5000, NB],
  ];
  for (const [name, uid, day, ms, bin] of bad) assert.deepEqual(await solve(db, uid, day, ms, bin), { rejected: true }, name);
  const raw = (uid, day, ms, bin) => db.prepare('INSERT OR IGNORE INTO submit (uid, day, ms, bin) VALUES (?, ?, ?, ?)').run(uid, day, ms, bin);
  assert.throws(() => raw('good-uid-06', today, 1234.5, 1), /invalid/, 'float ms');
  assert.throws(() => raw('good-uid-07', today, 'abc', 1), /invalid/, 'text ms');
  assert.throws(() => raw('good-uid-08', 'abc', 5000, binOf(5000)), /invalid/, 'text day');
  assert.throws(() => raw('good-uid-09', today, 5000, 'x'), /invalid/, 'text bin');
  assert.equal(count(db, 'submit'), 0);
});

await test('a repeated uid changes nothing (retries are idempotent) and still answers with the stats', async () => {
  const db = open();
  const a = await solve(db, 'once-only-1', today, 4242), b = await solve(db, 'once-only-1', today, 4242);
  assert.equal(a.n, 1);
  assert.deepEqual(b, a);
  assert.equal(count(db, 'submit'), 1);
});

await test('every read is answered from the covering index (no table scan)', () => {
  const db = open();
  const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...[1, 2].slice(0, (sql.match(/\?[12]/g) || []).length ? 2 : 0)).map(r => r.detail).join('\n');
  for (const sql of [TURSO_SQL.summary, TURSO_SQL.read]) {
    const p = plan(sql);
    assert.match(p, /COVERING INDEX submit_day/, p);
    assert.doesNotMatch(p, /SCAN submit\b/, p);
  }
});

await test('the adapter in the leaderboard flow: ok, rejected (invalid input) and failed (the server errors)', async () => {
  const db = open();
  const lb = createLeaderboard({ always: backend, chain: [] }, { fetchFn: fakeTurso(db), timeoutMs: 1000 });
  const ok = await lb.submit(String(today), 42.5);
  assert.deepEqual([ok.status, ok.complete, ok.backend, ok.summary.n, ok.summary.mean], ['ok', true, 'turso-asia', 1, 42.5]);
  assert.equal((await lb.submit(String(today), 0.4)).status, 'skipped', 'below MIN_MS: nothing sent');
  assert.equal((await lb.submit(String(dayOf(-30)), 42.5)).status, 'rejected', 'a day outside the window: the trigger says invalid');
  const noInsertRight = async (url, init) => { // e.g. a token without submit:data_add: SQLITE_AUTH inside the envelope
    const reply = await (await fakeTurso(db)(url, init)).json();
    reply.results[0] = { type: 'error', error: { message: 'SQLite error: not authorized', code: 'SQLITE_AUTH' } };
    return { ok: true, status: 200, json: async () => reply };
  };
  const denied = createLeaderboard({ always: backend, chain: [] }, { fetchFn: noInsertRight, timeoutMs: 1000 });
  assert.equal((await denied.submit(String(today), 42.5)).status, 'failed');
});

console.log(`${passed} passed`);
