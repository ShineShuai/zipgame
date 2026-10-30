import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOTD_KEY, STATS_KEY } from '../../src/features/stats-store.js';
import { UNLOCK_KEY } from '../../src/features/unlock.js';
import { RULES_SEEN_KEY } from '../../src/features/rules-seen.js';
import { isDev } from '../../src/core/sync/slice.js';
import { SECRET_BYTES } from '../../src/core/sync/words.js';
import { createSync, FOREIGN_KEY, IDENTITY_KEY } from '../../src/platform/sync/engine.js';
import { memoryStorage } from './helpers.js';

const json = value => JSON.stringify(value);
const OFF_STATUS = { enabled: false, p2p: false, cloud: false, dev: null, devices: 0 };
const b2 = 'BBBBBBBBBBB';
const unlockCopy = (over = {}) => ({
  v: 1, unlocked: {}, tokens: 0, choices: 0, played: [], active: null, ...over,
});
const rules = (...ids) => json({ v: 1, seen: Object.fromEntries(ids.map(id => [id, true])) });

async function device(initial = {}, options = {}) {
  const storage = memoryStorage(initial);
  const sync = createSync({ storage, ...options });
  await sync.init();
  return { storage, sync };
}

// every device tells every other what it has, until nobody learns anything new
async function settle(devices, order = x => x) {
  for (let round = 0; round < 5; round++) {
    let moved = 0;
    for (const from of order(devices)) {
      await from.sync.refresh();
      for (const to of order(devices)) {
        if (to === from) continue;
        moved += (await to.sync.receive(from.sync.slicesFor(to.sync.have()))).accepted;
      }
    }
    if (!moved) return;
  }
}

test('OFF BY DEFAULT: a device that never enabled sync stores nothing, sees '
  + 'nothing, tells nothing', async () => {
  const { storage, sync } = await device({ [RULES_SEEN_KEY]: rules('a') });
  const local = { v: 1, seen: { a: true } };
  assert.deepEqual(sync.status(), OFF_STATUS);
  assert.equal(sync.view(RULES_SEEN_KEY, local), local, 'the very same object comes back');
  assert.equal(sync.view('zip_unrelated', local), local);
  assert.equal(await sync.refresh(), null);
  assert.deepEqual(sync.slicesFor({}), []);
  assert.equal(sync.secret(), null);
  assert.deepEqual(await sync.receive([{ v: 1, dev: 'BBBBBBBBBBB', seq: 1, keys: {} }]),
    { accepted: 0, ignored: 1 });
  let told = 0;
  sync.onLocalChange(() => told++);
  const wrapped = sync.wrap(storage);
  await wrapped.set(RULES_SEEN_KEY, rules('b'));
  assert.equal(told, 0);
  assert.equal((await storage.get(RULES_SEEN_KEY)).value, rules('b'),
    'the write itself went through');
  assert.deepEqual([...storage.raw.keys()], [RULES_SEEN_KEY], 'no sync key was made');
});

test('enable() is the player\'s choice: it makes the identity once, and it '
  + 'survives a reload', async () => {
  const { storage, sync } = await device();
  await sync.enable({ p2p: true });
  const first = sync.status();
  assert.deepEqual([first.enabled, first.p2p, first.cloud, first.devices], [true, true, false, 1]);
  assert.ok(isDev(first.dev));
  assert.equal(sync.secret(), null, 'a secret is for the cloud only');
  await sync.enable({ p2p: true });
  assert.equal(sync.status().dev, first.dev);

  const again = createSync({ storage });
  await again.init();
  assert.deepEqual(again.status(), first);
});

test('the cloud way makes a 10-byte secret, once, and keeps it', async () => {
  const { storage, sync } = await device();
  await sync.enable({ cloud: true });
  const secret = sync.secret();
  assert.equal(secret.length, SECRET_BYTES);
  await sync.enable({ cloud: true, p2p: true });
  assert.deepEqual(sync.secret(), secret);
  const again = createSync({ storage });
  await again.init();
  assert.deepEqual(again.secret(), secret);
  assert.equal(again.status().cloud, true);
});

test('disable() stops one way or all; leave() removes everything', async () => {
  const { storage, sync } = await device();
  await sync.enable({ p2p: true, cloud: true });
  await sync.disable({ p2p: true });
  assert.deepEqual([sync.status().p2p, sync.status().cloud, sync.enabled()], [false, true, true]);
  await sync.disable();
  assert.equal(sync.enabled(), false);
  assert.ok(storage.raw.has(IDENTITY_KEY), 'identity stays, to be turned on again');
  await sync.enable({ p2p: true });
  assert.equal(sync.enabled(), true);
  await sync.leave();
  assert.deepEqual(sync.status(), OFF_STATUS);
  assert.ok(!storage.raw.has(IDENTITY_KEY) && !storage.raw.has(FOREIGN_KEY));
});

test('a broken identity record is ignored: the device is simply off', async () => {
  for (const junk of ['not json', '{}', '[]', json({ v: 1, dev: 'x', seq: 0 }),
    json({ v: 1, dev: 'AAAAAAAAAAA', seq: -1, digest: '', p2p: true, cloud: false, secret: null }),
    json({ v: 1, dev: 'AAAAAAAAAAA', seq: 0, digest: '', p2p: true, cloud: true,
      secret: 'short' })]) {
    const { sync } = await device({ [IDENTITY_KEY]: junk });
    assert.equal(sync.enabled(), false, junk);
  }
});

test('refresh(): seq grows with each change of the own copy, not with a page load', async () => {
  const { storage, sync } = await device({ [RULES_SEEN_KEY]: rules('a') });
  await sync.enable({ p2p: true });
  const one = await sync.refresh();
  assert.equal(one.seq, 1);
  assert.equal((await sync.refresh()).seq, 1, 'nothing changed');
  await storage.set(RULES_SEEN_KEY, rules('a', 'b'));
  assert.equal((await sync.refresh()).seq, 2);

  const reload = createSync({ storage });
  await reload.init();
  assert.equal((await reload.refresh()).seq, 2, 'a new page load with the same data: same seq');
  await storage.set(UNLOCK_KEY, json(unlockCopy({ tokens: 1 })));
  assert.equal((await reload.refresh()).seq, 3);
});

test('the slice holds cleaned copies of the synced keys only, and no game in '
  + 'progress', async () => {
  const { sync } = await device({
    [UNLOCK_KEY]: json(unlockCopy({ tokens: 1, active: { id: 'a', size: 7 } })),
    [RULES_SEEN_KEY]: rules('a'),
    [GOTD_KEY]: 'not json',
    zip_theme: '"dark"',
    zip_playlog_v2: '[1,2,3]',
  });
  await sync.enable({ p2p: true });
  const slice = await sync.refresh();
  assert.deepEqual(Object.keys(slice.keys).sort(), [RULES_SEEN_KEY, UNLOCK_KEY].sort());
  assert.equal(slice.keys[UNLOCK_KEY].active, null);
  assert.equal(slice.keys[UNLOCK_KEY].tokens, 1);
});

test('receive(): only newer slices of other devices; nothing from itself or '
  + 'from a bad slice', async () => {
  const { sync } = await device();
  await sync.enable({ p2p: true });
  const mine = sync.status().dev;
  const from = (dev, seq, keys = {}) => ({ v: 1, dev, seq, keys });
  assert.deepEqual(await sync.receive([from('BBBBBBBBBBB', 2)]), { accepted: 1, ignored: 0 });
  assert.deepEqual(await sync.receive([from('BBBBBBBBBBB', 2), from('BBBBBBBBBBB', 1)]),
    { accepted: 0, ignored: 2 });
  assert.deepEqual(await sync.receive([from('BBBBBBBBBBB', 3)]), { accepted: 1, ignored: 0 });
  assert.deepEqual(await sync.receive([from(mine, 9), { v: 1 }, null, 'x', from('short', 1)]),
    { accepted: 0, ignored: 5 });
  assert.deepEqual(await sync.receive('nonsense'), { accepted: 0, ignored: 0 });
  assert.equal(sync.status().devices, 2);
  assert.deepEqual(sync.have()[mine], 0);
  assert.equal(sync.have().BBBBBBBBBBB, 3);
});

test('receive(): the group has room for maxDevices; a known device may always '
  + 'update', async () => {
  const { sync } = await device({}, { maxDevices: 3 });
  await sync.enable({ p2p: true });
  const from = (dev, seq) => ({ v: 1, dev, seq, keys: {} });
  assert.equal((await sync.receive([from('BBBBBBBBBBB', 1), from('CCCCCCCCCCC', 1)])).accepted, 2);
  assert.equal((await sync.receive([from('DDDDDDDDDDD', 1)])).accepted, 0, 'a fourth device');
  assert.equal((await sync.receive([from('CCCCCCCCCCC', 2)])).accepted, 1);
});

test('receive(): what is not one of the synced keys, or not valid, is dropped', async () => {
  const { sync } = await device();
  await sync.enable({ p2p: true });
  await sync.receive([{ v: 1, dev: 'BBBBBBBBBBB', seq: 1, keys: {
    [UNLOCK_KEY]: unlockCopy({ tokens: 2 }),
    [RULES_SEEN_KEY]: { v: 9 },
    zip_theme: 'dark',
    zip_sync: { v: 1, dev: 'evil' },
  } }]);
  const [slice] = sync.slicesFor({});
  assert.deepEqual(Object.keys(slice.keys), [UNLOCK_KEY]);
});

test('the other devices\' slices are kept over a reload, and fire onChange', async () => {
  const { storage, sync } = await device();
  await sync.enable({ p2p: true });
  let changes = 0;
  const stop = sync.onChange(() => changes++);
  const keys = { [UNLOCK_KEY]: unlockCopy({ tokens: 2 }) };
  await sync.receive([{ v: 1, dev: b2, seq: 4, keys }]);
  assert.equal(changes, 1);
  await sync.receive([{ v: 1, dev: 'BBBBBBBBBBB', seq: 4, keys: {} }]);
  assert.equal(changes, 1, 'nothing new, nothing told');
  stop();
  await sync.receive([{ v: 1, dev: 'BBBBBBBBBBB', seq: 5, keys: {} }]);
  assert.equal(changes, 1);

  const again = createSync({ storage });
  await again.init();
  assert.equal(again.have().BBBBBBBBBBB, 5);
  assert.equal(again.status().devices, 2);
});

test('view(): the group\'s value; without sync, or while it is off, the '
  + 'device\'s own', async () => {
  const { sync } = await device();
  const local = unlockCopy({ tokens: 1 });
  await sync.enable({ p2p: true });
  assert.equal(sync.view(UNLOCK_KEY, local), local, 'no other device yet');
  const keys = { [UNLOCK_KEY]: unlockCopy({ tokens: 2 }) };
  await sync.receive([{ v: 1, dev: b2, seq: 1, keys }]);
  assert.equal(sync.view(UNLOCK_KEY, local).tokens, 3);
  assert.equal(sync.view(UNLOCK_KEY, null).tokens, 2, 'no own copy yet');
  assert.equal(sync.view(RULES_SEEN_KEY, null), null, 'nobody has this key');
  assert.equal(local.tokens, 1, 'the own copy is not touched');
  await sync.disable();
  assert.equal(sync.view(UNLOCK_KEY, local), local, 'off: back to the own copy');
});

test('wrap(): tells the writes of synced keys, only while sync is on', async () => {
  const { storage, sync } = await device();
  const wrapped = sync.wrap(storage);
  const told = [];
  sync.onLocalChange(key => told.push(key));
  await wrapped.set(UNLOCK_KEY, '{}');
  await sync.enable({ cloud: true });
  await wrapped.set(UNLOCK_KEY, '{}');
  await wrapped.set('zip_theme', '"dark"');
  await wrapped.set(STATS_KEY, '{}');
  assert.deepEqual(told, [UNLOCK_KEY, STATS_KEY]);
  assert.equal(typeof wrapped.get, 'function');
  assert.equal(typeof wrapped.keys, 'function');
});

test('adoptSecret(): joins another group and forgets the old group\'s slices', async () => {
  const { sync } = await device();
  await sync.enable({ cloud: true });
  await sync.receive([{ v: 1, dev: 'BBBBBBBBBBB', seq: 1, keys: {} }]);
  const next = new Uint8Array(SECRET_BYTES).fill(7);
  assert.equal(await sync.adoptSecret(next), true);
  assert.deepEqual(sync.secret(), next);
  assert.equal(sync.status().devices, 1);
  assert.equal(await sync.adoptSecret(new Uint8Array(3)), false);
});

test('three devices that only trade slices, in any order and with repeats, '
  + 'end up equal', async () => {
  const stat = (n, mean) => [n, mean, n * 2, [mean]];
  const make = async (copies) => {
    const d = await device(copies);
    await d.sync.enable({ p2p: true });
    return d;
  };
  const devices = [
    await make({ [UNLOCK_KEY]: json(unlockCopy({ tokens: 2, unlocked: { a: 5 } })),
      [STATS_KEY]: json({ v: 2, t: { s: stat(3, 10) }, d: {}, b: {} }),
      [RULES_SEEN_KEY]: rules('a') }),
    await make({ [UNLOCK_KEY]: json(unlockCopy({ tokens: -1, unlocked: { b: 6 } })),
      [STATS_KEY]: json({ v: 2, t: { s: stat(2, 20) }, d: {}, b: {} }),
      [RULES_SEEN_KEY]: rules('b') }),
    await make({ [UNLOCK_KEY]: json(unlockCopy({ choices: 4 })),
      [STATS_KEY]: json({ v: 2, t: { s: stat(5, 5) }, d: {}, b: {} }) }),
  ];
  const shuffle = list => [...list].sort(() => Math.random() - 0.5);
  await settle(devices, shuffle);
  await settle(devices, shuffle); // a second round: repeats change nothing
  const views = async key => Promise.all(devices.map(async d => {
    const raw = await d.storage.get(key);
    return d.sync.view(key, raw ? JSON.parse(raw.value) : null);
  }));
  for (const key of [UNLOCK_KEY, STATS_KEY, RULES_SEEN_KEY]) {
    const [first, ...rest] = await views(key);
    for (const other of rest) assert.deepEqual(other, first, key);
  }
  const [unlock] = await views(UNLOCK_KEY);
  assert.deepEqual([unlock.tokens, unlock.choices, unlock.unlocked], [1, 4, { a: 5, b: 6 }]);
  const [stats] = await views(STATS_KEY);
  assert.equal(stats.t.s[0], 10);
});

test('slicesFor(): a device gets what it lacks, never what it has; garbage in '
  + '`have` means nothing', async () => {
  const a = await device({ [RULES_SEEN_KEY]: rules('a') });
  const b = await device({ [RULES_SEEN_KEY]: rules('b') });
  await a.sync.enable({ p2p: true });
  await b.sync.enable({ p2p: true });
  await a.sync.refresh();
  await b.sync.refresh();
  await a.sync.receive(b.sync.slicesFor(a.sync.have()));
  const forB = a.sync.slicesFor(b.sync.have());
  assert.deepEqual(forB.map(s => s.dev), [a.sync.status().dev]);
  const own = a.sync.status().dev;
  for (const junk of [null, 'x', [], { [own]: 'many' }, { [own]: -1 }]) {
    assert.equal(a.sync.slicesFor(junk).length, 2);
  }
  assert.equal(a.sync.slicesFor(a.sync.have()).length, 0);
});
