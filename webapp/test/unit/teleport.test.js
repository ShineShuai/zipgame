// The teleport suites of test/ (teleport.js, teleport-gen.js, play-teleport.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { teleportTests } from '../teleport.js';
import { teleportGenTests } from '../teleport-gen.js';
import { teleportPlayTests } from '../play-teleport.js';

teleportTests(t, ok, eq);
teleportGenTests(t, ok, eq);
teleportPlayTests(t, ta, ok, eq);

registerAsyncTests();
