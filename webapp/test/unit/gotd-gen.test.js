// The gotd-gen suites of test/ (gotd-gen.js, gotd-verdict.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { gotdGenTests } from '../gotd-gen.js';
import { gotdVerdictTests } from '../gotd-verdict.js';

gotdGenTests(t, ok, eq);
gotdVerdictTests(t, ok, eq, ta);

registerAsyncTests();
