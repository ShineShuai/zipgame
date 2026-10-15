// Design-app logs on this device: the rating log (one entry per rated puzzle) and the pair log (harder / easier verdicts). Both grow until cleared,
// and used to store, per entry, the puzzle text, every metric name and long floats. Now:
// Metric values are rounded to 6 significant digits.
//   rating log, zip-difficulty-rating-log-v2 = { v: 2, m: [metric names], e: [[key, human, lo, hi, unsure (0|1), [values by name] | null, extra?]] }
//   pair log,   zip-difficulty-pair-log-v2   = { v: 2, m: [names], p: [[puzzle key, [values] | null]], q: [[a index, b index, cmp]] }
// A puzzle that appears in several pairs is stored once, with the metrics of its latest pair (the pair table reads them the same way: last wins).
// In memory the shapes are the old ones: entries { key, human, lo, hi, unsure?, metrics }, pairs { a, b, cmp, ma, mb }.
// The v1 keys are converted on the first load (the conversion window runs until 2026-10-29 or later) and removed once the v2 value is read back.
import { pickStorage, migrateKey } from '../platform/storage.js';

export const RATING_KEY = 'zip-difficulty-rating-log-v2', RATING_KEY_V1 = 'zip-difficulty-rating-log-v1';
export const PAIR_KEY = 'zip-difficulty-pair-log-v2', PAIR_KEY_V1 = 'zip-difficulty-pair-log-v1';

// metrics objects -> a names table, and back by that table.
function namesOf(objs) { const names = []; for (const o of objs) if (o) for (const k of Object.keys(o)) if (!names.includes(k)) names.push(k); return names; }
// Metric values are kept to 6 significant digits (a relative error of 5e-7: far below what a correlation or a ranking can see). They are
// derived data: the design app regrades a puzzle from its text on import.
const r6 = v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(6)) : v);
const row = (o, names) => (o ? names.map(k => (k in o ? r6(o[k]) : null)) : null);
const rowBack = (vals, names) => (Array.isArray(vals) ? Object.fromEntries(names.flatMap((k, i) => (vals[i] === null || vals[i] === undefined ? [] : [[k, vals[i]]]))) : null);

const RATING_FIELDS = ['key', 'human', 'lo', 'hi', 'unsure', 'metrics'];
export function packRatings(entries) {
  const m = namesOf(entries.map(e => e.metrics));
  return { v: 2, m, e: entries.map(e => {
    const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !RATING_FIELDS.includes(k))), t = [e.key, e.human, e.lo ?? null, e.hi ?? null, e.unsure ? 1 : 0, row(e.metrics, m)];
    return Object.keys(extra).length ? [...t, extra] : t;
  }) };
}
export function unpackRatings(raw) {
  if (Array.isArray(raw)) return raw;                            // a v1 value is the list itself
  if (!raw || raw.v !== 2 || !Array.isArray(raw.m) || !Array.isArray(raw.e)) return [];
  return raw.e.filter(t => Array.isArray(t) && typeof t[0] === 'string').map(t => {
    const e = { key: t[0], human: t[1] };
    if (t[2] !== null && t[2] !== undefined) { e.lo = t[2]; e.hi = t[3]; }
    if (t[4]) e.unsure = true;
    return { ...(t[6] || {}), ...e, metrics: rowBack(t[5], raw.m) };
  });
}

export function packPairs(pairs) {
  const m = namesOf(pairs.flatMap(q => [q.ma, q.mb])), index = new Map(), p = [];
  const at = (key, metrics) => {
    let i = index.get(key); if (i === undefined) { i = p.length; index.set(key, i); p.push([key, null]); }
    if (metrics) p[i][1] = row(metrics, m);
    return i;
  };
  const q = pairs.map(x => [at(x.a, x.ma), at(x.b, x.mb), x.cmp]);
  return { v: 2, m, p, q };
}
export function unpackPairs(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || raw.v !== 2 || !Array.isArray(raw.m) || !Array.isArray(raw.p) || !Array.isArray(raw.q)) return [];
  const metrics = raw.p.map(t => rowBack(t[1], raw.m));
  return raw.q.filter(t => raw.p[t[0]] && raw.p[t[1]]).map(([a, b, cmp]) => ({ a: raw.p[a][0], b: raw.p[b][0], cmp, ma: metrics[a], mb: metrics[b] }));
}

// -> the value of `key` after a v1 -> v2 conversion; a value that is not JSON reads as empty.
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
async function load(key, legacy, unpack, pack) {
  const storage = await pickStorage();
  await migrateKey(storage, legacy, key, text => JSON.stringify(pack(unpack(parse(text)))));
  const r = await storage.get(key);
  return r ? unpack(parse(r.value)) : [];
}
export const loadRatings = () => load(RATING_KEY, RATING_KEY_V1, unpackRatings, packRatings);
export const loadPairs = () => load(PAIR_KEY, PAIR_KEY_V1, unpackPairs, packPairs);
export async function saveRatings(entries) { await (await pickStorage()).set(RATING_KEY, JSON.stringify(packRatings(entries))); }
export async function savePairs(pairs) { await (await pickStorage()).set(PAIR_KEY, JSON.stringify(packPairs(pairs))); }
