import { maxNumber, checkpointCells, cellCount } from '../../core/model.js';
import { hasWallId } from '../../core/edges.js';
import { neighbourCell } from '../../core/geom.js';
import {
  polyPoints, wallSegments, cellCenter, arrowSegment, arrowMarks, pathD, seamMarks, chordSegments,
  WRAP_PAD,
} from '../../view/geometry.js';
import { boardConnectivity, boardPropagation, boardLegCollide } from '../../core/connectivity.js';

export const TPL_C = '#8b93b8', PLAY_C = '#5b7cfa', SOL_C = ['#ffa62b', '#38bdf8'], LEG_C = '#c754ff', GRAPH_C = '#2dd4bf';
export const ARROW_C = '#ffd23f';
export const cellSizeFor = n => n <= 5 ? 66 : n <= 7 ? 54 : 46;
const NS = 'http://www.w3.org/2000/svg';
const box = (cls, x, y, w, h) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); return d; };
const poly = (pts, stroke, w, attrs = {}, tag = 'polyline') => {
  const e = document.createElementNS(NS, tag);
  const geometry = tag === 'path' ? { d: pts } : { points: pts };
  for (const [k, v] of Object.entries({ ...geometry, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs })) e.setAttribute(k, v);
  return e;
};
// A route through cells: a polyline; on a wrap-around board a path, whose steps over a seam are two
// stubs (geometry.js pathD).
const route = (n, cells, wrap, stroke, w, attrs = {}) => (wrap
  ? poly(pathD(n, cells, 1, true), stroke, w, attrs, 'path')
  : poly(polyPoints(n, cells), stroke, w, attrs));
// A Loop puzzle's route closes: from its last cell back to cell 1 (the ring). Other puzzles: as it is.
const ringCells = (p, cells) => (p.loop && cells.length > 2 ? [...cells, cells[0]] : cells);
// The in / out arrowheads of the seam steps of a wrap-around route (geometry.js seamMarks), in cell units.
const MARK_LEN = 0.32, MARK_HALF = 0.2;
function seamMarkEls(n, cells, color, opacity = 0.95) {
  return seamMarks(n, cells, 1).map(({ x, y, dx, dy }) => {
    const tip = [x + (dx * MARK_LEN) / 2, y + (dy * MARK_LEN) / 2];
    const base = [x - (dx * MARK_LEN) / 2, y - (dy * MARK_LEN) / 2];
    const wings = [[base[0] - dy * MARK_HALF, base[1] + dx * MARK_HALF], [base[0] + dy * MARK_HALF, base[1] - dx * MARK_HALF]];
    const points = [tip, ...wings].map(q => q.map(v => +v.toFixed(3)).join(',')).join(' ');
    const tri = document.createElementNS(NS, 'polygon');
    const attrs = { points, fill: color, stroke: '#0d1120', 'stroke-width': 0.04, 'stroke-linejoin': 'round', opacity };
    for (const [k, v] of Object.entries(attrs)) tri.setAttribute(k, v);
    return tri;
  });
}

// Paint the whole editable board. V = { P, cellSize, mode, selected, buffer, playMode, playPath, preview, previewVisible, solutions, solVisible, dragSrc }.
// Returns refs to the live play-path elements.
export function renderBoard(board, stage, V) {
  const { P, cellSize: cs } = V, n = P.n, size = n * cs, wrap = !!P.wrap;
  // A wrap-around board has a margin of WRAP_PAD cells on every side (view/geometry.js), where the
  // stubs of a step over a seam and the wall handles of the seam edges are.
  const pad = wrap ? WRAP_PAD : 0, pm = pad * cs, total = size + 2 * pm;
  board.style.width = board.style.height = total + 'px';
  stage.style.setProperty('--board-size', total + 'px');
  board.classList.toggle('wallmode', (V.mode === 'wall' || V.mode === 'arrow') && !V.playMode);
  board.classList.toggle('playmode', V.playMode);
  board.innerHTML = '';

  const cellEls = new Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const d = box('cell editable' + (P.cp[i] ? ' has-number' : '') + (i === V.selected && !V.playMode ? ' selected' : ''), pm + (i % n) * cs, pm + ((i / n) | 0) * cs, cs, cs);
    d.dataset.idx = i; board.appendChild(d); cellEls[i] = d;
  }
  if (wrap) board.appendChild(box('wrapframe', pm, pm, size, size));
  const HT = Math.max(10, Math.round(cs * 0.26)), INSET = Math.round(cs * 0.16);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const e = (r * n + c) * 2;
    // A wall across a seam has a handle on both borders of the board.
    if (c < n - 1 || wrap) {
      for (const x of c < n - 1 ? [pm + (c + 1) * cs] : [pm + size, pm]) {
        const d = box('wallhit v' + (hasWallId(P.walls, e) ? ' on' : ''), x - HT / 2, pm + r * cs + INSET, HT, cs - 2 * INSET); d.dataset.edge = e; board.appendChild(d);
      }
    }
    if (r < n - 1 || wrap) {
      for (const y of r < n - 1 ? [pm + (r + 1) * cs] : [pm + size, pm]) {
        const d = box('wallhit h' + (hasWallId(P.walls, e + 1) ? ' on' : ''), pm + c * cs + INSET, y - HT / 2, cs - 2 * INSET, HT); d.dataset.edge = e + 1; board.appendChild(d);
      }
    }
  }

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pathlayer'); svg.setAttribute('viewBox', `${-pad} ${-pad} ${n + 2 * pad} ${n + 2 * pad}`); svg.style.width = svg.style.height = total + 'px';
  if (V.preview && V.previewVisible && !V.playMode) {
    svg.appendChild(route(n, ringCells(P, V.preview), wrap, TPL_C, 0.2, { 'stroke-dasharray': '0.28 0.22', opacity: 0.65 }));
    if (wrap) seamMarkEls(n, V.preview, TPL_C, 0.65).forEach(m => svg.appendChild(m));
  }
  V.solutions.forEach((sol, i) => {
    if (!V.solVisible[i]) return;
    svg.appendChild(route(n, ringCells(P, sol), wrap, SOL_C[i], 0.24, { opacity: 0.92, ...(i === 1 ? { 'stroke-dasharray': '0.34 0.24' } : {}) }));
    if (wrap) seamMarkEls(n, sol, SOL_C[i], 0.92).forEach(m => svg.appendChild(m));
  });
  const refs = {};
  if (V.playMode) {
    refs.line = route(n, [], wrap, PLAY_C, 0.3, { opacity: 0.95 }); svg.appendChild(refs.line);
    for (const [k, cls] of [['graphLayer', 'graphlayer'], ['propLayer', 'proplayer'], ['legLayer', 'leglayer'], ['seamLayer', 'seamlayer']]) {
      refs[k] = document.createElementNS(NS, 'g'); refs[k].setAttribute('class', cls); svg.appendChild(refs[k]);
    }
    refs.head = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ r: 0.16, fill: '#c3d0ff', stroke: PLAY_C, 'stroke-width': 0.06 })) refs.head.setAttribute(k, v);
    svg.appendChild(refs.head);
  }
  if (P.arrows) { // one-way arrows, above the lines
    for (const { edge, points } of arrowMarks(P)) {
      const tri = document.createElementNS(NS, 'polygon');
      const attrs = {
        points, fill: ARROW_C, stroke: '#0d1120', 'stroke-width': 0.04, 'stroke-linejoin': 'round',
        class: 'arrowmark', 'data-edge': edge,
      };
      for (const [k, v] of Object.entries(attrs)) tri.setAttribute(k, v);
      svg.appendChild(tri);
    }
  }
  board.appendChild(svg);

  const layer = document.createElement('div'); layer.className = 'numlayer';
  const K = maxNumber(P), visited = V.playMode ? new Set(V.playPath) : null;
  for (let i = 0; i < n * n; i++) {
    const v = P.cp[i], pending = !V.playMode && i === V.selected && V.buffer !== '';
    if (!v && !pending) continue;
    const holder = box('badge', pm + (i % n) * cs, pm + ((i / n) | 0) * cs, cs, cs), inner = document.createElement('div');
    inner.className = 'badge-inner' + (pending ? ' pending' : '') + (v === 1 ? ' start' : '') + (v && v === K ? ' end' : '') + (visited && visited.has(i) ? ' visited' : '') + (i === V.dragSrc ? ' dragging' : '');
    inner.style.fontSize = Math.max(11, Math.round(cs * (v > 99 ? 0.24 : 0.3))) + 'px';
    inner.textContent = pending ? V.buffer : v;
    holder.appendChild(inner); layer.appendChild(holder);
  }
  board.appendChild(layer);
  refs.cells = cellEls;
  return refs;
}

// Update the play overlay in place (called on every pointer move).
// showConn: highlight unvisited cells no longer reachable from the head (.conn-unreachable).
// showDead: highlight unvisited reachable cells that are forced dead ends (.conn-dead).
// showProp: draw forced-edge deduction — pinned connections (.conn-forced cells + short highlighted
// segments for each forced edge, including edges forced after a loop-closing edge was dropped) and flag
// when the deduction alone already proves the position stuck.
// showLegCollide: for each colliding leg pair, draw both legs as labelled chords and mark the contested
// cells (.conn-leg-stuck).
// showGraph: directed checkpoint graph, an arrow k -> k+1 for every consecutive pair (path-independent).
// Each reads from its own pass (boardConnectivity / boardPropagation / boardLegCollide) computed once if
// enabled. Returns { legConflicts } (boardLegCollide's conflicts, [] when off) for the caller's info line.
export function paintPlay(refs, n, path, P, showConn, showDead, showProp, showLegCollide, showGraph) {
  const out = { legConflicts: [] };
  if (!refs.line) return out;
  const done = path.length === cellCount(P), wrap = !!P.wrap;
  const drawn = done ? ringCells(P, path) : path; // a solved Loop puzzle is drawn closed
  if (wrap) refs.line.setAttribute('d', drawn.length > 1 ? pathD(n, drawn, 1, true) : '');
  else refs.line.setAttribute('points', polyPoints(n, drawn));
  refs.line.style.display = path.length > 1 ? '' : 'none';
  if (refs.seamLayer) {
    refs.seamLayer.innerHTML = '';
    if (wrap) seamMarkEls(n, path, done ? '#3ddc97' : PLAY_C).forEach(m => refs.seamLayer.appendChild(m));
  }
  refs.line.setAttribute('stroke', done ? '#3ddc97' : PLAY_C);
  if (path.length) {
    const h = path[path.length - 1];
    refs.head.setAttribute('cx', (h % n) + 0.5); refs.head.setAttribute('cy', ((h / n) | 0) + 0.5);
    refs.head.setAttribute('fill', done ? '#8ff5c9' : '#c3d0ff'); refs.head.style.display = '';
  } else refs.head.style.display = 'none';

  if (refs.graphLayer) { refs.graphLayer.innerHTML = ''; if (showGraph) drawGraph(refs.graphLayer, P); }
  if (refs.propLayer) refs.propLayer.innerHTML = '';
  if (refs.legLayer) refs.legLayer.innerHTML = '';
  if (!refs.cells) return out;
  if ((!showConn && !showDead && !showProp && !showLegCollide) || done || !path.length) {
    for (const c of refs.cells) if (c) c.classList.remove('conn-dead', 'conn-unreachable', 'conn-forced', 'conn-stuck', 'conn-leg-stuck');
    return out;
  }
  const { deadEnd, unreachable } = (showConn || showDead) ? boardConnectivity(P, path) : { deadEnd: new Set(), unreachable: new Set() };
  const { dirs, infeasible } = showProp ? boardPropagation(P, path) : { dirs: null, infeasible: false };
  const conflicts = showLegCollide ? boardLegCollide(P, path).conflicts : [];
  const contested = new Set(); for (const k of conflicts) for (const c of k.cells) contested.add(c);
  for (let i = 0; i < refs.cells.length; i++) {
    const c = refs.cells[i]; if (!c) continue;
    c.classList.toggle('conn-dead', showDead && deadEnd.has(i));
    c.classList.toggle('conn-unreachable', showConn && unreachable.has(i));
    c.classList.toggle('conn-forced', showProp && dirs && dirs[i] !== 0);
    c.classList.toggle('conn-stuck', showProp && infeasible && i === path[path.length - 1]);
    c.classList.toggle('conn-leg-stuck', contested.has(i));
  }
  if (showProp && dirs && refs.propLayer) {
    for (let i = 0; i < n * n; i++) {
      const mask = dirs[i];
      if (!mask) continue;
      // dir order R,L,D,U (see prune.js DR/DC) — only draw R and D to avoid double-drawing each
      // edge from both endpoints (its reverse direction on the neighbour is the same segment).
      for (const [bit, dir] of [[1, 0], [4, 2]]) {
        if (!(mask & bit)) continue;
        const next = neighbourCell(n, !!P.wrap, i, dir);
        for (const piece of chordSegments(n, !!P.wrap, i, next)) refs.propLayer.appendChild(seg(...piece));
      }
    }
  }
  if (conflicts.length && refs.legLayer) {
    const drawn = new Set();
    for (const { a, b } of conflicts) for (const leg of [a, b]) {
      const key = leg.join('-'); if (drawn.has(key)) continue; drawn.add(key);
      const pieces = chordSegments(n, !!P.wrap, leg[0], leg[1]);
      for (const piece of pieces) refs.legLayer.appendChild(seg(...piece, LEG_C, 0.1, 0.9));
      // the label sits on the middle of the first piece, kept inside the board
      const [x1, y1, x2, y2] = pieces[0], inside = v => Math.min(n - 0.3, Math.max(0.3, v));
      refs.legLayer.appendChild(label(inside((x1 + x2) / 2), inside((y1 + y2) / 2), legName(P, leg), '#ecd0ff'));
    }
  }
  out.legConflicts = conflicts;
  return out;
}

// Leg as shown to the user: checkpoint numbers, or ● when the leg starts at the head (not on a checkpoint).
export const legName = (P, [s, t]) => `${P.cp[s] || '●'}→${P.cp[t]}`;

function drawGraph(layer, P) {
  const cells = checkpointCells(P);
  for (let k = 0; k + 1 < cells.length; k++) {
    const { line, head } = P.wrap ? wrapArrow(P.n, cells[k], cells[k + 1]) : arrowSegment(P.n, cells[k], cells[k + 1]);
    for (const piece of P.wrap ? line : [line]) layer.appendChild(seg(...piece, GRAPH_C, 0.06, 0.95));
    const tri = document.createElementNS(NS, 'polygon');
    for (const [a, v] of Object.entries({ points: head.join(' '), fill: GRAPH_C, opacity: 0.95 })) tri.setAttribute(a, v);
    layer.appendChild(tri);
  }
}

// arrowSegment() for a wrap-around board: the line takes the shorter way round, so it may be two
// pieces (chordSegments); the head is on the end of the last one. -> { line: [piece...], head }
function wrapArrow(n, a, b, inset = 0.34, headLen = 0.22, headHalf = 0.1) {
  const pieces = chordSegments(n, true, a, b);
  let head = [];
  const line = pieces.map(([x1, y1, x2, y2], i) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const from = i === 0 ? [x1 + ux * inset, y1 + uy * inset] : [x1, y1];
    if (i < pieces.length - 1) return [...from, x2, y2];
    const tip = [x2 - ux * inset, y2 - uy * inset];
    const base = [tip[0] - ux * headLen, tip[1] - uy * headLen];
    head = [...tip, base[0] - uy * headHalf, base[1] + ux * headHalf, base[0] + uy * headHalf, base[1] - ux * headHalf];
    return [...from, ...base];
  });
  return { line, head };
}

function label(x, y, text, fill) {
  const e = document.createElementNS(NS, 'text');
  for (const [k, v] of Object.entries({ x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.26, 'font-weight': 700, fill, stroke: '#0d1120', 'stroke-width': 0.07, 'paint-order': 'stroke', 'stroke-linejoin': 'round' })) e.setAttribute(k, v);
  e.textContent = text;
  return e;
}

function seg(x1, y1, x2, y2, stroke = '#ffd23f', width = 0.1, opacity = 0.85) {
  const e = document.createElementNS(NS, 'line');
  for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round', opacity })) e.setAttribute(k, v);
  return e;
}

// Small static SVG snapshot of a puzzle (grid + walls + checkpoint dots + optional solved path),
// for showing two generation/solve outcomes side by side. Not interactive, no DOM board underneath —
// pure markup string so it can drop straight into an innerHTML'd panel (see renderCompare()).
// p: { n, cp, walls, arrows? }. path: optional array of cell indices (a found solution) to draw as
// a line.
export function miniPreviewSvg(p, path, color) {
  const n = p.n, wrap = !!p.wrap, PAD = wrap ? 0.3 : 0.06; // a wrap-around board shows the stubs of its seam steps
  const lines = wallSegments(p).map(([x1, y1, x2, y2]) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5b6489" stroke-width="0.08" stroke-linecap="round"/>`).join('');
  const marks = p.arrows ? arrowMarks(p).map(({ points }) =>
    `<polygon points="${points}" fill="${ARROW_C}" stroke="#0d1120" stroke-width="0.03" `
    + 'stroke-linejoin="round"/>').join('') : '';
  const dots = [];
  for (let i = 0; i < n * n; i++) {
    if (!p.cp[i]) continue;
    const [cx, cy] = cellCenter(n, i);
    const isEnd = p.cp[i] === maxNumber(p);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="0.16" fill="${p.cp[i] === 1 ? '#3ddc97' : isEnd ? '#ffa62b' : '#232a44'}" stroke="#8b93b8" stroke-width="0.03"/>`);
  }
  const look = `fill="none" stroke="${color}" stroke-width="0.09" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"`;
  let pathLine = '';
  if (path && path.length > 1) {
    path = ringCells(p, path);
    pathLine = wrap ? `<path d="${pathD(n, path, 1, true)}" ${look}/>` : `<polyline points="${polyPoints(n, path)}" ${look}/>`;
  }
  return `<svg viewBox="${-PAD} ${-PAD} ${n + 2 * PAD} ${n + 2 * PAD}" class="mini-preview">
    <rect x="0" y="0" width="${n}" height="${n}" fill="none" stroke="#232a44" stroke-width="0.05"/>
    ${pathLine}${lines}${marks}${dots.join('')}
  </svg>`;
}
