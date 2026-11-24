// Runs the unit tests of the app: every suite (a file of test/unit, test/coop, test/sync, and the
// gotd-gen command-line tests) at once, as separate processes in parallel (node --test), in one tier.
//   node test/run.mjs fast     npm test            what is not marked slow: the pre-commit hook, the Node 20 job
//   node test/run.mjs slow     npm run test:slow   only the tests marked slow (generators, golden puzzles, solver comparisons)
//   node test/run.mjs all      npm run test:all    both: the Node 22 job
// Name a group to run only that: unit, coop, sync, cli (the gotd-gen command line), e.g.
// `node test/run.mjs all coop` (npm run test:coop, test:sync, test:gotd do this). Any other
// argument goes to node --test, e.g. --test-name-pattern=wrap. See test/harness.js for the tiers.
// The longest files start first, and on Node 22 CI every core runs a file (see below).
// The research tools (npm run test:tools), the themes and the server code have their own scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [tier = 'fast', ...args] = process.argv.slice(2);
if (!['fast', 'slow', 'all'].includes(tier)) {
  console.error(`usage: node test/run.mjs fast|slow|all [node --test arguments]`);
  process.exit(2);
}

const inDir = dir =>
  fs
    .readdirSync(`${root}test/${dir}`)
    .filter(file => file.endsWith('.test.js'))
    .sort()
    .map(file => `test/${dir}/${file}`);
const text = file => fs.readFileSync(`${root}${file}`, 'utf8');
const hasSlow = file => text(file).includes('SLOW');
// A file marks its slow tests SLOW (and, in a file with both kinds, its fast tests FAST); one
// without SLOW has nothing to run in the slow tier.
// The groups of suites.
const groups = {
  unit: () => inDir('unit'),
  cli: () => ['test/gotd-gen-cli.test.js'],
  coop: () => inDir('coop'),
  sync: () => inDir('sync'),
};
const named = args.filter(arg => arg in groups);
const passed = args.filter(arg => !(arg in groups));
const listed = (named.length ? named : Object.keys(groups))
  .flatMap(name => groups[name]())
  .filter(file => tier !== 'slow' || hasSlow(file));

// The longest files start first. A run is over when its last file is, and a long file that starts
// late ends it: the gotd-gen command line (then 64 s of CPU alone) started at second 66 of 130.
// Alone, tier all, in seconds of CPU: 32, 31, 21, 20, 19, 15, 12, 11 (every file together: 247).
// With this list the run is within 1 s of the best possible order. A stale list only costs time,
// but a name that is not a file is an error, so a renamed file is noticed.
const LONGEST_FIRST = [
  'test/unit/trap-target.test.js',
  'test/gotd-gen-cli.test.js',
  'test/unit/pentagon.test.js',
  'test/unit/gotd-gen.test.js',
  'test/unit/fixtures.test.js',
  'test/unit/cutout.test.js',
  'test/unit/solver.test.js',
  'test/unit/generation.test.js',
];
for (const file of LONGEST_FIRST) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`test/run.mjs: LONGEST_FIRST names ${file}, which is not a file`);
    process.exit(1);
  }
}
const rank = file => {
  const i = LONGEST_FIRST.indexOf(file);
  return i < 0 ? LONGEST_FIRST.length : i;
};
listed.sort((a, b) => rank(a) - rank(b)); // stable: the others keep their order

// One part of the run, for CI jobs side by side: ZIGZAG_TEST_SHARD=2/3. The files are dealt out in
// the order above, longest first, so that every part gets about the same share of the long ones.
const shard = process.env.ZIGZAG_TEST_SHARD || '1/1';
const [part, parts] = shard.split('/').map(Number);
if (!(Number.isInteger(part) && Number.isInteger(parts) && part >= 1 && part <= parts)) {
  console.error(`test/run.mjs: ZIGZAG_TEST_SHARD is "${shard}", not i/n with 1 <= i <= n`);
  process.exit(1);
}
const suites = listed.filter((_, index) => index % parts === part - 1);

// On CI the machine is ours alone, so every core runs a file; node --test leaves one idle by
// default (a quarter of a 4-core runner). A laptop keeps the default, and so does Node 20, where
// the flag is newer. ZIGZAG_TEST_CONCURRENCY=n sets the number of files at a time, 0 the default.
const wanted = Number(
  process.env.ZIGZAG_TEST_CONCURRENCY ?? (process.env.CI ? os.availableParallelism() : 0),
);
const onNode22 = Number(process.versions.node.split('.')[0]) >= 22;
const concurrency = wanted > 0 && onNode22 ? [`--test-concurrency=${wanted}`] : [];
const partOf = parts > 1 ? `, part ${part} of ${parts}` : '';
console.log(
  `test/run.mjs: tier ${tier}${partOf}, ${suites.length} files, ` +
    `${concurrency.length ? wanted : 'the default number of'} at a time`,
);

// Every file loads test/budget.js, which reports the fast tests that use too much time into this file; it is shown at the end.
const reportFile = path.join(os.tmpdir(), `zigzag-budget-${process.pid}.jsonl`);
fs.rmSync(reportFile, { force: true });
const budget = pathToFileURL(`${root}test/budget.js`).href;
const result = spawnSync(
  process.execPath,
  ['--import', budget, '--test', ...concurrency, ...passed, ...suites],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ZIGZAG_TESTS: tier, ZIGZAG_BUDGET_REPORT: reportFile },
  },
);

const over = fs.existsSync(reportFile)
  ? fs
      .readFileSync(reportFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .sort((a, b) => b.cpu - a.cpu)
  : [];
fs.rmSync(reportFile, { force: true });
if (over.length) {
  const lines = over.map(
    ({ file, name, cpu, wall }) => `${file}: ${name} (${cpu} ms of CPU, ${wall} ms of wall time)`,
  );
  console.log(
    `\nFast tests over the budget, mark them slow:\n${lines.map(line => `  ${line}`).join('\n')}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Fast tests over the budget (mark them slow)\n\n${lines.map(line => `- ${line}`).join('\n')}\n`,
    );
  }
}
process.exit(result.status ?? 1);
