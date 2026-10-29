// Helpers that treat a flat puzzle and a Pentagon puzzle alike: the rules, the board, the route, the grade.
import { step as surfaceStep, isSolved as surfaceSolved } from '../../core/surface/puzzle.js';
import { step, isSolved } from '../../core/rules.js';
import { sizeArg } from '../../features/share.js';
import { CELL, boardSvg, boardView, routeD } from './board.js';
import {
  pentagonBoardSvg, pentagonCentres, pentagonRouteD, pentagonView,
} from './pentagon-board.js';
import { cellCenter } from '../../view/geometry.js';
import { isPentagon } from '../../core/pentagon.js';
import { t } from '../../ui/i18n.js';
import { playGradesFor } from '../../core/grades.js';

// A Pentagon puzzle (core/pentagon.js) walks and is solved by the rules of the cell graph
// (core/surface) and is drawn by its own board (pentagon-board.js); its size n is about the side
// (6 is 36 cells), shown as the number of cells.
export const stepOf = (p, path, cell) => (
  isPentagon(p) ? surfaceStep(p, path, cell) : step(p, path, cell)
);
export const solvedOf = (p, path) => (isPentagon(p) ? surfaceSolved(p, path) : isSolved(p, path));
export const boardMarkup = state => (isPentagon(state.puzzle) ? pentagonBoardSvg(state) : boardSvg(state));
export const routeOf = (p, line) => (isPentagon(p) ? pentagonRouteD(p, line) : routeD(p, line));
// The whole picture of the board (the camera of the zoom shows a part of it), the centre of a cell in
// it, and how many cells are across it, about.
export const fullViewOf = p => (isPentagon(p) ? pentagonView(p) : boardView(p));
export const cellPoint = (p, cell) => (
  isPentagon(p) ? pentagonCentres(p)[cell] : cellCenter(p.n, cell, CELL)
);
// What a size is called: 7x7 on a square board, 36 cells on a Pentagon board.
export const sizeLabel = (variant, n) => (variant === 'pentagon' ? t('size.cells', sizeArg({ variant, n })) : `${n}x${n}`);

// Grade a puzzle right after generation, once, before it's shown (see core/grades.js playGradesFor):
//   trap   - the main grade (badge): one capped solve per wrong turn along the solution, ~2-200 ms at
//            play sizes; needs no reference solve, so it exists even for puzzles the reference solve caps on.
//   legacy - the previous calibrated grades (decisionNodes, B, crossPerSeg), one reference solve() plus a
//            free geometry pass; shown only on hold-V. null when that solve was capped (then hold-V says so), and for a
//            variant (Cutout, One way arrows): it gets the trap grade only, scored by the model that fits it (core/trap.js modelFor).
// Never throws: a failed grade just means "grade unknown" — the puzzle is still perfectly playable.
export function gradePuzzle(puzzle) {
  try {
    const { trap, legacy } = playGradesFor(puzzle);
    return { ok: trap.ok, trap: trap.ok ? trap : null, legacy };
  } catch (e) {
    console.warn('difficulty grading failed:', e);
    return { ok: false, trap: null, legacy: null };
  }
}
