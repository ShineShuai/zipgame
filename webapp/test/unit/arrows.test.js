// The arrows suites of test/ (directed.js, arrows-gen.js, play-arrows.js, design-arrows.js, design-variants.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { directedTests } from '../directed.js';
import { arrowsGenTests } from '../arrows-gen.js';
import { playArrowsTests } from '../play-arrows.js';
import { designArrowsTests } from '../design-arrows.js';
import { designVariantsTests } from '../design-variants.js';

directedTests(t, ok, eq);
arrowsGenTests(t, ok, eq);
playArrowsTests(t, ok, eq);
designArrowsTests(t, ok, eq);
designVariantsTests(t, ta, ok, eq);

registerAsyncTests();
