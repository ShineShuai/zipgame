// All wrap-around (torus) tests in one place, so test/tests.js has a single line for them:
// wrapAllTests(t, ta, ok, eq) (ta = the async test registrar). Add the next wrap test module here.
import { wrapTests } from './wrap.js';
import { wrapGenTests } from './wrap-gen.js';
import { wrapPlayTests } from './play-wrap.js';

export function wrapAllTests(t, ta, ok, eq) {
  wrapTests(t, ok, eq);
  wrapGenTests(t, ok, eq);
  wrapPlayTests(t, ta, ok, eq);
}
