// Share-link codec: one finished game <-> a short URL-safe string (base64url over a packed bit
// stream, no separators, no readable text). Pure: no DOM, no storage.
//
// Layout (MSB first, zero-padded to a multiple of 6 bits; the code length must match exactly):
//   version 3 | kind 1 (0 = Game of Day, 1 = local) | size 5 | grade 3 (7 = unknown)
//   | time 17 (tenths of a second) | day 16 (UTC day number)
//   | Game of Day: percent beaten 7 (127 = unknown)
//   | local:       game index 10, ALGO_VERSION 4
//   | strip length 6, then 2 bits per leg (effort level 0..3)
//   | check 8 (fold of FNV-1a over every bit before it: catches truncated / mistyped links)
// A Game of Day with 8 legs is 14 characters.
//
// Version 2 = a game of a variant (see VARIANTS). Variant games are random, not rebuilt from a seed, so the code carries the
// puzzle itself (Cutout, id 1):
//   version 3 (=2) | variant 4 | size 5 | time 17 | shape 2 (0 none, else 1 + index in SHAPES)
//   | holes: size*size bits, 1 = hole | K 7, then K cell indices of checkpoints 1..K, 8 bits each
//   | wall count 8, then 9 bits per wall (edge id, see core/edges.js) | strip length 6, 2 bits per leg | check 8
// A 7x7 Cutout is about 50 characters, a 16x16 one about 140. Version 1 links are unchanged.
export const SHARE_VERSION = 1;
export const SHARE_VERSION_VARIANT = 2;
export const VARIANTS = [null, 'cutout']; // variant id -> name
export const VARIANT_SHAPES = ['donut', 'ell', 'cross']; // shape id - 1 -> name (gen/cutout.js SHAPES)
export const VARIANT_MAX_N = 16;
export const MAX_LEGS = 63;
export const MAX_TENTHS = 131071;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const NO_GRADE = 7;
const NO_PCT = 127;
const CHECK_BITS = 8;

function pushBits(bits, value, width) {
  for (let i = width - 1; i >= 0; i--) {
    bits.push((value >>> i) & 1);
  }
}

function checksum(bits, end) {
  let h = 0x811c9dc5;
  for (let i = 0; i < end; i++) {
    h = Math.imul(h ^ bits[i], 0x01000193);
  }
  h >>>= 0;
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff;
}

const encodedWalls = p => p.walls.reduce((k, w) => k + (w & 1) + ((w >> 1) & 1), 0);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// A Cutout puzzle { n, shape, holes, cp, walls } (typed arrays as in core/model.js) is sound when its cells, checkpoints and walls
// are in range and consistent, and the checkerboard rule holds (colour counts of the cells left differ by at most 1).
function isCutoutPuzzle(p) {
  if (!p || !isInt(p.n, 2, VARIANT_MAX_N) || (p.shape != null && !VARIANT_SHAPES.includes(p.shape))) return false;
  const T = p.n * p.n;
  if (!p.holes || p.holes.length !== T || !p.cp || p.cp.length !== T || !p.walls || p.walls.length !== T) return false;
  const colours = [0, 0], marks = [];
  for (let i = 0; i < T; i++) {
    if (p.holes[i]) {
      if (p.cp[i]) return false;
      continue;
    }
    colours[(((i / p.n) | 0) + (i % p.n)) & 1]++;
    if (p.cp[i]) marks.push(p.cp[i]);
    if ((p.walls[i] & 1 && (i % p.n === p.n - 1 || p.holes[i + 1])) || (p.walls[i] & 2 && (i + p.n >= T || p.holes[i + p.n]))) return false;
  }
  marks.sort((a, b) => a - b);
  return Math.abs(colours[0] - colours[1]) <= 1 && marks.length >= 2 && marks.length <= 127 && marks.every((v, i) => v === i + 1);
}

function isEncodable(rec) {
  if (rec && rec.variant != null) {
    return rec.kind === 'local' && rec.variant === 'cutout' && isInt(rec.n, 2, VARIANT_MAX_N) && rec.puzzle && rec.puzzle.n === rec.n
      && isCutoutPuzzle(rec.puzzle) && rec.grade == null && (rec.timeS > 0) && Number.isFinite(rec.timeS)
      && Array.isArray(rec.levels) && rec.levels.every(v => isInt(v, 0, 3));
  }
  if (!rec || (rec.kind !== 'gotd' && rec.kind !== 'local')) return false;
  if (!isInt(rec.n, 2, 31) || !isInt(rec.day, 0, 65535)) return false;
  if (rec.grade != null && !isInt(rec.grade, 0, 5)) return false;
  if (!(rec.timeS > 0) || !Number.isFinite(rec.timeS)) return false;
  if (!Array.isArray(rec.levels) || !rec.levels.every(v => isInt(v, 0, 3))) return false;
  if (rec.kind === 'gotd') return rec.pct == null || isInt(rec.pct, 0, 100);
  return isInt(rec.index, 0, 1023) && isInt(rec.algo, 0, 15);
}

// record: { kind: 'gotd' | 'local', n, grade: 0..5 | null, timeS, day, levels: [0..3],
//           gotd: pct: 0..100 | null;  local: index (0-based), algo }
// -> code, or null when a field is out of range.
export function encodeShare(rec) {
  if (!isEncodable(rec) || (rec.variant && encodedWalls(rec.puzzle) > 255)) {
    return null;
  }
  const local = rec.kind === 'local';
  const levels = rec.levels.length <= MAX_LEGS ? rec.levels : [];
  const bits = [];
  if (rec.variant) {
    pushVariant(bits, rec, levels);
    return bitsToCode(bits);
  }
  pushBits(bits, SHARE_VERSION, 3);
  pushBits(bits, local ? 1 : 0, 1);
  pushBits(bits, rec.n, 5);
  pushBits(bits, rec.grade == null ? NO_GRADE : rec.grade, 3);
  pushBits(bits, Math.min(MAX_TENTHS, Math.round(rec.timeS * 10)), 17);
  pushBits(bits, rec.day, 16);
  if (local) {
    pushBits(bits, rec.index, 10);
    pushBits(bits, rec.algo, 4);
  } else {
    pushBits(bits, rec.pct == null ? NO_PCT : rec.pct, 7);
  }
  pushBits(bits, levels.length, 6);
  for (const level of levels) {
    pushBits(bits, level, 2);
  }
  return bitsToCode(bits);
}

// checksum + base64url of the bit stream
function bitsToCode(bits) {
  pushBits(bits, checksum(bits, bits.length), CHECK_BITS);
  let code = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) {
      v = (v << 1) | (bits[i + j] || 0);
    }
    code += ALPHABET[v];
  }
  return code;
}

// Version 2 body (see the layout at the top). Walls are written in edge id order; levels as in version 1.
function pushVariant(bits, rec, levels) {
  const p = rec.puzzle, T = p.n * p.n, cells = [], walls = [];
  for (let i = 0; i < T; i++) {
    if (p.cp[i]) cells[p.cp[i] - 1] = i;
    for (let t = 0; t < 2; t++) if ((p.walls[i] >> t) & 1) walls.push(i * 2 + t);
  }
  pushBits(bits, SHARE_VERSION_VARIANT, 3);
  pushBits(bits, VARIANTS.indexOf(rec.variant), 4);
  pushBits(bits, p.n, 5);
  pushBits(bits, Math.min(MAX_TENTHS, Math.round(rec.timeS * 10)), 17);
  pushBits(bits, p.shape ? VARIANT_SHAPES.indexOf(p.shape) + 1 : 0, 2);
  for (let i = 0; i < T; i++) pushBits(bits, p.holes[i] ? 1 : 0, 1);
  pushBits(bits, cells.length, 7);
  for (const c of cells) pushBits(bits, c, 8);
  pushBits(bits, walls.length, 8);
  for (const e of walls) pushBits(bits, e, 9);
  pushBits(bits, levels.length, 6);
  for (const level of levels) pushBits(bits, level, 2);
}

// code -> the record encodeShare() was given (time in tenths), or null if not a valid code.
export function decodeShare(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return null;
  }
  const bits = [];
  for (const ch of code) {
    pushBits(bits, ALPHABET.indexOf(ch), 6);
  }
  let pos = 0;
  const read = width => {
    if (pos + width > bits.length) {
      throw new RangeError('short');
    }
    let v = 0;
    for (let i = 0; i < width; i++) {
      v = (v << 1) | bits[pos++];
    }
    return v;
  };
  try {
    const version = read(3);
    if (version === SHARE_VERSION_VARIANT) {
      return readVariant(read, bits, code, () => pos);
    }
    if (version !== SHARE_VERSION) {
      return null;
    }
    const local = read(1) === 1;
    const rec = { kind: local ? 'local' : 'gotd', n: read(5) };
    const grade = read(3);
    rec.grade = grade === NO_GRADE ? null : grade;
    rec.timeS = read(17) / 10;
    rec.day = read(16);
    if (local) {
      rec.index = read(10);
      rec.algo = read(4);
    } else {
      const pct = read(7);
      rec.pct = pct === NO_PCT ? null : pct;
    }
    const legs = read(6);
    rec.levels = [];
    for (let i = 0; i < legs; i++) {
      rec.levels.push(read(2));
    }
    const end = pos;
    if (read(CHECK_BITS) !== checksum(bits, end)) {
      return null;
    }
    const exactLength = code.length === Math.ceil(pos / 6);
    const zeroPadding = bits.slice(pos).every(b => b === 0);
    return exactLength && zeroPadding && isEncodable(rec) ? rec : null;
  } catch {
    return null;
  }
}

// Version 2 body, after its 3-bit version. read(width) / pos() are decodeShare's cursor; null when anything is off.
function readVariant(read, bits, code, pos) {
  if (VARIANTS[read(4)] !== 'cutout') {
    return null;
  }
  const n = read(5);
  if (!isInt(n, 2, VARIANT_MAX_N)) {
    return null;
  }
  const rec = { kind: 'local', variant: 'cutout', n, grade: null, timeS: read(17) / 10 };
  const shape = read(2);
  const T = n * n;
  const puzzle = { n, shape: shape === 0 ? null : VARIANT_SHAPES[shape - 1] || false, holes: new Uint8Array(T), cp: new Uint16Array(T), walls: new Uint8Array(T) };
  for (let i = 0; i < T; i++) {
    puzzle.holes[i] = read(1);
  }
  const K = read(7);
  for (let k = 1; k <= K; k++) {
    const cell = read(8);
    if (cell >= T || puzzle.cp[cell]) {
      return null;
    }
    puzzle.cp[cell] = k;
  }
  const walls = read(8);
  for (let i = 0; i < walls; i++) {
    const e = read(9);
    if ((e >> 1) >= T) {
      return null;
    }
    puzzle.walls[e >> 1] |= 1 << (e & 1);
  }
  rec.puzzle = puzzle;
  const legs = read(6);
  rec.levels = [];
  for (let i = 0; i < legs; i++) {
    rec.levels.push(read(2));
  }
  const end = pos();
  if (read(CHECK_BITS) !== checksum(bits, end)) {
    return null;
  }
  const exactLength = code.length === Math.ceil(pos() / 6);
  const zeroPadding = bits.slice(pos()).every(b => b === 0);
  return exactLength && zeroPadding && puzzle.shape !== false && isEncodable(rec) ? rec : null;
}
