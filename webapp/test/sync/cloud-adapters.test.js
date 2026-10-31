// The two cloud adapters as the page uses them: Supabase against a model of sync.sql, and the
// selection of backends from the config. (Turso's rows and trigger are run for real by
// server/turso/sync.test.mjs and cloud.test.js.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudBackends } from '../../src/platform/sync/cloud/backends.js';
import { CloudError, fetchJson } from '../../src/platform/sync/cloud/http.js';
import { supabaseCloud } from '../../src/platform/sync/cloud/supabase.js';
import { tursoCloud } from '../../src/platform/sync/cloud/turso.js';
import { fakeSupabase } from './helpers.js';

const ID = 'a1'.repeat(16);
const AUTH = 'A'.repeat(43);
const DEV = 'AAAAAAAAAAA';
const data = n => `sealed-${n}`.padEnd(40, 'x');
const codeOf = async fn => {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof CloudError, String(error));
    return error.code;
  }
  return 'no error';
};
const put = (cloud, over = {}) =>
  cloud.put({ id: ID, auth: AUTH, dev: DEV, seq: 1, data: data(1), ...over });
const ticking = () => {
  let t = 0;
  return () => (t += 10000); // every call is ten seconds later
};

function supabase(options = {}) {
  const fake = fakeSupabase(options);
  const cloud = supabaseCloud(fake.entry, 'supabase-asia', { fetchFn: fake.fetchFn });
  return { ...fake, cloud };
}

test('supabase: put, get, newer-only get, and a stale put changes nothing', async () => {
  const { cloud } = supabase();
  assert.equal(await put(cloud), 'stored');
  assert.deepEqual(await cloud.get({ id: ID }), [{ dev: DEV, seq: 1, data: data(1) }]);
  assert.deepEqual(await cloud.get({ id: ID, have: { [DEV]: 1 } }), []);
  assert.equal((await cloud.get({ id: ID, have: { BBBBBBBBBBB: 9 } })).length, 1);
  assert.deepEqual(await cloud.get({ id: 'f'.repeat(32) }), [], 'a group nobody uses');
  const slow = supabase({ now: ticking() });
  await put(slow.cloud, { seq: 5, data: data(5) });
  assert.equal(await put(slow.cloud, { seq: 3, data: data(3) }), 'stale');
  assert.equal((await slow.cloud.get({ id: ID }))[0].seq, 5);
});

test('supabase: only the holder of the auth value writes or deletes; reading needs the id',
  async () => {
    const { cloud, groups } = supabase();
    await put(cloud);
    const other = 'B'.repeat(43);
    assert.equal(await codeOf(() => put(cloud, { auth: other, dev: 'CCCCCCCCCCC' })),
      'unauthorized');
    assert.equal(await codeOf(() => cloud.remove({ id: ID, auth: other })), 'unauthorized');
    assert.equal(groups.get(ID).slices.size, 1);
    assert.equal((await cloud.get({ id: ID })).length, 1);
    assert.equal(await cloud.remove({ id: ID, auth: AUTH }), true);
    assert.equal(await cloud.remove({ id: ID, auth: AUTH }), false, 'nothing left to delete');
    assert.deepEqual(await cloud.get({ id: ID }), []);
  });

test('supabase: the server\'s refusals become codes: rejected, busy, closed', async () => {
  const { cloud } = supabase();
  assert.equal(await codeOf(() => put(cloud, { id: 'short' })), 'rejected');
  assert.equal(await codeOf(() => put(cloud, { data: 'tiny' })), 'rejected');
  await put(cloud);
  assert.equal(await codeOf(() => put(cloud, { seq: 2, data: data(2) })), 'busy',
    'twice within 5 seconds');
  const full = supabase({ maxGroups: 0 });
  assert.equal(await codeOf(() => put(full.cloud)), 'closed');
  const eight = supabase();
  for (let i = 0; i < 8; i++) await put(eight.cloud, { dev: `DEVICE0000${i}` });
  assert.equal(await codeOf(() => put(eight.cloud, { dev: 'DEVICE00009' })), 'rejected',
    'a ninth device');
});

test('supabase: a wrong key, a dead network, an error page, nonsense: codes, never a crash',
  async () => {
    const fake = fakeSupabase();
    const wrong = supabaseCloud({ ...fake.entry, key: 'other' }, 'x', { fetchFn: fake.fetchFn });
    assert.equal(await codeOf(() => wrong.get({ id: ID })), 'unauthorized');
    const reply = (ok, status, json) => async () => ({ ok, status, json });
    const get = fetchFn =>
      codeOf(() => supabaseCloud(fake.entry, 'x', { fetchFn }).get({ id: ID }));
    assert.equal(await get(async () => { throw new Error('offline'); }), 'network');
    const html = async () => { throw new Error('html'); };
    assert.equal(await get(reply(false, 502, html)), 'network');
    assert.equal(await get(reply(true, 200, async () => ({ what: 1 }))), 'network');
    const bad = supabaseCloud(fake.entry, 'x',
      { fetchFn: reply(true, 200, async () => ({ ok: false })) });
    assert.equal(await codeOf(() => put(bad)), 'network');
  });

test('supabase: rows that are not slices are left out of get', async () => {
  const fake = fakeSupabase();
  const liar = async () => ({ ok: true, status: 200, json: async () => ({ slices: [
    { dev: DEV, seq: 1, data: data(1) }, { dev: 'bad', seq: 1, data: data(1) },
    { dev: DEV, seq: 'x', data: data(1) }, { dev: DEV, seq: 2, data: 'not base64url!' },
    { dev: DEV, seq: 3, data: 'x'.repeat(24001) }, null, 5,
  ] }) });
  const cloud = supabaseCloud(fake.entry, 'x', { fetchFn: liar });
  assert.equal((await cloud.get({ id: ID })).length, 1);
});

test('supabase: a POST to the function with the anon key (keepalive when asked)', async () => {
  const { cloud, calls } = supabase();
  await put(cloud, { keepalive: true });
  await cloud.get({ id: ID });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true);
  assert.equal(calls[1].init.keepalive, undefined);
  assert.equal(calls[0].init.headers.apikey, 'anon-key');
  assert.deepEqual(Object.keys(calls[0].args).sort(),
    ['p_auth', 'p_data', 'p_dev', 'p_id', 'p_seq']);
});

test('a slow server is cut off with a "network" error', async () => {
  const slow = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  assert.equal(await codeOf(() => fetchJson(slow, 'https://x', {}, 20)), 'network');
  const cloud = supabaseCloud({ url: 'https://x', key: 'k' }, 'x',
    { fetchFn: slow, timeoutMs: 20 });
  assert.equal(await codeOf(() => cloud.get({ id: ID })), 'network');
});

test('only configured supabase and turso entries are cloud backends, in the given order', () => {
  const entries = {
    a: { type: 'supabase', url: 'https://a', key: 'k' },
    b: { type: 'turso', url: 'https://b', key: 'k' },
    c: { type: 'cloudflare', url: 'https://c' },
    d: { type: 'turso', url: 'https://d' },
    e: { type: 'supabase', key: 'k' },
  };
  const names = cfg => cloudBackends(cfg, entries).map(backend => backend.name);
  assert.deepEqual(names({ primary: 'a', second: 'b' }), ['a', 'b']);
  assert.deepEqual(names({ primary: 'b', second: 'a' }), ['b', 'a']);
  assert.deepEqual(names({ primary: 'a', second: 'a' }), ['a']);
  assert.deepEqual(names({ primary: 'c', second: 'd' }), []);
  assert.deepEqual(names({ primary: 'e', second: 'zzz' }), []);
  assert.deepEqual(names({}), []);
  assert.deepEqual(names(undefined), []);
  assert.deepEqual(cloudBackends({ primary: 'a' }, entries).map(b => b.kind), ['supabase']);
  assert.equal(typeof tursoCloud, 'function');
});
