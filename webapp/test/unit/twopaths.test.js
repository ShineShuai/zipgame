// The twopaths suites of test/ (twopaths.js, twopaths-gen.js, play-twopaths.js, design-twopaths.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { twoPathsTests } from '../twopaths.js';
import { twoPathsGenTests } from '../twopaths-gen.js';
import { twoPathsPlayTests } from '../play-twopaths.js';
import { designTwoPathsTests } from '../design-twopaths.js';

twoPathsTests(t, ok, eq);
twoPathsGenTests(t, ok, eq);
twoPathsPlayTests(t, ok, eq);
designTwoPathsTests(t, ok, eq);

registerAsyncTests();
