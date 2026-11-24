# Tests

Plain `node:test` files, one per family (`unit/`, `coop/`, `sync/`, `gotd-gen-cli.test.js`). Run one
with `node --test test/unit/wrap.test.js`, pick a test with `--test-name-pattern`.

| Command | What runs |
| --- | --- |
| `npm test` | the fast tier: what the pre-commit hook and the Node 20 job run |
| `npm run test:slow` | only the tests marked `SLOW` |
| `npm run test:all` | both tiers, in one go |
| `ZIGZAG_TEST_SHARD=1/2 npm run test:slow` | one half of the slow tier (CI runs the two halves side by side) |
| `npm run check` | every file parses, every import resolves, the width ratchet holds |

`harness.js` explains the tiers (`FAST`, `SLOW`, `sampled`). `budget.js` reports a fast test that
needs 0.5 s of CPU or 1.5 s of wall time: it belongs in the slow tier.

## What to test

A test exists to fail when the program is wrong, and only then. Cover the risk, not the lines:
coverage tells what is not tested, never what is tested well.

Write a test for

- a **rule or invariant** of the game (a puzzle has one solution, a grade is monotone, a merge is
  deterministic), preferably against an independent oracle (`oracle.js`: the slow, obvious version);
- a **bug that really happened**, named after the failure;
- a **contract between modules or devices** (the wire, the sync, the saved formats, the hooks a
  view gives its controller: `data-act`, `data-role`);
- a **golden output** whose change must be deliberate (`ALGO_VERSION`);
- a **requirement with a reason**, said in the message of the assertion (at least two STUN servers:
  one that is down must not break the calls).

Do not write a test for

- a constant, a count or a list that the code itself defines (`SOLID_KINDS` equals a literal),
- markup, class names or wording that is not a contract (a text that a translator may change),
- an expectation that is computed from the thing it tests (a registry compared with itself),
- what a cheaper test already catches: the same property at two levels, unless the higher one adds
  wiring that the lower one cannot see (a command line that runs the real tool, once).

**Before you delete or shrink a test, find the one fault that only it catches.** Break the code in
that way (a mutation: a throw that becomes a `TypeError`, a margin that is off, a sort that is
missing), run the tests that stay, and see one of them fail. If none does, the test was needed;
if one does, say which in the commit message. Restore the code byte for byte.

## How to write them

- **Waiting** (`wait.js`): `until(condition)` for what must happen, `turn()` for what only goes
  through microtasks (the fake network), `quiet(ms)` for what must not happen. Never guess a time
  for something that has a condition: on a loaded runner the guess is wrong.
- **Randomness**: seed it (`makeRng` from `src/core/rng.js`) and put the seed in the message. When
  the cases are few, try all of them (all orders of three devices are six).
- **Clocks**: inject them (`runJob(job, onEvent, clock)`). A real clock read in a callback is later
  than the one the code read, by a time that a busy machine changes.
- **Errors** (`errors.js`): `assert.throws(fn, REFUSED)`. The code refuses a bad input with a plain
  `Error`; a `TypeError` is a bug and must not pass for a refusal. Do not pin the wording.
- **Generators**: they are deterministic, so a puzzle that a test only reads is made once per file
  (copy it for the caller). A test of determinism makes it again on purpose.
- **Real work**: the slow tier. One real run of an end-to-end path (the `gotd-gen` fill) is shared
  by the tests that need its result; the others work on copies or on the frozen queue.
- **Global state**: restore what a test changes (`document`, `alert`, `console`), in `finally`.

## Speed

CI time is the time of the longest job. A job takes its setup (about 10 s) plus the CPU time of its
tests divided by the cores that run them (4), and never less than its longest file. So CPU time
matters, and so does the order: the longest files start first (`LONGEST_FIRST` in `run.mjs`; a stale
list costs only time). Each test file is a process of about 60 ms: do not split or merge files for
speed. On Node 22 CI every core runs a file (`ZIGZAG_TEST_CONCURRENCY`).

The jobs run side by side: the fast tier on Node 20 and on Node 22, the slow tier on Node 22 in two
halves (`ZIGZAG_TEST_SHARD`: the files, longest first, are dealt out in turn). A third half would
not help while one file (`trap-target`, 26 s) is longer than a third of the work.

Measure two trees **back to back**, alone, with the CPU time of the process and its children
(`bash`: `time node --test file`). Run-to-run noise is about 10%: a difference below that is
not a result, and neither is one run of CI (the same job took 1m01 and 1m47).
