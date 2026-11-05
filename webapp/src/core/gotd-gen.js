// One automatic Game-of-Day candidate: generation (core/gen/target.js) and the gates it must pass before a human sees it.
// Pure of files and clocks (tools/gotd-gen.mjs does the files): the same arguments give the same candidate on the same code.
//
// Gates, in this order (vetCandidate):
//   1. the puzzle is valid, has the slot's size, and survives a round trip through its plain-text file;
//   2. it is not a puzzle we already have, up to rotation, reflection and reversed numbering (symmetryKey of ratings-io.js);
//   3. grade: Hard or harder under the CURRENT trap model (the Play badge), and the score clears the grade-3 cut by GOTD_CFG.margin;
//   4. it has exactly one solution (a re-check with the reference solver, not the generator's own verdict);
//   5. its solution path is not the path of a puzzle we already have (same path = the same solution with other clues);
//   6. the numbers a human reviewer and a later calibration need are recorded (`corr`: metrics the generator never climbs).
// Gate 6 records and never rejects: those metrics are weak on their own (rho 0.3-0.4 against the hand ratings), a threshold would
// be a guess until reviewed candidates give labels to set it from.
import { ALGO_VERSION, validate, makePuzzle } from './model.js';
import { hashStr } from './rng.js';
import { runSync } from './run.js';
import { solve } from './solver/solve.js';
import { isSolved } from './rules.js';
import { REF_FLAGS } from './difficulty.js';
import { TRAP_CFG, TRAP_MODEL, SIZE_GRADE_CAP, trapMetrics, modelFor } from './trap.js';
import { generateTargeted, targetBand, TARGET_CFG } from './gen/target.js';
import { ladder, wideFrac, grade as ladderGrade } from './ladder.js';
import { symmetryKey } from './ratings-io.js';
import { parse, serialize } from './format.js';
import { slotSeed } from './gotd-schedule.js';

export const GOTD_CFG = {
  grade: 3,       // Hard or harder: the trap grade (Play badge) 3 and above
  margin: 0.5,    // the score must clear the grade-3 cut by this share of a cut spacing (TARGET_CFG.margin is 0.15), so a small refit keeps it Hard
  retries: 12,    // tries (fresh start + hill-climb) of one generator run; 6x6 needs about two runs per accepted candidate, the larger sizes one
  perSlot: 3,     // candidates the queue keeps for every open day
  horizon: 21,    // days ahead (counted from today) that get candidates
  maxAttemptsPerSlot: 40, // generator runs one slot may use in all before it is reported as starved
  bufferDays: 10, // published days ahead below which status warns: the same default as MIN_PUZZLE_DAYS of the prod deploy (which fails a strict deploy below it)
};

// Everything that changes what a seed produces or what grade means. A candidate carries the stamp it was made and graded under.
export const stampParts = () => ({
  algo: ALGO_VERSION, model: TRAP_MODEL, cfg: TRAP_CFG, target: TARGET_CFG, caps: SIZE_GRADE_CAP,
  gotd: { grade: GOTD_CFG.grade, margin: GOTD_CFG.margin, retries: GOTD_CFG.retries },
});
export const genStamp = (parts = stampParts()) => `a${parts.algo}-${hashStr(JSON.stringify(parts))}`;

// 16 hex digits from two FNV runs; ids and keys are compared as text, so a collision among a few thousand puzzles is out of reach.
export const hash64 = s => hashStr(s) + hashStr('~' + s);
export const puzzleId = symKey => hash64(symKey).slice(0, 12);
// The solution path as a puzzle that numbers every cell by its step: its symmetryKey is the same for a rotated, mirrored or reversed path.
export function pathKey(n, path) {
  const q = makePuzzle(n);
  path.forEach((cell, i) => { q.cp[cell] = i + 1; });
  return hash64(symmetryKey(q));
}

// What the new candidate must differ from. entry = { symKey, pathKey?, where }; `where` names the puzzle in a message.
export function createDistinct() {
  const bySym = new Map(), byPath = new Map();
  return {
    add({ symKey, pathKey: pk, where }) {
      if (symKey && !bySym.has(symKey)) bySym.set(symKey, where);
      if (pk && !byPath.has(pk)) byPath.set(pk, where);
    },
    // null, or { kind: 'puzzle' | 'path', where }
    conflict(symKey, pk) {
      if (bySym.has(symKey)) return { kind: 'puzzle', where: bySym.get(symKey) };
      if (pk && byPath.has(pk)) return { kind: 'path', where: byPath.get(pk) };
      return null;
    },
    get size() { return bySym.size; },
  };
}

const r3 = x => Math.round(x * 1000) / 1000;
const uniqueCap = n => Math.max(TARGET_CFG.uniqueCapFloor, TARGET_CFG.uniqueCapPerCell * n * n);

// -> { ok: true, entry, symKey, path } or { ok: false, reason, detail }. `entry` = what the queue index records about the puzzle.
// holdGrade: gate 3 does not reject (a human already judged the puzzle; the model may have been refitted since): a grade or margin miss comes back as `drift` on an ok answer.
export function vetCandidate(puzzle, size, distinct, { holdGrade = false } = {}) {
  const fail = (reason, detail = '') => ({ ok: false, reason, detail });
  const v = validate(puzzle);
  if (!v.ok) return fail('invalid', v.msg);
  if (puzzle.n !== size) return fail('size', `${puzzle.n}x${puzzle.n}, slot wants ${size}x${size}`);
  // The player gets the text of the file, so everything below judges the puzzle as parsed from it, without the generator's path.
  let q;
  try { q = parse(serialize(puzzle)); } catch (e) { return fail('roundtrip', e.message); }
  const symKey = symmetryKey(q), id = puzzleId(symKey);
  let dup = distinct.conflict(symKey);
  if (dup) return fail('duplicate', dup.where);
  const m = trapMetrics(q, TRAP_CFG, null, modelFor(q));
  if (!m.ok) return fail('unsolved', m.reason);
  const band = targetBand(GOTD_CFG.grade, size, TRAP_MODEL, GOTD_CFG.margin, true);
  let drift = '';
  if (m.grade < band.grade) drift = `grade ${m.grade}, wanted ${band.grade}+`;
  else if (m.predicted < band.a) drift = `score ${r3(m.predicted)} < ${r3(band.a)}`;
  if (drift && !holdGrade) return fail(m.grade < band.grade ? 'grade' : 'margin', drift);
  const s = solve(q, { limit: 2, nodeCap: uniqueCap(size), ...REF_FLAGS });
  if (s.count !== 1 || s.exceeded) return fail('not-unique', s.exceeded ? 'node cap reached' : `${s.count} solutions`);
  if (!isSolved(q, m.path)) return fail('path', 'the solution path does not solve the puzzle');
  const pk = pathKey(size, m.path);
  dup = distinct.conflict(symKey, pk);
  if (dup) return fail('duplicate-path', dup.where);
  const L = ladder(q), wf = L.solved && L.path ? wideFrac(q, L.path).frac : 0;
  const K = Math.max(...q.cp), walls = q.walls.reduce((a, w) => a + (w & 1) + ((w >> 1) & 1), 0);
  return {
    ok: true, symKey, path: m.path, ...(drift ? { drift } : {}),
    entry: {
      id, size, K, walls, pathKey: pk,
      trap: { pred: r3(m.predicted), grade: m.grade, max: r3(m.trapMax), top3: r3(m.trapTop3), deep: m.trapDeep, altFrac: r3(m.altFrac), lTr: r3(m.lTr) },
      corr: { wideFrac: r3(wf), ladderGrade: ladderGrade(q, L).grade },
    },
  };
}

// One generator run for the slot and the gates on its result -> vetCandidate's answer plus { seed, puzzle } and, when accepted, the whole queue entry.
export function makeCandidate({ stamp, day, date, size, attempt, distinct }) {
  const seed = slotSeed(stamp, day, size, attempt);
  const r = runSync(generateTargeted(size, GOTD_CFG.grade, seed, { atLeast: true, margin: GOTD_CFG.margin, retries: GOTD_CFG.retries }));
  if (!r.puzzle) return { ok: false, reason: 'no-puzzle', detail: 'no start puzzle', seed };
  const v = vetCandidate(r.puzzle, size, distinct);
  if (!v.ok) return { ...v, seed, puzzle: r.puzzle };
  const entry = { id: v.entry.id, file: candidateFile(v.entry), size, slot: date, attempt, seed, stamp, status: 'pending', ...v.entry };
  return { ...v, entry, seed, puzzle: r.puzzle };
}

export const candidateFile = e => `c-${e.size}-${e.id}.txt`;
// The candidate's file: the puzzle (no solution path, so a reviewer plays it blind) and two comment lines that name its origin.
export const candidateText = (puzzle, e) => serialize(puzzle, { comments: [`gotd candidate ${e.id}`, `gen ${e.stamp} slot ${e.slot} seed ${e.seed} attempt ${e.attempt}`] }) + '\n';

// The published day's file: the puzzle, a comment on where it came from, and the reviewer's rating and solve time when there is a verdict.
// `# play_time_s` is the line the Game-of-Day files of the author already carry (commentTimes() reads it back), written only for a solved blind play.
export function publishedText(puzzle, entry, verdict = null) {
  const comments = [`gotd ${entry.id} gen ${entry.stamp} made-for ${entry.slot} model-grade ${entry.trap.grade} score ${entry.trap.pred}`];
  if (verdict) comments.push(`review human ${verdict.human}${verdict.unsure ? ' unsure' : ''} solved ${verdict.solved ? 'yes' : 'no'} takebacks ${verdict.takebacks}`);
  const times = verdict && verdict.solved && verdict.playS != null ? { playS: verdict.playS } : undefined;
  return serialize(puzzle, { comments, times }) + '\n';
}
