// The path of an offered theme, end to end: the author's tool (themes/tools: pack + stage) writes the SQL, theme_stage.sql runs it on SQLite
// (node:sqlite, Node >= 22.5), the app's own adapter (src/themes/source.js, through a stand-in for Turso's HTTP API) reads it back, and the app's
// own validator (src/themes/bundle.js) accepts the bundle. Withdrawing the offer makes it vanish. Run: node server/turso/theme-stage.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cleanBundle } from '../../src/themes/bundle.js';
import { createStage, tursoStage } from '../../src/themes/source.js';
import { loadBase, loadThemes, packTheme } from '../../../themes/tools/pack.mjs';
import { publishSql, withdrawSql } from '../../../themes/tools/stage.mjs';

const schema = readFileSync(new URL('./theme_stage.sql', import.meta.url), 'utf8');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok   ', name); };

const open = () => { const db = new DatabaseSync(':memory:'); db.exec(schema); return db; };
const hranaValue = v => (v === null ? { type: 'null' } : typeof v === 'bigint' || Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) });
// stands for Turso's POST /v2/pipeline, with the public token
const fakeTurso = (db, token = 'public-token') => async (url, init) => {
  assert.ok(url.endsWith('/v2/pipeline'), url);
  assert.equal(init.headers.Authorization, `Bearer ${token}`);
  const results = JSON.parse(init.body).requests.map(r => {
    if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
    try {
      const args = r.stmt.args.map(a => (a.type === 'integer' ? BigInt(a.value) : a.value));
      const stmt = db.prepare(r.stmt.sql);
      stmt.setReadBigInts(true);
      const rows = stmt.all(...args);
      return { type: 'ok', response: { type: 'execute', result: { cols: stmt.columns().map(c => ({ name: c.name })), rows: rows.map(row => Object.values(row).map(hranaValue)) } } };
    } catch (e) { return { type: 'error', error: { message: `SQLite error: ${e.message}` } }; }
  });
  return { ok: true, status: 200, json: async () => ({ results }) };
};
const offersAt = (db, now) => createStage({ fetchRows: tursoStage({ url: 'https://zipgame-x.turso.io/', key: 'public-token' }, fakeTurso(db)).fetchRows, now: () => now }).offers();
const base = loadBase();
const candy = packTheme(loadThemes().find(t => t.id === 'candy'), base).bundle;
const DAY = Date.parse('2026-11-01T00:00:00Z');

await test('a published theme is read back by the app, and the app accepts it', async () => {
  const db = open();
  db.exec(publishSql({ bundle: candy, event: '202611-autumn', from: '2026-11-01', until: '2026-11-08' }));
  const [offer] = await offersAt(db, DAY + 3600e3);
  assert.deepEqual([offer.event, offer.theme, offer.v, offer.from, offer.until], ['202611-autumn', 'candy', candy.v, DAY, DAY + 7 * 86400e3]);
  assert.deepEqual(offer.bundle, candy, 'the bundle is what the author packed, byte for byte');
  assert.ok(cleanBundle(offer.bundle, { known: n => n in base.light }), 'and the app accepts it');
});

await test('an offer is only on the stage in its window, and withdrawing it removes it', async () => {
  const db = open();
  db.exec(publishSql({ bundle: candy, event: 'e1', from: '2026-11-01', until: '2026-11-08' }));
  assert.equal((await offersAt(db, DAY - 1)).length, 0, 'not yet');
  assert.equal((await offersAt(db, DAY + 8 * 86400e3)).length, 0, 'over');
  assert.equal((await offersAt(db, DAY + 86400e3)).length, 1, 'running');
  db.exec(withdrawSql('e1'));
  assert.equal((await offersAt(db, DAY + 86400e3)).length, 0, 'withdrawn: gone even though the window is open');
});

await test('publishing again replaces the row; two events can run side by side', async () => {
  const db = open();
  db.exec(publishSql({ bundle: candy, event: 'a', from: '2026-11-01', until: '2026-11-08' }));
  db.exec(publishSql({ bundle: { ...candy, v: 2 }, event: 'a', from: '2026-11-01', until: '2026-11-08' }));
  db.exec(publishSql({ bundle: candy, event: 'b', from: '2026-11-01', until: '2026-11-08' }));
  const offers = await offersAt(db, DAY + 86400e3);
  assert.deepEqual(offers.map(o => [o.event, o.v]), [['a', 2], ['b', candy.v]]);
});

await test('the table refuses what is not an offer, and the author tool refuses it first', () => {
  const db = open();
  for (const sql of [
    "INSERT INTO theme_stage VALUES ('Bad Event', 'candy', 1, 1, 2, '{}')", "INSERT INTO theme_stage VALUES ('e', 'candy', 0, 1, 2, '{}')",
    "INSERT INTO theme_stage VALUES ('e', 'candy', 1, 5, 2, '{}')", "INSERT INTO theme_stage VALUES ('e', 'candy', 1, 1, 2, 'not json')",
    `INSERT INTO theme_stage VALUES ('e', 'candy', 1, 1, 2, '${JSON.stringify({ x: 'y'.repeat(210000) })}')`,
  ]) assert.throws(() => db.exec(sql), /constraint/i, sql.slice(0, 60));
  assert.throws(() => publishSql({ bundle: candy, event: "x'; DROP TABLE theme_stage;--", from: '2026-11-01', until: '2026-11-08' }), /event must be/);
  assert.throws(() => publishSql({ bundle: candy, event: 'e', from: '2026-11-08', until: '2026-11-01' }), /after/);
  assert.throws(() => publishSql({ bundle: candy, event: 'e', from: 'tomorrow', until: '2026-11-01' }), /not a date/);
  assert.throws(() => withdrawSql("a' OR '1'='1"), /event must be/);
  const quoted = open();
  quoted.exec(publishSql({ bundle: { ...candy, meta: { ...candy.meta, name: { en: "O'Brien", zh: '主题' } } }, event: 'q', from: '2026-11-01', until: '2026-11-08' }));
  assert.equal(JSON.parse(quoted.prepare('SELECT bundle FROM theme_stage').get().bundle).meta.name.en, "O'Brien", 'quotes survive');
});

console.log(`${passed} passed`);
