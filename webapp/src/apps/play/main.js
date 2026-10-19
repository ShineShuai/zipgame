import { serialize } from '../../core/format.js';
import {
  step as surfaceStep, isSolved as surfaceSolved, serializeSurface,
} from '../../core/surface/puzzle.js';
import { generate, PLAY_SIZES } from '../../core/gen/generate.js';
import { edgeId, arrowAllows } from '../../core/edges.js';
import { isSolved, step, gridAdjacent } from '../../core/rules.js';
import { statSummary } from '../../core/stats.js';
import { pickStorage, usage } from '../../platform/storage.js';
import { runAsync } from '../../platform/run.js';
import { createStore } from '../../features/stats-store.js';
import { createDaily, scopeKey, fetchGameOfDay, fetchGameOfDayFor, utcDateString, utcDayNumber, dateOfDay } from '../../features/daily.js';
import { createReplay } from '../../features/replay.js';
import { createStreak, FREEZE_EVERY, FREEZE_MAX, HEAL_DAYS, RAMP } from '../../features/streak.js';
import { ALGO_VERSION, cellCount, labelCount, labelRanks } from '../../core/model.js';
import { dailySeed } from '../../core/rng.js';
import { legsUndo, makeShareRecord, shareStatus, isPlayable, isSpent, shareText, shareUrl, parseShareLink, stripText, dateLabel, dayOfDate, sizeArg } from '../../features/share.js';
import { createSharedGames } from '../../features/shared-games.js';
import { REPLAY_DAYS } from '../../core/hist.js';
import { maxHints, computeHint, solutionOf, penalizedTime, HINT_PENALTY_S } from '../../features/hints.js';
import { cellAtPoint, WRAP_PAD } from '../../view/geometry.js';
import { bindModal, copyText } from '../../ui/modal.js';
import {
  boardSvg, CELL, badgeColors, badgeColorsTwo, stepWrong, seamMarksSvg, routeCells, routeD,
  jumpMarksSvg, loopOpen, loopOpenMarks,
} from './board.js';
import { variantIcon, cardIcon } from './icons.js';
import {
  pentagonBoardSvg, pentagonRouteD, pentagonCellAt, pentagonPoint, pentagonAcross,
} from './pentagon-board.js';
import {
  newPaths, pickColour, walkColour, solvedPaths, reached, legsUndoTwo, hintTwo,
} from '../../features/twopaths-play.js';
import { PLAY_VARIANTS, variantById, variantOf, sizesFor, nearestSize, luckyDefs } from './variants.js';
import { createUnlock } from '../../features/unlock.js';
import { createRulesSeen } from '../../features/rules-seen.js';
import { weekOf, weekTable } from '../../core/lucky.js';
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
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, isReplay: false, replayPick: null, gotdDate: null, gotdHint: null, hintsUsed: 0,
  penaltyApplied: false, hintCell: null, hintWrongCell: null, showDev: false, behaviourOn: false, difficulty: null,
  lucky: false, luckyHolder: false, luckyResult: null, luckyNote: null, healed: false,
  legs: [], paths: [[], []], colour: 0, gameDay: null, isShared: false,
  sharedGames: [], sharedFocus: null, sharedAll: false, sharedArmed: null, sharedNotice: null, sharedMsg: null };

// A Pentagon puzzle (puzzle.surface, core/surface) walks, is solved and is drawn by the surface rules
// and its own board (pentagon-board.js); the size n is a board id there, shown as the number of cells.
const stepOf = (p, path, cell) => (p.surface ? surfaceStep(p, path, cell) : step(p, path, cell));
const solvedOf = (p, path) => (p.surface ? surfaceSolved(p, path) : isSolved(p, path));
const boardMarkup = state => (state.puzzle.surface ? pentagonBoardSvg(state) : boardSvg(state));
const routeOf = (p, line) => (p.surface ? pentagonRouteD(p, line) : routeD(p, line));
// What a size is called: 7x7 on a square board, 36 cells on a Pentagon board.
const sizeLabel = (variant, n) => (variant === 'pentagon' ? t('size.cells', sizeArg({ variant, n })) : `${n}x${n}`);

// Grade a puzzle right after generation, once, before it's shown (see core/grades.js playGradesFor):
//   trap   - the main grade (badge): one capped solve per wrong turn along the solution, ~2-200 ms at
//            play sizes; needs no reference solve, so it exists even for puzzles the reference solve caps on.
//   legacy - the previous calibrated grades (decisionNodes, B, crossPerSeg), one reference solve() plus a
//            free geometry pass; shown only on hold-V. null when that solve was capped (then hold-V says so), and for a
//            variant (Cutout, One way arrows): it gets the trap grade only, scored by the model that fits it (core/trap.js modelFor).
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
let storage, store, daily, replay, streak, unlock, rulesSeen, shared, modal, lb;
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

const GEN_SUB = { cutout: 'gen.subCutout', arrows: 'gen.subArrows' }; // the texts under the title, per type

function renderGenerating() {
  const gen = S.gen;
  const percent = Math.round(gen.frac * 100);
  const genVariant = variantById(S.genMode);
  const countKey = genVariant ? genVariant.countKey : 'gen.walls';
  const walls = gen.walls == null ? t('gen.searching') : t(countKey, gen.walls);
  // Players see only the percentage and the bar; the walls count and K appear while V is held.
  const devInfo = ` — ${walls}${gen.K == null ? '' : ` · K ${gen.K}`}`;
  return `
    <div class="center-stage">
      <section class="card">
        <div class="gen-icon">${variantIcon(S.genMode)}</div>
        <h2 class="card-title">${t('gen.title')}</h2>
        <p class="small">${t(genVariant ? genVariant.keys.gen : 'gen.sub', sizeArg({ variant: S.genMode, n: S.size }))}</p>
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
// Keys of S.nextIdx: scopeKey(n, scope), scope '' = standard, else the variant id (each variant counts its own games).
const scopes = () => ['', ...PLAY_VARIANTS.map(v => v.id)];
const scopeSizes = scope => (scope ? sizesFor(scope, SIZES) : SIZES);
async function peekNext() {
  const next = {};
  for (const scope of scopes()) for (const n of scopeSizes(scope)) next[scopeKey(n, scope)] = (await daily.peek(n, scope)).index;
  return next;
}
async function refreshNext() {
  const next = await peekNext();
  if (JSON.stringify(next) === JSON.stringify(S.nextIdx)) return;
  S.nextIdx = next;
  if (S.screen === 'menu') render();
}

const gameNo = (n, scope = '') => { const i = S.nextIdx[scopeKey(n, scope)]; return i == null ? '-' : '#' + (i + 1); };

// Puzzle types: 'standard' and the variants of ./variants.js (Cutout, core/gen/cutout.js; One way arrows,
// core/gen/arrows.js). A variant is random, with no daily sequence (its counter only counts the day's games); it has its own grade
// (core/trap.js modelFor) and stats, per variant and size; a shared one carries its puzzle in the link. A variant is hidden until the player has unlocked it (features/unlock.js: the lucky game);
// hold V shows them all. The menu offers the shown ones as icon tiles (variantPickerHtml); the Game of Day is always
// a standard puzzle.
const todayText = () => t('menu.today', gameNo(S.size, S.mode === 'standard' ? '' : S.mode));
const randomSeed = () => (globalThis.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296));
const randomInt = n => Math.floor(randomSeed() / 4294967296 * n); // 0..n-1

// Radio tiles, each an icon of the board it plays (full square, square with holes, ...), a name and a tagline.
// Native radios: keyboard (arrows), screen readers and touch work without extra code; css/play.css draws the state.
// A locked variant is in the markup from the start (setDevReveal shows it while V is held, dashed and marked with a
// lock); once it has been picked it stays until the page is reloaded.
const isUnlocked = mode => mode === 'standard' || Boolean(unlock && unlock.unlocked(mode));
const typeShown = mode => isUnlocked(mode) || S.showDev || S.mode === mode;

function variantPickerHtml() {
  const tiles = ['standard', ...PLAY_VARIANTS.map(v => v.id)].map(mode => {
    const checked = mode === S.mode ? ' checked' : '';
    const locked = isUnlocked(mode) ? '' : ' variant-locked';
    const style = typeShown(mode) ? '' : ' style="display:none"';
    return `
        <label class="variant-opt${locked}" id="variantOpt-${mode}"${style}>
          <input type="radio" name="variant" value="${mode}" aria-describedby="variantRules-${mode}"${checked}>
          <span class="variant-card">
            ${variantIcon(mode)}
            <span class="variant-name">${t('mode.' + mode)}</span>
            <span class="variant-tag">${t('mode.' + mode + 'Tag')}</span>
          </span>
          <span class="variant-rules" id="variantRules-${mode}" role="tooltip">${t('mode.' + mode + 'Rules')}</span>
        </label>`;
  });
  return `
      <fieldset class="variant-picker">
        <legend class="field-label">${t('menu.mode')}</legend>
        <div class="variant-options">${tiles.join('')}
        </div>
      </fieldset>`;
}

// ---------- unlockable variants: the lucky game (features/unlock.js, core/lucky.js) ----------
const unlockView = () => (unlock ? unlock.view() : null);
const luckyDate = day => { const d = dateOfDay(day); return `${weekday(d)} ${dateLabel(d)}`; };
const peakText = n => new Intl.NumberFormat(getLang() === 'zh' ? 'zh-CN' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

// The (i) next to the lucky game: how the lucky day is chosen, with the seven days of the week of the open offer (else of
// the next lucky day), their Collatz peaks and the winner.
function luckyTipHtml(v) {
  const rows = weekTable(weekOf(v.open ? v.offer : v.nextLucky));
  const dayName = r => { const d = dateOfDay(r.day); return `${weekday(d)} ${+d.slice(6)}`; };
  const cells = rows.map(r => `<span class="${r.lucky ? 'win' : ''}"><b>${dayName(r)}</b><small>${peakText(r.peak)}</small></span>`);
  const winner = rows.find(r => r.lucky).day;
  return `<button type="button" class="tip-btn" id="luckyTip" aria-expanded="false" aria-label="${t('lucky.how')}">i</button>
      <span class="tip-pop" id="luckyTipPop" role="tooltip"><b>${t('lucky.how')}</b><br>${t('lucky.howText')}<br>${t('lucky.week', luckyDate(rows[0].day), luckyDate(rows[6].day))}<span class="lucky-week">${cells.join('')}</span>${t('lucky.winner', luckyDate(winner))}<br>${t('unlock.tip.chance')} ${t('unlock.tip.streak')}</span>`;
}

// A streak reward to claim: a replay chance or an unlock chance (only a replay once every variant is unlocked).
function rewardRowHtml(v) {
  const unlockButton = v.allUnlocked ? '' : `<button class="btn" id="rewardUnlock">${t('reward.unlock')}</button>`;
  return `
    <div class="lucky-row reward">
      <div class="lucky-text"><b>${t('reward.title')}</b><small>${t('reward.pick')}</small></div>
      <div class="reward-buttons"><button class="btn secondary" id="rewardReplay">${t('reward.replay')}</button>${unlockButton}</div>
    </div>`;
}

// Top of the free-play card, one block: a streak reward to claim (replay or unlock chance), and the lucky game with the
// unlock chances the player holds. The lucky game is open to everyone until the next lucky day; once played, the date of
// the next one.
function luckyBoxHtml() {
  const v = unlockView();
  if (!v) return '';
  const rows = [];
  if (S.luckyNote) rows.push(`<p class="note error">${t(S.luckyNote)}</p>`);
  if (v.choices > 0) rows.push(rewardRowHtml(v));
  if (!v.allUnlocked) {
    const text = v.open ? t(v.tokens > 0 ? 'lucky.readyChance' : 'lucky.readyFun', luckyDate(v.offerLast))
      : t('lucky.used', v.daysToNext, luckyDate(v.nextLucky));
    const play = v.open ? `<button class="btn" id="playLucky">${t('lucky.play')}</button>` : '';
    rows.push(`
    <div class="lucky-row">
      <span class="lucky-icon">${variantIcon('lucky')}</span>
      <div class="lucky-text">
        <span class="lucky-head"><b>${t('lucky.title')}</b><span class="lucky-chances${v.tokens > 0 ? ' has' : ''}">${ICON.unlock}${t('lucky.chances', v.tokens)}</span></span>
        <small>${text}</small>
      </div>
      ${luckyTipHtml(v)}${play}
    </div>`);
  }
  return rows.length ? `<div class="lucky-box${v.open && !v.allUnlocked ? ' ready' : ''}">${rows.join('')}</div>` : '';
}

// Under the game after a solve: what the lucky game unlocked (or why not), a streak reward to claim.
function luckyGameHtml() {
  if (!S.finished) return '';
  const parts = [], r = S.luckyResult, v = unlockView();
  if (r && r.solved) {
    const key = r.newly ? 'lucky.unlocked' : unlock.unlocked(r.id) ? 'lucky.already' : 'lucky.noChance';
    parts.push(`<div class="lucky-result${r.newly ? '' : ' same'}">${variantIcon(r.id)}<span>${t(key, t(variantById(r.id).keys.name))}</span></div>`);
  }
  if (S.healed) parts.push(`<div class="lucky-result heal"><span>${t('streak.healed')}</span></div>`);
  if (v && v.choices > 0) parts.push(rewardRowHtml(v));
  return parts.join('');
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

// Free-play card: pick the puzzle type (icon tiles) and the grid size, then play. Standard is always on offer, a variant once unlocked.
// The grid sizes on offer for the picked puzzle type (sizesFor in ./variants.js); S.size moves to the nearest one on offer.
function sizeOptionsHtml() {
  const sizes = sizesFor(S.mode, SIZES);
  if (!sizes.includes(S.size)) S.size = nearestSize(S.size, sizes);
  return sizes.map(n => `<option value="${n}"${n === S.size ? ' selected' : ''}>${sizeLabel(S.mode, n)}</option>`).join('');
}

// The dev note (hold V): storage kind, what the app keeps on this device (measured when V is pressed; ~2 bytes a char), refused writes, unlock state.
let storageUsed = '';
function storageNoteText() {
  const uv = unlockView();
  const unlockDev = uv ? ` · unlock: ${uv.tokens} chance(s), lucky game ${uv.open ? 'open' : 'played'}, next lucky day in ${uv.daysToNext}` : '';
  const refused = storage.refused && storage.refused.size ? ` · writes refused: ${[...storage.refused].join(', ')}` : '';
  return `Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}${storageUsed}${refused}${unlockDev}`;
}
function freePlayCardHtml() {
  const sizeOptions = sizeOptionsHtml();
  const storageNote = storageNoteText();
  return `
      <section class="card">
        <header class="card-head">
          <span class="card-badge">${cardIcon('free')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.title')}</h2>
            <p class="card-sub">${t('menu.sub')}</p>
          </div>
        </header>
        ${luckyBoxHtml()}
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
  pruneShared();
  return `
    <div class="menu-layout">
      ${sharedCardHtml()}
      <p class="menu-intro">${t('menu.blurb')}</p>
      <div class="menu-grid">${gotdCardHtml()}${freePlayCardHtml()}
      </div>
    </div>`;
}

const weekday = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short', timeZone: 'UTC' });

// Status panel under the menu buttons: two cards, each with a tooltip (hover on a desktop, tap on a phone; Esc or a tap elsewhere closes it).
//   replay card: chances left + dots for the solves made in the current price step; streak card: flame + days, 7 dots to the next reward, freeze slots.
const ICON = {
  replay: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg>',
  flame: '<svg class="stat-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 2 2 1 0-2-.5-4 1-6z"/></svg>',
  unlock: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.5-1.5"/></svg>',
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
  const heals = streak ? streak.healable().length : 0, pg = sv && streak.progress();
  const lines = sv && [sv.streak > 0 ? t('streak.line', sv.streak, sv.freezes) + (sv.today ? '' : ' ' + t('streak.keep')) : t('streak.none'),
    t('streak.next', pg.left), ...(heals ? [t('streak.repair', heals)] : []), t('streak.help', RAMP.join(','), FREEZE_EVERY, FREEZE_MAX, HEAL_DAYS)];
  const streakCard = sv ? card('stat-streak' + (sv.streak > 0 ? (sv.today ? ' lit' : ' lit risk') : ''), lines, `
      ${ICON.flame}
      <span class="stat-main">
        <span class="stat-top"><b>${sv.streak}</b><small>${t('status.streak')}</small></span>
        ${pips(pg.on, pg.total, 'week')}
        <span class="freezes">${Array.from({ length: FREEZE_MAX }, (_, i) => `<span class="freeze${i < sv.freezes ? ' on' : ''}">${ICON.snow}</span>`).join('')}</span>
      </span>`) : '';
  return `<div class="status-panel">${replayCard}${streakCard}</div>`;
}

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
function statCells(n, scope = '') {
  const total = store.total(n, scope);
  const today = store.today(n, dayNo(), scope);
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

// Stats are shown under the game being played, for its kind of puzzle (the menu shows none):
//   a standard puzzle (random or shared local game): the local stats of every grid size;
//   a Game of Day (live or replay): the Game of Day time of every grid size;
//   a variant (Cutout, One way arrows, the lucky game): its own local stats, per grid size, with its own daily counter.
// On narrow screens each row becomes a small card, so the cells carry their column name in data-label.
const statsTable = (title, sub, head, rows) => `
    <section class="card play-stats">
      <h2 class="card-title">${title}</h2>
      <p class="small">${sub}</p>
      <div class="table-scroll">
        <table class="responsive"><tr class="head-row">${head.map(key => `<th>${t(key)}</th>`).join('')}</tr>${rows}</table>
      </div>
    </section>`;
const statsRow = (cells, keys, current) => `<tr${current ? ' class="current"' : ''}>${cells.map((value, i) =>
  `<td data-label="${t(keys[i])}">${i === 0 ? value : `<b>${value}</b>`}</td>`).join('')}</tr>`;

const LOCAL_HEAD = ['stats.grid', 'stats.next', 'stats.solves', 'stats.avg', 'stats.sd', 'stats.best']; // i18n keys
function localStatsHtml(scope = '') {
  const rows = scopeSizes(scope).filter(n => store.total(n, scope).n || S.nextIdx[scopeKey(n, scope)] || n === S.puzzle.n).map(n => {
    const c = statCells(n, scope);
    return statsRow([sizeLabel(scope, n), gameNo(n, scope), c.solves, c.avg, c.sd, c.best], LOCAL_HEAD, n === S.puzzle.n);
  }).join('');
  return statsTable(scope ? t('stats.variantTitle', t('mode.' + scope)) : t('stats.title'), t('stats.sub'), LOCAL_HEAD, rows);
}

const GOTD_HEAD = ['stats.grid', 'stats.date', 'stats.time'];
function gotdStatsHtml() {
  const rows = SIZES.filter(n => store.gotdBest(n) || n === S.puzzle.n).map(n => {
    const best = store.gotdBest(n);
    return statsRow([`${n}x${n}`, best ? dateLabel(best.date) : '-', best ? sec(best.time) : '-'], GOTD_HEAD, n === S.puzzle.n);
  }).join('');
  return statsTable(t('stats.gotdTitle'), t('stats.gotdSub'), GOTD_HEAD, rows);
}

const playStatsHtml = () => (S.isGotd ? gotdStatsHtml() : localStatsHtml(S.variant || ''));

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
const loopNoteKey = () => (S.finished ? 'game.loopClosed' : loopOpen(S.puzzle, S.path) ? 'game.loopOpen' : 'game.loopHint');
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
function refreshTwoLegend() {
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

const VARIANT_TITLE = { cutout: ['game.cutoutTitle', 'game.sharedCutoutTitle'], arrows: ['game.arrowsTitle', 'game.sharedArrowsTitle'] };

// Hint button: free play shows it by default; a Game of the Day or the lucky game hides it unless V is held (setDevReveal).
const hintShown = () => S.showDev || !(S.isGotd || S.lucky);

function renderGame() {
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
  const shareButton = canShare ? `<button class="btn" id="shareBtn">${t('share.btn')}</button>` : '';
  const nextReplay = S.isReplay && S.finished && replay.chances() > 0 ? `<button class="btn" id="toReplay">${t('game.nextReplay', replay.chances())}</button>` : '';
  const newPuzzleButton = S.isGotd || S.lucky ? '' : `<button class="btn secondary" id="newPuzzle">${t('game.new')}</button>`;
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
        <section class="card">
          <div class="button-row">
            ${shareButton}
            ${nextReplay}
            <button class="btn secondary" id="backMenu2">${t('game.menu')}</button>
            ${newPuzzleButton}
            <button class="btn secondary" id="resetPath">${t('game.reset')}</button>
            <button class="btn secondary" id="hintBtn" style="${hintShown() ? '' : 'display:none'}" ${hintDisabled}>${t('game.hint', S.hintsUsed, cap)}</button>
            <button class="btn secondary" id="exportBtn" style="${hiddenUnlessDev}">Export</button>
          </div>
          ${solved}
          ${luckyGameHtml()}
          ${canShare ? '<p class="small share-msg" id="shareMsg"></p>' : ''}
        </section>
      </div>
    </div>${playStatsHtml()}`;
}

// The rules of the puzzle being played, as a small (i) after the title in the game screen: the same tooltip as the
// type's tile in the menu (the text is the tile's), so a player can look the rules up while playing. The first time a
// variant is played it opens by itself (maybeShowRules).
function rulesTipHtml() {
  const mode = S.variant || 'standard';
  return `<button type="button" class="tip-btn rules-btn" id="rulesTip" aria-label="${t('game.rulesLabel')}" aria-describedby="rulesTipPop">i</button>`
    + `<span class="variant-rules" id="rulesTipPop" role="tooltip"><b>${t('mode.' + mode)}</b><br>${t('mode.' + mode + 'Rules')}</span>`;
}
// The first game of a variant on this device shows its rules without being asked, once. It closes like any rules
// tooltip: by a press anywhere else (the first press on the board starts the path), a tap, or Esc.
function maybeShowRules() {
  if (!S.variant || !rulesSeen || rulesSeen.seen(S.variant) || !$('hudTitle')) return;
  rulesSeen.mark(S.variant);
  showRules($('hudTitle'));
}

// The rules tooltip of a puzzle type tile (and of the game screen's title): shown on hover, keyboard focus or a tap, and moved sideways to stay
// inside the window (a tile at the edge of the card). Esc or a tap elsewhere closes it.
let lastPointer = 'mouse'; // pointerType of the last press: 'mouse', 'pen' or 'touch'
const closeRules = () => document.querySelectorAll('.variant-rules.show').forEach(pop => pop.classList.remove('show'));
function showRules(opt) {
  closeRules();
  const pop = opt.querySelector('.variant-rules');
  pop.style.transform = 'translateX(-50%)';
  pop.classList.add('show');
  const r = pop.getBoundingClientRect(), edge = 8;
  const dx = Math.max(edge - r.left, Math.min(0, innerWidth - edge - r.right));
  pop.style.transform = `translateX(calc(-50% + ${dx}px))`;
}

// ---------- handlers ----------
// Reset path: nothing is drawn any more (a Two paths puzzle: neither colour).
function resetPaths() {
  const two = Boolean(S.puzzle.split);
  if (!S.finished) {
    const drawn = two ? S.paths[0].length + S.paths[1].length : S.path.length;
    if (S.trace) traceClear(S.trace, drawn);
    if (two) S.paths.forEach((path, colour) => legsUndoTwo(S.legs, S.puzzle, colour, path, 1));
    else legsUndo(S.legs, S.puzzle, S.path, 1);
  }
  S.paths = newPaths();
  S.colour = 0;
  S.path = two ? S.paths[0] : [];
  S.finished = false;
  S.hintCell = S.hintWrongCell = null;
  render();
}
function attachHandlers() {
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  on('playLocal', () => { S.size = +$('sizeSel').value; startLocal('open', S.mode); });
  const sel = $('sizeSel'); if (sel) sel.onchange = () => { S.size = +sel.value; $('gameNo').textContent = todayText(); };
  document.querySelectorAll('.variant-opt, .rules-host').forEach(opt => {
    opt.addEventListener('mouseenter', () => showRules(opt));
    // a finger leaves no hover: the browser's emulated mouse moves off again right after a tap, which must not close it
    opt.addEventListener('mouseleave', () => { if (lastPointer !== 'touch') closeRules(); });
    opt.addEventListener('focusin', () => showRules(opt));
    opt.addEventListener('focusout', closeRules);
    opt.addEventListener('click', e => { e.stopPropagation(); showRules(opt); }); // a tap on a phone
  });
  document.querySelectorAll('input[name="variant"]').forEach(input => {
    input.onchange = () => {
      S.mode = input.value;
      S.size = +$('sizeSel').value;
      $('sizeSel').innerHTML = sizeOptionsHtml();
      $('gameNo').textContent = todayText();
    };
  });
  on('playGotd', startGameOfDay);
  on('playLucky', startLucky);
  on('luckyTip', toggleLuckyTip);
  on('rewardReplay', () => claimReward('replay'));
  on('rewardUnlock', () => claimReward('unlock'));
  document.querySelectorAll('.shared-play').forEach(b => {
    b.onclick = () => startShared(b.dataset.key);
  });
  document.querySelectorAll('.shared-del').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      removeShared(b.dataset.key);
    };
  });
  on('sharedMore', () => {
    S.sharedAll = !S.sharedAll;
    render();
  });
  on('shareBtn', shareResult);
  on('shareTip', toggleShareTip);
  on('openReplay', () => openReplay());
  on('replayBack', () => { S.replayPick = null; S.screen = 'menu'; render(); });
  on('toReplay', () => openReplay());
  document.querySelectorAll('.replay-day').forEach(b => { b.onclick = () => startReplay(b.dataset.date); });
  document.querySelectorAll('.stat-item').forEach(b => { b.onclick = e => { e.stopPropagation(); const open = !b.classList.contains('open'); closeStatTips(); b.classList.toggle('open', open); }; });
  on('backMenu2', () => { logPlay(false); stopTimer(); leaveLucky(); S.screen = 'menu'; render(); });
  on('resetPath', resetPaths);
  on('behaviourToggle', async ev => { ev.preventDefault(); S.behaviourOn = !S.behaviourOn; await behaviour.setOn(S.behaviourOn); render(); });
  on('newPuzzle', () => { if (!S.isGotd) startLocal('skip', S.variant || 'standard'); });
  on('exportBtn', () => { $('exportText').value = S.puzzle.surface ? serializeSurface(S.puzzle, { path: S.puzzle.path }) : serialize(S.puzzle); $('exportMsg').textContent = ''; modal.open(); setTimeout(() => $('exportText').focus(), 30); });
  on('hintBtn', () => {
    if (S.finished || S.hintsUsed >= maxHints(S.puzzle)) return;
    const two = Boolean(S.puzzle.split);
    const { colour, correctCell, wrongCell } = two
      ? hintTwo(S.puzzle, S.paths, S.colour) : computeHint(solutionOf(S.puzzle), S.path);
    if (correctCell == null) return;
    if (two) { S.colour = colour; S.path = S.paths[colour]; } // the hint is for that colour
    S.hintsUsed++; S.hintCell = correctCell; S.hintWrongCell = wrongCell; render();
  });
  const svg = document.querySelector('#gridWrap svg'); if (svg) setupGridInput(svg);
}

function setupGridInput(svg) {
  const p = S.puzzle, n = p.n, pathEl = svg.querySelector('[data-role="path"]');
  // Two paths: one path element per colour (S.paths); S.path is the path of the colour drawn now
  const two = Boolean(p.split);
  const pathEls = [...svg.querySelectorAll('[data-role="path"]')];
  const wrap = Boolean(p.wrap), pad = wrap ? WRAP_PAD : 0; // a wrap-around board has a margin
  let dragging = false, last = null, rect = svg.getBoundingClientRect();
  // Highest checkpoint number crossed anywhere along the current path (0 = none yet, since
  // checkpoints are visited in ascending order this is just "how many crossed so far") — used to
  // pick a distinct, rising pitch for each post-checkpoint segment's moves. Recomputed from the
  // full path on every backtrack, since the head's own cell may not itself be a checkpoint.
  // (an Exact puzzle's numbers are steps, so the checkpoints are counted by rank)
  const rank = labelRanks(p);
  const highestCp = path => { let hi = 0; for (const c of path) if (rank[c] > hi) hi = rank[c]; return hi; };
  let segment = highestCp(S.path);
  const seamEl = wrap ? svg.querySelector('[data-role="seam"]') : null;
  const loopEl = p.loop ? svg.querySelector('[data-role="loop-open"]') : null;
  const jumpEl = p.portals ? svg.querySelector('[data-role="jump"]') : null;
  const setD = () => {
    if (two) {
      S.paths.forEach((path, colour) => {
        pathEls[colour].setAttribute('d', path.length > 1 ? routeOf(p, path) : '');
      });
      refreshTwoLegend();
    } else {
      const line = routeCells(p, S.path, S.finished); // a solved Loop puzzle is drawn closed
      pathEl.setAttribute('d', line.length > 1 ? routeOf(p, line) : '');
    }
    if (seamEl) seamEl.innerHTML = seamMarksSvg(n, S.path);
    // Teleport: the jumps, and the portal to tap next
    if (jumpEl) jumpEl.innerHTML = jumpMarksSvg(p, S.path, S.finished);
    if (loopEl) { // Loop: the open ring's two ends, and the line under the board
      loopEl.innerHTML = loopOpenMarks(p, S.path);
      const note = $('loopNote');
      if (note) { note.textContent = t(loopNoteKey()); note.classList.toggle('error', !S.finished && loopOpen(p, S.path)); }
    }
    const stepNow = $('hudStep'); // Exact: the step the head is on
    if (stepNow) stepNow.textContent = S.path.length;
  };
  const fill = (i, visited) => {
    const badge = svg.querySelector(`[data-num-cell="${i}"]`);
    if (!badge) return;
    const colors = two
      ? badgeColorsTwo(+badge.dataset.colour, visited)
      : badgeColors(visited, visited && stepWrong(p, S.path, i));
    const shape = badge.querySelector(two ? '.num-shape' : 'circle'); // Two paths: circle or square
    shape.setAttribute('fill', colors.fill);
    shape.setAttribute('stroke', colors.stroke);
    badge.querySelector('text').setAttribute('fill', colors.text);
  };
  const clearHint = () => { if (S.hintCell == null && S.hintWrongCell == null) return; S.hintCell = S.hintWrongCell = null; svg.querySelectorAll('[data-role="hint"],[data-role="hint-wrong"]').forEach(e => e.remove()); };
  // (an Exact puzzle's badges can turn red on any move: the step of a number passes)
  const syncFills = () => {
    const on = new Set(two ? [...S.paths[0], ...S.paths[1]] : S.path);
    svg.querySelectorAll('[data-num-cell]').forEach(g => {
      const cell = +g.dataset.numCell;
      fill(cell, on.has(cell));
    });
  };
  // A step against a one-way arrow: that arrow flashes (the animation is in css/play.css).
  function flashBlockedArrow(from, to) {
    if (!p.arrows || !gridAdjacent(n, from, to) || arrowAllows(p.arrows, n, from, to)) return;
    const mark = svg.querySelector(`[data-arrow="${edgeId(n, from, to)}"] polygon`);
    if (!mark || mark.classList.contains('blocked')) return;
    mark.classList.add('blocked');
    mark.addEventListener('animationend', () => mark.classList.remove('blocked'), { once: true });
  }
  function walkTo(cell) {
    if (cell < 0 || S.finished || (p.holes && p.holes[cell])) return; // a hole is not part of the board
    const prev = S.path[S.path.length - 1], before = S.path.length, prevPath = S.path.slice();
    const kind = two ? walkColour(p, S.paths, S.colour, cell) : stepOf(p, S.path, cell);
    if (kind && S.trace) traceStep(S.trace, kind, before, S.path.length);
    if (kind && kind !== 'push') {
      if (two) legsUndoTwo(S.legs, p, S.colour, prevPath, S.path.length);
      else legsUndo(S.legs, p, prevPath, S.path.length);
    }
    if (!kind) {
      if (prev != null && cell !== prev) {
        sfxBlocked();
        flashBlockedArrow(prev, cell);
      }
      return;
    }
    if (p.exact || (kind !== 'push' && kind !== 'pop')) syncFills();
    else if (kind === 'push') fill(cell, true);
    else fill(prev, false);
    setD(); clearHint();
    const solved = kind === 'push' && (two ? solvedPaths(p, S.paths) : solvedOf(p, S.path));
    if (solved) { onSolved(); setD(); return; }
    if (kind === 'push') {
      const onCp = p.cp[cell] > 0;
      if (onCp) sfxCheckpoint(); else if (segment > 0) sfxMoveAfterCheckpoint(segment); else sfxMove();
      if (onCp) segment = rank[cell];
    } else if (kind === 'pop' || kind === 'trunc' || kind === 'reset') {
      sfxBack();
      segment = highestCp(S.path);
    }
  }
  // Two paths: a press picks the colour it draws (a path's own cell, a 1, or the head it continues)
  function chooseColour(x, y) {
    const cell = cellAtPoint(n, x - rect.left, y - rect.top, rect.width, rect.height, pad, wrap);
    if (cell < 0) return;
    S.colour = pickColour(p, S.paths, cell, S.colour);
    S.path = S.paths[S.colour];
    segment = highestCp(S.path);
    refreshTwoLegend();
  }
  const across = p.surface ? pentagonAcross(p) : n; // cells across the board, about
  function move(x, y) { // interpolate so fast drags don't skip cells
    const cell = (px, py) => {
      if (p.surface) return pentagonCellAt(p, ...pentagonPoint(p, rect, px, py));
      return cellAtPoint(n, px - rect.left, py - rect.top, rect.width, rect.height, pad, wrap);
    };
    if (last) {
      const dx = x - last.x, dy = y - last.y, stepPx = Math.max(2, rect.width / across / 2), k = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stepPx));
      for (let i = 1; i <= k; i++) walkTo(cell(last.x + dx * i / k, last.y + dy * i / k));
    } else walkTo(cell(x, y));
    last = { x, y };
  }
  svg.addEventListener('pointerdown', e => {
    e.preventDefault(); dragging = true; last = null; rect = svg.getBoundingClientRect();
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (two) chooseColour(e.clientX, e.clientY);
    move(e.clientX, e.clientY);
  });
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
  playlog.add(buildRecord(S.puzzle, { ms, solved, hints: S.hintsUsed, mode }));
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

function onSolved() {
  logPlay(true); // before the hint penalty below: the log keeps the raw time
  if (streak) streak.record().then(milestone => milestone && onStreakMilestone()).catch(e => console.warn('streak record failed:', e)); // a streak reward earned: a replay or unlock chance
  S.finished = true; stopTimer(); sfxSolved();
  if (S.lucky) finishLucky();
  if (!S.penaltyApplied) { S.elapsed = penalizedTime(S.elapsed, S.hintsUsed); S.penaltyApplied = true; } // once, even if the path is reset and re-solved
  if (S.isGotd) { const a = store.attemptOn(S.gotdDate); if (!(a && a.solved)) finishGotd(S.puzzle.n, S.gotdDate, S.elapsed, S.isReplay); } // a Game of Day (live or replay) counts once
  else { // stats and daily counter of the puzzle type (a variant has its own)
    const n = S.puzzle.n, scope = S.variant || ''; store.recordSolve(n, dayNo(), S.elapsed, scope);
    if (!S.isShared) daily.markSolved(n, S.gameIndex, scope).then(refreshNext); }
}

// Game of Day (live or replay): record locally, count it towards the next replay chance, then submit to the averages backend
// (stats are stored in the attempt record, so no refetch is needed). A replay is submitted like the live game: it counts in that day's averages.
async function finishGotd(n, date, time, isReplay) {
  await store.recordGotd(n, date, time, lb.enabled, isReplay);
  if (isReplay) await healStreak(date);
  await replay.addSolved();
  if (lb.enabled) await shareGotd(date);
}
// A replayed Game of Day heals its day for the streak (features/streak.js): the day counts, a spent freeze comes back, a broken
// streak is joined again; any freeze + reward days reached that way are granted like a milestone. onSolved has recorded today's solve by now.
async function healStreak(date) {
  if (!streak) return;
  try {
    const healed = await streak.heal(dayOfDate(date));
    if (!healed) return;
    S.healed = true;
    for (let i = 0; i < healed.rewards; i++) await onStreakMilestone();
    if (S.screen === 'game') render();
  } catch (e) { console.warn('streak heal failed:', e); }
}
// Unlock chances (features/unlock.js) come from the streak: with every streak reward the player picks a replay chance or an unlock
// chance (none left to unlock: a replay, as before).
async function onStreakMilestone() {
  if (unlock && !unlock.view().allUnlocked) await unlock.addChoice(); else await replay.addBonus();
  if (S.screen === 'game' || S.screen === 'menu') render();
}
async function claimReward(kind) {
  if (unlock && await unlock.takeChoice()) { if (kind === 'unlock') await unlock.addToken(); else await replay.addBonus(); }
  render();
}
// One submit round (platform/leaderboard.js submitAttempt): the attempt record says which backends already hold the solve.
async function shareGotd(date) {
  const saved = await submitAttempt(lb, store, date);
  if (saved && (S.screen === 'menu' || (S.screen === 'game' && S.isGotd && S.finished))) render();
}

// ---------- game flow ----------
function beginGame(puzzle, gotdDate, isReplay = false, isShared = false, lucky = false) {
  logPlay(false); // a puzzle left unfinished is logged as abandoned
  // the menu's shared card starts afresh
  S.sharedNotice = null;
  S.sharedFocus = null;
  const variant = variantOf(puzzle);
  const difficulty = gradePuzzle(puzzle);
  Object.assign(S, { variant, lucky, luckyResult: null, luckyNote: null, healed: false, trace: newTrace(), legs: [], isShared, logged: false, puzzle, isGotd: !!gotdDate, isReplay, replayPick: null, gotdDate: gotdDate || null, path: [], finished: false, elapsed: 0, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, screen: 'game', gotdHint: null, difficulty });
  // Two paths: the red and the blue path, and the colour drawn now (S.path is that colour's path)
  S.paths = newPaths();
  S.colour = 0;
  if (puzzle.split) S.path = S.paths[0];
  startTimer(); render(); maybeShowRules();
}
function generatorFor(mode, n, seed) {
  const variant = variantById(mode);
  return variant ? variant.generate(n, seed) : generate(n, seed);
}
const generateShown = (n, seed, mode = 'standard') => runAsync(generatorFor(mode, n, seed), { onEvent: e => { S.gen = { frac: e.frac == null ? S.gen.frac : e.frac, walls: e.walls ?? e.arrows ?? e.labels, K: e.K }; if (S.screen === 'generating') render(); } });
// how: 'open' (Play local: current or next-if-solved) | 'skip' (New puzzle); a variant is always a new random one.
// lucky: the lucky game (startLucky): its chance is given back when the puzzle cannot be made.
async function startLocal(how, mode = 'standard', lucky = false) {
  if (mode !== 'standard') S.size = nearestSize(S.size, sizesFor(mode, SIZES)); // e.g. after a shared 12x12 one
  S.screen = 'generating'; S.genMode = mode; S.gen = { frac: 0, walls: null, K: null }; render();
  try {
    const scope = mode === 'standard' ? '' : mode, game = how === 'skip' ? await daily.skip(S.size, scope) : await daily.open(S.size, scope);
    const index = game.index, seed = scope ? randomSeed() : game.seed; // a variant is random: its counter only numbers the day's games
    const puzzle = await generateShown(S.size, seed, mode);
    S.gameIndex = index; S.seed = seed;
    S.gameDay = mode !== 'standard' ? null : [dayNo(), dayNo() - 1].find(d => dailySeed(d, S.size, index, ALGO_VERSION) === seed) ?? null; // the day this seed was made on (the behaviour log wants it)
    beginGame(puzzle, null, false, false, lucky);
  } catch (e) {
    console.error('startLocal failed:', e);
    if (lucky) await unlock.refund();
    S.screen = 'menu'; render(); alert(t('err.generate'));
  }
}
// Lucky game: open to everyone, once per offer. Draws a variant (a locked one has a size of 7-10, features/unlock.js) and plays
// it. With an unlock chance (spent now) solving it unlocks the variant; leaving the game (or reloading the page) loses the chance.
async function startLucky() {
  if (!unlock) return;
  S.luckyNote = null;
  const pick = await unlock.begin(randomInt);
  if (!pick) return render();
  S.size = pick.size; S.luckyHolder = pick.holder;
  await startLocal('open', pick.id, true);
}
async function finishLucky() {
  const r = await unlock.finish(true);
  if (!r) return; // a re-solve after a reset: the first solve counted
  S.luckyResult = r;
  if (r.newly) S.mode = r.id; // the new tile is picked in the menu
  if (S.screen === 'game') render();
}
// Back to the menu from a lucky game that was not solved: the chance is gone.
function leaveLucky() {
  if (!S.lucky) return;
  S.lucky = false;
  const active = unlock && unlock.view().active;
  if (active) { unlock.finish(false); if (active.holder) S.luckyNote = 'lucky.lostNote'; }
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
  const pin = streak ? streak.healable().map(dateOfDay) : []; // missed days whose replay heals the streak
  const list = (await replay.pick(async date => !!(await replayFile(date)), pin)).map(d => ({ ...d, puzzle: replayPuzzles.get(d.date) }));
  if (id !== replayLoad || S.screen !== 'replay') return; // superseded, or the player left the screen meanwhile
  S.replayPick = { loading: false, list, msg }; render();
}
async function startReplay(date) {
  const puzzle = replayPuzzles.get(date);
  if (!puzzle || !(await replay.begin(date))) return openReplay('replay.unavailable'); // stale list: reload it
  S.size = puzzle.n;
  beginGame(puzzle, date, true);
}
// ---------- sharing (features/share.js, core/share-code.js, features/shared-games.js) ----------
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
function pruneShared() {
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
  const note = S.sharedMsg && S.sharedMsg.key === key ? t(S.sharedMsg.msg) : sharedStateText(state);
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
function sharedCardHtml() {
  const entries = visibleShared();
  const notice = S.sharedNotice ? (S.sharedNotice.bad ? t('share.invalid') : sharedStateText(S.sharedNotice.state)) : '';
  if (!entries.length && !notice) {
    return '';
  }
  const tip = entries.some(e => e.rec.levels.length)
    ? `<button type="button" class="tip-btn" id="shareTip" aria-expanded="false" aria-label="${t('share.tipLabel')}">i</button>
      <span class="tip-pop" id="shareTipPop" role="tooltip">${t('share.tip')}</span>` : '';
  const more = entries.length > SHARED_ROWS
    ? `<button type="button" class="btn secondary shared-more" id="sharedMore">${S.sharedAll ? t('share.showLess') : t('share.showAll', entries.length)}</button>` : '';
  const warn = S.sharedNotice && (S.sharedNotice.bad || SHARED_BAD.includes(S.sharedNotice.state.status));
  return `<section class="card shared-card">
    <div class="shared-head">
      <span class="shared-eyebrow">${t('share.title')}</span>${entries.length ? `<span class="shared-count">${entries.length}</span>` : ''}${tip}
    </div>
    ${notice ? `<p class="shared-state${warn ? ' bad' : ''}">${notice}</p>` : ''}
    <ul class="shared-list">${(S.sharedAll ? entries : entries.slice(0, SHARED_ROWS)).map(sharedItemHtml).join('')}</ul>
    ${more}
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

function setLuckyTip(open) {
  const pop = $('luckyTipPop'), button = $('luckyTip');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (!open) button.blur();
}
function toggleLuckyTip(ev) {
  ev.stopPropagation();
  setLuckyTip(!$('luckyTipPop').classList.contains('open'));
}

// Drops the `s` parameter from the address (the other parameters stay), so reloading does not save the game again.
function stripShareParam() {
  try {
    const params = new URLSearchParams(location.search);
    params.delete('s');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  } catch { /* ignore */ }
}

// At start: loads the saved games, then saves the game of the link the page was opened with. A Game of Day that is already
// played or out of the window is not saved (it never could be played from the list): the card says why, for this visit.
async function initShared() {
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
async function removeShared(key) {
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
async function startShared(key) {
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
  const h = $('hintBtn'); if (h) h.style.display = hintShown() ? '' : 'none';
  const x = $('exportBtn'); if (x) x.style.display = on ? '' : 'none';
  const sn = $('storageNote'); if (sn) sn.style.display = on ? '' : 'none';
  if (on) usage(storage).then(u => { storageUsed = ` · ~${Math.max(1, Math.round(u.chars * 2 / 1024))} KB in ${u.keys} keys`; const n = $('storageNote'); if (n) n.textContent = storageNoteText(); }).catch(() => {});
  const bn = $('behaviourNote'); if (bn) bn.style.display = on ? '' : 'none';
  const tag = $('seedTag'); if (tag) tag.style.display = on ? 'inline' : 'none';
  const d = $('difficultyDev'); if (d) d.style.display = on ? 'inline' : 'none';
  const g = $('genDev'); if (g) g.style.display = on ? 'inline' : 'none';
  for (const { id } of PLAY_VARIANTS) { const tile = $('variantOpt-' + id); if (tile) tile.style.display = typeShown(id) ? '' : 'none'; }
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
  storage = await pickStorage(); store = createStore(storage, SIZES, Object.fromEntries(PLAY_VARIANTS.map(v => [v.id, v.sizes(SIZES)]))); daily = createDaily(storage); playlog = createPlayLog(storage);
  try { await store.hydrate(today()); } catch (e) { console.warn('stats hydration failed:', e); }
  lb = createLeaderboard(backendsFromConfig(LEADERBOARD, new URLSearchParams(location.search).get('lb')));
  replay = createReplay(storage, store);
  try { await replay.init(); } catch (e) { console.warn('replay init failed:', e); }
  streak = createStreak(storage, playlog);
  try { await streak.init(); } catch (e) { console.warn('streak init failed:', e); }
  unlock = createUnlock(storage, luckyDefs(SIZES));
  try { await unlock.init(); } catch (e) { console.warn('unlock init failed:', e); }
  rulesSeen = createRulesSeen(storage, PLAY_VARIANTS.map(v => v.id));
  await rulesSeen.init();
  shared = createSharedGames(storage);
  if (lb.enabled) for (const { date } of await replay.unsent()) shareGotd(date); // today's and replayed days whose submit never got an answer
  behaviour = createBehaviour({ storage, cfg: BEHAVIOUR, sinks: sinksFromConfig(BEHAVIOUR, LEADERBOARD) });
  try { S.behaviourOn = await behaviour.isOn(); behaviour.flush().catch(() => {}); } catch (e) { console.warn('behaviour init failed:', e); } // rows left from an earlier page load
  try { S.nextIdx = await peekNext(); } catch (e) { console.warn('daily counters failed:', e); }
  await initShared();
  document.addEventListener('click', () => { setShareTip(false); setLuckyTip(false); closeStatTips(); closeRules(); });
  // a press anywhere but on a rules tooltip's own host closes the tooltips, in the capture phase: the board takes its presses
  document.addEventListener('pointerdown', e => {
    lastPointer = e.pointerType;
    if (!e.target.closest('.variant-opt, .rules-host')) closeRules();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { setShareTip(false); setLuckyTip(false); closeStatTips(); closeRules(); } });
  modal = bindModal($('exportModal'));
  $('exportClose').onclick = modal.close; $('exportCopy').onclick = () => copyText($('exportText'), $('exportMsg'));
  installDevReveal(); await initSoundToggle(); await initLang(); render();
})();
