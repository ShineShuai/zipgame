// Layout of a Cutout solution: which way the path runs over the board and where the checkpoints sit on it.
//
// Why: the trap grade (core/trap.js) looks at the wrong turns a solver meets, not at how the board falls apart for a person. On a
// board with holes the solution tends to stay inside a lobe of the board, then pass a narrow neck once into the next (its crossings
// of the board's middle line are ~25% fewer than on a standard board: 2.7 vs 3.7 at 8x8, 3.4 vs 4.5 at 10x10), and the checkpoints
// are spaced so that each one lies about a leg further on in a straight line (gapCheckpoints: Manhattan gap = 0.65 of the leg), so
// 1-5 sit in one region, 6-9 in the next, and every region is solved by walking round its edge, its holes and its walls. Two cures:
//   1. interleavedPath: of several random Hamiltonian paths of the board (backbite moves, which need no particular board shape) take the
//      one that crosses the middle line most, so the regions are not independent of each other.
//   2. placeCheckpoints: put the checkpoints where a leg DOUBLES BACK (the solution's leg is long, the two checkpoints are near each
//      other on the board), so the shortest route between consecutive checkpoints is not the solution, and where consecutive checkpoints
//      lie in different quadrants.
//   3. the same placement, polished by a local search, rewards LEGS THAT OVERLAP: pairs of legs (not neighbours) whose boxes overlap or
//      whose straight lines cross (spatial.js counts both), so the area one leg walks is also walked by another, at another time.
//      Measured at 8x8, 12 puzzles: legs that overlap per leg 0.56 -> 0.75 (standard puzzles: 0.62), crossing 0.24 -> 0.22 (standard 0.15),
//      and the walls fall from 3.7 to 2.8 at the same share of puzzles at grade 3: legs that lie over each other fix each other.
// Neither is measured by the grade (the correlation of both with trapMax / trapTop3 / lTr is ~0-0.15): they are what a player sees,
// and they cost something. Measured with generateCutout at 8x8 (12 puzzles each, grade >= 3 asked for), layout off / interleaved path
// only / path + placement at the default floor:
//   crossings of the middle line 3.2 / 5.0 / 5.3,  legs that change quadrant 0.16 / 0.15 / 0.29,  walls 2.0 / 2.1 / 3.7,
//   puzzles at grade >= 3: 0.58 / 0.75 / 0.50.
// The interleaved path is free (it changes what the board allows, not what the climb can reach). The placement is what costs walls and
// grades: its checkpoints sit closer together, so more walls are needed for a unique solution, and every move of the climb that would
// undo the quadrant changes is refused. The detour part of the placement needs no floor: the climb reaches the same detour by itself
// (0.48 at grade 3 with or without the placement; 0.39 for the evenly spaced start).
//   LAYOUT.keepSwitches (the floor) sets the price: 0 = placement only at the start (the climb undoes it), 0.6 = quadrant changes 0.39 at
//   0.33 puzzles at grade 3 and 3.8 walls, 0.8 = 0.50 at 0.25 and 3.0 walls. o.layout = false (the whole of this) / o.place = false (the
//   path only) in generateCutout switch it off.
import { adjacency } from './shapes.js';
import { segmentCrossCount, segmentOverlapCount } from '../spatial.js';

// Backbite on any board graph: join an end to a neighbour cell further along the path and drop the edge before that cell. The result
// is again a Hamiltonian path of the same cells. `moves` random end-reversals; the path given is not changed.
export function backbiteHoles(path, adj, rnd, moves) {
  const p = path.slice(), P = p.length, pos = new Int32Array(adj.length).fill(-1);
  p.forEach((c, i) => { pos[c] = i; });
  const reverse = (a, b) => { // p[a..b] in place
    for (; a < b; a++, b--) { const t = p[a]; p[a] = p[b]; p[b] = t; pos[p[a]] = a; pos[p[b]] = b; }
  };
  for (let m = 0; m < moves; m++) {
    if (rnd() < 0.5) {
      const e = p[0], opts = adj[e].filter(v => pos[v] > 1);
      if (!opts.length) continue;
      const j = pos[opts[Math.floor(rnd() * opts.length)]];
      reverse(0, j - 1);
    } else {
      const e = p[P - 1], opts = adj[e].filter(v => pos[v] >= 0 && pos[v] < P - 2);
      if (!opts.length) continue;
      const j = pos[opts[Math.floor(rnd() * opts.length)]];
      reverse(j + 1, P - 1);
    }
  }
  return p;
}

// Times the path crosses the board's middle line, the lesser of the vertical and the horizontal one.
export function pathCrossings(n, path) {
  const half = n / 2;
  let v = 0, h = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if ((a % n < half) !== (b % n < half)) v++;
    if (((a / n | 0) < half) !== ((b / n | 0) < half)) h++;
  }
  return Math.min(v, h);
}

export const LAYOUT = {
  pathTries: 16, // random paths compared per board (the board's own Warnsdorff path is one more)
  movesPerCell: 20, // backbite moves per path (the crossings of the paths do not change from 40 to 150 moves per cell)
  minLeg: 0.5, maxLeg: 1.8, // leg length (path steps between two checkpoints) in units of the mean leg: keeps the legs near even, so uniqueness stays cheap
  quadrant: 4, // what a leg that ends in another quadrant is worth, in cells of detour (1: the checkpoints hop across the middle line; 4: ~0.6 of the legs change quadrant at 0.6 detour)
  overlap: 4, cross: 4, // what a pair of legs that are not neighbours is worth when their boxes overlap / their straight lines cross, in cells of detour (spatial.js counts both)
  polish: 60, // tries of the local search per checkpoint, after the programme (0 = programme only)
  keepOverlap: 0.6, // ... and this share of the overlap per leg (0 = no floor)
  keepSwitches: 0.3, // a change of the climb must keep this share of the quadrant changes the placement itself reaches with that many checkpoints
};

export function interleavedPath(n, board, rnd, adj = adjacency(n, board.holes), tries = LAYOUT.pathTries) {
  let best = board.path, bestCut = pathCrossings(n, best);
  const moves = LAYOUT.movesPerCell * board.path.length;
  for (let t = 0; t < tries; t++) {
    const path = backbiteHoles(board.path, adj, rnd, moves), cut = pathCrossings(n, path);
    if (cut > bestCut) { best = path; bestCut = cut; }
  }
  return best;
}

// Quadrant of a cell, -1 inside the band of one cell either side of a middle line: a pair of checkpoints that straddles the line
// with one cell between them is not "another region" to a player, and the placement would otherwise line its checkpoints up along the lines.
const quadrantOf = (n, c) => {
  const mid = (n - 1) / 2, r = c / n | 0, k = c % n;
  return Math.abs(r - mid) < 1 || Math.abs(k - mid) < 1 ? -1 : (r < mid ? 0 : 2) + (k < mid ? 0 : 1);
};
const otherQuadrant = (a, b) => a >= 0 && b >= 0 && a !== b;

// Everything the placement and the checks need for one path: route[i * T + c] = fewest steps from path[i] to cell c over the cells that
// are left (holes only; walls come later and only make routes longer).
export function layoutFor(n, adj, path) {
  const T = n * n, P = path.length, route = new Int16Array(P * T).fill(-1), at = new Int32Array(T).fill(-1);
  path.forEach((c, i) => { at[c] = i; });
  const queue = new Int32Array(P);
  for (let i = 0; i < P; i++) {
    const base = i * T;
    let head = 0, tail = 0;
    queue[tail++] = path[i];
    route[base + path[i]] = 0;
    while (head < tail) {
      const c = queue[head++];
      for (const v of adj[c]) if (route[base + v] < 0) { route[base + v] = route[base + c] + 1; queue[tail++] = v; }
    }
  }
  const dist = (i, j) => route[i * T + path[j]];
  // Of checkpoints at path positions (sorted): the share of the solution that is not on shortest routes, the share of legs that end in another
  // quadrant, and per leg the pairs of legs (not neighbours) whose boxes overlap / whose straight lines cross (spatial.js).
  const stats = positions => {
    let off = 0, moved = 0;
    const pts = positions.map(q => [path[q] / n | 0, path[q] % n]), legs = Math.max(1, positions.length - 1);
    for (let k = 1; k < positions.length; k++) {
      const a = positions[k - 1], b = positions[k];
      off += b - a - dist(a, b);
      if (otherQuadrant(quadrantOf(n, path[a]), quadrantOf(n, path[b]))) moved++;
    }
    return { detour: off / (P - 1), switches: moved / legs, overlap: segmentOverlapCount(pts) / legs, cross: segmentCrossCount(pts) / legs };
  };
  // Path positions of the numbered cells of a cp array, in checkpoint order.
  const positionsOf = cp => {
    const out = [];
    for (let c = 0; c < T; c++) if (cp[c]) out[cp[c] - 1] = at[c];
    return out;
  };
  return { n, path, dist, stats, positionsOf };
}

// What a placement is worth: detour (cells of the solution off the shortest routes) + the quadrant bonus per leg that ends in another quadrant
// + the overlap bonus per pair of legs (not neighbours) whose boxes overlap + the crossing bonus per pair whose straight lines cross.
export function placementScore(layout, positions, o = {}) {
  const { n, path, dist } = layout, mu = o.quadrant ?? LAYOUT.quadrant;
  let score = 0;
  const pts = positions.map(q => [path[q] / n | 0, path[q] % n]);
  for (let k = 1; k < positions.length; k++) {
    const a = positions[k - 1], b = positions[k];
    score += b - a - dist(a, b);
    if (otherQuadrant(quadrantOf(n, path[a]), quadrantOf(n, path[b]))) score += mu;
  }
  const overlap = o.overlap ?? LAYOUT.overlap, cross = o.cross ?? LAYOUT.cross;
  if (overlap || cross) score += overlap * segmentOverlapCount(pts) + cross * segmentCrossCount(pts);
  return score;
}

// K path positions (first and last included) that maximise detour + quadrant changes, with legs of a near-even length. Dynamic
// programme over (checkpoints placed, position); null when no placement has all legs inside the bounds. With o.rnd the result is then
// polished by a local search (move one inner checkpoint a step or two along the path, keep it when the score does not fall) that also
// rewards legs that overlap and cross (what the programme cannot see: it is a property of pairs of legs, not of neighbours).
export function placeCheckpoints(layout, K, o = {}) {
  const { n, path, dist } = layout, P = path.length;
  if (K < 2 || K > P) return null;
  const mean = (P - 1) / (K - 1), lo = Math.max(1, Math.floor((o.minLeg ?? LAYOUT.minLeg) * mean)), hi = Math.max(lo, Math.ceil((o.maxLeg ?? LAYOUT.maxLeg) * mean));
  const mu = o.quadrant ?? LAYOUT.quadrant, quad = path.map(c => quadrantOf(n, c));
  const NEG = -1e9, score = new Float64Array(K * P).fill(NEG), from = new Int32Array(K * P).fill(-1);
  score[0] = 0; // one checkpoint placed, at position 0
  for (let k = 1; k < K; k++) {
    for (let i = 0; i < P; i++) {
      const base = score[(k - 1) * P + i];
      if (base <= NEG / 2) continue;
      for (let j = i + lo; j <= Math.min(P - 1, i + hi); j++) {
        const s = base + (j - i - dist(i, j)) + (otherQuadrant(quad[i], quad[j]) ? mu : 0);
        if (s > score[k * P + j] + 1e-12) { score[k * P + j] = s; from[k * P + j] = i; }
      }
    }
  }
  if (score[(K - 1) * P + P - 1] <= NEG / 2) return null;
  let out = [P - 1];
  for (let k = K - 1, j = P - 1; k > 0; k--) { j = from[k * P + j]; out.push(j); }
  out = out.reverse();
  const polish = o.polish ?? LAYOUT.polish;
  if (!o.rnd || !polish || K < 4 || !((o.overlap ?? LAYOUT.overlap) || (o.cross ?? LAYOUT.cross))) return out;
  let current = placementScore(layout, out, o);
  for (let t = 0; t < polish * K; t++) {
    const k = 1 + Math.floor(o.rnd() * (K - 2)), step = (o.rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(o.rnd() * 2)), at = out[k] + step;
    if (at - out[k - 1] < lo || at - out[k - 1] > hi || out[k + 1] - at < lo || out[k + 1] - at > hi) continue;
    const moved = out.slice();
    moved[k] = at;
    const s = placementScore(layout, moved, o);
    if (s >= current - 1e-12) { out = moved; current = s; }
  }
  return out;
}
