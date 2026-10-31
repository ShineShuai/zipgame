// The cloud way (platform/sync/cloud.js): two or three devices with real engines, a model of the
// Supabase functions and the real Turso schema (trigger included) on SQLite behind the real
// adapters.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES_SEEN_KEY } from '../../src/features/rules-seen.js';
import { createCloud } from '../../src/platform/sync/cloud.js';
import { supabaseCloud } from '../../src/platform/sync/cloud/supabase.js';
import { tursoCloud } from '../../src/platform/sync/cloud/turso.js';
import { createSync } from '../../src/platform/sync/engine.js';
import { fakeSupabase, fakeTurso, memoryStorage, tursoDatabase } from './helpers.js';

const rules = (...ids) => JSON.stringify(
  { v: 1, seen: Object.fromEntries(ids.map(id => [id, true])) });
const FAST = 1000;
const TURSO = { url: 'https://zipgame-x.turso.io', key: 'public-token' };

// the two servers of one test, and a way to switch each off
function servers() {
  const supa = fakeSupabase({ now: () => clock });
  let clock = Date.now();
  const flags = { supabaseDown: false, tursoDown: false };
  return {
    supa,
    db: null,
    flags,
    tick: ms => { clock += ms; },
    async make() {
      this.db = await tursoDatabase();
      return this;
    },
    backends(order = ['supabase', 'turso']) {
      const supabase = supabaseCloud(supa.entry, 'supabase-asia', {
        fetchFn: async (...a) => {
          if (flags.supabaseDown) throw new Error('offline');
          return supa.fetchFn(...a);
        },
      });
      const turso = tursoCloud(TURSO, 'turso-asia', {
        fetchFn: fakeTurso(this.db, { down: () => flags.tursoDown }),
      });
      return order.map(name => (name === 'supabase' ? supabase : turso));
    },
  };
}

async function device(world, { data = {}, secret = null, order, minPushMs = 0 } = {}) {
  const storage = memoryStorage(data);
  const sync = createSync({ storage });
  await sync.init();
  await sync.enable({ cloud: true, ...(secret ? { secret } : {}) });
  const cloud = createCloud({
    sync, backends: world.backends(order), iterations: FAST, minPushMs,
    now: () => Date.now(),
  });
  return { storage, sync, cloud };
}

const seenOf = async (d, id) => {
  const raw = await d.storage.get(RULES_SEEN_KEY);
  const view = d.sync.view(RULES_SEEN_KEY, raw ? JSON.parse(raw.value) : null);
  return Boolean(view && view.seen[id]);
};

test('devices that are never open together meet through the servers, both ways', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') } });
  const secret = a.sync.secret();
  const b = await device(world, { data: { [RULES_SEEN_KEY]: rules('arrows') }, secret });
  const first = await a.cloud.sync();
  assert.deepEqual([first.ok, first.pushed], [true, 2], 'A wrote to both servers');
  const second = await b.cloud.sync();
  assert.equal(second.accepted, 1);
  assert.ok(await seenOf(b, 'cutout') && await seenOf(b, 'arrows'));
  world.tick(10000);
  const third = await a.cloud.sync();
  assert.equal(third.accepted, 1);
  assert.ok(await seenOf(a, 'arrows'));
  assert.equal(a.cloud.status().error, null);
  assert.ok(a.cloud.status().lastOk > 0);
});

test('a second round with nothing new says nothing and writes nothing', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('x') } });
  await a.cloud.sync();
  const rows = world.db.prepare('SELECT COUNT(*) c FROM sync').get().c;
  const puts = world.supa.calls.filter(c => c.name === 'sync_put').length;
  const again = await a.cloud.sync();
  assert.deepEqual([again.accepted, again.pushed], [0, 0]);
  assert.equal(world.db.prepare('SELECT COUNT(*) c FROM sync').get().c, rows);
  assert.equal(world.supa.calls.filter(c => c.name === 'sync_put').length, puts);
});

test('a group is only its secret: another secret finds nothing, and what is '
  + 'stored is ciphertext', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('secretrule') } });
  await a.cloud.sync();
  const stranger = await device(world);
  assert.equal((await stranger.cloud.sync()).accepted, 0);
  const stored = JSON.stringify([...world.supa.groups.values()].map(g => [...g.slices.values()]))
    + JSON.stringify(world.db.prepare('SELECT data FROM sync').all());
  assert.ok(!stored.includes('secretrule'));
  assert.ok(!stored.includes('cutout'));
  assert.deepEqual([...world.supa.groups.keys()].every(id => /^[0-9a-f]{32}$/.test(id)), true);
});

test('one server down: the other carries it; both down: an error, and no harm', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') } });
  const b = await device(world, { secret: a.sync.secret() });
  world.flags.supabaseDown = true;
  const pushed = await a.cloud.sync();
  assert.deepEqual([pushed.ok, pushed.pushed], [true, 1], 'only Turso took it');
  assert.equal(a.cloud.status().backends['supabase-asia'].ok, false);
  assert.equal(a.cloud.status().backends['turso-asia'].ok, true);
  assert.equal((await b.cloud.sync()).accepted, 1, 'B reads from Turso alone');
  assert.ok(await seenOf(b, 'cutout'));
  world.flags.tursoDown = true;
  const c = await device(world, { secret: a.sync.secret() });
  const nothing = await c.cloud.sync();
  assert.equal(nothing.ok, false);
  assert.equal(c.cloud.status().error, 'network');
  world.flags.supabaseDown = false;
  world.flags.tursoDown = false;
  assert.equal((await c.cloud.sync()).ok, true, 'and it recovers');
  assert.ok(await seenOf(c, 'cutout'));
});

test('a server that missed a push gets it on the next one', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') } });
  world.flags.supabaseDown = true;
  await a.cloud.sync();
  world.flags.supabaseDown = false;
  world.tick(10000);
  const again = await a.cloud.sync();
  assert.equal(again.pushed, 1, 'only the one that lacked it');
  assert.equal(world.supa.groups.size, 1);
});

test('junk rows on the public Turso table are skipped, and writing goes on', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') }, order: ['turso'] });
  await a.cloud.sync();
  const id = world.db.prepare('SELECT id FROM sync').get().id;
  const dev = a.sync.status().dev;
  const day = Math.floor(Date.now() / 86400000);
  const insert = world.db.prepare(
    'INSERT INTO sync (id, dev, seq, day, data) VALUES (?, ?, ?, ?, ?)');
  const junk = (device, seq, data) => insert.run(id, device, seq, day, data);
  junk(dev, 50, 'x'.repeat(60)); // above the real row, and not sealed
  junk('ZZZZZZZZZZZ', 1, 'y'.repeat(60)); // a device that does not exist
  const b = await device(world, { secret: a.sync.secret(), order: ['turso'] });
  const result = await b.cloud.sync();
  assert.equal(result.accepted, 1, 'the real slice of A was found below the junk');
  assert.ok(await seenOf(b, 'cutout'));
  await a.storage.set(RULES_SEEN_KEY, rules('cutout', 'wrap'));
  assert.equal((await a.cloud.sync({ force: true })).pushed, 1, 'A writes on, above the junk');
  world.tick(0);
  assert.equal((await b.cloud.sync()).accepted, 1);
  assert.ok(await seenOf(b, 'wrap'));
});

test('a sealed row put under another device id does not open (the tag '
  + 'covers the device)', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') }, order: ['turso'] });
  await a.cloud.sync();
  const row = world.db.prepare('SELECT id, data FROM sync').get();
  world.db.prepare('INSERT INTO sync (id, dev, seq, day, data) VALUES (?, ?, 1, ?, ?)')
    .run(row.id, 'ZZZZZZZZZZZ', Math.floor(Date.now() / 86400000), row.data);
  const b = await device(world, { secret: a.sync.secret(), order: ['turso'] });
  await b.cloud.sync();
  assert.equal(b.sync.status().devices, 2, 'B and A only: the copy under another id was refused');
});

test('pushes are not more often than minPushMs, unless forced; and only '
  + 'when something changed', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('a') }, minPushMs: 60000 });
  assert.equal((await a.cloud.push()).ok, 2);
  await a.storage.set(RULES_SEEN_KEY, rules('a', 'b'));
  assert.equal((await a.cloud.push()).skipped, 'soon');
  world.tick(10000);
  assert.deepEqual([(await a.cloud.push({ force: true })).ok], [2]);
  assert.equal((await a.cloud.push({ force: true })).skipped, 'current');
});

test('a device without data, or without the cloud way, pushes nothing', async () => {
  const world = await servers().make();
  const empty = await device(world);
  assert.equal((await empty.cloud.push({ force: true })).skipped, 'empty');
  await empty.sync.disable({ cloud: true });
  assert.equal((await empty.cloud.push({ force: true })).skipped, 'off');
  assert.deepEqual(await empty.cloud.sync(), { accepted: 0, pushed: 0, ok: false });
  assert.equal(empty.cloud.status().on, false);
});

test('a new secret means a new group: the keys and what was seen are forgotten', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('one') } });
  const b = await device(world, { data: { [RULES_SEEN_KEY]: rules('two') } });
  await a.cloud.sync();
  await b.cloud.sync();
  assert.equal(a.sync.status().devices, 1, 'different secrets: strangers');
  await b.sync.enable({ cloud: true, secret: a.sync.secret() });
  world.tick(10000);
  await b.cloud.sync();
  assert.equal(b.sync.status().devices, 2);
  assert.ok(await seenOf(b, 'one'));
});

test('erase: deleted where a player may delete, left to expire where not, '
  + 'then forgotten', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') } });
  await a.cloud.sync();
  const result = await a.cloud.erase();
  assert.equal(result.forgotten, true);
  assert.deepEqual(result.servers, [
    { name: 'supabase-asia', removed: true },
    { name: 'turso-asia', removed: false, reason: 'expires' }]);
  assert.equal(world.supa.groups.size, 0);
  assert.equal(a.sync.secret(), null);
  assert.equal(a.sync.cloudOn(), false);
  const kept = world.db.prepare('SELECT COUNT(*) c FROM sync').get().c;
  assert.equal(kept > 0, true, 'Turso keeps ciphertext');
});

test('erase while the deleting server is unreachable forgets nothing, so it '
  + 'can be tried again', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('cutout') } });
  await a.cloud.sync();
  world.flags.supabaseDown = true;
  const result = await a.cloud.erase();
  assert.equal(result.forgotten, false);
  assert.equal(result.servers[0].reason, 'network');
  assert.notEqual(a.sync.secret(), null);
  world.flags.supabaseDown = false;
  assert.equal((await a.cloud.erase()).forgotten, true);
});

test('events tell what the cloud is doing, and syncs do not overlap', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('x') } });
  const events = [];
  a.cloud.onEvent(event => events.push(`${event.type}:${event.state}`));
  const [one, two] = await Promise.all([a.cloud.sync(), a.cloud.sync()]);
  assert.deepEqual(one, two, 'the second call got the running one');
  assert.deepEqual(events, ['cloud:syncing', 'cloud:ok']);
  world.flags.supabaseDown = true;
  world.flags.tursoDown = true;
  await a.cloud.sync();
  assert.deepEqual(events.slice(-2), ['cloud:syncing', 'cloud:failed']);
});

test('without backends the cloud way is not available', async () => {
  const sync = createSync({ storage: memoryStorage() });
  await sync.init();
  await sync.enable({ cloud: true });
  const cloud = createCloud({ sync, backends: [] });
  assert.equal(cloud.available(), false);
  assert.equal(cloud.on(), false);
  assert.deepEqual(await cloud.sync(), { accepted: 0, pushed: 0, ok: false });
});

test('a slice too big even after shrinking is not sent, and says so', async () => {
  const world = await servers().make();
  const a = await device(world, { data: { [RULES_SEEN_KEY]: rules('x') } });
  const records = {};
  for (let i = 0; i < 3000; i++) { // records that stay records: nothing can shrink them
    records[String(20100101 + i)] = { solved: true, time: Math.random() * 1000, n: Math.random() };
  }
  await a.storage.set('zip_gotd_v2', JSON.stringify({ v: 2, a: records, n: 3000 }));
  const result = await a.cloud.push({ force: true });
  assert.equal(result.skipped, 'toobig');
  assert.equal(a.cloud.status().error, 'toobig');
  assert.equal(world.supa.groups.size, 0, 'nothing was sent');
});
