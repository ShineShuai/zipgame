// The zoom suites of test/ (zoom.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { zoomTests } from '../zoom.js';

zoomTests(t, ok, eq);

registerAsyncTests();
