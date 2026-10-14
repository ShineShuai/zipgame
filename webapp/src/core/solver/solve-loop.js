import { maxNumber, startCell, cellCount } from '../model.js';
import { canStep } from '../rules.js';
import { neighbourCell } from '../geom.js';

// Solver of a Loop puzzle (puzzle.loop, core/model.js): a Hamiltonian path from cell 1 through the
// numbers 1..K in order whose last cell touches cell 1 through an open edge, so the path and that
// edge are a ring. K need not be the last cell.
//
// The search below is the standard one, run once per possible last cell c: a neighbour of cell 1
// across an open edge, that is not numbered 2..K-1 (the path cannot end before K). When c is
// numbered K the puzzle is searched as it is; otherwise c gets the extra number K + 1, so the path
// has to end there. The solutions of the loop puzzle are the solutions of these searches together
// (a path ends on one cell only, so none is counted twice), and every option of solve() (prune,
// propagation, forced prefix, ...) reaches each search unchanged.
//
// search(puzzle, opts): the standard search (solve.js searchPaths).
// opts.mustUse [a, b]: only solutions that use the edge a-b, as a step of the path or, when it is
// the edge between cell 1 and c, as the closing edge: every solution ending on c uses that one.
// Returns solve()'s result summed over the searches; nodeCap is shared by all of them.

// The cells a ring can close on: the neighbours of cell 1 across an open edge, in the solver's
// direction order (right, left, down, up).
export function loopClosers(p) {
  const start = startCell(p);
  const cells = [];
  for (let d = 0; d < 4; d++) {
    const c = neighbourCell(p.n, false, start, d);
    if (c >= 0 && canStep(p, start, c)) cells.push(c);
  }
  return cells;
}

// The puzzle of the standard search that ends on c: c is checkpoint K + 1.
function endingOn(p, c, K) {
  const { loop, ...rest } = p;
  const cp = p.cp.slice();
  cp[c] = K + 1;
  return { ...rest, cp };
}

const nothing = opts => ({ count: 0, exceeded: false, nodes: 0, paths: opts.capture ? [] : undefined });

export function solveLoop(p, opts, search) {
  const K = maxNumber(p);
  const start = startCell(p);
  if (K < 3 || start < 0 || cellCount(p) % 2) return nothing(opts);

  const limit = opts.limit ?? 2;
  const cap = opts.nodeCap || 200000;
  const must = opts.mustUse || null;
  const total = { ...nothing(opts), subNodes: 0 };
  if (opts.decisions) {
    total.decisionNodes = 0;
    total.maxDecisionDepth = 0;
  }

  for (const c of loopClosers(p)) {
    const number = p.cp[c];
    if (number && number !== K) continue;
    if (total.count >= limit) break;
    const left = cap - total.subNodes;
    if (left < 1) {
      total.exceeded = true;
      break;
    }
    const closing = must && ((must[0] === start && must[1] === c) || (must[0] === c && must[1] === start));
    const sub = { ...opts, limit: limit - total.count, nodeCap: left };
    if (closing) delete sub.mustUse;
    const r = search(number ? p : endingOn(p, c, K), sub);
    total.count += r.count;
    total.nodes += r.nodes;
    total.subNodes += r.subNodes ?? 0;
    total.exceeded ||= r.exceeded;
    if (total.paths) total.paths.push(...(r.paths || []));
    if (opts.decisions) {
      total.decisionNodes += r.decisionNodes ?? 0;
      total.maxDecisionDepth = Math.max(total.maxDecisionDepth, r.maxDecisionDepth ?? 0);
    }
  }
  if (total.count >= limit) total.exceeded = false;
  return total;
}
