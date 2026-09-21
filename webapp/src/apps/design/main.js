import { makePuzzle, validate, maxNumber } from '../../core/model.js';
import { allEdges, hasWallId, setWallId, wallIds, wallCount as countWalls, pathEdgeIds } from '../../core/edges.js';
import { serialize, parse } from '../../core/format.js';
import { shuffle } from '../../core/rng.js';
import { solve } from '../../core/solver/solve.js';
import { step } from '../../core/rules.js';
import { randomPathPuzzle, generateUnique, CAPPED_TRIES } from '../../core/gen/generate.js';
import { minimizeWalls } from '../../core/gen/walls.js';
import { scatter } from '../../core/gen/checkpoints.js';
import { cellAtPoint } from '../../view/geometry.js';
import { runAsync } from '../../platform/run.js';
import { bindModal, copyText } from '../../ui/modal.js';
import { installHoldReveal } from '../../ui/hold-reveal.js';
import { VERSION } from '../../version.js';
import { renderBoard, paintPlay, cellSizeFor, TPL_C, SOL_C } from './board.js';

const DEFAULT_NODE_LIMIT = 300000, rnd = Math.random, $ = id => document.getElementById(id);
const boardEl = $('board'), stageEl = document.querySelector('.stage'), plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
let P = makePuzzle(7), mode = 'number', selected = -1, buffer = '', solutions = [], solVisible = [], lastAborted = false, lastNodes = 0;
let preview = null, previewVisible = true, playMode = false, playPath = [], drawing = false, refs = {}, numDrag = null, dragGhost = null, suppressClick = false, busy = false, modalMode = 'export';
const playStep = { truncate: true, strictOrder: true }, modal = bindModal($('modalBackdrop'));

// ---------- helpers ----------
const view = () => ({ P, cellSize: cellSizeFor(P.n), mode, selected, buffer, playMode, playPath, preview, previewVisible, solutions, solVisible, dragSrc: numDrag && numDrag.dragging ? numDrag.src : -1 });
function draw() {
  refs = renderBoard(boardEl, stageEl, view());
  $('wallModeTag').textContent = countWalls(P) ? `(${countWalls(P)})` : '';
  if (playMode) paintPlayNow();
  updateValidity();
}
function setStatus(msg, type) { const s = $('status'); s.className = msg ? 'status show ' + (type || '') : 'status'; s.textContent = msg || ''; }
function nodeLimit() { const v = parseInt($('nodeLimit').value, 10); return Number.isFinite(v) && v >= 1000 ? v : DEFAULT_NODE_LIMIT; }
function clearSolutions() { solutions = []; solVisible = []; lastAborted = false; lastNodes = 0; renderLegend(); setStatus(''); }
function clearPreview() { if (preview) { preview = null; previewVisible = true; renderLegend(); } }
const wallable = () => { const all = allEdges(P.n); if (!preview || preview.length < 2) return all; const pe = new Set(pathEdgeIds(P.n, preview)); return all.filter(e => !pe.has(e)); };
function updateWallCapTag() {
  const cap = wallable().filter(e => !hasWallId(P.walls, e)).length + countWalls(P);
  $('wallCapTag').textContent = `(≤ ${cap})`; $('wallCount').max = cap;
  if (parseInt($('wallCount').value, 10) > cap) $('wallCount').value = cap;
}
function setBusy(b) { busy = b; document.querySelectorAll('button').forEach(x => { x.disabled = b; }); }
function adopt(q) { P = { n: q.n, cp: q.cp, walls: q.walls }; preview = q.path || null; previewVisible = true; selected = -1; buffer = ''; }
function setDefaults(n) { $('cpCount').max = n * n; $('cpCount').value = n; $('wallCount').value = n; updateWallCapTag(); } // max checkpoints / max walls default to the grid size
function refresh() { clearSolutions(); draw(); renderLegend(); updateWallCapTag(); }

function updateValidity() {
  const v = validate(P), el = $('validity');
  el.className = 'validity ' + (v.ok ? 'good' : 'bad');
  el.textContent = v.ok ? `Checkpoints 1…${v.max} — valid ✓` : v.msg;
}
function renderLegend() {
  const lg = $('legend'); lg.innerHTML = '';
  const chip = (color, text, off, onClick) => {
    const b = document.createElement('button'); b.className = 'legend-item' + (off ? ' off' : '');
    b.innerHTML = `<span class="swatch" style="background:${color}"></span> ${text}`; b.addEventListener('click', onClick); lg.appendChild(b);
  };
  if (preview) chip(TPL_C, 'Template path', !previewVisible, () => { previewVisible = !previewVisible; renderLegend(); draw(); });
  solutions.forEach((_, i) => chip(SOL_C[i], `Solution ${i + 1} — ${plural(lastNodes, 'node')}${lastAborted ? ' (capped)' : ''}`, !solVisible[i], () => { solVisible[i] = !solVisible[i]; renderLegend(); draw(); }));
}
function updateHint() {
  $('hint').textContent = playMode ? 'Drag from checkpoint 1 through every cell. Move back over the path to undo.'
    : mode === 'number' ? 'Click a cell then type a number (Enter to confirm · Esc to cancel). Drag a numbered cell to move it to an empty cell. Press Delete or Backspace to clear the selected cell.'
      : 'Click the gaps between cells to add or remove blocking walls.';
}
function setMode(m) { mode = m; $('modeNumber').classList.toggle('active', m === 'number'); $('modeWall').classList.toggle('active', m === 'wall'); updateHint(); draw(); }
function resetBoard(n) {
  if (playMode) exitPlay();
  P = makePuzzle(n); preview = null; previewVisible = true; selected = -1; buffer = ''; playPath = []; drawing = false;
  $('cpCount').max = n * n; if (parseInt($('cpCount').value, 10) > n * n) $('cpCount').value = n * n;
  refresh(); updateHint();
}

// ---------- editing ----------
boardEl.addEventListener('click', e => {
  if (playMode || busy) return;
  if (suppressClick) { suppressClick = false; return; }
  const w = e.target.closest('.wallhit');
  if (w && mode === 'wall') { const id = +w.dataset.edge; setWallId(P.walls, id, !hasWallId(P.walls, id)); clearSolutions(); clearPreview(); draw(); updateWallCapTag(); return; }
  const c = e.target.closest('.cell');
  if (c && mode === 'number') { selected = +c.dataset.idx; buffer = ''; draw(); }
});
document.addEventListener('keydown', e => {
  if (modal.isOpen() || playMode || busy || mode !== 'number' || selected < 0) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); buffer = (buffer + e.key).slice(0, 3); draw(); }
  else if (e.key === 'Backspace') { e.preventDefault(); if (buffer) buffer = buffer.slice(0, -1); else if (P.cp[selected]) { P.cp[selected] = 0; clearSolutions(); } draw(); }
  else if (e.key === 'Enter') { e.preventDefault(); commitBuffer(); }
  else if (e.key === 'Escape') { buffer = ''; draw(); }
  else if (e.key === 'Delete') { e.preventDefault(); buffer = ''; P.cp[selected] = 0; clearSolutions(); draw(); }
});
function commitBuffer() {
  const v = parseInt(buffer, 10);
  if (buffer !== '' && v >= 1 && v <= P.n * P.n) { for (let i = 0; i < P.cp.length; i++) if (P.cp[i] === v) P.cp[i] = 0; P.cp[selected] = v; clearSolutions(); clearPreview(); }
  buffer = ''; draw();
}
const cellFromEvent = e => { const r = boardEl.getBoundingClientRect(); return cellAtPoint(P.n, e.clientX - r.left, e.clientY - r.top, r.width, r.height); };
const clearDrop = () => document.querySelectorAll('.cell.drop-target').forEach(el => el.classList.remove('drop-target'));
function moveGhost(x, y) { if (dragGhost) { dragGhost.style.left = x + 'px'; dragGhost.style.top = y + 'px'; } }
function endGhost() { if (dragGhost) { dragGhost.remove(); dragGhost = null; } }

boardEl.addEventListener('pointerdown', e => {
  if (busy) return;
  if (playMode) { // start (or rewind) the play path
    const idx = cellFromEvent(e); if (idx < 0) return; e.preventDefault();
    if (!playPath.length) { if (P.cp[idx] !== 1) { $('playInfo').textContent = 'Start at checkpoint 1.'; return; } playPath = [idx]; }
    else { const i = playPath.indexOf(idx); if (i < 0) return; playPath = playPath.slice(0, i + 1); }
    drawing = true; paintPlayNow(); return;
  }
  if (mode !== 'number') return;
  const c = e.target.closest('.cell'); if (!c || !P.cp[+c.dataset.idx]) return;
  numDrag = { src: +c.dataset.idx, x: e.clientX, y: e.clientY, dragging: false };
});
addEventListener('pointermove', e => {
  if (playMode) { // extend the play path
    if (!drawing) return;
    const idx = cellFromEvent(e); if (idx >= 0 && step(P, playPath, idx, playStep)) paintPlayNow();
    return;
  }
  if (!numDrag) return;
  if (!numDrag.dragging && (e.clientX - numDrag.x) ** 2 + (e.clientY - numDrag.y) ** 2 > 25) {
    numDrag.dragging = true; endGhost();
    dragGhost = document.createElement('div'); dragGhost.className = 'drag-ghost'; dragGhost.textContent = P.cp[numDrag.src];
    const s = Math.round(cellSizeFor(P.n) * 0.66); Object.assign(dragGhost.style, { width: s + 'px', height: s + 'px', fontSize: Math.max(12, Math.round(cellSizeFor(P.n) * 0.32)) + 'px' });
    document.body.appendChild(dragGhost); moveGhost(e.clientX, e.clientY); draw(); // draw dims the source badge
  }
  if (numDrag.dragging) {
    moveGhost(e.clientX, e.clientY); clearDrop();
    const idx = cellFromEvent(e);
    if (idx >= 0 && idx !== numDrag.src && !P.cp[idx]) { const el = boardEl.querySelector(`.cell[data-idx="${idx}"]`); if (el) el.classList.add('drop-target'); }
  }
});
addEventListener('pointerup', e => {
  drawing = false;
  if (!numDrag) return;
  clearDrop();
  if (numDrag.dragging) {
    endGhost(); const idx = cellFromEvent(e);
    if (idx >= 0 && idx !== numDrag.src && !P.cp[idx]) { P.cp[idx] = P.cp[numDrag.src]; P.cp[numDrag.src] = 0; selected = idx; buffer = ''; clearSolutions(); clearPreview(); }
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 120); numDrag = null; draw(); return;
  }
  numDrag = null;
});
addEventListener('pointercancel', () => { drawing = false; endGhost(); clearDrop(); numDrag = null; });

// ---------- play ----------
function paintPlayNow() {
  paintPlay(refs, P.n, playPath);
  const total = P.n * P.n, K = maxNumber(P), info = $('playInfo');
  if (!playPath.length) info.textContent = `Drag from checkpoint 1 to start. 0 / ${total} cells.`;
  else if (playPath.length === total) info.textContent = '🎉 Solved! Every cell visited exactly once.';
  else {
    let hi = 0; for (const c of playPath) hi = Math.max(hi, P.cp[c]);
    const last = playPath[playPath.length - 1], extra = K > 1 && P.cp[last] === K ? ' — final checkpoint reached but board not full.' : '';
    info.textContent = `${playPath.length} / ${total} cells · next checkpoint: ${hi + 1 <= K ? '#' + (hi + 1) : '—'}${extra}`;
  }
}
function enterPlay() {
  const v = validate(P); if (!v.ok) { setStatus('Fix the puzzle before playing: ' + v.msg, 'error'); return; }
  playMode = true; playPath = []; drawing = false; solutions = []; solVisible = []; selected = -1; buffer = ''; endGhost(); numDrag = null;
  $('playBtn').classList.add('on'); $('playBtn').textContent = '■ Stop playing'; $('playInfo').style.display = '';
  setStatus(''); updateHint(); draw(); renderLegend();
}
function exitPlay() {
  playMode = false; playPath = []; drawing = false;
  $('playBtn').classList.remove('on'); $('playBtn').textContent = '▶ Play'; $('playInfo').style.display = 'none';
  updateHint(); draw();
}

// ---------- tools ----------
function doSolve() {
  if (playMode) exitPlay();
  const v = validate(P); if (!v.ok) { clearSolutions(); setStatus(v.msg, 'error'); return; }
  previewVisible = false;
  const r = solve(P, { limit: 2, nodeCap: nodeLimit(), capture: true, prop: true });
  solutions = r.paths; solVisible = solutions.map(() => true); lastAborted = r.exceeded; lastNodes = r.nodes;
  draw(); renderLegend(); updateWallCapTag();
  if (r.count >= 2) setStatus('Multiple solutions — this puzzle is NOT unique. Showing 2 (click the legend chips to toggle).', 'warn');
  else if (r.count === 1) setStatus(r.exceeded ? 'Found 1 solution so far, but the search limit was reached — it may not be unique.' : 'Unique solution found ✓', r.exceeded ? 'warn' : 'ok');
  else setStatus(r.exceeded ? 'Search limit reached without finding a solution — the puzzle may be unsolvable.' : 'No solution exists for this puzzle.', r.exceeded ? 'warn' : 'error');
}
const int_ = (id, def, min) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) && v >= min ? v : def; };
const K_ = () => parseInt($('cpCount').value, 10) || P.n, W_ = () => { const v = parseInt($('wallCount').value, 10); return Number.isFinite(v) && v >= 0 ? v : P.n; };
async function doMinimize() {
  if (playMode) exitPlay();
  const v = validate(P); if (!v.ok) { clearSolutions(); setStatus('Fix the puzzle before minimizing: ' + v.msg, 'error'); return; }
  const limit = nodeLimit(), before = countWalls(P), first = solve(P, { limit: 2, nodeCap: limit, prop: true });
  solutions = []; solVisible = []; lastAborted = false; lastNodes = 0; previewVisible = false;
  if (first.exceeded || first.count !== 1) {
    draw(); renderLegend();
    const why = first.exceeded ? 'the search limit was reached before confirming it' : first.count === 0 ? 'it has no solution' : 'it has multiple solutions';
    return setStatus(`Can't minimize — the puzzle isn't uniquely solvable as-is (${why}). Solve first to check, add walls to disambiguate, or raise the search limit.`, 'error');
  }
  setBusy(true);
  try {
    const r = await runAsync(minimizeWalls(P, wallIds(P), rnd, limit, v.max, true), { onEvent: e => setStatus(`Minimizing… ${plural(e.walls, 'wall')} left`, '') });
    draw(); renderLegend(); updateWallCapTag();
    setStatus(r.removed === 0 ? `All ${plural(before, 'wall')} are already necessary — none could be removed without losing uniqueness.`
      : `Removed ${plural(r.removed, 'unnecessary wall')} — ${plural(r.kept, 'remaining wall')} are each individually necessary for a unique solution.`, 'ok');
  } finally { setBusy(false); }
}

// ---------- import / export / modal ----------
function openModal(m) {
  modalMode = m; $('modalMsg').textContent = ''; $('modalMsg').className = 'modal-msg';
  $('modalTitle').textContent = m === 'export' ? 'Export Puzzle' : 'Import Puzzle';
  $('modalText').value = m === 'export' ? serialize(P) : '';
  $('modalText').placeholder = m === 'export' ? '' : '# Zip Puzzle\nsize 7\ncheckpoints 0,0=1 2,3=2 4,1=3 6,6=4\nwalls H,0,1 V,3,3 H,5,5';
  $('modalOk').textContent = m === 'export' ? 'Copy to clipboard' : 'Import';
  modal.open(); setTimeout(() => $('modalText').focus(), 30);
}
$('modalCancel').onclick = modal.close;
$('modalOk').onclick = async () => {
  const msg = $('modalMsg');
  if (modalMode === 'export') return copyText($('modalText'), msg);
  try {
    const q = parse($('modalText').value);
    if (playMode) exitPlay();
    adopt(q); preview = null; playPath = []; drawing = false;
    const sel = $('sizeSel');
    if (![...sel.options].some(o => +o.value === P.n)) { const o = document.createElement('option'); o.value = P.n; o.textContent = `${P.n} × ${P.n}`; sel.appendChild(o); }
    sel.value = String(P.n); setDefaults(P.n);
    refresh(); updateHint(); msg.textContent = 'Puzzle imported ✓'; msg.className = 'modal-msg ok'; setTimeout(modal.close, 400);
  } catch (err) { msg.textContent = err.message; msg.className = 'modal-msg'; }
};

// ---------- bindings ----------
$('modeNumber').onclick = () => setMode('number'); $('modeWall').onclick = () => setMode('wall');
$('sizeSel').onchange = () => { resetBoard(+$('sizeSel').value); setDefaults(P.n); };
$('clearWalls').onclick = () => { P.walls.fill(0); clearSolutions(); clearPreview(); draw(); updateWallCapTag(); };
$('clearAll').onclick = () => resetBoard(P.n);
$('solveBtn').onclick = doSolve;
$('playBtn').onclick = () => (playMode ? exitPlay() : enterPlay());
$('exportBtn').onclick = () => openModal('export'); $('importBtn').onclick = () => openModal('import');
$('minimizeWalls').onclick = doMinimize;
$('randScatter').onclick = () => {
  if (playMode) exitPlay();
  P.cp = scatter(P, K_(), rnd); P.walls.fill(0); preview = null; previewVisible = true; selected = -1; buffer = '';
  refresh(); setStatus(`Scattered ${Math.min(K_(), P.n * P.n)} random checkpoints. Walls cleared.`, 'ok');
};
$('randPath').onclick = () => {
  if (playMode) exitPlay();
  adopt(randomPathPuzzle(P.n, K_(), rnd)); refresh();
  setStatus("Generated a random Hamiltonian path with checkpoints along it, no walls. The template is shown dashed — click Solve to check it, then add walls manually if it's not unique.", 'ok');
};
$('randPathUnique').onclick = async () => {
  if (playMode) exitPlay();
  const K = Math.min(K_(), P.n * P.n), W = W_(), tries = int_('genTries', CAPPED_TRIES, 1), hardest = $('genHardest').checked;
  setBusy(true); setStatus('Generating…', '');
  try {
    const r = await runAsync(generateUnique(P.n, K, rnd, { maxWalls: W, tries, hardest }), { onEvent: e => setStatus(`Generating… retry ${e.attempt}/${e.of}${hardest ? ` · ${plural(e.found, 'candidate')}` : ''}${e.walls != null ? ` · ${plural(e.walls, 'wall')} so far` : ''}`, '') });
    adopt(r.puzzle); refresh();
    const used = `${plural(maxNumber(P), 'checkpoint')} (max ${K}), ${plural(r.walls, 'wall')} (max ${W})${r.removed ? `, ${r.removed} unnecessary removed` : ''}`;
    if (r.unique) setStatus(hardest ? `Picked the puzzle with the most search nodes (${plural(r.nodes, 'node')}) of ${plural(r.found, 'candidate')} from ${tries} retries: ${used}. The template is shown dashed.` : `Generated a unique puzzle: ${used}; found on retry ${r.attempts}/${tries}. The template is shown dashed.`, 'ok');
    else setStatus(`None of ${tries} retries produced a unique puzzle with ${plural(K, 'checkpoint')} and ≤ ${plural(W, 'wall')}. This does not mean none exists: the search is heuristic, not exhaustive, and each retry tests only one random path and checkpoint placement. Showing the wall-free path instead. Try again, raise Search retries, or raise Max walls / Max checkpoints (more checkpoints need fewer walls).`, 'warn');
  } finally { setBusy(false); }
};
$('randWalls').onclick = () => {
  if (playMode) exitPlay();
  const want = parseInt($('wallCount').value, 10) || 0, pool = shuffle(wallable().filter(e => !hasWallId(P.walls, e)), rnd), k = Math.max(0, Math.min(want, pool.length));
  for (let i = 0; i < k; i++) setWallId(P.walls, pool[i], true);
  clearSolutions(); draw(); updateWallCapTag();
  setStatus(k < want ? `Added ${plural(k, 'wall')} — that's every eligible edge left (none of the anchor path's edges are ever walled).` : `Added ${plural(k, 'random wall')}.`, k < want ? 'warn' : 'ok');
};

// ---------- hidden version badge: hold "v" ----------
function installVersionBadge() {
  const badge = document.createElement('div');
  badge.id = 'versionBadge';
  badge.textContent = `Zip Design v${VERSION}`;
  Object.assign(badge.style, {
    position: 'fixed',
    right: '10px',
    bottom: '10px',
    zIndex: '20',
    background: '#151a2c',
    border: '1px solid #232a44',
    borderRadius: '8px',
    padding: '4px 8px',
    fontSize: '11px',
    color: '#8b93b8',
    display: 'none',
  });
  document.body.appendChild(badge);
  installHoldReveal(visible => {
    badge.style.display = visible ? 'block' : 'none';
  });
}

// ---------- boot ----------
(function seedExample() {
  [[0, 0, 1], [2, 3, 2], [4, 1, 3], [6, 6, 4]].forEach(([r, c, v]) => { P.cp[r * 7 + c] = v; });
  [1, 3 * 7 + 3, 5 * 7 + 5].forEach((cell, i) => setWallId(P.walls, cell * 2 + (i === 1 ? 0 : 1), true)); // H,0,1  V,3,3  H,5,5
  $('sizeSel').value = '7'; setDefaults(7);
  setMode('number'); draw(); renderLegend();
})();
installVersionBadge();
