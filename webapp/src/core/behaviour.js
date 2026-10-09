// Behaviour rows: one anonymous record per solved game, uploaded for the difficulty analysis (server/README.md, "Behaviour rows").
// Pure: no DOM, no storage, no network. The page, the Worker, the tools and the tests all use this one file, so a column is defined once.
//
// A row is { day, ms, u, deep, s, pz, ev, v }:
//   day   UTC day number (days since 1970-01-01) of the puzzle: the day of a Game of Day, the day a local game's seed was made.
//   ms    raw solve time in milliseconds (no hint penalty: a game that used a hint is never uploaded).
//   u     cells drawn and taken back (the play log's `undone`), deep = the most cells taken back in one go (`maxUndone`).
//   s     one byte: kind (0 local, 1 Game of Day, 2 replay of a missed day) in bits 0-1, skill bucket (0-14, 15 = unknown) in bits 2-5.
//   pz    the puzzle itself, packed (packPuzzle), for a local game; null for a Game of Day (its file demo/GameOfDay/<day>.txt is the puzzle).
//   ev    reserved for later detail (per-mistake events, per-leg times). null in version 0. Its first byte is that detail's own format version.
//   v     the row format version (ROW_VERSION). A change of any column, of `s` or of the pz layout bumps it; tools keep every old decoder.
// Why the puzzle and not its seed: the generator changes with the code (ALGO_VERSION and edits that keep it), so (algo, day, size, index)
// only rebuilds a puzzle with the exact commit that made it. The packed puzzle is canonical (cells in checkpoint order, walls in edge-id
// order), so equal puzzles are equal bytes and `GROUP BY pz` works in SQL.
//
// Adding or removing information: see "Changing what a row holds" in server/README.md. In short: add a nullable COLUMNS entry (or fill `ev`),
// run `node tools/behaviour.mjs migrate`, deploy the servers first and the page after; stopping to send a column just sends null.
import { MIN_MS, MAX_MS, REPLAY_DAYS } from './hist.js';
import { makePuzzle, checkpointCells, maxNumber, validate } from './model.js';
import { wallIds, setWallId } from './edges.js';

export const ROW_VERSION = 0;
export const KINDS = ['local', 'gotd', 'replay'];
export const UNKNOWN_SKILL = 15;
export const PZ_MAX_N = 16, PZ_MAX_BYTES = 128, EV_MAX_BYTES = 64;
export const SKILL_MIN_GAMES = 8, SKILL_BASE_MS = 60, SKILL_WINDOW = 30;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isBytes = (v, lo, hi) => v instanceof Uint8Array && v.length >= lo && v.length <= hi;
const orNull = f => v => v === null || f(v);

// The table `play` (server/turso/schema.sql, server/cloudflare/schema.sql), in column order. `ok(value, today)` is the validity of one value
// (today = the UTC day number now); every column except the first generation must be nullable or have a DEFAULT, so that ALTER TABLE can add it.
export const COLUMNS = [
  { name: 'day', sql: 'INTEGER NOT NULL', ok: (v, today) => isInt(v, today - (REPLAY_DAYS + 1), today + 1) }, // the replay window of the Game of Day, +1 for clock skew
  { name: 'ms', sql: 'INTEGER NOT NULL', ok: v => isInt(v, MIN_MS, MAX_MS) },
  { name: 'u', sql: 'INTEGER', ok: orNull(v => isInt(v, 0, 65535)) },
  { name: 'deep', sql: 'INTEGER', ok: orNull(v => isInt(v, 0, 65535)) },
  { name: 's', sql: 'INTEGER', ok: orNull(v => isInt(v, 0, 255)) },
  { name: 'pz', sql: 'BLOB', ok: orNull(v => isBytes(v, 4, PZ_MAX_BYTES)) },
  { name: 'ev', sql: 'BLOB', ok: orNull(v => isBytes(v, 0, EV_MAX_BYTES)) },
  { name: 'v', sql: 'INTEGER NOT NULL DEFAULT 0', ok: v => isInt(v, 0, 15) },
];
export const COLUMN_NAMES = COLUMNS.map(c => c.name);
export const INSERT_SQL = `INSERT INTO play (${COLUMN_NAMES.join(', ')}) VALUES (${COLUMN_NAMES.map((_, i) => '?' + (i + 1)).join(', ')})`;
export const utcDay = (now = Date.now()) => Math.floor(now / 86400000);

// row -> the values of INSERT_SQL, in column order (a missing column is null).
export const rowArgs = row => COLUMNS.map(c => (row[c.name] === undefined ? null : row[c.name]));

// The row if every column is valid and no other key is present (an unknown key = a page newer than this server), else null.
export function validateRow(row, now = Date.now()) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(k => !COLUMN_NAMES.includes(k))) return null;
  const today = utcDay(now), out = {};
  for (const c of COLUMNS) {
    const v = row[c.name] === undefined ? (c.sql.includes('DEFAULT') ? 0 : null) : row[c.name];
    if (v === null && c.sql.includes('NOT NULL')) return null;
    if (!c.ok(v, today)) return null;
    out[c.name] = v;
  }
  return out;
}

// ---------- bytes <-> base64 (the JSON wire form of a BLOB; url-safe, no padding) ----------
export const toB64u = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const toB64 = bytes => btoa(String.fromCharCode(...bytes)); // standard, padded: the Hrana (Turso) form
export function fromB64u(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try { return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0)); } catch { return null; }
}
// row <-> a JSON-safe object (BLOBs as base64url). fromWire returns null for a malformed one; it does not check the values (validateRow does).
export const toWire = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? toB64u(v) : v]));
export function fromWire(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    const col = COLUMNS.find(c => c.name === k);
    if (col && col.sql.startsWith('BLOB') && typeof v === 'string') { const b = fromB64u(v); if (!b) return null; row[k] = b; } else row[k] = v;
  }
  return row;
}

// ---------- the packed puzzle ----------
// Bits, MSB first, zero-padded to whole bytes: size 5 | K (checkpoints) 8 | K cell indices of checkpoints 1..K, ceil(log2 n*n) bits each
// | wall count 9 | wall edge ids ascending (core/edges.js), ceil(log2 2*n*n) bits each. No holes: a variant (Cutout) is never uploaded.
// A 9x9 with 11 checkpoints and 7 walls is 20 bytes (its plain text is 136).
const bitsFor = x => Math.max(1, Math.ceil(Math.log2(x)));

export function packPuzzle(p) {
  if (!p || p.holes || !isInt(p.n, 2, PZ_MAX_N)) return null;
  const T = p.n * p.n, K = maxNumber(p);
  let marked = 0; for (const v of p.cp) if (v) marked++;
  if (K < 2 || K > 255 || marked !== K || !validate(p).ok) return null;
  const bits = [], put = (value, width) => { for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(p.n, 5); put(K, 8);
  for (const c of checkpointCells(p)) put(c, bitsFor(T));
  const walls = wallIds(p); put(walls.length, 9);
  for (const e of walls) put(e, bitsFor(2 * T));
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { out[i >> 3] |= b << (7 - (i & 7)); });
  return out.length <= PZ_MAX_BYTES ? out : null;
}

// bytes -> the puzzle { n, cp, walls }, or null unless the bytes are exactly what packPuzzle writes for a sound puzzle (canonical form).
export function unpackPuzzle(bytes) {
  if (!isBytes(bytes, 2, PZ_MAX_BYTES)) return null;
  let pos = 0;
  const get = width => {
    if (pos + width > bytes.length * 8) throw new RangeError('short');
    let v = 0; for (let i = 0; i < width; i++, pos++) v = (v << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
  try {
    const n = get(5);
    if (!isInt(n, 2, PZ_MAX_N)) return null;
    const T = n * n, p = makePuzzle(n), K = get(8);
    if (K < 2 || K > T) return null;
    for (let k = 1; k <= K; k++) { const c = get(bitsFor(T)); if (c >= T || p.cp[c]) return null; p.cp[c] = k; }
    const W = get(9); let prev = -1;
    for (let i = 0; i < W; i++) {
      const e = get(bitsFor(2 * T)), a = e >> 1;
      if (e <= prev || a >= T || (e & 1 ? ((a / n) | 0) >= n - 1 : a % n >= n - 1)) return null; // ascending, and between two cells
      prev = e; setWallId(p.walls, e, true);
    }
    if (bytes.length !== Math.ceil(pos / 8)) return null;
    for (; pos < bytes.length * 8; pos++) if ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1) return null; // padding is zero
    return p;
  } catch { return null; }
}

// ---------- the `s` byte and the skill bucket ----------
export const packS = (kind, skill) => KINDS.indexOf(kind) | ((isInt(skill, 0, 15) ? skill : UNKNOWN_SKILL) << 2);
export const unpackS = s => (isInt(s, 0, 255) && (s & 3) < KINDS.length ? { kind: KINDS[s & 3], skill: (s >> 2) & 15 } : null);

// How fast this player is: the median ms per cell of their last SKILL_WINDOW solved games without a hint (the local play log's records),
// in half-octave steps (x sqrt 2 per step) above SKILL_BASE_MS, clamped to 0..14; UNKNOWN_SKILL (15) below SKILL_MIN_GAMES games.
// It is not an identifier. It lets the analysis tell a slow player from a hard puzzle.
export function skillBucket(records) {
  const xs = (records || []).filter(r => r && r.solved && !r.hints && r.ms > 0 && r.n > 0).slice(-SKILL_WINDOW).map(r => r.ms / (r.n * r.n)).sort((a, b) => a - b);
  if (xs.length < SKILL_MIN_GAMES) return UNKNOWN_SKILL;
  const mid = xs.length >> 1, median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.max(0, Math.min(14, Math.round(2 * Math.log2(median / SKILL_BASE_MS))));
}

// ---------- which games become a row ----------
// game: { puzzle, mode: 'local' | 'gotd' | 'replay', day, ms, hints, hiddenMs, undone, maxUndone, skill, variant, shared, known }
//   variant  a Cutout game; shared  a local game opened from a link; known  a Game of Day this device already solved (a repeat knows the answer)
// cfg: { localSizes: [min, max], hiddenMaxMs }. -> the row, or null when the game is not uploaded:
// a solved game only (the caller sends nothing else), no variant, no hint, no more than hiddenMaxMs with the tab hidden (the timer keeps running
// in the background), no repeat of a known puzzle, and a local game only within localSizes and when its puzzle packs.
export function rowFromGame(g, cfg, now = Date.now()) {
  if (!g || !g.puzzle || g.variant || g.puzzle.holes || g.hints > 0 || !KINDS.includes(g.mode)) return null;
  if (g.hiddenMs > cfg.hiddenMaxMs || g.known || !(g.ms >= MIN_MS && g.ms <= MAX_MS)) return null;
  let pz = null;
  if (g.mode === 'local') {
    const [lo, hi] = cfg.localSizes;
    if (g.shared || g.puzzle.n < lo || g.puzzle.n > hi || !(pz = packPuzzle(g.puzzle))) return null;
  }
  const cap = v => Math.min(65535, Math.max(0, Math.round(v || 0)));
  return validateRow({ day: g.day, ms: Math.round(g.ms), u: cap(g.undone), deep: cap(g.maxUndone), s: packS(g.mode, g.skill), pz, ev: null, v: ROW_VERSION }, now);
}

// A stored row -> what it means (for the tools): { kind, skill, puzzle | null }. pz is decoded for a local row only.
export function describeRow(row) {
  const s = unpackS(row.s);
  return { kind: s ? s.kind : null, skill: s ? s.skill : null, puzzle: row.pz ? unpackPuzzle(row.pz) : null };
}
