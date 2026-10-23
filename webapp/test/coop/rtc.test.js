import test from 'node:test';
import assert from 'node:assert/strict';
import { ICE_SERVERS } from '../../src/coop/config.js';
import { STUN_URL, describeRoute, probeText } from '../../src/coop/rtc.js';

const seen = (over = {}) => ({ byAddress: new Map(), types: {}, ...over });
const stats = reports => new Map(reports.map(report => [report.id, report]));
const pair = (local, remote, extra = {}) => stats([
  { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
  { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
  { id: 'L', type: 'local-candidate', address: '203.0.113.5', port: 5000, ...local },
  { id: 'R', type: 'remote-candidate', ...remote },
  ...(extra.more ?? []),
]);

test('every configured STUN url is stun:host[:port], never stun://', () => {
  assert.ok(ICE_SERVERS.length >= 2);
  for (const { urls } of ICE_SERVERS) {
    assert.match(urls, STUN_URL);
  }
  const bad = ['stun://a.b:3478', 'stun:://a.b', 'stun:', 'a.b:3478', 'stun:a.b/x', 'turn:a.b'];
  for (const url of bad) {
    assert.doesNotMatch(url, STUN_URL, url);
  }
});

test('same network: host/host, no STUN involved', () => {
  const text = describeRoute(pair({ candidateType: 'host' }, { candidateType: 'host' }), seen());
  assert.equal(text, 'ice host/host, no STUN needed');
});

test('srflx: the server comes from the stats url, else from the gathering events', () => {
  const local = { candidateType: 'srflx', url: 'stun:stun.l.google.com:19302' };
  assert.equal(describeRoute(pair(local, { candidateType: 'srflx' }), seen()),
    'ice srflx/srflx via stun.l.google.com:19302');
  const byAddress = new Map([['203.0.113.5:5000', 'stun:stun.cloudflare.com:3478']]);
  assert.equal(describeRoute(pair({ candidateType: 'srflx' }, { candidateType: 'srflx' }),
    seen({ byAddress })), 'ice srflx/srflx via stun.cloudflare.com:3478');
  assert.match(describeRoute(pair({ candidateType: 'srflx' }, { candidateType: 'srflx' }), seen()),
    /not reported by this browser/);
});

test('a pair is also found without a transport report (Firefox: selected / nominated)', () => {
  const reports = stats([
    {
      id: 'P', type: 'candidate-pair', nominated: true, state: 'succeeded',
      localCandidateId: 'L', remoteCandidateId: 'R',
    },
    { id: 'L', type: 'local-candidate', candidateType: 'prflx' },
    { id: 'R', type: 'remote-candidate', candidateType: 'host' },
  ]);
  assert.equal(describeRoute(reports, seen()), 'ice prflx/host');
});

test('no chosen pair: the state and what was gathered', () => {
  assert.equal(describeRoute(stats([]), seen({ types: { host: 2, srflx: 1 } }), 'checking'),
    'ice checking · gathered host 2 srflx 1');
  assert.equal(describeRoute(stats([]), seen()), 'ice no route · gathered none');
});

test('probe line: one entry per server, x = no answer', () => {
  assert.equal(probeText([
    { url: 'stun:stun.cloudflare.com:3478', ms: 41 },
    { url: 'stun:stun.l.google.com:19302', ms: null },
    { url: 'stun:stun.nextcloud.com:443', ms: 87 },
  ]), 'stun cloudflare.com 41ms · l.google.com x · nextcloud.com 87ms');
});
