// Tests of the Teleport puzzle (pairs of portal cells): the core (data, plain-text format, moves,
// edge ids, the symmetry key of duplicates, and the solver checked against a plain brute-force
// search under every pruning option), the generator (gen/portals.js, gen/teleport.js and the
// Teleport options of gen/generate.js, checkpoints and walls, also as the design app uses them)
// and the variant in the play app: the portals and the jump on the board, the icon, the registry
// entry, the share code and record, the grade, a whole game, the lucky game, and what the design
// app draws.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import { makePuzzle, clonePuzzle, validate, cellCount, maxNumber } from '../../src/core/model.js';
import { isSolved, step, canStep } from '../../src/core/rules.js';
import { serialize, parse } from '../../src/core/format.js';
import { solve } from '../../src/core/solver/solve.js';
import { buildNeighbors, forcedEdges } from '../../src/core/solver/prune.js';
import { allEdges, setWallId, pathEdgeIds, portalEdgeId, edgeId } from '../../src/core/edges.js';
import {
  graphDistances,
  gridDist,
  portalsBipartite,
  portalPartner,
  isPortalPair,
  neighbourCell,
  adjacent,
} from '../../src/core/geom.js';
import { symmetryKey, transformPuzzle, ratingKey } from '../../src/core/ratings-io.js';
import { boardConnectivity, boardPropagation } from '../../src/core/connectivity.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { gridMoves, oracle } from '../oracle.js';
import { runSync } from '../../src/core/run.js';
import {
  generate,
  generateUnique,
  randomPathPuzzle,
  PLAY_SIZES,
} from '../../src/core/gen/generate.js';
import { generateTeleport, TELEPORT_SIZES } from '../../src/core/gen/teleport.js';
import {
  pairCount,
  pickPortals,
  teleportPath,
  usesEveryPortal,
  maxPortalPairs,
  PORTAL_MIN_DIST,
  teleportCheckpointRules,
} from '../../src/core/gen/portals.js';
import { gapCheckpoints } from '../../src/core/gen/checkpoints.js';
import { trapProfile } from '../../src/core/trap.js';
import { boardSvg, routeD, jumpMarksSvg, portalIconsSvg } from '../../src/apps/play/board.js';
import { createUnlock } from '../../src/features/unlock.js';
import { luckyDefs } from '../../src/apps/play/variants.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import {
  encodeShare,
  decodeShare,
  VARIANTS,
  SHARE_VERSION_PORTAL,
  TELEPORT,
} from '../../src/core/share-code.js';
import { makeShareRecord } from '../../src/features/share.js';
import { portalD, miniPreviewSvg } from '../../src/apps/design/board.js';
import {
  portalColor,
  portalShape,
  PORTAL_COLORS,
  PORTAL_SHAPES,
} from '../../src/view/portal-icons.js';
import { ladder } from '../../src/core/ladder.js';
import { made } from '../fixtures/made.js';

// ---- the core: data, format, rules, solver

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A Teleport puzzle: `numbers` = { cell: number }, `portals` = [[a, b], ...].
function teleportPuzzle(n, numbers, portals) {
  const p = makePuzzle(n);
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  p.portals = portals.map(pair => pair.slice());
  return p;
}

// Every solution of p by plain depth-first search over the grid and the portal edges, with no
// pruning at all (test/oracle.js): the paths (as cell lists) that start on 1, visit the numbers in
// order, end on the highest and cover every cell.
const brutePaths = p => oracle(p, { moves: gridMoves(p) }).paths;

// A random Hamiltonian path of the grid plus the portal edges: depth-first search in random order,
// retried on a budget (null when none was found).
function portalPath(n, portals, rnd) {
  const T = n * n;
  for (let attempt = 0; attempt < 300; attempt++) {
    const vis = new Uint8Array(T);
    const path = [];
    let budget = 3000;
    const go = cell => {
      path.push(cell);
      vis[cell] = 1;
      if (path.length === T) return true;
      if (--budget >= 0) {
        const open = [0, 1, 2, 3].map(d => neighbourCell(n, false, cell, d));
        const partner = portalPartner(portals, cell);
        if (partner >= 0) open.push(partner);
        for (const v of shuffle(
          open.filter(c => c >= 0 && !vis[c]),
          rnd,
        ))
          if (go(v)) return true;
      }
      path.pop();
      vis[cell] = 0;
      return false;
    };
    if (go(Math.floor(rnd() * T))) return path;
  }
  return null;
}

// A random board with portals that its own path solves: pairs first (odd distance when `odd`),
// then a
// path over grid and portals, K numbers along it, then walls on a share of the edges the path does
// not use. Brute force then finds at least that path.
const randomTeleport = (seed, n, K, wallFraction, pairs, odd) => {
  const rnd = makeRng(seed);
  const T = n * n;
  const portals = [];
  const used = new Set();
  for (let guess = 0; guess < 300 && portals.length < pairs; guess++) {
    const a = Math.floor(rnd() * T);
    const b = Math.floor(rnd() * T);
    const far = gridDist(n, false, a, b);
    if (a === b || used.has(a) || used.has(b) || far < 2 || (odd && far % 2 === 0)) continue;
    used.add(a);
    used.add(b);
    portals.push([a, b]);
  }
  const path = portalPath(n, portals, rnd);
  if (!path) return null;
  const p = makePuzzle(n);
  const free = path.map((_cell, i) => i).filter(i => i > 0 && i < T - 1 && !used.has(path[i]));
  const inner = shuffle(free, rnd)
    .slice(0, Math.max(0, K - 2))
    .sort((x, y) => x - y);
  [0, ...inner, T - 1].forEach((at, i) => {
    p.cp[path[at]] = i + 1;
  });
  p.portals = portals;
  const onPath = new Set(pathEdgeIds(n, path, false, false, portals));
  allEdges(n).forEach(e => {
    if (!onPath.has(e) && rnd() < wallFraction) setWallId(p.walls, e, true);
  });
  return p;
};

test(
  'teleport: neighbour table has the portal in slots 4 and 5, and none without portals',
  FAST,
  () => {
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[2, 13]]);
    const { nb, W } = buildNeighbors(p);
    assert.deepStrictEqual(W, 6);
    assert.deepStrictEqual(nb[2 * 6 + 4], 13);
    assert.deepStrictEqual(nb[13 * 6 + 5], 2);
    assert.deepStrictEqual(nb[2 * 6 + 5], -1);
    assert.deepStrictEqual(nb[13 * 6 + 4], -1);
    // d ^ 1 gives the same edge from the other end
    assert.deepStrictEqual(nb[nb[2 * 6 + 4] * 6 + (4 ^ 1)], 2);
    const plain = buildNeighbors(makePuzzle(4));
    assert.deepStrictEqual(plain.W, 4);
    assert.deepStrictEqual(plain.nb.length, 16 * 4);
  },
);

test(
  'teleport: a wall never stands on a portal edge (the neighbour ' +
    'exists whatever the walls are)',
  FAST,
  () => {
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
    for (const e of allEdges(4)) setWallId(p.walls, e, true);
    const { nb } = buildNeighbors(p);
    assert.deepStrictEqual(nb[1 * 6 + 4], 14);
    assert.ok(canStep(p, 1, 14) && canStep(p, 14, 1));
    assert.ok(!canStep(p, 1, 2) && !canStep(p, 0, 1));
  },
);

test(
  'teleport: graph distances use the portals; parity rule only for odd-distance pairs',
  FAST,
  () => {
    const d = graphDistances(5, false, [[0, 24]]);
    assert.deepStrictEqual(d[0 * 25 + 24], 1);
    assert.deepStrictEqual(d[1 * 25 + 24], 2);
    assert.deepStrictEqual(d[0 * 25 + 23], 2);
    assert.deepStrictEqual(graphDistances(5, false, null)[0 * 25 + 24], 8, 'no portal: Manhattan');
    assert.ok(portalsBipartite(5, null));
    assert.ok(portalsBipartite(5, [[0, 3]]), 'distance 3 is odd');
    assert.ok(!portalsBipartite(5, [[0, 24]]), 'distance 8 is even');
    assert.ok(
      !portalsBipartite(5, [
        [0, 3],
        [0 + 5, 5 + 2],
      ]),
      'one even pair is enough',
    );
    assert.deepStrictEqual(portalPartner([[3, 9]], 9), 3);
    assert.deepStrictEqual(portalPartner([[3, 9]], 4), -1);
    assert.ok(isPortalPair([[3, 9]], 9, 3));
  },
);

test(
  'teleport: validate — a portal pair needs two free, non-adjacent ' +
    'cells, no checkpoint, no other variant',
  FAST,
  () => {
    const good = teleportPuzzle(5, { 0: 1, 24: 2 }, [[2, 17]]);
    assert.ok(validate(good).ok);
    const bad = portals => ({ ...good, portals });
    const bads = [
      [],
      [[2, 2]],
      [[2, 3]],
      [[2, 7]],
      [[0, 17]],
      [
        [2, 17],
        [17, 20],
      ],
      [[2, 99]],
      [[2]],
    ];
    for (const portals of bads) {
      assert.ok(!validate(bad(portals)).ok, 'should be invalid: ' + JSON.stringify(portals));
    }
    assert.ok(!validate({ ...good, wrap: true }).ok);
    assert.ok(!validate({ ...good, exact: true }).ok);
    assert.ok(!validate({ ...good, holes: new Uint8Array(25) }).ok);
    const copy = clonePuzzle(good);
    copy.portals[0][0] = 4;
    assert.deepStrictEqual(good.portals, [[2, 17]], 'clonePuzzle copies the pairs');
  },
);

test('teleport: format — round trip, canonical order, errors, path over a portal', FAST, () => {
  const text = 'size 6\ncheckpoints 0,0=1 5,5=2\nwalls V,0,0\nportals 4,4~1,1 0,3~3,0';
  const p = parse(text);
  assert.deepStrictEqual(p.portals, [
    [3, 18],
    [7, 28],
  ]);
  const out = serialize(p);
  assert.ok(
    out.includes('\nportals 0,3~3,0 1,1~4,4'),
    'canonical: lower cell first, pairs by lower cell',
  );
  assert.deepStrictEqual(serialize(parse(out)), out);
  assert.deepStrictEqual(
    ratingKey(text),
    ratingKey('size 6\ncheckpoints 5,5=2 0,0=1\nwalls V,0,0\nportals 1,1~4,4 3,0~0,3'),
  );
  assert.ok(
    !serialize(parse('size 4\ncheckpoints 0,0=1')).includes('portals'),
    'no portals line without pairs',
  );
  for (const bad of [
    'size 5\nportals 0,0',
    'size 5\nportals 0,0~0,0',
    'size 5\nportals 0,0~0,1',
    'size 5\nportals 0,0~9,9',
    'size 5\nportals 0,0~2,2 2,2~3,3',
    'size 5\nwrap\nportals 0,0~2,2',
    'size 5\nexact\nportals 0,0~2,2',
    'size 5\nholes 4,4\nportals 0,0~2,2',
    'size 5\nportals 0,0~2,2 x',
  ])
    assert.ok(
      threw(() => parse(bad)),
      'should reject: ' + bad,
    );
  const withPath = parse('size 4\ncheckpoints 0,0=1\nportals 0,1~3,1\npath 0,0 0,1 3,1');
  assert.deepStrictEqual(withPath.path, [0, 1, 13]);
  assert.ok(
    threw(() => parse('size 4\nportals 0,1~3,1\npath 0,0 3,1')),
    'a path may jump only over a portal pair',
  );
});

test(
  'teleport: moves — step() jumps over a pair, undo works, isSolved ' + 'counts a jump as a step',
  FAST,
  () => {
    // 3 x 3 board, portal between (0,1) and (2,0)
    const p = teleportPuzzle(3, { 0: 1, 8: 2 }, [[1, 6]]);
    assert.ok(validate(p).ok);
    const path = [];
    assert.deepStrictEqual(step(p, path, 0), 'push');
    assert.deepStrictEqual(step(p, path, 1), 'push');
    assert.deepStrictEqual(step(p, path, 6), 'push', 'jump from 1 to its partner');
    assert.deepStrictEqual(path, [0, 1, 6]);
    assert.deepStrictEqual(step(p, path, 1), 'pop', 'going back undoes the jump');
    assert.deepStrictEqual(path, [0, 1]);
    assert.deepStrictEqual(step(p, path, 7), null, 'no jump from a cell without a portal');
    const found = solve(p, { limit: 99, capture: true, prop: true }).paths;
    assert.deepStrictEqual(found.map(String).sort(), brutePaths(p).map(String).sort());
    const jumps = route => route.some((c, i) => i && isPortalPair(p.portals, route[i - 1], c));
    const jumping = found.filter(jumps);
    assert.ok(jumping.length > 0, 'a solution uses the jump');
    assert.ok(jumping.every(path2 => isSolved(p, path2)));
    assert.ok(
      found.length > jumping.length,
      'and the plain snakes are solutions too (no portal is forced here)',
    );
    assert.ok(!isSolved(p, jumping[0].slice(0, -1)), 'one cell short');
  },
);

test('teleport: pathEdgeIds gives a portal step an id beyond every grid edge', FAST, () => {
  const portals = [
    [0, 13],
    [3, 6],
  ];
  const ids = pathEdgeIds(4, [1, 0, 13, 12], false, false, portals);
  assert.deepStrictEqual(ids, [edgeId(4, 1, 0), portalEdgeId(4, 0), edgeId(4, 13, 12)]);
  assert.ok(portalEdgeId(4, 0) >= 2 * 16);
  assert.deepStrictEqual(pathEdgeIds(4, [6, 3], false, false, portals), [portalEdgeId(4, 1)]);
  assert.ok(
    threw(() => pathEdgeIds(4, [0, 13], false, false, null)),
    'without the pairs a jump is not an edge',
  );
});

test(
  'teleport: a puzzle that differs only by its portals is not a ' +
    'duplicate of the plain one (symmetry key)',
  FAST,
  () => {
    const a = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls\nportals 0,2~3,0');
    const b = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls');
    assert.ok(symmetryKey(a) !== symmetryKey(b));
    // the mirror image of a is the same puzzle up to symmetry
    const m = transformPuzzle(a, 4, false);
    assert.deepStrictEqual(symmetryKey(m), symmetryKey(a));
    assert.ok(m.portals && m.portals.length === 1);
    const other = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls\nportals 0,2~3,1');
    assert.ok(symmetryKey(other) !== symmetryKey(a));
  },
);

test(
  'teleport: the solver matches a plain brute-force search under every ' +
    'pruning option (random boards)',
  SLOW,
  () => {
    const OPTIONS = [
      {},
      { prop: true },
      { prop: true, incr: false },
      { prop: true, incr: false, fast: false },
      { prop: true, parity: true },
      { prop: true, pocket: true },
      { prop: true, seg: true },
      { prop: true, seg: 'all', legCollide: true },
      { prop: true, prune2: true },
      { prop: true, parity: true, pocket: true, seg: 'all', prune2: true, legCollide: true },
      { lconn: false },
      { prop: true, lconn: true },
    ];
    let boards = 0;
    let withSolutions = 0;
    for (let seed = 1; seed <= 90; seed++) {
      const n = seed % 3 === 0 ? 5 : 4;
      // odd-distance pairs keep the parity rule on, even ones switch it off
      const odd = seed % 2 === 0;
      const walls = seed % 4 === 0 ? 0.05 : 0.18;
      const p = randomTeleport(seed, n, 2 + (seed % 3), walls, 1 + (seed % 3 === 1 ? 1 : 0), odd);
      if (!p?.portals.length || !validate(p).ok) continue;
      const want = brutePaths(p).map(String).sort();
      boards++;
      if (want.length) withSolutions++;
      for (const opts of OPTIONS) {
        const got = solve(p, { limit: 1e6, nodeCap: 5e6, capture: true, ...opts });
        assert.ok(!got.exceeded, 'node cap');
        assert.deepStrictEqual(
          got.paths.map(String).sort(),
          want,
          `seed ${seed} n ${n} ${JSON.stringify(opts)}\n${serialize(p)}`,
        );
      }
    }
    assert.ok(
      boards >= 60 && withSolutions === boards,
      `boards ${boards}, with a solution ${withSolutions}`,
    );
  },
);

test(
  'teleport: a region joined only by a portal still counts as ' +
    'connected (overlay and propagation)',
  FAST,
  () => {
    // 4 x 4, walls cut the board into two halves (rows 0-1 and rows 2-3); the portal is the only
    // way across
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
    for (let c = 0; c < 4; c++) setWallId(p.walls, edgeId(4, 4 + c, 8 + c), true);
    const solutions = brutePaths(p);
    assert.ok(solutions.length > 0, 'solvable through the portal');
    for (const opts of [{}, { prop: true }, { prop: true, parity: true, pocket: true }]) {
      assert.deepStrictEqual(
        solve(p, { limit: 1e5, ...opts }).count,
        solutions.length,
        JSON.stringify(opts),
      );
    }
    // after one step the free region is still one piece, thanks to the portal
    const conn = boardConnectivity(p, [0]);
    assert.ok(conn.connOk, 'overlay: reachable across the portal');
    assert.deepStrictEqual(conn.unreachable.size, 0);
    const prop = boardPropagation(p, [0]);
    assert.ok(!prop.infeasible);
  },
);

test(
  'teleport: the cycle-closing rule holds on the graph with portals ' +
    '(forced chain ends join no edge)',
  FAST,
  () => {
    // a portal pair whose cells are the two ends of a forced chain: that edge must be dropped
    const p = teleportPuzzle(5, { 0: 1, 24: 2 }, [
      [2, 17],
      [10, 20],
    ]);
    const { nb, T } = buildNeighbors(p);
    const vis = new Uint8Array(T);
    vis[0] = 1;
    const r = forcedEdges(nb, T, vis, 0, 24);
    assert.ok(!r.infeasible || r.infeasible === true);
    // whatever it deduces, the solver agrees with brute force on this board
    assert.deepStrictEqual(solve(p, { limit: 1e6, prop: true }).count, brutePaths(p).length);
    assert.deepStrictEqual(
      solve(p, { limit: 1e6, prop: true, incr: false }).count,
      brutePaths(p).length,
    );
  },
);

test('teleport: solve refuses a mix with another variant', FAST, () => {
  const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
  assert.ok(threw(() => solve({ ...p, wrap: true })));
  assert.ok(threw(() => solve({ ...p, loop: true })));
  assert.ok(threw(() => solve({ ...p, exact: true })));
  assert.deepStrictEqual(cellCount(p), 16);
});

// ---- the generator

const game = (n, seed, o = {}) => runSync(generateTeleport(n, seed, o));
const usedPortals = p =>
  p.portals.filter(pair =>
    p.path.some((cell, i) => i > 0 && isPortalPair([pair], p.path[i - 1], cell)),
  );

// A path is a Hamiltonian path of the grid plus the portal edges.
const isTeleportPath = (n, path, portals) => {
  if (path.length !== n * n || new Set(path).size !== n * n) return false;
  return path.every(
    (cell, i) =>
      i === 0 || adjacent(n, false, path[i - 1], cell) || isPortalPair(portals, path[i - 1], cell),
  );
};

test(
  'teleport-gen: pairCount — 1 pair on 5 and 6 (no random draw), 1 or ' +
    '2 from 7, 2 likelier with the difficulty',
  FAST,
  () => {
    const never = () => {
      throw new Error('no random draw below 7');
    };
    for (const n of [4, 5, 6]) assert.deepStrictEqual(pairCount(n, never), 1, `n=${n}`);
    const draw = (n, level) => {
      const rnd = makeRng(100 + n);
      const seen = { 1: 0, 2: 0 };
      for (let i = 0; i < 400; i++) seen[pairCount(n, rnd, level)]++;
      return seen;
    };
    for (const n of [7, 8, 9]) {
      const mid = draw(n);
      assert.ok(
        mid[1] > 40 && mid[2] > 40 && mid[1] + mid[2] === 400,
        `n=${n}: both counts happen ${JSON.stringify(mid)}`,
      );
    }
    assert.ok(draw(8, 5)[2] > draw(8, 0)[2] + 60, 'the harder the more second pairs');
  },
);

test(
  'teleport-gen: pickPortals — distinct cells, odd distance of at ' +
    'least 3, canonical, repeatable, null when impossible',
  FAST,
  () => {
    for (const [n, count] of [
      [5, 1],
      [6, 1],
      [7, 2],
      [9, 3],
      [12, 6],
    ]) {
      for (let seed = 1; seed <= 25; seed++) {
        const portals = pickPortals(n, count, makeRng(seed));
        assert.deepStrictEqual(portals.length, count);
        assert.deepStrictEqual(new Set(portals.flat()).size, 2 * count, 'distinct cells');
        for (const [a, b] of portals) {
          assert.ok(a < b, 'lower cell first');
          assert.ok(
            gridDist(n, false, a, b) >= PORTAL_MIN_DIST && gridDist(n, false, a, b) % 2 === 1,
            `n=${n}: odd, far`,
          );
        }
        assert.ok(
          portals.every(([a], i) => i === 0 || portals[i - 1][0] < a),
          'sorted by the lower cell',
        );
        assert.deepStrictEqual(
          pickPortals(n, count, makeRng(seed)),
          portals,
          'same seed, same pairs',
        );
      }
    }
    assert.deepStrictEqual(pickPortals(4, 20, makeRng(1)), null, 'no room for 20 pairs');
  },
);

test(
  'teleport-gen: teleportPath — a Hamiltonian path of grid plus ' +
    'portals through every pair, ends off the portals',
  FAST,
  () => {
    for (const n of [5, 6, 7, 8, 9]) {
      for (const count of [1, 2, 3]) {
        for (let seed = 1; seed <= 12; seed++) {
          const rnd = makeRng(1000 * n + 10 * count + seed);
          const portals = pickPortals(n, count, rnd);
          const path = teleportPath(n, portals, rnd);
          assert.ok(path, `n=${n} pairs=${count} seed=${seed}: found`);
          assert.ok(isTeleportPath(n, path, portals), 'a Hamiltonian path of the graph');
          assert.ok(usesEveryPortal(path, portals), 'every pair is one step of the path');
          assert.ok(
            !portals.flat().includes(path[0]) && !portals.flat().includes(path[n * n - 1]),
            'ends off the portals',
          );
        }
      }
    }
    const snake5 = [
      0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14, 19, 18, 17, 16, 15, 20, 21, 22, 23, 24,
    ];
    assert.ok(!usesEveryPortal(snake5, [[1, 8]]), 'a path that walks past a pair does not use it');
  },
);

test(
  'teleport-gen: gapCheckpoints with the teleport rules numbers no ' +
    'portal cell and spreads along the real distances',
  FAST,
  () => {
    for (let seed = 1; seed <= 20; seed++) {
      const n = 7;
      const rnd = makeRng(seed);
      const portals = pickPortals(n, 2, rnd);
      const path = teleportPath(n, portals, rnd);
      const rules = teleportCheckpointRules(n, portals);
      const positions = gapCheckpoints(n, path, 8, false, rules);
      assert.ok(positions && positions.length === 8, 'eight numbers');
      assert.deepStrictEqual(positions[0], 0);
      assert.deepStrictEqual(positions[positions.length - 1], n * n - 1);
      assert.ok(
        positions.every(q => !rules.skip.has(path[q])),
        'no number on a portal cell',
      );
      assert.ok(
        positions.every((q, i) => i === 0 || q > positions[i - 1]),
        'increasing',
      );
    }
  },
);

test(
  'teleport-gen: generateTeleport 5 to 9 — valid, unique, the one ' +
    'solution is the planted path and uses every portal',
  SLOW,
  () => {
    for (const n of TELEPORT_SIZES) {
      for (const seed of n >= 8 ? [3] : [3, 4]) {
        const p = game(n, seed);
        assert.ok(validate(p).ok, `n=${n} seed=${seed}: valid`);
        assert.ok(
          p.portals.length >= 1 && p.portals.length <= (n >= 7 ? 2 : 1),
          `n=${n}: ${p.portals.length} pair(s)`,
        );
        const r = solve(p, { limit: 2, nodeCap: 5e7, prop: true, capture: true });
        assert.ok(!r.exceeded && r.count === 1, `n=${n} seed=${seed}: one solution`);
        assert.deepStrictEqual(r.paths[0], p.path, 'the solution is the planted path');
        assert.ok(isSolved(p, p.path));
        assert.deepStrictEqual(
          usedPortals(p).length,
          p.portals.length,
          'every portal is used by the solution',
        );
        assert.ok(
          p.portals.flat().every(cell => !p.cp[cell]),
          'no number on a portal',
        );
        assert.ok(maxNumber(p) >= Math.min(n, 5), 'a reasonable number of checkpoints');
        assert.deepStrictEqual(
          solve(p, { limit: 2, nodeCap: 5e7, prop: true, parity: true, pocket: true }).count,
          1,
          'also with parity and pocket pruning',
        );
      }
    }
  },
);

test(
  'teleport-gen: same seed, same puzzle; another seed, another one; ' + 'o.pairs sets the count',
  SLOW,
  () => {
    assert.deepStrictEqual(serialize(game(6, 7)), serialize(game(6, 7)));
    assert.ok(serialize(game(6, 7)) !== serialize(game(6, 8)));
    const three = game(8, 5, { pairs: 3 });
    assert.deepStrictEqual(three.portals.length, 3);
    assert.ok(
      validate(three).ok && solve(three, { limit: 2, nodeCap: 5e7, prop: true }).count === 1,
      'three pairs, unique',
    );
    const one = game(8, 5, { pairs: 1 });
    assert.deepStrictEqual(one.portals.length, 1);
  },
);

test(
  'teleport-gen: generate() refuses what a Teleport board cannot be, ' +
    'and plain generation is untouched',
  FAST,
  () => {
    const throws = f => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    };
    assert.ok(
      throws(() => runSync(generate(3, 1, { teleport: true }))),
      'n < 4',
    );
    assert.ok(
      throws(() => runSync(generate(6, 1, { teleport: true, wrap: true }))),
      'with wrap',
    );
    assert.ok(
      throws(() => runSync(generate(6, 1, { teleport: true, loop: true }))),
      'with loop',
    );
    const plain = runSync(generate(6, 9));
    assert.ok(!plain.portals, 'a standard puzzle has no portals');
  },
);

test('teleport-gen: design app — randomPathPuzzle and generateUnique with pairs', FAST, () => {
  for (const pairs of [1, 2, 3]) {
    const p = randomPathPuzzle(7, 7, makeRng(pairs), false, false, pairs);
    assert.deepStrictEqual(p.portals.length, pairs);
    assert.ok(validate(p).ok, 'valid');
    assert.ok(
      p.path && isTeleportPath(7, p.path, p.portals) && isSolved(p, p.path),
      'the template path solves it',
    );
  }
  // more pairs than fit: fewer are made
  const crowded = randomPathPuzzle(4, 4, makeRng(5), false, false, 9);
  assert.ok(
    crowded.portals.length >= 1 && crowded.portals.length <= maxPortalPairs(4, 4),
    `crowded 4x4: ${crowded.portals.length}`,
  );
  assert.deepStrictEqual(maxPortalPairs(4, 4), 3);
  assert.deepStrictEqual(maxPortalPairs(3, 9), 1, 'at least one');
  const r = runSync(generateUnique(7, 8, makeRng(5), { maxWalls: 6, tries: 20, pairs: 2 }));
  assert.ok(r.unique, 'found a unique puzzle');
  assert.deepStrictEqual(r.puzzle.portals.length, 2);
  assert.deepStrictEqual(solve(r.puzzle, { limit: 2, nodeCap: 5e7, prop: true }).count, 1);
  const none = randomPathPuzzle(6, 6, makeRng(3));
  assert.ok(!none.portals, 'without pairs: a standard puzzle');
  const throws = f => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  assert.ok(
    throws(() => runSync(generateUnique(7, 6, makeRng(1), { pairs: 1, wrap: true }))),
    'no pairs with wrap',
  );
});

// ---- the variant in the play app

const tele = (n, seed, o = {}) => made('teleport', n, seed, o);
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: TELEPORT,
    puzzle: p,
    ...extra,
  });
const jumpSteps = (p, path) =>
  path.filter((cell, i) => i > 0 && isPortalPair(p.portals, path[i - 1], cell)).length;
const stateOf = (p, path, extra = {}) => ({
  puzzle: p,
  path,
  hintCell: null,
  hintWrongCell: null,
  finished: false,
  ...extra,
});

test('teleport-play: routeD breaks the line at a jump; other puzzles keep pathD', FAST, () => {
  const p = tele(6, 2);
  const plain = routeD({ ...p, portals: undefined }, p.path.slice(0, 5));
  assert.deepStrictEqual((plain.match(/M/g) || []).length, 1, 'one M without portals');
  const d = routeD(p, p.path);
  assert.deepStrictEqual(
    (d.match(/M/g) || []).length,
    jumpSteps(p, p.path) + 1,
    'a new M after every jump',
  );
  const first = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
  const upTo = routeD(p, p.path.slice(0, first));
  assert.deepStrictEqual((upTo.match(/M/g) || []).length, 1, 'no jump yet: one piece');
  const standard = made('std', 5, 2);
  assert.ok(!/M.*M/.test(routeD(standard, standard.path)), 'a standard line is one piece');
});

test(
  'teleport-play: boardSvg shows both cells of each pair with the same ' +
    'icon, one icon style per pair',
  FAST,
  () => {
    const p = tele(8, 3, { pairs: 2 });
    const svg = boardSvg(stateOf(p, []));
    const found = svg.matchAll(/data-portal-cell="(\d+)" data-pair="(\d+)"/g);
    const cells = [...found].map(m => [+m[1], +m[2]]);
    assert.deepStrictEqual(cells.length, 4, 'four portal cells');
    p.portals.forEach(([a, b], i) => {
      assert.ok(
        cells.some(([c, k]) => c === a && k === i) && cells.some(([c, k]) => c === b && k === i),
        `pair ${i}`,
      );
    });
    assert.ok(/class="zip-svg teleport/.test(svg), 'teleport class');
    assert.ok(
      /<polygon[^>]*stroke="var\(--portal-2\)"/.test(svg) &&
        /<circle[^>]*stroke="var\(--portal-1\)"/.test(svg),
      'pair 0 a ring, pair 1 a diamond',
    );
    assert.ok(svg.includes('data-role="jump"'), 'the jump layer');
    // the portal icons are under the path, the numbers above it
    assert.ok(
      svg.indexOf('data-portal-cell') < svg.indexOf('data-role="path"'),
      'icons under the line',
    );
    assert.ok(
      svg.indexOf('data-role="path"') < svg.indexOf('data-num-cell'),
      'numbers above the line',
    );
    const plain = boardSvg(stateOf(made('std', 5, 2), []));
    assert.ok(!/portal|teleport|data-role="jump"/.test(plain), 'a standard board has none of it');
  },
);

test(
  'teleport-play: the palette: a colour and a shape per pair, shapes ' +
    'differ so colour is not needed',
  FAST,
  () => {
    assert.deepStrictEqual(
      PORTAL_COLORS.length >= 4 && new Set(PORTAL_COLORS).size,
      PORTAL_COLORS.length,
      'distinct colours',
    );
    assert.deepStrictEqual(new Set(PORTAL_SHAPES.slice(0, 4)).size, 4, 'four shapes');
    assert.deepStrictEqual(portalColor(0), portalColor(PORTAL_COLORS.length), 'wraps round');
    assert.deepStrictEqual(portalShape(0), portalShape(PORTAL_SHAPES.length), 'wraps round');
    assert.ok(portalIconsSvg({ n: 5, portals: [[0, 3]] }).includes('data-portal-cell="3"'));
    assert.deepStrictEqual(portalIconsSvg({ n: 5 }), '', 'no portals, no markup');
  },
);

test(
  'teleport-play: jumpMarksSvg — an arc per jump taken; a ring on the ' +
    'partner while the head can jump; none when done',
  FAST,
  () => {
    const p = tele(6, 4);
    const first = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
    // head on the first portal cell, the partner free: the ring says "tap it"
    const before = jumpMarksSvg(p, p.path.slice(0, first));
    assert.ok(
      before.includes('data-mark="jump-ready"') && !before.includes('data-mark="jump"'),
      'ring, no arc yet',
    );
    const at = jumpMarksSvg(p, p.path.slice(0, first + 1));
    assert.ok(
      at.includes('data-mark="jump"') && at.includes('data-mark="jump-end"'),
      'the arc and its arrowhead',
    );
    assert.ok(!at.includes('jump-ready'), 'the partner is visited: no ring');
    assert.deepStrictEqual(
      (jumpMarksSvg(p, p.path).match(/data-mark="jump"/g) || []).length,
      jumpSteps(p, p.path),
      'one arc per jump',
    );
    assert.deepStrictEqual(
      jumpMarksSvg(p, p.path.slice(0, first), true),
      '',
      'finished: nothing to tap',
    );
    assert.deepStrictEqual(jumpMarksSvg(p, []), '');
    assert.deepStrictEqual(jumpMarksSvg(made('std', 5, 2), [0, 1]), '', 'standard');
    const svg = boardSvg(stateOf(p, p.path.slice(0, first + 2)));
    assert.ok(svg.includes('data-mark="jump"'), 'the board carries the arcs');
    assert.ok(/data-role="path" d="[^"]*M[^"]*M/.test(svg), 'and the line is in two pieces');
  },
);

test('teleport-play: the note under the board exists in both languages', FAST, () => {
  assert.ok(
    typeof EN['game.teleportHint'] === 'string' && typeof ZH['game.teleportHint'] === 'string',
  );
});

test('teleport-play: share code — own version, old codes unchanged', FAST, () => {
  // a Teleport link has its own version number; the type field of the older versions is
  // untouched, so every code made
  // before still reads (this code was made by the version before Teleport)
  // compat pin: the version of the links already shared
  assert.deepStrictEqual(SHARE_VERSION_PORTAL, 4);
  assert.ok(
    VARIANTS.length === 6 && !VARIANTS.includes(TELEPORT),
    'the type field keeps its six types',
  );
  const std = parse('size 6\ncheckpoints 0,0=1 5,5=2 2,2=3\nwalls V,0,1');
  const old = {
    kind: 'local',
    variant: null,
    n: 6,
    grade: 2,
    timeS: 9,
    levels: [],
    puzzle: std,
  };
  assert.deepStrictEqual(encodeShare(old), 'bAAF8Cdq3yY', 'a standard code is what it was');
  assert.deepStrictEqual(decodeShare('bAAF8Cdq3yY').variant, null);
});

test('teleport-play: an unsound Teleport record is not encodable', FAST, () => {
  const p = tele(6, 4);
  assert.ok(encodeShare(record(p)) !== null, 'the sound one is');
  const broken = change => {
    const rec = record(p);
    change(rec);
    return encodeShare(rec) === null;
  };
  assert.ok(
    broken(rec => {
      delete rec.puzzle.portals;
    }),
    'no portals',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.portals = [];
    }),
    'an empty list',
  );
  assert.ok(
    broken(rec => {
      const [a, b] = rec.puzzle.portals[0];
      rec.puzzle.portals = [[b, a]];
    }),
    'not canonical: higher cell first',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.portals = [[rec.puzzle.cp.indexOf(1), 35]];
    }),
    'a portal on a number',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.portals.push(rec.puzzle.portals[0].slice());
    }),
    'a cell in two pairs',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.wrap = true;
    }),
    'wrap',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.loop = true;
    }),
    'loop',
  );
  assert.ok(
    broken(rec => {
      rec.grade = 2;
    }),
    'a record with a grade',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 99;
    }),
    'a gap in the numbers',
  );
  // the other types must not take a puzzle with portals, nor a Teleport one a standard puzzle
  const std = { ...record(p), variant: null };
  assert.deepStrictEqual(encodeShare(std), null, 'a standard record with portals');
  const plain = { ...record(p), puzzle: { n: p.n, cp: p.cp.slice(), walls: p.walls.slice() } };
  assert.deepStrictEqual(encodeShare(plain), null, 'a Teleport record without portals');
  for (const other of ['loop', 'wrap', 'exact', 'arrows', 'cutout']) {
    assert.deepStrictEqual(
      encodeShare({ ...record(p), variant: other }),
      null,
      `a ${other} record with portals`,
    );
  }
});

test('teleport-play: a share record copies the portal pairs', FAST, () => {
  const p = tele(6, 3);
  const copied = record(p).puzzle.portals;
  assert.ok(
    Array.isArray(copied) && copied !== p.portals && copied[0] !== p.portals[0],
    'the pairs are copied',
  );
});

// (the grade by trap only, with the model of the type, is a row of variant-contract.js)
test('teleport-play: the technique ladder says it does not know portals', FAST, () => {
  assert.ok(ladder(tele(6, 1)).error, 'the technique ladder says it does not know portals');
});

test(
  'teleport-play: the trap profile counts the portal as a move: ' +
    'walking past a portal cell has the jump as a wrong turn',
  FAST,
  () => {
    const p = tele(6, 6);
    const snake = [];
    for (let r = 0; r < 6; r++)
      for (let k = 0; k < 6; k++) snake.push(r * 6 + (r % 2 ? 5 - k : k));
    const profile = trapProfile(p, snake);
    for (const [a, b] of p.portals) {
      const first = Math.min(snake.indexOf(a), snake.indexOf(b));
      const partner = snake[first] === a ? b : a;
      assert.ok(
        profile.some(w => w.i === first && w.cell === partner),
        `the jump from step ${first} to ${partner} is a wrong turn`,
      );
    }
    // on the planted path the jump is the right move, so it is never listed as a wrong one
    const planted = trapProfile(p, p.path);
    p.portals.forEach(([a, b]) => {
      const at = p.path.findIndex((c, i) => i && isPortalPair([[a, b]], p.path[i - 1], c));
      assert.ok(
        !planted.some(w => w.i === at - 1 && w.cell === p.path[at]),
        'the right jump is no wrong turn',
      );
    });
    assert.ok(
      planted.every(w => Number.isInteger(w.sub)),
      'each wrong turn has its refutation size',
    );
  },
);

test(
  'teleport-play: a whole game: the planted path played with step() ' +
    'solves it, jump included; undo takes the jump back',
  FAST,
  () => {
    for (const seed of [1, 2, 3]) {
      const p = tele(6, seed);
      const path = [];
      for (const cell of p.path) {
        assert.ok(step(p, path, cell, { strictOrder: true }) === 'push', `seed ${seed}`);
      }
      assert.ok(isSolved(p, path), `seed ${seed}: solved`);
      assert.ok(jumpSteps(p, path) >= 1, 'a jump was played');
    }
    const p = tele(6, 5);
    const at = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
    const path = p.path.slice(0, at + 1);
    assert.deepStrictEqual(
      step(p, path, p.path[at - 1], { strictOrder: true }),
      'pop',
      'stepping back over the jump undoes it',
    );
    assert.deepStrictEqual(path.length, at);
    // the jump needs the head on a portal: from a cell without one a far cell cannot be reached
    assert.deepStrictEqual(
      step(p, [p.path[0]], p.portals[0][1], { strictOrder: true }),
      null,
      'a far cell cannot be reached',
    );
  },
);

test(
  'teleport-play: design board — portalD breaks at jumps, the mini ' +
    'preview carries the portals',
  FAST,
  () => {
    const p = tele(6, 2);
    const d = portalD(p.n, p.path, p.portals);
    assert.deepStrictEqual((d.match(/M/g) || []).length, jumpSteps(p, p.path) + 1);
    const svg = miniPreviewSvg(p, p.path, '#fff');
    assert.ok(
      svg.includes('<path d="M') && (svg.match(/<polygon|<circle/g) || []).length > 4,
      'the path and the portal shapes',
    );
    assert.deepStrictEqual((svg.match(/stroke-dasharray/g) || []).length, 0, 'plain markup');
    const plain = miniPreviewSvg(made('std', 5, 2), null, '#fff');
    assert.ok(!plain.includes('fill-opacity="0.14"'), 'a standard preview has no portals');
  },
);

test(
  'teleport-play: lucky game: 5 to 7 while teleport is locked, 5 to 9 ' + 'once it is unlocked',
  FAST,
  async () => {
    const memory = () => {
      const map = new Map();
      return {
        map,
        async get(k) {
          return map.has(k) ? { value: map.get(k) } : null;
        },
        async set(k, v) {
          map.set(k, v);
        },
      };
    };
    const defs = luckyDefs(PLAY_SIZES);
    const index = defs.findIndex(d => d.id === 'teleport');
    const MON = 20731;
    const at = day => () => new Date(day * 86400000);
    const pick = (...values) => {
      const q = [...values];
      return () => q.shift();
    };
    const store = memory();
    let u = createUnlock(store, defs, at(MON));
    await u.init();
    await u.addChoice();
    await u.takeChoice();
    await u.addToken();
    const seen = [];
    for (let k = 0; k < defs[index].locked.length; k++) {
      const game = await u.begin(pick(index, k));
      seen.push(game.size);
      assert.deepStrictEqual(game.isNew, true, 'a locked variant');
      await u.refund();
    }
    assert.deepStrictEqual(seen, [5, 6, 7], 'locked: 5, 6 and 7');
    await u.begin(pick(index, 0));
    assert.deepStrictEqual((await u.finish(true)).newly, true, 'solved: unlocked');
    u = createUnlock(store, defs, at(20743));
    await u.init();
    const sizes = [];
    for (let k = 0; k < defs[index].pool.length; k++) {
      const game = await u.begin(pick(index, k));
      sizes.push(game.size);
      assert.deepStrictEqual(game.isNew, false, 'an unlocked variant');
      await u.refund();
    }
    assert.deepStrictEqual(sizes, [5, 6, 7, 8, 9], 'unlocked: the sizes of free play');
  },
);
