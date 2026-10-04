// Fails if a public Turso token in config.js can do more than read + insert into `submit`.
import assert from 'node:assert/strict';
import { LEADERBOARD } from '../src/config.js';

const want = [{ t: null, a: ['data_read'] }, { t: ['submit'], a: ['data_add'] }];
for (const [id, backend] of Object.entries(LEADERBOARD.backends)) {
  if (backend.type === 'turso' && backend.key) {
    const { perm } = JSON.parse(Buffer.from(backend.key.split('.')[1], 'base64url').toString());
    assert.deepEqual(perm, want, `${id}: token permissions differ from read + insert-only`);
  }
  assert.ok(!/sb_secret_|service_role/.test(JSON.stringify(backend)), `${id}: secret key in config.js`);
}
console.log('config ok');
