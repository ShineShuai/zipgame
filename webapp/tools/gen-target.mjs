// Generate unique puzzles of a requested trap grade (the Play badge), as plain-text puzzle files.
// Thin CLI around generateTargeted() (src/core/gen/target.js): the same code the design app uses, so a refit of the
// grade (tools/fit-trap.mjs --write) needs no change here. No clock is involved: the same arguments give the same puzzle file on every machine.
//   node tools/gen-target.mjs --size 7 --grade 3 [--max-walls 10] [--max-checkpoints 8] [--retries 20] [--effort 1]
//                             [--seed 1] [--count 1] [--out DIR] [--no-minimize] [--allow-miss] [--json] [--time]
// --size N            grid size 5..16 (required)          --grade G   0..5 (required; clamped to what the size can show)
// --max-walls W       most walls the puzzle may have      --max-checkpoints K   most numbered cells it may have
// --retries R         tries per puzzle (a try = a fresh start puzzle + its hill-climb); without it: until the target grade is met
// --effort X          how deep one try may go, x the default number of changes (default 1)
// --seed S --count C  puzzle i uses seed S+i (default 1, 1)
// --out DIR           write DIR/zip-<n>x<n>-g<grade>-s<seed>.txt per puzzle, else print the puzzle to stdout
// --no-minimize       do not strip unneeded walls (see generateTargeted)
// --allow-miss        with --retries: also output the closest puzzle when the tries ran out (else exit 2, nothing written)
// --json              one JSON line per puzzle on stdout (puzzle text in "puzzle") instead of text; status lines go to stderr either way
// --time              add the search time to the puzzle's comments (off by default: it differs from run to run, the file would not)
// Exit codes: 0 all targets hit (or --allow-miss), 1 bad arguments, 2 a target was missed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateTargeted, maxTargetGrade } from '../src/core/gen/target.js';
import { runSync } from '../src/core/run.js';
import { serialize } from '../src/core/format.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = name => args.includes('--' + name);
const die = msg => { console.error('gen-target: ' + msg); process.exit(1); };

const n = +opt('size'), grade = +opt('grade'), seed0 = +opt('seed', 1), count = +opt('count', 1);
const maxWalls = opt('max-walls') === undefined ? undefined : +opt('max-walls');
const maxCheckpoints = opt('max-checkpoints') === undefined ? undefined : +opt('max-checkpoints');
const retries = opt('retries') === undefined ? Infinity : +opt('retries'), effort = +opt('effort', 1);
const outDir = opt('out'), minimize = !flag('no-minimize'), allowMiss = flag('allow-miss'), json = flag('json'), withTime = flag('time');
if (!Number.isInteger(n) || n < 5 || n > 16) die('--size needs an integer 5..16');
if (!Number.isInteger(grade) || grade < 0 || grade > 5) die('--grade needs an integer 0..5');
if (!Number.isInteger(seed0) || !Number.isInteger(count) || count < 1) die('--seed / --count need integers (count >= 1)');
if (maxWalls !== undefined && !(maxWalls >= 0)) die('--max-walls needs a number >= 0');
if (maxCheckpoints !== undefined && !(maxCheckpoints >= 2)) die('--max-checkpoints needs a number >= 2');
if (!(retries >= 1) || (retries !== Infinity && !Number.isInteger(retries))) die('--retries needs an integer >= 1');
if (!(effort > 0)) die('--effort needs a number > 0');

const top = maxTargetGrade(n);
if (grade > top) console.error(`gen-target: ${n}x${n} cannot show grade ${grade}; aiming at ${top}`);
if (outDir) mkdirSync(outDir, { recursive: true });

let missed = 0;
for (let i = 0; i < count; i++) {
  const seed = seed0 + i;
  const r = runSync(generateTargeted(n, grade, seed, { retries, effort, maxWalls, maxCheckpoints, minimize }));
  const ok = r.puzzle && r.hit;
  console.error(`seed ${seed}: ${r.puzzle ? `grade ${r.grade} (target ${r.target}), ${r.walls} walls, ${r.K} checkpoints` : 'no puzzle'}, ` +
    `${(r.elapsedMs / 1000).toFixed(1)} s, ${r.proposals} changes, ${r.tries} tries${ok ? '' : ' -> MISSED'}`);
  if (!ok) missed++;
  if (!r.puzzle || (!ok && !allowMiss)) continue;
  const text = serialize(r.puzzle, withTime ? { times: { generateMs: r.elapsedMs } } : {});
  if (outDir) writeFileSync(join(outDir, `zip-${n}x${n}-g${r.grade}-s${seed}.txt`), text + '\n');
  if (json) console.log(JSON.stringify({ seed, size: n, target: r.target, grade: r.grade, pred: r.pred, hit: r.hit, walls: r.walls, checkpoints: r.K, tries: r.tries, changes: r.proposals, ms: Math.round(r.elapsedMs), puzzle: text }));
  else if (!outDir) console.log(text + (count > 1 ? '\n' : ''));
}
process.exit(missed && !allowMiss ? 2 : 0);
