// The human-rating file format shared by the design app's export/import and every script in tools/ (tools/ratings.json,
// the single copy stored in git):
//   [{ "key": "<puzzle text>", "human": 2.75, "lo": 2, "hi": 3 }, ...]
//   key    the puzzle in format.js's plain text WITHOUT the "# ..." comment lines (see ratingKey)
//   human  the number a model is fitted to: the midpoint of [lo, hi], moved 0.25 toward the end you said it was "close to"
//   lo/hi  the range you actually stated ("2 or 3" -> 2, 3; "at least 4" -> 4, 5; an exact rating -> lo = hi)
// Pure functions only (no DOM, no storage) so the format is testable and the browser and Node read it the same way.
import { parse, serialize } from './format.js';

export const LEAN_STEP = 0.25;
const round2 = x => Math.round(x * 100) / 100;
const isGrade = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 5;

// Canonical key of a puzzle (a puzzle object, or any text parse() accepts, comments and all): "size N / checkpoints / walls".
export function ratingKey(p) {
  const puzzle = typeof p === 'string' ? parse(p) : p;
  return serialize(puzzle).split('\n').filter(l => !l.startsWith('#')).join('\n');
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
  const out = entries.map(e => ({ key: e.key, human: round2(e.human), lo: e.lo ?? e.human, hi: e.hi ?? e.human }));
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
    const r = { key, human: round2(human), lo, hi };
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
    if (at == null) { idx.set(r.key, out.length); out.push({ key: r.key, human: r.human, lo: r.lo, hi: r.hi, metrics: null }); added++; continue; }
    const old = out[at];
    updated++;
    if (old.human !== r.human || (old.lo ?? old.human) !== r.lo || (old.hi ?? old.human) !== r.hi) changed++;
    out[at] = { key: r.key, human: r.human, lo: r.lo, hi: r.hi, metrics: null };
  }
  return { entries: out, added, updated, changed };
}
