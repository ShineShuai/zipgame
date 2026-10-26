// The pointer input on the board (drag, tap, undo) and resetting the path.
import { arrowAllows, edgeId } from '../../core/edges.js';
import { gridAdjacent } from '../../core/rules.js';
import { labelRanks } from '../../core/model.js';
import { legsUndo } from '../../features/share.js';
import { WRAP_PAD, cellAtPoint } from '../../view/geometry.js';
import {
  routeCells, seamMarksSvg, jumpMarksSvg, loopOpenMarks, loopOpen, badgeColorsTwo, badgeColors,
  stepWrong,
} from './board.js';
import { pentagonAcross, pentagonCellAt, pentagonPoint } from './pentagon-board.js';
import { isPentagon } from '../../core/pentagon.js';
import { legsUndoTwo, newPaths, walkColour, solvedPaths, pickColour } from '../../features/twopaths-play.js';
import { t } from '../../ui/i18n.js';
import { traceClear, traceStep } from '../../features/playlog.js';
import { sfxBlocked, sfxCheckpoint, sfxMoveAfterCheckpoint, sfxMove, sfxBack } from '../../platform/sound.js';
import { $, S, render } from './state.js';
import { routeOf, solvedOf, stepOf } from './puzzle-kit.js';
import { loopNoteKey, refreshTwoLegend } from './game-view.js';
import { onSolved } from './game-flow.js';

// Reset path: nothing is drawn any more (a Two paths puzzle: neither colour).
export function resetPaths() {
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
export function setupGridInput(svg) {
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
    const shape = badge.querySelector('.num-shape, circle'); // Two paths and a themed square number: .num-shape; else the circle
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
  const across = isPentagon(p) ? pentagonAcross(p) : n; // cells across the board, about
  function move(x, y) { // interpolate so fast drags don't skip cells
    const cell = (px, py) => {
      if (isPentagon(p)) return pentagonCellAt(p, ...pentagonPoint(p, rect, px, py));
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
