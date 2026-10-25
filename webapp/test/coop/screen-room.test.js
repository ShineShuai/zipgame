import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNAL_BROKERS } from '../../src/coop/config.js';
import { hostRoom, joinRoom } from '../../src/coop/join.js';
import { openScreen } from '../../src/coop/screen.js';
import { createHub } from '../../src/coop/signal.js';
import { EN } from '../../src/coop/texts.js';
import { installFakeDom } from './fake-dom.js';
import { createNetwork, settle, until } from './fake-broker.js';

// The screen, in a fake page, against the real brokers' addresses on a fake network. There is no
// WebRTC in Node, so a connection that is really started fails at once: the screen must say so.
const dom = installFakeDom();
const net = createNetwork(SIGNAL_BROKERS.map(broker => broker.url));
globalThis.WebSocket = net.WebSocket;
const env = {
  stats: {}, saveStats() {}, onClose() {}, isRevealed: () => false,
};
const stubRtc = {
  createInvite: async () => ({ code: 'offer', connection: { close() {} } }),
  acceptReply: async () => {},
  joinInvite: async () => ({ code: 'answer', connection: { close() {} } }),
};
const remaining = () => [...net.brokers.values()].flatMap(broker => [...broker.retained.keys()]);

test('the host\'s screen: link, requests, greeting box, accept, decline, cancel', async () => {
  const screen = openScreen(env);
  dom.click('host');
  await until(() => dom.html().includes('id="coopLink"'), 'the link');
  const link = /value="([^"]+)"/.exec(dom.html())[1];
  assert.match(link, /^https:\/\/x\.test\/zip\/index\.html#j=[A-Za-z0-9_-]{44}$/);
  assert.equal(dom.status(), EN.waitFriend);

  const stages = [];
  const infos = [];
  const guestHub = createHub({ brokers: SIGNAL_BROKERS });
  const guest = await joinRoom({
    hub: guestHub,
    token: link.split('#j=')[1],
    rtc: stubRtc,
    onState: (stage, info) => {
      stages.push(stage);
      infos.push(info);
    },
  });
  await until(() => stages.includes('ready'), 'the guest finds the room');

  dom.typed.set('coopNeedGreeting', true);
  dom.click('need-greeting');
  await until(() => infos.at(-1).needGreeting === true, 'the guest learns a greeting is wanted');

  await guest.ask('Anna <b>&</b>');
  await until(() => dom.html().includes('coop-request'), 'the request on the host\'s screen');
  assert.ok(dom.html().includes('Anna &lt;b>&amp;&lt;/b>') && !dom.html().includes('<b>&'));
  await until(() => stages.includes('seen'), 'the guest is told');

  const id = /data-act="decline" data-id="([^"]+)"/.exec(dom.html())[1];
  dom.click('decline', { id });
  await until(() => stages.at(-1) === 'declined', 'declined');
  assert.ok(!dom.html().includes('coop-request'), 'the card is gone');

  const second = await joinRoom({
    hub: createHub({ brokers: SIGNAL_BROKERS }), token: link.split('#j=')[1], rtc: stubRtc,
  });
  await second.ask('Bea');
  await until(() => dom.html().includes('coop-request'), 'a second request');
  dom.click('accept', { id: /data-act="accept" data-id="([^"]+)"/.exec(dom.html())[1] });
  assert.equal(dom.status(), EN.connecting);
  await until(() => dom.failed(), 'the connection that cannot be made is reported');
  assert.equal(dom.status(), EN.noRtc);

  guest.close();
  second.close();
  dom.click('cancel');
  await settle(30);
  assert.deepEqual(remaining(), [], 'the brokers are left clean');
  screen.close();
});

test('the guest\'s screen: the greeting form, the news, and a connection that fails', async () => {
  const hostHub = createHub({ brokers: SIGNAL_BROKERS });
  const asked = [];
  const host = await hostRoom({
    hub: hostHub, rtc: stubRtc, needGreeting: true, onRequest: list => asked.push(list),
  });
  const screen = openScreen(env);
  screen.joinFrom(host.token, true);
  await until(() => dom.html().includes('id="coopGreeting"'), 'the form');
  await until(() => dom.html().includes('*'), 'told that a greeting is wanted');
  assert.equal(dom.failed(), false);

  dom.typed.set('coopGreeting', '   ');
  dom.click('join');
  await until(() => dom.status() === EN.greetNeeded, 'asked for a greeting');
  assert.equal(dom.failed(), true);
  assert.deepEqual(asked, [], 'nothing was sent');

  dom.typed.set('coopGreeting', 'Hi, it is Anna');
  dom.click('join');
  await until(() => asked.at(-1)?.length === 1, 'the host sees the request');
  assert.equal(asked.at(-1)[0].greeting, 'Hi, it is Anna');
  await until(() => dom.status() === EN.hostSees, 'the guest is told it arrived');
  assert.ok(!dom.html().includes('id="coopGreeting"'), 'no form once asked');

  await host.accept(asked.at(-1)[0].id);
  await until(() => dom.failed() && dom.status() === EN.noRtc, 'the failed connection is shown');
  host.close();
  dom.click('cancel');
  await settle(30);
  assert.deepEqual(remaining(), [], 'the brokers are left clean');
  screen.close();
});

test('a link that is no token is reported', async () => {
  const screen = openScreen(env);
  screen.joinFrom('not-a-token', true);
  await until(() => dom.failed(), 'the bad link');
  assert.equal(dom.status(), EN.badCode);
  dom.click('cancel');
  screen.close();
});
