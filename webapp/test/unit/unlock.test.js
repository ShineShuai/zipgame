// The unlock suites of test/ (unlock.js, gift.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { unlockTests } from '../unlock.js';
import { giftTests } from '../gift.js';

unlockTests(t, ta, ok, eq);
giftTests(t, ta, ok, eq);

registerAsyncTests();
