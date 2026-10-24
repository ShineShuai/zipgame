import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFromText, decodeCode, encodeCode } from '../../src/coop/invite.js';
import { packSdp, unpackSdp } from '../../src/coop/compact.js';

const PRINT = `sha-256 ${'0F:'.repeat(31)}A0`;
const NAME = '902303ad-b495-4064-85ea-d1b68695b99c.local';
const MDNS_HOST = `a=candidate:1 1 udp 2113937151 ${NAME} 54321 typ host`;
const SRFLX = 'a=candidate:3 1 udp 1677729535 203.0.113.45 54321 typ srflx raddr 0.0.0.0 rport 0';

// What a browser makes for a data channel, after gathering: `candidates` are its lines.
const sdpWith = (candidates, extra = {}) => [
  'v=0', 'o=- 99 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...candidates,
  `a=ice-ufrag:${extra.ufrag ?? 'aB+/'}`, `a=ice-pwd:${extra.pwd ?? 'Zz09+/Zz09+/Zz09+/Zz09'}`,
  'a=ice-options:trickle', `a=fingerprint:${extra.print ?? PRINT}`,
  `a=setup:${extra.setup ?? 'actpass'}`, 'a=mid:0', 'a=sctp-port:5000', '',
].join('\r\n');

const SDP = sdpWith([MDNS_HOST, SRFLX]);
// A description the compact form cannot hold (a second media section): sent whole, as before.
const ODD = `${SDP}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n`;
const answerOf = sdp => sdp.replace('a=setup:actpass', 'a=setup:active');

test('a description with more than a data channel is sent whole, compressed', async () => {
  for (const kind of ['o', 'a']) {
    const code = await encodeCode(kind, ODD);
    assert.match(code, /^[oa][zr][A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeCode(code), { kind, sdp: ODD });
  }
});

test('the whole-text code is shorter than the description it carries', async () => {
  const code = await encodeCode('o', ODD);
  assert.ok(code.length < ODD.length, `${code.length} < ${ODD.length}`);
});

test('a plain data channel description gets the compact code, a fifth of the size', async () => {
  for (const [kind, sdp] of [['o', SDP], ['a', answerOf(SDP)]]) {
    const code = await encodeCode(kind, sdp);
    assert.match(code, /^[oa]c[A-Za-z0-9_-]+$/);
    assert.ok(code.length < (await encodeCode(kind, ODD)).length / 3, `${code.length}`);
    const { sdp: back } = await decodeCode(code);
    const setup = kind === 'o' ? 'actpass' : 'active';
    assert.ok(back.startsWith('v=0') && back.includes(`a=setup:${setup}`));
  }
});

// What Chrome really makes once gathering is done: m= and c= name the default candidate.
const CHROME = sdpWith([
  `a=candidate:1856 1 udp 2113937151 ${NAME} 56152 typ host generation 0 network-cost 999`,
  'a=candidate:1787 1 udp 1677729535 203.0.113.45 56152 typ srflx raddr 0.0.0.0 rport 0'
  + ' generation 0 network-cost 999',
]).replace('m=application 9', 'm=application 56152').replace('IP4 0.0.0.0', 'IP4 203.0.113.45');

test('the description of a browser that finished gathering gets the compact code too', async () => {
  const code = await encodeCode('o', CHROME);
  assert.match(code, /^oc[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 130, `${code.length}`);
  assert.deepEqual(wanted((await decodeCode(code)).sdp).sort(), wanted(CHROME).sort());
});

test('a whole link, or a code broken by a chat app, still decodes', async () => {
  for (const sdp of [SDP, ODD]) {
    const code = await encodeCode('o', sdp);
    const link = `https://example.test/play/index.html?a=1#c=${code}`;
    assert.equal(codeFromText(link), code);
    assert.equal(codeFromText(link.replace('#c=', '#coop=')), code); // older links
    assert.equal(codeFromText(code), code);
    const want = (await decodeCode(code)).sdp;
    assert.deepEqual(await decodeCode(link), { kind: 'o', sdp: want });
    const broken = `${code.slice(0, 20)}\n  ${code.slice(20, 40)} ${code.slice(40)}\n`;
    assert.deepEqual(await decodeCode(broken), { kind: 'o', sdp: want });
  }
});

test('anything else is refused with one error', async () => {
  const code = await encodeCode('o', ODD);
  const compact = await encodeCode('o', SDP);
  const junk = [
    '', 'hello', 'xz1234', 'oz', 'oz!!!!', 'or@@@', `o${code.slice(1, 12)}`, 'ozAAAA', 'orQUJD',
    'oc', 'ocAAAA', compact.slice(0, -4), `${compact}AAAA`, `oc${compact.slice(2, 30)}`,
  ];
  for (const text of junk) {
    await assert.rejects(decodeCode(text), /bad code/, JSON.stringify(text));
  }
});

// The lines of a description that tell the other side where and how to connect.
const wanted = sdp => sdp.split('\r\n')
  .filter(line => /^a=(ice-ufrag|ice-pwd|fingerprint|setup|candidate)/.test(line))
  .map(line => line.replace(/^a=candidate:\d+ 1 (?:udp|UDP) /, 'a=candidate:')
    .replace(/( typ \w+).*/, '$1'));

test('compact form keeps credentials, fingerprint, addresses, ports and priorities', () => {
  const candidates = [
    MDNS_HOST,
    'a=candidate:2 1 udp 2113937151 192.168.178.20 65535 typ host generation 0 network-cost 10',
    SRFLX,
    'a=candidate:4 1 udp 2113932031 2001:db8:0:0:0:0:0:1 40000 typ host',
    'a=candidate:5 1 UDP 2122252543 fd00:1:2:3:4:5:6:2 1 typ host',
    'a=candidate:6 1 udp 16777215 198.51.100.7 3478 typ relay raddr 0.0.0.0 rport 0',
    'a=candidate:7 1 udp 1694498815 0:0:0:0:0:0:0:1 9 typ srflx raddr 1.2.3.4 rport 5',
  ];
  for (const kind of ['o', 'a']) {
    const sdp = sdpWith(candidates, { setup: kind === 'o' ? 'actpass' : 'active' });
    const bytes = packSdp(kind, sdp);
    assert.deepEqual(wanted(unpackSdp(kind, bytes)).sort(), wanted(sdp).sort());
  }
});

test('compact form: IPv6 written with :: comes back in full, same address', () => {
  const sdp = sdpWith(['a=candidate:1 1 udp 2113937151 2001:db8::1 40000 typ host']);
  assert.ok(unpackSdp('o', packSdp('o', sdp)).includes(' 2001:db8:0:0:0:0:0:1 40000 '));
});

test('compact form: a description it cannot hold exactly is refused (null), never altered', () => {
  const host = 'a=candidate:1 1 udp 2113937151 192.168.1.2 5000 typ host';
  assert.ok(packSdp('o', sdpWith([host])));
  const refused = [
    sdpWith([host.replace(' udp ', ' tcp ')]),
    sdpWith([host.replace('2113937151', '2113937150')]), // not the standard priority formula
    sdpWith([host.replace('192.168.1.2', 'printer.example')]),
    sdpWith([host.replace('192.168.1.2', '999.1.1.1')]),
    sdpWith([host.replace('5000', '70000')]),
    sdpWith([host.replace(' 1 udp', ' 2 udp')]), // component 2
    sdpWith([host], { print: `sha-1 ${'0F:'.repeat(19)}A0` }),
    sdpWith([host], { setup: 'passive' }),
    sdpWith([host], { ufrag: 'ab' }),
    sdpWith([host], { pwd: 'has space in it, no good' }),
    `${sdpWith([host])}a=ice-lite\r\n`,
    ODD,
  ];
  for (const sdp of refused) {
    assert.equal(packSdp('o', sdp), null, sdp);
  }
  assert.equal(packSdp('a', sdpWith([host])), null); // an answer says `active`, not `actpass`
});

test('compact form: bytes that are not a description are refused', () => {
  const good = packSdp('o', sdpWith(['a=candidate:1 1 udp 2113937151 10.0.0.1 5000 typ host']));
  assert.throws(() => unpackSdp('o', good.subarray(0, good.length - 1)));
  assert.throws(() => unpackSdp('o', Uint8Array.from([...good, 0])));
  assert.throws(() => unpackSdp('x', good));
  const badHead = Uint8Array.from(good);
  badHead[good.length - 8] = 15; // the candidate's head byte: 4 address bytes, 2 port, 1 priority
  assert.throws(() => unpackSdp('o', badHead));
});

test('compact form: about a hundred characters for a typical offer', async () => {
  assert.ok((await encodeCode('o', sdpWith([MDNS_HOST]))).length <= 110);
});
