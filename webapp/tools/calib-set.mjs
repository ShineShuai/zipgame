// Build the calibration set: puzzles of every Play badge (trap grade) at the sizes people play, to
// serve to testers (see src/features/calib.js) so that the badges 3-5 get enough solves.
//   node tools/calib-set.mjs --out DIR [options]        (--help explains every option)
// --plan N:K,...   per size N: K puzzles for each badge 0..maxTargetGrade(N)  (default 9:20,7:8)
// --exclude DIR    *.txt puzzles that must not be repeated (e.g. demo/GameOfDay); repeatable
// --cache DIR      generated puzzles are kept here (zip-<n>x<n>-g<grade>-s<seed>.txt), so an
//                  interrupted run resumes (default: <tmp>/calib-pool)
// Writes DIR/cal-<n>-<NNN>.txt (plain-text puzzle format), DIR/index.json (what the app reads:
// the file names per size in play order, and the block length per size) and DIR/manifest.json
// (file, n, grade, seed: for you).
// The play order is block-randomised: every block of (maxGrade + 1) consecutive puzzles holds one
// puzzle per badge in random order, so any prefix a tester plays is balanced. File names carry no
// grade: the app hides the badge in a calibration game, and a name must not give it away.
// Deterministic: the same arguments (and cache contents) give the same files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateTargeted, maxTargetGrade } from '../src/core/gen/target.js';
import { runSync } from '../src/core/run.js';
import { serialize, parse } from '../src/core/format.js';
import { packPuzzle, toB64u } from '../src/core/behaviour.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { cli } from './args-lib.mjs';

const { values: o } = cli({
  usage: 'node tools/calib-set.mjs --out DIR [options]',
  summary: 'Build the calibration set: targeted puzzles of every Play badge, in a ' +
    'block-balanced play order, for the testers\' ?calib games (src/features/calib.js).',
  options: {
    out: { type: 'string', arg: 'DIR', required: true,
      help: 'where to write cal-<n>-<NNN>.txt, index.json (read by the app) and manifest.json ' +
        '(badge per file, for you)' },
    plan: { type: 'string', arg: 'N:K,...', default: '9:20,7:8',
      help: 'per board size N, K puzzles for each Play badge 0..max (a 5x5 shows badges 0-2, a ' +
        '6x6 0-3, larger 0-5); the play order is blocks of one puzzle per badge' },
    seed: { type: 'int', arg: 'N', default: 1,
      help: 'base seed of the puzzle generation and of the play-order shuffle: the same seed ' +
        '(and cache) gives the same files' },
    exclude: { type: 'list', arg: 'DIR',
      help: 'folder of *.txt puzzles that must not be repeated, e.g. demo/GameOfDay' },
    cache: { type: 'string', arg: 'DIR', defaultText: '<tmp>/calib-pool',
      help: 'generated puzzles are kept here, so an interrupted run resumes where it stopped' },
  },
});
const out = o.out, seed0 = o.seed, cache = o.cache ?? path.join(os.tmpdir(), 'calib-pool');
const die = msg => { console.error('calib-set: ' + msg); process.exit(1); };
const plan = o.plan.split(',').map(x => x.split(':').map(Number));
const validPair = ([n, k]) =>
  Number.isInteger(n) && n >= 5 && n <= 16 && Number.isInteger(k) && k >= 1;
if (!plan.every(validPair)) {
  die('--plan needs N:K pairs, N = 5..16, K >= 1 (e.g. 9:20,7:8)');
}
const MAX_MISSES = 50; // seeds tried per puzzle before giving up on it

const idOf = text => {
  const bytes = packPuzzle(parse(text));
  return bytes ? toB64u(bytes) : null;
};
const seen = new Set();
for (const dir of o.exclude || []) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.txt'))) {
    const id = idOf(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (id) seen.add(id);
  }
}
fs.mkdirSync(cache, { recursive: true });

// one puzzle of badge g at size n: the cached file of seed s, else generated (and cached)
function puzzleFor(n, g, base) {
  for (let miss = 0; miss < MAX_MISSES; miss++) {
    const seed = base + 1000 * miss, file = path.join(cache, `zip-${n}x${n}-g${g}-s${seed}.txt`);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (!text) {
      const r = runSync(generateTargeted(n, g, seed, { retries: 30 }));
      if (!r.puzzle || !r.hit) continue;
      text = serialize(r.puzzle) + '\n';
      fs.writeFileSync(file, text);
    }
    const id = idOf(text);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    return { text, seed, n, grade: g };
  }
  return null;
}

fs.mkdirSync(out, { recursive: true });
const index = { v: 1, sizes: {}, block: {} }, manifest = [];
for (const [n, per] of plan) {
  const top = maxTargetGrade(n), rnd = makeRng(seed0 * 1000 + n), byGrade = [];
  for (let g = 0; g <= top; g++) {
    byGrade.push(Array.from({ length: per }, (_, i) => {
      const p = puzzleFor(n, g, seed0 + 10 * i + 100000 * (n * 10 + g));
      if (!p) die(`no puzzle for ${n}x${n} badge ${g} (try another --seed)`);
      return p;
    }));
    console.error(`${n}x${n} badge ${g}: ${per} puzzles`);
  }
  index.block[n] = top + 1;
  const ordered = [];
  for (let b = 0; b < per; b++) ordered.push(...shuffle(byGrade.map(list => list[b]), rnd));
  index.sizes[n] = ordered.map((p, i) => {
    const file = `cal-${n}-${String(i).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(out, file), p.text);
    manifest.push({ file, n, grade: p.grade, seed: p.seed });
    return file;
  });
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index) + '\n');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.error(`wrote ${manifest.length} puzzles to ${out}`);
