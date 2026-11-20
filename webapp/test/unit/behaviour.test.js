// Unit tests of behaviour rows and their upload.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle } from '../../src/core/model.js';
import { serialize, parse } from '../../src/core/format.js';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { newTrace, traceTrack, traceEvents } from '../../src/features/playlog.js';
import {
  packPuzzle,
  unpackPuzzle,
  rowFromGame,
  validateRow,
  skillBucket,
  packS,
  unpackS,
  toWire,
  fromWire,
  toB64u,
  fromB64u,
  rowArgs,
  COLUMNS,
  COLUMN_NAMES,
  ROW_VERSION,
  UNKNOWN_SKILL,
  utcDay,
  packEv,
  unpackEv,
  describeRow,
  EV_MAX_EVENTS,
} from '../../src/core/behaviour.js';
import {
  createBehaviour,
  sinksFromConfig,
  QUEUE_KEY,
  ON_KEY,
  QUEUE_MAX,
  MAX_ROUNDS as BEHAVIOUR_ROUNDS,
} from '../../src/platform/behaviour.js';
import { BEHAVIOUR, LEADERBOARD } from '../../src/config.js';
import { solutionPath } from '../../src/core/trap.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { fakeStorage } from './helpers.js';

const BEH_TEXT =
  'size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4';

const BEH_CFG = { localSizes: [7, 11], hiddenMaxMs: 5000 };

const behGame = (extra = {}) => ({
  puzzle: parse(BEH_TEXT),
  mode: 'local',
  day: utcDay(),
  ms: 21000,
  hints: 0,
  hiddenMs: 0,
  undone: 12,
  maxUndone: 5,
  skill: 6,
  ...extra,
});

t.slow(
  'behaviour: the packed puzzle round-trips (generated 7x7 and 9x9, a rated one), is canonical and small',
  () => {
    for (const [n, seed] of [
      [7, 3],
      [9, 5],
    ]) {
      const p = runSync(generate(n, seed)),
        b = packPuzzle(p);
      ok(b instanceof Uint8Array && b.length <= 40, `size ${n}: ${b?.length} bytes`);
      eq(serialize(unpackPuzzle(b)), serialize(p), `size ${n}`);
      eq([...packPuzzle(unpackPuzzle(b))], [...b], 'equal puzzles are equal bytes');
      ok(serialize(p).length > 4 * b.length, 'the plain text is several times larger');
    }
    const p = parse(BEH_TEXT),
      b = packPuzzle(p);
    eq(b.length, 12);
    eq(serialize(unpackPuzzle(b)), serialize(p));
    eq([...fromB64u(toB64u(b))], [...b]);
    eq(fromB64u('a'), null);
    eq(fromB64u('a$b'), null);
    eq(fromB64u(''), new Uint8Array(0));
  },
);

t(
  'behaviour: unpackPuzzle refuses everything that is not exactly what packPuzzle writes; packPuzzle refuses what it cannot carry',
  () => {
    const b = packPuzzle(parse(BEH_TEXT));
    eq(unpackPuzzle(Uint8Array.of(...b, 0)), null, 'a trailing byte');
    eq(unpackPuzzle(b.slice(0, b.length - 1)), null, 'a missing byte');
    const dirty = b.slice();
    dirty[dirty.length - 1] |= 1;
    eq(unpackPuzzle(dirty), null, 'padding bits are zero');
    eq(unpackPuzzle(new Uint8Array(0)), null);
    eq(unpackPuzzle(null), null);
    eq(unpackPuzzle(Uint8Array.of(0, 0, 0, 0)), null, 'size 0');
    const same = parse(BEH_TEXT);
    same.cp[0] = 1;
    ok(packPuzzle(same) === null, 'duplicate number 1');
    const gap = parse(BEH_TEXT);
    gap.cp[parse(BEH_TEXT).cp.indexOf(9)] = 12;
    ok(packPuzzle(gap) === null, 'a gap in the numbering');
    ok(packPuzzle({ ...parse(BEH_TEXT), holes: new Uint8Array(49) }) === null, 'a Cutout puzzle');
    ok(packPuzzle(makePuzzle(7)) === null, 'no checkpoints');
    ok(packPuzzle(null) === null);
    for (let i = 0; i < 300; i++) {
      const junk = new Uint8Array(1 + (i % 40)).map(
        (_, k) => (i * 31 + k * 17 + (i >> 3) * k) & 255,
      );
      const q = unpackPuzzle(junk);
      ok(
        q === null || eq(packPuzzle(q) && [...packPuzzle(q)], [...junk]) === undefined,
        'junk is refused or canonical',
      );
    }
  },
);

t(
  'behaviour: validateRow checks every column, fills defaults, refuses unknown keys; the wire form round-trips',
  () => {
    const row = { day: utcDay(), ms: 4000, u: 1, deep: 1, s: 0, pz: null, ev: null, v: 0 };
    eq(validateRow(row), row);
    eq(
      validateRow({ day: utcDay(), ms: 4000 }),
      { ...row, u: null, deep: null, s: null },
      'a missing column is null, v defaults to 0',
    );
    for (const bad of [
      { ...row, x: 1 },
      { ...row, ms: 499 },
      { ...row, ms: 3600001 },
      { ...row, day: utcDay() - 92 },
      { ...row, day: utcDay() + 2 },
      { ...row, u: -1 },
      { ...row, s: 256 },
      { ...row, pz: new Uint8Array(3) },
      { ...row, pz: [1, 2, 3, 4] },
      { ...row, ev: new Uint8Array(65) },
      { ...row, v: 16 },
      { ...row, ms: null },
      { ...row, day: undefined },
      null,
      [],
      'x',
    ])
      eq(validateRow(bad), null, JSON.stringify(bad));
    ok(
      validateRow({ ...row, day: utcDay() - 91 }) && validateRow({ ...row, day: utcDay() + 1 }),
      'the replay window and tomorrow',
    );
    const full = { ...row, pz: packPuzzle(parse(BEH_TEXT)), ev: Uint8Array.of(1, 2) };
    eq(validateRow(fromWire(JSON.parse(JSON.stringify(toWire(full))))), full, 'through JSON');
    eq(fromWire({ ...toWire(full), pz: '!!' }), null);
    eq(rowArgs(full).length, COLUMNS.length);
    eq(rowArgs({ day: 1, ms: 2 }).slice(2), [null, null, null, null, null, null]);
    // compat pin: the wire format of the rows already uploaded
    eq(COLUMN_NAMES, ['day', 'ms', 'u', 'deep', 's', 'pz', 'ev', 'v']);
  },
);

t('playlog: wrong turns = the path against the solution, closed when taken back', () => {
  const sol = [0, 1, 2, 3, 4, 5, 6, 7, 8],
    tr = newTrace(),
    go = path => traceTrack(tr, path, sol);
  go([0]);
  go([0, 1, 2]);
  eq([tr.open, tr.events], [null, []], 'on the solution: nothing');
  go([0, 1, 2, 9]);
  eq(tr.open, { i: 3, d: 1 });
  go([0, 1, 2, 9, 10]);
  go([0, 1, 2, 9, 10, 11]);
  go([0, 1, 2, 9, 10]);
  eq(tr.open, { i: 3, d: 3 }, 'the deepest point is kept when it is partly taken back');
  go([0, 1, 2, 9]);
  go([0, 1, 2]);
  eq([tr.open, tr.events], [null, [[3, 3]]], 'taken back to step i: the wrong turn is over');
  go([0, 1, 5, 6, 7]);
  go([0, 1, 5]);
  go([0]);
  eq(
    tr.events,
    [
      [3, 3],
      [2, 3],
    ],
    'two wrong turns, in time order',
  );
  go([0, 1, 5, 6]);
  go([0, 1, 2, 8]);
  eq(
    [tr.events.at(-1), tr.open],
    [[2, 2], { i: 3, d: 1 }],
    'taking one back and leaving elsewhere in one move',
  );
  go([]);
  eq([tr.events.length, tr.open], [4, null], 'the reset closes it');
  go([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  eq(tr.events.length, 4, 'the solved path adds none');
  const tr2 = newTrace();
  traceTrack(tr2, [0, 4], sol);
  eq(traceEvents(tr2), [[1, 1]], 'a wrong turn still open when the game ends counts');
  eq(traceEvents(tr2), [[1, 1]], 'and only once');
  const tr3 = newTrace();
  traceTrack(tr3, [0, 4], null);
  eq([tr3.open, tr3.events], [null, []], 'without a solution nothing is tracked');
  const tr4 = newTrace();
  for (let k = 0; k < 40; k++) {
    traceTrack(tr4, [0, 4], sol);
    traceTrack(tr4, [0], sol);
  }
  eq(tr4.events.length, 31, 'at most 31 are kept');
  const tr5 = newTrace();
  traceTrack(tr5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], sol);
  eq(tr5.open, { i: 9, d: 1 }, 'a path longer than the solution has left it');
});

t(
  'behaviour: the s byte and the skill bucket (median ms per cell in half-octaves, unknown below 8 games, hints and unsolved ignored)',
  () => {
    for (const kind of ['local', 'gotd', 'replay']) {
      for (const sk of [0, 7, 15]) {
        eq(unpackS(packS(kind, sk)), { kind, skill: sk, hint: false, abandoned: false });
      }
    }
    eq(unpackS(packS('gotd', 3, { hint: true })), {
      kind: 'gotd',
      skill: 3,
      hint: true,
      abandoned: false,
    });
    eq(unpackS(packS('replay', 9, { abandoned: true, hint: true })), {
      kind: 'replay',
      skill: 9,
      hint: true,
      abandoned: true,
    });
    eq(
      packS('local', 5) & 0x3f,
      packS('local', 5, { hint: true, abandoned: true }) & 0x3f,
      'the flags are bits 6-7 only',
    );
    eq(unpackS(3), null);
    eq(unpackS(300), null);
    eq(unpackS(packS('gotd', 99)).skill, UNKNOWN_SKILL, 'out of range = unknown');
    const rec = (ms, extra = {}) => ({ n: 7, ms, solved: true, hints: 0, ...extra });
    eq(skillBucket([]), UNKNOWN_SKILL);
    eq(skillBucket(Array(7).fill(rec(49 * 60))), UNKNOWN_SKILL, 'seven games are too few');
    eq(skillBucket(Array(8).fill(rec(49 * 60))), 0, '60 ms per cell is the base');
    eq(skillBucket(Array(8).fill(rec(49 * 120))), 2);
    eq(skillBucket(Array(8).fill(rec(49 * 480))), 6);
    eq(skillBucket(Array(8).fill(rec(49 * 1e6))), 14, 'clamped');
    eq(
      skillBucket([
        ...Array(8).fill(rec(49 * 120)),
        rec(1, { solved: false }),
        rec(1, { hints: 1 }),
        null,
      ]),
      2,
      'unsolved, hinted and empty records do not count',
    );
    eq(
      skillBucket([...Array(40).fill(rec(49 * 960)), ...Array(30).fill(rec(49 * 120))]),
      2,
      'only the last 30 games',
    );
  },
);

t('behaviour: rowFromGame — which solved games become a row', () => {
  const row = rowFromGame(behGame(), BEH_CFG);
  eq(
    [row.day, row.ms, row.u, row.deep, row.v, row.ev, unpackS(row.s)],
    [
      utcDay(),
      21000,
      12,
      5,
      ROW_VERSION,
      null,
      { kind: 'local', skill: 6, hint: false, abandoned: false },
    ],
  );
  eq(
    serialize(unpackPuzzle(row.pz)),
    serialize(parse(BEH_TEXT)),
    'a local row carries its puzzle',
  );
  const gotd = rowFromGame(behGame({ mode: 'gotd' }), BEH_CFG);
  eq([gotd.pz, unpackS(gotd.s).kind], [null, 'gotd']);
  eq(unpackS(rowFromGame(behGame({ mode: 'replay' }), BEH_CFG).s).kind, 'replay');
  eq(
    rowFromGame(behGame({ mode: 'gotd', puzzle: makeSized(5) }), BEH_CFG) !== null,
    true,
    'a Game of Day is logged at every size',
  );
  for (const [why, g] of [
    ['a long time in a hidden tab', { hiddenMs: 5001 }],
    ['a variant', { variant: 'cutout' }],
    ['a shared local game', { shared: true }],
    ['a repeat of a known Game of Day', { known: true, mode: 'gotd' }],
    ['size 6', { puzzle: makeSized(6) }],
    ['size 12', { puzzle: makeSized(12) }],
    ['a puzzle with holes', { puzzle: { ...parse(BEH_TEXT), holes: new Uint8Array(49) } }],
    ['under 500 ms', { ms: 400 }],
    ['over an hour', { ms: 3600001 }],
    ['an unknown mode', { mode: 'x' }],
    ['a day outside the window', { day: utcDay() - 500 }],
  ])
    eq(rowFromGame(behGame(g), BEH_CFG), null, why);
  eq(
    rowFromGame(behGame({ hiddenMs: 5000 }), BEH_CFG) !== null,
    true,
    'exactly the limit is still fine',
  );
  eq(
    rowFromGame(behGame({ undone: 1e9, maxUndone: 70000 }), BEH_CFG).u,
    65535,
    'counts are capped',
  );
  eq(
    rowFromGame(behGame({ puzzle: makeSized(7, 7) }), { ...BEH_CFG, localSizes: [8, 9] }),
    null,
    'localSizes comes from the config',
  );
  eq(rowFromGame(null, BEH_CFG), null);
});

t('behaviour: hint and abandoned games are rows with a flag; the wrong turns travel in ev', () => {
  // compat pin: the wire format of the rows already uploaded
  eq(ROW_VERSION, 1, 'version 1: per-kind skill, s bits 6-7, ev');
  const hint = rowFromGame(behGame({ hints: 2 }), BEH_CFG),
    gone = rowFromGame(behGame({ abandoned: true, ms: 9000 }), BEH_CFG);
  eq(
    [unpackS(hint.s).hint, unpackS(hint.s).abandoned, hint.ms],
    [true, false, 21000],
    'a hint game: flagged, raw time',
  );
  eq(
    [unpackS(gone.s).hint, unpackS(gone.s).abandoned, gone.ms],
    [false, true, 9000],
    'an abandoned game: flagged, time until it was left',
  );
  eq(
    rowFromGame(behGame({ abandoned: true, hiddenMs: 5001 }), BEH_CFG),
    null,
    'an abandoned game with a long hidden time is not sent either',
  );
  eq(
    rowFromGame(behGame({ abandoned: true, mode: 'gotd', known: true }), BEH_CFG),
    null,
    'nor a repeat of a known Game of Day',
  );
  eq(rowFromGame(behGame(), BEH_CFG).ev, null, 'no wrong-turn tracking: ev is null');
  eq(
    [...rowFromGame(behGame({ events: [] }), BEH_CFG).ev],
    [1],
    'no wrong turn: the version byte alone',
  );
  const row = rowFromGame(
    behGame({
      events: [
        [3, 2],
        [10, 40],
      ],
    }),
    BEH_CFG,
  );
  eq([...row.ev], [1, 3, 2, 10, 40]);
  eq(validateRow(row) !== null, true);
  eq(describeRow(row), {
    kind: 'local',
    skill: 6,
    hint: false,
    abandoned: false,
    events: [
      [3, 2],
      [10, 40],
    ],
    puzzle: unpackPuzzle(row.pz),
  });
});

t('behaviour: packEv / unpackEv: a version byte, 2 bytes per wrong turn, at most 31', () => {
  eq([...packEv([])], [1]);
  eq(packEv(null), null);
  eq(packEv(undefined), null);
  eq(
    [
      ...packEv([
        [300, 0],
        [-4, 999],
      ]),
    ],
    [1, 255, 1, 0, 255],
    'clamped to a byte; a wrong turn is at least 1 cell deep',
  );
  const many = packEv(Array.from({ length: 50 }, (_, i) => [i, i + 1]));
  eq(
    [many.length, EV_MAX_EVENTS],
    [63, 31],
    'at most 31 wrong turns: 63 bytes, inside the 64 of the column',
  );
  eq(unpackEv(many).length, 31);
  eq(unpackEv(packEv([[7, 3]])), [[7, 3]]);
  eq(unpackEv(packEv([])), []);
  const bads = [
    null,
    [1, 2],
    Uint8Array.of(2),
    Uint8Array.of(1, 5),
    Uint8Array.of(1, 1, 1, 1, 1, 1),
  ];
  bads.push(new Uint8Array(66).fill(1));
  for (const bad of bads) {
    const bytes = Array.isArray(bad) ? Uint8Array.from(bad) : bad;
    eq(unpackEv(bytes), null, 'not this layout: ' + bad);
  }
});

t('behaviour: a wrong turn on a real puzzle: path -> trace -> row -> describeRow', () => {
  const p = parse(BEH_TEXT),
    sol = solutionPath(p),
    n = p.n;
  ok(sol && sol.length === n * n, 'the test puzzle has a solution');
  const wrong = [sol[3] + 1, sol[3] - 1, sol[3] + n, sol[3] - n].find(
    c => c >= 0 && c < n * n && !sol.slice(0, 5).includes(c),
  );
  const tr = newTrace(),
    go = path => traceTrack(tr, path, sol);
  go(sol.slice(0, 4));
  go([...sol.slice(0, 4), wrong]);
  go(sol.slice(0, 4));
  go(sol);
  const row = rowFromGame(behGame({ puzzle: p, events: traceEvents(tr) }), BEH_CFG);
  eq(describeRow(row).events, [[4, 1]], 'left the solution at step 4, one cell deep');
  eq(
    describeRow({ ...row, ev: fromB64u(toB64u(row.ev)) }).events,
    [[4, 1]],
    'through the wire form',
  );
});

t('behaviour: the skill bucket counts one kind of game (local vs Game of Day + replay)', () => {
  const rec = (ms, mode) => ({ n: 7, ms, solved: true, hints: 0, mode });
  const mixed = [
    ...Array(8).fill(rec(49 * 120, 'local')),
    ...Array(8).fill(rec(49 * 960, 'gotd')),
  ];
  eq(skillBucket(mixed, 'local'), 2);
  eq(skillBucket(mixed, 'gotd'), 8);
  eq(skillBucket(mixed, 'replay'), 8, 'a replay counts with the Game of Day');
  eq(skillBucket(mixed.slice(0, 12), 'gotd'), UNKNOWN_SKILL, 'fewer than 8 games of that kind');
  eq(skillBucket(mixed), 6, 'no kind: all games (the median of both kinds), as in version 0');
  eq(
    skillBucket(Array(8).fill({ n: 7, ms: 49 * 120, solved: true, hints: 0 }), 'local'),
    2,
    'a record without a mode is a local game',
  );
});

// a size-n puzzle with two checkpoints, enough for the gating tests
function makeSized(n) {
  const p = makePuzzle(n);
  p.cp[0] = 1;
  p.cp[n * n - 1] = 2;
  return p;
}

t(
  'behaviour: the config — only Turso and Cloudflare backends, sizes as asked, and a switch',
  () => {
    eq(typeof BEHAVIOUR.enabled, 'boolean');
    eq(BEHAVIOUR.localSizes, [7, 11]);
    const sinks = sinksFromConfig(BEHAVIOUR, LEADERBOARD);
    eq(
      sinks.map(s => s.name),
      [BEHAVIOUR.primary, BEHAVIOUR.backup],
    );
    const lb = {
      backends: {
        a: { type: 'turso', url: 'https://x', key: 'k' },
        b: { type: 'supabase', url: 'https://y', key: 'k' },
        c: { type: 'cloudflare', url: 'https://z' },
        d: { type: 'turso', url: 'https://x' },
      },
    };
    eq(
      sinksFromConfig({ primary: 'a', backup: 'b' }, lb).map(s => s.name),
      ['a'],
      'Supabase never receives behaviour rows',
    );
    eq(
      sinksFromConfig({ primary: 'd', backup: 'c' }, lb).map(s => s.name),
      ['c'],
      'a Turso entry without its token is left out',
    );
    eq(
      sinksFromConfig({ primary: 'c', backup: 'c' }, lb).map(s => s.name),
      ['c'],
    );
    eq(sinksFromConfig({ primary: 'nope', backup: 'zzz' }, lb), []);
  },
);

// a fetch that answers like the two backends; `plan` is a list of per-call answers: 'ok' | 'invalid' | 'down' | 'hang' (any call after the plan = ok)
const behFetch = (plan = []) => {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const a = plan[i++] || 'ok';
    calls.push({ url, body: init.body, a });
    if (a === 'down') throw new Error('network');
    if (a === 'hang')
      return new Promise((_, rej) =>
        init.signal.addEventListener('abort', () => rej(new Error('aborted'))),
      );
    if (url.endsWith('/play'))
      return { status: a === 'invalid' ? 400 : 200, json: async () => ({}) };
    return {
      status: 200,
      json: async () => ({
        results: [
          a === 'invalid'
            ? { type: 'error', error: { message: 'SQLite error: invalid' } }
            : { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [] } } },
          { type: 'close' },
        ],
      }),
    };
  };
  fn.calls = calls;
  return fn;
};

const behSinks = () =>
  sinksFromConfig(
    { primary: 'turso-asia', backup: 'cloudflare' },
    {
      backends: {
        'turso-asia': { type: 'turso', url: 'https://t.example', key: 'tok' },
        cloudflare: { type: 'cloudflare', url: 'https://c.example' },
      },
    },
  );

const behRow = () => rowFromGame(behGame(), BEH_CFG);

const behUp = (extra = {}, plan) => {
  const st = fakeStorage(),
    f = behFetch(plan),
    cfg = { enabled: true, defaultOn: true, ...extra };
  return {
    st,
    f,
    up: createBehaviour({ storage: st, cfg, sinks: behSinks(), fetchFn: f, timeoutMs: 50 }),
  };
};

ta(
  'behaviour upload: a row goes to the primary only, with the puzzle as a blob and nothing that identifies the player',
  async () => {
    const { f, up } = behUp();
    eq(await up.enqueue(behRow()), true);
    eq(f.calls.length, 1);
    ok(f.calls[0].url === 'https://t.example/v2/pipeline', f.calls[0].url);
    const sent = JSON.parse(f.calls[0].body).requests[0].stmt;
    ok(/^INSERT INTO play \(day, ms, u, deep, s, pz, ev, v\) VALUES/.test(sent.sql));
    eq(
      sent.args.map(a => a.type),
      ['integer', 'integer', 'integer', 'integer', 'integer', 'blob', 'null', 'integer'],
    );
    eq(
      fromB64u(sent.args[5].base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''))
        .length,
      12,
    );
    eq(await up.pending(), 0, 'stored: off the queue');
    ok(!/uid|device|player|user/i.test(f.calls[0].body));
  },
);

ta(
  'behaviour upload: the backup is tried only when the primary does not answer; a rejection is final; Cloudflare gets JSON',
  async () => {
    let { f, up } = behUp({}, ['down']);
    await up.enqueue(behRow());
    eq(
      f.calls.map(c => c.url),
      ['https://t.example/v2/pipeline', 'https://c.example/play'],
    );
    eq(await up.pending(), 0);
    const w = JSON.parse(f.calls[1].body);
    eq(
      [w.day, w.ms, w.u, w.v, typeof w.pz, w.ev],
      [utcDay(), 21000, 12, ROW_VERSION, 'string', null],
    );
    eq(validateRow(fromWire(w)).ms, 21000);
    ({ f, up } = behUp({}, ['invalid']));
    await up.enqueue(behRow());
    eq(f.calls.length, 1, 'rejected by the primary: no backup, no retry');
    eq(await up.pending(), 0);
    ({ f, up } = behUp({}, ['hang', 'invalid']));
    await up.enqueue(behRow());
    eq(
      f.calls.map(c => c.a),
      ['hang', 'invalid'],
      'a timeout counts as not answering',
    );
    eq(await up.pending(), 0);
  },
);

ta(
  'behaviour upload: a row nobody takes is kept for the next page loads, three in all, then dropped; one page load is one round',
  async () => {
    const st = fakeStorage(),
      cfg = { enabled: true, defaultOn: true },
      mk = () =>
        createBehaviour({
          storage: st,
          cfg,
          sinks: behSinks(),
          fetchFn: behFetch(['down', 'down', 'down', 'down', 'down', 'down', 'down', 'down']),
          timeoutMs: 50,
        });
    let up = mk();
    await up.enqueue(behRow());
    eq(await up.pending(), 1, 'round 1 failed');
    await up.flush();
    await up.flush();
    eq(await up.pending(), 1, 'more flushes in the same page load are not new rounds');
    for (let round = 2; round < BEHAVIOUR_ROUNDS; round++) {
      up = mk();
      await up.flush();
      eq(await up.pending(), 1, `round ${round} (a new page load)`);
    }
    up = mk();
    await up.flush();
    eq(await up.pending(), 0, 'the last round: dropped');
    const stored = JSON.parse((await st.get(QUEUE_KEY)).value);
    eq(stored, []);
  },
);

ta(
  'behaviour upload: the queue survives a reload (rows as JSON), a corrupt or hostile value, and is capped',
  async () => {
    const st = fakeStorage();
    let up = createBehaviour({
      storage: st,
      cfg: { enabled: true, defaultOn: true },
      sinks: behSinks(),
      fetchFn: behFetch(Array(2000).fill('down')),
      timeoutMs: 50,
    });
    for (let i = 0; i < QUEUE_MAX + 5; i++) await up.enqueue({ ...behRow(), ms: 1000 + i });
    eq(await up.pending(), QUEUE_MAX, 'capped; the oldest go first');
    const f = behFetch();
    up = createBehaviour({
      storage: st,
      cfg: { enabled: true, defaultOn: true },
      sinks: behSinks(),
      fetchFn: f,
      timeoutMs: 50,
    });
    const r = await up.flush();
    eq([r.sent, r.pending, f.calls.length], [QUEUE_MAX, 0, QUEUE_MAX]);
    eq(
      JSON.parse(f.calls[0].body).requests[0].stmt.args[1].value,
      '1005',
      'the five oldest were dropped',
    );
    for (const junk of [
      'not json',
      '{}',
      '[1,"x",null,{"row":{"ms":5}},{"row":{"day":1,"ms":1000}}]',
    ]) {
      await st.set(QUEUE_KEY, junk);
      const g = behFetch();
      const u2 = createBehaviour({
        storage: st,
        cfg: { enabled: true, defaultOn: true },
        sinks: behSinks(),
        fetchFn: g,
        timeoutMs: 50,
      });
      eq((await u2.flush()).sent, 0, junk.slice(0, 20));
      eq(g.calls.length, 0, 'invalid stored rows are never sent');
    }
  },
);

ta(
  'behaviour upload: the switches — config.enabled, the device setting (default, on, off), and the queue is thrown away when it goes off',
  async () => {
    let { f, up } = behUp({ enabled: false });
    eq(await up.isOn(), false);
    eq(await up.enqueue(behRow()), false);
    eq(f.calls.length, 0, 'enabled: false sends nothing');
    ({ f, up } = behUp({ defaultOn: false }));
    eq(await up.isOn(), false);
    eq(await up.enqueue(behRow()), false);
    eq(f.calls.length, 0);
    await up.setOn(true);
    eq(await up.isOn(), true);
    eq(await up.enqueue(behRow()), true);
    eq(f.calls.length, 1);
    ({ f, up } = behUp({}, Array(10).fill('down')));
    await up.enqueue(behRow());
    eq(await up.pending(), 1);
    await up.setOn(false);
    eq([await up.isOn(), await up.pending()], [false, 0], 'off empties the queue');
    await up.flush();
    eq(f.calls.length, 2, 'and nothing more is sent');
    const st = fakeStorage();
    await st.set(QUEUE_KEY, JSON.stringify([{ row: toWire(behRow()), rounds: 0 }]));
    const g = behFetch();
    const off = createBehaviour({
      storage: st,
      cfg: { enabled: false, defaultOn: true },
      sinks: behSinks(),
      fetchFn: g,
      timeoutMs: 50,
    });
    await off.flush();
    eq(
      [g.calls.length, JSON.parse((await st.get(QUEUE_KEY)).value)],
      [0, []],
      'a queue left from an earlier run is discarded when the flag is off',
    );
    eq(ON_KEY, 'zip_behaviour_on'); // compat pin: the stored choice of the player
  },
);

registerAsyncTests();
