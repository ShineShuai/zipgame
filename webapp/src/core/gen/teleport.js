import { generate, TELEPORT_CANDIDATES } from './generate.js';

// Generator of Teleport puzzles (puzzle.portals, core/model.js): pairs of linked cells; a step
// from one cell
// of a pair to the other is a move. It is generate() of gen/generate.js run with { teleport: true
// }: the pairs are
// chosen FIRST (gen/portals.js pickPortals), then a Hamiltonian path of the grid plus the portal
// edges that
// uses every pair (teleportPath), then the numbers along it (not on a portal cell), then walls
// until the
// puzzle has one solution (a wall never stands on a portal edge), minimized as for a standard
// puzzle.
//
// A portal can be decoration: if the one solution never used it, it would only add noise. It
// cannot happen
// here: the path built through every pair is what the walls make unique, so the unique solution
// uses every
// portal (a portal is mandatory by construction, and there is nothing to store about it).
//
// Gameplay: the decision "do I jump now, or walk on?" is not local, and harder for a human than
// the cell count
// suggests, so the boards are small and the pairs few (pairCount in gen/portals.js: 1 pair on 5
// and 6, 1 or 2
// from 7).

// The grid sizes the play app offers for this variant. Measured: see test/teleport-gen.js.
export const TELEPORT_MIN_OFFERED = 5;
export const TELEPORT_MAX_OFFERED = 9;
export const TELEPORT_SIZES = Object.keys(TELEPORT_CANDIDATES)
  .map(Number)
  .filter(n => n >= TELEPORT_MIN_OFFERED && n <= TELEPORT_MAX_OFFERED);

// Generator (function*, progress events { frac|null, walls, K } as generate()): (n, seed) ->
// puzzle. Same seed,
// same puzzle. o.pairs: the number of pairs (default pairCount(n, rnd, o.difficulty)).
export function* generateTeleport(n, seed, o = {}) {
  return yield* generate(n, seed, { ...o, teleport: true });
}
