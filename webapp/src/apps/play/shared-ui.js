// Shared games: the card of games sent to the player, opening a link, sharing a result.
import { dateOfDay, fetchGameOfDayFor } from '../../features/daily.js';
import { labelCount } from '../../core/model.js';
import {
  shareStatus, isPlayable, isSpent, dateLabel, stripText, parseShareLink, makeShareRecord,
  shareUrl, shareText,
} from '../../features/share.js';
import { variantIcon } from './icons.js';
import { sizesFor } from './variants.js';
import { t } from '../../ui/i18n.js';
import { $, S, SIZES, dayNo, render, replay, replayPuzzles, sec, shared, store } from './state.js';
import { sizeLabel } from './puzzle-kit.js';
import { startGameOfDay } from './replay-ui.js';
import { beginGame } from './game-flow.js';

// A finished game -> a link with the game packed into `?s=`. Opening such a link saves the game in the player's collection of
// shared games, which the menu lists (the card at its top) until the player removes a game. A Game of Day also leaves the list
// once it is played or out of the replay window: it follows the replay scheme from then on.
const SHARED_ROWS = 3; // rows of the card before "Show all"
const SHARED_BAD = ['old', 'future', 'invalid'];
const sharedStatus = rec => shareStatus(rec, {
  today: dayNo(),
  replayDates: replay.dates(),
  attempt: rec.kind === 'gotd' ? store.attemptOn(dateOfDay(rec.day)) : null,
  sizes: SIZES,
  sizesOf: id => sizesFor(id, SIZES), // a variant may offer a size the app does not play otherwise
});

function sharedStateText(state) {
  switch (state.status) {
    case 'replay': return t('share.freeReplay');
    case 'played': return state.attempt.solved ? t('share.st.played', sec(state.attempt.time)) : t('share.st.attempted');
    case 'old': return t('replay.unavailable');
    case 'future': return t('share.st.future');
    case 'invalid': return t('share.invalid');
    default: return '';
  }
}

// The saved games the card lists, with their state: the one just opened first, then what can be played, newest first, then the rest.
function visibleShared() {
  const rank = e => (e.key === S.sharedFocus ? 0 : isPlayable(e.state) ? 1 : 2);
  return S.sharedGames
    .map(entry => ({ ...entry, state: sharedStatus(entry.rec) }))
    .filter(e => !isSpent(e.rec, e.state))
    .sort((a, b) => rank(a) - rank(b) || b.added - a.added);
}

// Persists what the card already hides (a Game of Day played since, or out of the window).
let pruning = false;
export function pruneShared() {
  if (pruning || !shared || visibleShared().length === S.sharedGames.length) {
    return;
  }
  pruning = true;
  shared.prune(e => !isSpent(e.rec, sharedStatus(e.rec)))
    .then(() => { S.sharedGames = shared.list(); })
    .finally(() => { pruning = false; });
}

function sharedItemHtml({ key, rec, state }) {
  const shape = rec.puzzle && rec.puzzle.shape ? ' · ' + t('shape.' + rec.puzzle.shape) : '';
  const head = rec.kind === 'gotd' ? t('share.gotd', dateLabel(dateOfDay(rec.day))) : rec.variant ? t('share.' + rec.variant) + shape : t('share.local');
  const grade = rec.grade == null ? '' : ` · ${t('grade.' + rec.grade)} ${rec.grade}/5`;
  const row = [`<span>⏱ ${sec(rec.timeS)}</span>`];
  if (rec.pct != null) {
    row.push(`<span>${t('share.beat', rec.pct)}</span>`);
  }
  if (rec.levels.length) {
    row.push(`<span class="shared-strip">${stripText(rec.levels)}</span>`);
  }
  const quiet = !(S.sharedMsg && S.sharedMsg.key === key) && state.status === 'replay'; // told once, in the card's (i)
  const note = S.sharedMsg && S.sharedMsg.key === key ? t(S.sharedMsg.msg) : quiet ? '' : sharedStateText(state);
  const bad = Boolean(S.sharedMsg && S.sharedMsg.key === key) || SHARED_BAD.includes(state.status);
  const armed = S.sharedArmed === key;
  return `<li class="shared-item${key === S.sharedFocus ? ' is-new' : ''}">
    <div class="shared-info">
      <h2 class="shared-title">
        <span class="shared-icon">${variantIcon(rec.variant)}</span>
        <span>${head} · ${sizeLabel(rec.variant, rec.n)}${grade}</span>
      </h2>
      <div class="shared-row">${row.join('')}</div>
      ${note ? `<p class="shared-state${bad ? ' bad' : ''}">${note}</p>` : ''}
    </div>
    <div class="shared-action">
      <button class="btn shared-play" data-key="${key}"${isPlayable(state) ? '' : ' disabled'}>${t('share.play')}</button>
      <button class="btn secondary shared-del${armed ? ' armed' : ''}" data-key="${key}" aria-label="${t('share.removeLabel')}">${armed ? t('share.removeConfirm') : '✕'}</button>
    </div>
  </li>`;
}

// First card of the menu, while there is a shared game or something to tell about the link just opened:
//   eyebrow + count + color-strip tip / notice / one item per game (what was shared, time, percent beaten, strip, reason | Play, remove)
export function sharedCardHtml() {
  const entries = visibleShared();
  const notice = S.sharedNotice ? (S.sharedNotice.bad ? t('share.invalid') : sharedStateText(S.sharedNotice.state)) : '';
  if (!entries.length && !notice) {
    return '';
  }
  // the (i): what the colours mean, and that a replay of a shared Game of Day costs no replay chance (said once, not on every game)
  const tipText = [entries.some(e => e.rec.levels.length) ? t('share.tip') : '', entries.some(e => e.state.status === 'replay') ? t('share.freeReplay') : ''].filter(Boolean).join('<br>');
  const tip = tipText
    ? `<button type="button" class="tip-btn" id="shareTip" aria-expanded="false" aria-label="${t('share.tipLabel')}">i</button>
      <span class="tip-pop" id="shareTipPop" role="tooltip">${tipText}</span>` : '';
  const more = entries.length > SHARED_ROWS
    ? `<button type="button" class="btn secondary shared-more" id="sharedMore">${S.sharedAll ? t('share.showLess') : t('share.showAll', entries.length)}</button>` : '';
  const warn = S.sharedNotice && (S.sharedNotice.bad || SHARED_BAD.includes(S.sharedNotice.state.status));
  const open = S.sharedOpen || S.sharedFocus || S.sharedNotice; // on a phone the card is a one-line banner until it is opened
  return `<section class="card shared-card${open ? ' open' : ''}" id="sharedCard">
    <div class="shared-head" id="sharedHead">
      <span class="shared-eyebrow">${t('share.title')}</span>${entries.length ? `<span class="shared-count">${entries.length}</span>` : ''}${tip}
    </div>
    ${notice ? `<p class="shared-state${warn ? ' bad' : ''}">${notice}</p>` : ''}
    <ul class="shared-list">${(S.sharedAll ? entries : entries.slice(0, SHARED_ROWS)).map(sharedItemHtml).join('')}</ul>
    ${more}
  </section>`;
}

// Drops the `s` parameter from the address (the other parameters stay), so reloading does not save the game again.
export function stripShareParam() {
  try {
    const params = new URLSearchParams(location.search);
    params.delete('s');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  } catch { /* ignore */ }
}

// At start: loads the saved games, then saves the game of the link the page was opened with. A Game of Day that is already
// played or out of the window is not saved (it never could be played from the list): the card says why, for this visit.
export async function initShared() {
  await shared.init();
  const { rec, bad } = parseShareLink(location.search);
  const gotdDates = list => list.filter(r => r.kind === 'gotd').map(r => dateOfDay(r.day));
  await Promise.all(gotdDates([...shared.list().map(e => e.rec), ...(rec ? [rec] : [])]).map(date => store.loadAttempt(date))); // so the menu can tell "already played" without waiting
  if (bad) {
    S.sharedNotice = { bad: true };
  }
  if (rec) {
    const state = sharedStatus(rec);
    if (isSpent(rec, state)) {
      S.sharedNotice = { state };
    } else {
      S.sharedFocus = (await shared.add(rec)).key;
    }
  }
  S.sharedGames = shared.list();
  if (rec || bad) {
    stripShareParam();
  }
}

// Remove button: the first press arms it ("Remove?"), the second removes the game.
export async function removeShared(key) {
  if (S.sharedArmed !== key) {
    S.sharedArmed = key;
    setTimeout(() => {
      if (S.sharedArmed === key) {
        S.sharedArmed = null;
        if (S.screen === 'menu') {
          render();
        }
      }
    }, 4000);
    render();
    const button = [...document.querySelectorAll('.shared-del')].find(b => b.dataset.key === key);
    if (button) {
      button.focus();
    }
    return;
  }
  S.sharedArmed = null;
  if (S.sharedFocus === key) {
    S.sharedFocus = null;
  }
  await shared.remove(key);
  S.sharedGames = shared.list();
  render();
}

// Play button of a saved game. A Game of Day counts like the real thing: today's date = the live game (once per day), a missed day of the
// replay window = a replay that spends no chance (the link is the ticket); both raise the Game-of-Day solve count. Either way it is played
// then, so it leaves the list. A local game is a plain local game of that puzzle; it leaves today's per-size counters alone and stays in the list.
export async function startShared(key) {
  const entry = S.sharedGames.find(e => e.key === key);
  if (!entry) {
    return;
  }
  const { rec } = entry;
  const state = sharedStatus(rec);
  if (!isPlayable(state)) {
    return render();
  }
  S.sharedMsg = null;
  if (rec.kind === 'local') {
    return startSharedLocal(rec);
  }
  if (state.status === 'live') {
    await startGameOfDay();
  } else {
    const date = dateOfDay(rec.day);
    const puzzle = replayPuzzles.get(date) || await fetchGameOfDayFor(date);
    if (puzzle) {
      replayPuzzles.set(date, puzzle);
    }
    if (!puzzle || !(await replay.beginShared(date))) {
      S.sharedMsg = { key, msg: 'replay.unavailable' };
      return render();
    }
    S.size = puzzle.n;
    beginGame(puzzle, date, true);
  }
}

// The link carries the puzzle: nothing to generate.
function startSharedLocal(rec) {
  const { shape, ...puzzle } = rec.puzzle;
  S.size = rec.n;
  Object.assign(S, { gameIndex: 0, seed: null, gameDay: null });
  beginGame(shape ? { ...puzzle, shape } : puzzle, null, false, true);
}

function currentShareRecord() {
  const trap = S.difficulty && S.difficulty.ok ? S.difficulty.trap : null;
  const attempt = S.isGotd ? store.attemptOn(S.gotdDate) : null;
  return makeShareRecord({
    gotdDate: S.isGotd ? S.gotdDate : null,
    n: S.puzzle.n,
    grade: trap ? trap.grade : null,
    timeS: S.elapsed,
    pct: attempt && attempt.stats ? attempt.stats.pct : null,
    variant: S.variant,
    puzzle: S.puzzle,
    legs: S.legs,
    K: labelCount(S.puzzle),
  });
}

// Share button (after a solve): the phone share sheet where there is one, else the clipboard, else a prompt to copy by hand.
export async function shareResult() {
  if (!S.finished) return;
  const rec = currentShareRecord();
  const url = shareUrl(location.href.split(/[?#]/)[0], rec);
  if (!url) return;
  const text = shareText(rec, url, t);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    const msg = $('shareMsg');
    if (msg) msg.textContent = t('share.copied');
  } catch {
    prompt(t('share.copy'), text);
  }
}
