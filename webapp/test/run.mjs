// Runs the unit tests of the app: every suite (a file of test/unit, test/coop, test/sync, and the
// gotd-gen command-line tests) at once, as separate processes in parallel (node --test), in one tier.
//   node test/run.mjs fast     npm test            what is not marked slow: the pre-commit hook, the Node 20 job
//   node test/run.mjs slow     npm run test:slow   only the tests marked slow (generators, golden puzzles, solver comparisons)
//   node test/run.mjs all      npm run test:all    both: the Node 22 job
// Name a group to run only that: unit, coop, sync, cli (the gotd-gen command line), e.g.
// `node test/run.mjs all coop` (npm run test:coop, test:sync, test:gotd do this). Any other
// argument goes to node --test, e.g. --test-name-pattern=wrap. See test/harness.js for the tiers.
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
const hasSlow = file => fs.readFileSync(`${root}${file}`, 'utf8').includes('SLOW');
// The groups of suites. Files of test/unit may hold either kind of test; the co-op and sync files
// are plain node:test files, and one without a SLOW test has nothing to run in the slow tier.
const groups = {
  unit: () => inDir('unit'),
  cli: () => ['test/gotd-gen-cli.test.js'],
  coop: () => inDir('coop'),
  sync: () => inDir('sync'),
};
const named = args.filter(arg => arg in groups);
const passed = args.filter(arg => !(arg in groups));
const suites = (named.length ? named : Object.keys(groups))
  .flatMap(name => groups[name]())
  .filter(file => tier !== 'slow' || !/^test\/(coop|sync)\//.test(file) || hasSlow(file));

// Every file loads test/budget.js, which reports the fast tests that use too much time into this file; it is shown at the end.
const reportFile = path.join(os.tmpdir(), `zigzag-budget-${process.pid}.jsonl`);
fs.rmSync(reportFile, { force: true });
const budget = pathToFileURL(`${root}test/budget.js`).href;
const result = spawnSync(process.execPath, ['--import', budget, '--test', ...passed, ...suites], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ZIGZAG_TESTS: tier, ZIGZAG_BUDGET_REPORT: reportFile },
});

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
