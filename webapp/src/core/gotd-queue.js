// The candidate queue of the automatic Game of Day (tools/gotd-gen.mjs): the index file, which days need candidates, and the loop that makes them.
// Pure: no files, no clock (the tool passes `today`); the generator is a parameter so tests can stand in for it.
//
// demo/GameOfDay-queue/index.json (written by `gotd-gen.mjs fill`, one candidate per line so a diff stays readable):
//   { "v": 1,
//     "slots": { "YYYYMMDD": { "size": 8, "attempts": 5 } },   generator runs spent on a day; a rerun continues after them, never repeats them
//     "candidates": [ { id, file, size, slot, attempt, seed, stamp, status, K, walls, pathKey, trap: {...}, corr: {...} } ] }
// status: pending (made, not reviewed), approved / rejected (a human's verdict, written by the review step that comes after this one).
// A candidate is made FOR a day (`slot`), but any day of the same size may use it: a day that was published by other means hands its
// candidates on (planFill `adopt`).
import { dateOfDay, dayOfDate, sizeForDay } from './gotd-schedule.js';
import { GOTD_CFG, makeCandidate } from './gotd-gen.js';

export const INDEX_VERSION = 1;
export const STATUSES = ['pending', 'approved', 'rejected'];
export const emptyIndex = () => ({ v: INDEX_VERSION, slots: {}, candidates: [] });

const byOrder = (a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.attempt - b.attempt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function formatIndex(ix) {
  const slots = Object.keys(ix.slots).sort().map(d => `    ${JSON.stringify(d)}: ${JSON.stringify(ix.slots[d])}`);
  const cands = [...ix.candidates].sort(byOrder).map(c => `    ${JSON.stringify(c)}`);
  return `{\n  "v": ${ix.v},\n  "slots": {${slots.length ? '\n' + slots.join(',\n') + '\n  ' : ''}},\n  "candidates": [${cands.length ? '\n' + cands.join(',\n') + '\n  ' : ''}]\n}\n`;
}

// Throws an Error that names what is wrong. A missing file is the caller's business (emptyIndex()).
export function parseIndex(text) {
  let ix;
  try { ix = JSON.parse(text); } catch (e) { throw new Error(`index.json is not valid JSON (${e.message})`); }
  const bad = msg => { throw new Error(`index.json: ${msg}`); };
  if (!ix || ix.v !== INDEX_VERSION) bad(`"v" must be ${INDEX_VERSION}`);
  if (!ix.slots || typeof ix.slots !== 'object' || Array.isArray(ix.slots)) bad('"slots" must be an object');
  for (const [d, s] of Object.entries(ix.slots)) {
    if (!/^\d{8}$/.test(d)) bad(`slot key ${JSON.stringify(d)} is not YYYYMMDD`);
    if (!Number.isInteger(s?.size) || !Number.isInteger(s?.attempts) || s.attempts < 0) bad(`slot ${d} needs integer "size" and "attempts"`);
  }
  if (!Array.isArray(ix.candidates)) bad('"candidates" must be an array');
  const ids = new Set();
  ix.candidates.forEach((c, i) => {
    const at = `candidate #${i + 1}`;
    if (!c || typeof c.id !== 'string' || !/^[0-9a-f]{12}$/.test(c.id)) bad(`${at}: "id" must be 12 hex digits`);
    if (ids.has(c.id)) bad(`${at}: id ${c.id} appears twice`);
    ids.add(c.id);
    if (!Number.isInteger(c.size) || !/^\d{8}$/.test(c.slot) || !Number.isInteger(c.attempt) || !Number.isInteger(c.seed)) bad(`${at} (${c.id}): size, slot, attempt, seed`);
    if (typeof c.stamp !== 'string' || !STATUSES.includes(c.status)) bad(`${at} (${c.id}): stamp, status (${STATUSES.join(' | ')})`);
    if (c.file !== `c-${c.size}-${c.id}.txt`) bad(`${at} (${c.id}): "file" must be c-<size>-<id>.txt`);
  });
  return ix;
}

// A pending candidate counts only under the generator stamp it was made with: after a refit its grade is a claim of the old model.
// An approved one always counts (a human judged it); a rejected one never does.
export const usable = (c, stamp) => c.status === 'approved' || (c.status === 'pending' && c.stamp === stamp);

// Which days need how many candidates.
//   today      UTC day number          horizon  days from today that get candidates      perSlot  candidates wanted per open day
//   published  Set of 'YYYYMMDD' that already have a Game-of-Day file (those days are closed)
// -> { slots: [{ day, date, size, have, need, attempts }] (open days, earliest first), adopt: [{ id, slot }] }
// `adopt`: candidates made for a day that is published or past now move to the earliest open day of their size that still lacks some.
export function planFill({ today, horizon = GOTD_CFG.horizon, perSlot = GOTD_CFG.perSlot, published, index, stamp }) {
  const open = [];
  for (let day = today; day < today + horizon; day++) {
    const date = dateOfDay(day);
    if (!published.has(date)) open.push({ day, date, size: sizeForDay(day) });
  }
  const openDates = new Set(open.map(s => s.date));
  const live = index.candidates.filter(c => usable(c, stamp));
  const stale = c => !openDates.has(c.slot) && (published.has(c.slot) || dayOfDate(c.slot) < today);
  const orphans = live.filter(stale).sort(byOrder), adopt = [];
  const slots = open.map(s => {
    let have = live.filter(c => c.slot === s.date).length;
    while (have < perSlot) {
      const i = orphans.findIndex(c => c.size === s.size);
      if (i < 0) break;
      adopt.push({ id: orphans.splice(i, 1)[0].id, slot: s.date });
      have++;
    }
    return { ...s, have, need: Math.max(0, perSlot - have), attempts: index.slots[s.date]?.attempts ?? 0 };
  });
  return { slots, adopt };
}

// Runs the generator for the slots that need candidates, earliest day first.
//   maxNew          most candidates this run may add             maxAttempts    most generator runs this run may spend
//   slotAttempts    most runs one day may use in all (counted over all runs: index.slots[date].attempts); a day that used them up is `starved`
//   make            ({ stamp, day, date, size, attempt, distinct }) -> makeCandidate's answer
// -> { added: [{ entry, puzzle, symKey, path }], slots: { date: { size, attempts } } (days whose counter moved), fails: { reason: count }, starved: [date], tries }
export function fillQueue({ plan, distinct, stamp, maxNew = 24, maxAttempts = 120, slotAttempts = GOTD_CFG.maxAttemptsPerSlot, make = makeCandidate, log = () => {} }) {
  const added = [], slots = {}, fails = {}, starved = [];
  let tries = 0;
  for (const s of plan.slots) {
    let need = s.need, attempts = s.attempts;
    while (need > 0 && added.length < maxNew && tries < maxAttempts && attempts < slotAttempts) {
      const attempt = attempts++;
      tries++;
      const r = make({ stamp, day: s.day, date: s.date, size: s.size, attempt, distinct });
      if (!r.ok) {
        fails[r.reason] = (fails[r.reason] || 0) + 1;
        log(`${s.date} ${s.size}x${s.size} attempt ${attempt}: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`);
        continue;
      }
      distinct.add({ symKey: r.symKey, pathKey: r.entry.pathKey, where: `queue candidate ${r.entry.id}` });
      added.push({ entry: r.entry, puzzle: r.puzzle, symKey: r.symKey, path: r.path });
      log(`${s.date} ${s.size}x${s.size} attempt ${attempt}: ${r.entry.id} grade ${r.entry.trap.grade} score ${r.entry.trap.pred}`);
      need--;
    }
    if (attempts !== s.attempts) slots[s.date] = { size: s.size, attempts };
    if (need > 0 && attempts >= slotAttempts) starved.push(s.date);
  }
  return { added, slots, fails, starved, tries };
}

// The index after a fill: adoptions applied, counters moved, the new candidates added.
export function applyFill(index, plan, result) {
  const adopt = new Map(plan.adopt.map(a => [a.id, a.slot]));
  return {
    v: INDEX_VERSION,
    slots: { ...index.slots, ...result.slots },
    candidates: [...index.candidates.map(c => (adopt.has(c.id) ? { ...c, slot: adopt.get(c.id) } : c)), ...result.added.map(a => a.entry)].sort(byOrder),
  };
}

// Which approved candidate takes which open day: from today up to `horizon` days, a day without a file gets an approved candidate of its size, the one made for
// that day first, else the earliest. -> [{ day, date, size, id }], id = null when no approved candidate of that size is left.
export function planPromote({ today, horizon = GOTD_CFG.horizon, published, index }) {
  const approved = index.candidates.filter(c => c.status === 'approved').sort(byOrder), taken = new Set(), plan = [];
  for (let day = today; day < today + horizon; day++) {
    const date = dateOfDay(day);
    if (published.has(date)) continue;
    const size = sizeForDay(day), pool = approved.filter(c => c.size === size && !taken.has(c.id)), pick = pool.find(c => c.slot === date) || pool[0] || null;
    if (pick) taken.add(pick.id);
    plan.push({ day, date, size, id: pick ? pick.id : null });
  }
  return plan;
}
