// The pentagon suites of test/ (pentagon.js, play-pentagon.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { pentagonTests } from '../pentagon.js';
import { playPentagonTests } from '../play-pentagon.js';

pentagonTests(t, ok, eq);
playPentagonTests(t, ok, eq);

registerAsyncTests();
