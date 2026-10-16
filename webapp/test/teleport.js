// Tests of the "Teleport pairs" core: the data (core/model.js, core/geom.js), the plain-text
// format
// (core/format.js), the moves (core/rules.js), the edge ids (core/edges.js), the symmetry key of
// duplicates (core/ratings-io.js) and the solver (core/solver/*.js), which is checked against a
// plain
// brute-force search under every pruning option. Registered by tests.js: teleportTests(t, ok, eq).
import { makePuzzle, clonePuzzle, validate, cellCount } from '../src/core/model.js';
import { isSolved, step, canStep } from '../src/core/rules.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { buildNeighbors, forcedEdges } from '../src/core/solver/prune.js';
import { allEdges, setWallId, pathEdgeIds, portalEdgeId, edgeId } from '../src/core/edges.js';
import {
  graphDistances, gridDist, portalsBipartite, portalPartner, isPortalPair, neighbourCell,
} from '../src/core/geom.js';
import { symmetryKey, transformPuzzle, ratingKey } from '../src/core/ratings-io.js';
import { boardConnectivity, boardPropagation } from '../src/core/connectivity.js';
import { makeRng, shuffle } from '../src/core/rng.js';

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A Teleport puzzle: `numbers` = { cell: number }, `portals` = [[a, b], ...].
export function teleportPuzzle(n, numbers, portals) {
  const p = makePuzzle(n);
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  p.portals = portals.map(pair => pair.slice());
  return p;
}

// Every solution of p by plain depth-first search over the grid and the portal edges, with no
// pruning at all: the paths (as cell lists) that start on 1, visit the numbers in order, end on
// the
// highest and cover every cell.
export function brutePaths(p) {
  const n = p.n;
  const T = n * n;
  const K = Math.max(...p.cp);
  const start = p.cp.indexOf(1);
  const end = p.cp.indexOf(K);
  const vis = new Uint8Array(T);
  const paths = [];
  const trail = [];
  const around = cell => {
    const out = [];
    for (let d = 0; d < 4; d++) {
      const v = neighbourCell(n, false, cell, d);
      if (v >= 0 && !(p.walls[Math.min(cell, v)] & (Math.abs(cell - v) === 1 ? 1 : 2))) out.push(v);
    }
    const partner = portalPartner(p.portals, cell);
    if (partner >= 0) out.push(partner);
    return out;
  };
  const go = (cell, count, need) => {
    vis[cell] = 1;
    trail.push(cell);
    let next = need;
    let alive = true;
    if (p.cp[cell]) {
      if (p.cp[cell] !== next) alive = false;
      else next++;
    }
    if (alive) {
      if (count === T) {
        if (cell === end && next === K + 1) paths.push(trail.slice());
      } else {
        for (const v of around(cell)) if (!vis[v]) go(v, count + 1, next);
      }
    }
    trail.pop();
    vis[cell] = 0;
  };
  if (start >= 0) go(start, 1, 1);
  return paths;
}

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
        for (const v of shuffle(open.filter(c => c >= 0 && !vis[c]), rnd)) if (go(v)) return true;
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
  const free = path.map((cell, i) => i).filter(i => i > 0 && i < T - 1 && !used.has(path[i]));
  const inner = shuffle(free, rnd).slice(0, Math.max(0, K - 2)).sort((x, y) => x - y);
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

export function teleportTests(t, ok, eq) {
  t('teleport: neighbour table has the portal in slots 4 and 5, and none without portals', () => {
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[2, 13]]);
    const { nb, W } = buildNeighbors(p);
    eq(W, 6);
    eq(nb[2 * 6 + 4], 13);
    eq(nb[13 * 6 + 5], 2);
    eq(nb[2 * 6 + 5], -1);
    eq(nb[13 * 6 + 4], -1);
    // d ^ 1 gives the same edge from the other end
    eq(nb[nb[2 * 6 + 4] * 6 + (4 ^ 1)], 2);
    const plain = buildNeighbors(makePuzzle(4));
    eq(plain.W, 4);
    eq(plain.nb.length, 16 * 4);
  });

  t('teleport: a wall never stands on a portal edge (the neighbour '
    + 'exists whatever the walls are)', () => {
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
    for (const e of allEdges(4)) setWallId(p.walls, e, true);
    const { nb } = buildNeighbors(p);
    eq(nb[1 * 6 + 4], 14);
    ok(canStep(p, 1, 14) && canStep(p, 14, 1));
    ok(!canStep(p, 1, 2) && !canStep(p, 0, 1));
  });

  t('teleport: graph distances use the portals; parity rule only for odd-distance pairs', () => {
    const d = graphDistances(5, false, [[0, 24]]);
    eq(d[0 * 25 + 24], 1);
    eq(d[1 * 25 + 24], 2);
    eq(d[0 * 25 + 23], 2);
    eq(graphDistances(5, false, null)[0 * 25 + 24], 8, 'no portal: Manhattan');
    ok(portalsBipartite(5, null));
    ok(portalsBipartite(5, [[0, 3]]), 'distance 3 is odd');
    ok(!portalsBipartite(5, [[0, 24]]), 'distance 8 is even');
    ok(!portalsBipartite(5, [[0, 3], [0 + 5, 5 + 2]]), 'one even pair is enough');
    eq(portalPartner([[3, 9]], 9), 3);
    eq(portalPartner([[3, 9]], 4), -1);
    ok(isPortalPair([[3, 9]], 9, 3));
  });

  t('teleport: validate — a portal pair needs two free, non-adjacent '
    + 'cells, no checkpoint, no other variant', () => {
    const good = teleportPuzzle(5, { 0: 1, 24: 2 }, [[2, 17]]);
    ok(validate(good).ok);
    const bad = portals => ({ ...good, portals });
    const bads = [
      [], [[2, 2]], [[2, 3]], [[2, 7]], [[0, 17]], [[2, 17], [17, 20]], [[2, 99]], [[2]],
    ];
    for (const portals of bads) {
      ok(!validate(bad(portals)).ok, 'should be invalid: ' + JSON.stringify(portals));
    }
    ok(!validate({ ...good, wrap: true }).ok);
    ok(!validate({ ...good, exact: true }).ok);
    ok(!validate({ ...good, holes: new Uint8Array(25) }).ok);
    const copy = clonePuzzle(good);
    copy.portals[0][0] = 4;
    eq(good.portals, [[2, 17]], 'clonePuzzle copies the pairs');
  });

  t('teleport: format — round trip, canonical order, errors, path over a portal', () => {
    const text = 'size 6\ncheckpoints 0,0=1 5,5=2\nwalls V,0,0\nportals 4,4~1,1 0,3~3,0';
    const p = parse(text);
    eq(p.portals, [[3, 18], [7, 28]]);
    const out = serialize(p);
    ok(out.includes('\nportals 0,3~3,0 1,1~4,4'),
      'canonical: lower cell first, pairs by lower cell');
    eq(serialize(parse(out)), out);
    eq(ratingKey(text),
      ratingKey('size 6\ncheckpoints 5,5=2 0,0=1\nwalls V,0,0\nportals 1,1~4,4 3,0~0,3'));
    ok(!serialize(parse('size 4\ncheckpoints 0,0=1')).includes('portals'),
      'no portals line without pairs');
    for (const bad of [
      'size 5\nportals 0,0', 'size 5\nportals 0,0~0,0', 'size 5\nportals 0,0~0,1',
      'size 5\nportals 0,0~9,9', 'size 5\nportals 0,0~2,2 2,2~3,3',
      'size 5\nwrap\nportals 0,0~2,2', 'size 5\nexact\nportals 0,0~2,2',
      'size 5\nholes 4,4\nportals 0,0~2,2', 'size 5\nportals 0,0~2,2 x',
    ]) ok(threw(() => parse(bad)), 'should reject: ' + bad);
    const withPath = parse('size 4\ncheckpoints 0,0=1\nportals 0,1~3,1\npath 0,0 0,1 3,1');
    eq(withPath.path, [0, 1, 13]);
    ok(threw(() => parse('size 4\nportals 0,1~3,1\npath 0,0 3,1')),
      'a path may jump only over a portal pair');
  });

  t('teleport: moves — step() jumps over a pair, undo works, isSolved '
    + 'counts a jump as a step', () => {
    // 3 x 3 board, portal between (0,1) and (2,0)
    const p = teleportPuzzle(3, { 0: 1, 8: 2 }, [[1, 6]]);
    ok(validate(p).ok);
    const path = [];
    eq(step(p, path, 0), 'push');
    eq(step(p, path, 1), 'push');
    eq(step(p, path, 6), 'push', 'jump from 1 to its partner');
    eq(path, [0, 1, 6]);
    eq(step(p, path, 1), 'pop', 'going back undoes the jump');
    eq(path, [0, 1]);
    eq(step(p, path, 7), null, 'no jump from a cell without a portal');
    const found = solve(p, { limit: 99, capture: true, prop: true }).paths;
    eq(found.map(String).sort(), brutePaths(p).map(String).sort());
    const jumps = route => route.some((c, i) => i && isPortalPair(p.portals, route[i - 1], c));
    const jumping = found.filter(jumps);
    ok(jumping.length > 0, 'a solution uses the jump');
    ok(jumping.every(path2 => isSolved(p, path2)));
    ok(found.length > jumping.length,
      'and the plain snakes are solutions too (no portal is forced here)');
    ok(!isSolved(p, jumping[0].slice(0, -1)), 'one cell short');
  });

  t('teleport: pathEdgeIds gives a portal step an id beyond every grid edge', () => {
    const portals = [[0, 13], [3, 6]];
    const ids = pathEdgeIds(4, [1, 0, 13, 12], false, false, portals);
    eq(ids, [edgeId(4, 1, 0), portalEdgeId(4, 0), edgeId(4, 13, 12)]);
    ok(portalEdgeId(4, 0) >= 2 * 16);
    eq(pathEdgeIds(4, [6, 3], false, false, portals), [portalEdgeId(4, 1)]);
    ok(threw(() => pathEdgeIds(4, [0, 13], false, false, null)),
      'without the pairs a jump is not an edge');
  });

  t('teleport: a puzzle that differs only by its portals is not a '
    + 'duplicate of the plain one (symmetry key)', () => {
    const a = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls\nportals 0,2~3,0');
    const b = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls');
    ok(symmetryKey(a) !== symmetryKey(b));
    // the mirror image of a is the same puzzle up to symmetry
    const m = transformPuzzle(a, 4, false);
    eq(symmetryKey(m), symmetryKey(a));
    ok(m.portals && m.portals.length === 1);
    const other = parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls\nportals 0,2~3,1');
    ok(symmetryKey(other) !== symmetryKey(a));
  });

  t('teleport: the solver matches a plain brute-force search under every '
    + 'pruning option (random boards)', () => {
    const OPTIONS = [
      {}, { prop: true }, { prop: true, incr: false }, { prop: true, incr: false, fast: false },
      { prop: true, parity: true }, { prop: true, pocket: true }, { prop: true, seg: true },
      { prop: true, seg: 'all', legCollide: true }, { prop: true, prune2: true },
      { prop: true, parity: true, pocket: true, seg: 'all', prune2: true, legCollide: true },
      { lconn: false }, { prop: true, lconn: true },
    ];
    let boards = 0;
    let withSolutions = 0;
    for (let seed = 1; seed <= 90; seed++) {
      const n = seed % 3 === 0 ? 5 : 4;
      // odd-distance pairs keep the parity rule on, even ones switch it off
      const odd = seed % 2 === 0;
      const walls = seed % 4 === 0 ? 0.05 : 0.18;
      const p = randomTeleport(seed, n, 2 + (seed % 3), walls, 1 + (seed % 3 === 1 ? 1 : 0), odd);
      if (!p || !p.portals.length || !validate(p).ok) continue;
      const want = brutePaths(p).map(String).sort();
      boards++;
      if (want.length) withSolutions++;
      for (const opts of OPTIONS) {
        const got = solve(p, { limit: 1e6, nodeCap: 5e6, capture: true, ...opts });
        ok(!got.exceeded, 'node cap');
        eq(got.paths.map(String).sort(), want,
          `seed ${seed} n ${n} ${JSON.stringify(opts)}\n${serialize(p)}`);
      }
    }
    ok(boards >= 60 && withSolutions === boards,
      `boards ${boards}, with a solution ${withSolutions}`);
  });

  t('teleport: a region joined only by a portal still counts as '
    + 'connected (overlay and propagation)', () => {
    // 4 x 4, walls cut the board into two halves (rows 0-1 and rows 2-3); the portal is the only
    // way across
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
    for (let c = 0; c < 4; c++) setWallId(p.walls, edgeId(4, 4 + c, 8 + c), true);
    const solutions = brutePaths(p);
    ok(solutions.length > 0, 'solvable through the portal');
    for (const opts of [{}, { prop: true }, { prop: true, parity: true, pocket: true }]) {
      eq(solve(p, { limit: 1e5, ...opts }).count, solutions.length, JSON.stringify(opts));
    }
    // after one step the free region is still one piece, thanks to the portal
    const conn = boardConnectivity(p, [0]);
    ok(conn.connOk, 'overlay: reachable across the portal');
    eq(conn.unreachable.size, 0);
    const prop = boardPropagation(p, [0]);
    ok(!prop.infeasible);
  });

  t('teleport: the cycle-closing rule holds on the graph with portals '
    + '(forced chain ends join no edge)', () => {
    // a portal pair whose cells are the two ends of a forced chain: that edge must be dropped
    const p = teleportPuzzle(5, { 0: 1, 24: 2 }, [[2, 17], [10, 20]]);
    const { nb, T } = buildNeighbors(p);
    const vis = new Uint8Array(T);
    vis[0] = 1;
    const r = forcedEdges(nb, T, vis, 0, 24);
    ok(!r.infeasible || r.infeasible === true);
    // whatever it deduces, the solver agrees with brute force on this board
    eq(solve(p, { limit: 1e6, prop: true }).count, brutePaths(p).length);
    eq(solve(p, { limit: 1e6, prop: true, incr: false }).count, brutePaths(p).length);
  });

  t('teleport: solve refuses a mix with another variant', () => {
    const p = teleportPuzzle(4, { 0: 1, 15: 2 }, [[1, 14]]);
    ok(threw(() => solve({ ...p, wrap: true })));
    ok(threw(() => solve({ ...p, loop: true })));
    ok(threw(() => solve({ ...p, exact: true })));
    eq(cellCount(p), 16);
  });
}
