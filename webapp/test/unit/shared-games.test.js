// The shared-games suites of test/ (shared-games.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { sharedGamesTests } from '../shared-games.js';

sharedGamesTests(t, ta, ok, eq);

registerAsyncTests();
