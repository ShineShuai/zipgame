import { maxNumber } from '../../core/model.js';
import { hasWallId } from '../../core/edges.js';
import { polyPoints } from '../../view/geometry.js';

export const TPL_C = '#8b93b8', PLAY_C = '#5b7cfa', SOL_C = ['#ffa62b', '#38bdf8'];
export const cellSizeFor = n => n <= 5 ? 66 : n <= 7 ? 54 : 46;
const NS = 'http://www.w3.org/2000/svg';
const box = (cls, x, y, w, h) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); return d; };
const poly = (pts, stroke, w, attrs = {}) => {
  const e = document.createElementNS(NS, 'polyline');
  for (const [k, v] of Object.entries({ points: pts, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs })) e.setAttribute(k, v);
  return e;
};

// Paint the whole editable board. V = { P, cellSize, mode, selected, buffer, playMode, playPath, preview, previewVisible, solutions, solVisible, dragSrc }.
// Returns refs to the live play-path elements.
export function renderBoard(board, stage, V) {
  const { P, cellSize: cs } = V, n = P.n, size = n * cs;
  board.style.width = board.style.height = size + 'px';
  stage.style.setProperty('--board-size', size + 'px');
  board.classList.toggle('wallmode', V.mode === 'wall' && !V.playMode);
  board.classList.toggle('playmode', V.playMode);
  board.innerHTML = '';

  for (let i = 0; i < n * n; i++) {
    const d = box('cell editable' + (P.cp[i] ? ' has-number' : '') + (i === V.selected && !V.playMode ? ' selected' : ''), (i % n) * cs, ((i / n) | 0) * cs, cs, cs);
    d.dataset.idx = i; board.appendChild(d);
  }
  const HT = Math.max(10, Math.round(cs * 0.26)), INSET = Math.round(cs * 0.16);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const e = (r * n + c) * 2;
    if (c < n - 1) { const d = box('wallhit v' + (hasWallId(P.walls, e) ? ' on' : ''), (c + 1) * cs - HT / 2, r * cs + INSET, HT, cs - 2 * INSET); d.dataset.edge = e; board.appendChild(d); }
    if (r < n - 1) { const d = box('wallhit h' + (hasWallId(P.walls, e + 1) ? ' on' : ''), c * cs + INSET, (r + 1) * cs - HT / 2, cs - 2 * INSET, HT); d.dataset.edge = e + 1; board.appendChild(d); }
  }

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pathlayer'); svg.setAttribute('viewBox', `0 0 ${n} ${n}`); svg.style.width = svg.style.height = size + 'px';
  if (V.preview && V.previewVisible && !V.playMode) svg.appendChild(poly(polyPoints(n, V.preview), TPL_C, 0.2, { 'stroke-dasharray': '0.28 0.22', opacity: 0.65 }));
  V.solutions.forEach((sol, i) => { if (V.solVisible[i]) svg.appendChild(poly(polyPoints(n, sol), SOL_C[i], 0.24, { opacity: 0.92, ...(i === 1 ? { 'stroke-dasharray': '0.34 0.24' } : {}) })); });
  const refs = {};
  if (V.playMode) {
    refs.line = poly('', PLAY_C, 0.3, { opacity: 0.95 }); svg.appendChild(refs.line);
    refs.head = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ r: 0.16, fill: '#c3d0ff', stroke: PLAY_C, 'stroke-width': 0.06 })) refs.head.setAttribute(k, v);
    svg.appendChild(refs.head);
  }
  board.appendChild(svg);

  const layer = document.createElement('div'); layer.className = 'numlayer';
  const K = maxNumber(P), visited = V.playMode ? new Set(V.playPath) : null;
  for (let i = 0; i < n * n; i++) {
    const v = P.cp[i], pending = !V.playMode && i === V.selected && V.buffer !== '';
    if (!v && !pending) continue;
    const wrap = box('badge', (i % n) * cs, ((i / n) | 0) * cs, cs, cs), inner = document.createElement('div');
    inner.className = 'badge-inner' + (pending ? ' pending' : '') + (v === 1 ? ' start' : '') + (v && v === K ? ' end' : '') + (visited && visited.has(i) ? ' visited' : '') + (i === V.dragSrc ? ' dragging' : '');
    inner.style.fontSize = Math.max(11, Math.round(cs * 0.3)) + 'px';
    inner.textContent = pending ? V.buffer : v;
    wrap.appendChild(inner); layer.appendChild(wrap);
  }
  board.appendChild(layer);
  return refs;
}

// Update the play overlay in place (called on every pointer move).
export function paintPlay(refs, n, path) {
  if (!refs.line) return;
  const done = path.length === n * n;
  refs.line.setAttribute('points', polyPoints(n, path)); refs.line.style.display = path.length > 1 ? '' : 'none';
  refs.line.setAttribute('stroke', done ? '#3ddc97' : PLAY_C);
  if (path.length) {
    const h = path[path.length - 1];
    refs.head.setAttribute('cx', (h % n) + 0.5); refs.head.setAttribute('cy', ((h / n) | 0) + 0.5);
    refs.head.setAttribute('fill', done ? '#8ff5c9' : '#c3d0ff'); refs.head.style.display = '';
  } else refs.head.style.display = 'none';
}
