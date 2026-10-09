// Runs schema.sql (the Turso database side) on SQLite (node:sqlite, Node >= 22.5) through the REAL client adapter (tursoBackend of src/platform/leaderboard.js)
// and compares it with the real Worker code: same replies, same stats, same accepted days. A small stand-in for Turso's HTTP API sits between the two.
// Run: node server/turso/schema.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker, { submit, read, seed, addPlay } from '../cloudflare/worker.js';
import { binOf, NB, MIN_MS, MAX_MS, REPLAY_DAYS } from '../../src/core/hist.js';
import { binEdges, binEdgeBlock, blockOf, withBlock } from '../../tools/print-bin-edge.mjs';
import { tursoBackend, createLeaderboard, TURSO_SQL } from '../../src/platform/leaderboard.js';
import { parseDays } from '../../src/core/stats-merge.js';
import { SINKS } from '../../src/platform/behaviour.js';
import { COLUMNS, COLUMN_NAMES, INSERT_SQL, validateRow, packPuzzle, packS, utcDay } from '../../src/core/behaviour.js';
import { parse, serialize } from '../../src/core/format.js';
import { createAdmin, describe, dedupe, select, idsOf } from '../../tools/behaviour-lib.mjs';
import { dateOfDay } from '../../src/features/daily.js';

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
const hranaValue = v => (v === null ? { type: 'null' } : v instanceof Uint8Array ? { type: 'blob', base64: Buffer.from(v).toString('base64') } : typeof v === 'bigint' || Number.isInteger(v) ? { type: 'integer', value: String(v) } : typeof v === 'number' ? { type: 'float', value: v } : { type: 'text', value: v });
const fakeTurso = (db, token = 'public-token') => async (url, init) => {
  assert.ok(url.endsWith('/v2/pipeline'), url);
  assert.equal(init.headers.Authorization, 'Bearer ' + token);
  const results = JSON.parse(init.body).requests.map(r => {
    if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
    try {
      const args = r.stmt.args.map(a => (a.type === 'integer' ? BigInt(a.value) : a.type === 'blob' ? Buffer.from(a.base64, 'base64') : a.type === 'null' ? null : a.value));
      const stmt = db.prepare(r.stmt.sql);
      stmt.setReadBigInts(true);
      if (!/^\s*(SELECT|WITH|PRAGMA)/i.test(r.stmt.sql)) return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(stmt.run(...args).changes) } } };
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
        const out = statements.map(s => ({ results: cloudflare.prepare(s.sql).all(...s.args.map(a => (a instanceof ArrayBuffer ? new Uint8Array(a) : a))) })); // D1 binds a BLOB as an ArrayBuffer
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

await test('the triggers only read and raise: the public token needs no write permission besides submit and play', () => {
  const db = open();
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all();
  assert.deepEqual(triggers.map(t => t.name).sort(), ['play_ai', 'submit_ai']);
  assert.match(triggers.map(t => t.sql).join('\n'), /RAISE\(ABORT, 'invalid'\)/);
  for (const t of triggers) assert.doesNotMatch(t.sql.slice(t.sql.indexOf('BEGIN')), /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i, `the body of ${t.name} (after its header AFTER INSERT ON)`);
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
  for (const k of [-(REPLAY_DAYS + 2), -300, 2]) {
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
  assert.equal((await lb.submit(String(dayOf(-300)), 42.5)).status, 'rejected', 'a day outside the window: the trigger says invalid');
  const noInsertRight = async (url, init) => { // e.g. a token without submit:data_add: SQLITE_AUTH inside the envelope
    const reply = await (await fakeTurso(db)(url, init)).json();
    reply.results[0] = { type: 'error', error: { message: 'SQLite error: not authorized', code: 'SQLITE_AUTH' } };
    return { ok: true, status: 200, json: async () => reply };
  };
  const denied = createLeaderboard({ always: backend, chain: [] }, { fetchFn: noInsertRight, timeoutMs: 1000 });
  assert.equal((await denied.submit(String(today), 42.5)).status, 'failed');
});

// ---------- behaviour rows ----------
const PZ = packPuzzle(parse('size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4'));
const row = (extra = {}) => ({ day: utcDay(), ms: 42130, u: 7, deep: 3, s: packS('local', 5), pz: PZ, ev: null, v: 0, ...extra });
const sink = SINKS.turso({ url: 'https://zipgame-x.turso.io/', key: 'public-token' });
// one row through the page's own sink: 'ok' | 'rejected'; throws like the page would see it (= failed)
const sendPlay = async (db, r, token = 'public-token') => {
  const { url, init } = sink.request(r);
  const res = await fakeTurso(db, token)(url, init);
  return sink.decode(res.status, await res.json());
};
const playRows = db => db.prepare('SELECT rowid AS id, day, ms, u, deep, s, hex(pz) AS pz, hex(ev) AS ev, v FROM play ORDER BY rowid').all();

await test('play: the trigger accepts and rejects exactly what validateRow of src/core/behaviour.js does (one rule set, two implementations)', async () => {
  const db = open(), d = utcDay();
  const cases = {
    ok: row(), 'ok: a Game of Day row (no puzzle, no counts)': row({ pz: null, u: null, deep: null, s: packS('gotd', 15) }), 'ok: ms at the lower limit': row({ ms: 500 }), 'ok: ms at the upper limit': row({ ms: 3600000 }),
    'ok: the oldest replay day': row({ day: d - REPLAY_DAYS - 1 }), 'ok: tomorrow': row({ day: d + 1 }), 'ok: ev of 64 bytes': row({ ev: new Uint8Array(64) }), 'ok: pz of 128 bytes': row({ pz: new Uint8Array(128) }), 'ok: v 15': row({ v: 15 }),
    'ms 499': row({ ms: 499 }), 'ms 3600001': row({ ms: 3600001 }), 'day too old': row({ day: d - REPLAY_DAYS - 2 }), 'day too new': row({ day: d + 2 }), 'u -1': row({ u: -1 }), 'u 65536': row({ u: 65536 }),
    'deep 65536': row({ deep: 65536 }), 's 256': row({ s: 256 }), 'pz 3 bytes': row({ pz: PZ.slice(0, 3) }), 'pz 129 bytes': row({ pz: new Uint8Array(129) }), 'ev 65 bytes': row({ ev: new Uint8Array(65) }), 'v 16': row({ v: 16 }), 'v -1': row({ v: -1 }),
  };
  for (const [name, r] of Object.entries(cases)) {
    const want = validateRow(r) ? 'ok' : 'rejected';
    assert.equal(name.startsWith('ok') ? 'ok' : 'rejected', want, `${name}: validateRow disagrees with the case's own label`);
    assert.equal(await sendPlay(db, r), want, name);
  }
  const accepted = Object.keys(cases).filter(k => k.startsWith('ok')).length;
  assert.equal(count(db, 'play'), accepted, 'only the accepted rows are stored');
  const raw = (...a) => db.prepare(INSERT_SQL).run(...a);
  assert.throws(() => raw(utcDay(), 'abc', null, null, null, null, null, 0), /invalid/, 'text ms');
  assert.throws(() => raw(utcDay(), 4000.5, null, null, null, null, null, 0), /invalid/, 'float ms');
  assert.throws(() => raw(utcDay(), 4000, null, null, null, 'text', null, 0), /invalid/, 'a text pz');
  assert.throws(() => raw(utcDay(), 4000, 'x', null, null, null, null, 0), /invalid/, 'text u');
  assert.throws(() => raw(null, 4000, null, null, null, null, null, 0), /NOT NULL/, 'no day (never sent: the page validates first)');
  assert.equal(count(db, 'play'), accepted);
});

await test('play: the Turso table and the Worker (D1) store the same row the same way', async () => {
  const turso = open(), { cloudflare, d1 } = cloudflareDb();
  for (const r of [row(), row({ pz: null, u: null, deep: null, s: packS('replay', 3), ms: 9999 }), row({ ev: Uint8Array.of(0, 1, 2, 255), v: 1 })]) {
    assert.equal(await sendPlay(turso, r), 'ok'); assert.equal(await addPlay(d1, r), 'ok');
  }
  const q = db => db.prepare('SELECT rowid AS id, day, ms, u, deep, s, hex(pz) AS pz, hex(ev) AS ev, v FROM play ORDER BY rowid').all();
  assert.deepEqual(q(cloudflare), playRows(turso));
  assert.equal(playRows(turso)[0].pz, Buffer.from(PZ).toString('hex').toUpperCase(), 'the puzzle bytes arrive unchanged');
  assert.equal(playRows(turso)[2].ev, '000102FF');
});

await test('play: the ceiling, the off switch and a missing config are failures the page retries (not rejections); a denied token is a failure too', async () => {
  const db = open();
  assert.equal(await sendPlay(db, row()), 'ok');
  db.exec('UPDATE play_cfg SET cap = 1');
  await assert.rejects(() => sendPlay(db, row()), /closed/, 'the highest id is at the cap');
  assert.equal(count(db, 'play'), 1);
  db.exec('UPDATE play_cfg SET cap = 2'); assert.equal(await sendPlay(db, row()), 'ok');
  db.exec('UPDATE play_cfg SET cap = 0'); await assert.rejects(() => sendPlay(db, row()), /closed/, 'cap 0 = off');
  db.exec('DELETE FROM play; UPDATE play_cfg SET cap = 3000000'); assert.equal(await sendPlay(db, row()), 'ok'); assert.equal(playRows(db)[0].id, 1);
  db.exec('DELETE FROM play_cfg'); await assert.rejects(() => sendPlay(db, row()), /closed/, 'no config row: fail closed');
  const reply = message => ({ results: [{ type: 'error', error: { message } }] });
  assert.throws(() => sink.decode(200, reply('SQLite error: not authorized')), /not authorized/, 'a token without play:data_add: a failure, so the backup is tried');
  assert.equal(sink.decode(200, reply('SQLite error: invalid')), 'rejected');
  assert.throws(() => sink.decode(500, null), /HTTP 500/);
});

await test('play: schema.sql run twice keeps the rows and a changed cap; both schemas have exactly the COLUMNS of src/core/behaviour.js (name, type, NOT NULL, default)', () => {
  const db = open(); db.prepare(INSERT_SQL).run(...COLUMN_NAMES.map(n => row()[n])); db.exec('UPDATE play_cfg SET cap = 77');
  db.exec(tursoSchema);
  assert.equal(count(db, 'play'), 1); assert.equal(Number(db.prepare('SELECT cap FROM play_cfg').get().cap), 77); assert.equal(count(db, 'play_cfg'), 1);
  const cf = new DatabaseSync(':memory:'); cf.exec(cloudflareSchema);
  for (const [name, handle] of [['turso', db], ['cloudflare', cf]]) {
    const cols = handle.prepare('PRAGMA table_info(play)').all();
    assert.deepEqual(cols.map(c => c.name), COLUMN_NAMES, name + ': column order');
    for (const [i, c] of COLUMNS.entries()) {
      assert.equal(cols[i].type, c.sql.split(' ')[0], `${name}.${c.name}: type`);
      assert.equal(Boolean(cols[i].notnull), c.sql.includes('NOT NULL'), `${name}.${c.name}: NOT NULL`);
      assert.equal(cols[i].dflt_value, c.sql.includes('DEFAULT') ? c.sql.split('DEFAULT ')[1] : null, `${name}.${c.name}: default`);
    }
  }
  for (const c of COLUMNS.slice(2)) assert.ok(!c.sql.includes('NOT NULL') || c.sql.includes('DEFAULT'), `${c.name} could not be added by ALTER TABLE (a NOT NULL column needs a DEFAULT)`);
});

await test('play: a column added later (ALTER TABLE ADD COLUMN) leaves the old rows and the trigger working; an older page that does not send it still inserts', async () => {
  const db = open(); assert.equal(await sendPlay(db, row()), 'ok');
  db.exec('ALTER TABLE play ADD COLUMN extra INTEGER');
  assert.equal(await sendPlay(db, row({ ms: 5000 })), 'ok');
  assert.deepEqual(db.prepare('SELECT extra FROM play ORDER BY rowid').all().map(r => r.extra), [null, null]);
});

// tools/behaviour-lib.mjs against the real Turso table (through the fake HTTP API) and the real Worker, both on SQLite
const PZ_B = packPuzzle(parse('size 6\ncheckpoints 0,0=1 5,5=2 2,3=3\nwalls'));
const adminFor = (turso, d1, { secret = 'adm1n', token = 'owner-token' } = {}) => createAdmin({
  turso: { url: 'https://zipgame-x.turso.io', token }, cloudflare: { url: 'https://w.example', secret },
  fetchFn: (url, init) => (url.startsWith('https://w.example') ? worker.fetch(new Request(url, init), { DB: d1, PLAY_ADMIN_SECRET: 'adm1n' }) : fakeTurso(turso, token)(url, init)),
});
await test('tools/behaviour-lib: export reads both backends, delete removes exactly the chosen rows on the backend that holds them, a wrong secret changes nothing', async () => {
  const turso = open(), { cloudflare, d1 } = cloudflareDb(), d = utcDay();
  const put = async (db, r) => (db === turso ? sendPlay(turso, r) : addPlay(d1, r));
  const A = row({ ms: 11000 }), A2 = row({ ms: 12000 }), B = row({ pz: PZ_B, ms: 13000 }), G = row({ pz: null, u: null, deep: null, s: packS('gotd', 4), ms: 14000, day: d - 1 }), R = { ...G, s: packS('replay', 4), ms: 15000 };
  for (const r of [A, B, G]) await put(turso, r);
  for (const r of [A, A2, R]) await put(cloudflare, r); // A is on both backends: one game stored twice
  const admin = adminFor(turso, d1), { rows, columns } = await admin.exportRows();
  assert.deepEqual(columns, { turso: COLUMN_NAMES, cloudflare: COLUMN_NAMES }); assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(r => `${r.where}:${r.id}`), ['turso:1', 'turso:2', 'turso:3', 'cloudflare:1', 'cloudflare:2', 'cloudflare:3']);
  const { rows: unique, dropped } = dedupe(rows); assert.equal(dropped, 1);
  const gotdText = 'size 5\ncheckpoints 0,0=1 4,4=2\nwalls', files = { [dateOfDay(d - 1)]: gotdText }, described = describe(unique, files);
  assert.deepEqual(described.map(r => [r.kind, r.skill, r.bad, r.key === null]), [['local', 5, false, false], ['local', 5, false, false], ['gotd', 4, false, false], ['local', 5, false, false], ['replay', 4, false, false]]);
  assert.equal(described[0].key, serialize(parse('size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4')));
  assert.equal(described[2].key, gotdText); assert.equal(describe(unique)[2].key, null, 'a Game of Day without its file has no key');
  assert.equal(describe([{ ...rows[0], pz: 'AAAA' }])[0].bad, true, 'a puzzle that does not decode is marked');
  const puzzleA = 'size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4';
  assert.deepEqual(select(rows, { puzzle: puzzleA }).map(r => `${r.where}:${r.id}`), ['turso:1', 'cloudflare:1', 'cloudflare:2'], 'every row of the puzzle, duplicates included');
  assert.deepEqual(select(rows, { gotd: dateOfDay(d - 1).toString() }).map(r => `${r.where}:${r.id}`), ['turso:3', 'cloudflare:3'], 'Game of Day and replay rows of that day, not the local ones');
  assert.equal(select(rows, { day: dateOfDay(d).toString() }).length, 4); assert.deepEqual(select(rows, { ids: ['turso:2', 'cloudflare:3', 'nope:1'] }).map(r => `${r.where}:${r.id}`), ['turso:2', 'cloudflare:3']);
  assert.throws(() => select(rows, {}), /exactly one/); assert.throws(() => select(rows, { day: '20260101', gotd: '20260101' }), /exactly one/); assert.throws(() => select(rows, { day: '2026' }), /YYYYMMDD/);
  assert.throws(() => select(rows, { puzzle: 'size 5\ncheckpoints 0,0=1\nwalls' }), /cannot be uploaded/);
  await assert.rejects(() => adminFor(turso, d1, { secret: 'wrong' }).deleteRows({ cloudflare: [1] }), /HTTP 401/); assert.equal(count(cloudflare, 'play'), 3, 'a wrong secret deletes nothing');
  const done = await admin.deleteRows(idsOf(select(rows, { puzzle: puzzleA })));
  assert.deepEqual(done, { turso: 1, cloudflare: 2 }); assert.deepEqual(playRows(turso).map(r => r.id), [2, 3]); assert.deepEqual(cloudflare.prepare('SELECT rowid AS id FROM play').all().map(r => r.id), [3]);
  assert.deepEqual(await admin.deleteRows({ turso: [999], cloudflare: [999] }), { turso: 0, cloudflare: 0 }, 'ids that are no rows');
  const after = await admin.exportRows(); assert.deepEqual(after.rows.map(r => `${r.where}:${r.id}`), ['turso:2', 'turso:3', 'cloudflare:3']);
  const many = open(); for (let i = 0; i < 250; i++) await sendPlay(many, row({ ms: 1000 + i }));
  assert.deepEqual(await adminFor(many, d1).deleteRows({ turso: Array.from({ length: 200 }, (_, i) => i + 1) }), { turso: 200, cloudflare: 0 }, 'across chunks'); assert.equal(count(many, 'play'), 50);
  assert.equal((await adminFor(many, d1).exportRows()).rows.filter(r => r.where === 'turso').length, 50);
  const big = open(); for (let i = 0; i < 1005; i++) big.prepare(INSERT_SQL).run(...COLUMN_NAMES.map(n => row({ ms: 1000 + i })[n]));
  assert.equal((await adminFor(big, d1).exportRows()).rows.filter(r => r.where === 'turso').length, 1005, 'more than one page of 1000');
});

await test('tools/behaviour-lib: migrate adds a missing column on Turso and prints the wrangler command for D1; a table behind the code can still be read; a NOT NULL column without DEFAULT is refused', async () => {
  const turso = open(), { cloudflare, d1 } = cloudflareDb(); await sendPlay(turso, row()); await addPlay(d1, row());
  turso.exec('DROP TRIGGER play_ai'); // (it names ev)
  for (const db of [turso, cloudflare]) db.exec('ALTER TABLE play DROP COLUMN ev'); // the tables as they were before `ev` existed
  const admin = adminFor(turso, d1), { rows, columns } = await admin.exportRows();
  assert.deepEqual(columns.turso, COLUMN_NAMES.filter(n => n !== 'ev')); assert.deepEqual(columns.cloudflare, columns.turso);
  assert.deepEqual(rows.map(r => r.ev), [null, null], 'a column that does not exist yet reads as null');
  const out = await admin.migrate('my-d1');
  assert.deepEqual(out.turso, ['ALTER TABLE play ADD COLUMN ev BLOB']); assert.deepEqual(out.cloudflare, ['npx wrangler d1 execute my-d1 --remote --command "ALTER TABLE play ADD COLUMN ev BLOB"']);
  assert.deepEqual([...(await admin.columns()).turso].sort(), [...COLUMN_NAMES].sort(), 'the added column comes last in the table; the code always names its columns, so the order does not matter'); assert.deepEqual((await admin.migrate()).turso, [], 'run twice: nothing to add');
  cloudflare.exec('ALTER TABLE play ADD COLUMN ev BLOB'); assert.deepEqual((await admin.migrate()), { turso: [], cloudflare: [] });
  const bad = { name: 'zz_required', sql: 'INTEGER NOT NULL', ok: () => true }; COLUMNS.push(bad);
  try { await assert.rejects(() => admin.migrate(), /NOT NULL without a DEFAULT/); } finally { COLUMNS.pop(); }
});

console.log(`${passed} passed`);
