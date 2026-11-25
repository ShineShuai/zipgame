// Unit tests of the leaderboard: backends, failover, adapters, config, after-submit rounds, share flow.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { createReplay } from '../../src/features/replay.js';
import { createStore } from '../../src/features/stats-store.js';
import { binOf } from '../../src/core/hist.js';
import { fetchStats } from '../../src/platform/stats-client.js';
import {
  createLeaderboard,
  backendsFromConfig,
  cloudflareBackend,
  supabaseBackend,
  tursoBackend,
  afterSubmit,
  submitAttempt,
  MAX_ROUNDS,
} from '../../src/platform/leaderboard.js';
import { atDay, fakeStorage } from './helpers.js';
import { REFUSED } from '../errors.js';

test('leaderboard: backendsFromConfig = always + backup chain + the others; skips unconfigured and unknown types; ?lb= moves a backup first', () => {
  const cfg = {
    backends: {
      asia: { type: 'supabase', url: 'https://a', key: 'k' },
      cf: { type: 'cloudflare', url: 'https://w' },
      eu: { type: 'supabase', url: 'https://e', key: 'k' },
      spare: { type: 'supabase', url: 'https://x', key: 'k' },
    },
    always: 'asia',
    order: ['cf', 'eu'],
  };
  const names = list => list.map(b => b.name);
  const setup = backendsFromConfig(cfg);
  assert.deepStrictEqual(
    [setup.always.name, names(setup.chain), names(setup.list)],
    ['asia', ['cf', 'eu'], ['asia', 'cf', 'eu', 'spare']],
    'a backend that is neither always nor in order is read-only',
  );
  assert.deepStrictEqual(names(backendsFromConfig(cfg, 'eu').chain), ['eu', 'cf']);
  assert.deepStrictEqual(
    names(backendsFromConfig(cfg, 'asia').chain),
    ['cf', 'eu'],
    '?lb= naming the always-written backend changes nothing',
  );
  assert.deepStrictEqual(names(backendsFromConfig(cfg, 'nope').chain), ['cf', 'eu']);
  assert.deepStrictEqual(
    names(backendsFromConfig({ ...cfg, order: ['cf', 'asia', 'eu', 'cf'] }).chain),
    ['cf', 'eu'],
    'always is never a backup; duplicates dropped',
  );
  const noKey = backendsFromConfig({
    ...cfg,
    backends: { ...cfg.backends, asia: { type: 'supabase', url: 'https://a', key: '' } },
  });
  assert.deepStrictEqual(
    [noKey.always, names(noKey.chain), names(noKey.list)],
    [null, ['cf', 'eu'], ['cf', 'eu', 'spare']],
    'always not configured: the backups alone',
  );
  assert.deepStrictEqual(backendsFromConfig({ ...cfg, always: undefined }).always, null);
  assert.deepStrictEqual(
    names(
      backendsFromConfig({
        ...cfg,
        backends: { ...cfg.backends, eu: { type: 'mongo', url: 'https://t', key: 'k' } },
      }).chain,
    ),
    ['cf'],
    'a type this build does not know is skipped',
  );
  assert.deepStrictEqual(
    names(
      backendsFromConfig({
        ...cfg,
        backends: { ...cfg.backends, eu: { type: 'turso', url: 'https://t', key: 'k' } },
      }).chain,
    ),
    ['cf', 'eu'],
    'turso is a known type',
  );
  assert.deepStrictEqual(
    names(
      backendsFromConfig({
        ...cfg,
        backends: { ...cfg.backends, eu: { type: 'turso', url: 'https://t', key: '' } },
      }).chain,
    ),
    ['cf'],
    'a turso entry without its token is not configured',
  );
  assert.deepStrictEqual(
    names(
      backendsFromConfig({
        ...cfg,
        backends: { ...cfg.backends, cf: { type: 'cloudflare', url: '' } },
      }).chain,
    ),
    ['eu'],
  );
  const none = backendsFromConfig({ backends: {}, always: 'asia', order: ['cf'] });
  assert.deepStrictEqual([none.always, none.chain, none.list], [null, [], []]);
  assert.deepStrictEqual(createLeaderboard(none).enabled, false);
  assert.deepStrictEqual(createLeaderboard(setup).readOrder, ['asia', 'cf', 'eu']);
});

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const GOOD = { n: 3, sum: 90000, below: 1, cnt: 1, best: [10000, 30000, 50000] };

const hang = (_url, { signal }) =>
  new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));

const CF = { url: 'https://w.example/' },
  SB = { url: 'https://s.example', key: 'anon-key' },
  ASIA = { url: 'https://asia.example', key: 'asia-key' };

const both = f =>
  createLeaderboard(
    { always: null, chain: [cloudflareBackend(CF), supabaseBackend(SB)] },
    { fetchFn: f, timeoutMs: 20 },
  ); // backups only

test('leaderboard: request shapes (cloudflare text/plain no preflight; supabase rpc + apikey) and summary', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push([url, init]);
    return reply(200, GOOD);
  };
  const r = await both(f).submit('20260929', 42.13);
  assert.deepStrictEqual(
    [r.status, r.backend, r.summary],
    ['ok', 'cloudflare', { n: 3, mean: 30, top: null, pct: 50 }],
  );
  assert.deepStrictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0][0], 'https://w.example/gotd');
  assert.deepStrictEqual(calls[0][1].headers, { 'Content-Type': 'text/plain;charset=UTF-8' });
  assert.deepStrictEqual(JSON.parse(calls[0][1].body), { d: 20260929, t: 42130, b: binOf(42130) });
  const g = [];
  await createLeaderboard(
    { always: null, chain: [supabaseBackend(SB)] },
    {
      fetchFn: async (u, i) => {
        g.push([u, i]);
        return reply(200, GOOD);
      },
    },
  ).submit('20260929', 42.13);
  assert.deepStrictEqual(g[0][0], 'https://s.example/rest/v1/rpc/submit_gotd');
  assert.deepStrictEqual(g[0][1].headers, {
    'Content-Type': 'application/json',
    apikey: 'anon-key',
  });
  assert.deepStrictEqual(JSON.parse(g[0][1].body), {
    p_day: 20260929,
    p_ms: 42130,
    p_bin: binOf(42130),
  });
});

test('leaderboard: fails over on 5xx, 404, network error, timeout and malformed reply', async () => {
  for (const first of [
    async () => reply(503, {}),
    async () => reply(404, {}),
    async () => {
      throw new TypeError('network');
    },
    hang,
    async () => reply(200, { n: 'x' }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    }),
  ]) {
    const urls = [];
    const r = await both((u, i) => {
      urls.push(u);
      return u.includes('w.example') ? first(u, i) : reply(200, GOOD);
    }).submit('20260929', 30);
    assert.deepStrictEqual([r.status, r.backend, urls.length], ['ok', 'supabase', 2]);
  }
});

test('leaderboard: 400/422 = rejected without failover; all down = failed; out-of-range time = skipped, nothing sent', async () => {
  for (const code of [400, 422]) {
    let n = 0;
    const r = await both(async () => {
      n++;
      return reply(code, {});
    }).submit('20260929', 30);
    assert.deepStrictEqual([r.status, n], ['rejected', 1]);
  }
  let n = 0;
  assert.deepStrictEqual(
    (
      await both(async () => {
        n++;
        return reply(500, {});
      }).submit('20260929', 30)
    ).status,
    'failed',
  );
  assert.deepStrictEqual(n, 2);
  n = 0;
  assert.deepStrictEqual((await both(hang).submit('20260929', 30)).status, 'failed');
  for (const sec of [0.4, 3601, NaN]) {
    let sent = 0;
    assert.deepStrictEqual(
      (
        await both(async () => {
          sent++;
          return reply(200, GOOD);
        }).submit('20260929', sec)
      ).status,
      'skipped',
    );
    assert.deepStrictEqual(sent, 0);
  }
});

// always-written backend `asia` + backup chain [cloudflare, supabase]; every host answers as routes[host]; the summary's mean tells who answered
const three = routes => {
  const calls = [];
  const fetchFn = async (url, init) => {
    const host = new URL(url).host;
    calls.push(host);
    return routes[host](url, init);
  };
  const lb = createLeaderboard(
    { always: supabaseBackend(ASIA, 'asia'), chain: [cloudflareBackend(CF), supabaseBackend(SB)] },
    { fetchFn, timeoutMs: 20 },
  );
  return { lb, calls };
};

const meanOf = seconds => async () =>
  reply(200, { n: 3, sum: 3000 * seconds, below: 1, cnt: 1, best: [10000, 30000, 50000] });

const ALL = { 'asia.example': meanOf(30), 'w.example': meanOf(40), 's.example': meanOf(50) };

const down = async () => reply(503, {});

const brief = r => [r.status, r.backend, r.summary?.mean, r.done, r.complete];

test('leaderboard: always + first backup are both written, the summary comes from always, the later backups stay untouched', async () => {
  const { lb, calls } = three(ALL);
  assert.deepStrictEqual(brief(await lb.submit('20261004', 42.13)), [
    'ok',
    'asia',
    30,
    ['asia', 'cloudflare'],
    true,
  ]);
  assert.deepStrictEqual([...calls].sort(), ['asia.example', 'w.example']);
});

test('leaderboard: always and the backup chain are requested in parallel', async () => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const slow = mean => async () => {
    await gate;
    return meanOf(mean)();
  };
  const { lb, calls } = three({
    'asia.example': slow(30),
    'w.example': slow(40),
    's.example': slow(50),
  });
  const pending = lb.submit('20261004', 30);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    [...calls].sort(),
    ['asia.example', 'w.example'],
    'both in flight before either answered',
  );
  release();
  assert.deepStrictEqual((await pending).done, ['asia', 'cloudflare']);
});

test('leaderboard: the backup chain fails over (cloudflare down: supabase), always is unaffected', async () => {
  const { lb, calls } = three({ ...ALL, 'w.example': down });
  assert.deepStrictEqual(brief(await lb.submit('20261004', 30)), [
    'ok',
    'asia',
    30,
    ['asia', 'supabase'],
    true,
  ]);
  assert.deepStrictEqual([...calls].sort(), ['asia.example', 's.example', 'w.example']);
});

test('leaderboard: backups all down = ok but not complete; always down = the backup answers and always is still owed', async () => {
  const noBackups = three({ ...ALL, 'w.example': down, 's.example': down });
  assert.deepStrictEqual(brief(await noBackups.lb.submit('20261004', 30)), [
    'ok',
    'asia',
    30,
    ['asia'],
    false,
  ]);
  const noAsia = three({ ...ALL, 'asia.example': down });
  assert.deepStrictEqual(brief(await noAsia.lb.submit('20261004', 30)), [
    'ok',
    'cloudflare',
    40,
    ['cloudflare'],
    false,
  ]);
  const hung = three({
    ...ALL,
    'asia.example': (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  });
  assert.deepStrictEqual(
    brief(await hung.lb.submit('20261004', 30)),
    ['ok', 'cloudflare', 40, ['cloudflare'], false],
    'a timeout of always does not stop the backup',
  );
  const nothing = three({ 'asia.example': down, 'w.example': down, 's.example': down });
  assert.deepStrictEqual(brief(await nothing.lb.submit('20261004', 30)), [
    'failed',
    undefined,
    undefined,
    [],
    false,
  ]);
});

test('leaderboard: a retry writes only what is missing (done), and nothing when nothing is missing', async () => {
  const chainOnly = three(ALL);
  assert.deepStrictEqual(brief(await chainOnly.lb.submit('20261004', 30, ['asia'])), [
    'ok',
    'cloudflare',
    40,
    ['asia', 'cloudflare'],
    true,
  ]);
  assert.deepStrictEqual(chainOnly.calls, ['w.example']);
  const alwaysOnly = three(ALL);
  assert.deepStrictEqual(brief(await alwaysOnly.lb.submit('20261004', 30, ['supabase'])), [
    'ok',
    'asia',
    30,
    ['supabase', 'asia'],
    true,
  ]);
  assert.deepStrictEqual(alwaysOnly.calls, ['asia.example']);
  const done = three(ALL);
  assert.deepStrictEqual(await done.lb.submit('20261004', 30, ['asia', 'cloudflare']), {
    status: 'ok',
    done: ['asia', 'cloudflare'],
    complete: true,
  });
  assert.deepStrictEqual(done.calls, []);
});

test('leaderboard: a 400/422 backend counts as settled; one that stored the solve wins; only rejections = rejected', async () => {
  const alwaysRejects = three({ ...ALL, 'asia.example': async () => reply(400, {}) });
  assert.deepStrictEqual(brief(await alwaysRejects.lb.submit('20261004', 30)), [
    'ok',
    'cloudflare',
    40,
    ['asia', 'cloudflare'],
    true,
  ]);
  const chainRejects = three({ ...ALL, 'w.example': async () => reply(422, {}) });
  assert.deepStrictEqual(brief(await chainRejects.lb.submit('20261004', 30)), [
    'ok',
    'asia',
    30,
    ['asia', 'cloudflare'],
    true,
  ]);
  assert.deepStrictEqual(
    [...chainRejects.calls].sort(),
    ['asia.example', 'w.example'],
    'a rejection ends the chain: no failover to supabase',
  );
  const allReject = three({
    ...ALL,
    'asia.example': async () => reply(400, {}),
    'w.example': async () => reply(400, {}),
  });
  assert.deepStrictEqual((await allReject.lb.submit('20261004', 30)).status, 'rejected');
  const skipped = three(ALL);
  assert.deepStrictEqual(
    [(await skipped.lb.submit('20261004', 0.4)).status, skipped.calls],
    ['skipped', []],
  );
});

test('leaderboard / stats-client: an adapter with decode() (a database with its own reply envelope) plugs in without changes to the flow', async () => {
  // stands for a backend like Turso's HTTP API: always HTTP 200, the result or an error inside an envelope
  const wrapped = {
    name: 'wrapped',
    request: ({ d, t, b }) => ({
      url: 'https://wrapped.example/q',
      init: { method: 'POST', body: JSON.stringify({ d, t, b }) },
    }),
    read: ({ from, to }) => ({
      url: `https://wrapped.example/r?${from}-${to}`,
      init: { method: 'GET' },
    }),
    decode: (_kind, json) => {
      if (json.error) return json.error === 'invalid' ? { rejected: true } : null;
      return json.result;
    },
  };
  const answer = body => async () => ({ ok: true, status: 200, json: async () => body });
  const lbOf = f =>
    createLeaderboard({ always: wrapped, chain: [] }, { fetchFn: f, timeoutMs: 20 });
  assert.deepStrictEqual(brief(await lbOf(answer({ result: GOOD })).submit('20261004', 30)), [
    'ok',
    'wrapped',
    30,
    ['wrapped'],
    true,
  ]);
  assert.deepStrictEqual(
    (await lbOf(answer({ error: 'invalid' })).submit('20261004', 30)).status,
    'rejected',
  );
  assert.deepStrictEqual(
    (await lbOf(answer({ error: 'db down' })).submit('20261004', 30)).status,
    'failed',
  );
  assert.deepStrictEqual(
    (await lbOf(answer({ result: { n: 'x' } })).submit('20261004', 30)).status,
    'failed',
  );
  const day = { d: 20261004, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000] };
  const [ok] = await fetchStats(
    [wrapped],
    { from: 20261004, to: 20261004 },
    { fetchFn: answer({ result: { days: [day] } }) },
  );
  assert.deepStrictEqual([ok.status, ok.days.length, ok.days[0].n], ['ok', 1, 3]);
  const [bad] = await fetchStats(
    [wrapped],
    { from: 20261004, to: 20261004 },
    { fetchFn: answer({ error: 'x' }) },
  );
  assert.deepStrictEqual(bad.status, 'failed');
});

const TB = { url: 'https://zip-x.turso.io/', key: 'public-token' };

const cell = v =>
  typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: v };

const pipe = (...results) => ({
  baton: null,
  base_url: null,
  results: [...results, { type: 'ok', response: { type: 'close' } }],
});

const rowOf = obj => ({
  type: 'ok',
  response: {
    type: 'execute',
    result: {
      cols: Object.keys(obj).map(name => ({ name })),
      rows: [Object.values(obj).map(cell)],
      affected_row_count: 0,
    },
  },
});

const done = n => ({
  type: 'ok',
  response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: n } },
});

const failed = message => ({ type: 'error', error: { message } });

const STATS_ROW = { n: 3, sum: 90000, below: 1, cnt: 1, best: '[10000,30000,50000]' };

test('turso adapter: request = one pipeline (INSERT, summary SELECT) with the token as bearer; read = one statement', () => {
  const be = tursoBackend(TB, 'turso-asia'),
    b = binOf(42130);
  const { url, init } = be.request({ d: 20261004, t: 42130, b, u: 'uid-12345678' });
  assert.deepStrictEqual(
    [be.name, url, init.method, init.headers],
    [
      'turso-asia',
      'https://zip-x.turso.io/v2/pipeline',
      'POST',
      { 'Content-Type': 'application/json', Authorization: 'Bearer public-token' },
    ],
  );
  const req = JSON.parse(init.body).requests;
  assert.deepStrictEqual(
    req.map(r => r.type),
    ['execute', 'execute', 'close'],
  );
  assert.deepStrictEqual(req[0].stmt.args, [
    { type: 'text', value: 'uid-12345678' },
    { type: 'integer', value: '20261004' },
    { type: 'integer', value: '42130' },
    { type: 'integer', value: String(b) },
  ]);
  assert.deepStrictEqual(req[1].stmt.args, [
    { type: 'integer', value: '20261004' },
    { type: 'integer', value: String(b) },
  ]);
  assert.ok(
    /^INSERT OR IGNORE INTO submit/.test(req[0].stmt.sql) && /FROM solve/.test(req[1].stmt.sql),
  );
  const uid = () =>
    JSON.parse(be.request({ d: 20261004, t: 42130, b }).init.body).requests[0].stmt.args[0].value;
  const uids = [uid(), uid()];
  assert.ok(
    uids.every(id => id.length >= 8 && id.length <= 64) && uids[0] !== uids[1],
    'a fresh random uid of 8..64 characters per request',
  );
  const r = be.read({ from: 20261001, to: 20261004 });
  assert.deepStrictEqual(
    [
      r.url,
      JSON.parse(r.init.body).requests.map(x => x.type),
      JSON.parse(r.init.body).requests[0].stmt.args,
    ],
    [
      'https://zip-x.turso.io/v2/pipeline',
      ['execute', 'close'],
      [
        { type: 'integer', value: '20261001' },
        { type: 'integer', value: '20261004' },
      ],
    ],
  );
});

test('turso adapter: decode = stats / rejected (the trigger raised invalid) / throws (any other error, nothing usable)', () => {
  const be = tursoBackend(TB);
  assert.deepStrictEqual(be.decode('submit', pipe(done(1), rowOf(STATS_ROW))), GOOD);
  assert.deepStrictEqual(
    be.decode('submit', pipe(done(0), rowOf(STATS_ROW))),
    GOOD,
    'a uid that is already stored: the same answer',
  );
  assert.deepStrictEqual(
    be.decode('submit', pipe(failed('SQLite error: invalid'), rowOf(STATS_ROW))),
    {
      rejected: true,
    },
  );
  assert.throws(
    () => be.decode('submit', pipe(failed('SQLite error: not authorized'), rowOf(STATS_ROW))),
    REFUSED,
    'SQLITE_AUTH is a failure, not a rejection',
  );
  assert.throws(
    () => be.decode('submit', pipe(done(1), failed('SQLite error: no such table: solve'))),
    REFUSED,
  );
  assert.throws(
    () =>
      be.decode(
        'submit',
        pipe(done(1), {
          type: 'ok',
          response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0 } },
        }),
      ),
    REFUSED,
    'no stats row',
  );
  assert.throws(() => be.decode('submit', { error: 'x' }), REFUSED);
  assert.throws(() => be.decode('read', null), REFUSED);
  assert.throws(
    () =>
      be.decode(
        'read',
        pipe({
          type: 'ok',
          response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0 } },
        }),
      ),
    REFUSED,
    'no row for the read',
  );
  const day = d => ({ d, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000], seeds: [] });
  assert.deepStrictEqual(
    be
      .decode(
        'read',
        pipe(rowOf({ reply: JSON.stringify({ days: [day(20261005), day(20261004)] }) })),
      )
      .days.map(x => x.d),
    [20261004, 20261005],
    'days come back oldest first',
  );
  assert.deepStrictEqual(be.decode('read', pipe(rowOf({ reply: '{"days":[]}' }))), { days: [] });
  assert.throws(() => be.decode('read', pipe(failed('SQLite error: not authorized'))), REFUSED);
});

test('turso adapter in the flow: HTTP 200 with an error inside = rejected / failed; a good envelope = ok; the stats page reads it too', async () => {
  const be = tursoBackend(TB, 'turso-asia');
  const answer = body => async () => ({ ok: true, status: 200, json: async () => body });
  const lbOf = f => createLeaderboard({ always: be, chain: [] }, { fetchFn: f, timeoutMs: 20 });
  assert.deepStrictEqual(
    brief(await lbOf(answer(pipe(done(1), rowOf(STATS_ROW)))).submit('20261004', 30)),
    ['ok', 'turso-asia', 30, ['turso-asia'], true],
  );
  assert.deepStrictEqual(
    (
      await lbOf(answer(pipe(failed('SQLite error: invalid'), rowOf(STATS_ROW)))).submit(
        '20261004',
        30,
      )
    ).status,
    'rejected',
  );
  assert.deepStrictEqual(
    (
      await lbOf(answer(pipe(failed('SQLite error: not authorized'), rowOf(STATS_ROW)))).submit(
        '20261004',
        30,
      )
    ).status,
    'failed',
  );
  assert.deepStrictEqual(
    (await lbOf(async () => reply(401, {})).submit('20261004', 30)).status,
    'failed',
    'a wrong token is a failure (HTTP 401), so a backup would be tried',
  );
  const day = {
    d: 20261004,
    n: 3,
    sum: 9000,
    bins: [[3, 3]],
    best: [2000, 3000, 4000],
    seeds: [3000],
  };
  const [res] = await fetchStats(
    [be],
    { from: 20261004, to: 20261004 },
    { fetchFn: answer(pipe(rowOf({ reply: JSON.stringify({ days: [day] }) }))) },
  );
  assert.deepStrictEqual(
    [res.status, res.days.length, res.days[0].n, res.days[0].seeds],
    ['ok', 1, 3, [3000]],
  );
});

// any combination of `always` / `order` over four backends (one of them Turso): who gets the solve. A host in `down` answers HTTP 503.
const comboCfg = (always, order, tursoKey = 'tok') => ({
  backends: {
    'turso-asia': { type: 'turso', url: 'https://t.example', key: tursoKey },
    'supabase-asia': { type: 'supabase', url: 'https://asia.example', key: 'k' },
    cloudflare: { type: 'cloudflare', url: 'https://w.example' },
    supabase: { type: 'supabase', url: 'https://s.example', key: 'k' },
  },
  always,
  order,
});

const comboRun = async (always, order, down = [], tursoKey) => {
  const hosts = new Set();
  const fetchFn = async url => {
    const host = new URL(url).host;
    hosts.add(host);
    if (down.includes(host)) return reply(503, {});
    return host === 't.example'
      ? { ok: true, status: 200, json: async () => pipe(done(1), rowOf(STATS_ROW)) }
      : reply(200, GOOD);
  };
  const lb = createLeaderboard(backendsFromConfig(comboCfg(always, order, tursoKey)), {
    fetchFn,
    timeoutMs: 20,
  });
  const r = await lb.submit('20261004', 30);
  return {
    status: r.status,
    backend: r.backend,
    complete: r.complete,
    done: [...r.done].sort(),
    hosts: [...hosts].sort(),
    readOrder: lb.readOrder,
  };
};

test('config combinations: always turso-asia with the other backends as backups (supabase-asia first) = two writes per solve, failover inside the chain', async () => {
  const order = ['supabase-asia', 'cloudflare', 'supabase'];
  assert.deepStrictEqual(await comboRun('turso-asia', order), {
    status: 'ok',
    backend: 'turso-asia',
    complete: true,
    done: ['supabase-asia', 'turso-asia'],
    hosts: ['asia.example', 't.example'],
    readOrder: ['turso-asia', 'supabase-asia', 'cloudflare', 'supabase'],
  });
  const asiaDown = await comboRun('turso-asia', order, ['asia.example']);
  assert.deepStrictEqual(
    [asiaDown.status, asiaDown.backend, asiaDown.complete, asiaDown.done, asiaDown.hosts],
    [
      'ok',
      'turso-asia',
      true,
      ['cloudflare', 'turso-asia'],
      ['asia.example', 't.example', 'w.example'],
    ],
    'the next backup takes over',
  );
  const tursoDown = await comboRun('turso-asia', order, ['t.example']);
  assert.deepStrictEqual(
    [tursoDown.status, tursoDown.backend, tursoDown.complete, tursoDown.done],
    ['ok', 'supabase-asia', false, ['supabase-asia']],
    'always failed: stored by a backup, but not complete (the retry goes to turso-asia only)',
  );
  const allDown = await comboRun('turso-asia', order, [
    't.example',
    'asia.example',
    'w.example',
    's.example',
  ]);
  assert.deepStrictEqual([allDown.status, allDown.complete, allDown.done], ['failed', false, []]);
});

test('config combinations: no backups, turso as the first backup (always: null), always listed in order, a backend in neither list', async () => {
  const alone = await comboRun('turso-asia', []);
  assert.deepStrictEqual(
    [alone.status, alone.complete, alone.hosts, alone.readOrder],
    ['ok', true, ['t.example'], ['turso-asia']],
  );
  const asBackup = await comboRun(null, ['turso-asia', 'supabase-asia']);
  assert.deepStrictEqual(
    [asBackup.backend, asBackup.complete, asBackup.hosts],
    ['turso-asia', true, ['t.example']],
    'a backup chain writes to the first backend that answers only',
  );
  assert.deepStrictEqual(
    (await comboRun(null, ['turso-asia', 'supabase-asia'], ['t.example'])).hosts,
    ['asia.example', 't.example'],
  );
  assert.deepStrictEqual(
    backendsFromConfig(comboCfg('turso-asia', ['turso-asia', 'supabase-asia'])).chain.map(
      b => b.name,
    ),
    ['supabase-asia'],
    'always is never its own backup',
  );
  const readOnly = await comboRun('turso-asia', ['cloudflare']);
  assert.deepStrictEqual(
    [readOnly.hosts, readOnly.readOrder],
    [
      ['t.example', 'w.example'],
      ['turso-asia', 'cloudflare'],
    ],
    'supabase-asia and supabase are neither written nor part of the summary order',
  );
  assert.deepStrictEqual(
    backendsFromConfig(comboCfg('turso-asia', ['cloudflare'])).list.map(b => b.name),
    ['turso-asia', 'cloudflare', 'supabase-asia', 'supabase'],
    '...but the stats page and the seeder still use them',
  );
});

test('config combinations: an `always` backend without its key counts as not set (nothing is written to it, silently), the backups still work', async () => {
  const setup = backendsFromConfig(comboCfg('turso-asia', ['supabase-asia'], ''));
  assert.deepStrictEqual([setup.always, setup.chain.map(b => b.name)], [null, ['supabase-asia']]);
  const r = await comboRun('turso-asia', ['supabase-asia'], [], '');
  assert.deepStrictEqual([r.status, r.hosts, r.done], ['ok', ['asia.example'], ['supabase-asia']]);
});

const SUM = mean => ({ n: 3, mean, top: null, pct: 50 });

const OWED = { solved: true, time: 42.1, sent: false };

const ORDER = ['asia', 'cloudflare', 'supabase'];

test("afterSubmit: complete = the minimal record; incomplete keeps done / rounds / statsFrom; the always-written backend's summary wins", () => {
  assert.deepStrictEqual(
    afterSubmit(
      OWED,
      {
        status: 'ok',
        done: ['asia', 'cloudflare'],
        complete: true,
        backend: 'asia',
        summary: SUM(30),
      },
      ORDER,
    ),
    { solved: true, time: 42.1, sent: true, stats: SUM(30) },
  );
  const first = afterSubmit(
    OWED,
    {
      status: 'ok',
      done: ['cloudflare'],
      complete: false,
      backend: 'cloudflare',
      summary: SUM(40),
    },
    ORDER,
  );
  assert.deepStrictEqual(first, {
    solved: true,
    time: 42.1,
    sent: false,
    stats: SUM(40),
    statsFrom: 'cloudflare',
    done: ['cloudflare'],
    rounds: 1,
  });
  assert.deepStrictEqual(
    afterSubmit(
      first,
      {
        status: 'ok',
        done: ['cloudflare', 'asia'],
        complete: true,
        backend: 'asia',
        summary: SUM(30),
      },
      ORDER,
    ),
    { solved: true, time: 42.1, sent: true, stats: SUM(30) },
    "the retry of always replaces the backup's summary",
  );
  const kept = { ...OWED, stats: SUM(30), statsFrom: 'asia', done: ['asia'], rounds: 1 };
  assert.deepStrictEqual(
    afterSubmit(
      kept,
      {
        status: 'ok',
        done: ['asia', 'supabase'],
        complete: true,
        backend: 'supabase',
        summary: SUM(50),
      },
      ORDER,
    ).stats,
    SUM(30),
    "a later backup never replaces an earlier one's summary",
  );
});

test('afterSubmit: a backend that never answers is given up after MAX_ROUNDS rounds; offline (nothing stored) never counts', () => {
  assert.ok(MAX_ROUNDS >= 2, 'a first round that is not the last');
  let rec = afterSubmit(
    OWED,
    { status: 'ok', done: ['asia'], complete: false, backend: 'asia', summary: SUM(30) },
    ORDER,
  );
  assert.deepStrictEqual([rec.sent, rec.rounds], [false, 1]);
  for (let round = 2; round < MAX_ROUNDS; round++) {
    rec = afterSubmit(rec, { status: 'failed', done: ['asia'], complete: false }, ORDER);
    assert.deepStrictEqual([rec.sent, rec.rounds], [false, round]);
  }
  rec = afterSubmit(rec, { status: 'failed', done: ['asia'], complete: false }, ORDER);
  assert.deepStrictEqual(rec, { solved: true, time: 42.1, sent: true, stats: SUM(30) });
  let offline = OWED;
  for (let i = 0; i < 5; i++)
    offline = afterSubmit(offline, { status: 'failed', done: [], complete: false }, ORDER);
  assert.ok(offline === OWED, 'prev itself: nothing to save, retried on the next page load');
});

test('afterSubmit: rejected and skipped finish the record without a summary; a legacy pending record works', () => {
  assert.deepStrictEqual(
    afterSubmit(OWED, { status: 'rejected', done: ['asia'], complete: true }, ORDER),
    {
      solved: true,
      time: 42.1,
      sent: true,
      stats: null,
    },
  );
  assert.deepStrictEqual(afterSubmit(OWED, { status: 'skipped', done: [] }, ORDER), {
    solved: true,
    time: 42.1,
    sent: true,
    stats: null,
  });
  assert.deepStrictEqual(
    afterSubmit(
      OWED,
      {
        status: 'ok',
        done: ['supabase'],
        complete: true,
        backend: 'supabase',
        summary: SUM(50),
      },
      ORDER,
    ).stats,
    SUM(50),
    "no always-written backend: the backup's summary",
  );
});

test('stats-store: pending GOTD attempt is sent:false; saving stats persists and survives hydrate', async () => {
  const st = fakeStorage(),
    S = createStore(st, [5]);
  await S.hydrate('20260929');
  await S.recordGotd(5, '20260929', 42.1, true);
  assert.deepStrictEqual(S.attempt(), { solved: true, time: 42.1, sent: false });
  await S.saveAttempt('20260929', {
    solved: true,
    time: 42.1,
    sent: true,
    stats: { n: 3, mean: 30, top: null, pct: 50 },
  });
  const S2 = createStore(st, [5]);
  await S2.hydrate('20260929');
  assert.deepStrictEqual(S2.attempt(), {
    solved: true,
    time: 42.1,
    sent: true,
    stats: { n: 3, mean: 30, top: null, pct: 50 },
  });
  const S3 = createStore(fakeStorage(), [5]);
  await S3.hydrate('20260929');
  await S3.recordGotd(5, '20260929', 42.1);
  assert.deepStrictEqual(S3.attempt(), { solved: true, time: 42.1 });
});

// The share flow of the play app over several page loads: finish (record + first submit), then the retry of replay.unsent() at every boot.
const GOTD_DATE = '20260919';

const finishGotdWith = async (storage, routes) => {
  const store = createStore(storage, [5]);
  await store.hydrate(GOTD_DATE);
  await store.recordGotd(5, GOTD_DATE, 42.1, true);
  const { lb, calls } = three(routes);
  await submitAttempt(lb, store, GOTD_DATE);
  return { calls, record: await store.loadAttempt(GOTD_DATE) };
};

const reloadWith = async (storage, routes) => {
  const store = createStore(storage, [5]);
  await store.hydrate(GOTD_DATE);
  const replay = createReplay(storage, store, atDay(19));
  await replay.init();
  const { lb, calls } = three(routes);
  for (const { date } of await replay.unsent()) await submitAttempt(lb, store, date);
  return {
    calls: [...calls].sort(),
    record: await store.loadAttempt(GOTD_DATE),
    unsent: await replay.unsent(),
  };
};

test('share flow: backups that stay down are retried MAX_ROUNDS times, always is never written twice', async () => {
  const st = fakeStorage();
  const backupsDown = { ...ALL, 'w.example': down, 's.example': down };
  const first = await finishGotdWith(st, backupsDown);
  assert.deepStrictEqual([...first.calls].sort(), ['asia.example', 's.example', 'w.example']);
  assert.deepStrictEqual(first.record, {
    solved: true,
    time: 42.1,
    sent: false,
    stats: SUM(30),
    statsFrom: 'asia',
    done: ['asia'],
    rounds: 1,
  });
  const second = await reloadWith(st, backupsDown);
  assert.deepStrictEqual(
    [second.calls, second.record.rounds, second.record.sent],
    [['s.example', 'w.example'], 2, false],
  );
  const third = await reloadWith(st, backupsDown);
  assert.deepStrictEqual(
    [third.calls, third.record, third.unsent],
    [['s.example', 'w.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []],
  );
  assert.deepStrictEqual(
    (await reloadWith(st, backupsDown)).calls,
    [],
    'given up: nothing is sent any more',
  );
});

test('share flow: a backup that comes back completes the record without touching always', async () => {
  const st = fakeStorage();
  await finishGotdWith(st, { ...ALL, 'w.example': down, 's.example': down });
  const later = await reloadWith(st, ALL);
  assert.deepStrictEqual(
    [later.calls, later.record, later.unsent],
    [['w.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []],
  );
});

test("share flow: always was down: the backup's summary is shown, then replaced by always's on the retry", async () => {
  const st = fakeStorage();
  const first = await finishGotdWith(st, { ...ALL, 'asia.example': down });
  assert.deepStrictEqual(first.record, {
    solved: true,
    time: 42.1,
    sent: false,
    stats: SUM(40),
    statsFrom: 'cloudflare',
    done: ['cloudflare'],
    rounds: 1,
  });
  const later = await reloadWith(st, ALL);
  assert.deepStrictEqual(
    [later.calls, later.record, later.unsent],
    [['asia.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []],
  );
});

test('share flow: offline = nothing stored, every page load tries again without using up rounds', async () => {
  const st = fakeStorage();
  const offline = { 'asia.example': down, 'w.example': down, 's.example': down };
  assert.deepStrictEqual((await finishGotdWith(st, offline)).record, {
    solved: true,
    time: 42.1,
    sent: false,
  });
  for (let i = 0; i < 5; i++)
    assert.deepStrictEqual((await reloadWith(st, offline)).record, {
      solved: true,
      time: 42.1,
      sent: false,
    });
  const online = await reloadWith(st, ALL);
  assert.deepStrictEqual(
    [online.calls, online.record.sent, online.record.stats],
    [['asia.example', 'w.example'], true, SUM(30)],
  );
});
