// One feature vector per puzzle: every difficulty metric in the code base. Shared by metrics-eval.mjs (scoring against hand ratings),
// gotd-fit.mjs (fitting each metric to the ratings) and gotd-seed.mjs (the same metrics for a Game-of-Day puzzle).
// `_capped` = the reference solve hit its node cap: the solver-derived metrics (groups legacy and grade) are then only lower bounds.
import { parse } from '../src/core/format.js';
import { metricsFor } from '../src/core/difficulty.js';
import { spatialMetrics } from '../src/core/spatial.js';
import { gradesFromMetrics } from '../src/core/grades.js';
import { trapMetrics } from '../src/core/trap.js';
import { ladder, wideFrac, grade as ladderGrade } from '../src/core/ladder.js';
import { maxNumber } from '../src/core/model.js';
import { DEFAULT_EVAL_CAP, OFFLINE_TRAP_CFG } from './lib.mjs';

// group: struct = puzzle shape only, legacy = solver cost (difficulty.js), spatial = checkpoint geometry (spatial.js),
//        grade = an existing 0-5 grade as shipped, trap = core/trap.js, ladder = core/ladder.js.
// log: count-like features are log-scaled before entering a ridge model (Spearman does not care).
export const DEFS = [
  ['n', 'struct'], ['K', 'struct'], ['walls/T', 'struct'], ['K/T', 'struct'], ['segLen', 'struct'], ['turns/T', 'struct'],
  ['decisionNodes/cell', 'legacy', 1], ['B/N', 'legacy'], ['maxDecisionDepth', 'legacy'], ['nodes/cell', 'legacy', 1],
  ['crossPerSeg', 'spatial'], ['overlapPerSeg', 'spatial'],
  ['grade:decisionNodes', 'grade'], ['grade:B', 'grade'], ['grade:cross', 'grade'], ['grade:combined', 'grade'],
  ['trapMax', 'trap'], ['trapTop3', 'trap'], ['trapDeep', 'trap'], ['altFrac', 'trap'], ['alts/T', 'trap'], ['lTr', 'trap'], ['trapPredicted', 'trap'], ['grade:trap', 'trap'],
  ['ladHardest', 'ladder'], ['ladChain', 'ladder', 1], ['ladTerr', 'ladder', 1], ['ladProbe1', 'ladder', 1], ['ladProbe2', 'ladder', 1], ['ladSearch', 'ladder', 1], ['ladTrials', 'ladder', 1], ['wideFrac', 'ladder'], ['grade:ladder', 'ladder'],
];
export const NAMES = DEFS.map(d => d[0]), GROUP = Object.fromEntries(DEFS.map(d => [d[0], d[1]])), LOG = new Set(DEFS.filter(d => d[2]).map(d => d[0]));
export const isGrade = id => id.startsWith('grade:');
// What each id means, in plain words. [description, label in the design app's difficulty panel or '' when the panel does not show it].
export const INFO = {
  n: ['grid size N', ''], K: ['number of checkpoints', ''], 'walls/T': ['wall segments per cell', ''],
  'K/T': ['checkpoints per cell (K / N^2); more checkpoints = more forced route = easier', ''],
  segLen: ['average cells between two consecutive checkpoints ((N^2-1)/(K-1))', ''], 'turns/T': ['direction changes of the solution path per cell', ''],
  'decisionNodes/cell': ['reference-solver nodes where >= 2 moves survive every prune (real guess points), per cell', 'decisionNodes/cell'],
  'B/N': ['reference-solver backtrack overhead (nodes / cells - 1) divided by N', 'B/N'],
  maxDecisionDepth: ['depth (0-1) of the deepest guess point of the reference solve', 'maxDecisionDepth'],
  'nodes/cell': ['reference-solver nodes per cell', ''],
  crossPerSeg: ['crossings between checkpoint segments, per segment', 'crossPerSeg'], overlapPerSeg: ['bounding-box overlaps between checkpoint segments, per segment', 'overlapPerSeg'],
  'grade:decisionNodes': ['old calibrated 0-5 grade from decisionNodes/cell (quantile buckets of generated puzzles)', 'grade: decisionNodes'],
  'grade:B': ['old calibrated 0-5 grade from B/N (quantile buckets of generated puzzles)', 'grade: B'],
  'grade:cross': ['old calibrated 0-5 grade from crossPerSeg', 'grade: crossPerSeg'], 'grade:combined': ['old calibrated 0-5 grade from z(B/N) + z(crossPerSeg)', 'grade: combined'],
  trapMax: ['trap score of the single worst step of the solution (wrong moves there: 0 / 1 / 3 / 5 points by how long the solver needs to refute them)', 'trapMax'],
  trapTop3: ['sum of the trap scores of the 3 worst steps', 'trapTop3'],
  trapDeep: ['number of solution steps with a trap score >= 5 (a wrong move the solver could not refute within 1000 nodes, or several smaller ones adding up)', 'trapDeep'],
  altFrac: ['fraction of solution steps that have any legal wrong move (low = long forced corridors = easy)', 'altFrac'],
  'alts/T': ['legal wrong moves along the solution, per cell', ''],
  lTr: ['log(1 + what-if guesses the technique ladder tried, stopped at TRAP_CFG.ladderWorkCap): input of the trap grade', 'lTr'],
  trapPredicted: ['trap score before it is cut into a grade: ridge model over trapMax, trapTop3, altFrac, lTr on the 0-5 scale', 'trapPredicted'],
  'grade:trap': ['trap grade = the Play badge (trapPredicted cut at the fitted thresholds, then capped by board size)', 'trap grade (Play badge)'],
  ladHardest: ['hardest technique level the ladder grader needed (1 local, 2 chain, 3 territory, 4 probe1, 5 probe2, 6 search)', 'ladderHardest'],
  ladChain: ['ladder: passes at level 2 (chain rules)', ''], ladTerr: ['ladder: passes at level 3 (territory rule)', ''],
  ladProbe1: ['ladder: successful single what-if guesses (level 4)', ''], ladProbe2: ['ladder: successful nested what-if guesses (level 5)', ''],
  ladSearch: ['ladder: nodes of the plain-search fallback', ''], ladTrials: ['ladder: total number of what-if guesses tried', ''],
  wideFrac: ['fraction of the solution path\'s branch points where the solution takes the wider opening instead of the narrower one', 'ladderWideFrac'],
  'grade:ladder': ['technique-ladder grade 0-5 (size floor, nested-guess gate, wideFrac split)', 'grade: ladder'],
};
// Solver-derived metrics and grades are undefined (not "5") on a puzzle whose reference solve was capped.
export const needsSolver = k => GROUP[k] === 'legacy' || GROUP[k] === 'grade';

export const featuresOf = (r, cap = DEFAULT_EVAL_CAP) => {
  const p = parse(r.key), T = p.n * p.n, K = maxNumber(p),
  d = metricsFor(p, cap), sp = spatialMetrics(p),
  g = d.exceeded ? null : gradesFromMetrics({ ...d, n: p.n }, sp),
  tr = trapMetrics(p, OFFLINE_TRAP_CFG), L = ladder(p);
  const walls = p.walls.reduce((a, w) => a + (w & 1) + ((w >> 1) & 1), 0);
  let turns = 0; if (tr.ok) for (let i = 2; i < tr.path.length; i++) if (tr.path[i] - tr.path[i - 1] !== tr.path[i - 1] - tr.path[i - 2]) turns++;
  const wf = L.solved && L.path ? wideFrac(p, L.path).frac : 0, lg = ladderGrade(p, L).grade;
  return {
    n: p.n, K, 'walls/T': walls / T, 'K/T': K / T, segLen: (T - 1) / Math.max(1, K - 1), 'turns/T': turns / T,
    'decisionNodes/cell': d.decisionNodes / T, 'B/N': d.B / p.n, maxDecisionDepth: d.maxDecisionDepth, 'nodes/cell': d.nodes / T,
    crossPerSeg: sp.crossPerSeg, overlapPerSeg: sp.overlapPerSeg,
    'grade:decisionNodes': g ? g.grades.decisionNodes : 5, 'grade:B': g ? g.grades.B : 5, 'grade:cross': g ? g.grades.crossPerSeg : 5, 'grade:combined': g ? g.grades.combined : 5,
    trapMax: tr.trapMax, trapTop3: tr.trapTop3, trapDeep: tr.trapDeep, altFrac: tr.altFrac, 'alts/T': tr.alternatives / T, lTr: tr.lTr, trapPredicted: tr.predicted, 'grade:trap': tr.grade,
    ladHardest: L.hardest ?? 0, ladChain: L.passes?.[2] ?? 0, ladTerr: L.passes?.[3] ?? 0, ladProbe1: L.passes?.[4] ?? 0, ladProbe2: L.passes?.[5] ?? 0, ladSearch: L.search?.nodes ?? 0, ladTrials: L.probeTrials ?? 0, wideFrac: wf, 'grade:ladder': lg,
    _capped: d.exceeded ? 1 : 0, _ladBad: L.exceeded || L.contradiction ? 1 : 0, _ladSolved: L.solved && L.path ? 1 : 0,
  };
};
