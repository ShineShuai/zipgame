// The surface suites of test/ (surface.js, ball.js, ball-view.js, solid.js, surface-fast.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { surfaceTests } from '../surface.js';
import { ballTests } from '../ball.js';
import { ballViewTests } from '../ball-view.js';
import { solidTests } from '../solid.js';
import { surfaceFastTests } from '../surface-fast.js';

surfaceTests(t, ok, eq);
ballTests(t, ok, eq);
ballViewTests(t, ok, eq);
solidTests(t, ok, eq, ta);
surfaceFastTests(t, ok, eq);

registerAsyncTests();
