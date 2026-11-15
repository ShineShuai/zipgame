// The exact suites of test/ (exact.js, exact-gen.js, play-exact.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { exactTests } from '../exact.js';
import { exactGenTests } from '../exact-gen.js';
import { playExactTests } from '../play-exact.js';

exactTests(t, ok, eq);
exactGenTests(t, ok, eq);
playExactTests(t, ok, eq);

registerAsyncTests();
