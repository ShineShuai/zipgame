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
import { boardSvg, CELL } from './board.js';
import { VERSION } from '../../version.js';

const SIZES = PLAY_SIZES;
const S = { screen: 'menu', size: 7, puzzle: null, path: [], elapsed: 0, startTime: 0, timerId: null, finished: false,
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, gotdDate: null, gotdHint: null, hintsUsed: 0, hintCell: null, hintWrongCell: null, showDev: false };
let storage, store, daily, modal;
const $ = id => document.getElementById(id), today = () => utcDateString(new Date()), dayNo = () => utcDayNumber(new Date()), sec = x => x.toFixed(1) + 's';

// ---------- render ----------
function render() {
  const html = S.screen === 'menu' ? renderMenu() : S.screen === 'generating' ? renderGenerating() : renderGame();
  $('app').innerHTML = html + `<div id="versionBadge" class="small" style="position:fixed;right:10px;bottom:10px;z-index:20;background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:4px 8px;font-size:11px;color:#666;display:${S.showDev ? 'block' : 'none'}">Zip v${VERSION}</div>`;
  attachHandlers();
}
function renderGenerating() {
  const g = S.gen, pct = Math.round(g.frac * 100), w = g.walls == null ? 'searching…' : g.walls + ' wall' + (g.walls === 1 ? '' : 's') + ' so far';
  return `<div class="card"><h3 style="margin:0 0 4px;font-size:18px;font-weight:500">Generating puzzle…</h3>
    <p class="small" style="margin:0 0 16px">${S.size}x${S.size} grid — looking for the cleanest layout.</p>
    <div style="background:#eee;border-radius:8px;height:10px;overflow:hidden;margin-bottom:10px"><div style="background:#1a1a1a;height:100%;width:${pct}%;transition:width .1s linear"></div></div>
    <p class="small" style="margin:0">${pct}% — ${w}</p></div>`;
}
function refreshAttemptIfStale() {
  if (store.attemptDate() !== today()) store.hydrateAttempt(today()).then(() => { if (S.screen === 'menu') render(); });
}
async function refreshNext() { // "next game #" per size, from the per-size daily counters
  const next = {}; for (const n of SIZES) next[n] = (await daily.peek(n)).index;
  if (JSON.stringify(next) !== JSON.stringify(S.nextIdx)) { S.nextIdx = next; if (S.screen === 'menu') render(); }
}
const gameNo = n => S.nextIdx[n] == null ? '-' : '#' + (S.nextIdx[n] + 1);
function renderMenu() {
  refreshAttemptIfStale(); refreshNext();
  const a = store.attempt();
  const gotdBtn = a ? '<button class="btn secondary" disabled title="One Game of Day per day">Game of Day</button>' : '<button class="btn secondary" id="playGotd">Game of Day</button>';
  return `<div class="card"><h3 style="margin:0 0 4px;font-size:18px;font-weight:500">Zip</h3>
    <p class="small" style="margin:0 0 16px">Connect the numbers in order through every cell. No revisits, no crossings. Drag with mouse or finger to draw.</p>
    <div class="row" style="margin-bottom:12px"><label class="small">Grid size</label><select id="sizeSel">${SIZES.map(n => `<option value="${n}"${n === S.size ? ' selected' : ''}>${n}x${n}</option>`).join('')}</select><span class="small" id="gameNo">Today's game: ${gameNo(S.size)}</span></div>
    <div class="row"><button class="btn" id="playLocal">Play local</button>${gotdBtn}</div>
    ${a ? `<p class="small" style="margin:10px 0 0">${a.solved ? `Today's Game of Day: solved in ${sec(a.time)}.` : "Today's Game of Day already attempted."}</p>` : ''}
    ${S.gotdHint ? `<p class="small" style="margin:10px 0 0;color:#a33">${S.gotdHint}</p>` : ''}
    <p class="small" style="margin:12px 0 0">Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}</p></div>${menuStats()}`;
}
const gotdText = n => { const g = store.gotdBest(n); return g ? sec(g.time) : '-'; };
// "today / total" cells for one size (today = current UTC day).
function statCells(n) {
  const T = store.total(n), D = store.today(n, dayNo()), t = statSummary(T), d = statSummary(D);
  const f = (q, x) => q.n ? x.toFixed(1) : '-', b = st => st.recent.length ? Math.min(...st.recent).toFixed(1) : '-';
  return { solves: `${d.n} / ${t.n}`, avg: `${f(d, d.mean)} / ${f(t, t.mean)}`, sd: `${f(d, d.sd)} / ${f(t, t.sd)}`, best: `${b(D)} / ${b(T)}` };
}
function menuStats() {
  const rows = SIZES.map(n => {
    if (!store.total(n).n && !store.gotdBest(n) && !S.nextIdx[n]) return '';
    const c = statCells(n);
    return `<tr><td>${n}x${n}</td><td><b>${gameNo(n)}</b></td><td><b>${c.solves}</b></td><td><b>${c.avg}</b></td><td><b>${c.sd}</b></td><td><b>${c.best}</b></td><td><b>${gotdText(n)}</b></td></tr>`;
  }).join('');
  return rows ? `<div class="card"><div class="hud"><span>Your stats — today / total (UTC day, seconds)</span><span></span></div><div style="overflow-x:auto"><table><tr><th>Grid</th><th>Next game</th><th>Solves</th><th>Avg</th><th>Std dev</th><th>Best (last 20)</th><th>Game of Day</th></tr>${rows}</table></div></div>` : '';
}
function sizeStats(n) {
  if (!store.total(n).n && !store.gotdBest(n)) return '';
  const c = statCells(n), row = (k, v) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`;
  return `<div class="card"><div class="hud"><span>Your stats — ${n}x${n} · today / total</span><span></span></div><table>${row('Solves', c.solves)}${row('Avg time (s)', c.avg)}${row('Std dev (s)', c.sd)}${row('Best (last 20, s)', c.best)}${row('Game of Day', gotdText(n))}</table></div>`;
}
function renderGame() {
  const p = S.puzzle, t = sec(S.elapsed), cap = maxHints(p);
  return `<div class="card"><div class="hud"><span>${S.isGotd ? 'Game of Day ' + S.gotdDate : `Local ${p.n}x${p.n} · game #${S.gameIndex + 1} today<span id="seedTag" class="small" style="margin-left:8px;display:${S.showDev ? 'inline' : 'none'}">seed ${S.seed}</span>`}<button class="btn secondary" id="exportBtn" style="margin-left:16px;padding:3px 10px;font-size:12px;line-height:1;vertical-align:middle;visibility:${S.showDev ? 'visible' : 'hidden'}">Export</button></span><span>Time: <b id="hudTime">${t}</b></span></div>
    <div class="grid-wrap" id="gridWrap">${boardSvg(S)}</div>
    <div class="row"><button class="btn secondary" id="backMenu2">Menu</button>${S.isGotd ? '' : '<button class="btn secondary" id="newPuzzle">New puzzle</button>'}<button class="btn secondary" id="resetPath">Reset path</button><button class="btn secondary" id="hintBtn" style="${S.showDev ? '' : 'display:none'}" ${S.finished || S.hintsUsed >= cap ? 'disabled' : ''}>Hint (${S.hintsUsed}/${cap})</button></div>
    ${S.finished ? `<p style="color:#1a6e2c;font-weight:500;margin-top:10px">Solved in ${t}</p>` : ''}</div>${sizeStats(p.n)}`;
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
  const fill = (i, f) => { const g = svg.querySelector(`[data-num-cell="${i}"]`); if (!g) return; g.querySelector('circle').setAttribute('fill', f ? '#1a1a1a' : '#fff'); g.querySelector('text').setAttribute('fill', f ? '#fff' : '#1a1a1a'); };
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
  const x = $('exportBtn'); if (x) x.style.visibility = on ? 'visible' : 'hidden';
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
