// Fails if a public Turso token in config.js can do more than read + insert into `submit` (and, since the behaviour upload, into `play`),
// or if the behaviour upload is configured towards anything but Turso / Cloudflare backends that exist.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { LEADERBOARD, BEHAVIOUR, SOLID_RELEASE, THEMES } from '../src/config.js';
import { releaseDays } from '../src/features/solid-release.js';
import { validDigits } from '../src/themes/calendar.js';

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
releaseDays(SOLID_RELEASE); // throws on a bad date or day count
assert.ok(/^(\.\.?\/)+[\w-]+\/$|^https:\/\/[^/]+\/(?:[\w-]+\/)*$/.test(THEMES.base), 'THEMES.base must be a folder relative to the page (ending in /) or an https URL');
assert.ok(/^[\w-]+\.json$/.test(THEMES.pool), 'THEMES.pool must be the file name of the manifest (themes/tools/build-site.mjs writes it)');
assert.ok(Number.isInteger(THEMES.trialMs) && THEMES.trialMs >= 60000 && THEMES.trialMs <= 86400000, 'THEMES.trialMs must be a whole number of ms, from one minute to a day');
assert.ok(validDigits(THEMES.digits), 'THEMES.digits must be four different digits (0-9): the secret of the offer days');

// The Content-Security-Policy of each page (a <meta> tag: GitHub Pages sends no headers) must let the page do what it does and nothing
// more: scripts only from the page's own files plus its hashed inline scripts, and calls only to the backends of config.js.
const urlsOf = value => (typeof value === 'string' ? (/^https?:\/\//.test(value) ? [new URL(value).origin] : [])
  : value && typeof value === 'object' ? Object.values(value).flatMap(urlsOf) : []);
const origins = [...new Set([...urlsOf(LEADERBOARD), ...urlsOf(BEHAVIOUR), ...urlsOf(THEMES)])];
// The co-op trial can be removed with its folder, so its brokers (src/coop/config.js) are read as
// text, not imported. They are reached from the play page only.
const coopConfig = new URL('../src/coop/config.js', import.meta.url);
const brokerUrls = existsSync(coopConfig)
  ? [...readFileSync(coopConfig, 'utf8').matchAll(/url: '(wss?:\/\/[^']+)'/g)].map(match => match[1])
  : [];
const brokerOrigins = brokerUrls.map(url => new URL(url).origin);
assert.ok(!brokerUrls.length || brokerUrls.length >= 2, 'SIGNAL_BROKERS: one broker is no backup, list two');
for (const url of brokerUrls) {
  assert.ok(url.startsWith('wss://'), `SIGNAL_BROKERS: ${url} must be wss:// (a page cannot use ws://)`);
}
const directives = policy => Object.fromEntries(policy.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([name, ...values]) => [name, values]));
const pages = [['index.html', true, brokerOrigins], ['stats.html', true, []], ['design.html', false, []]];
for (const [page, network, extra] of pages) {
  const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(meta, `${page}: no Content-Security-Policy <meta> tag`);
  assert.ok(html.indexOf(meta[0]) < html.search(/<script|<link/), `${page}: the policy must come before the first script or stylesheet`);
  const csp = directives(meta[1]);
  assert.deepEqual(csp['script-src'].filter(v => !v.startsWith("'sha256-")), ["'self'"], `${page}: script-src allows more than 'self' and hashes`);
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const hash = `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
    assert.ok(csp['script-src'].includes(hash), `${page}: an inline script changed: put ${hash} into script-src`);
  }
  assert.equal(csp['script-src'].filter(v => v.startsWith("'sha256-")).length, [...html.matchAll(/<script>/g)].length, `${page}: script-src hashes a script that is not there`);
  for (const bad of ["'unsafe-eval'", "'unsafe-inline'"]) assert.ok(!csp['script-src'].includes(bad), `${page}: script-src has ${bad}`);
  const expected = network ? [...origins, ...extra].sort() : [];
  assert.deepEqual(csp['connect-src'].filter(v => v !== "'self'").sort(), expected, `${page}: connect-src must list exactly the origins of config.js (and the brokers of src/coop/config.js on index.html)`);
  for (const name of ['object-src', 'base-uri']) assert.ok(csp[name], `${page}: ${name} missing`);
}
console.log('config ok');
