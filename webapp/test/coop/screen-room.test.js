import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNAL_BROKERS } from '../../src/coop/config.js';
import { hostRoom, joinRoom } from '../../src/coop/join.js';
import { openScreen } from '../../src/coop/screen.js';
import { createSession } from '../../src/coop/session.js';
import { createHub } from '../../src/coop/signal.js';
import { GAME_KEY, loadGame, makeRecord, saveGame } from '../../src/coop/keep.js';
import { deriveResume, newSecret } from '../../src/coop/secret.js';
import { fromBase64Url } from '../../src/coop/invite.js';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
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

// Whatever a test opens is closed when it ends, however it ends: an open room keeps timers (the
// invite lasts minutes), and a test that failed halfway would keep the whole run from finishing.
const opened = (t, thing) => {
  t.after(() => thing.close());
  return thing;
};

test('the host\'s screen: link, requests, greeting box, accept, decline, cancel', async t => {
  const screen = opened(t, openScreen(env));
  dom.click('host');
  await until(() => dom.html().includes('id="coopLink"'), 'the link');
  const link = /value="([^"]+)"/.exec(dom.html())[1];
  assert.match(link, /^https:\/\/x\.test\/zip\/index\.html#j=[A-Za-z0-9_-]{44}$/);
  assert.equal(dom.status(), EN.waitFriend);

  const stages = [];
  const infos = [];
  const guest = opened(t, await joinRoom({
    hub: createHub({ brokers: SIGNAL_BROKERS }),
    token: link.split('#j=')[1],
    rtc: stubRtc,
    onState: (stage, info) => {
      stages.push(stage);
      infos.push(info);
    },
  }));
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

  const second = opened(t, await joinRoom({
    hub: createHub({ brokers: SIGNAL_BROKERS }), token: link.split('#j=')[1], rtc: stubRtc,
  }));
  await second.ask('Bea');
  await until(() => dom.html().includes('coop-request'), 'a second request');
  dom.click('accept', { id: /data-act="accept" data-id="([^"]+)"/.exec(dom.html())[1] });
  assert.equal(dom.status(), EN.connecting);
  await until(() => dom.failed(), 'the connection that cannot be made is reported');
  assert.equal(dom.status(), EN.noRtc);

  dom.click('cancel');
  await settle(30);
  assert.deepEqual(remaining(), [], 'the brokers are left clean');
});

test('the guest\'s screen: the greeting form, the news, and a failing connection', async t => {
  const asked = [];
  const host = opened(t, await hostRoom({
    hub: createHub({ brokers: SIGNAL_BROKERS }),
    rtc: stubRtc,
    needGreeting: true,
    onRequest: list => asked.push(list),
  }));
  const screen = opened(t, openScreen(env));
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
});

test('a link that is no token is reported', async t => {
  const screen = opened(t, openScreen(env));
  screen.joinFrom('not-a-token', true);
  await until(() => dom.failed(), 'the bad link');
  assert.equal(dom.status(), EN.badCode);
  dom.click('cancel');
});

// ---------- a game that goes on ----------
const memory = () => {
  const data = new Map();
  return {
    data,
    get: async key => (data.has(key) ? { value: data.get(key) } : null),
    set: async (key, value) => data.set(key, value) && true,
    remove: async key => data.delete(key),
  };
};

// The menu offers WebRTC games only where the browser has it: a stand-in that does nothing.
const withRtc = t => {
  globalThis.RTCPeerConnection = class {};
  t.after(() => {
    delete globalThis.RTCPeerConnection;
  });
};

// A game of 6x6 for `role`, with two lines drawn, as it would have been kept.
async function kept(role, extra = {}) {
  const puzzle = runSync(generate(6, 5));
  const host = createSession({ role: 'host', onEvent() {} });
  const mine = host.newGame(puzzle, 5);
  const solution = solutionOf(puzzle);
  mine.add(solution[0], solution[1]);
  mine.add(solution[1], solution[2]);
  return makeRecord({
    role,
    seed: 5,
    text: host.current.text,
    ops: mine.ops(),
    hints: 1,
    startedWall: Date.now() - 20000,
    secret: newSecret(),
    ...extra,
  });
}

test('the menu offers a game that was left open, and it can be given up', async t => {
  withRtc(t);
  const storage = memory();
  await saveGame(storage, await kept('guest'));
  const screen = opened(t, openScreen({ ...env, storage }));
  await until(() => dom.html().includes('data-act="rejoin"'), 'the card');
  assert.ok(dom.html().includes('data-act="discard"'));
  dom.click('discard');
  assert.ok(!dom.html().includes('data-act="rejoin"'));
  assert.equal(storage.data.has(GAME_KEY), false);
  assert.equal(screen !== null, true);
});

test('a game that is too old, or damaged, is not offered', async t => {
  const storage = memory();
  const old = await kept('host');
  await saveGame(storage, { ...old, saved: Date.now() - 25 * 3600 * 1000 });
  opened(t, openScreen({ ...env, storage }));
  await settle(40);
  assert.ok(!dom.html().includes('data-act="rejoin"'));
  storage.data.set(GAME_KEY, '{"v":1');
  assert.equal(await loadGame(storage), null);
});

test('rejoining shows the game with its time, and looks for the other device', async t => {
  withRtc(t);
  const storage = memory();
  const record = await kept('host', { hints: 2 });
  await saveGame(storage, record);
  const screen = opened(t, openScreen({ ...env, storage }));
  await until(() => dom.html().includes('data-act="rejoin"'), 'the card');
  dom.click('rejoin');
  await until(() => dom.html().includes('id="coopBoard"'), 'the game');
  assert.match(dom.html(), /class="coop-chip gone" id="coopPeer"/, 'the friend is not there yet');
  assert.match(dom.html(), /<b id="coopTime">2\d\.\ds<\/b>/, 'about 20 s have passed');
  assert.match(dom.html(), /Hint \(2/, 'the hints used are counted');
  await until(() => dom.message() === EN.reconnecting, 'told that it looks for the friend');
  const { room } = await deriveResume(fromBase64Url(record.secret));
  const broker = net.brokers.get(SIGNAL_BROKERS[0].url);
  await until(() => broker.retained.has(`zipcoop/1/${room}/here/0`), 'its presence');
  const again = await loadGame(storage);
  assert.equal(again.ops.length, 2, 'the game is kept as it goes on');
  assert.equal(again.hints, 2);

  dom.click('menu'); // leaving on purpose
  if (dom.html().includes('data-act="leave"')) {
    dom.click('leave');
  }
  await settle(30);
  assert.equal(storage.data.has(GAME_KEY), false, 'a game that is left is forgotten');
  assert.deepEqual(remaining(), [], 'the brokers are left clean');
  assert.equal(screen !== null, true);
});

test('the guest\'s kept game is taken up with its own role and lines', async t => {
  withRtc(t);
  const storage = memory();
  const record = await kept('guest');
  await saveGame(storage, record);
  opened(t, openScreen({ ...env, storage }));
  await until(() => dom.html().includes('data-act="rejoin"'), 'the card');
  dom.click('rejoin');
  await until(() => dom.html().includes('id="coopBoard"'), 'the game');
  const { room } = await deriveResume(fromBase64Url(record.secret));
  const broker = net.brokers.get(SIGNAL_BROKERS[1].url);
  await until(() => broker.retained.has(`zipcoop/1/${room}/here/1`), 'the guest\'s presence');
  assert.ok(dom.html().includes('id="coopNew" disabled'), 'only the host starts games');
  dom.click('menu');
  if (dom.html().includes('data-act="leave"')) {
    dom.click('leave');
  }
});
