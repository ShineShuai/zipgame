// The sync's cloud has a config of its own, apart from the leaderboard's: the averages and the
// behaviour rows keep Turso first, the sync keeps Supabase first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOUR, LEADERBOARD, SYNC } from '../../src/config.js';
import { cloudBackends } from '../../src/platform/sync/cloud/backends.js';

test('the Game-of-Day averages still go to Turso first, whatever the sync does', () => {
  assert.equal(LEADERBOARD.always, 'turso-asia');
  assert.equal(LEADERBOARD.backends['turso-asia'].type, 'turso');
  assert.ok(BEHAVIOUR.enabled !== undefined);
});

test('the sync has its own backends: Supabase primary, Turso second, no id shared', () => {
  const ids = Object.keys(SYNC.cloud.backends);
  assert.ok(ids.length >= 2);
  for (const id of ids) assert.ok(!(id in LEADERBOARD.backends), `${id} is a leaderboard id`);
  assert.equal(SYNC.cloud.backends[SYNC.cloud.primary].type, 'supabase');
  assert.equal(SYNC.cloud.backends[SYNC.cloud.second].type, 'turso');
  assert.ok(SYNC.cloud.minPushMs >= 5000);
});

test('an entry without url or key is left out, so the shipped config uses Supabase alone', () => {
  const used = cloudBackends(SYNC.cloud, SYNC.cloud.backends);
  const configured = Object.entries(SYNC.cloud.backends)
    .filter(([, entry]) => entry.url && entry.key).map(([id]) => id);
  assert.deepEqual(used.map(b => b.name).sort(), configured.sort());
  assert.equal(used[0].kind, 'supabase', 'the primary comes first');
});

test('the sync does not reuse the leaderboard\'s tokens or keys', () => {
  const leaderboardKeys = new Set(Object.values(LEADERBOARD.backends).map(b => b.key));
  for (const [id, entry] of Object.entries(SYNC.cloud.backends)) {
    if (entry.type === 'turso') {
      assert.ok(!leaderboardKeys.has(entry.key) || entry.key === '', `${id} reuses a Turso token`);
    }
  }
});
