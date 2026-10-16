import { backbitePortals } from './hampath.js';
import { gridDist, graphDistances } from '../geom.js';

// The parts of the Teleport generator that do not need generate() (gen/teleport.js has the
// generator itself):
// how many pairs, where they go, and the path through them.

// Smallest Manhattan distance between the two cells of a pair: far enough that the jump is a real
// shortcut (a
// pair of neighbours would be a second edge between the same two cells, which the solver does not
// support),
// and odd, so that the board stays bipartite (every move flips the checkerboard colour) and the
// solver's parity
// rule keeps working (core/geom.js portalsBipartite). The file format and the solver accept any
// other pair.
export const PORTAL_MIN_DIST = 3;

// How many pairs a puzzle of size n gets: 1 on 5 and 6; on 7 and up 1 or 2, chosen at random, the
// second pair
// getting likelier with the difficulty asked for (0..5; none = the middle). Uses exactly one rnd()
// value on 7 and
// up, none below.
export const TWO_PAIRS_FROM = 7;
export function pairCount(n, rnd, difficulty = null) {
  if (n < TWO_PAIRS_FROM) return 1;
  const level = difficulty == null ? 2.5 : Math.max(0, Math.min(5, difficulty));
  return rnd() < 0.2 + 0.12 * level ? 2 : 1;
}

// `count` pairs of cells on an n x n board: distinct cells, odd distance of at least
// PORTAL_MIN_DIST. The pairs
// are returned canonical (lower cell first, sorted), so the same cells always make the same text.
// null when no
// choice is found (a board far too small for that many pairs).
export function pickPortals(n, count, rnd) {
  const T = n * n;
  const portals = [];
  const used = new Set();
  for (let guess = 0; guess < 400 && portals.length < count; guess++) {
    const a = Math.floor(rnd() * T);
    const b = Math.floor(rnd() * T);
    if (a === b || used.has(a) || used.has(b)) continue;
    const apart = gridDist(n, false, a, b);
    if (apart < PORTAL_MIN_DIST || apart % 2 === 0) continue;
    used.add(a);
    used.add(b);
    portals.push(a < b ? [a, b] : [b, a]);
  }
  if (portals.length < count) return null;
  return portals.sort((x, y) => x[0] - y[0]);
}

// Does `path` use every pair, and have its two ends (the numbers 1 and K) off the portals?
export function usesEveryPortal(path, portals) {
  const at = new Map(path.map((cell, i) => [cell, i]));
  const onPortal = new Set(portals.flat());
  if (onPortal.has(path[0]) || onPortal.has(path[path.length - 1])) return false;
  return portals.every(([a, b]) => Math.abs(at.get(a) - at.get(b)) === 1);
}

// A Hamiltonian path of the grid plus the portal edges that uses every pair and neither starts nor
// ends on a
// portal cell, or null (no attempt of `tries` got there; backbitePortals makes one all but
// certain).
export function teleportPath(n, portals, rnd, tries = 40) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const path = backbitePortals(n, rnd, portals);
    if (usesEveryPortal(path, portals)) return path;
  }
  return null;
}

// What gapCheckpoints() needs on a Teleport board: the real distances, and the cells that carry no
// number.
export const teleportCheckpointRules = (n, portals) => {
  const dist = graphDistances(n, false, portals);
  return { dist: (a, b) => dist[a * n * n + b], skip: new Set(portals.flat()) };
};

// The most pairs worth asking for on an n x n board with K numbers: every pair takes two cells
// that carry no number,
// and a path that must run through every pair gets crowded, so at most a quarter of the free
// cells' worth. At least 1.
export const maxPortalPairs = (n, K) => Math.max(1, Math.floor((n * n - Math.max(2, K)) / 4));
