// The themes suites of test/ (theme.js, themes.js, theme-calendar.js), registered here to run in a process of their own.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { themeTests } from '../theme.js';
import { themeSystemTests } from '../themes.js';
import { themeCalendarTests } from '../theme-calendar.js';

themeTests(t, ok, eq);
themeSystemTests(t, ok, eq, ta);
themeCalendarTests(t, ok, eq);

registerAsyncTests();
