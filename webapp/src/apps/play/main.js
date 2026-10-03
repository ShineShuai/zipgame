import { serialize } from '../../core/format.js';
import { generate, PLAY_SIZES } from '../../core/gen/generate.js';
import { isSolved, step } from '../../core/rules.js';
import { statSummary } from '../../core/stats.js';
import { pickStorage } from '../../platform/storage.js';
import { runAsync } from '../../platform/run.js';
import { createStore } from '../../features/stats-store.js';
import { createDaily, fetchGameOfDay, fetchGameOfDayFor, utcDateString, utcDayNumber } from '../../features/daily.js';
import { createReplay } from '../../features/replay.js';
import { REPLAY_DAYS } from '../../core/hist.js';
import { maxHints, computeHint, solutionOf, penalizedTime, HINT_PENALTY_S } from '../../features/hints.js';
import { cellAtPoint, pathD } from '../../view/geometry.js';
import { bindModal, copyText } from '../../ui/modal.js';
import { boardSvg, CELL, COLORS } from './board.js';
import { VERSION } from '../../version.js';
import { LEADERBOARD } from '../../config.js';
import { createLeaderboard, backendsFromConfig } from '../../platform/leaderboard.js';
import { statsLine } from '../../core/hist.js';
import { t, getLang, setLang } from '../../ui/i18n.js';
import { PLAY_FLAGS_INT, flagsToHex } from '../../core/gen/flags.js';
import { playGradesFor } from '../../core/grades.js';
import { sfxMove, sfxBack, sfxCheckpoint, sfxMoveAfterCheckpoint, sfxBlocked, sfxSolved, setSoundEnabled, isSoundEnabled } from '../../platform/sound.js';

const SIZES = PLAY_SIZES;
const S = { screen: 'menu', size: 7, puzzle: null, path: [], elapsed: 0, startTime: 0, timerId: null, finished: false,
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, isReplay: false, replayPick: null, gotdDate: null, gotdHint: null, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, showDev: false, difficulty: null };

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
let storage, store, daily, replay, modal, lb;
const replayPuzzles = new Map(); // date -> puzzle: the file of a past day never changes, so each is fetched once per page load
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
  return `
    <div class="center-stage">
      <section class="card">
        <h2 class="card-title">${t('gen.title')}</h2>
        <p class="small">${t('gen.sub', S.size)}</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <div style="width:${percent}%"></div>
        </div>
        <p class="small">${t('gen.progress', percent, walls)}</p>
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

function renderMenu() {
  refreshAttemptIfStale();
  refreshNext();
  const attempt = store.attempt();
  const stats = menuStats();
  const sizeOptions = SIZES
    .map(n => `<option value="${n}"${n === S.size ? ' selected' : ''}>${n}x${n}</option>`)
    .join('');
  const gotdButton = attempt
    ? `<button class="btn secondary" disabled title="${t('menu.gotdOnce')}">${t('menu.gotd')}</button>`
    : `<button class="btn secondary" id="playGotd">${t('menu.gotd')}</button>`;
  const attemptText = attempt && attempt.solved
    ? t('menu.attemptSolved', sec(attempt.time))
    : t('menu.attemptDone');
  const attemptNote = attempt ? `<p class="note">${attemptText}${attempt.stats ? '<br><span class="gotd-stats">' + statsLineT(attempt.stats, S.showDev) + '</span>' : ''}</p>` : '';
  const hintNote = S.gotdHint ? `<p class="note error">${t(...S.gotdHint)}</p>` : '';
  const chances = replay.chances();
  const replayButton = chances > 0
    ? `<button class="btn secondary" id="openReplay">${t('menu.replay', chances)}</button>`
    : `<button class="btn secondary" disabled title="${t('replay.locked', replay.toNext())}">${t('menu.replay', 0)}</button>`;
  const replayNote = `<p class="small replay-note">${t(chances > 0 ? 'replay.progress' : 'replay.locked', replay.toNext())}</p>`;

  return `
    <div class="menu-layout${stats ? '' : ' single'}">
      <section class="card play-card">
        <div class="play-intro">
          <h2 class="card-title">${t('menu.title')}</h2>
          <p class="blurb">${t('menu.blurb')}</p>
        </div>
        <div class="play-controls">
          <div class="field">
            <label class="field-label" for="sizeSel">${t('menu.size')}</label>
            <select id="sizeSel">${sizeOptions}</select>
            <span class="small" id="gameNo">${t('menu.today', gameNo(S.size))}</span>
          </div>
          <div class="button-row">
            <button class="btn" id="playLocal">${t('menu.playLocal')}</button>
            ${gotdButton}
            ${replayButton}
          </div>
          ${replayNote}
          ${attemptNote}
          ${hintNote}
          <p class="small storage-note" id="storageNote" style="${S.showDev ? '' : 'display:none'}">Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}</p>
        </div>
      </section>
      ${stats}
    </div>`;
}

const dateLabel = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6);
const weekday = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short', timeZone: 'UTC' });

// Replay screen (opened by the menu's Replay button): the missed days that have a puzzle file, newest first, one tap to start.
// The grid is one column on phones and as many 230 px columns as fit on a desktop (css/play.css).
function renderReplay() {
  const r = S.replayPick || { loading: true, list: [], msg: null }, chances = replay.chances();
  const body = r.loading ? `<p class="small">${t('replay.loading')}</p>`
    : chances < 1 ? `<p class="small">${t('replay.locked', replay.toNext())}</p>`
    : !r.list.length ? `<p class="small">${t('replay.none', REPLAY_DAYS)}</p>`
    : `<div class="replay-grid">${r.list.map(({ date, puzzle }) => `
        <button class="replay-day" type="button" data-date="${date}">
          <span><span class="replay-date">${dateLabel(date)}</span><span class="replay-size">${weekday(date)} · ${puzzle.n}x${puzzle.n}</span></span>
          <span class="replay-go">${t('replay.play')}</span>
        </button>`).join('')}</div>`;
  return `
    <div class="replay-stage">
      <section class="card">
        <div class="replay-head">
          <h2 class="card-title">${t('replay.title')}</h2>
          <span class="replay-left">${t('replay.left', chances)}</span>
        </div>
        <p class="blurb">${t('replay.sub')}</p>
        ${r.msg ? `<p class="note error">${t(r.msg)}</p>` : ''}
        ${body}
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
  const trapPart = t ? `trap ${t.predicted.toFixed(2)} <span class="dev-raw">max ${t.trapMax} · top3 ${t.trapTop3} · alt ${t.altFrac.toFixed(2)}</span> · ` : '';
  const legacyPart = g
    ? `decisionNodes ${g.grades.decisionNodes}/5 · B ${g.grades.B}/5 · cross ${g.grades.crossPerSeg}/5 · <span class="dev-raw">decisionNodes ${g.raw.decisionNodes} · B ${g.raw.B.toFixed(2)} · cross/seg ${g.raw.crossPerSeg.toFixed(2)}</span>`
    : 'old grades: ungraded (search capped)';
  const body = t || g ? trapPart + legacyPart : 'ungraded';
  return `<span id="difficultyDev" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="trap: the badge grade before rounding, with its inputs (worst step's trap score, top-3 steps' sum, fraction of steps that have any wrong move). decisionNodes: the previous badge grade (solver branch points per cell). B: backtrack overhead (nodes/cells - 1) from the same solve. cross: how many non-adjacent checkpoint-to-checkpoint segments geometrically cross, per segment. Each old grade is graded 0-5 with its own calibration; the trap grade is fit to hand ratings. The design app shows all of them.">${body}</span>`;
}

function renderGame() {
  const p = S.puzzle;
  const time = sec(S.elapsed);
  const cap = maxHints(p);
  const seedTag = `<span id="seedTag" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="Design app's Generate uses these same algorithm choices, but generate() here also tries several candidates and keeps the cheapest, so pasting this seed+flags there is not guaranteed to reproduce this exact puzzle">seed ${S.seed} · flags ${flagsToHex(PLAY_FLAGS_INT)}</span>`;
  const title = S.isGotd ? t(S.isReplay ? 'game.replayTitle' : 'game.gotdTitle', S.gotdDate) : t('game.localTitle', p.n, S.gameIndex + 1) + seedTag;
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
          <div class="hud-title">${title}</div>
          ${difficultyBadgeHtml()}
          ${difficultyDevHtml()}
          <div class="hud-time">${t('game.time', `<b id="hudTime">${time}</b>`)}</div>
        </div>
        <div class="grid-wrap" id="gridWrap">${boardSvg(S)}</div>
      </section>
      <div class="side">
        <section class="card">
          <div class="button-row">
            ${nextReplay}
            <button class="btn secondary" id="backMenu2">${t('game.menu')}</button>
            ${newPuzzleButton}
            <button class="btn secondary" id="resetPath">${t('game.reset')}</button>
            <button class="btn secondary" id="hintBtn" style="${hiddenUnlessDev}" ${hintDisabled}>Hint (${S.hintsUsed}/${cap})</button>
            <button class="btn secondary" id="exportBtn" style="${hiddenUnlessDev}">Export</button>
          </div>
          ${solved}
        </section>
        ${sizeStats(p.n)}
      </div>
    </div>`;
}

// ---------- handlers ----------
function attachHandlers() {
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  on('playLocal', () => { S.size = +$('sizeSel').value; startLocal('open'); });
  const sel = $('sizeSel'); if (sel) sel.onchange = () => { S.size = +sel.value; $('gameNo').textContent = t('menu.today', gameNo(S.size)); };
  on('playGotd', startGameOfDay);
  on('openReplay', () => openReplay());
  on('replayBack', () => { S.replayPick = null; S.screen = 'menu'; render(); });
  on('toReplay', () => openReplay());
  document.querySelectorAll('.replay-day').forEach(b => { b.onclick = () => startReplay(b.dataset.date); });
  on('backMenu2', () => { stopTimer(); S.screen = 'menu'; render(); });
  on('resetPath', () => { S.path = []; S.finished = false; S.hintCell = S.hintWrongCell = null; render(); });
  on('newPuzzle', () => { if (!S.isGotd) startLocal('skip'); });
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
    if (cell < 0 || S.finished) return;
    const prev = S.path[S.path.length - 1], kind = step(p, S.path, cell);
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

function onSolved() {
  S.finished = true; stopTimer(); sfxSolved();
  if (!S.penaltyApplied) { S.elapsed = penalizedTime(S.elapsed, S.hintsUsed); S.penaltyApplied = true; } // once, even if the path is reset and re-solved
  if (S.isGotd) { const a = store.attemptOn(S.gotdDate); if (!(a && a.solved)) finishGotd(S.puzzle.n, S.gotdDate, S.elapsed, S.isReplay); } // a Game of Day (live or replay) counts once
  else { const n = S.puzzle.n; store.recordSolve(n, dayNo(), S.elapsed); daily.markSolved(n, S.gameIndex).then(refreshNext); }
}

// Game of Day (live or replay): record locally, count it towards the next replay chance, then submit to the averages backend
// (stats are stored in the attempt record, so no refetch is needed). A replay is submitted like the live game: it counts in that day's averages.
async function finishGotd(n, date, time, isReplay) {
  await store.recordGotd(n, date, time, lb.enabled, isReplay);
  await replay.addSolved();
  if (lb.enabled) await shareGotd(date, time);
}
async function shareGotd(date, time) {
  const r = await lb.submit(date, time);
  if (r.status === 'failed') return; // sent stays false: retried on the next page load
  await store.saveAttempt(date, { solved: true, time, sent: true, stats: r.summary || null });
  if (S.screen === 'menu' || (S.screen === 'game' && S.isGotd && S.finished)) render();
}

// ---------- game flow ----------
function beginGame(puzzle, gotdDate, isReplay = false) {
  const difficulty = gradePuzzle(puzzle);
  Object.assign(S, { puzzle, isGotd: !!gotdDate, isReplay, replayPick: null, gotdDate: gotdDate || null, path: [], finished: false, elapsed: 0, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, screen: 'game', gotdHint: null, difficulty });
  startTimer(); render();
}
async function startLocal(how) { // how: 'open' (Play local: current or next-if-solved) | 'skip' (New puzzle)
  S.screen = 'generating'; S.gen = { frac: 0, walls: null, K: null }; render();
  try {
    const { index, seed } = how === 'skip' ? await daily.skip(S.size) : await daily.open(S.size);
    const puzzle = await runAsync(generate(S.size, seed), { onEvent: e => { S.gen = { frac: e.frac == null ? S.gen.frac : e.frac, walls: e.walls, K: e.K }; if (S.screen === 'generating') render(); } });
    S.gameIndex = index; S.seed = seed; beginGame(puzzle, null);
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
// Replay: the replay screen lists the missed days that have a puzzle file; choosing one spends a chance once its puzzle has loaded.
let replayLoad = 0; // a newer openReplay() makes an older, slower one drop its result
async function openReplay(msg = null) {
  const id = ++replayLoad;
  Object.assign(S, { screen: 'replay', replayPick: { loading: true, list: [], msg } }); render();
  const dates = await replay.missed();
  const list = (await Promise.all(dates.map(async date => {
    if (!replayPuzzles.has(date)) { const p = await fetchGameOfDayFor(date); if (p) replayPuzzles.set(date, p); }
    return { date, puzzle: replayPuzzles.get(date) };
  }))).filter(x => x.puzzle);
  if (id !== replayLoad || S.screen !== 'replay') return; // superseded, or the player left the screen meanwhile
  S.replayPick = { loading: false, list, msg }; render();
}
async function startReplay(date) {
  const puzzle = replayPuzzles.get(date);
  if (!puzzle || !(await replay.begin(date))) return openReplay('replay.unavailable'); // stale list: reload it
  S.size = puzzle.n;
  beginGame(puzzle, date, true);
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
  const tag = $('seedTag'); if (tag) tag.style.display = on ? 'inline' : 'none';
  const d = $('difficultyDev'); if (d) d.style.display = on ? 'inline' : 'none';
  const shown = S.screen === 'game' && S.isGotd ? store.attemptOn(S.gotdDate) : store.attempt(), st = shown && shown.stats;
  if (st) document.querySelectorAll('.gotd-stats').forEach(e => { e.textContent = statsLineT(st, on); });
}
function installDevReveal() {
  const typing = t => t && t.tagName && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  addEventListener('keydown', e => { if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) setDevReveal(true); });
  addEventListener('keyup', e => { if (e.key === 'v' || e.key === 'V') setDevReveal(false); });
  addEventListener('blur', () => setDevReveal(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setDevReveal(false); });
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
  storage = await pickStorage(); store = createStore(storage, SIZES); daily = createDaily(storage);
  try { await store.hydrate(today()); } catch (e) { console.warn('stats hydration failed:', e); }
  lb = createLeaderboard(backendsFromConfig(LEADERBOARD, new URLSearchParams(location.search).get('lb')));
  replay = createReplay(storage, store);
  try { await replay.init(); } catch (e) { console.warn('replay init failed:', e); }
  if (lb.enabled) for (const { date, time } of await replay.unsent()) shareGotd(date, time); // today's and replayed days whose submit never got an answer
  try { for (const n of SIZES) S.nextIdx[n] = (await daily.peek(n)).index; } catch (e) { console.warn('daily counters failed:', e); }
  modal = bindModal($('exportModal'));
  $('exportClose').onclick = modal.close; $('exportCopy').onclick = () => copyText($('exportText'), $('exportMsg'));
  installDevReveal(); await initSoundToggle(); await initLang(); render();
})();
