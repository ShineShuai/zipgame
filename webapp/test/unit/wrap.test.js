// The wrap suites of test/ (wrap-all.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { wrapAllTests } from '../wrap-all.js';

wrapAllTests(t, ta, ok, eq);

registerAsyncTests();
