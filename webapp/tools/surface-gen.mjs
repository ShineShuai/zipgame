// Puzzles on a tetrahedron or cube board (src/core/surface/): generate them, or solve a file.
//   node tools/surface-gen.mjs tetra 4 [--seed 1] [--count 1] [--k 12] [--path] [--quiet]
//   node tools/surface-gen.mjs --solve FILE
// kind              tetra (n^2 triangles on each of 4 faces) or cube (n^2 squares on 6 faces)
// n                 cells along a side, 1..12 (the app plans tetra 3..5 and cube 3..4)
// --seed S --count C  puzzle i uses seed S+i (default 1, 1); same arguments, same puzzles
// --k K             how many numbers (default: about 20% of a tetra's cells, 15% of a cube's)
// --path            also print the solution as a `path` line
// --quiet           only the summary line of each puzzle, no puzzle text
// --solve FILE      count the solutions of a puzzle file (at most 2), print the first one
// The summary line (stderr) is: kind n cells K walls nodes ms; nodes is the cost of proving the
// puzzle unique, the difficulty measure. Exit codes: 0 done, 1 bad arguments or an invalid puzzle.
import { readFileSync } from 'node:fs';
import { generateSurface, defaultK } from '../src/core/surface/gen.js';
import { surfaceTopology } from '../src/core/surface/topology.js';
import { serializeSurface, parseSurface } from '../src/core/surface/puzzle.js';
import { solveSurface } from '../src/core/surface/solve.js';

const args = process.argv.slice(2);
const has = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = message => {
  console.error(message);
  process.exit(1);
};

if (has('solve')) {
  const text = readFileSync(value('solve'), 'utf8');
  let p;
  try {
    p = parseSurface(text);
  } catch (error) {
    fail(`${value('solve')}: ${error.message}`);
  }
  const t0 = Date.now();
  const result = solveSurface(p, { limit: 2 });
  const ms = Date.now() - t0;
  console.error(`solutions ${result.count} (at most 2 counted), nodes ${result.nodes}, ${ms} ms`);
  if (result.path) {
    console.log(`path ${result.path.join(' ')}`);
  }
  process.exit(0);
}

const WITH_VALUE = ['seed', 'count', 'k', 'solve'];
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) {
    positional.push(args[i]);
  } else if (WITH_VALUE.includes(args[i].slice(2))) {
    i++;
  }
}
const [kind, size] = positional;
const n = Number(size);
if (!kind || !Number.isInteger(n)) {
  fail('usage: node tools/surface-gen.mjs <tetra|cube> <n> [--seed S] [--count C] [--k K] ' +
    '[--path] [--quiet]');
}
let cells;
try {
  cells = surfaceTopology(kind, n).T;
} catch (error) {
  fail(error.message);
}
const seed = Number(value('seed', 1));
const count = Number(value('count', 1));
const K = has('k') ? Number(value('k')) : defaultK(kind, n);
for (let i = 0; i < count; i++) {
  const t0 = Date.now();
  const made = generateSurface(kind, n, seed + i, { K });
  const ms = Date.now() - t0;
  if (!has('quiet')) {
    console.log(`# ${kind} ${n} seed ${seed + i}`);
    console.log(serializeSurface(made.puzzle, { path: has('path') ? made.path : undefined }));
  }
  const line = `${kind} ${n} cells ${cells} K ${made.K} walls ${made.walls} nodes ${made.nodes}`;
  console.error(`${line} ${ms} ms`);
}
