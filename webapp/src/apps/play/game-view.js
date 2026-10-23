// The game screen: its HUD, the notes of the variants, the board card and the buttons.
import { labelCount, cellCount } from '../../core/model.js';
import { sizeArg } from '../../features/share.js';
import { maxHints, HINT_PENALTY_S } from '../../features/hints.js';
import { loopOpen } from './board.js';
import { actionIcon, variantIcon } from './icons.js';
import { reached } from '../../features/twopaths-play.js';
import { variantById } from './variants.js';
import { t } from '../../ui/i18n.js';
import { flagsToHex, PLAY_FLAGS_INT } from '../../core/gen/flags.js';
import { $, S, replay, sec, statsLineT, store } from './state.js';
import { rulesTipHtml } from './popups.js';
import { boardMarkup } from './puzzle-kit.js';
import { luckyGameHtml } from './lucky-ui.js';
import { playStatsHtml } from './stats-html.js';

// Always-visible grade badge (one word + one number, 0-5): the trap grade (core/trap.js). Nothing is
// rendered when the puzzle couldn't be graded, rather than a misleading placeholder number.
function difficultyBadgeHtml() {
  const d = S.difficulty;
  if (!d || !d.ok) return '';
  const g = d.trap.grade;
  return `<span class="difficulty-badge">${t('grade.' + g)} · ${g}/5</span>`;
}
// Hold-V block: the trap grade's raw inputs, then the previous grades as before — decisionNodes (the old
// badge), B and crossPerSeg, each bucketed with its own calibration — and the raw numbers behind them.
// Hidden by default; same hold-to-reveal pattern as seedTag.
function difficultyDevHtml() {
  const d = S.difficulty, tm = d && d.trap, g = d && d.legacy;
  const reduced = ['arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon'].includes(S.variant);
  const trapPart = tm ? `trap ${tm.predicted.toFixed(2)} <span class="dev-raw">max ${tm.trapMax} · top3 ${tm.trapTop3}${reduced ? ' · max+top3 only, uncalibrated' : ` · alt ${tm.altFrac.toFixed(2)} · ladder trials ${tm.ladTrials}`}</span>` : '';
  const legacyPart = g
    ? `decisionNodes ${g.grades.decisionNodes}/5 · B ${g.grades.B}/5 · cross ${g.grades.crossPerSeg}/5 · <span class="dev-raw">decisionNodes ${g.raw.decisionNodes} · B ${g.raw.B.toFixed(2)} · cross/seg ${g.raw.crossPerSeg.toFixed(2)}</span>`
    : S.variant ? '' : 'old grades: ungraded (search capped)';
  const body = [trapPart, legacyPart].filter(Boolean).join(' · ') || 'ungraded';
  return `<span id="difficultyDev" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="trap: the badge score before it is cut into a grade, with its inputs (worst step's trap score, top-3 steps' sum, fraction of steps that have any wrong move, what-if guesses the technique ladder needed). Cutout: the same score without the alt term; One way arrows: only the max and top-3 terms, wrong moves being the ones the arrows allow (a ranking, not fitted to hand ratings). decisionNodes: the previous badge grade (solver branch points per cell). B: backtrack overhead (nodes/cells - 1) from the same solve. cross: how many non-adjacent checkpoint-to-checkpoint segments geometrically cross, per segment. Each old grade is graded 0-5 with its own calibration; the trap grade is fit to hand ratings. The design app shows all of them.">${body}</span>`;
}

// Loop: the line under the board. It reminds of the rule, says so when every cell is visited but the ring is
// not closed (the board also rings the two ends that should meet), and that the ring is closed once solved.
export const loopNoteKey = () => (S.finished ? 'game.loopClosed' : loopOpen(S.puzzle, S.path) ? 'game.loopOpen' : 'game.loopHint');
// Teleport: the line under the board, the rule in one sentence (the way to jump is not something
// to guess).
const teleportNoteHtml = () => (S.puzzle.portals
  ? `<p class="note teleport-note" id="teleportNote">${t('game.teleportHint')}</p>` : '');
// Two paths: how far each colour is, the one drawn now marked, and the rule in one sentence. The
// legend is kept current while drawing (refreshTwoLegend).
function twoLegendHtml() {
  const p = S.puzzle, done = reached(p, S.paths), total = [p.split, labelCount(p) - p.split];
  const chip = (c, name) => {
    const active = S.colour === c ? ' active' : '';
    return `<span class="two-chip two-${name}${active}"><i class="two-dot"></i>`
      + `${t('game.twopaths' + name[0].toUpperCase() + name.slice(1), done[c], total[c])}</span>`;
  };
  return chip(0, 'red') + chip(1, 'blue');
}
export function refreshTwoLegend() {
  const legend = $('twoLegend');
  if (legend) legend.innerHTML = twoLegendHtml();
}
const twoPathsNoteHtml = () => (S.puzzle.split
  ? `<div class="two-legend" id="twoLegend">${twoLegendHtml()}</div>`
    + `<p class="note two-note" id="twoNote">${t('game.twopathsHint')}</p>` : '');
function loopNoteHtml() {
  if (!S.puzzle.loop) return '';
  const open = !S.finished && loopOpen(S.puzzle, S.path);
  return `<p class="note loop-note${open ? ' error' : ''}" id="loopNote" role="status" aria-live="polite">${t(loopNoteKey())}</p>`;
}

// Exact: the step the head is on, out of all the cells (setupGridInput's setD keeps it current).
function stepHudHtml(p) {
  if (!p.exact) return '';
  const now = `<b id="hudStep">${S.path.length}</b>`;
  const step = `<div class="hud-step">${t('game.step', now, cellCount(p))}</div>`;
  return step;
}

// Hint button: free play shows it by default; a Game of the Day or the lucky game hides it unless V is held (setDevReveal).
export const hintShown = () => S.showDev || !(S.isGotd || S.lucky);

export function renderGame() {
  const p = S.puzzle;
  const time = sec(S.elapsed);
  const cap = maxHints(p);
  const seedText = S.variant ? `${S.variant} · ${S.seed == null ? 'shared' : 'seed ' + S.seed}${p.shape ? ' · ' + p.shape : ''}` : `seed ${S.seed} · flags ${flagsToHex(PLAY_FLAGS_INT)}`;
  const seedHint = S.variant ? variantById(S.variant).source + ' is seeded, but the app seeds it at random; a shared game carries its puzzle in the link.' : "Design app's Generate uses these same algorithm choices, but generate() here also tries several candidates and keeps the cheapest, so pasting this seed+flags there is not guaranteed to reproduce this exact puzzle";
  const seedTag = `<span id="seedTag" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="${seedHint}">${seedText}</span>`;
  const shapeName = p.shape ? t('shape.' + p.shape) : '';
  const localTitle = S.variant
    ? t(variantById(S.variant).keys[S.isShared ? 'sharedTitle' : 'title'], sizeArg({ variant: S.variant, n: p.n }), shapeName)
    : (S.isShared ? t('game.sharedTitle', p.n) : t('game.localTitle', p.n, S.gameIndex + 1));
  const title = S.isGotd ? t(S.isReplay ? 'game.replayTitle' : 'game.gotdTitle', S.gotdDate) : localTitle + seedTag;
  const canShare = S.finished;
  const shareButton = canShare ? `<button class="btn" id="shareBtn">${actionIcon('share')}${t('share.btn')}</button>` : '';
  const nextReplay = S.isReplay && S.finished && replay.chances() > 0 ? `<button class="btn" id="toReplay">${actionIcon('next')}${t('game.nextReplay', replay.chances())}</button>` : '';
  const newPuzzleButton = S.isGotd || S.lucky ? '' : `<button class="btn secondary" id="newPuzzle">${actionIcon('new')}${t('game.new')}</button>`;
  const hiddenUnlessDev = S.showDev ? '' : 'display:none';
  const hintDisabled = S.finished || S.hintsUsed >= cap ? 'disabled' : '';
  const gotdAttempt = S.isGotd ? store.attemptOn(S.gotdDate) : null; // today's record, or the replayed day's
  const gotdStats = S.finished && gotdAttempt && gotdAttempt.stats ? `<p class="note gotd-stats">${statsLineT(gotdAttempt.stats, S.showDev)}</p>` : '';
  const penalty = S.hintsUsed ? t('game.penalty', sec(HINT_PENALTY_S * S.hintsUsed), S.hintsUsed) : '';
  const solved = S.finished ? `<p class="solved">${t('game.solved', time, penalty)}</p>${gotdStats}` : '';

  return `
    <div class="game-layout">
      <section class="card board-card">
        <div class="hud">
          <div class="hud-title rules-host" id="hudTitle"><span class="hud-icon">${variantIcon(S.variant)}</span><span>${title}</span>${S.lucky ? `<span class="lucky-chip">${t('lucky.tag')}</span>` : ''}${rulesTipHtml()}</div>
          ${difficultyBadgeHtml()}
          ${difficultyDevHtml()}
          ${stepHudHtml(p)}
          <div class="hud-time">${t('game.time', `<b id="hudTime">${time}</b>`)}</div>
        </div>
        ${S.lucky && !S.finished ? `<p class="note lucky-once">${t(S.luckyHolder ? 'lucky.onceChance' : 'lucky.onceFun')}</p>` : ''}
        <div class="grid-wrap" id="gridWrap">${boardMarkup(S)}</div>
        ${loopNoteHtml()}
        ${teleportNoteHtml()}
        ${twoPathsNoteHtml()}
      </section>
      <div class="side">
        <section class="card actions">
          <div class="button-row">
            <button class="btn secondary" id="backMenu2">${actionIcon('menu')}${t('game.menu')}</button>
            ${newPuzzleButton}
            <button class="btn secondary" id="resetPath">${actionIcon('reset')}${t('game.reset')}</button>
            <button class="btn secondary" id="hintBtn" style="${hintShown() ? '' : 'display:none'}" ${hintDisabled}>${actionIcon('hint')}${t('game.hint', S.hintsUsed, cap)}</button>
            <button class="btn secondary" id="exportBtn" style="${hiddenUnlessDev}">Export</button>
          </div>
        </section>
        ${S.finished ? `<section class="card result-card">
          ${solved}
          ${luckyGameHtml()}
          <div class="button-row">${shareButton}${nextReplay}</div>
          <p class="small share-msg" id="shareMsg"></p>
        </section>` : ''}
      </div>
    </div>${playStatsHtml()}`;
}
