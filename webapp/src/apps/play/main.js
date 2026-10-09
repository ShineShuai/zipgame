import { serialize } from '../../core/format.js';
import { generate, PLAY_SIZES } from '../../core/gen/generate.js';
import { generateCutout, CUTOUT_MAX_MS } from '../../core/gen/cutout.js';
import { isSolved, step } from '../../core/rules.js';
import { statSummary } from '../../core/stats.js';
import { pickStorage } from '../../platform/storage.js';
import { runAsync } from '../../platform/run.js';
import { createStore } from '../../features/stats-store.js';
import { createDaily, fetchGameOfDay, fetchGameOfDayFor, utcDateString, utcDayNumber, dateOfDay } from '../../features/daily.js';
import { createReplay } from '../../features/replay.js';
import { createStreak, FREEZE_EVERY, FREEZE_MAX } from '../../features/streak.js';
import { ALGO_VERSION, maxNumber } from '../../core/model.js';
import { dailySeed } from '../../core/rng.js';
import { legsUndo, makeShareRecord, shareStatus, isPlayable, shareText, shareUrl, parseShareLink, stripText, dateLabel, dayOfDate } from '../../features/share.js';
import { REPLAY_DAYS } from '../../core/hist.js';
import { maxHints, computeHint, solutionOf, penalizedTime, HINT_PENALTY_S } from '../../features/hints.js';
import { cellAtPoint, pathD } from '../../view/geometry.js';
import { bindModal, copyText } from '../../ui/modal.js';
import { boardSvg, CELL, COLORS } from './board.js';
import { variantIcon, cardIcon, PUZZLE_TYPES } from './icons.js';
import { VERSION } from '../../version.js';
import { LEADERBOARD, BEHAVIOUR } from '../../config.js';
import { createLeaderboard, backendsFromConfig, submitAttempt } from '../../platform/leaderboard.js';
import { createBehaviour, sinksFromConfig } from '../../platform/behaviour.js';
import { rowFromGame, skillBucket } from '../../core/behaviour.js';
import { statsLine } from '../../core/hist.js';
import { t, getLang, setLang } from '../../ui/i18n.js';
import { PLAY_FLAGS_INT, flagsToHex } from '../../core/gen/flags.js';
import { playGradesFor } from '../../core/grades.js';
import { createPlayLog, newTrace, traceStep, traceClear, buildRecord } from '../../features/playlog.js';
import { sfxMove, sfxBack, sfxCheckpoint, sfxMoveAfterCheckpoint, sfxBlocked, sfxSolved, setSoundEnabled, isSoundEnabled } from '../../platform/sound.js';

const SIZES = PLAY_SIZES;
const S = { screen: 'menu', mode: 'standard', variant: null, genMode: 'standard', size: 7, puzzle: null, path: [], elapsed: 0, startTime: 0, timerId: null, finished: false,
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, isReplay: false, replayPick: null, gotdDate: null, gotdHint: null, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, showDev: false, behaviourOn: false, difficulty: null,
  legs: [], gameDay: null, isShared: false, shared: null, sharedBad: false, sharedMsg: null };

// Grade a puzzle right after generation, once, before it's shown (see core/grades.js playGradesFor):
//   trap   - the main grade (badge): one capped solve per wrong turn along the solution, ~2-200 ms at
//            play sizes; needs no reference solve, so it exists even for puzzles the reference solve caps on.
//   legacy - the previous calibrated grades (decisionNodes, B, crossPerSeg), one reference solve() plus a
//            free geometry pass; shown only on hold-V. null when that solve was capped (then hold-V says so).
// Never throws: a failed grade just means "grade unknown" — the puzzle is still perfectly playable.
function gradePuzzle(puzzle) {
  try {
    const { trap, legacy } = playGradesFor(puzzle);
    return { ok: trap.ok, trap: trap.ok ? trap : null, legacy };
  } catch (e) {
    console.warn('difficulty grading failed:', e);
    return { ok: false, trap: null, legacy: null };
  }
}
let storage, store, daily, replay, streak, modal, lb;
const replayPuzzles = new Map(), replayNoFile = new Set(); // date -> puzzle (the file of a past day never changes, so each is fetched once per page load); dates without a file
const $ = id => document.getElementById(id), today = () => utcDateString(new Date()), dayNo = () => utcDayNumber(new Date()), sec = x => x.toFixed(1) + 's';
const statsText = { everyone: (avg, n) => t('stats.everyone', avg, n), top: (k, avg) => t('stats.top', k, avg), beat: pct => t('stats.beat', pct) };
const statsLineT = (s, detail) => statsLine(s, detail, statsText);

// ---------- render ----------
function render() {
  const screens = { menu: renderMenu, generating: renderGenerating, game: renderGame, replay: renderReplay };
  const screen = screens[S.screen] || renderGame;
  $('app').innerHTML = screen() + devBadgeHtml();
  attachHandlers();
}

// Hidden unless the dev reveal is held (see setDevReveal).
function devBadgeHtml() {
  const display = S.showDev ? 'block' : 'none';
  return `<div id="versionBadge" class="dev-badge" style="display:${display}">Zip v${VERSION}</div>`;
}

function renderGenerating() {
  const gen = S.gen;
  const percent = Math.round(gen.frac * 100);
  const walls = gen.walls == null ? t('gen.searching') : t('gen.walls', gen.walls);
  // Players see only the percentage and the bar; the walls count and K appear while V is held.
  const devInfo = ` — ${walls}${gen.K == null ? '' : ` · K ${gen.K}`}`;
  return `
    <div class="center-stage">
      <section class="card">
        <div class="gen-icon">${variantIcon(S.genMode)}</div>
        <h2 class="card-title">${t('gen.title')}</h2>
        <p class="small">${t(S.genMode === 'cutout' ? 'gen.subCutout' : 'gen.sub', S.size)}</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <div style="width:${percent}%"></div>
        </div>
        <p class="small">${t('gen.progress', percent)}<span id="genDev" style="display:${S.showDev ? 'inline' : 'none'}">${devInfo}</span></p>
      </section>
    </div>`;
}

function refreshAttemptIfStale() {
  if (store.attemptDate() === today()) return;
  store.hydrateAttempt(today()).then(() => {
    if (S.screen === 'menu') render();
  });
}

// "next game #" per size, from the per-size daily counters
async function refreshNext() {
  const next = {};
  for (const n of SIZES) next[n] = (await daily.peek(n)).index;
  if (JSON.stringify(next) === JSON.stringify(S.nextIdx)) return;
  S.nextIdx = next;
  if (S.screen === 'menu') render();
}

const gameNo = n => (S.nextIdx[n] == null ? '-' : '#' + (S.nextIdx[n] + 1));

// Puzzle types (PUZZLE_TYPES in ./icons.js): 'standard', and the Cutout variant (core/gen/cutout.js). Cutout is random,
// with no daily sequence, no grade and no stats (yet); a shared Cutout carries its puzzle in the link.
// The menu offers both as two icon tiles (variantPickerHtml); the Game of Day is always a standard puzzle.
const todayText = () => (S.mode === 'cutout' ? '' : t('menu.today', gameNo(S.size)));
const randomSeed = () => (globalThis.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296));

// Two radio tiles, each an icon of the board it plays (full square / square with holes), a name and a tagline.
// Native radios: keyboard (arrows), screen readers and touch work without extra code; css/play.css draws the state.
function variantPickerHtml() {
  const tiles = PUZZLE_TYPES.map(mode => {
    const checked = mode === S.mode ? ' checked' : '';
    return `
        <label class="variant-opt">
          <input type="radio" name="variant" value="${mode}"${checked}>
          <span class="variant-card">
            ${variantIcon(mode)}
            <span class="variant-name">${t('mode.' + mode)}</span>
            <span class="variant-tag">${t('mode.' + mode + 'Tag')}</span>
          </span>
        </label>`;
  });
  return `
      <fieldset class="variant-picker">
        <legend class="field-label">${t('menu.mode')}</legend>
        <div class="variant-options">${tiles.join('')}
        </div>
      </fieldset>`;
}

// Dedicated Game-of-Day card: today's date, one button, the result once played, replay chances and streak.
function gotdCardHtml() {
  const attempt = store.attempt();
  const chances = replay.chances();
  const date = today();
  const playButton = attempt
    ? `<button class="btn" disabled title="${t('menu.gotdOnce')}">${t('gotd.play')}</button>`
    : `<button class="btn" id="playGotd">${t('gotd.play')}</button>`;
  const replayButton = chances > 0
    ? `<button class="btn secondary" id="openReplay">${t('menu.replay', chances)}</button>`
    : `<button class="btn secondary" disabled title="${t('replay.locked', replay.toNext())}">${t('menu.replay', 0)}</button>`;
  const attemptText = attempt && attempt.solved
    ? t('menu.attemptSolved', sec(attempt.time))
    : t('menu.attemptDone');
  const stats = attempt && attempt.stats
    ? `<br><span class="gotd-stats">${statsLineT(attempt.stats, S.showDev)}</span>`
    : '';
  const attemptNote = attempt ? `<p class="note">${attemptText}${stats}</p>` : '';
  const hintNote = S.gotdHint ? `<p class="note error">${t(...S.gotdHint)}</p>` : '';
  return `
      <section class="card gotd-card">
        <header class="card-head">
          <span class="card-badge">${cardIcon('gotd')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.gotd')}</h2>
            <p class="card-sub">${dateLabel(date)} · ${weekday(date)}</p>
          </div>
        </header>
        <p class="blurb">${t('gotd.blurb')}</p>
        <div class="button-row">
          ${playButton}
          ${replayButton}
        </div>
        ${attemptNote}
        ${hintNote}
        ${statusPanelHtml(chances, streak && streak.view())}
        ${BEHAVIOUR.enabled ? `<p class="small storage-note" id="behaviourNote" style="${S.showDev ? '' : 'display:none'}" title="For each solved game: the puzzle, your time and how many cells you took back. No name, no identifier. Games with a hint or a long time in a hidden tab are not sent.">Anonymous play stats: <a href="#" id="behaviourToggle">${S.behaviourOn ? 'on' : 'off'}</a></p>` : ''}
      </section>`;
}

// Free-play card: pick the puzzle type (icon tiles) and the grid size, then play. Both types are always on offer.
function freePlayCardHtml() {
  const sizeOptions = SIZES
    .map(n => `<option value="${n}"${n === S.size ? ' selected' : ''}>${n}x${n}</option>`)
    .join('');
  const storageNote = `Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}`;
  return `
      <section class="card">
        <header class="card-head">
          <span class="card-badge">${cardIcon('free')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.title')}</h2>
            <p class="card-sub">${t('menu.sub')}</p>
          </div>
        </header>
        ${variantPickerHtml()}
        <div class="field size-field">
          <label class="field-label" for="sizeSel">${t('menu.size')}</label>
          <select id="sizeSel">${sizeOptions}</select>
          <span class="small" id="gameNo">${todayText()}</span>
        </div>
        <div class="button-row">
          <button class="btn" id="playLocal">${t('menu.playLocal')}</button>
        </div>
        <p class="small storage-note" id="storageNote" style="${S.showDev ? '' : 'display:none'}">${storageNote}</p>
      </section>`;
}

function renderMenu() {
  refreshAttemptIfStale();
  refreshNext();
  return `
    <div class="menu-layout">
      ${sharedCardHtml()}
      <p class="menu-intro">${t('menu.blurb')}</p>
      <div class="menu-grid">${gotdCardHtml()}${freePlayCardHtml()}
      </div>
      ${menuStats()}
    </div>`;
}

const weekday = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short', timeZone: 'UTC' });

// Status panel under the menu buttons: two cards, each with a tooltip (hover on a desktop, tap on a phone; Esc or a tap elsewhere closes it).
//   replay card: chances left + dots for the solves made in the current price step; streak card: flame + days, 7 dots to the next reward, freeze slots.
const ICON = {
  replay: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg>',
  flame: '<svg class="stat-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 2 2 1 0-2-.5-4 1-6z"/></svg>',
  snow: '<svg class="freeze-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>',
};
const closeStatTips = () => document.querySelectorAll('.stat-item.open').forEach(b => b.classList.remove('open'));
function statusPanelHtml(chances, sv) { // sv: streak.view(), null before the streak is loaded
  const pips = (on, total, cls = '') => `<span class="pips ${cls}">${Array.from({ length: total }, (_, i) => `<i class="pip${i < on ? ' on' : ''}"></i>`).join('')}</span>`;
  const card = (cls, lines, body) => `
    <button type="button" class="stat-item ${cls}" aria-label="${lines.join(' ')}">
      ${body}
      <span class="stat-tip" role="tooltip">${lines.join('<br>')}</span>
    </button>`;
  const step = replay.step(), toNext = replay.toNext();
  const replayCard = card('stat-replay' + (chances > 0 ? ' ready' : ''), [t(chances > 0 ? 'replay.progress' : 'replay.locked', toNext)], `
      ${ICON.replay}
      <span class="stat-main">
        <span class="stat-top"><b>${chances}</b><small>${t('status.replays')}</small></span>
        ${pips(step.done, step.total)}
        <small class="stat-sub">${t('status.toGo', toNext)}</small>
      </span>`);
  if (!sv) return `<div class="status-panel">${replayCard}</div>`;
  const lines = [sv.streak > 0 ? t('streak.line', sv.streak, sv.freezes) + (sv.today ? '' : ' ' + t('streak.keep')) : t('streak.none'), t('streak.help', FREEZE_EVERY, FREEZE_MAX)];
  const streakCard = card('stat-streak' + (sv.streak > 0 ? (sv.today ? ' lit' : ' lit risk') : ''), lines, `
      ${ICON.flame}
      <span class="stat-main">
        <span class="stat-top"><b>${sv.streak}</b><small>${t('status.streak')}</small></span>
        ${pips(sv.streak > 0 ? ((sv.streak - 1) % FREEZE_EVERY) + 1 : 0, FREEZE_EVERY, 'week')}
        <span class="freezes">${Array.from({ length: FREEZE_MAX }, (_, i) => `<span class="freeze${i < sv.freezes ? ' on' : ''}">${ICON.snow}</span>`).join('')}</span>
      </span>`);
  return `<div class="status-panel">${replayCard}${streakCard}</div>`;
}

// Replay screen (opened by the menu's Replay button): up to REPLAY_SHOW dates, each a button: the missed days (newest first), then old solved days to repeat (slowest first), each with its earlier time. Every row shows its grid size, read from the puzzle file (static,
// cached per page load). One column on phones, as many 250 px columns as fit on a desktop (css/play.css). Row text is made of small chips that wrap as units.
function replayRowHtml({ date, puzzle, attempt }, canPlay) { // attempt: the stored record, null = missed (else abandoned, or solved = a day to repeat)
  const chips = [`${puzzle.n}x${puzzle.n}`, ...(attempt ? [attempt.solved ? t('replay.prev', sec(attempt.time)) : t('replay.abandoned')] : [])];
  return `
    <button class="replay-day" type="button" data-date="${date}"${canPlay ? '' : ' disabled'}>
      <span class="replay-top"><span class="replay-date">${dateLabel(date)} <small>${weekday(date)}</small></span><span class="replay-go">${t('replay.play')}</span></span>
      <span class="replay-meta">${chips.map(c => `<span>${c}</span>`).join('')}</span>
    </button>`;
}
function renderReplay() {
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

const gotdText = n => {
  const best = store.gotdBest(n);
  return best ? sec(best.time) : '-';
};

// "today / total" cells for one size (today = current UTC day).
function statCells(n) {
  const total = store.total(n);
  const today = store.today(n, dayNo());
  const t = statSummary(total);
  const d = statSummary(today);
  const value = (summary, x) => (summary.n ? x.toFixed(1) : '-');
  const best = stat => (stat.recent.length ? Math.min(...stat.recent).toFixed(1) : '-');
  return {
    solves: `${d.n} / ${t.n}`,
    avg: `${value(d, d.mean)} / ${value(t, t.mean)}`,
    sd: `${value(d, d.sd)} / ${value(t, t.sd)}`,
    best: `${best(today)} / ${best(total)}`,
  };
}

const STATS_HEAD = ['stats.grid', 'stats.next', 'stats.solves', 'stats.avg', 'stats.sd', 'stats.best', 'menu.gotd']; // i18n keys

// One row per size that has anything to show. On narrow screens each row becomes a small card, so the
// cells carry their column name in data-label.
function menuStats() {
  const rows = SIZES.map(n => {
    const hasData = store.total(n).n || store.gotdBest(n) || S.nextIdx[n];
    if (!hasData) return '';
    const c = statCells(n);
    const values = [`${n}x${n}`, gameNo(n), c.solves, c.avg, c.sd, c.best, gotdText(n)];
    const cells = values.map((value, i) => {
      const shown = i === 0 ? value : `<b>${value}</b>`;
      return `<td data-label="${t(STATS_HEAD[i])}">${shown}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  if (!rows) return '';

  const head = STATS_HEAD.map(key => `<th>${t(key)}</th>`).join('');
  return `
    <section class="card">
      <h2 class="card-title">${t('stats.title')}</h2>
      <p class="small">${t('stats.sub')}</p>
      <div class="table-scroll">
        <table class="responsive"><tr class="head-row">${head}</tr>${rows}</table>
      </div>
    </section>`;
}

function sizeStats(n) {
  if (!store.total(n).n && !store.gotdBest(n)) return '';
  const c = statCells(n);
  const row = (label, value) => `<tr><td>${label}</td><td><b>${value}</b></td></tr>`;
  return `
    <section class="card">
      <h2 class="card-title">${t('stats.titleN', n)}</h2>
      <p class="small">${t('stats.subN')}</p>
      <table>
        ${row(t('stats.solves'), c.solves)}
        ${row(t('stats.avgS'), c.avg)}
        ${row(t('stats.sdS'), c.sd)}
        ${row(t('stats.bestS'), c.best)}
        ${row(t('menu.gotd'), gotdText(n))}
      </table>
    </section>`;
}

// Always-visible grade badge (one word + one number, 0-5): the trap grade (core/trap.js). Nothing is
// rendered when the puzzle couldn't be graded, rather than a misleading placeholder number.
function difficultyBadgeHtml() {
  const d = S.difficulty;
  if (!d || !d.ok) return '';
  const g = d.trap.grade;
  return `<span class="difficulty-badge" title="${t('game.badgeTip', g)}">${t('grade.' + g)} · ${g}/5</span>`;
}
// Hold-V block: the trap grade's raw inputs, then the previous grades as before — decisionNodes (the old
// badge), B and crossPerSeg, each bucketed with its own calibration — and the raw numbers behind them.
// Hidden by default; same hold-to-reveal pattern as seedTag.
function difficultyDevHtml() {
  const d = S.difficulty, t = d && d.trap, g = d && d.legacy;
  const trapPart = t ? `trap ${t.predicted.toFixed(2)} <span class="dev-raw">max ${t.trapMax} · top3 ${t.trapTop3} · alt ${t.altFrac.toFixed(2)} · ladder trials ${t.ladTrials}</span> · ` : '';
  const legacyPart = g
    ? `decisionNodes ${g.grades.decisionNodes}/5 · B ${g.grades.B}/5 · cross ${g.grades.crossPerSeg}/5 · <span class="dev-raw">decisionNodes ${g.raw.decisionNodes} · B ${g.raw.B.toFixed(2)} · cross/seg ${g.raw.crossPerSeg.toFixed(2)}</span>`
    : 'old grades: ungraded (search capped)';
  const body = t || g ? trapPart + legacyPart : 'ungraded';
  return `<span id="difficultyDev" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="trap: the badge score before it is cut into a grade, with its inputs (worst step's trap score, top-3 steps' sum, fraction of steps that have any wrong move, what-if guesses the technique ladder needed). decisionNodes: the previous badge grade (solver branch points per cell). B: backtrack overhead (nodes/cells - 1) from the same solve. cross: how many non-adjacent checkpoint-to-checkpoint segments geometrically cross, per segment. Each old grade is graded 0-5 with its own calibration; the trap grade is fit to hand ratings. The design app shows all of them.">${body}${t || g ? ' · <a href="#" id="exportPlayLog" title="Download the play log (what you did on each puzzle: time, cells drawn and taken back), local to this device, for tools/playlog-eval.mjs">play log</a>' : ''}</span>`;
}

function renderGame() {
  const p = S.puzzle;
  const time = sec(S.elapsed);
  const cap = maxHints(p);
  const seedText = S.variant ? `cutout · ${S.seed == null ? 'shared' : 'seed ' + S.seed} · ${p.shape}` : `seed ${S.seed} · flags ${flagsToHex(PLAY_FLAGS_INT)}`;
  const seedHint = S.variant ? 'generateCutout (core/gen/cutout.js) is seeded, but the app seeds it at random; a shared game carries its puzzle in the link.' : "Design app's Generate uses these same algorithm choices, but generate() here also tries several candidates and keeps the cheapest, so pasting this seed+flags there is not guaranteed to reproduce this exact puzzle";
  const seedTag = `<span id="seedTag" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="${seedHint}">${seedText}</span>`;
  const shapeName = p.shape ? t('shape.' + p.shape) : '';
  const localTitle = S.variant
    ? t(S.isShared ? 'game.sharedCutoutTitle' : 'game.cutoutTitle', p.n, shapeName)
    : (S.isShared ? t('game.sharedTitle', p.n, S.gameIndex + 1, dateLabel(dateOfDay(S.gameDay))) : t('game.localTitle', p.n, S.gameIndex + 1));
  const title = S.isGotd ? t(S.isReplay ? 'game.replayTitle' : 'game.gotdTitle', S.gotdDate) : localTitle + seedTag;
  const canShare = S.finished && (S.isGotd || S.gameDay != null || S.variant);
  const shareButton = canShare ? `<button class="btn" id="shareBtn">${t('share.btn')}</button>` : '';
  const nextReplay = S.isReplay && S.finished && replay.chances() > 0 ? `<button class="btn" id="toReplay">${t('game.nextReplay', replay.chances())}</button>` : '';
  const newPuzzleButton = S.isGotd ? '' : `<button class="btn secondary" id="newPuzzle">${t('game.new')}</button>`;
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
          <div class="hud-title"><span class="hud-icon">${variantIcon(S.variant)}</span><span>${title}</span></div>
          ${difficultyBadgeHtml()}
          ${difficultyDevHtml()}
          <div class="hud-time">${t('game.time', `<b id="hudTime">${time}</b>`)}</div>
        </div>
        <div class="grid-wrap" id="gridWrap">${boardSvg(S)}</div>
      </section>
      <div class="side">
        <section class="card">
          <div class="button-row">
            ${shareButton}
            ${nextReplay}
            <button class="btn secondary" id="backMenu2">${t('game.menu')}</button>
            ${newPuzzleButton}
            <button class="btn secondary" id="resetPath">${t('game.reset')}</button>
            <button class="btn secondary" id="hintBtn" style="${hiddenUnlessDev}" ${hintDisabled}>Hint (${S.hintsUsed}/${cap})</button>
            <button class="btn secondary" id="exportBtn" style="${hiddenUnlessDev}">Export</button>
          </div>
          ${solved}
          ${canShare ? '<p class="small share-msg" id="shareMsg"></p>' : ''}
        </section>
        ${S.variant ? '' : sizeStats(p.n)}
      </div>
    </div>`;
}

// ---------- handlers ----------
function attachHandlers() {
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  on('playLocal', () => { S.size = +$('sizeSel').value; startLocal('open', S.mode); });
  const sel = $('sizeSel'); if (sel) sel.onchange = () => { S.size = +sel.value; $('gameNo').textContent = todayText(); };
  document.querySelectorAll('input[name="variant"]').forEach(input => {
    input.onchange = () => {
      S.mode = input.value;
      $('gameNo').textContent = todayText();
    };
  });
  on('playGotd', startGameOfDay);
  on('playShared', startShared);
  on('shareBtn', shareResult);
  on('shareTip', toggleShareTip);
  on('openReplay', () => openReplay());
  on('replayBack', () => { S.replayPick = null; S.screen = 'menu'; render(); });
  on('toReplay', () => openReplay());
  document.querySelectorAll('.replay-day').forEach(b => { b.onclick = () => startReplay(b.dataset.date); });
  document.querySelectorAll('.stat-item').forEach(b => { b.onclick = e => { e.stopPropagation(); const open = !b.classList.contains('open'); closeStatTips(); b.classList.toggle('open', open); }; });
  on('backMenu2', () => { logPlay(false); stopTimer(); S.screen = 'menu'; render(); });
  on('resetPath', () => { if (S.trace && !S.finished) traceClear(S.trace, S.path.length); if (!S.finished) legsUndo(S.legs, S.puzzle, S.path, 1); S.path = []; S.finished = false; S.hintCell = S.hintWrongCell = null; render(); });
  on('exportPlayLog', ev => { ev.preventDefault(); exportPlayLog(); });
  on('behaviourToggle', async ev => { ev.preventDefault(); S.behaviourOn = !S.behaviourOn; await behaviour.setOn(S.behaviourOn); render(); });
  on('newPuzzle', () => { if (!S.isGotd) startLocal('skip', S.variant || 'standard'); });
  on('exportBtn', () => { $('exportText').value = serialize(S.puzzle); $('exportMsg').textContent = ''; modal.open(); setTimeout(() => $('exportText').focus(), 30); });
  on('hintBtn', () => {
    if (S.finished || S.hintsUsed >= maxHints(S.puzzle)) return;
    const { correctCell, wrongCell } = computeHint(solutionOf(S.puzzle), S.path);
    if (correctCell == null) return;
    S.hintsUsed++; S.hintCell = correctCell; S.hintWrongCell = wrongCell; render();
  });
  const svg = document.querySelector('#gridWrap svg'); if (svg) setupGridInput(svg);
}

function setupGridInput(svg) {
  const p = S.puzzle, n = p.n, pathEl = svg.querySelector('[data-role="path"]');
  let dragging = false, last = null, rect = svg.getBoundingClientRect();
  // Highest checkpoint number crossed anywhere along the current path (0 = none yet, since
  // checkpoints are visited in ascending order this is just "how many crossed so far") — used to
  // pick a distinct, rising pitch for each post-checkpoint segment's moves. Recomputed from the
  // full path on every backtrack, since the head's own cell may not itself be a checkpoint.
  const highestCp = path => { let hi = 0; for (const c of path) if (p.cp[c] > hi) hi = p.cp[c]; return hi; };
  let segment = highestCp(S.path);
  const setD = () => pathEl.setAttribute('d', S.path.length > 1 ? pathD(n, S.path, CELL) : '');
  const fill = (i, visited) => {
    const badge = svg.querySelector(`[data-num-cell="${i}"]`);
    if (!badge) return;
    badge.querySelector('circle').setAttribute('fill', visited ? COLORS.number : COLORS.numberFill);
    badge.querySelector('text').setAttribute('fill', visited ? COLORS.numberVisitedText : COLORS.number);
  };
  const clearHint = () => { if (S.hintCell == null && S.hintWrongCell == null) return; S.hintCell = S.hintWrongCell = null; svg.querySelectorAll('[data-role="hint"],[data-role="hint-wrong"]').forEach(e => e.remove()); };
  const syncFills = () => { const on = new Set(S.path); svg.querySelectorAll('[data-num-cell]').forEach(g => fill(+g.dataset.numCell, on.has(+g.dataset.numCell))); };
  function walkTo(cell) {
    if (cell < 0 || S.finished || (p.holes && p.holes[cell])) return; // a hole is not part of the board
    const prev = S.path[S.path.length - 1], before = S.path.length, prevPath = S.path.slice(), kind = step(p, S.path, cell);
    if (kind && S.trace) traceStep(S.trace, kind, before, S.path.length);
    if (kind && kind !== 'push') legsUndo(S.legs, p, prevPath, S.path.length);
    if (!kind) { if (prev != null && cell !== prev) sfxBlocked(); return; }
    if (kind === 'push') fill(cell, true); else if (kind === 'pop') fill(prev, false); else syncFills();
    setD(); clearHint();
    if (kind === 'push' && isSolved(p, S.path)) { onSolved(); return; }
    if (kind === 'push') {
      const onCp = p.cp[cell] > 0;
      if (onCp) sfxCheckpoint(); else if (segment > 0) sfxMoveAfterCheckpoint(segment); else sfxMove();
      if (onCp) segment = p.cp[cell];
    } else if (kind === 'pop' || kind === 'trunc' || kind === 'reset') {
      sfxBack();
      segment = highestCp(S.path);
    }
  }
  function move(x, y) { // interpolate so fast drags don't skip cells
    const cell = (px, py) => cellAtPoint(n, px - rect.left, py - rect.top, rect.width, rect.height);
    if (last) {
      const dx = x - last.x, dy = y - last.y, stepPx = Math.max(2, rect.width / n / 2), k = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stepPx));
      for (let i = 1; i <= k; i++) walkTo(cell(last.x + dx * i / k, last.y + dy * i / k));
    } else walkTo(cell(x, y));
    last = { x, y };
  }
  svg.addEventListener('pointerdown', e => { e.preventDefault(); dragging = true; last = null; rect = svg.getBoundingClientRect(); try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ } move(e.clientX, e.clientY); });
  svg.addEventListener('pointermove', e => { if (!dragging) return; e.preventDefault(); move(e.clientX, e.clientY); });
  const up = e => { if (!dragging) return; dragging = false; last = null; try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ } render(); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}

// Play log (features/playlog.js): one record per puzzle, on the solve or when the puzzle is left unsolved. Local only.
let playlog = null, behaviour = null;
function logPlay(solved) {
  if (!playlog || !S.puzzle || S.variant || !S.trace || S.logged || S.screen !== 'game' || (!solved && S.trace.pushes < 2)) return;
  S.logged = true;
  const ms = S.timerId != null ? performance.now() - S.startTime : S.elapsed * 1000;
  const mode = S.isGotd ? (S.isReplay ? 'replay' : 'gotd') : 'local';
  const history = playlog.all(); // asked before add(): the skill bucket of the upload must not count this game
  playlog.add(buildRecord(S.puzzle, S.trace, { ms, solved, hints: S.hintsUsed, mode }));
  if (solved) uploadBehaviour(history, ms, mode);
}
// The anonymous behaviour row of a solved game (core/behaviour.js decides whether it is sent at all; platform/behaviour.js sends it).
// Everything of S is read now, before the await: the game state moves on. A Game of Day this device already solved is a repeat: not sent.
function uploadBehaviour(history, ms, mode) {
  if (!behaviour) return;
  const attempt = S.isGotd ? store.attemptOn(S.gotdDate) : null;
  const game = { puzzle: S.puzzle, mode, ms, hints: S.hintsUsed, hiddenMs: S.trace.hiddenMs, undone: S.trace.undone, maxUndone: S.trace.maxUndone,
    day: S.isGotd ? dayOfDate(S.gotdDate) : S.gameDay ?? dayNo(), variant: S.variant, shared: S.isShared, known: Boolean(attempt && attempt.solved) };
  history.then(h => { const row = rowFromGame({ ...game, skill: skillBucket(h) }, BEHAVIOUR); return row && behaviour.enqueue(row); })
    .catch(e => console.warn('behaviour upload skipped:', e));
}
async function exportPlayLog() {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([await playlog.exportJson()], { type: 'application/json' }));
  a.href = url; a.download = 'playlog.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onSolved() {
  logPlay(true); // before the hint penalty below: the log keeps the raw time
  if (streak) streak.record().then(milestone => milestone && replay.addBonus()); // every 7th streak day: one more replay chance
  S.finished = true; stopTimer(); sfxSolved();
  if (!S.penaltyApplied) { S.elapsed = penalizedTime(S.elapsed, S.hintsUsed); S.penaltyApplied = true; } // once, even if the path is reset and re-solved
  if (S.isGotd) { const a = store.attemptOn(S.gotdDate); if (!(a && a.solved)) finishGotd(S.puzzle.n, S.gotdDate, S.elapsed, S.isReplay); } // a Game of Day (live or replay) counts once
  else if (!S.variant) { // no stats and no daily counter for a variant yet
    const n = S.puzzle.n; store.recordSolve(n, dayNo(), S.elapsed); if (!S.isShared) daily.markSolved(n, S.gameIndex).then(refreshNext); }
}

// Game of Day (live or replay): record locally, count it towards the next replay chance, then submit to the averages backend
// (stats are stored in the attempt record, so no refetch is needed). A replay is submitted like the live game: it counts in that day's averages.
async function finishGotd(n, date, time, isReplay) {
  await store.recordGotd(n, date, time, lb.enabled, isReplay);
  await replay.addSolved();
  if (lb.enabled) await shareGotd(date);
}
// One submit round (platform/leaderboard.js submitAttempt): the attempt record says which backends already hold the solve.
async function shareGotd(date) {
  const saved = await submitAttempt(lb, store, date);
  if (saved && (S.screen === 'menu' || (S.screen === 'game' && S.isGotd && S.finished))) render();
}

// ---------- game flow ----------
function beginGame(puzzle, gotdDate, isReplay = false, isShared = false) {
  logPlay(false); // a puzzle left unfinished is logged as abandoned
  const variant = puzzle.holes ? 'cutout' : null; // only Cutout puzzles have holes
  const difficulty = variant ? null : gradePuzzle(puzzle); // a variant is not graded yet
  Object.assign(S, { variant, trace: newTrace(), legs: [], isShared, logged: false, puzzle, isGotd: !!gotdDate, isReplay, replayPick: null, gotdDate: gotdDate || null, path: [], finished: false, elapsed: 0, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, screen: 'game', gotdHint: null, difficulty });
  startTimer(); render();
}
const generateShown = (n, seed, mode = 'standard') => runAsync(mode === 'cutout' ? generateCutout(n, seed, { maxMs: CUTOUT_MAX_MS }) : generate(n, seed), { onEvent: e => { S.gen = { frac: e.frac == null ? S.gen.frac : e.frac, walls: e.walls, K: e.K }; if (S.screen === 'generating') render(); } });
async function startLocal(how, mode = 'standard') { // how: 'open' (Play local: current or next-if-solved) | 'skip' (New puzzle); a Cutout is always a new random one
  S.screen = 'generating'; S.genMode = mode; S.gen = { frac: 0, walls: null, K: null }; render();
  try {
    const { index, seed } = mode === 'cutout' ? { index: 0, seed: randomSeed() } : how === 'skip' ? await daily.skip(S.size) : await daily.open(S.size);
    const puzzle = await generateShown(S.size, seed, mode);
    S.gameIndex = index; S.seed = seed;
    S.gameDay = mode === 'cutout' ? null : [dayNo(), dayNo() - 1].find(d => dailySeed(d, S.size, index, ALGO_VERSION) === seed) ?? null; // the day this seed was made on: what a share link needs
    beginGame(puzzle, null);
  } catch (e) { console.error('startLocal failed:', e); S.screen = 'menu'; render(); alert(t('err.generate')); }
}
async function startGameOfDay() {
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
async function openReplay(msg = null) {
  const id = ++replayLoad;
  Object.assign(S, { screen: 'replay', replayPick: { loading: true, list: [], msg } }); render();
  const list = (await replay.pick(async date => !!(await replayFile(date)))).map(d => ({ ...d, puzzle: replayPuzzles.get(d.date) }));
  if (id !== replayLoad || S.screen !== 'replay') return; // superseded, or the player left the screen meanwhile
  S.replayPick = { loading: false, list, msg }; render();
}
async function startReplay(date) {
  const puzzle = replayPuzzles.get(date);
  if (!puzzle || !(await replay.begin(date))) return openReplay('replay.unavailable'); // stale list: reload it
  S.size = puzzle.n;
  beginGame(puzzle, date, true);
}
// ---------- sharing (features/share.js, core/share-code.js) ----------
// Finished game -> link with the result packed into `?s=`; opening such a link makes the menu's "Shared game" button playable.
const sharedStatus = rec => shareStatus(rec, {
  today: dayNo(),
  replayDates: replay.dates(),
  attempt: rec.kind === 'gotd' ? store.attemptOn(dateOfDay(rec.day)) : null,
  algo: ALGO_VERSION,
  sizes: SIZES,
});

function sharedStateText(state) {
  switch (state.status) {
    case 'replay': return t('share.freeReplay');
    case 'played': return state.attempt.solved ? t('share.st.played', sec(state.attempt.time)) : t('share.st.attempted');
    case 'old': return t('replay.unavailable');
    case 'future': return t('share.st.future');
    case 'version': return t('share.st.version');
    case 'invalid': return t('share.invalid');
    default: return '';
  }
}

const SHARED_BAD = ['old', 'future', 'version', 'invalid'];

// First card of the menu, only for a page opened from a share link:
//   eyebrow / title (what was shared) / one row: time, percent beaten, color strip + tip / reason or note | button
function sharedCardHtml() {
  if (S.sharedBad) {
    return `<section class="card shared-card"><div class="shared-main">
      <div class="shared-eyebrow">${t('share.title')}</div>
      <p class="shared-state bad">${t('share.invalid')}</p></div></section>`;
  }
  const rec = S.shared;
  if (!rec) return '';
  const state = sharedStatus(rec);
  const date = rec.variant ? '' : dateLabel(dateOfDay(rec.day));
  const head = rec.kind === 'gotd' ? t('share.gotd', date) : rec.variant ? t('share.cutout') + (rec.puzzle.shape ? ' · ' + t('shape.' + rec.puzzle.shape) : '') : t('share.local', rec.index + 1, date);
  const grade = rec.grade == null ? '' : ` · ${t('grade.' + rec.grade)} ${rec.grade}/5`;
  const row = [`<span>⏱ ${sec(rec.timeS)}</span>`];
  if (rec.pct != null) row.push(`<span>${t('share.beat', rec.pct)}</span>`);
  if (rec.levels.length) {
    row.push(`<span class="shared-strip-wrap"><span class="shared-strip">${stripText(rec.levels)}</span>
      <button type="button" class="tip-btn" id="shareTip" aria-expanded="false" aria-label="${t('share.tipLabel')}">i</button>
      <span class="tip-pop" id="shareTipPop" role="tooltip">${t('share.tip')}</span></span>`);
  }
  const text = S.sharedMsg ? t(S.sharedMsg) : sharedStateText(state);
  const bad = Boolean(S.sharedMsg) || SHARED_BAD.includes(state.status);
  const line = text ? `<p class="shared-state${bad ? ' bad' : ''}">${text}</p>` : '';
  return `<section class="card shared-card">
    <div class="shared-main">
      <div class="shared-eyebrow">${t('share.title')}</div>
      <h2 class="shared-title">
        <span class="shared-icon">${variantIcon(rec.variant)}</span>
        <span>${head} · ${rec.n}x${rec.n}${grade}</span>
      </h2>
      <div class="shared-row">${row.join('')}</div>
      ${line}
    </div>
    <div class="shared-action">
      <button class="btn" id="playShared"${isPlayable(state) ? '' : ' disabled'}>${t('share.play')}</button>
    </div>
  </section>`;
}

function setShareTip(open) {
  const pop = $('shareTipPop');
  const button = $('shareTip');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (!open) button.blur(); // a focused button would keep the tip visible (:focus-visible)
}

function toggleShareTip(ev) {
  ev.stopPropagation();
  setShareTip(!$('shareTipPop').classList.contains('open'));
}

async function loadSharedLink() {
  const { rec, bad } = parseShareLink(location.search);
  S.shared = rec;
  S.sharedBad = bad;
  if (rec && rec.kind === 'gotd') {
    await store.loadAttempt(dateOfDay(rec.day)); // so the menu can tell "already played" without waiting
  }
}

function clearSharedLink() {
  S.shared = null;
  S.sharedBad = false;
  S.sharedMsg = null;
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
}

// Menu button. A Game of Day counts like the real thing: today's date = the live game (once per day), a missed day of the
// replay window = a replay that spends no chance (the link is the ticket); both raise the Game-of-Day solve count.
// A local game is a plain local game of that seed; it leaves today's per-size counters alone.
async function startShared() {
  const rec = S.shared;
  if (!rec) return;
  const state = sharedStatus(rec);
  if (!isPlayable(state)) return render();
  S.sharedMsg = null;
  if (rec.kind === 'local') return startSharedLocal(rec);
  if (state.status === 'live') {
    await startGameOfDay();
  } else {
    const date = dateOfDay(rec.day);
    const puzzle = replayPuzzles.get(date) || await fetchGameOfDayFor(date);
    if (puzzle) replayPuzzles.set(date, puzzle);
    if (!puzzle || !(await replay.beginShared(date))) {
      S.sharedMsg = 'replay.unavailable';
      return render();
    }
    S.size = puzzle.n;
    beginGame(puzzle, date, true);
  }
  if (S.screen === 'game') clearSharedLink();
}

async function startSharedLocal(rec) {
  if (rec.variant) { // the link carries the puzzle: nothing to generate
    S.size = rec.n;
    Object.assign(S, { gameIndex: 0, seed: null, gameDay: null });
    beginGame({ ...rec.puzzle, shape: rec.puzzle.shape || undefined }, null, false, true);
    clearSharedLink();
    return;
  }
  S.screen = 'generating';
  S.size = rec.n;
  S.genMode = 'standard';
  S.gen = { frac: 0, walls: null, K: null };
  render();
  try {
    const seed = dailySeed(rec.day, rec.n, rec.index, rec.algo);
    const puzzle = await generateShown(rec.n, seed);
    Object.assign(S, { gameIndex: rec.index, seed, gameDay: rec.day });
    beginGame(puzzle, null, false, true);
    clearSharedLink();
  } catch (e) {
    console.error('startSharedLocal failed:', e);
    S.screen = 'menu';
    render();
    alert(t('err.generate'));
  }
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
    day: S.gameDay,
    index: S.gameIndex,
    algo: ALGO_VERSION,
    variant: S.variant,
    puzzle: S.puzzle,
    legs: S.legs,
    K: maxNumber(S.puzzle),
  });
}

// Share button (after a solve): the phone share sheet where there is one, else the clipboard, else a prompt to copy by hand.
async function shareResult() {
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

function startTimer() {
  stopTimer(); S.startTime = performance.now() - S.elapsed * 1000;
  S.timerId = setInterval(() => { S.elapsed = (performance.now() - S.startTime) / 1000; const el = $('hudTime'); if (el) el.textContent = sec(S.elapsed); }, 100);
}
function stopTimer() { if (S.timerId) { clearInterval(S.timerId); S.timerId = null; } }

// ---------- hidden dev reveal: hold "v" ----------
function setDevReveal(on) {
  if (S.showDev === on) return; S.showDev = on;
  const b = $('versionBadge'); if (b) b.style.display = on ? 'block' : 'none';
  const h = $('hintBtn'); if (h) h.style.display = on ? '' : 'none';
  const x = $('exportBtn'); if (x) x.style.display = on ? '' : 'none';
  const sn = $('storageNote'); if (sn) sn.style.display = on ? '' : 'none';
  const bn = $('behaviourNote'); if (bn) bn.style.display = on ? '' : 'none';
  const tag = $('seedTag'); if (tag) tag.style.display = on ? 'inline' : 'none';
  const d = $('difficultyDev'); if (d) d.style.display = on ? 'inline' : 'none';
  const g = $('genDev'); if (g) g.style.display = on ? 'inline' : 'none';
  const shown = S.screen === 'game' && S.isGotd ? store.attemptOn(S.gotdDate) : store.attempt(), st = shown && shown.stats;
  if (st) document.querySelectorAll('.gotd-stats').forEach(e => { e.textContent = statsLineT(st, on); });
}
// Time the tab is hidden during a game (the timer runs on): a game with much of it is not uploaded (BEHAVIOUR.hiddenMaxMs).
let hiddenAt = null;
function trackHidden() {
  if (document.hidden) { hiddenAt = performance.now(); return; }
  if (hiddenAt != null && S.trace && S.screen === 'game' && !S.finished) S.trace.hiddenMs += performance.now() - hiddenAt;
  hiddenAt = null;
}
function installDevReveal() {
  const typing = t => t && t.tagName && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  addEventListener('keydown', e => { if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) setDevReveal(true); });
  addEventListener('keyup', e => { if (e.key === 'v' || e.key === 'V') setDevReveal(false); });
  addEventListener('blur', () => setDevReveal(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setDevReveal(false); trackHidden(); });
}

// ---------- sound toggle (lives in the app bar, outside #app — wired once, not by render()) ----------
function applySoundButtonState() {
  const b = $('soundToggle'); if (!b) return;
  const muted = !isSoundEnabled();
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-pressed', String(!muted));
  const label = t(muted ? 'sound.unmute' : 'sound.mute');
  b.setAttribute('aria-label', label);
  b.title = label;
}
async function initSoundToggle() {
  const saved = await storage.get('sound-muted');
  setSoundEnabled(!(saved && saved.value === '1'));
  applySoundButtonState();
  $('soundToggle').onclick = () => {
    setSoundEnabled(!isSoundEnabled());
    applySoundButtonState();
    storage.set('sound-muted', isSoundEnabled() ? '0' : '1');
    if (isSoundEnabled()) sfxMove(); // quick audible confirmation it's back on
  };
}

// ---------- language toggle (app bar, outside #app — wired once; a switch re-renders #app) ----------
function applyLang() {
  const lang = getLang(), b = $('langToggle');
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelector('.brand').setAttribute('aria-label', t('brand.home'));
  b.dataset.on = lang;
  b.setAttribute('aria-label', t('lang.switch'));
  b.title = t('lang.switch');
  applySoundButtonState();
}
async function initLang() {
  const saved = await storage.get('lang');
  setLang(saved ? saved.value : /^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  applyLang();
  $('langToggle').onclick = () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    storage.set('lang', getLang());
    applyLang(); render();
  };
}

// ---------- boot ----------
(async function boot() {
  storage = await pickStorage(); store = createStore(storage, SIZES); daily = createDaily(storage); playlog = createPlayLog(storage);
  try { await store.hydrate(today()); } catch (e) { console.warn('stats hydration failed:', e); }
  lb = createLeaderboard(backendsFromConfig(LEADERBOARD, new URLSearchParams(location.search).get('lb')));
  replay = createReplay(storage, store);
  try { await replay.init(); } catch (e) { console.warn('replay init failed:', e); }
  streak = createStreak(storage, playlog);
  try { await streak.init(); } catch (e) { console.warn('streak init failed:', e); }
  if (lb.enabled) for (const { date } of await replay.unsent()) shareGotd(date); // today's and replayed days whose submit never got an answer
  behaviour = createBehaviour({ storage, cfg: BEHAVIOUR, sinks: sinksFromConfig(BEHAVIOUR, LEADERBOARD) });
  try { S.behaviourOn = await behaviour.isOn(); behaviour.flush().catch(() => {}); } catch (e) { console.warn('behaviour init failed:', e); } // rows left from an earlier page load
  try { for (const n of SIZES) S.nextIdx[n] = (await daily.peek(n)).index; } catch (e) { console.warn('daily counters failed:', e); }
  await loadSharedLink();
  document.addEventListener('click', () => { setShareTip(false); closeStatTips(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { setShareTip(false); closeStatTips(); } });
  modal = bindModal($('exportModal'));
  $('exportClose').onclick = modal.close; $('exportCopy').onclick = () => copyText($('exportText'), $('exportMsg'));
  installDevReveal(); await initSoundToggle(); await initLang(); render();
})();
