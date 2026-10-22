import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFromText, decodeCode, encodeCode } from '../../src/coop/invite.js';

const SDP = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:Zq3x', 'a=ice-pwd:0123456789abcdefABCDEF', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

test('a code carries the session description and its kind', async () => {
  for (const kind of ['o', 'a']) {
    const code = await encodeCode(kind, SDP);
    assert.match(code, /^[oa][zr][A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeCode(code), { kind, sdp: SDP });
  }
});

test('the code is shorter than the description it carries', async () => {
  assert.ok((await encodeCode('o', SDP)).length < SDP.length);
});

test('a whole link, or a code broken by a chat app, still decodes', async () => {
  const code = await encodeCode('o', SDP);
  const link = `https://example.test/play/index.html#coop=${code}`;
  assert.equal(codeFromText(link), code);
  assert.deepEqual(await decodeCode(link), { kind: 'o', sdp: SDP });
  const broken = `${code.slice(0, 20)}\n  ${code.slice(20, 40)} ${code.slice(40)}\n`;
  assert.deepEqual(await decodeCode(broken), { kind: 'o', sdp: SDP });
});

test('anything else is refused with one error', async () => {
  const code = await encodeCode('o', SDP);
  const junk = [
    '', 'hello', 'xz1234', 'oz', 'oz!!!!', 'or@@@', `o${code.slice(1, 12)}`, 'ozAAAA', 'orQUJD',
  ];
  for (const text of junk) {
    await assert.rejects(decodeCode(text), /bad code/, JSON.stringify(text));
  }
});
