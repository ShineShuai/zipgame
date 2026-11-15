// Frozen puzzles for the tests that need a puzzle as an input, not the generator (the co-op, play and share tests).
// A puzzle is stored in the plain text format, with its solution path; test/fixtures/build-puzzles.mjs makes the file.
// The generators are tested in their own files and pinned by the golden hashes, so a test that only plays, draws or
// sends a puzzle does not need to run them again.
import fs from 'node:fs';
import { parse, serialize } from '../../src/core/format.js';
import { looksLikeSurface, parseSurface, serializeSurface, isSurfacePuzzle } from '../../src/core/surface/puzzle.js';

const FILE = new URL('./puzzles.json', import.meta.url);
let all = null;

export const keyOf = (kind, n, seed) => `${kind}-${n}-${seed}`;

// puzzle -> text, with the solution path when it has one
export function freeze(puzzle) {
  return isSurfacePuzzle(puzzle) ? serializeSurface(puzzle, { path: puzzle.path }) : serialize(puzzle, { path: puzzle.path });
}

export const thaw = text => (looksLikeSurface(text) ? parseSurface(text) : parse(text));

// the puzzle of a kind ('std', 'cutout', 'exact', 'wrap', 'teleport', 'loop', 'twopaths', 'pentagon', 'arrows', 'tetra', 'cube', 'ball'),
// size and seed, as made when the file was built; a new object on every call
export function fixture(kind, n, seed) {
  all ??= JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const text = all[keyOf(kind, n, seed)];
  if (text === undefined) throw new Error(`no fixture ${keyOf(kind, n, seed)}: add it to test/fixtures/build-puzzles.mjs and run it`);
  return thaw(text);
}

// every combination of the sizes and the seeds
export const fixtures = (kind, sizes, seeds) => sizes.flatMap(n => seeds.map(seed => fixture(kind, n, seed)));
