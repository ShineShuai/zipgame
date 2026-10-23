// Playing a missed Game of the Day again: its list screen, and starting a replay or today's game.
import { fetchGameOfDay, fetchGameOfDayFor, dateOfDay } from '../../features/daily.js';
import { dateLabel } from '../../features/share.js';
import { REPLAY_DAYS } from '../../core/hist.js';
import { t } from '../../ui/i18n.js';
import { S, render, replay, replayNoFile, replayPuzzles, sec, store, streak, today } from './state.js';
import { weekday } from './menu-kit.js';
import { beginGame } from './game-flow.js';

// Replay screen (opened by the menu's Replay button): up to REPLAY_SHOW dates, each a button: the missed days (newest first), then old solved days to repeat (slowest first), each with its earlier time. Every row shows its grid size, read from the puzzle file (static,
// cached per page load). One column on phones, as many 250 px columns as fit on a desktop (css/play.css). Row text is made of small chips that wrap as units.
function replayRowHtml({ date, puzzle, attempt, heal }, canPlay) { // attempt: the stored record, null = missed (else abandoned, or solved = a day to repeat); heal: heals the streak
  const chips = [`${puzzle.n}x${puzzle.n}`, ...(heal ? [`<b class="replay-heal">${t('replay.heal')}</b>`] : []), ...(attempt ? [attempt.solved ? t('replay.prev', sec(attempt.time)) : t('replay.abandoned')] : [])];
  return `
    <button class="replay-day" type="button" data-date="${date}"${canPlay ? '' : ' disabled'}>
      <span class="replay-top"><span class="replay-date">${dateLabel(date)} <small>${weekday(date)}</small></span><span class="replay-go">${t('replay.play')}</span></span>
      <span class="replay-meta">${chips.map(c => `<span>${c}</span>`).join('')}</span>
    </button>`;
}
export function renderReplay() {
  const r = S.replayPick || { loading: true, list: [], msg: null }, chances = replay.chances();
  const info = r.loading ? t('replay.loading') : chances < 1 ? t('replay.locked', replay.toNext()) : !r.list.length ? t('replay.none', REPLAY_DAYS) : '';
  const grid = !r.loading && r.list.length ? `<div class="replay-grid">${r.list.map(x => replayRowHtml(x, chances > 0)).join('')}</div>` : '';
  return `
    <div class="replay-stage">
      <section class="card">
        <div class="replay-head">
          <h2 class="card-title">${t('replay.title')}</h2>
          <span class="replay-left">${t('replay.left', chances)}</span>
        </div>
        <p class="blurb">${t('replay.sub')}</p>
        ${r.msg ? `<p class="note error">${t(r.msg)}</p>` : ''}
        ${info ? `<p class="small replay-info">${info}</p>` : ''}
        ${grid}
        <div class="button-row"><button class="btn secondary" id="replayBack">${t('game.menu')}</button></div>
      </section>
    </div>`;
}

export async function startGameOfDay() {
  const date = today();
  if (store.attemptDate() !== date) await store.hydrateAttempt(date);
  const a = store.attempt();
  if (a) { S.gotdHint = a.solved ? ['gotd.playedSolved', sec(a.time)] : ['gotd.played']; return render(); }
  const puzzle = await fetchGameOfDay();
  if (!puzzle) { S.gotdHint = ['gotd.none']; return render(); }
  S.size = puzzle.n;
  await store.saveAttempt(date, { solved: false, time: null }); // abandoning mid-puzzle still uses today's try
  beginGame(puzzle, puzzle.gotdDate);
}
// Replay: the replay screen lists up to REPLAY_SHOW days that have a puzzle file (replay.pick); choosing one spends a chance
// once its puzzle has loaded.
let replayLoad = 0; // a newer openReplay() makes an older, slower one drop its result
async function replayFile(date) {
  if (!replayPuzzles.has(date) && !replayNoFile.has(date)) { const p = await fetchGameOfDayFor(date); if (p) replayPuzzles.set(date, p); else replayNoFile.add(date); }
  return replayPuzzles.get(date) || null;
}
export async function openReplay(msg = null) {
  const id = ++replayLoad;
  Object.assign(S, { screen: 'replay', replayPick: { loading: true, list: [], msg } }); render();
  const pin = streak ? streak.healable().map(dateOfDay) : []; // missed days whose replay heals the streak
  const list = (await replay.pick(async date => !!(await replayFile(date)), pin)).map(d => ({ ...d, puzzle: replayPuzzles.get(d.date) }));
  if (id !== replayLoad || S.screen !== 'replay') return; // superseded, or the player left the screen meanwhile
  S.replayPick = { loading: false, list, msg }; render();
}
export async function startReplay(date) {
  const puzzle = replayPuzzles.get(date);
  if (!puzzle || !(await replay.begin(date))) return openReplay('replay.unavailable'); // stale list: reload it
  S.size = puzzle.n;
  beginGame(puzzle, date, true);
}
