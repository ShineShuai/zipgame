// Quality / time of the "One way arrows" generator per grid size (gen/arrows.js).
//   node tools/bench-arrows.mjs [sizes=5,6,7,8,9] [seeds=6] [key=value ...]
// key=value: candidates=N, K=N, minArrows=N, capX=F, checkCapX=F, refineNodes=N, pathArrows=0|1,
// freedEdge=0|1 (generateArrows options).
import { generateArrows } from '../src/core/gen/arrows.js';
import { runSync } from '../src/core/run.js';
import { arrowCount } from '../src/core/edges.js';

const args = process.argv.slice(2);
const sizes = (args[0] || '5,6,7,8,9').split(',').map(Number);
const seeds = +args[1] || 6;
const opts = {};
for (const kv of args.slice(2)) {
  const [k, v] = kv.split('=');
  opts[k] = k === 'pathArrows' || k === 'freedEdge' ? v !== '0' : +v;
}
console.log(`options ${JSON.stringify(opts)}, ${seeds} seeds per size`);
console.log('  n   ms/puzzle  max ms   arrows(mean)  arrows(min..max)  K(mean)');
for (const n of sizes) {
  const ms = [];
  const arrows = [];
  const ks = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = Date.now();
    const p = runSync(generateArrows(n, seed, opts));
    ms.push(Date.now() - t0);
    arrows.push(arrowCount(p));
    ks.push(Math.max(...p.cp));
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const range = `${Math.min(...arrows)}..${Math.max(...arrows)}`;
  const cols = [
    String(n).padStart(3),
    mean(ms).toFixed(0).padStart(11),
    String(Math.max(...ms)).padStart(8),
    mean(arrows).toFixed(2).padStart(14),
    range.padStart(18),
    mean(ks).toFixed(1).padStart(10),
  ];
  console.log(cols.join(' '));
}
