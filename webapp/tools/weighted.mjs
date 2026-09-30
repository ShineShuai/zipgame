// Exploratory composites of ladder() outputs vs hand ratings. Usage: node tools/weighted.mjs [tools/ratings.json]
import { loadLabeled, spearman, features } from './ladder-eval.mjs';
import { ladder } from '../src/core/ladder.js';
const rows = loadLabeled(process.argv[2] || new URL('./ratings.json', import.meta.url).pathname).map(x => ({ ...x, r: ladder(x.puzzle) }));
const H = rows.map(x => x.human);
// candidate composite signals, all cheap derivatives of what ladder() already returns
const cands = {
  trials: x => x.r.probeTrials,
  trialsPerT: x => x.r.probeTrials / (x.puzzle.n ** 2),
  edges4: x => x.r.edges[4],            // forced-edge yield at probe1 level
  edges4PerT: x => x.r.edges[4] / (x.puzzle.n ** 2),
  passes4: x => x.r.passes[4],
  trialsLog: x => Math.log2(1 + x.r.probeTrials),
  probeDepthWeighted: x => x.r.hardest + (x.r.hardest === 4 ? Math.log2(1 + x.r.probeTrials) / 10 : 0),
  msLog: x => Math.log2(1 + x.r.ms),
  hardestPlusTrials: x => x.r.hardest * 1000 + x.r.probeTrials, // lexicographic: level first, trials as tiebreak
  KoverT: x => -x.k, // placeholder unused
};
for (const [name, f] of Object.entries(cands)) {
  if (name === 'KoverT') continue;
  console.log(name.padEnd(20), spearman(rows.map(f), H).toFixed(3));
}
// also: does trials correlate WITHIN hardest===4 subset (i.e. is it a good tiebreaker where it matters)?
const p1 = rows.filter(x => x.r.hardest === 4);
console.log('\nwithin probe1-only subset (n=' + p1.length + '):');
console.log('trials vs human', spearman(p1.map(x => x.r.probeTrials), p1.map(x => x.human)).toFixed(3));
console.log('edges[4] vs human', spearman(p1.map(x => x.r.edges[4]), p1.map(x => x.human)).toFixed(3));
