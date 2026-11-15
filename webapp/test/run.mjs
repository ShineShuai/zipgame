// Runs the unit tests of the app: every suite at once, as separate processes in parallel (node --test), in one tier.
//   node test/run.mjs fast     npm test            what is not marked slow: the pre-commit hook, the Node 20 job
//   node test/run.mjs slow     npm run test:slow   only the tests marked slow (generators, golden puzzles, solver comparisons)
//   node test/run.mjs all      npm run test:all    both: the Node 22 job
// More arguments go to node --test, e.g. --test-name-pattern=wrap. See test/harness.js for the tiers.
// The research tools (npm run test:tools), the themes and the server code have their own scripts.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [tier = 'fast', ...args] = process.argv.slice(2);
if (!['fast', 'slow', 'all'].includes(tier)) {
  console.error(`usage: node test/run.mjs fast|slow|all [node --test arguments]`);
  process.exit(2);
}

const inDir = dir => fs.readdirSync(`${root}test/${dir}`).filter(file => file.endsWith('.test.js')).sort().map(file => `test/${dir}/${file}`);
// The co-op and sync suites have no slow tests.
const suites = ['test/tests.js', 'test/gotd-gen-cli.test.js', ...(tier === 'slow' ? [] : [...inDir('coop'), ...inDir('sync')])];

const result = spawnSync(process.execPath, ['--test', ...args, ...suites], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ZIGZAG_TESTS: tier },
});
process.exit(result.status ?? 1);
