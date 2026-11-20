// The speed budget of the fast tier, for every test of a test file: the t / ta tests of harness.js and the tests of the files that
// call node:test themselves. test/run.mjs loads this file (node --import) and so does harness.js, so a file run by hand is measured too.
//   - A fast test that uses 0.5 s of CPU time, or 1.5 s of wall time (a test that waits for child processes uses little CPU of
//     its own), is reported: it belongs in the slow tier (t.slow, or the SLOW option of node:test).
//   - It fails at 1 s of CPU time or 3 s of wall time (ZIGZAG_FAST_BUDGET_MS sets the CPU limit), but not on CI: a shared runner is
//     slower than a laptop, which is no regression. There the report is all there is (run.mjs puts it in the job summary).
//   - Only the fast tier is checked: every test that runs in it is a fast test. In the other tiers the slow ones run too.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach } from 'node:test';

const WARN_CPU_MS = Number(process.env.ZIGZAG_BUDGET_WARN_MS || 500); // lower it to see the long tail: ZIGZAG_BUDGET_WARN_MS=200 npm test
const WARN_WALL_MS = 1500;
const FAIL_CPU_MS = Number(process.env.ZIGZAG_FAST_BUDGET_MS || 1000);
const FAIL_WALL_MS = 3000;
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

if ((process.env.ZIGZAG_TESTS || 'fast') === 'fast') {
  let cpuStart = 0;
  let wallStart = 0;
  beforeEach(() => {
    cpuStart = cpuMs();
    wallStart = performance.now();
  });
  afterEach(context => {
    const cpu = Math.round(cpuMs() - cpuStart);
    const wall = Math.round(performance.now() - wallStart);
    if (cpu < WARN_CPU_MS && wall < WARN_WALL_MS) {
      return;
    }
    const name = context?.name ?? '(a test)';
    const used = `${cpu} ms of CPU, ${wall} ms of wall time`;
    if (process.env.ZIGZAG_BUDGET_REPORT) {
      const file = path.relative(process.cwd(), process.argv[1] ?? '');
      fs.appendFileSync(
        process.env.ZIGZAG_BUDGET_REPORT,
        `${JSON.stringify({ file, name, cpu, wall })}\n`,
      );
    } else {
      console.warn(`warning: ${name}: used ${used}: mark it slow`);
    }
    if (!process.env.CI && (cpu >= FAIL_CPU_MS || wall >= FAIL_WALL_MS)) {
      throw new Error(
        `used ${used}: mark it slow; the budget of a fast test is ${FAIL_CPU_MS} ms of CPU time`,
      );
    }
  });
}
