// The Patchwork screens (src/coop/pages.js) are pure markup. What these tests hold them to is what
// a player can do and see: who may act, what each state offers, that what comes from outside is
// escaped, and that the pages and the screen controller agree on the actions. Not the layout: the
// classes and the arrangement are the style's business (and the page checks of test/check.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  confirmDialog,
  exportDialog,
  gamePage,
  generatingPage,
  invitePage,
  joinPage,
  lobbyPage,
  menuPage,
  resultCard,
  roomInvitePage,
  roomJoinPage,
  STAGE_TEXT,
} from '../../src/coop/pages.js';
import { GREETING_MAX, STAGES } from '../../src/coop/join.js';
import { EN, ZH } from '../../src/coop/texts.js';
import { COOP_VARIANTS, sizesFor } from '../../src/coop/variants.js';

const IDS = COOP_VARIANTS.map(variant => variant.id);

const view = (over = {}) => ({
  n: 7,
  online: false,
  pid: 0,
  peerHere: true,
  revealed: false,
  grade: 3,
  seedText: 'seed 5 · solo',
  devText: 'trap 1.20',
  time: 12.34,
  hintsLeft: { used: 1, cap: 7 },
  canNew: true,
  ...over,
});

const sizes = html => [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
const picked = html =>
  /<input type="radio" name="coopVariant" value="(\w+)" checked /.exec(html)?.[1];

// What the player has unlocked in free play (apps/play/menu.js coopAccess): locked types stay
// locked.
const INFO = {
  access: {
    standard: 'all',
    cutout: 'all',
    arrows: 'none',
    exact: 'none',
    wrap: 'none',
    loop: 'none',
    teleport: 'none',
    twopaths: 'none',
    pentagon: 'none',
    tetra: 'part',
    cube: 'none',
    ball: 'none',
  },
  sizes: { tetra: [4] },
  solid: true,
};
const tag = (html, id) => new RegExp(`<label[^>]*id="coopOpt-${id}"[^>]*>`).exec(html)[0];
const group = (html, tab) =>
  new RegExp(`<div class="variant-options[^"]*" id="coopTiles-${tab}"[^>]*>`).exec(html)[0];
const tabsHidden = html => /id="coopTabs"[^>]*display:none/.test(html);

test('what comes from outside is escaped: greetings, links, codes, the exported text', () => {
  const hostile = '<s>"x" & y</s>';
  const escaped = '&lt;s>&quot;x&quot; &amp; y&lt;/s>';
  const pages = {
    'invite link': invitePage({ link: hostile, status: 's' }),
    'join code': joinPage({ code: hostile, status: 's' }),
    'room link': roomInvitePage({ link: hostile, status: 's' }),
    'request greeting': roomInvitePage({
      link: 'l',
      status: 's',
      requests: [{ id: hostile, greeting: hostile }],
    }),
    'guest greeting': roomJoinPage({ stage: 'ready', status: 's', greeting: hostile }),
  };
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.includes(escaped), name);
    assert.ok(!html.includes('<s>'), `${name}: no markup got through`);
  }
  const exported = exportDialog('# a <s> "c"');
  assert.ok(exported.includes('&lt;s>') && !exported.includes('<s>'), 'the exported puzzle text');
});

test('the host starts and decides; the guest only waits and may ask', () => {
  const newDisabled = html => /id="coopNew" disabled/.test(html);
  assert.ok(!newDisabled(gamePage(view())), 'a solo player starts a new puzzle');
  assert.ok(!newDisabled(gamePage(view({ online: true, pid: 0 }))), 'so does the host');
  const guestPage = gamePage(view({ online: true, pid: 1, canNew: false }));
  assert.ok(newDisabled(guestPage), 'the guest cannot');
  const noRtc = menuPage({ size: 7, rtc: false });
  assert.ok(/data-act="host" disabled/.test(noRtc), 'no invite without rtc');
  assert.ok(!/data-act="host" disabled/.test(menuPage({ size: 7, rtc: true })));
  assert.ok(lobbyPage({ role: 'host', size: 7, status: 's' }).includes('data-act="start"'));
  const guest = lobbyPage({ role: 'guest', size: 7, status: 's' });
  assert.ok(!guest.includes('data-act="start"'), 'the guest cannot start');
  assert.ok(!guest.includes('coopVariant'), 'nor pick the type');
  const asked = roomInvitePage({
    link: 'l',
    status: 's',
    requests: [
      { id: 'A_-0123456b', greeting: 'Anna' },
      { id: 'B', greeting: '' },
    ],
  });
  for (const act of ['accept', 'decline']) {
    assert.equal([...asked.matchAll(new RegExp(`data-act="${act}"`, 'g'))].length, 2, act);
  }
  assert.ok(asked.includes('data-act="decline" data-id="B"'), 'a decision names its guest');
  assert.ok(asked.includes(EN.noGreeting), 'a guest without a greeting is said so');
  assert.ok(!/data-act="(accept|decline)"/.test(roomInvitePage({ link: 'l', status: 's' })));
  for (const stage of STAGES) {
    const form = ['looking', 'ready'].includes(stage);
    const html = roomJoinPage({ stage, status: 'news', greeting: 'Hi' });
    assert.equal(html.includes('data-act="join"'), form, `${stage}: a form only while it may ask`);
    assert.ok(html.includes('data-act="cancel"'), `${stage}: the guest can always back out`);
  }
});

test('the invite, join and lobby pages offer what their state allows', () => {
  const link = 'https://x.test/#c=oz1';
  const invite = invitePage({ link, status: 'Waiting', canShare: true });
  assert.ok(invite.includes(`value="${link}"`) && invite.includes('data-act="connect"'));
  assert.ok(!invitePage({ link: '', status: 'Preparing' }).includes('coopReply'), 'no reply box');
  for (const [page, canShare] of [
    [invitePage, true],
    [joinPage, true],
    [roomInvitePage, true],
    [invitePage, false],
    [joinPage, false],
    [roomInvitePage, false],
  ]) {
    const html = page({ link: 'l', code: 'az9', status: 's', canShare });
    assert.equal(html.includes('data-act="share"'), canShare, `${page.name} canShare=${canShare}`);
  }
  assert.ok(joinPage({ code: 'az9', status: 's' }).includes('value="az9"'));
  const down = roomInvitePage({ link: 'l', status: 'down', down: true });
  assert.ok(down.includes('data-act="manual"'));
  assert.ok(!roomInvitePage({ link: 'l', status: 's' }).includes('data-act="manual"'));
  assert.ok(!roomInvitePage({ link: '', status: 'Preparing' }).includes('coopLink'));
  assert.ok(
    /id="coopNeedGreeting"[^>]*checked/.test(
      roomInvitePage({ link: 'l', status: 's', needGreeting: true }),
    ),
  );
  assert.ok(!roomInvitePage({ link: 'l', status: 's' }).includes(' checked'));
  const form = roomJoinPage({ stage: 'ready', status: 's', needGreeting: true });
  assert.ok(form.includes(`maxlength="${GREETING_MAX}"`), 'a greeting has a length limit');
  assert.ok(form.includes('*'), 'and is asked for');
  const failed = 'The puzzle could not be made. Try again. (no puzzle)';
  for (const html of [
    menuPage({ size: 7, rtc: true, status: failed, error: true }),
    lobbyPage({ role: 'host', size: 7, status: failed, error: true }),
    invitePage({ link: '', status: failed, error: true }),
  ]) {
    assert.ok(/class="note error"[^>]*>[^<]*\(no puzzle\)/.test(html), 'a failure is an error');
  }
  assert.ok(!menuPage({ size: 7, rtc: true }).includes('coopStatus'), 'no note without a status');
});

test('the game page: players, friend, title, grade and buttons follow the state', () => {
  const solo = gamePage(view());
  assert.ok(!solo.includes('coop-players'), 'alone: no players line');
  const host = gamePage(view({ online: true, peerHere: false }));
  assert.ok(host.includes('coop-players'), 'online: the players line');
  assert.ok(host.includes('coop-chip gone'), 'the friend is away');
  assert.ok(!gamePage(view({ online: true })).includes('coop-chip gone'), 'the friend is here');
  assert.ok(solo.includes('12.3s') && solo.includes('Hard · 3/5'), 'time and grade');
  assert.ok(solo.includes('Patchwork 7×7'), 'the title has the size');
  assert.ok(!solo.includes(' · Cutout'), 'the standard type is not named');
  assert.ok(gamePage(view({ variantName: 'Cutout' })).includes('Patchwork · Cutout 7×7'));
  const cube = gamePage(view({ variantName: 'Cube', sizeName: '3', viewLabel: 'Net' }));
  assert.ok(cube.includes('Patchwork · Cube 3'));
  assert.ok(cube.includes('data-act="view" id="coopView">Net</button>'), 'a solid: its net');
  assert.ok(!solo.includes('data-act="view"'), 'a flat board has no such button');
  assert.ok(!solo.includes('invite-help'), 'no invite button where it cannot be done');
  const lonely = gamePage(view({ online: true, peerHere: false, helpAvailable: true }));
  assert.ok(lonely.includes('data-act="invite-help" id="coopHelp">'), 'a friend can be asked');
  const together = gamePage(view({ online: true, peerHere: true, helpAvailable: true }));
  assert.ok(together.includes('id="coopHelp" style="display:none"'), 'not while the friend is in');
});

test('what the play app shows only while V is held is hidden here too, until revealed', () => {
  const hidden = gamePage(view());
  const shown = gamePage(view({ revealed: true }));
  const devParts = html => html.match(/<[^>]*data-dev[^>]*>/g);
  assert.equal(devParts(hidden).length, 3); // the seed tag, the grade numbers, Export
  assert.ok(devParts(hidden).every(tag => tag.includes('display:none')));
  assert.ok(devParts(shown).every(tag => !tag.includes('display:none')));
  assert.ok(shown.includes('seed 5 · solo') && shown.includes('trap 1.20'));
});

test('the picker offers every type of the registry, with the sizes of its type', () => {
  const standard = menuPage({ size: 7, rtc: true });
  for (const id of IDS) {
    assert.ok(standard.includes(`<input type="radio" name="coopVariant" value="${id}"`), id);
  }
  assert.equal(picked(standard), 'standard');
  for (const id of IDS) {
    const size = sizesFor(id)[0];
    const html = menuPage({ size, rtc: true, variant: id });
    assert.equal(picked(html), id);
    assert.deepEqual(sizes(html), sizesFor(id), `${id}: its own sizes`);
    assert.ok(html.includes(`<option value="${size}" selected>`), `${id}: the size picked`);
  }
  const cube = menuPage({ size: 3, rtc: true, variant: 'cube' });
  assert.match(cube, /<option value="3" selected>3 \(\d+ cells\)/, 'a solid says its cells');
  assert.ok(
    /for="coopSize" id="coopSizeLabel">Shape</.test(
      menuPage({ size: 0, rtc: true, variant: 'ball' }),
    ),
    'a ball has a shape, not a size',
  );
  const lobby = lobbyPage({ role: 'host', size: 6, status: '', variant: 'cutout' });
  assert.equal(picked(lobby), 'cutout');
  assert.ok(lobby.includes('<option value="6" selected>'));
});

test('locks, tabs and open sizes follow what the player has unlocked, as in free play', () => {
  const closed = id => INFO.access[id] === 'none';
  const html = menuPage({ size: 7, rtc: true, access: INFO });
  const revealed = menuPage({ size: 7, rtc: true, access: INFO, revealed: true });
  for (const id of IDS) {
    assert.equal(tag(html, id).includes('variant-locked'), closed(id), `${id}: marked locked`);
    assert.equal(tag(html, id).includes('display:none'), closed(id), `${id}: hidden while locked`);
    assert.ok(!tag(revealed, id).includes('display:none'), `${id}: shown while revealed`);
    assert.equal(tag(revealed, id).includes('variant-locked'), closed(id), `${id}: still marked`);
  }
  const held = menuPage({ size: 7, rtc: true, access: INFO, held: new Set(['exact']) });
  assert.ok(!tag(held, 'exact').includes('display:none'), 'a locked type picked stays shown');
  assert.ok(tag(held, 'wrap').includes('display:none'));
  const noAccess = menuPage({ size: 7, rtc: true });
  assert.ok(!tag(noAccess, 'arrows').includes('variant-locked'), 'without access info: all open');
  // the Flat | 3D tabs, once a solid is on offer
  assert.ok(!group(html, 'flat').includes('hidden') && group(html, '3d').includes('hidden'));
  assert.ok(html.includes('data-coop-tab="flat"') && html.includes('data-coop-tab="3d"'));
  assert.ok(!tabsHidden(html));
  const cube = menuPage({
    size: 3,
    rtc: true,
    access: INFO,
    variant: 'cube',
    held: new Set(['cube']),
  });
  assert.ok(!group(cube, '3d').includes('hidden') && group(cube, 'flat').includes('hidden'));
  assert.ok(cube.includes('data-coop-tab="3d" aria-selected="true"'));
  const none = { ...INFO, solid: false, access: { ...INFO.access, tetra: 'none' } };
  assert.ok(tabsHidden(menuPage({ size: 7, rtc: true, access: none })), 'no solid, no tabs');
  assert.ok(!tabsHidden(menuPage({ size: 7, rtc: true, access: none, revealed: true })));
  // a type open in part offers only its open sizes, all of them while revealed
  assert.deepEqual(sizes(menuPage({ size: 4, rtc: true, access: INFO, variant: 'tetra' })), [4]);
  const all = menuPage({ size: 4, rtc: true, access: INFO, variant: 'tetra', revealed: true });
  assert.deepEqual(sizes(all), sizesFor('tetra'));
  // the lobby has them for the host only
  const host = lobbyPage({ role: 'host', size: 7, status: '', access: INFO });
  assert.ok(host.includes('data-coop-tab="3d"') && tag(host, 'arrows').includes('display:none'));
  assert.ok(!lobbyPage({ role: 'guest', size: 7, status: '' }).includes('coopTabs'));
});

test('every stage of a join has a text in both languages', () => {
  assert.deepEqual(Object.keys(STAGE_TEXT).sort(), [...STAGES].sort());
  for (const [key] of Object.values(STAGE_TEXT)) {
    assert.ok(EN[key] && ZH[key], key);
  }
});

test('the result card shows the time and every line of it', () => {
  const card = resultCard({ solved: 'Solved in 3.0s', lines: ['one', 'two'] });
  for (const text of ['Solved in 3.0s', 'one', 'two']) {
    assert.ok(card.includes(text), text);
  }
});

// The pages emit data-act; the controller (screen.js) maps each to a handler and ignores any it
// does not know, so a renamed act on either side would silently do nothing. The controller's map
// is read from its source: it lives inside the click handler and cannot be reached from a test.
test('the pages and the screen controller agree on the actions', () => {
  const rich = view({
    online: true,
    peerHere: false,
    revealed: true,
    variantName: 'Cube',
    viewLabel: 'Net',
    helpAvailable: true,
  });
  const pages = [
    menuPage({ size: 7, rtc: true, saved: true, status: 's', access: INFO }),
    gamePage(rich),
    invitePage({ link: 'l', status: 's', canShare: true }),
    joinPage({ code: 'c', status: 's', canShare: true }),
    lobbyPage({ role: 'host', size: 7, status: 's' }),
    lobbyPage({ role: 'guest', size: 7, status: 's' }),
    roomInvitePage({
      link: 'l',
      status: 's',
      canShare: true,
      down: true,
      requests: [{ id: 'a', greeting: '' }],
    }),
    ...STAGES.map(stage => roomJoinPage({ stage, status: 's' })),
    generatingPage({ percent: 5, waiting: false, online: true }),
    confirmDialog(),
    exportDialog('x'),
    resultCard({ solved: 's', lines: [] }),
  ];
  const emitted = new Set(
    pages.flatMap(html => [...html.matchAll(/data-act="([\w-]+)"/g)].map(match => match[1])),
  );
  const source = fs.readFileSync(new URL('../../src/coop/screen.js', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('const actions = {'),
    source.indexOf('actions[button.dataset.act]'),
  );
  const handled = new Set(
    [...block.matchAll(/^ {6}(?:'([\w-]+)'|(\w+))[:,]/gm)].map(match => match[1] ?? match[2]),
  );
  assert.ok(handled.size > 20, `the actions map of screen.js was not found (${handled.size})`);
  assert.deepEqual(
    [...emitted].filter(act => !handled.has(act)),
    [],
    'an act no handler takes',
  );
  assert.deepEqual(
    [...handled].filter(act => !emitted.has(act)),
    [],
    'a handler no page offers',
  );
});
