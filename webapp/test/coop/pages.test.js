import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmDialog, exportDialog, gamePage, invitePage, joinPage, lobbyPage, menuPage, resultCard,
} from '../../src/coop/pages.js';
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
  assert.ok(host.includes('with a friend'));
  assert.ok(!/id="coopNew" disabled/.test(host));
  assert.ok(/id="coopNew" disabled/.test(gamePage(view({ online: true, pid: 1, canNew: false }))));
  assert.ok(gamePage(view({ online: true, peerHere: false })).includes('coop-chip gone'));
});

test('the invite, reply and lobby screens', () => {
  const link = 'https://x.test/#coop=oz1';
  const invite = invitePage({ link, status: 'Waiting', canShare: true });
  assert.ok(invite.includes('value="https://x.test/#coop=oz1"'));
  assert.ok(invite.includes('data-act="connect"') && invite.includes('data-act="share"'));
  assert.ok(!invitePage({ link: '', status: 'Preparing', canShare: false }).includes('coopReply'));
  const join = joinPage({ code: 'az9', status: 'Connecting', canShare: false });
  assert.ok(join.includes('value="az9"') && !join.includes('data-act="share"'));
  assert.ok(lobbyPage({ role: 'host', size: 7, status: 's' }).includes('data-act="start"'));
  assert.ok(!lobbyPage({ role: 'guest', size: 7, status: 's' }).includes('data-act="start"'));
  assert.ok(invitePage({ link: '', status: 'bad', error: true }).includes('note error'));
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
