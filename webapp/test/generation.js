// Generation in a worker: the job code (apps/play/gen-job.js), the worker's entry (gen-worker.js) and the runner that moves a job
// between the page, a worker and the fallback on this thread (platform/worker-run.js). Registered by tests.js: generationTests().
import assert from 'node:assert/strict';
import { runSync } from '../src/core/run.js';
import { PLAY_VARIANTS } from '../src/apps/play/variants.js';
import { runJob, generatorFor, slim, EVENT_MS } from '../src/apps/play/gen-job.js';
import { createWorkerRunner } from '../src/platform/worker-run.js';
import { isAbort, isTimeout } from '../src/platform/run.js';
import { registerBalls } from '../src/core/solid/ball-registry.js';
import { BALL_CATALOG } from '../src/core/solid/ball-catalog.js';

// Stands in for a Worker: the test plays the worker's side with emit().
class FakeWorker {
  constructor() {
    this.listeners = {};
    this.posted = [];
    this.terminated = false;
  }
  addEventListener(type, f) { (this.listeners[type] ||= new Set()).add(f); }
  removeEventListener(type, f) { this.listeners[type]?.delete(f); }
  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  emit(type, data) { for (const f of [...(this.listeners[type] || [])]) f({ data }); }
  get id() { return this.posted.at(-1).id; }
}

const quiet = fn => { // runs fn with console.warn muted
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

export function generationTests(t, ok, eq, ta) {
  const smallest = v => Math.min(...v.sizes([5, 6, 7, 8, 9, 10]));
  const jobs = [
    { task: 'flat', mode: 'standard', n: 5, seed: 11 },
    ...PLAY_VARIANTS.filter(v => v.generate).map(v => ({ task: 'flat', mode: v.id, n: smallest(v), seed: 11 })),
    { task: 'solid', kind: 'tetra', n: 2, seed: 11 },
    { task: 'solid', kind: 'cube', n: 2, seed: 11 },
    { task: 'solid', kind: 'ball', n: 'snub-cube', seed: 11 },
  ];

  ta('generation job: runJob makes the puzzle of the generator, and the result crosses a worker boundary unchanged', async () => {
    registerBalls(BALL_CATALOG);
    for (const job of jobs) {
      const name = `${job.task} ${job.mode ?? job.kind} ${job.n}`;
      const result = await runJob(job, () => {});
      assert.deepStrictEqual(result, runSync(generatorFor(job)), name + ': the same as the generator run directly');
      assert.deepStrictEqual(structuredClone(result), result, name + ': structuredClone (what postMessage does) changes nothing');
    }
    ok(jobs.length >= 12, 'every variant of the play app and the three solids are covered');
    await assert.rejects(() => runJob({ task: 'nope' }, () => {}), /unknown generation job/);
  });

  ta('generation job: progress events are plain and at most one per EVENT_MS', async () => {
    const times = [], events = [];
    await runJob({ task: 'flat', mode: 'standard', n: 9, seed: 5 }, e => { times.push(performance.now()); events.push(e); });
    ok(events.length > 0, 'a 9x9 takes long enough to report');
    for (const e of events) assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), e, 'plain data');
    for (let i = 1; i < times.length; i++) ok(times[i] - times[i - 1] >= EVENT_MS - 2, 'spaced by EVENT_MS');
  });

  t('generation job: slim keeps numbers, text, booleans and null, and leaves objects, arrays and functions behind', () => {
    eq(slim({ frac: 0.5, phase: 'walls', done: true, none: null, puzzle: { n: 1 }, list: [1], f() {} }),
      { frac: 0.5, phase: 'walls', done: true, none: null });
  });

  ta('generation worker: the entry answers a job with events and a result, a failing job with an error message', async () => {
    registerBalls(BALL_CATALOG);
    const posts = [], previous = globalThis.self;
    globalThis.self = { postMessage: m => posts.push(m) };
    try {
      await import('../src/apps/play/gen-worker.js');
      const job = { task: 'flat', mode: 'standard', n: 9, seed: 5 };
      await globalThis.self.onmessage({ data: { id: 7, job } });
      const done = posts.at(-1);
      eq([done.id, done.type], [7, 'done']);
      assert.deepStrictEqual(done.result, runSync(generatorFor(job)));
      ok(posts.slice(0, -1).every(m => m.id === 7 && m.type === 'event'), 'only events before the result');
      posts.length = 0;
      await globalThis.self.onmessage({ data: { id: 8, job: { task: 'solid', kind: 'ball', n: 'no-such-ball', seed: 1 } } });
      eq(posts.length, 1);
      eq([posts[0].id, posts[0].type], [8, 'error']);
      ok(typeof posts[0].message === 'string' && posts[0].message.length > 0, 'the message of the error');
    } finally {
      if (previous === undefined) delete globalThis.self; else globalThis.self = previous;
    }
  });

  ta('worker runner: events and the result come back by job id; a job that fails rejects; the worker is reused', async () => {
    const made = [], runner = createWorkerRunner({ spawn: () => { const w = new FakeWorker(); made.push(w); return w; }, fallback: () => assert.fail('no fallback') });
    eq(runner.where, 'unused');
    const events = [], first = runner.run({ n: 1 }, { onEvent: e => events.push(e) });
    const w = made[0];
    eq(w.posted, [{ id: 1, job: { n: 1 } }]);
    w.emit('message', { id: 99, type: 'done', result: 'someone else' }); // another job's message is ignored
    w.emit('message', { id: 1, type: 'event', event: { frac: 0.5 } });
    w.emit('message', { id: 1, type: 'done', result: { puzzle: 1 } });
    eq(await first, { puzzle: 1 });
    eq(events, [{ frac: 0.5 }]);
    const second = runner.run({ n: 2 });
    eq(made.length, 1, 'the same worker takes the next job');
    w.emit('message', { id: 2, type: 'error', message: 'no path found' });
    await assert.rejects(second, error => error instanceof Error && error.message === 'no path found');
    eq([w.terminated, runner.where], [false, 'worker'], 'a failed job leaves the worker alone');
    const third = runner.run({ n: 3 });
    w.emit('message', { id: 3, type: 'done', result: 'ok' });
    eq(await third, 'ok');
    eq([...w.listeners.message, ...w.listeners.error].length, 0, 'finished jobs leave no listeners behind');
  });

  ta('worker runner: a cancel terminates the worker and rejects with the signal\'s reason; the next job starts a new worker', async () => {
    const made = [], runner = createWorkerRunner({ spawn: () => { const w = new FakeWorker(); made.push(w); return w; }, fallback: () => assert.fail('no fallback') });
    let controller = new AbortController();
    const cancelled = runner.run({ n: 1 }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, isAbort);
    ok(made[0].terminated, 'terminate() ends a worker that never answers');
    made[0].emit('message', { id: 1, type: 'done', result: 'late' }); // nothing listens any more
    controller = new AbortController();
    const slow = runner.run({ n: 2 }, { signal: controller.signal });
    eq(made.length, 2, 'a fresh worker');
    controller.abort(new DOMException('too slow', 'TimeoutError'));
    await assert.rejects(slow, isTimeout);
    ok(made[1].terminated);
    const spawned = made.length;
    await assert.rejects(runner.run({ n: 3 }, { signal: AbortSignal.abort() }), isAbort);
    eq(made.length, spawned, 'a signal that is already aborted starts nothing');
  });

  ta('worker runner: a worker that cannot start or dies hands the job to the fallback, and later jobs skip it', async () => {
    const seen = [], fallback = async (job, { signal }) => { seen.push([job.n, Boolean(signal)]); return 'on this thread ' + job.n; };
    const made = [], runner = createWorkerRunner({ spawn: () => { const w = new FakeWorker(); made.push(w); return w; }, fallback });
    const signal = new AbortController().signal, job = runner.run({ n: 1 }, { signal });
    made[0].emit('error', undefined); // e.g. the browser has no module workers, or the script did not load
    eq(await job, 'on this thread 1');
    ok(made[0].terminated);
    eq(runner.where, 'thread');
    eq(await runner.run({ n: 2 }), 'on this thread 2');
    eq(made.length, 1, 'no second worker');
    eq(seen, [[1, true], [2, false]], 'the fallback gets the job and the signal');

    const clone = createWorkerRunner({ spawn: () => { const w = new FakeWorker(); made.push(w); return w; }, fallback });
    const broken = clone.run({ n: 3 });
    made.at(-1).emit('messageerror', undefined); // a result that cannot be cloned
    eq(await broken, 'on this thread 3');

    for (const spawn of [() => null, () => { throw new Error('SecurityError'); }]) {
      const r = createWorkerRunner({ spawn, fallback });
      eq(await quiet(() => r.run({ n: 4 })), 'on this thread 4');
      eq(r.where, 'thread');
    }
    const failing = createWorkerRunner({ spawn: () => null, fallback: async () => { throw new Error('the generator failed'); } });
    await assert.rejects(failing.run({ n: 5 }), /the generator failed/);
  });
}
