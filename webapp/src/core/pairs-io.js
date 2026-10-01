// Pairwise judgements: "this puzzle is harder / easier / the same as the previous one". Pure functions, shared by the design app
// and tools/ (tools/pairs.json is the copy stored in git).
//   [{ "a": "<puzzle key>", "b": "<puzzle key>", "cmp": "harder" }, ...]     cmp describes B relative to A:
//   "harder" = B is harder than A, "easier" = B is easier than A, "same" = about equally hard.
// Why pairs next to ratings: a pair only says which of two puzzles is harder, so it does not depend on what a "2" meant on the day
// you rated it, and it is evaluated by RANKING accuracy (pairAccuracy) rather than by distance to a grade.
import { ratingKey } from './ratings-io.js';

export const CMPS = ['harder', 'same', 'easier'];
export const cmpSign = cmp => (cmp === 'harder' ? 1 : cmp === 'easier' ? -1 : 0);
export const flipCmp = cmp => (cmp === 'harder' ? 'easier' : cmp === 'easier' ? 'harder' : 'same');
// Order-independent id of a pair (A,B) == (B,A).
export const pairKeyOf = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

export function toPairsJson(pairs) {
  return JSON.stringify(pairs.map(p => ({ a: p.a, b: p.b, cmp: p.cmp })), null, 1) + '\n';
}

// -> { pairs, problems }. Bad rows are skipped and reported by position; a pair repeated later replaces the earlier one (later wins).
export function parsePairsJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { pairs: [], problems: [`not valid JSON (${e.message})`] }; }
  if (!Array.isArray(data)) return { pairs: [], problems: ['expected a JSON array of { a, b, cmp }'] };
  const pairs = [], problems = [], at = new Map();
  data.forEach((row, i) => {
    const w = `#${i + 1}`;
    if (!row || typeof row !== 'object' || typeof row.a !== 'string' || typeof row.b !== 'string') return problems.push(`${w}: needs "a" and "b" (puzzle texts)`);
    if (!CMPS.includes(row.cmp)) return problems.push(`${w}: "cmp" must be one of ${CMPS.join(', ')}`);
    let a, b; try { a = ratingKey(row.a); b = ratingKey(row.b); } catch (e) { return problems.push(`${w}: puzzle does not parse (${e.message})`); }
    if (a === b) return problems.push(`${w}: a puzzle cannot be compared with itself`);
    const id = pairKeyOf(a, b), p = { a, b, cmp: row.cmp };
    if (at.has(id)) { const old = pairs[at.get(id)], same = (old.a === a ? old.cmp : flipCmp(old.cmp)) === p.cmp; pairs[at.get(id)] = p; problems.push(`${w}: same pair as #${at.get(id) + 1}, ${same ? 'the later copy wins' : 'with a DIFFERENT verdict; the later one wins'}`); return; }
    at.set(id, pairs.length); pairs.push(p);
  });
  return { pairs, problems };
}

// Merge imported pairs into a log: the same pair (either orientation) is replaced by the imported verdict. Extra fields on stored
// pairs (cached grades) are dropped for replaced pairs so the caller regrades them. -> { pairs, added, updated, changed }
export function mergePairs(log, incoming) {
  const out = log.map(p => ({ ...p })), at = new Map(out.map((p, i) => [pairKeyOf(p.a, p.b), i]));
  let added = 0, updated = 0, changed = 0;
  for (const p of incoming) {
    const id = pairKeyOf(p.a, p.b), i = at.get(id);
    if (i == null) { at.set(id, out.length); out.push({ a: p.a, b: p.b, cmp: p.cmp }); added++; continue; }
    const old = out[i]; updated++;
    if ((old.a === p.a ? old.cmp : flipCmp(old.cmp)) !== p.cmp) changed++;
    out[i] = { a: p.a, b: p.b, cmp: p.cmp };
  }
  return { pairs: out, added, updated, changed };
}

// Ranking accuracy of any per-puzzle number f (a grade, a metric). valueOf(key) -> number | undefined (pairs with a missing value
// are skipped and counted). For every decided pair (harder/easier) f must order the two puzzles the same way; a tie in f scores 0.5.
// "same" pairs are scored separately: how often f gives both puzzles the same value.
// -> { decided, correct (0.5 per tie), accuracy, ties, sameN, sameTied, skipped }
export function pairAccuracy(pairs, valueOf) {
  let decided = 0, correct = 0, ties = 0, sameN = 0, sameTied = 0, skipped = 0;
  for (const p of pairs) {
    const fa = valueOf(p.a), fb = valueOf(p.b);
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) { skipped++; continue; }
    if (p.cmp === 'same') { sameN++; if (fa === fb) sameTied++; continue; }
    decided++;
    const d = Math.sign(fb - fa);
    if (d === 0) { ties++; correct += 0.5; } else if (d === cmpSign(p.cmp)) correct += 1;
  }
  return { decided, correct, accuracy: decided ? correct / decided : NaN, ties, sameN, sameTied, skipped };
}

// Pairs implied by ratings whose stated ranges do not overlap (A rated 1-2, B rated 3 -> B is harder): the ranking view of the same
// labels, so every metric also gets a ranking-accuracy score before any explicit pair exists. `ratings`: [{ key, lo, hi, human }].
export function impliedPairs(ratings) {
  const out = [];
  for (let i = 0; i < ratings.length; i++) for (let j = i + 1; j < ratings.length; j++) {
    const a = ratings[i], b = ratings[j];
    if (b.lo > a.hi) out.push({ a: a.key, b: b.key, cmp: 'harder' }); else if (b.hi < a.lo) out.push({ a: a.key, b: b.key, cmp: 'easier' });
  }
  return out;
}
