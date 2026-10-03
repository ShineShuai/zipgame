// Runs schema.sql (the Turso database side) on SQLite (node:sqlite, Node >= 22.5) and compares it with the real Worker code: same aggregates, same replies,
// same accepted days. Run: node server/turso/schema.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { submit } from '../cloudflare/worker.js';
import { binOf, MIN_MS, MAX_MS, REPLAY_DAYS } from '../../src/core/hist.js';

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

// the statement the client sends after its INSERT: one SELECT, so that n, below and cnt come from the same snapshot
const REPLY = `SELECT d.n AS n, d.sum_ms AS sum,
  (SELECT COALESCE(SUM(n), 0) FROM bin WHERE day = ?1 AND bin < (SELECT bin FROM bin_edge WHERE ?2 >= lo AND ?2 < hi)) AS below,
  (SELECT n FROM bin WHERE day = ?1 AND bin = (SELECT bin FROM bin_edge WHERE ?2 >= lo AND ?2 < hi)) AS cnt,
  (SELECT json_group_array(ms) FROM (SELECT ms FROM best WHERE day = ?1 ORDER BY ms LIMIT 10)) AS best
FROM day d WHERE d.day = ?1`;

const open = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(tursoSchema);
  return db;
};
const insert = (db, uid, day, ms) => db.prepare('INSERT OR IGNORE INTO submit (uid, day, ms) VALUES (?, ?, ?)').run(uid, day, ms);
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c);

await test('schema.sql can be run twice', () => {
  const db = open();
  db.exec(tursoSchema);
  assert.equal(count(db, 'bin_edge'), 80);
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

await test('600 random solves: replies and day / bin / best identical to worker.js', async () => {
  const turso = open();
  const cloudflare = new DatabaseSync(':memory:');
  cloudflare.exec(cloudflareSchema);
  const fakeD1 = {
    prepare: sql => ({ bind: (...args) => ({ sql, args }) }),
    async batch(statements) {
      cloudflare.exec('BEGIN');
      const out = statements.map(s => ({ results: cloudflare.prepare(s.sql).all(...s.args) }));
      cloudflare.exec('COMMIT');
      return out;
    },
  };
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 600; i++) {
    const ms = Math.round(MIN_MS + (MAX_MS - MIN_MS) * random() ** 6);
    const expected = await submit(fakeD1, { d: today, t: ms, b: binOf(ms) });
    insert(turso, 'uid-' + String(i).padStart(6, '0'), today, ms);
    const r = turso.prepare(REPLY).get(today, ms);
    const got = { n: Number(r.n), sum: Number(r.sum), below: Number(r.below), cnt: Number(r.cnt), best: JSON.parse(r.best) };
    assert.deepEqual(got, expected, `solve ${i} (${ms} ms)`);
  }
  for (const table of ['day', 'bin', 'best']) {
    const query = `SELECT * FROM ${table} ORDER BY 1, 2`;
    const plain = rows => rows.map(row => ({ ...row }));
    assert.deepEqual(plain(turso.prepare(query).all()), plain(cloudflare.prepare(query).all()), table);
  }
});

await test('days: today, tomorrow and up to REPLAY_DAYS + 1 back are accepted; everything else is rejected', () => {
  const db = open();
  for (let k = -(REPLAY_DAYS + 1); k <= 1; k++) {
    assert.equal(Number(insert(db, `window-${k + 100}`, dayOf(k), 5000).changes), 1, `day ${k}`);
  }
  const before = [count(db, 'submit'), count(db, 'day'), count(db, 'bin'), count(db, 'best')];
  for (const k of [-(REPLAY_DAYS + 2), -40, 2]) {
    assert.throws(() => insert(db, `outside-${k + 100}`, dayOf(k), 5000), /invalid/, `day ${k}`);
  }
  for (const day of [20260231, 20261301, 20260100, 20260132, 0, 99999999, 'abc']) {
    assert.throws(() => insert(db, 'not-a-date-1', day, 5000), /invalid/, `day ${day}`);
  }
  assert.deepEqual([count(db, 'submit'), count(db, 'day'), count(db, 'bin'), count(db, 'best')], before, 'rejected rows leave no trace');
});

await test('invalid rows raise "invalid" even with OR IGNORE and write nothing', () => {
  const db = open();
  const before = [count(db, 'submit'), count(db, 'day')];
  const bad = [
    ['ms 499', 'good-uid-01', today, 499],
    ['ms 3600001', 'good-uid-02', today, MAX_MS + 1],
    ['float ms', 'good-uid-03', today, 1234.5],
    ['text ms', 'good-uid-04', today, 'abc'],
    ['short uid', 'short', today, 5000],
    ['long uid', 'x'.repeat(65), today, 5000],
  ];
  for (const [name, uid, day, ms] of bad) {
    assert.throws(() => insert(db, uid, day, ms), /invalid/, name);
  }
  assert.deepEqual([count(db, 'submit'), count(db, 'day')], before);
});

await test('a repeated uid changes nothing (retries are idempotent)', () => {
  const db = open();
  assert.equal(Number(insert(db, 'once-only-1', today, 4242).changes), 1);
  assert.equal(Number(insert(db, 'once-only-1', today, 4242).changes), 0);
  assert.equal(Number(db.prepare('SELECT n FROM day WHERE day = ?').get(today).n), 1);
});

console.log(`${passed} passed`);
