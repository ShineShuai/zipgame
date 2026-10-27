import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmDialog, exportDialog, gamePage, invitePage, joinPage, lobbyPage, menuPage, resultCard,
  roomInvitePage, roomJoinPage, STAGE_TEXT,
} from '../../src/coop/pages.js';
import { GREETING_MAX, STAGES } from '../../src/coop/join.js';
import { EN, ZH } from '../../src/coop/texts.js';
import { PLAY_SIZES } from '../../src/core/gen/generate.js';

const view = (over = {}) => ({
  n: 7, online: false, pid: 0, peerHere: true, revealed: false, grade: 3,
  seedText: 'seed 5 · solo',
  devText: 'trap 1.20', time: 12.34, hintsLeft: { used: 1, cap: 7 }, canNew: true, ...over,
});

test('the menu offers every size of the play app, solo and online, in its card style', () => {
  const html = menuPage({ size: 8, rtc: true });
  for (const n of PLAY_SIZES) {
    assert.ok(html.includes(`<option value="${n}"`), `size ${n}`);
  }
  assert.ok(html.includes('<option value="8" selected>'));
  for (const name of ['card free-card', 'card-head', 'play-bar', 'size-field', 'button-row']) {
    assert.ok(html.includes(name), name);
  }
  assert.ok(html.includes('data-act="solo"') && html.includes('data-act="host"'));
  assert.ok(!html.includes('disabled'));
  assert.ok(menuPage({ size: 7, rtc: false }).includes('data-act="host" disabled'));
});

test('the game screen has the play app\'s arrangement and buttons', () => {
  const html = gamePage(view());
  for (const name of ['game-layout', 'board-card', 'class="hud"', 'hud-title', 'hud-time',
    'grid-wrap', 'card actions', 'difficulty-badge']) {
    assert.ok(html.includes(name), name);
  }
  for (const act of ['menu', 'new', 'clear', 'undo', 'hint', 'export']) {
    assert.ok(html.includes(`data-act="${act}"`), act);
  }
  assert.ok(html.includes('12.3s'));
  assert.ok(html.includes('Hard · 3/5'));
  assert.ok(!html.includes('coop-players')); // alone: no players line
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

test('online: the colour chips, and only the host can start a new puzzle', () => {
  const host = gamePage(view({ online: true, pid: 0 }));
  assert.ok(host.includes('coop-players'));
  assert.ok(host.includes('coop-chip'));
  assert.ok(!/id="coopNew" disabled/.test(host));
  assert.ok(/id="coopNew" disabled/.test(gamePage(view({ online: true, pid: 1, canNew: false }))));
  assert.ok(gamePage(view({ online: true, peerHere: false })).includes('coop-chip gone'));
});

test('the invite, reply and lobby screens', () => {
  const link = 'https://x.test/#c=oz1';
  const invite = invitePage({ link, status: 'Waiting', canShare: true });
  assert.ok(invite.includes('value="https://x.test/#c=oz1"'));
  assert.ok(invite.includes('data-act="connect"') && invite.includes('data-act="share"'));
  assert.ok(!invitePage({ link: '', status: 'Preparing', canShare: false }).includes('coopReply'));
  const join = joinPage({ code: 'az9', status: 'Connecting', canShare: false });
  assert.ok(join.includes('value="az9"') && !join.includes('data-act="share"'));
  assert.ok(lobbyPage({ role: 'host', size: 7, status: 's' }).includes('data-act="start"'));
  assert.ok(!lobbyPage({ role: 'guest', size: 7, status: 's' }).includes('data-act="start"'));
  assert.ok(invitePage({ link: '', status: 'bad', error: true }).includes('note error'));
});

test('the host\'s page by link: the link, the ask-for-greeting box, and who wants to join', () => {
  const link = 'https://x.test/#j=abc';
  const page = roomInvitePage({ link, status: 'Waiting', canShare: true, needGreeting: true });
  assert.ok(page.includes('value="https://x.test/#j=abc"') && page.includes('data-act="share"'));
  assert.ok(/id="coopNeedGreeting"[^>]*checked/.test(page));
  assert.ok(!roomInvitePage({ link, status: 's' }).includes(' checked'));
  assert.ok(!page.includes('coop-request') && !page.includes('data-act="manual"'));
  assert.ok(!roomInvitePage({ link: '', status: 'Preparing' }).includes('coopLink'));
  const asked = roomInvitePage({
    link,
    status: 's',
    requests: [
      { id: 'A_-0123456b', greeting: '<b>Anna</b> & "co"' },
      { id: 'B_-0123456b', greeting: '' },
    ],
  });
  assert.equal([...asked.matchAll(/data-act="accept"/g)].length, 2);
  assert.ok(asked.includes('data-act="decline" data-id="B_-0123456b"'));
  assert.ok(asked.includes('&lt;b>Anna&lt;/b> &amp; &quot;co&quot;') && !asked.includes('<b>Anna'));
  assert.ok(asked.includes(EN.noGreeting));
  const down = roomInvitePage({ link, status: 'down', error: true, down: true });
  assert.ok(down.includes('data-act="manual"'));
});

test('the guest\'s page by link: a greeting form while it may ask, then only the news', () => {
  for (const stage of ['looking', 'ready']) {
    const form = roomJoinPage({ stage, status: 's', greeting: 'Hi "you"' });
    assert.ok(form.includes('data-act="join"') && form.includes(`maxlength="${GREETING_MAX}"`));
    assert.ok(form.includes('value="Hi &quot;you&quot;"'));
  }
  assert.ok(roomJoinPage({ stage: 'ready', status: 's', needGreeting: true }).includes('*'));
  for (const stage of STAGES.filter(name => !['looking', 'ready'].includes(name))) {
    const page = roomJoinPage({ stage, status: 'news' });
    assert.ok(!page.includes('coopGreeting') && page.includes('data-act="cancel"'), stage);
  }
});

test('every stage of a join has a text in both languages', () => {
  assert.deepEqual(Object.keys(STAGE_TEXT).sort(), [...STAGES].sort());
  for (const [key] of Object.values(STAGE_TEXT)) {
    assert.ok(EN[key] && ZH[key], key);
  }
});

test('dialogs use the play app\'s modal, and the puzzle text is escaped', () => {
  assert.ok(confirmDialog().includes('modal-backdrop show'));
  const confirm = confirmDialog();
  assert.ok(confirm.includes('data-act="stay"') && confirm.includes('data-act="leave"'));
  const dialog = exportDialog('# a <b> c');
  assert.ok(dialog.includes('Export Puzzle') && dialog.includes('&lt;b>'));
  assert.ok(!dialog.includes('<b>'));
  const card = resultCard({ solved: 'Solved in 3.0s', lines: ['one', 'two'] });
  assert.ok(card.includes('class="solved"') && card.includes('<p class="small">two</p>'));
});

test('the type and the size are chosen together: the sizes are those of the type', () => {
  const sizes = html => [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  const standard = menuPage({ size: 7, rtc: true });
  const picked = html => /<input type="radio" name="coopVariant" value="(\w+)" checked /.exec(html)?.[1];
  const all = [
    'standard', 'cutout', 'exact', 'arrows', 'wrap', 'teleport', 'loop', 'twopaths', 'pentagon',
    'tetra', 'cube', 'ball',
  ];
  for (const id of all) {
    assert.ok(standard.includes(`<input type="radio" name="coopVariant" value="${id}"`), id);
  }
  assert.equal(picked(standard), 'standard');
  assert.ok(sizes(standard).includes(16));
  const exact = menuPage({ size: 8, rtc: true, variant: 'exact' });
  assert.equal(picked(exact), 'exact');
  assert.ok(!sizes(exact).includes(16));
  const arrows = menuPage({ size: 7, rtc: true, variant: 'arrows' });
  assert.equal(picked(arrows), 'arrows');
  assert.deepEqual(sizes(arrows), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(sizes(menuPage({ size: 7, rtc: true, variant: 'wrap' })), [4, 5, 6, 7, 8]);
  assert.deepEqual(sizes(menuPage({ size: 6, rtc: true, variant: 'pentagon' })), [4, 6, 8, 10]);
  assert.deepEqual(sizes(menuPage({ size: 3, rtc: true, variant: 'cube' })), [2, 3, 4]);
  const cube = menuPage({ size: 3, rtc: true, variant: 'cube' });
  assert.match(cube, /<option value="3" selected>3 \(\d+ cells\)/);
  const lobby = lobbyPage({ role: 'host', size: 6, status: '', variant: 'cutout' });
  assert.equal(picked(lobby), 'cutout');
  assert.ok(lobby.includes('<option value="6" selected>'));
  assert.ok(!lobbyPage({ role: 'guest', size: 6, status: '' }).includes('coopVariant'));
});

test('the game title names a type that is not the standard one', () => {
  assert.ok(!gamePage(view()).includes(' · Cutout'));
  assert.ok(gamePage(view()).includes('Patchwork 7×7'));
  assert.ok(gamePage(view({ variantName: 'Cutout' })).includes('Patchwork · Cutout 7×7'));
});

test('a failed puzzle is told on the menu (alone) and in the lobby, as an error', () => {
  const failed = 'The puzzle could not be made. Try again. (no puzzle)';
  const menu = menuPage({ size: 7, rtc: true, status: failed, error: true });
  assert.ok(menu.includes('class="note error"') && menu.includes(failed));
  assert.ok(!menuPage({ size: 7, rtc: true }).includes('coopStatus'));
  const lobby = lobbyPage({ role: 'host', size: 7, status: failed, error: true });
  assert.ok(lobby.includes('class="note error"') && lobby.includes(failed));
});

test('a solid game: the title has the size, and the button swaps the solid and its net', () => {
  const html = gamePage(view({ variantName: 'Cube', sizeName: '3', viewLabel: 'Net' }));
  assert.ok(html.includes('Patchwork · Cube 3'));
  assert.ok(html.includes('data-act="view" id="coopView">Net</button>'));
  assert.ok(!gamePage(view()).includes('data-act="view"'));
});

test('the game page has a button to invite a friend, hidden while the friend is there', () => {
  assert.ok(!gamePage(view()).includes('invite-help'), 'not where it cannot be done');
  const alone = gamePage(view({ online: true, peerHere: false, helpAvailable: true }));
  assert.ok(alone.includes('data-act="invite-help" id="coopHelp">'));
  const together = gamePage(view({ online: true, peerHere: true, helpAvailable: true }));
  assert.ok(together.includes('id="coopHelp" style="display:none"'));
});

// What the player has unlocked in free play (apps/play/menu.js coopAccess): locked types stay locked.
const INFO = {
  access: {
    standard: 'all', cutout: 'all', arrows: 'none', exact: 'none', wrap: 'none', loop: 'none',
    teleport: 'none', twopaths: 'none', pentagon: 'none', tetra: 'part', cube: 'none', ball: 'none',
  },
  sizes: { tetra: [4] },
  solid: true,
};
const tag = (html, id) => new RegExp(`<label[^>]*id="coopOpt-${id}"[^>]*>`).exec(html)[0];

test('locked types are marked and hidden, as in free play, until revealed or picked', () => {
  const html = menuPage({ size: 7, rtc: true, access: INFO });
  assert.ok(!tag(html, 'standard').includes('display:none'));
  assert.ok(!tag(html, 'cutout').includes('display:none'));
  assert.ok(!tag(html, 'tetra').includes('display:none'), 'open in part: shown');
  for (const id of ['arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon', 'cube']) {
    assert.ok(tag(html, id).includes('variant-locked') && tag(html, id).includes('display:none'), id);
  }
  const shown = menuPage({ size: 7, rtc: true, access: INFO, revealed: true });
  assert.ok(!tag(shown, 'arrows').includes('display:none') && tag(shown, 'arrows').includes('variant-locked'));
  const held = menuPage({ size: 7, rtc: true, access: INFO, held: new Set(['exact']) });
  assert.ok(!tag(held, 'exact').includes('display:none'));
  assert.ok(!tag(menuPage({ size: 7, rtc: true }), 'arrows').includes('variant-locked'), 'no menu: open');
});

test('the Flat | 3D tabs: two groups of tiles, the tabs only once a solid is on offer', () => {
  const html = menuPage({ size: 7, rtc: true, access: INFO });
  const group = (page, tab) => new RegExp(`<div class="variant-options[^"]*" id="coopTiles-${tab}"[^>]*>`)
    .exec(page)[0];
  assert.ok(!group(html, 'flat').includes('hidden') && group(html, '3d').includes('hidden'));
  assert.ok(html.includes('data-coop-tab="flat"') && html.includes('data-coop-tab="3d"'));
  assert.ok(!/id="coopTabs"[^>]*display:none/.test(html));
  assert.ok(html.includes('play-col has-tabs'));
  const cube = menuPage({ size: 3, rtc: true, access: INFO, variant: 'cube', held: new Set(['cube']) });
  assert.ok(group(cube, '3d') && !group(cube, '3d').includes('hidden'));
  assert.ok(group(cube, 'flat').includes('hidden'));
  assert.ok(cube.includes('data-coop-tab="3d" aria-selected="true"'));
  const none = { ...INFO, solid: false, access: { ...INFO.access, tetra: 'none' } };
  const plain = menuPage({ size: 7, rtc: true, access: none });
  assert.ok(/id="coopTabs"[^>]*display:none/.test(plain));
  assert.ok(!plain.includes('has-tabs'));
  assert.ok(!/id="coopTabs"[^>]*display:none/.test(menuPage({ size: 7, rtc: true, access: none, revealed: true })));
});

test('a type open in part offers only its open sizes, all of them while revealed', () => {
  const sizes = html => [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  const part = menuPage({ size: 4, rtc: true, access: INFO, variant: 'tetra' });
  assert.deepEqual(sizes(part), [4]);
  assert.ok(sizes(menuPage({ size: 4, rtc: true, access: INFO, variant: 'tetra', revealed: true })).length > 1);
  assert.ok(/for="coopSize" id="coopSizeLabel">Size</.test(part));
  assert.ok(/for="coopSize" id="coopSizeLabel">Shape</.test(menuPage({ size: 0, rtc: true, variant: 'ball' })));
});

test('the lobby has the tabs and the locks too, for the host only', () => {
  const host = lobbyPage({ role: 'host', size: 7, status: '', access: INFO });
  assert.ok(host.includes('data-coop-tab="3d"') && tag(host, 'arrows').includes('display:none'));
  assert.ok(!lobbyPage({ role: 'guest', size: 7, status: '' }).includes('coopTabs'));
});

test('the game page has the buttons where the play app has them', () => {
  const html = gamePage(view({ variantName: 'Cube', sizeName: '3', viewLabel: 'Net', online: true,
    peerHere: false, helpAvailable: true, revealed: true }));
  const at = text => html.indexOf(text);
  assert.ok(at('class="view-tools"') > at('class="hud"') && at('class="view-tools"') < at('class="grid-wrap"'),
    'the view tools are above the board');
  const actions = html.slice(at('card actions'));
  for (const act of ['menu', 'new', 'clear', 'undo', 'hint', 'invite-help', 'export']) {
    assert.ok(actions.includes(`data-act="${act}"`), `${act} is in the buttons on the right`);
  }
  assert.ok(!html.includes('coop-tools'));
  assert.ok(html.includes('class="note coop-msg"'));
  assert.ok(actions.includes('btn-short'));
});
