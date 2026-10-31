// Runs sync.sql (the Turso database side of the device sync) on SQLite
// (node:sqlite, Node >= 22.5) through the REAL client adapter (tursoCloud of
// src/platform/sync/cloud/turso.js) and the REAL pruning statements (tools/sync-prune.mjs).
// A small stand-in for Turso's HTTP API sits between them.
// Run: node server/turso/sync.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tursoCloud, SYNC_SQL } from '../../src/platform/sync/cloud/turso.js';
import { CloudError } from '../../src/platform/sync/cloud/http.js';
import { PRUNE_SQL } from '../../tools/sync-prune.mjs';

const schema = readFileSync(new URL('./sync.sql', import.meta.url), 'utf8');
const DAY_MS = 86400000;
const today = Math.floor(Date.now() / DAY_MS);
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok   ', name);
};

const open = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
};
const count = (db, where = '1') =>
  Number(db.prepare(`SELECT COUNT(*) c FROM sync WHERE ${where}`).get().c);
const hranaValue = v => {
  if (v === null) return { type: 'null' };
  const whole = typeof v === 'bigint' || Number.isInteger(v);
  return { type: whole ? 'integer' : 'text', value: String(v) };
};

// Stands for Turso's POST /v2/pipeline (errors inside an HTTP 200 envelope).
const fakeTurso = (db, token = 'public-token') => async (url, init) => {
  assert.ok(url.endsWith('/v2/pipeline'), url);
  assert.equal(init.headers.Authorization, `Bearer ${token}`);
  const results = JSON.parse(init.body).requests.map(r => {
    if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
    try {
      const args = r.stmt.args.map(a => (a.type === 'integer' ? BigInt(a.value) : a.value));
      const stmt = db.prepare(r.stmt.sql);
      stmt.setReadBigInts(true);
      const result = { cols: [], rows: [], affected_row_count: 0 };
      if (/^\s*(SELECT|WITH)/i.test(r.stmt.sql)) {
        result.cols = stmt.columns().map(c => ({ name: c.name }));
        result.rows = stmt.all(...args).map(row => Object.values(row).map(hranaValue));
      } else {
        result.affected_row_count = Number(stmt.run(...args).changes);
      }
      return { type: 'ok', response: { type: 'execute', result } };
    } catch (e) {
      return { type: 'error', error: { message: `SQLite error: ${e.message}` } };
    }
  });
  return { ok: true, status: 200, json: async () => ({ baton: null, base_url: null, results }) };
};
const cloud = (db, options = {}) => tursoCloud(
  { url: 'https://zipgame-x.turso.io/', key: 'public-token' }, 'turso-asia',
  { fetchFn: fakeTurso(db), now: () => Date.now(), ...options },
);

const ID = 'a1'.repeat(16);
const DEV = 'AAAAAAAAAAA';
const data = n => `sealed-${n}`.padEnd(40, 'x');
const put = (c, over = {}) => c.put({ id: ID, dev: DEV, data: data(1), ...over });
const code = async fn => {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof CloudError, error.message);
    return error.code;
  }
  return 'no error';
};
const reply = (ok, status, json) => async () => ({ ok, status, json });

await test('a device writes rows; seq is its highest + 1, chosen by the statement', async () => {
  const db = open();
  const c = cloud(db);
  for (let i = 1; i <= 3; i++) assert.equal(await put(c, { data: data(i) }), 'stored');
  const rows = db.prepare('SELECT seq, data FROM sync ORDER BY seq').all();
  assert.deepEqual(rows.map(r => Number(r.seq)), [1, 2, 3]);
  assert.equal(rows[2].data, data(3));
  await put(c, { dev: 'BBBBBBBBBBB' });
  const other = db.prepare("SELECT seq FROM sync WHERE dev = 'BBBBBBBBBBB'").get();
  assert.equal(Number(other.seq), 1, 'each device counts alone');
});

await test('get: the newest rows of each device with something new, newest first', async () => {
  const db = open();
  const c = cloud(db);
  for (let i = 1; i <= 4; i++) await put(c, { data: data(i) });
  await put(c, { dev: 'BBBBBBBBBBB', data: data(7) });
  await put(c, { id: 'b2'.repeat(16), dev: 'CCCCCCCCCCC', data: data(8) });
  const all = await c.get({ id: ID });
  assert.deepEqual(all.map(r => [r.dev, r.seq]),
    [[DEV, 4], [DEV, 3], [DEV, 2], ['BBBBBBBBBBB', 1]]);
  assert.equal(all[0].data, data(4));
  assert.deepEqual(await c.get({ id: ID, have: { [DEV]: 4, BBBBBBBBBBB: 1 } }), []);
  const some = await c.get({ id: ID, have: { [DEV]: 4 } });
  assert.deepEqual(some.map(r => r.dev), ['BBBBBBBBBBB']);
  assert.deepEqual(await c.get({ id: 'c3'.repeat(16) }), [], 'a group nobody uses');
});

await test('the trigger refuses what is not a slice row: shape, size, '
  + 'characters, day', async () => {
  const db = open();
  const c = cloud(db);
  const bad = [
    { id: 'short' }, { id: 'A1'.repeat(16) }, { dev: 'toolongdevice' }, { dev: 'AAAAAAAAA!!' },
    { data: 'tiny' }, { data: 'x'.repeat(24001) }, { data: `${data(1)} spaces and '` },
  ];
  for (const row of bad) {
    assert.equal(await code(() => put(c, row)), 'rejected', JSON.stringify(row).slice(0, 50));
  }
  assert.equal(count(db), 0, 'nothing was left behind');
  const at = days => cloud(db, { now: () => Date.now() + days * DAY_MS });
  assert.equal(await code(() => put(at(3))), 'rejected', 'a day three ahead');
  assert.equal(await code(() => put(at(-3))), 'rejected', 'a day three back');
  await put(at(1));
  assert.equal(count(db), 1, 'a day ahead is a clock a little off');
  const limit = await code(() => put(c, { data: 'x'.repeat(24000) }));
  assert.equal(limit, 'no error', '24000 is the limit');
});

await test('a seq may jump by at most 1000: junk cannot lock a device out', async () => {
  const db = open();
  const c = cloud(db);
  await put(c);
  const insert = db.prepare('INSERT INTO sync (id, dev, seq, day, data) VALUES (?, ?, ?, ?, ?)');
  const junk = seq => insert.run(ID, DEV, seq, today, data('junk'));
  assert.throws(() => junk(5000), /invalid/);
  junk(900);
  await put(c, { data: data(2) });
  const highest = db.prepare('SELECT MAX(seq) m FROM sync').get().m;
  assert.equal(Number(highest), 901, 'the next row follows the highest, junk included');
  assert.equal((await c.get({ id: ID }))[0].data, data(2));
});

await test('30 rows per device between prunes, then "busy"; other devices are '
  + 'not affected', async () => {
  const db = open();
  const c = cloud(db);
  for (let i = 1; i <= 30; i++) await put(c, { data: data(i) });
  assert.equal(await code(() => put(c, { data: data(99) })), 'busy');
  assert.equal(count(db, `dev = '${DEV}'`), 30, 'the refused row was rolled back');
  assert.equal(await put(c, { dev: 'BBBBBBBBBBB' }), 'stored');
});

await test('the ceiling: past sync_cfg.cap rows are "closed"; cap 0 stops '
  + 'everything', async () => {
  const db = open();
  const c = cloud(db);
  db.exec('UPDATE sync_cfg SET cap = 2');
  await put(c);
  await put(c, { data: data(2) });
  assert.equal(await code(() => put(c, { data: data(3) })), 'closed');
  assert.equal(count(db), 2);
  db.exec('UPDATE sync_cfg SET cap = 0');
  assert.equal(await code(() => put(c, { id: 'b2'.repeat(16) })), 'closed');
  db.exec('DELETE FROM sync_cfg');
  assert.equal(await code(() => put(c)), 'closed', 'no config row: closed');
});

await test('a token that may not insert is "denied", an unreachable server is '
  + '"network"', async () => {
  const db = open();
  const refused = reply(true, 200, async () => ({ results: [
    { type: 'error', error: { message: 'SQLite error: not authorized' } },
    { type: 'ok', response: { type: 'close' } }] }));
  const withFetch = fetchFn => cloud(db, { fetchFn });
  assert.equal(await code(() => put(withFetch(refused))), 'denied');
  const unauthorized = reply(false, 401, async () => ({}));
  assert.equal(await code(() => withFetch(unauthorized).get({ id: ID })), 'denied');
  const offline = async () => { throw new Error('offline'); };
  assert.equal(await code(() => withFetch(offline).get({ id: ID })), 'network');
  const nonsense = reply(true, 200, async () => ({ nonsense: 1 }));
  assert.equal(await code(() => withFetch(nonsense).get({ id: ID })), 'network');
  const html = async () => { throw new Error('html'); };
  assert.equal(await code(() => withFetch(reply(false, 500, html)).get({ id: ID })), 'network');
});

await test('rows that are not sealed-slice text are left out of get', async () => {
  const db = open();
  const c = cloud(db);
  const insert = db.prepare('INSERT INTO sync (id, dev, seq, day, data) VALUES (?, ?, 1, ?, ?)');
  insert.run(ID, DEV, today, data(1));
  assert.equal((await c.get({ id: ID })).length, 1);
  const lying = async (url, init) => {
    const body = await (await fakeTurso(db)(url, init)).json();
    for (const r of body.results) {
      const cols = r.response && r.response.result && r.response.result.cols;
      if (cols && cols.some(col => col.name === 'data')) {
        r.response.result.rows[0][1] = { type: 'text', value: 'not base64url!!' };
      }
    }
    return { ok: true, status: 200, json: async () => body };
  };
  assert.deepEqual(await cloud(db, { fetchFn: lying }).get({ id: ID }), []);
});

await test('pruning: the newest 3 rows per device stay, old ones beyond go; '
  + 'idle groups go', async () => {
  const db = open();
  db.exec('UPDATE sync_cfg SET cap = 100000');
  const insert = db.prepare('INSERT INTO sync (id, dev, seq, day, data) VALUES (?, ?, ?, ?, ?)');
  const OLD = today - 20;
  db.exec('DROP TRIGGER sync_ai'); // it would refuse old days: these rows stand for weeks-old ones
  for (let seq = 1; seq <= 6; seq++) insert.run(ID, DEV, seq, OLD, data(seq));
  for (let seq = 1; seq <= 6; seq++) {
    insert.run(ID, 'BBBBBBBBBBB', seq, seq > 4 ? today : OLD, data(seq));
  }
  const idle = 'd4'.repeat(16);
  for (let seq = 1; seq <= 2; seq++) insert.run(idle, DEV, seq, today - 200, data(seq));
  const fresh = 'e5'.repeat(16);
  insert.run(fresh, DEV, 1, today - 100, data(1));
  assert.equal(count(db), 15);
  db.prepare(PRUNE_SQL.rows).run(today - 7);
  const left = id => db.prepare('SELECT dev, seq FROM sync WHERE id = ? ORDER BY dev, seq')
    .all(id).map(r => `${r.dev}${r.seq}`);
  assert.deepEqual(left(ID), ['AAAAAAAAAAA4', 'AAAAAAAAAAA5', 'AAAAAAAAAAA6',
    'BBBBBBBBBBB4', 'BBBBBBBBBBB5', 'BBBBBBBBBBB6'], 'the newest 3 of each device');
  db.prepare(PRUNE_SQL.groups).run(today - 180);
  assert.deepEqual(left(idle), [], 'a group idle for 200 days is gone');
  assert.equal(left(fresh).length, 1, 'one idle for 100 days stays');
  assert.equal(left(ID).length, 6);
});

await test('the statements of the adapter are the ones this file ran', () => {
  assert.match(SYNC_SQL.put, /COALESCE\(MAX\(seq\), 0\) \+ 1/);
  assert.equal(Object.keys(SYNC_SQL).sort().join(), 'heads,put,rows');
});

console.log(`${passed} passed`);
