// The size of each automatic Game of Day and the seeds of its candidates (tools/gotd-gen.mjs). PURE: no clock, no files and nothing
// from the generator, so the schedule never changes when the generator does. A day's size is a function of the date alone.
//
// Sizes come from a shuffled bag per cycle of CYCLE_DAYS days (cycle = floor(day / CYCLE_DAYS), day = UTC day number): every cycle holds
// SIZE_BAG[n] days of size n, in an order drawn from a stream seeded by the cycle number. The share of each size is therefore exact (no
// lucky or unlucky month), and an order is only accepted when it has
//   - no two days of size >= BIG_SIZE less than BIG_GAP days apart, none at the first or last position (so the rule also holds across two cycles),
//   - no run of three days of one size, and no equal pair at the first or last two positions (so a run of three cannot cross a cycle).
// Changing SIZE_BAG, CYCLE_DAYS, SCHEDULE_SALT or the rules above changes every FUTURE size; the golden schedule in test/gotd-gen.js
// pins the current one, so such a change is deliberate. Days already published keep their file, whatever the schedule says.
import { makeRng, shuffle, hashStr } from './rng.js';

export const GOTD_SIZES = [6, 7, 8, 9, 10, 11];
export const CYCLE_DAYS = 28;
// Days per cycle: 7 and 8 most often, 6 and 9 less, 10 and 11 occasionally (11 about once in 14 days).
export const SIZE_BAG = { 6: 3, 7: 8, 8: 8, 9: 4, 10: 3, 11: 2 };
export const BIG_SIZE = 10;
export const BIG_GAP = 3; // days from one big size to the next, at least
export const SCHEDULE_SALT = 'gotd-size-v1';

const MS_PER_DAY = 86400000;
// 'YYYYMMDD' <-> UTC day number (the same days as features/daily.js: utcDayNumber / dateOfDay).
export function dayOfDate(date) {
  if (!/^\d{8}$/.test(date)) throw new Error(`not a YYYYMMDD date: ${JSON.stringify(date)}`);
  const y = +date.slice(0, 4), m = +date.slice(4, 6), d = +date.slice(6, 8), t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) throw new Error(`not a calendar date: ${date}`);
  return Math.floor(t / MS_PER_DAY);
}
export const dateOfDay = day => {
  const d = new Date(day * MS_PER_DAY);
  return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
};

const bagList = bag => Object.keys(bag).map(Number).sort((a, b) => a - b).flatMap(n => Array(bag[n]).fill(n));

// Is this order of one cycle acceptable (see the rules above)?
export function orderOk(seq) {
  const L = seq.length;
  if (seq[0] >= BIG_SIZE || seq[L - 1] >= BIG_SIZE || seq[0] === seq[1] || seq[L - 1] === seq[L - 2]) return false;
  let lastBig = -BIG_GAP;
  for (let i = 1; i < L; i++) {
    if (seq[i] >= BIG_SIZE) {
      if (i - lastBig < BIG_GAP) return false;
      lastBig = i;
    }
    if (i >= 2 && seq[i] === seq[i - 1] && seq[i] === seq[i - 2]) return false;
  }
  return true;
}

// The sizes of cycle number `cycle`, in day order. `bag` is only for tests.
export function cycleOrder(cycle, bag = SIZE_BAG) {
  const base = bagList(bag);
  if (base.length !== CYCLE_DAYS) throw new Error(`SIZE_BAG holds ${base.length} days, a cycle has ${CYCLE_DAYS}`);
  const rnd = makeRng(parseInt(hashStr(`${SCHEDULE_SALT}:${cycle}`), 16));
  for (let tries = 0; tries < 10000; tries++) {
    const seq = shuffle(base.slice(), rnd);
    if (orderOk(seq)) return seq;
  }
  throw new Error(`no acceptable order for cycle ${cycle}`);
}

const orders = new Map();
export function sizeForDay(day) {
  const cycle = Math.floor(day / CYCLE_DAYS);
  let order = orders.get(cycle);
  if (!order) orders.set(cycle, order = cycleOrder(cycle));
  return order[day - cycle * CYCLE_DAYS];
}

// The seed of attempt number `attempt` for the slot (day, size) under generator stamp `stamp` (core/gotd-gen.js genStamp): FNV-1a of the
// four values as text. The same arguments give the same seed on every machine; a new stamp gives new puzzles for every slot.
export const slotSeed = (stamp, day, size, attempt) => parseInt(hashStr(`${stamp}|${day}|${size}|${attempt}`), 16);
