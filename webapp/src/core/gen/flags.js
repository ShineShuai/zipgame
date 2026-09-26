// Solver/generator algorithm flags, packed into one integer for reproduction and comparison.
//
// A puzzle generation run makes solve() calls in up to 3 phases, and each phase may use a
// different set of solver prunes:
//   build     makeUnique()'s wall-adding search (probe + main loop)
//   minimize  minimizeWalls()'s per-wall removal check
//   score     the hardest-candidate scoring solve() in generateUnique(), and — since Solve has
//             no build/minimize phases of its own — the plain Solve button's flag set too
//
// Each phase's solver prunes pack into one byte:
//   bit 0  prop        bit 1  legCollide   bit 2  pocket
//   bit 3  parity       bit 4  prune2
//   bits 5-6  seg       00 = off, 01 = next (true), 10 = all      (11 unused/reserved)
//   bit 7   reserved
//
// Full integer (27 bits used):
//   bits 0-7    build phase byte
//   bits 8-15   minimize phase byte
//   bits 16-23  score phase byte
//   bits 24-25  path: 0 = warnsdorff, 1 = backbite
//   bit 26      cps:  0 = gap,        1 = random
//
// Solve (no generation) only has a score phase: encodeFlags with build/minimize omitted mirrors
// the score byte into both, so decoding a Solve-only integer back out is still well-defined and
// round-trips, but generation code should read only the phase byte it actually needs.

export const PHASES = ['build', 'minimize', 'score'];
const SEG_CODES = { false: 0, true: 1, all: 2 };
const SEG_VALUES = [false, true, 'all'];

// One phase's flags -> one byte.
function encodeByte(f = {}) {
  let b = 0;
  if (f.prop) b |= 1 << 0;
  if (f.legCollide) b |= 1 << 1;
  if (f.pocket) b |= 1 << 2;
  if (f.parity) b |= 1 << 3;
  if (f.prune2) b |= 1 << 4;
  b |= (SEG_CODES[f.seg] ?? 0) << 5;
  return b;
}
function decodeByte(b) {
  return {
    prop: !!(b & (1 << 0)),
    legCollide: !!(b & (1 << 1)),
    pocket: !!(b & (1 << 2)),
    parity: !!(b & (1 << 3)),
    prune2: !!(b & (1 << 4)),
    seg: SEG_VALUES[(b >> 5) & 0b11] ?? false,
  };
}

// o: { build, minimize, score } phase flag objects (each optional; missing = all off, except
// score falls back to build if score itself is omitted, so a single-phase caller can pass just
// one set), o.path: 'warnsdorff'|'backbite', o.cps: 'gap'|'random'.
export function encodeFlags(o = {}) {
  const score = o.score || o.build || {};
  const build = o.build || score;
  const minimize = o.minimize || score;
  let v = encodeByte(build) | (encodeByte(minimize) << 8) | (encodeByte(score) << 16);
  if (o.path === 'backbite') v |= 1 << 24;
  if (o.cps === 'random') v |= 1 << 26;
  return v >>> 0;
}

// Inverse of encodeFlags. Always returns all of build/minimize/score/path/cps, even if the
// integer was produced by a single-phase encode (build/minimize will just equal score then).
export function decodeFlags(v) {
  v = v >>> 0;
  return {
    build: decodeByte(v & 0xff),
    minimize: decodeByte((v >> 8) & 0xff),
    score: decodeByte((v >> 16) & 0xff),
    path: (v & (1 << 24)) ? 'backbite' : 'warnsdorff',
    cps: (v & (1 << 26)) ? 'random' : 'gap',
  };
}

export const flagsToHex = v => '0x' + (v >>> 0).toString(16);
// Accepts '0x..', bare hex, or decimal; returns null if unparseable (caller decides the fallback).
export function hexToFlags(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const v = /^0x/i.test(t) ? parseInt(t, 16) : /^[0-9a-f]+$/i.test(t) && /[a-f]/i.test(t) ? parseInt(t, 16) : parseInt(t, 10);
  return Number.isFinite(v) && v >= 0 ? (v >>> 0) : null;
}

// Default flags matching generateUnique()'s own hardcoded defaults (prop on everywhere, else off,
// path=backbite, cps=gap) — same shape for build/minimize/score. This is what the design app's
// flags panel opens with, since Generate there calls generateUnique.
export const DEFAULT_GEN_FLAGS = { prop: true, legCollide: false, pocket: false, parity: false, prune2: false, seg: false };
export const DEFAULT_FLAGS_INT = encodeFlags({ score: DEFAULT_GEN_FLAGS, path: 'backbite', cps: 'gap' });

// generate()'s (the play app's daily/ALGO_VERSION-pinned generator) actual effective flags — it
// hardcodes path=warnsdorff, cps=gap, prop=true, legCollide=false with no per-phase distinction,
// no build/minimize/score is user-choosable there. Used only to compute the fixed badge value
// shown next to the seed on hold-v in the play app — never passed back into generate() itself,
// which stays untouched by this whole flags system.
// Caveat: generate() also builds several path/checkpoint candidates and keeps the one needing the
// fewest walls, and has its own retry/fallback ladder (denser K, then "number every cell") that
// generateUnique doesn't have — so pasting this seed+flags into the design app's Generate button
// (which calls generateUnique, a single attempt per retry) reproduces the same *algorithm choices*
// but is not guaranteed to reproduce the exact same puzzle as generate()'s multi-candidate result.
export const PLAY_FLAGS_INT = encodeFlags({ score: DEFAULT_GEN_FLAGS, path: 'warnsdorff', cps: 'gap' });
