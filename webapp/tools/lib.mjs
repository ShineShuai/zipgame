// Shared by parse-ratings.mjs / check-ratings.mjs / metrics-eval.mjs: one way to print ratings and duplicate groups.
import { asciiPuzzle, describeRating } from '../src/core/ratings-io.js';
import { TRAP_CFG } from '../src/core/trap.js';

// Node cap for the reference solve in OFFLINE tools, set with `--cap N`. The app's refNodeCap (flat 9000 up to n=12) is a latency budget:
// 15 of the 78 rated puzzles hit it, which turned their solver metrics into lower bounds and their legacy grades into 5. The rated
// puzzles need at most ~80k nodes, so the default leaves >10x headroom; a puzzle that still hits it is reported, never silently graded 5.
export const DEFAULT_EVAL_CAP = 1_000_000;
export function evalCap(args) {
  const i = args.indexOf('--cap');
  if (i < 0) return DEFAULT_EVAL_CAP;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v) || v <= 0) throw new Error('--cap needs a positive number of nodes, e.g. --cap 2000000');
  return v;
}

// Node budget for finding a solution path in OFFLINE tools (TRAP_CFG.pathCap = 2e6 is the app's latency budget). A rated 12x12 needs
// 2.7M nodes (~3 s); the cap only matters for a puzzle that has no path attached, and a unique puzzle always finishes.
export const OFFLINE_PATH_CAP = 5e7;
export const OFFLINE_TRAP_CFG = { ...TRAP_CFG, pathCap: OFFLINE_PATH_CAP };

export const labelText = r => r ? `${describeRating(r)}${r.unsure ? ', unsure' : ''} (human ${r.human})` : 'no rating';
export const sameLabel = (a, b) => a && b && Math.abs(a.human - b.human) < 1e-9 && (a.lo ?? a.human) === (b.lo ?? b.human) && (a.hi ?? a.human) === (b.hi ?? b.human);

// groups: arrays of members { where: "file puzzle #12 (line 410)", label?: {human, lo, hi, unsure}, key }.
// Prints each group with every member's location and rating, flags label conflicts, and (show = true) draws the puzzle once.
export function printDuplicateGroups(title, groups, { show = true, out = console.error } = {}) {
  if (!groups.length) return { conflicts: 0 };
  out(`\n${title} (${groups.length}):`);
  let conflicts = 0;
  groups.forEach((g, gi) => {
    const labels = g.filter(m => m.label), conflict = labels.some(m => !sameLabel(m.label, labels[0].label));
    if (conflict) conflicts++;
    out(`  ${gi + 1}. ${g.map(m => m.where).join('  =  ')}`);
    for (const m of g) out(`       ${m.where}: ${labelText(m.label)}`);
    out(conflict ? '       -> LABELS DIFFER: keep one rating (edit the comment in difficulty_rate.txt / the entry in ratings.json) or remove the extra puzzle'
      : g.some(m => m.label) ? '       -> same rating: the extra copy only double-counts this puzzle in every fit' : '');
    if (show) { try { out(asciiPuzzle(g[0].key).split('\n').map(l => '         ' + l).join('\n')); } catch { /* unparseable: nothing to draw */ } }
  });
  return { conflicts };
}
