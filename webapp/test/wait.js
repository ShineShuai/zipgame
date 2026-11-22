// Waiting in tests. A test waits for one of three things; each has its own helper, so that no
// test guesses a time for something that has a condition.
//   until(check, what)  something must happen: poll `check()` until it is true. The limit only
//                       matters when a test fails, so it is generous (a loaded CI runner is
//                       slow). `what` may be a function that tells the state when it gave up.
//   turn()              one turn of the event loop. What goes through microtasks only (the fake
//                       network of coop/fake-broker.js) is finished after it. Real crypto is
//                       not: it finishes on the thread pool, so wait for its result with until().
//   quiet(ms)           something must NOT happen. Nothing can be polled for that, so it is a
//                       real wait: on a slow machine it can only pass too early, it cannot fail.
//                       Put it after the last thing that must have happened, and prefer a later
//                       event that proves the earlier one is over.
export async function until(check, what = 'a condition', ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

export const turn = () => new Promise(resolve => setImmediate(resolve));

export const quiet = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
