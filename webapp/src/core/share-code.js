// Share-link codec: one finished game <-> a short URL-safe string (base64url over a packed bit
// stream, no separators, no readable text). Pure: no DOM, no storage.
//
// Two frames, told apart by the first 3 bits (the version).
//
// Version 1, a Game of Day (the puzzle is fetched by date, so only the result travels). MSB first,
// zero-padded to a multiple of 6 bits; the code length must match exactly:
//   version 3 | kind 1 (always 0) | size 5 | grade 3 (7 = unknown) | time 17 (tenths of a second)
//   | day 16 (UTC day number) | percent beaten 7 (127 = unknown)
//   | strip length 6, then 2 bits per leg (effort level 0..3)
//   | check 8 (fold of FNV-1a over every bit before it: catches truncated / mistyped links)
// A Game of Day with 8 legs is 14 characters.
//
// Version 3, a local game: the code carries the puzzle itself, so it never depends on the
// generator (a new ALGO_VERSION cannot orphan a link) and the receiver has nothing to generate.
//   version 3 | check 8 | one packed number (core/radix-code.js) in the rest of the bits
// The check is the same fold over the version and the number's bits. The number is exactly as wide
// as its fields need (the product of their radices), rounded up to whole characters; a code with
// more characters than that is refused. Fields, first = least significant:
//   puzzle type [0 standard | 1 cutout | 2 arrows | 3 exact | 4 wrap | 5 loop]  radix 6
//   size - 2                                                                     radix 15
//   time, tenths of a second - 1: count()                                        (small = short)
//   standard: grade + 1, 0 = none                                                radix 7
//   cutout:   shape (0 none, else 1 + index in LABELS, gen/shapes.js)            radix 9
//             holes, row by row: "same as the row above" flag (the first row is compared with
//             an empty one); else the row's holes as a subset of its n cells
//   K - 2: how many numbers there are                                            radix cells - 1
//   the K numbered cells, in number order: distinct picks among the cells that are not holes
//   exact:    the K - 2 steps between the first (1) and the last (the cell count): a subset of
//             2..cells - 1 of known size; the numbers are steps, not 1..K
//   walls (standard, cutout, wrap, loop): a subset of the board's edges (edges between two board
//             cells, in edge id order; a wrap-around board's include the seams)
//   arrows:   a subset of the edges, then 1 bit per arrow (1 = it points to the lower cell index)
//   strip: 1 flag, then K - 1 levels of 2 bits (no strip when K - 1 > MAX_LEGS)
// A Teleport puzzle (portal pairs, core/model.js) has a code of its own version,
// SHARE_VERSION_PORTAL: the layout
// above as a standard puzzle (type 0, walls), then
// portals:  how many pairs - 1 (count() up to cells / 2 - 1), then the pairs' cells, lower cell of
// a pair first,
//             pairs by lower cell: distinct picks among all cells
// before the strip. The type field keeps its radix 6, so every code made before this version reads
// as before.
// A Two paths puzzle (core/model.js: red and blue paths, the numbers split at `split`) has a code of
// its own version, SHARE_VERSION_SPLIT: the layout above as a standard puzzle (type 0, walls), then
// split:     split - 2: how many numbers the red path has, short of two for each colour (radix K - 3)
// before the strip.
// A 7x7 standard puzzle is about 20 characters, a 12x12 one about 45.
import { LABELS } from './gen/shapes.js';
import { allEdges, arrowProblem, arrowDirId, arrowIds, wallIds } from './edges.js';
import { validate, labelCount, numberedCells } from './model.js';
import { RadixWriter, RadixReader, bitLength } from './radix-code.js';

export const SHARE_VERSION = 1;
export const SHARE_VERSION_PUZZLE = 3;
export const SHARE_VERSION_PORTAL = 4; // a puzzle with portal pairs (variant name TELEPORT)
export const TELEPORT = 'teleport';
export const SHARE_VERSION_SPLIT = 5; // a puzzle with two paths (variant name TWO_PATHS)
export const TWO_PATHS = 'twopaths';
// the variants with a version of their own (their puzzle type field is the standard one)
const OWN_VERSION = { [TELEPORT]: SHARE_VERSION_PORTAL, [TWO_PATHS]: SHARE_VERSION_SPLIT };
const OWN_VARIANT = Object.fromEntries(Object.entries(OWN_VERSION).map(([name, v]) => [v, name]));
// puzzle type id -> variant name (null = a standard puzzle)
export const VARIANTS = [null, 'cutout', 'arrows', 'exact', 'wrap', 'loop'];
export const VARIANT_SHAPES = LABELS; // shape id - 1 -> name
export const VARIANT_MAX_N = 16;
export const MAX_LEGS = 63;
export const MAX_TENTHS = 131071;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const NO_GRADE = 7;
const NO_PCT = 127;
const CHECK_BITS = 8;
const VERSION_BITS = 3;

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

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isTime = v => v > 0 && Number.isFinite(v);

// ---------- puzzle soundness ----------
// What a decoded (or about to be encoded) puzzle has to be: the format cannot hold anything else,
// and the game must be able to play it.

const marksOf = p => {
  const marks = [];
  for (const v of p.cp) {
    if (v) {
      marks.push(v);
    }
  }
  return marks.sort((a, b) => a - b);
};
const isNumbered = marks => marks.length >= 2 && marks.every((v, i) => v === i + 1);

const FLAGS = ['holes', 'arrows', 'exact', 'wrap', 'loop', 'portals', 'split'];
// The variant markers of a puzzle: only `own` (null: none, a standard puzzle).
const onlyFlag = (p, own) => FLAGS.every(flag => (flag === own ? Boolean(p[flag]) : !p[flag]));
const isBoard = (p, smallest = 2) => Boolean(p) && isInt(p.n, smallest, VARIANT_MAX_N);
const hasArrays = (p, ...names) => names.every(name => p[name] && p[name].length === p.n * p.n);

// The edges a board has, in edge id order: the ones that walls and arrows may sit on.
const edgesOf = p => allEdges(p.n, p.holes || null, p.wrap === true);

// Checkpoints and walls of the right size, canonical wall bits, every wall on an edge the board
// has.
function hasLayers(p) {
  if (!hasArrays(p, 'cp', 'walls') || p.walls.some(w => w > 3)) {
    return false;
  }
  const edges = new Set(edgesOf(p));
  return wallIds(p).every(e => edges.has(e));
}

// A standard puzzle { n, cp, walls } (typed arrays as in core/model.js): numbered 1..K without
// gaps, no variant markers, and valid.
const isStandardPuzzle = p =>
  isBoard(p) && onlyFlag(p, null) && hasLayers(p) && isNumbered(marksOf(p)) && validate(p).ok;

// A Cutout puzzle { n, shape, holes, cp, walls }: holes, checkpoints and walls consistent, and the
// checkerboard rule holds (colour counts of the cells left differ by at most 1).
function isCutoutPuzzle(p) {
  const known = !p || p.shape == null || VARIANT_SHAPES.includes(p.shape);
  if (!known || !isBoard(p) || !onlyFlag(p, 'holes') || !hasArrays(p, 'holes') || !hasLayers(p)) {
    return false;
  }
  const colours = [0, 0];
  for (let i = 0; i < p.n * p.n; i++) {
    if (p.holes[i]) {
      if (p.cp[i]) {
        return false;
      }
    } else {
      colours[(((i / p.n) | 0) + (i % p.n)) & 1]++;
    }
  }
  return Math.abs(colours[0] - colours[1]) <= 1 && isNumbered(marksOf(p));
}

// A One way arrows puzzle { n, cp, walls, arrows }: numbered 1..K without gaps, no walls, sound
// arrows (see arrowProblem in core/edges.js).
const isArrowsPuzzle = p =>
  isBoard(p) &&
  onlyFlag(p, 'arrows') &&
  hasArrays(p, 'cp', 'walls', 'arrows') &&
  p.walls.every(w => w === 0) &&
  arrowProblem(p) === null &&
  isNumbered(marksOf(p));

// An Exact puzzle { n, cp, walls, exact }: no walls, at least 2 numbers, and valid (validate() in
// model.js: the first number is 1, the last is the cell count, every leg fits).
const isExactPuzzle = p =>
  isBoard(p) &&
  onlyFlag(p, 'exact') &&
  p.exact === true &&
  hasArrays(p, 'cp', 'walls') &&
  p.walls.every(w => w === 0) &&
  labelCount(p) >= 2 &&
  validate(p).ok;

// A wrap-around puzzle { n, cp, walls, wrap }: n from 3 (a 2 x 2 torus would have two edges between
// the same cells), numbered 1..K without gaps, and valid.
const isWrapPuzzle = p =>
  isBoard(p, 3) &&
  onlyFlag(p, 'wrap') &&
  p.wrap === true &&
  hasLayers(p) &&
  isNumbered(marksOf(p)) &&
  validate(p).ok;

// A Loop puzzle { n, cp, walls, loop }: numbered 1..K without gaps, and valid (validate() in
// model.js: an even board, at least 3 numbers).
const isLoopPuzzle = p =>
  isBoard(p) &&
  onlyFlag(p, 'loop') &&
  p.loop === true &&
  hasLayers(p) &&
  isNumbered(marksOf(p)) &&
  validate(p).ok;

// A Teleport puzzle: a standard one with portal pairs, written in canonical order (lower cell of a
// pair first,
// pairs by lower cell), so that one puzzle has one code.
const isTeleportPuzzle = p =>
  isBoard(p, 4) &&
  onlyFlag(p, 'portals') &&
  hasLayers(p) &&
  isNumbered(marksOf(p)) &&
  validate(p).ok &&
  p.portals.every(([a, b], i) => a < b && (i === 0 || p.portals[i - 1][0] < a));

// A Two paths puzzle: a standard one with the number list split between red and blue, each colour
// with at least 2 numbers (validate() in model.js).
const isTwoPathsPuzzle = p =>
  isBoard(p) &&
  onlyFlag(p, 'split') &&
  hasLayers(p) &&
  isNumbered(marksOf(p)) &&
  validate(p).ok;

// by puzzle type id (index in VARIANTS)
const SOUND_PUZZLE = [
  isStandardPuzzle,
  isCutoutPuzzle,
  isArrowsPuzzle,
  isExactPuzzle,
  isWrapPuzzle,
  isLoopPuzzle,
];

// A local game: { kind: 'local', variant: name | null (standard), n, grade (standard only), timeS,
// levels: [] or K - 1 levels, puzzle }
const SOUND_OWN = { [TELEPORT]: isTeleportPuzzle, [TWO_PATHS]: isTwoPathsPuzzle };
const typeId = rec => (rec.variant in OWN_VERSION ? 0 : VARIANTS.indexOf(rec.variant ?? null));

function isEncodablePuzzleRecord(rec) {
  const id = typeId(rec);
  const own = rec.variant in OWN_VERSION;
  const p = rec.puzzle;
  const sound = own ? SOUND_OWN[rec.variant] : SOUND_PUZZLE[id];
  if (id < 0 || rec.kind !== 'local' || !p || p.n !== rec.n || !sound(p)) {
    return false;
  }
  const gradeOk = id === 0 && !own
    ? rec.grade == null || isInt(rec.grade, 0, 5)
    : rec.grade == null;
  const K = labelCount(p);
  const levelsOk =
    Array.isArray(rec.levels) &&
    rec.levels.every(v => isInt(v, 0, 3)) &&
    (rec.levels.length === 0 || rec.levels.length === K - 1);
  return gradeOk && levelsOk && isTime(rec.timeS);
}

// record: { kind: 'gotd', n, grade: 0..5 | null, timeS, day, pct: 0..100 | null, levels: [0..3] }
function isEncodableGotd(rec) {
  if (!rec || rec.kind !== 'gotd' || !isInt(rec.n, 2, 31) || !isInt(rec.day, 0, 65535)) {
    return false;
  }
  if (rec.grade != null && !isInt(rec.grade, 0, 5)) {
    return false;
  }
  if (!isTime(rec.timeS) || !Array.isArray(rec.levels) || !rec.levels.every(v => isInt(v, 0, 3))) {
    return false;
  }
  return rec.pct == null || isInt(rec.pct, 0, 100);
}

// ---------- encode ----------

const tenths = timeS => Math.max(1, Math.min(MAX_TENTHS, Math.round(timeS * 10)));

// code characters: 6 bits each
function charsOf(bits) {
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

// Game of Day: checksum + base64url of the bit stream
function bitsToCode(bits) {
  pushBits(bits, checksum(bits, bits.length), CHECK_BITS);
  return charsOf(bits);
}

// Characters of a puzzle code whose packed number has to hold `capacity` different values.
const puzzleCodeLength = capacity =>
  Math.ceil((VERSION_BITS + CHECK_BITS + bitLength(capacity - 1n)) / 6);

// The cells that are not holes, ascending.
const openCells = p => {
  const open = [];
  for (let i = 0; i < p.n * p.n; i++) {
    if (!(p.holes && p.holes[i])) {
      open.push(i);
    }
  }
  return open;
};

// Holes row by row: the same as the row above, or a subset of the row.
function writeHoles(w, p) {
  let above = new Array(p.n).fill(0);
  for (let r = 0; r < p.n; r++) {
    const row = Array.from(p.holes.slice(r * p.n, r * p.n + p.n), v => (v ? 1 : 0));
    const same = row.every((v, i) => v === above[i]);
    w.uint(same ? 1 : 0, 2);
    if (!same) {
      w.subset(
        row.flatMap((v, i) => (v ? [i] : [])),
        p.n,
      );
    }
    above = row;
  }
}

function packPuzzleRecord(rec) {
  const p = rec.puzzle;
  const id = typeId(rec);
  const T = p.n * p.n;
  const w = new RadixWriter();
  w.uint(id, VARIANTS.length);
  w.uint(p.n - 2, VARIANT_MAX_N - 1);
  w.count(tenths(rec.timeS) - 1, MAX_TENTHS - 1);
  if (id === 0) {
    w.uint(rec.grade == null ? 0 : rec.grade + 1, 7);
  }
  if (rec.variant === 'cutout') {
    w.uint(p.shape ? VARIANT_SHAPES.indexOf(p.shape) + 1 : 0, VARIANT_SHAPES.length + 1);
    writeHoles(w, p);
  }
  const open = openCells(p);
  const numbered = numberedCells(p);
  w.uint(numbered.length - 2, open.length - 1);
  w.distinct(
    numbered.map(cell => open.indexOf(cell)),
    open.length,
  );
  if (rec.variant === 'exact') {
    w.fixedSubset(
      numbered.slice(1, -1).map(cell => p.cp[cell] - 2),
      T - 2,
      numbered.length - 2,
    );
  }
  const edges = edgesOf(p);
  const edgeAt = new Map(edges.map((e, i) => [e, i]));
  if (rec.variant === 'arrows') {
    const ids = arrowIds(p);
    w.subset(
      ids.map(e => edgeAt.get(e)),
      edges.length,
    );
    for (const e of ids) {
      w.uint(arrowDirId(p.arrows, e) < 0 ? 1 : 0, 2);
    }
  } else if (rec.variant !== 'exact') {
    w.subset(
      wallIds(p).map(e => edgeAt.get(e)),
      edges.length,
    );
  }
  if (rec.variant === TELEPORT) {
    w.count(p.portals.length - 1, (T >> 1) - 1);
    w.distinct(p.portals.flat(), T);
  }
  if (rec.variant === TWO_PATHS) {
    w.uint(p.split - 2, numbered.length - 3);
  }
  w.uint(rec.levels.length ? 1 : 0, 2);
  for (const level of rec.levels) {
    w.uint(level, 4);
  }
  return w;
}

// -> code, or null when a field is out of range.
export function encodeShare(rec) {
  if (rec && rec.kind === 'local') {
    return isEncodablePuzzleRecord(rec) ? encodePuzzle(rec) : null;
  }
  if (!isEncodableGotd(rec)) {
    return null;
  }
  const levels = rec.levels.length <= MAX_LEGS ? rec.levels : [];
  const bits = [];
  pushBits(bits, SHARE_VERSION, VERSION_BITS);
  pushBits(bits, 0, 1);
  pushBits(bits, rec.n, 5);
  pushBits(bits, rec.grade == null ? NO_GRADE : rec.grade, 3);
  pushBits(bits, Math.min(MAX_TENTHS, Math.round(rec.timeS * 10)), 17);
  pushBits(bits, rec.day, 16);
  pushBits(bits, rec.pct == null ? NO_PCT : rec.pct, 7);
  pushBits(bits, levels.length, 6);
  for (const level of levels) {
    pushBits(bits, level, 2);
  }
  return bitsToCode(bits);
}

function encodePuzzle(rec) {
  let packed;
  try {
    packed = packPuzzleRecord(rec);
  } catch (e) {
    if (e instanceof RangeError) {
      return null;
    }
    throw e;
  }
  const head = [];
  const version = OWN_VERSION[rec.variant] ?? SHARE_VERSION_PUZZLE;
  pushBits(head, version, VERSION_BITS);
  const width = puzzleCodeLength(packed.capacity) * 6 - VERSION_BITS - CHECK_BITS;
  const body = [...packed.value.toString(2).padStart(width, '0')].map(Number);
  const bits = [...head];
  pushBits(bits, checksum([...head, ...body], head.length + body.length), CHECK_BITS);
  bits.push(...body);
  return charsOf(bits);
}

// ---------- decode ----------

// code -> the record encodeShare() was given (time in tenths), or null if not a valid code.
export function decodeShare(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return null;
  }
  const bits = [];
  for (const ch of code) {
    pushBits(bits, ALPHABET.indexOf(ch), 6);
  }
  const version = bits[0] * 4 + bits[1] * 2 + bits[2];
  if (version === SHARE_VERSION_PUZZLE || version in OWN_VARIANT) {
    return decodePuzzle(bits, code, OWN_VARIANT[version] ?? null);
  }
  return version === SHARE_VERSION ? decodeGotd(bits, code) : null;
}

function decodeGotd(bits, code) {
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
    read(VERSION_BITS);
    if (read(1) !== 0) {
      return null;
    }
    const rec = { kind: 'gotd', n: read(5) };
    const grade = read(3);
    rec.grade = grade === NO_GRADE ? null : grade;
    rec.timeS = read(17) / 10;
    rec.day = read(16);
    const pct = read(7);
    rec.pct = pct === NO_PCT ? null : pct;
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
    return exactLength && zeroPadding && isEncodableGotd(rec) ? rec : null;
  } catch {
    return null;
  }
}

function readHoles(r, n) {
  const holes = new Uint8Array(n * n);
  let above = new Array(n).fill(0);
  for (let row = 0; row < n; row++) {
    let cells = above;
    if (r.uint(2) === 0) {
      cells = new Array(n).fill(0);
      for (const i of r.subset(n)) {
        cells[i] = 1;
      }
    }
    holes.set(cells, row * n);
    above = cells;
  }
  return holes;
}

// The packed number of a puzzle code (layout at the top); throws RangeError when it is not one.
function unpackPuzzleRecord(r, own = null) {
  const variant = VARIANTS[r.uint(VARIANTS.length)];
  if (own && variant !== null) {
    throw new RangeError(`a ${own} code has the standard type`);
  }
  const n = r.uint(VARIANT_MAX_N - 1) + 2;
  const T = n * n;
  const rec = {
    kind: 'local',
    variant: own || variant,
    n,
    grade: null,
    timeS: (r.count(MAX_TENTHS - 1) + 1) / 10,
  };
  const p = { n, cp: new Uint16Array(T), walls: new Uint8Array(T) };
  if (variant === null) {
    const grade = r.uint(7);
    rec.grade = grade === 0 ? null : grade - 1;
  }
  if (variant === 'cutout') {
    const shape = r.uint(VARIANT_SHAPES.length + 1);
    p.shape = shape === 0 ? null : VARIANT_SHAPES[shape - 1];
    p.holes = readHoles(r, n);
  }
  const open = openCells(p);
  const count = r.uint(open.length - 1) + 2;
  const cells = r.distinct(open.length, count).map(i => open[i]);
  const between = variant === 'exact' ? r.fixedSubset(T - 2, count - 2).map(i => i + 2) : null;
  const steps = between && [1, ...between, T];
  cells.forEach((cell, i) => {
    p.cp[cell] = steps ? steps[i] : i + 1;
  });
  const edges = edgesOf({ ...p, wrap: variant === 'wrap' });
  if (variant === 'arrows') {
    p.arrows = new Uint8Array(T);
    for (const i of r.subset(edges.length)) {
      const e = edges[i];
      p.arrows[e >> 1] |= (1 << (e & 1)) | (r.uint(2) << (2 + (e & 1)));
    }
  } else if (variant !== 'exact') {
    for (const i of r.subset(edges.length)) {
      p.walls[edges[i] >> 1] |= 1 << (edges[i] & 1);
    }
  }
  if (variant === 'exact' || variant === 'wrap' || variant === 'loop') {
    p[variant] = true;
  }
  if (own === TELEPORT) {
    const pairs = r.count((T >> 1) - 1) + 1;
    const picks = r.distinct(T, 2 * pairs);
    p.portals = Array.from({ length: pairs }, (_, i) => [picks[2 * i], picks[2 * i + 1]]);
  }
  if (own === TWO_PATHS) {
    if (count < 4) {
      throw new RangeError('two paths need 4 numbers at least');
    }
    p.split = r.uint(count - 3) + 2;
  }
  rec.levels = [];
  if (r.uint(2) === 1) {
    for (let i = 1; i < count; i++) {
      rec.levels.push(r.uint(4));
    }
  }
  rec.puzzle = p;
  return rec;
}

function decodePuzzle(bits, code, own = null) {
  const head = bits.slice(0, VERSION_BITS);
  const body = bits.slice(VERSION_BITS + CHECK_BITS);
  if (!body.length) {
    return null;
  }
  const stored = bits.slice(VERSION_BITS, VERSION_BITS + CHECK_BITS);
  const check = stored.reduce((v, b) => (v << 1) | b, 0);
  if (check !== checksum([...head, ...body], head.length + body.length)) {
    return null;
  }
  const reader = new RadixReader(BigInt('0b' + body.join('')));
  try {
    const rec = unpackPuzzleRecord(reader, own);
    const canonical = reader.done && code.length === puzzleCodeLength(reader.capacity);
    return canonical && isEncodablePuzzleRecord(rec) ? rec : null;
  } catch (e) {
    if (e instanceof RangeError) {
      return null;
    }
    throw e;
  }
}
