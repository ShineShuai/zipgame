// What a human says about a Game-of-Day candidate, and what follows from it. Pure: shared by the design app's review panel and tools/gotd-gen.mjs.
//
// demo/GameOfDay-queue/verdicts.json  { "v": 1, "verdicts": [ one per line ] }, one verdict per candidate id:
//   { id, size, stamp, model: { grade, pred }, human, lo, hi, unsure?, solved, playS?, takebacks, verdict: 'approve' | 'reject', at }
//   human / lo / hi / unsure   the rating on the 0-5 scale of ratings.json (a single grade, or two neighbouring grades with a lean)
//   solved / playS / takebacks the reviewer solved it blind (or gave up), how long it took in seconds, how many path cells were taken back
//   model                      what the trap model said (hidden while reviewing): the pair (model, human) is what a later calibration needs
//   verdict                    approve when the rating is APPROVE_MIN (Hard) or more, else reject
// Two copies of the file (two browsers) merge by id: the newer `at` wins, a tie goes to reject. The file only grows; a verdict stays after its candidate has
// been published or rejected (the graduation gate counts the history).
import { ratingFromSelection } from './ratings-io.js';

export const VERDICTS_VERSION = 1;
export const APPROVE_MIN = 3;
export const GRADE_NAMES = ['Warm-up', 'Easy', 'Medium', 'Hard', 'Expert', 'Brutal'];
export const VERDICTS = ['approve', 'reject'];

// ---- the rating widget: the same rules as the difficulty panel's (click a grade; a neighbour makes "2 or 3"; then which one it is closer to) ----
// sel = { lo, hi, lean, unsure } or null. Clicking the single selected grade again removes the rating.
export function nextSelection(sel, g) {
  const keep = { unsure: !!(sel && sel.unsure) };
  if (sel && sel.lo === sel.hi && sel.lo === g) return null;
  if (sel && sel.lo === sel.hi && Math.abs(g - sel.lo) === 1) return { lo: Math.min(g, sel.lo), hi: Math.max(g, sel.lo), lean: 0, ...keep };
  return { lo: g, hi: g, lean: 0, ...keep };
}
export const nextLean = (sel, d) => (sel && sel.hi - sel.lo === 1 ? { ...sel, lean: sel.lean === d ? 0 : d } : sel);
export const toggleUnsure = sel => (sel ? { ...sel, unsure: !sel.unsure } : sel);
export const decide = rating => (rating.human >= APPROVE_MIN ? 'approve' : 'reject');

// Counts the path cells a solver took back: note(length) after every change of the path; a shorter path adds the difference.
export function createTakebacks() {
  let prev = 0, total = 0;
  return {
    note(length) { if (length < prev) total += prev - length; prev = length; },
    reset() { prev = 0; total = 0; },
    get total() { return total; },
  };
}

const round1 = x => Math.round(x * 10) / 10;

// candidate = an index entry; sel = the widget's selection; now = an ISO time 'YYYY-MM-DDTHH:MM:SSZ' (the caller's clock: this module has none)
export function makeVerdict({ candidate, sel, solved, playS, takebacks, now }) {
  if (!sel) throw new Error('no rating');
  const r = ratingFromSelection(sel);
  return {
    id: candidate.id, size: candidate.size, stamp: candidate.stamp, model: { grade: candidate.trap.grade, pred: candidate.trap.pred },
    human: r.human, lo: r.lo, hi: r.hi, ...(sel.unsure ? { unsure: true } : {}),
    solved: !!solved, ...(playS != null ? { playS: round1(playS) } : {}), takebacks: takebacks | 0,
    verdict: decide(r), at: now,
  };
}

// '' when the verdict is well formed, else what is wrong with it.
export function verdictProblem(v) {
  if (!v || typeof v !== 'object') return 'not an object';
  if (typeof v.id !== 'string' || !/^[0-9a-f]{12}$/.test(v.id)) return '"id" must be 12 hex digits';
  if (!VERDICTS.includes(v.verdict)) return `"verdict" must be ${VERDICTS.join(' or ')}`;
  const grade = x => typeof x === 'number' && x >= 0 && x <= 5;
  if (!grade(v.human) || !grade(v.lo) || !grade(v.hi) || v.lo > v.hi) return '"human", "lo", "hi" must be numbers from 0 to 5 with lo <= hi';
  if (typeof v.solved !== 'boolean') return '"solved" must be true or false';
  if (v.playS !== undefined && !(typeof v.playS === 'number' && v.playS >= 0)) return '"playS" must be a number of seconds';
  if (!Number.isInteger(v.takebacks) || v.takebacks < 0) return '"takebacks" must be a whole number';
  if (typeof v.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v.at)) return '"at" must be an ISO time like 2026-11-05T10:11:12Z';
  return '';
}

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const formatVerdicts = list => `{\n  "v": ${VERDICTS_VERSION},\n  "verdicts": [${list.length ? '\n' + [...list].sort(byTime).map(v => `    ${JSON.stringify(v)}`).join(',\n') + '\n  ' : ''}]\n}\n`;

// Throws an Error that names what is wrong (a missing file is the caller's business: no verdicts yet).
export function parseVerdicts(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`verdicts.json is not valid JSON (${e.message})`); }
  const bad = msg => { throw new Error(`verdicts.json: ${msg}`); };
  if (!data || data.v !== VERDICTS_VERSION) bad(`"v" must be ${VERDICTS_VERSION}`);
  if (!Array.isArray(data.verdicts)) bad('"verdicts" must be an array');
  const seen = new Set();
  data.verdicts.forEach((v, i) => {
    const problem = verdictProblem(v);
    if (problem) bad(`verdict #${i + 1}${v && v.id ? ` (${v.id})` : ''}: ${problem}`);
    if (seen.has(v.id)) bad(`verdict #${i + 1}: id ${v.id} appears twice`);
    seen.add(v.id);
  });
  return data.verdicts;
}

// One verdict per id: the newer `at` wins, a tie goes to reject, else to `a`.
export function mergeVerdicts(a, b) {
  const byId = new Map(a.map(v => [v.id, v]));
  for (const v of b) {
    const old = byId.get(v.id);
    if (!old || v.at > old.at || (v.at === old.at && v.verdict === 'reject' && old.verdict !== 'reject')) byId.set(v.id, v);
  }
  return [...byId.values()].sort(byTime);
}

// The candidates a reviewer still has to look at, soonest day first: pending, of the current generator stamp, without a verdict yet.
// Funnel: a day that already has an approved candidate (in the index or by a verdict) keeps its other candidates in reserve (`reserve: true` lists them last).
export function reviewQueue(index, verdicts, stamp, { reserve = false } = {}) {
  const said = new Map(verdicts.map(v => [v.id, v.verdict]));
  const approvedSlots = new Set(index.candidates.filter(c => c.status === 'approved' || said.get(c.id) === 'approve').map(c => c.slot));
  const open = index.candidates.filter(c => c.status === 'pending' && c.stamp === stamp && !said.has(c.id));
  const order = (a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.attempt - b.attempt || (a.id < b.id ? -1 : 1));
  const first = open.filter(c => !approvedSlots.has(c.slot)).sort(order);
  return reserve ? [...first, ...open.filter(c => approvedSlots.has(c.slot)).sort(order)] : first;
}

// The index with the verdicts applied: approved / rejected candidates change their status. -> { index, changed: [{ id, from, to }] }. Idempotent.
export function applyVerdicts(index, verdicts) {
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const changed = [];
  const candidates = index.candidates.map(c => {
    const v = byId.get(c.id);
    if (!v) return c;
    const status = v.verdict === 'approve' ? 'approved' : 'rejected';
    if (c.status === status) return c;
    changed.push({ id: c.id, from: c.status, to: status });
    return { ...c, status };
  });
  return { index: { ...index, candidates }, changed };
}

// Review numbers per generator stamp, for the graduation gate: reviewed, approved, rated below Hard, and the largest gap between model and human.
export function reviewStats(verdicts) {
  const by = {};
  for (const v of verdicts) {
    const s = by[v.stamp || '?'] ||= { reviewed: 0, approved: 0, rejected: 0, sumErr: 0, worst: 0 };
    s.reviewed++;
    s[v.verdict === 'approve' ? 'approved' : 'rejected']++;
    if (v.model) { const e = v.human - v.model.grade; s.sumErr += e; if (Math.abs(e) > Math.abs(s.worst)) s.worst = e; }
  }
  return by;
}
