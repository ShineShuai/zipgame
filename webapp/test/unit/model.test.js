// Unit tests of the model: edges, text format, rng, rules, running generators.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle, checkpointCells } from '../../src/core/model.js';
import {
  edgeId,
  edgeCells,
  allEdges,
  edgeToKey,
  keyToEdge,
  setWallId,
} from '../../src/core/edges.js';
import { serialize, parse } from '../../src/core/format.js';
import { makeRng, dailySeed } from '../../src/core/rng.js';
import { newStat, updateStat, statSummary } from '../../src/core/stats.js';
import { isSolved, step } from '../../src/core/rules.js';
import { arrowSegment } from '../../src/view/geometry.js';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { runAsync, measured, cancellable, isAbort, isTimeout } from '../../src/platform/run.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { randPuzzle } from './helpers.js';

t('edges: id <-> cells <-> key round trip', () => {
  for (const n of [2, 5, 16]) {
    const es = allEdges(n);
    eq(es.length, 2 * n * (n - 1));
    for (const e of es) {
      const [a, b] = edgeCells(n, e);
      eq(edgeId(n, a, b), e);
      eq(edgeId(n, b, a), e);
      eq(keyToEdge(n, edgeToKey(n, e)), e);
    }
  }
});

t('format: serialize/parse round trip, size 2..16, errors', () => {
  for (let s = 1; s <= 20; s++) {
    const p = randPuzzle(s, 2 + (s % 15), 3, 0.3);
    eq(serialize(parse(serialize(p))), serialize(p));
  }
  eq(parse('size 16').n, 16);
  for (const bad of [
    'size 17',
    'size 1',
    'walls V,0,0',
    'size 3\nwalls V,0,2',
    'size 3\nwalls H,2,0',
    'size 3\ncheckpoints 3,0=1',
    'size 3\nfoo',
  ]) {
    let threw = false;
    try {
      parse(bad);
    } catch {
      threw = true;
    }
    ok(threw, 'should reject: ' + bad);
  }
});

t(
  'format: path line — round trip, cell order, and rejects disconnected / walled / repeated cells',
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 9;
    const withPath = serialize(p, { path: [0, 1, 2, 5, 4, 3, 6, 7, 8] });
    ok(
      withPath.includes('path 0,0 0,1 0,2 1,2 1,1 1,0 2,0 2,1 2,2'),
      'path line present in expected r,c order',
    );
    const back = parse(withPath);
    eq(back.path, [0, 1, 2, 5, 4, 3, 6, 7, 8]);
    eq(serialize(back, { path: back.path }), withPath, 'round trip with path is stable');
    eq(serialize(p).includes('path'), false, 'no path option -> no path line');
    eq(parse(serialize(p)).path, undefined, 'no path line -> no .path field');

    for (const bad of ['size 3\ncheckpoints 0,0=1\npath 0,0 2,2', 'size 3\npath 5,5']) {
      let threw = false;
      try {
        parse(bad);
      } catch {
        threw = true;
      }
      ok(threw, 'should reject: ' + bad);
    }
    const walled = makePuzzle(3);
    setWallId(walled.walls, edgeId(3, 0, 1), true);
    let threw = false;
    try {
      parse(serialize(walled, { path: [] }) + '\npath 0,0 0,1');
    } catch {
      threw = true;
    }
    ok(threw, 'should reject path crossing a wall');
    threw = false;
    try {
      parse('size 3\npath 0,0 0,1 0,0');
    } catch {
      threw = true;
    }
    ok(threw, 'should reject repeated cell');
  },
);

t(
  'format: time comments — only the given times, in a fixed order, ignored by parse, none by default',
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 9;
    const plain = serialize(p);
    eq(plain.includes('_time_'), false, 'no times option -> no time lines');
    eq(serialize(p, { times: {} }), plain, 'empty times -> identical to plain');
    eq(
      serialize(p, { times: { generateMs: null, solveMs: null, playS: null } }),
      plain,
      'null times are skipped',
    );

    const all = serialize(p, { times: { generateMs: 12.345, solveMs: 0.04, playS: 83.25 } });
    const lines = all.split('\n');
    eq(
      lines.filter(l => l.includes('_time_')),
      ['# generate_time_ms 12.3', '# solve_time_ms 0.0', '# play_time_s 83.3'],
      'one comment line per time: ms or s with one decimal',
    );
    const firstTime = lines.findIndex(l => l.includes('_time_'));
    eq(
      lines.findIndex(l => l.startsWith('size ')) > firstTime,
      true,
      'time comments come before the data lines',
    );
    eq(
      lines.slice(firstTime).filter(l => l.startsWith('#')).length,
      3,
      'nothing but the three comments between',
    );

    eq(serialize(parse(all)), plain, 'parse skips the comments: round trip gives the plain text');
    eq(
      serialize(p, { times: { solveMs: 5 } })
        .split('\n')
        .filter(l => l.includes('_time_')),
      ['# solve_time_ms 5.0'],
      'a single time',
    );
    const withPath = serialize(p, { path: [0, 1, 2, 5, 4, 3, 6, 7, 8], times: { playS: 1 } });
    eq(
      parse(withPath).path,
      [0, 1, 2, 5, 4, 3, 6, 7, 8],
      'times and a path line together still parse',
    );
  },
);

t(
  'run: measured() passes events and the return value through and clocks only the generator’s own compute time',
  () => {
    const burn = ms => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        /* busy wait */
      }
    };
    function* work() {
      yield { frac: 0.1 };
      burn(8);
      yield undefined;
      burn(8);
      yield { frac: 1 };
      burn(8);
      return 'done';
    }
    const clock = { ms: 0 };
    const seen = [];
    const result = runSync(measured(work(), clock), e => {
      seen.push(e);
      burn(40); // consumer-side work (UI updates in the app) must not be counted
    });
    eq(result, 'done');
    eq(
      seen,
      [{ frac: 0.1 }, { frac: 1 }],
      'falsy events are dropped by runSync as before; others arrive unchanged',
    );
    ok(clock.ms >= 24, `clock counts the 3 x 8 ms of compute (got ${clock.ms.toFixed(1)})`);
    ok(clock.ms < 24 + 40, `clock excludes the consumer's 2 x 40 ms (got ${clock.ms.toFixed(1)})`);
  },
);

t(
  'run: measured() works under runAsync (time-sliced, setTimeout yields) and propagates errors',
  async () => {
    const clock = { ms: 0 };
    const events = [];
    const value = await runAsync(measured(generate(5, 3), clock), {
      onEvent: e => events.push(e),
      sliceMs: 1,
    });
    eq(serialize(value), serialize(runSync(generate(5, 3))), 'same puzzle as the plain run');
    ok(clock.ms > 0, 'some compute time was clocked');
    ok(events.length > 0, 'progress events still reach onEvent');
    function* boom() {
      yield { frac: 0 };
      throw new Error('boom');
    }
    let message = null;
    try {
      await runAsync(measured(boom(), { ms: 0 }));
    } catch (e) {
      message = e.message;
    }
    eq(message, 'boom');
  },
);

t('rng: deterministic; dailySeed matches legacy values', () => {
  const a = makeRng(42),
    b = makeRng(42);
  for (let i = 0; i < 5; i++) eq(a(), b());
  eq(dailySeed(20350, 5, 0), 181660932);
  eq(dailySeed(20350, 9, 3), 2782780257);
});

t('stats: Welford == naive', () => {
  const xs = [3.2, 5.1, 4.4, 9.9, 1.2, 7.7],
    st = newStat();
  xs.forEach(x => updateStat(st, x));
  const m = xs.reduce((a, b) => a + b) / xs.length,
    sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)),
    s = statSummary(st);
  ok(Math.abs(s.mean - m) < 1e-9 && Math.abs(s.sd - sd) < 1e-9);
});

t(
  'checkpointCells + arrowSegment: graph edges k -> k+1, trimmed clear of the badges, head points at k+1',
  () => {
    const p = makePuzzle(4);
    p.cp[5] = 2;
    p.cp[0] = 1;
    p.cp[15] = 3;
    eq(checkpointCells(p), [0, 5, 15]);
    const { line, tip, head } = arrowSegment(4, 0, 3, 1, 0.3, 0.2, 0.1); // (0,0) -> (0,3): cell centres x 0.5 -> 3.5
    eq(
      line.map(v => +v.toFixed(3)),
      [0.8, 0.5, 3.0, 0.5],
    );
    eq(
      tip.map(v => +v.toFixed(3)),
      [3.2, 0.5],
    );
    eq(
      head.map(v => +v.toFixed(3)),
      [3.2, 0.5, 3.0, 0.6, 3.0, 0.4],
    );
    const d = arrowSegment(4, 0, 5, 2, 0.34); // diagonal (1,1) -> (3,3) at scale 2: tip trimmed 0.68 along the unit direction
    eq(
      d.tip.map(v => +v.toFixed(3)),
      [2.519, 2.519],
    );
  },
);

t('rules: isSolved, step (default / truncate / strictOrder)', () => {
  const p = makePuzzle(3);
  [0, 4, 8].forEach((c, i) => {
    p.cp[c] = i + 1;
  });
  const sol = [0, 1, 2, 5, 4, 3, 6, 7, 8];
  eq(isSolved(p, sol), true);
  eq(isSolved(p, [...sol].reverse()), false, 'wrong start/end');
  eq(isSolved(p, sol.slice(0, 8)), false, 'incomplete');
  const path = [];
  eq(step(p, path, 1), null);
  eq(step(p, path, 0), 'push');
  eq(step(p, path, 1), 'push');
  eq(step(p, path, 0), 'pop');
  eq(step(p, path, 4), null, 'not adjacent');
  eq(step(p, path, 1), 'push');
  eq(step(p, path, 2), 'push');
  eq(step(p, path, 0), null, 'no truncate by default');
  eq(step(p, path, 0, { truncate: true }), 'trunc');
  eq(path, [0]);
  const S = { strictOrder: true },
    q = [0, 1, 2, 5];
  eq(step(p, q, 8, S), null, 'checkpoint 3 before 2');
  eq(step(p, q, 4, S), 'push');
  eq(step(p, q, 7, S), 'push');
  eq(step(p, q, 8, S), 'push');
  eq(step(p, q, 5, S), null);
});

ta(
  'run: a signal stops runAsync at once: the generator is closed, no event follows, the promise rejects with AbortError',
  async () => {
    let steps = 0,
      closed = false;
    function* endless() {
      try {
        for (;;) {
          steps++;
          yield { frac: 0 };
        }
      } finally {
        closed = true;
      }
    }
    const job = cancellable(60000);
    const events = [];
    const run = runAsync(endless(), {
      onEvent: e => {
        events.push(e);
        if (events.length === 3) job.cancel();
      },
      sliceMs: 1,
      signal: job.signal,
    });
    let error = null;
    try {
      await run;
    } catch (e) {
      error = e;
    }
    job.end();
    ok(isAbort(error) && !isTimeout(error), 'rejects with an AbortError');
    ok(closed, 'the generator was closed (its finally ran)');
    const seen = steps;
    await new Promise(resolve => setTimeout(resolve, 30));
    eq(steps, seen, 'no step runs after the cancel');
    eq(events.length, 3, 'no event after the cancel');
  },
);

ta(
  'run: a signal that is already aborted runs nothing; a run that ends first leaves the signal alone',
  async () => {
    let steps = 0;
    function* counting() {
      steps++;
      yield { frac: 0 };
      return 'done';
    }
    const job = cancellable(60000);
    job.cancel();
    job.end(); // an armed clock keeps Node alive for its 60 s after the last test
    let error = null;
    try {
      await runAsync(counting(), { signal: job.signal });
    } catch (e) {
      error = e;
    }
    ok(isAbort(error), 'rejects with an AbortError');
    eq(steps, 0, 'the generator never started');
    const fresh = cancellable(60000);
    eq(
      await runAsync(counting(), { signal: fresh.signal }),
      'done',
      'a run that finishes resolves as before',
    );
    fresh.end();
    eq(fresh.signal.aborted, false, 'finishing does not abort the signal');
  },
);

ta(
  'run: cancellable() stops a run that never ends after its time; end() disarms the clock',
  async () => {
    function* endless() {
      for (;;) yield { frac: 0 };
    }
    const slow = cancellable(20);
    let error = null;
    try {
      await runAsync(endless(), { signal: slow.signal, sliceMs: 1 });
    } catch (e) {
      error = e;
    }
    ok(isTimeout(error) && !isAbort(error), 'rejects with a TimeoutError');
    const done = cancellable(10);
    done.end();
    await new Promise(resolve => setTimeout(resolve, 40));
    eq(done.signal.aborted, false, 'end() cleared the clock');
  },
);

registerAsyncTests();
