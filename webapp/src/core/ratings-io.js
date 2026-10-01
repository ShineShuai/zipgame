// The human-rating file format shared by the design app's export/import and every script in tools/ (tools/ratings.json,
// the single copy stored in git):
//   [{ "key": "<puzzle text>", "human": 2.75, "lo": 2, "hi": 3 }, ...]
//   key    the puzzle in format.js's plain text WITHOUT the "# ..." comment lines (see ratingKey)
//   human  the number a model is fitted to: the midpoint of [lo, hi], moved 0.25 toward the end you said it was "close to"
//   lo/hi  the range you actually stated ("2 or 3" -> 2, 3; "at least 4" -> 4, 5; an exact rating -> lo = hi)
//   unsure optional, only written when true: "I am not sure about this rating". A fit counts such a rating at UNSURE_WEIGHT.
// Also here: the comment grammar of difficulty_rate.txt (parseRatingComment) and duplicate detection (findDuplicateGroups).
// Pure functions only (no DOM, no storage) so the format is testable and the browser and Node read it the same way.
import { parse, serialize } from './format.js';
import { makePuzzle } from './model.js';
import { edgeCells, edgeId, wallIds, setWallId } from './edges.js';

export const UNSURE_WEIGHT = 0.5;
export const ratingWeight = r => (r && r.unsure ? UNSURE_WEIGHT : 1);

export const LEAN_STEP = 0.25;
const round2 = x => Math.round(x * 100) / 100;
const isGrade = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 5;

// Canonical key of a puzzle (a puzzle object, or any text parse() accepts, comments and all): "size N / checkpoints / walls".
export function ratingKey(p) {
  const puzzle = typeof p === 'string' ? parse(p) : p;
  return serialize(puzzle).split('\n').filter(l => !l.startsWith('#')).join('\n');
}

// Why a stored key is not in canonical form, in words ("" when it is canonical or does not parse). A key can parse fine and still
// differ from ratingKey(key): a "# ..." header from the app's text export, a "path ..." line from play mode, CRLF line endings,
// a trailing newline, other spacing, or walls / checkpoints written in another order (or the text format itself changed).
export function keyDifference(key) {
  let canon; try { canon = ratingKey(key); } catch { return ''; }
  if (canon === key) return '';
  if (/\r/.test(key)) return 'has Windows (CRLF) line endings inside the key';
  const lines = key.split('\n'), want = canon.split('\n');
  if (lines.some(l => l.trim().startsWith('#'))) return 'has "# ..." comment/header lines (the text the design app exports); the key is the 3 lines size / checkpoints / walls only';
  if (lines.some(l => /^\s*path\b/i.test(l))) return 'has a "path ..." line (play-mode export); the key does not include the path';
  if (key !== key.trim() || lines.some(l => l.trim() === '')) return 'has leading/trailing whitespace or blank lines';
  const i = lines.findIndex((l, j) => l !== want[j]);
  return i < 0 ? 'differs from the canonical text' : `line ${i + 1} is "${lines[i].slice(0, 60)}" but the canonical form is "${(want[i] ?? '').slice(0, 60)}" (different order or spacing)`;
}

// { lo, hi, lean } (lean: -1 closer to lo, 0 none, +1 closer to hi; only meaningful when lo < hi) -> { human, lo, hi }.
export function ratingFromSelection({ lo, hi, lean = 0 }) {
  if (lo > hi) [lo, hi] = [hi, lo];
  return { human: round2((lo + hi) / 2 + (lo < hi ? Math.sign(lean) * LEAN_STEP : 0)), lo, hi };
}

// Which end a stored rating leans toward (-1 / 0 / +1), read back from human vs the midpoint.
export function leanOf({ human, lo, hi }) {
  const d = human - (lo + hi) / 2;
  return lo < hi && Math.abs(d) > 1e-9 ? Math.sign(d) : 0;
}

// "2", "2 or 3", "2 or 3, close to 3", "3 to 5" — the way the ratings are written in comments.
export function describeRating(r) {
  const lo = r.lo ?? r.human, hi = r.hi ?? r.human;
  if (lo === hi) return `${lo}`;
  const lean = leanOf({ human: r.human, lo, hi });
  const base = hi - lo === 1 ? `${lo} or ${hi}` : `${lo} to ${hi}`;
  return lean ? `${base}, close to ${lean > 0 ? hi : lo}` : base;
}

// Log entries ({ key, human, lo?, hi?, metrics? }) -> the file text. Metrics are deliberately NOT exported: they are
// recomputed from the puzzle, so the file stays small, diff-friendly and valid after the grading code changes.
export function toRatingsJson(entries) {
  const out = entries.map(e => ({ key: e.key, human: round2(e.human), lo: e.lo ?? e.human, hi: e.hi ?? e.human, ...(e.unsure ? { unsure: true } : {}) }));
  return JSON.stringify(out, null, 1) + '\n';
}

// File text -> { ratings, problems }. Bad rows are reported by position and skipped; the good ones still import.
export function parseRatingsJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ratings: [], problems: [`not valid JSON (${e.message})`] }; }
  if (!Array.isArray(data)) return { ratings: [], problems: ['expected a JSON array of { key, human, lo?, hi? }'] };
  const ratings = [], problems = [], seen = new Map();
  data.forEach((row, i) => {
    const at = `#${i + 1}`;
    if (!row || typeof row !== 'object' || typeof row.key !== 'string') return problems.push(`${at}: missing "key"`);
    let key; try { key = ratingKey(row.key); } catch (e) { return problems.push(`${at}: puzzle does not parse (${e.message})`); }
    let { human, lo, hi } = row;
    if (human == null && lo != null && hi != null) human = (lo + hi) / 2;
    if (!isGrade(human)) return problems.push(`${at}: "human" must be a number 0-5`);
    lo = lo ?? human; hi = hi ?? human;
    if (!isGrade(lo) || !isGrade(hi) || lo > hi) return problems.push(`${at}: "lo"/"hi" must be numbers 0-5 with lo <= hi`);
    if (human < lo - 1e-9 || human > hi + 1e-9) return problems.push(`${at}: "human" ${human} is outside [${lo}, ${hi}]`);
    if (row.unsure != null && typeof row.unsure !== 'boolean') return problems.push(`${at}: "unsure" must be true or false`);
    const r = { key, human: round2(human), lo, hi, ...(row.unsure ? { unsure: true } : {}) };
    if (seen.has(key)) { ratings[seen.get(key)] = r; problems.push(`${at}: same puzzle as #${seen.get(key) + 1}, the later one wins`); return; }
    seen.set(key, ratings.length); ratings.push(r);
  });
  return { ratings, problems };
}

// Merge imported ratings into a log: same puzzle -> the imported rating replaces the stored one (re-importing an edited export
// updates it, never duplicates). Entries not in the file are kept. `metrics` is dropped for every imported puzzle so the caller
// recomputes it with the current grading code.
// -> { entries, added, updated, changed } (changed = updated ones whose human/lo/hi actually differ).
export function mergeRatings(entries, ratings) {
  const out = entries.map(e => ({ ...e })), idx = new Map(out.map((e, i) => [e.key, i]));
  let added = 0, updated = 0, changed = 0;
  for (const r of ratings) {
    const at = idx.get(r.key);
    if (at == null) { idx.set(r.key, out.length); out.push({ key: r.key, human: r.human, lo: r.lo, hi: r.hi, ...(r.unsure ? { unsure: true } : {}), metrics: null }); added++; continue; }
    const old = out[at];
    updated++;
    if (old.human !== r.human || (old.lo ?? old.human) !== r.lo || (old.hi ?? old.human) !== r.hi || !!old.unsure !== !!r.unsure) changed++;
    out[at] = { key: r.key, human: r.human, lo: r.lo, hi: r.hi, ...(r.unsure ? { unsure: true } : {}), metrics: null };
  }
  return { entries: out, added, updated, changed };
}

// ---- the comment grammar of difficulty_rate.txt ----------------------------------------------------------------------------------
// One comment (the text before a puzzle block) -> { ok:true, human, lo, hi, unsure, form } or { ok:false, why }.
// New, explicit form (preferred):        human 2, range 2-3            range 2-3            human 2
//                                        human 2.5, range 2-3, unsure  (parts in any order; "sure" is the default)
// Older forms (still read, same numbers as before):
//   this is 2                            -> 2            range 2-2
//   this is 2 or 3                       -> 2.5          range 2-3
//   this is 2 or 3, close to 3           -> 2.75         range 2-3   (halfway from the midpoint to the end it is close to)
//   this is at least 3, close to 4 (or 4)-> 4            range 3-5   (at least N: range N-5)
//   this is at least 4                   -> 4            range 4-5   (the bound itself is the likely value; 5 is rare)
//   this is at most 1                    -> 0.5          range 0-1   (midpoint of 0..N)
//   this is 1 or 0 (either order) · close to 3 (-> 3) · at most 2, close to 1 or rather 1 (-> exactly 1)
// Ignored chatter: a leading "this one is / it is / this can be", grade words (easy, medium, hard, expert, ...), and trailing
// "you graded as 3", "not 4" / "but not hard 3", "instead of 1", "more than 0", "it is ok". Anything else is an error, never a guess.
const NUM = '(?:[0-5](?:\\.\\d+)?)';
const WORD = '(?:warm-?up|easy|medium|hard|expert|brutal)';
const CHATTER = new RegExp(`(?:[.;,]?\\s*(?:you graded as\\s*${NUM}(?:\\/5)?|(?:but\\s+)?not\\s+(?:${WORD}\\s+)?${NUM}|instead of\\s+${NUM}(?:\\s+${WORD})?|more than\\s+${NUM}|it is ok))+\\s*\\.?$`);
const LEGACY = new RegExp(`^(?:(at least|at most)\\s+(${NUM})|(${NUM})(?:\\s+or\\s+(${NUM}))?|close to\\s+(${NUM}))(?:,?\\s*close to\\s+(${NUM})(?:\\s+or\\s+(rather\\s+)?(${NUM}))?)?\\.?$`);

export function parseRatingComment(text) {
  let s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(/^(?:also\s+)?(?:this one|this|it)\s*(?:is|can be)?\s+(?:also\s+)?/, '').replace(CHATTER, '').replace(new RegExp(`\\b${WORD}\\b`, 'g'), '').replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').replace(/^[.;,\s]+/, '');
  if (!s) return { ok: false, why: 'empty comment' };
  const bad = why => ({ ok: false, why });
  if (/\b(human|range|unsure|sure)\b/.test(s)) { // explicit form
    let human = null, lo = null, hi = null, unsure = false, seen = new Set();
    for (const part of s.split(/\s*[;,]\s*/).filter(Boolean)) {
      let m;
      if ((m = part.match(new RegExp(`^human\\s+(${NUM})$`)))) { if (seen.has('human')) return bad('"human" given twice'); seen.add('human'); human = +m[1]; }
      else if ((m = part.match(new RegExp(`^range\\s+(${NUM})(?:\\s*(?:-|–|—|to)\\s*(${NUM}))?$`)))) { if (seen.has('range')) return bad('"range" given twice'); seen.add('range'); lo = +m[1]; hi = m[2] == null ? lo : +m[2]; }
      else if (part === 'unsure') unsure = true;
      else if (part === 'sure') unsure = false;
      else return bad(`cannot read "${part}" (expected human N, range A-B, unsure)`);
    }
    if (human == null && lo == null) return bad('needs "human N" and/or "range A-B"');
    if (lo == null) { lo = human; hi = human; }
    if (lo > hi) return bad(`range ${lo}-${hi}: the lower end must come first`);
    if (human == null) human = (lo + hi) / 2;
    if (human < lo - 1e-9 || human > hi + 1e-9) return bad(`human ${human} is outside range ${lo}-${hi}`);
    return { ok: true, human: round2(human), lo, hi, unsure, form: 'explicit' };
  }
  const m = s.match(LEGACY);
  if (!m) return bad(`not a rating comment: "${String(text).trim().slice(0, 60)}"`);
  const [, kind, bound, a, b, bare, c, rather, c2] = m;
  if (bare != null) return { ok: true, human: +bare, lo: +bare, hi: +bare, unsure: false, form: 'legacy' }; // "close to 3" on its own: 3
  let lo, hi, human;
  if (kind === 'at least') { lo = +bound; hi = 5; human = lo; }
  else if (kind === 'at most') { lo = 0; hi = +bound; human = hi / 2; }
  else { lo = Math.min(+a, b == null ? +a : +b); hi = Math.max(+a, b == null ? +a : +b); human = (lo + hi) / 2; }
  if (c != null) {
    if (c2 != null && !rather && +c2 !== +c) return bad(`"close to ${c} or ${c2}" is ambiguous`);
    if (+c < lo || +c > hi) return bad(`"close to ${c}" is outside the range ${lo}-${hi}`);
    if (rather) { if (+c2 < lo || +c2 > hi) return bad(`"or rather ${c2}" is outside the range ${lo}-${hi}`); lo = hi = human = +c2; } // "close to 1 or rather 1": it is 1
    else { human = ((lo + hi) / 2 + +c) / 2; if (kind === 'at least' && lo === hi) human = lo; }
  }
  return { ok: true, human: round2(human), lo, hi, unsure: false, form: 'legacy' };
}

// ---- duplicates ------------------------------------------------------------------------------------------------------------------
// The same puzzle rated twice counts twice in every fit, and a puzzle mirrored / rotated / played backwards is the same puzzle to
// the solver. So besides EXACT duplicates (identical key) we look for EQUIVALENT ones: equal up to the 8 rotations/reflections of the
// board and up to reversing the checkpoint numbering (K..1 instead of 1..K).
export function transformPuzzle(p, k, reverse) { // k = 0..7: (k & 3) quarter-turns, then a mirror if k & 4
  const n = p.n, q = makePuzzle(n), K = Math.max(0, ...p.cp);
  const map = cell => {
    let r = (cell / n) | 0, c = cell % n;
    if (k & 4) c = n - 1 - c;
    for (let i = 0; i < (k & 3); i++) [r, c] = [c, n - 1 - r];
    return r * n + c;
  };
  for (let i = 0; i < n * n; i++) if (p.cp[i]) q.cp[map(i)] = reverse ? K + 1 - p.cp[i] : p.cp[i];
  for (const e of wallIds(p)) { const [a, b] = edgeCells(n, e); setWallId(q.walls, edgeId(n, map(a), map(b)), true); }
  return q;
}
// Smallest key over the 16 variants: equal for puzzles that are the same up to the symmetries above.
export function symmetryKey(keyOrPuzzle) {
  const p = typeof keyOrPuzzle === 'string' ? parse(keyOrPuzzle) : keyOrPuzzle;
  let best = null;
  for (const rev of [false, true]) for (let k = 0; k < 8; k++) { const key = ratingKey(transformPuzzle(p, k, rev)); if (best === null || key < best) best = key; }
  return best;
}

// items: [{ key, ... }] (any order). Returns { exact: [[index, ...], ...], equivalent: [[index, ...], ...] }: groups of size >= 2 only.
// `exact` = identical keys; `equivalent` = different keys, same symmetryKey (a group lists every member, exact copies included).
// Items whose key does not parse are skipped (parseRatingsJson / the tools report those separately).
export function findDuplicateGroups(items) {
  const byKey = new Map(), bySym = new Map();
  items.forEach((it, i) => {
    let key; try { key = ratingKey(it.key); } catch { return; }
    (byKey.get(key) || byKey.set(key, []).get(key)).push(i);
    let sk; try { sk = symmetryKey(key); } catch { return; }
    (bySym.get(sk) || bySym.set(sk, []).get(sk)).push(i);
  });
  const exact = [...byKey.values()].filter(g => g.length > 1);
  const equivalent = [...bySym.values()].filter(g => g.length > 1 && new Set(g.map(i => ratingKey(items[i].key))).size > 1);
  return { exact, equivalent };
}

// A small text picture of a puzzle for reports ("which puzzle is this?"): checkpoint numbers, . for empty cells, | and _ for walls.
export function asciiPuzzle(keyOrPuzzle) {
  const p = typeof keyOrPuzzle === 'string' ? parse(keyOrPuzzle) : keyOrPuzzle, n = p.n, w = Math.max(2, String(Math.max(0, ...p.cp)).length), lines = [];
  for (let r = 0; r < n; r++) {
    let row = '', under = '';
    for (let c = 0; c < n; c++) {
      const i = r * n + c, v = p.cp[i], wall = p.walls[i];
      row += (v ? String(v) : '.').padStart(w) + (c < n - 1 ? (wall & 1 ? '|' : ' ') : '');
      under += (wall & 2 ? '_'.repeat(w) : ' '.repeat(w)) + ' ';
    }
    lines.push(row); if (r < n - 1) lines.push(under.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
