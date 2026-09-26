import { serialize } from '../../core/format.js';
import { generate, PLAY_SIZES } from '../../core/gen/generate.js';
import { isSolved, step } from '../../core/rules.js';
import { statSummary } from '../../core/stats.js';
import { pickStorage } from '../../platform/storage.js';
import { runAsync } from '../../platform/run.js';
import { createStore } from '../../features/stats-store.js';
import { createDaily, fetchGameOfDay, utcDateString, utcDayNumber } from '../../features/daily.js';
import { maxHints, computeHint, solutionOf } from '../../features/hints.js';
import { cellAtPoint, pathD } from '../../view/geometry.js';
import { bindModal, copyText } from '../../ui/modal.js';
import { boardSvg, CELL, COLORS } from './board.js';
import { VERSION } from '../../version.js';
import { PLAY_FLAGS_INT, flagsToHex } from '../../core/gen/flags.js';

const SIZES = PLAY_SIZES;
const S = { screen: 'menu', size: 7, puzzle: null, path: [], elapsed: 0, startTime: 0, timerId: null, finished: false,
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, gotdDate: null, gotdHint: null, hintsUsed: 0, hintCell: null, hintWrongCell: null, showDev: false };
let storage, store, daily, modal;
const $ = id => document.getElementById(id), today = () => utcDateString(new Date()), dayNo = () => utcDayNumber(new Date()), sec = x => x.toFixed(1) + 's';

// ---------- render ----------
function render() {
  const screens = { menu: renderMenu, generating: renderGenerating, game: renderGame };
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
  const walls = gen.walls == null ? 'searching…' : `${gen.walls} wall${gen.walls === 1 ? '' : 's'} so far`;
  return `
    <div class="center-stage">
      <section class="card">
        <h2 class="card-title">Generating puzzle…</h2>
        <p class="small">${S.size}x${S.size} grid — looking for the cleanest layout.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <div style="width:${percent}%"></div>
        </div>
        <p class="small">${percent}% — ${walls}</p>
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
    ? '<button class="btn secondary" disabled title="One Game of Day per day">Game of Day</button>'
    : '<button class="btn secondary" id="playGotd">Game of Day</button>';
  const attemptText = attempt && attempt.solved
    ? `Today's Game of Day: solved in ${sec(attempt.time)}.`
    : "Today's Game of Day already attempted.";
  const attemptNote = attempt ? `<p class="note">${attemptText}</p>` : '';
  const hintNote = S.gotdHint ? `<p class="note error">${S.gotdHint}</p>` : '';

  return `
    <div class="menu-layout${stats ? '' : ' single'}">
      <section class="card play-card">
        <div class="play-intro">
          <h2 class="card-title">Start a game</h2>
          <p class="blurb">Connect the numbers in order through every cell. No revisits, no crossings. Drag with mouse or finger to draw.</p>
        </div>
        <div class="play-controls">
          <div class="field">
            <label class="field-label" for="sizeSel">Grid size</label>
            <select id="sizeSel">${sizeOptions}</select>
            <span class="small" id="gameNo">Today's game: ${gameNo(S.size)}</span>
          </div>
          <div class="button-row">
            <button class="btn" id="playLocal">Play local</button>
            ${gotdButton}
          </div>
          ${attemptNote}
          ${hintNote}
          <p class="small storage-note">Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}</p>
        </div>
      </section>
      ${stats}
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

const STATS_HEAD = ['Grid', 'Next game', 'Solves', 'Avg', 'Std dev', 'Best (last 20)', 'Game of Day'];

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
      return `<td data-label="${STATS_HEAD[i]}">${shown}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  if (!rows) return '';

  const head = STATS_HEAD.map(name => `<th>${name}</th>`).join('');
  return `
    <section class="card">
      <h2 class="card-title">Your stats</h2>
      <p class="small">Today / total (UTC day, seconds)</p>
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
      <h2 class="card-title">Your stats — ${n}x${n}</h2>
      <p class="small">Today / total</p>
      <table>
        ${row('Solves', c.solves)}
        ${row('Avg time (s)', c.avg)}
        ${row('Std dev (s)', c.sd)}
        ${row('Best (last 20, s)', c.best)}
        ${row('Game of Day', gotdText(n))}
      </table>
    </section>`;
}

function renderGame() {
  const p = S.puzzle;
  const time = sec(S.elapsed);
  const cap = maxHints(p);
  const seedTag = `<span id="seedTag" class="seed-tag" style="display:${S.showDev ? 'inline' : 'none'}" title="Design app's Generate uses these same algorithm choices, but generate() here also tries several candidates and keeps the cheapest, so pasting this seed+flags there is not guaranteed to reproduce this exact puzzle">seed ${S.seed} · flags ${flagsToHex(PLAY_FLAGS_INT)}</span>`;
  const title = S.isGotd ? `Game of Day ${S.gotdDate}` : `Local ${p.n}x${p.n} · game #${S.gameIndex + 1} today${seedTag}`;
  const newPuzzleButton = S.isGotd ? '' : '<button class="btn secondary" id="newPuzzle">New puzzle</button>';
  const hiddenUnlessDev = S.showDev ? '' : 'display:none';
  const hintDisabled = S.finished || S.hintsUsed >= cap ? 'disabled' : '';
  const solved = S.finished ? `<p class="solved">Solved in ${time}</p>` : '';

  return `
    <div class="game-layout">
      <section class="card board-card">
        <div class="hud">
          <div class="hud-title">${title}</div>
          <div class="hud-time">Time: <b id="hudTime">${time}</b></div>
        </div>
        <div class="grid-wrap" id="gridWrap">${boardSvg(S)}</div>
      </section>
      <div class="side">
        <section class="card">
          <div class="button-row">
            <button class="btn secondary" id="backMenu2">Menu</button>
            ${newPuzzleButton}
            <button class="btn secondary" id="resetPath">Reset path</button>
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
  const sel = $('sizeSel'); if (sel) sel.onchange = () => { S.size = +sel.value; $('gameNo').textContent = "Today's game: " + gameNo(S.size); };
  on('playGotd', startGameOfDay);
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
    if (!kind) return;
    if (kind === 'push') fill(cell, true); else if (kind === 'pop') fill(prev, false); else syncFills();
    setD(); clearHint();
    if (kind === 'push' && isSolved(p, S.path)) onSolved();
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
  S.finished = true; stopTimer();
  if (S.isGotd) store.recordGotd(S.puzzle.n, S.gotdDate, S.elapsed);
  else { const n = S.puzzle.n; store.recordSolve(n, dayNo(), S.elapsed); daily.markSolved(n, S.gameIndex).then(refreshNext); }
}

// ---------- game flow ----------
function beginGame(puzzle, gotdDate) {
  Object.assign(S, { puzzle, isGotd: !!gotdDate, gotdDate: gotdDate || null, path: [], finished: false, elapsed: 0, hintsUsed: 0, hintCell: null, hintWrongCell: null, screen: 'game', gotdHint: null });
  startTimer(); render();
}
async function startLocal(how) { // how: 'open' (Play local: current or next-if-solved) | 'skip' (New puzzle)
  S.screen = 'generating'; S.gen = { frac: 0, walls: null, K: null }; render();
  try {
    const { index, seed } = how === 'skip' ? await daily.skip(S.size) : await daily.open(S.size);
    const puzzle = await runAsync(generate(S.size, seed), { onEvent: e => { S.gen = { frac: e.frac == null ? S.gen.frac : e.frac, walls: e.walls, K: e.K }; if (S.screen === 'generating') render(); } });
    S.gameIndex = index; S.seed = seed; beginGame(puzzle, null);
  } catch (e) { console.error('startLocal failed:', e); S.screen = 'menu'; render(); alert('Could not generate a puzzle. Please try again.'); }
}
async function startGameOfDay() {
  const date = today();
  if (store.attemptDate() !== date) await store.hydrateAttempt(date);
  const a = store.attempt();
  if (a) { S.gotdHint = a.solved ? `Already played today's Game of Day — solved in ${sec(a.time)}.` : "Already played today's Game of Day."; return render(); }
  const puzzle = await fetchGameOfDay();
  if (!puzzle) { S.gotdHint = 'No game of day today.'; return render(); }
  S.size = puzzle.n;
  await store.saveAttempt(date, { solved: false, time: null }); // abandoning mid-puzzle still uses today's try
  beginGame(puzzle, puzzle.gotdDate);
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
  const t = $('seedTag'); if (t) t.style.display = on ? 'inline' : 'none';
}
function installDevReveal() {
  const typing = t => t && t.tagName && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  addEventListener('keydown', e => { if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) setDevReveal(true); });
  addEventListener('keyup', e => { if (e.key === 'v' || e.key === 'V') setDevReveal(false); });
  addEventListener('blur', () => setDevReveal(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setDevReveal(false); });
}

// ---------- boot ----------
(async function boot() {
  storage = await pickStorage(); store = createStore(storage, SIZES); daily = createDaily(storage);
  try { await store.hydrate(today()); } catch (e) { console.warn('stats hydration failed:', e); }
  try { for (const n of SIZES) S.nextIdx[n] = (await daily.peek(n)).index; } catch (e) { console.warn('daily counters failed:', e); }
  modal = bindModal($('exportModal'));
  $('exportClose').onclick = modal.close; $('exportCopy').onclick = () => copyText($('exportText'), $('exportMsg'));
  installDevReveal(); render();
})();
