// Shared by parse-ratings.mjs / check-ratings.mjs / metrics-eval.mjs: one way to print ratings and duplicate groups.
import { asciiPuzzle, describeRating } from '../src/core/ratings-io.js';

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
