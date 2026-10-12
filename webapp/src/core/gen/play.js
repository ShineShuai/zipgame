// The Play app's generator for a standard puzzle: the hardest puzzle this size can show, by the trap grade (core/trap.js, the badge).
// Until the grade matches the human ratings better, "hardest" is the one target worth aiming at (the ratings are most reliable at the
// ends of the scale), and the plain generator (gen/generate.js) never gets there: its puzzles score about 1.6 on the 0-5 scale at 7-9
// where the top grade begins at 3.1.
//
// generateTargeted() (gen/target.js) does the work: every try starts from the best of `pool` fresh unique puzzles by trap score
// (o.startPool) and climbs from it; the puzzle it keeps is wall-minimal already (every kept change is stripped of the walls it does
// not need), so nothing is minimized afterwards and generate()'s CANDIDATES list is not used. Counts only, no clock: the same
// (n, seed) gives the same puzzle on every device, as the daily seeds need.
//
// PLAY_TARGET: per size, how many start puzzles a try samples (pool), how many tries a run may make (retries), how deep a try may climb
// (effort, default 1: see proposalBudget in target.js) and the work budget of the technique ladder while searching (ladder, edge
// assignments; default the full 1e5). A smaller ladder budget makes every score of the search a lower bound, so a hit is real, and a hard
// puzzle costs the budget instead of a few hundred ms; at 8-10 a budget of 5000 cut the mean time by a third to a half and the slowest run
// by about half with every puzzle still reaching the top grade (2000 lost a hit, 1000 was slower); at 7 it lost hits (5 of 8), so 7 keeps
// the full budget. 11 and 12 climb shallowly (effort 0.25: a deep climb there took up to 78 s); building the start puzzles dominates there.
// Measured with tools/play-time.mjs (see tools/README.md); sizes without an entry use generate(): 16 (a start puzzle alone takes about a
// second there; not measured). Tune with `node tools/play-time.mjs`.
import { generate } from './generate.js';
import { generateTargeted, maxTargetGrade } from './target.js';

export const PLAY_TARGET = {
  5: { pool: 64, retries: 4 },
  6: { pool: 64, retries: 4 },
  7: { pool: 64, retries: 8 },
  8: { pool: 64, retries: 2, ladder: 5000 },
  9: { pool: 64, retries: 2, ladder: 5000 },
  10: { pool: 64, retries: 2, ladder: 5000 },
  11: { pool: 32, retries: 2, effort: 0.25 },
  12: { pool: 32, retries: 2, effort: 0.25 },
};

// Share of the progress bar the sampling of the first try's start puzzles takes (the climb gets the rest).
const POOL_SHARE = 0.3;

// generatePlayRun(n, seed, o) -> generator; returns the run's result: { puzzle, grade, pred, hit, target, tries, proposals, walls, K, fallback }.
// fallback = true: plain generate() made the puzzle (no entry for this size, or no start puzzle could be built); grade / pred / hit are then null.
// o.pool / o.retries / o.effort override the size's entry (tools/play-time.mjs); o.target = false forces generate().
// Events: { frac, walls, K } like generate()'s, with frac moving forward only.
export function* generatePlayRun(n, seed, o = {}) {
  const entry = o.target === false ? null : PLAY_TARGET[n];
  if (entry) {
    const run = generateTargeted(n, maxTargetGrade(n), seed, { startPool: o.pool ?? entry.pool, retries: o.retries ?? entry.retries, effort: o.effort ?? entry.effort, ladderWorkCap: o.ladder ?? entry.ladder, startRefine: o.startRefine, prefilter: o.prefilter, freedEdge: o.freedEdge });
    let frac = 0;
    for (let step = run.next(); ; step = run.next()) {
      if (step.done) {
        const r = step.value;
        if (!r.puzzle) break; // no start puzzle: generate() below
        yield { frac: 1, walls: r.walls, K: r.K };
        return { ...r, fallback: false };
      }
      const e = step.value;
      frac = Math.max(frac, e.phase === 'start' && e.pool != null ? POOL_SHARE * e.pool : POOL_SHARE + (1 - POOL_SHARE) * (e.frac || 0));
      yield { frac, walls: e.walls, K: e.K };
    }
  }
  const puzzle = yield* generate(n, seed);
  return { puzzle, grade: null, pred: null, hit: null, target: null, tries: 0, proposals: 0, walls: null, K: null, fallback: true };
}

// generatePlay(n, seed) -> generator that returns the puzzle (what the Play app plays).
export function* generatePlay(n, seed, o = {}) {
  return (yield* generatePlayRun(n, seed, o)).puzzle;
}
