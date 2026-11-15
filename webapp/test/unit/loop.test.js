// The loop suites of test/ (loop-open.js, loop.js, loop-gen.js, play-loop.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { loopOpenTests } from '../loop-open.js';
import { loopTests } from '../loop.js';
import { loopGenTests } from '../loop-gen.js';
import { loopPlayTests } from '../play-loop.js';

loopOpenTests(t, ok, eq);
loopTests(t, ok, eq);
loopGenTests(t, ok, eq);
loopPlayTests(t, ta, ok, eq);

registerAsyncTests();
