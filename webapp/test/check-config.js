// Fails if a public Turso token in config.js can do more than read + insert into `submit` (and, since the behaviour upload, into `play`),
// or if the behaviour upload is configured towards anything but Turso / Cloudflare backends that exist.
import assert from 'node:assert/strict';
import { LEADERBOARD, BEHAVIOUR } from '../src/config.js';

const base = [{ t: null, a: ['data_read'] }, { t: ['submit'], a: ['data_add'] }];
const want = [base, [...base, { t: ['play'], a: ['data_add'] }]]; // the token made before the behaviour upload, and the one made for it
for (const [id, backend] of Object.entries(LEADERBOARD.backends)) {
  if (backend.type === 'turso' && backend.key) {
    const { perm } = JSON.parse(Buffer.from(backend.key.split('.')[1], 'base64url').toString());
    assert.ok(want.some(w => JSON.stringify(w) === JSON.stringify(perm)), `${id}: token permissions differ from read + insert-only (submit, play)`);
  }
  assert.ok(!/sb_secret_|service_role/.test(JSON.stringify(backend)), `${id}: secret key in config.js`);
}
for (const id of new Set([BEHAVIOUR.primary, BEHAVIOUR.backup])) {
  assert.ok(LEADERBOARD.backends[id], `BEHAVIOUR: unknown backend id ${id}`);
  assert.ok(['turso', 'cloudflare'].includes(LEADERBOARD.backends[id].type), `BEHAVIOUR: ${id} is a ${LEADERBOARD.backends[id].type} backend (only turso and cloudflare receive behaviour rows)`);
}
assert.equal(typeof BEHAVIOUR.enabled, 'boolean', 'BEHAVIOUR.enabled must be true or false');
const [lo, hi] = BEHAVIOUR.localSizes;
assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 2 && hi >= lo && hi <= 16, 'BEHAVIOUR.localSizes must be [min, max] within 2..16');
console.log('config ok');
