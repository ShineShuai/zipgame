// Table of dead positions for the directed solver (solve-dir.js): a position is the set of cells
// on the path, the head and whether the must-use move was made; if the search has been through
// all of it without a solution, any other way of reaching the same position can be dropped at
// once. (The possible completions depend on nothing else: they are the Hamiltonian paths of the
// cells left.)
// Different orders of the same cells are common on a board this open, which is why this pays.
//
// A position is identified by three 32-bit Zobrist hashes, 96 bits in all: the chance of two
// different positions looking alike is negligible (about 2^-96 per pair), and a table that forgets
// an entry only loses time. Open addressing with 4 probes; a full row is overwritten. One table is
// shared by all searches (a search gets a fresh epoch, so nothing is cleared): about 16 MB, made
// on the first use.

const BITS = 20;
const SIZE = 1 << BITS;
const MASK = SIZE - 1;
const PROBES = 4;
const MAX_CELLS = 256;

let table = null;
let epoch = 0;

function randomWords(seed) {
  const words = new Int32Array(MAX_CELLS);
  let x = seed >>> 0;
  for (let i = 0; i < MAX_CELLS; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    words[i] = x | 0;
  }
  return words;
}

// Random words for the cells on the path (path[]) and for the head (head[]); three of each.
export const ZOBRIST = {
  path: [randomWords(0x9e3779b1), randomWords(0x85ebca6b), randomWords(0xc2b2ae35)],
  head: [randomWords(0x27d4eb2f), randomWords(0x165667b1), randomWords(0xd3a2646c)],
  used: [0x5bd1e995 | 0, 0x1b873593 | 0, 0xcc9e2d51 | 0],
};

// A fresh epoch: every earlier entry is gone. Returns the lookup/insert functions of this search.
export function startMemo() {
  if (!table) {
    table = {
      a: new Int32Array(SIZE),
      b: new Int32Array(SIZE),
      c: new Int32Array(SIZE),
      epoch: new Int32Array(SIZE),
    };
  }
  epoch++;
  if (epoch > 0x7ffffff0) { // (never in practice) wrap around cleanly
    table.epoch.fill(0);
    epoch = 1;
  }
  const { a: ta, b: tb, c: tc, epoch: te } = table;
  const now = epoch;
  return {
    // true when the position (a, b, c) is in the table
    has(a, b, c) {
      let i = (a ^ (b << 5) ^ (c >>> 3)) & MASK;
      for (let p = 0; p < PROBES; p++, i = (i + 1) & MASK) {
        if (te[i] !== now) return false;
        if (ta[i] === a && tb[i] === b && tc[i] === c) return true;
      }
      return false;
    },
    add(a, b, c) {
      const first = (a ^ (b << 5) ^ (c >>> 3)) & MASK;
      let i = first;
      for (let p = 0; p < PROBES; p++, i = (i + 1) & MASK) {
        if (te[i] !== now) break;
        if (ta[i] === a && tb[i] === b && tc[i] === c) return;
        if (p === PROBES - 1) i = first; // the row is full: overwrite its first entry
      }
      te[i] = now;
      ta[i] = a;
      tb[i] = b;
      tc[i] = c;
    },
  };
}
