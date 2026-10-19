import { solveSurface } from './solve.js';
import { topologyOf, isSolved } from './puzzle.js';
import { SLOTS } from './topology.js';
import {
  TRAP_CFG, trapPredict, trapGradeOf, capGradeBySize, withoutAltFracLadder,
} from '../trap.js';

// The trap grade (core/trap.js: what wrong turns a solver faces along the solution, and how long
// each takes to refute) for puzzles on a surface or flat board (core/surface), the Pentagon
// puzzles: the same measurements and thresholds, with the graph solver (solve.js) and the
// neighbours of the board in place of the grid's.
//
// The score model is the reduced one of the other variants (trapMax and trapTop3 only): the fit
// never saw such a board, so this is a ranking without hand ratings behind it. Refit when ratings
// of Pentagon puzzles exist. The cap by size uses the side of a square board with as many cells.
export const PENTAGON_MODEL = withoutAltFracLadder();

// The side of a square board with as many cells as p has, for the cap of the grade by size.
export const sideOf = p => Math.round(Math.sqrt(topologyOf(p).T));

// The puzzle's solution: the generator's own (p.path) when valid, else one solve. null when none
// is found within `cap` steps.
export function surfaceSolutionPath(p, cap = TRAP_CFG.pathCap) {
  if (p.path && isSolved(p, p.path)) {
    return p.path;
  }
  return solveSurface(p, { limit: 1, nodeCap: cap }).path;
}

// Every wrong turn along `path`: [{ i, cell, sub, capped }], as trapProfile in core/trap.js: sub =
// the steps the solver needed below the wrong move (0: a local prune already rejected it), capped
// = it survived cfg.cap steps. A wrong turn is an unvisited neighbour over a side with no wall
// that is not the solution's next cell.
export function surfaceTrapProfile(p, path, cfg = TRAP_CFG) {
  const top = topologyOf(p);
  const seen = new Uint8Array(top.T);
  const out = [];
  let nonUnique = false;
  for (let i = 0; i < path.length - 1; i++) {
    seen[path[i]] = 1;
    for (let k = 0; k < top.deg[path[i]]; k++) {
      const cell = top.nb[path[i] * SLOTS + k];
      const edge = top.edgeAt[path[i] * SLOTS + k];
      if (cell < 0 || seen[cell] || cell === path[i + 1] || p.walls[edge]) {
        continue;
      }
      const forced = path.slice(0, i + 1).concat(cell);
      const r = solveSurface(p, { limit: 1, nodeCap: cfg.cap, forced });
      if (r.count > 0) {
        nonUnique = true; // a second solution, not a trap
        continue;
      }
      out.push({ i, cell, sub: r.nodes, capped: r.capped });
    }
  }
  out.nonUnique = nonUnique;
  return out;
}

const alternativePoints = (w, cfg) => {
  if (w.capped) {
    return cfg.points[3];
  }
  if (w.sub <= cfg.obvious) {
    return cfg.points[0];
  }
  return w.sub <= cfg.shallow ? cfg.points[1] : cfg.points[2];
};

// All the metrics of core/trap.js trapMetricsFromProfile that the model and the display use.
export function surfaceTrapMetricsFromProfile(p, profile, cfg = TRAP_CFG, model = PENTAGON_MODEL) {
  const T = topologyOf(p).T;
  const byStep = new Map();
  for (const w of profile) {
    const s = byStep.get(w.i) || { i: w.i, score: 0, worst: null };
    s.score += alternativePoints(w, cfg);
    if (!s.worst || (w.capped ? Infinity : w.sub) > (s.worst.capped ? Infinity : s.worst.sub)) {
      s.worst = w;
    }
    byStep.set(w.i, s);
  }
  const steps = [...byStep.values()].sort((a, b) => b.score - a.score || a.i - b.i);
  const m = {
    T,
    altFrac: byStep.size / T,
    trapMax: steps.length ? steps[0].score : 0,
    trapTop3: steps.slice(0, 3).reduce((sum, x) => sum + x.score, 0),
    trapDeep: steps.filter(s => s.score >= cfg.points[3]).length,
    alternatives: profile.length,
    nonUnique: profile.nonUnique,
    steps,
    ladTrials: 0, // the ladder (core/ladder.js) knows only the grid
  };
  m.lTr = Math.log1p(m.ladTrials);
  m.predicted = trapPredict(m, model);
  m.gradeUncapped = trapGradeOf(m.predicted, model);
  m.grade = capGradeBySize(m.gradeUncapped, sideOf(p));
  return m;
}

// One call, like trapMetrics in core/trap.js: { ok: false, reason } when no solution is found,
// else { ok: true, path, ...metrics }.
export function surfaceTrapMetrics(p, cfg = TRAP_CFG, path = null, model = PENTAGON_MODEL) {
  const solution = path || surfaceSolutionPath(p, cfg.pathCap);
  if (!solution) {
    return { ok: false, reason: 'no solution found within the search budget (pathCap)' };
  }
  const profile = surfaceTrapProfile(p, solution, cfg);
  return { ok: true, path: solution, ...surfaceTrapMetricsFromProfile(p, profile, cfg, model) };
}
