// Happiest day: the one day of every calendar month (UTC) on which the gift (features/gift.js) can be
// opened. Pure and stateless: the days are a function of the reference day `ref` (config.js
// SOLID_RELEASE.first, as a UTC day number) alone. Players are never told what ref is: the gift's tooltip
// lists the latest happiest days, and from those a player can work ref out (recentGifts).
//
// The number of a day is n = (days since ref) + C, so ref is day 1. Replace a number by the sum of the
// squares of its digits, again and again: a number that reaches 1 is happy, and the steps it took are
// its score (1 takes 0 steps, 13 -> 10 -> 1 takes 2). The happiest day of a month is the one that
//   1. is happy (a month without a happy number falls back to: reaches 1 or repeats a number),
//   2. needs the fewest steps (until 1, or until a number repeats),
//   3. has the chain that climbs highest (n itself counts),
//   4. comes first.
// The month of ref has no happiest day (it would always be ref itself, 0 steps, which would give ref away):
// the first one is in the next month, and every month from then on is a whole calendar month. Key 3 leaves a
// tie (settled by key 4) in at most 1 of 120 months; with key 4 alone about 46 of 120 tie. From n = 244 on the
// chain never exceeds n, so key 3 then means "the later day".
export const C = 1;
const DAY_MS = 86400000;

const digitSquares = n => {
  let sum = 0;
  for (; n > 0; n = Math.floor(n / 10)) sum += (n % 10) ** 2;
  return sum;
};

// The chain of n: { happy, steps, peak } (peak = the highest number on it, n included). It ends at 1, or
// where a number comes up for the second time (every unhappy chain runs into the cycle 4 16 37 58 89 145 42 20).
export function chain(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a positive integer: ${n}`);
  const seen = new Set([n]);
  let steps = 0, peak = n;
  for (let x = n; x !== 1;) {
    x = digitSquares(x);
    steps++;
    peak = Math.max(peak, x);
    if (seen.has(x)) return { happy: false, steps, peak };
    seen.add(x);
  }
  return { happy: true, steps, peak };
}

const firstOfMonth = (day, add = 0) => {
  const d = new Date(day * DAY_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) / DAY_MS;
};

// The days of the month of `day` with their chains: [{ day, n, happy, steps, peak }]. Empty unless the month
// starts after ref (the month of ref, and the ones before it, have no happiest day).
export function monthRows(ref, day) {
  const rows = [];
  if (firstOfMonth(day) <= ref) return rows;
  for (let d = firstOfMonth(day); d < firstOfMonth(day, 1); d++) {
    rows.push({ day: d, n: d - ref + C, ...chain(d - ref + C) });
  }
  return rows;
}

const beats = (a, b) => (a.happy !== b.happy ? a.happy
  : a.steps !== b.steps ? a.steps < b.steps
    : a.peak !== b.peak ? a.peak > b.peak : a.day < b.day);

// The happiest day of the month of `day`; null in the month of ref and before it (or when ref is not set).
export function giftDay(ref, day) {
  if (ref === null || ref === undefined) return null;
  const best = monthRows(ref, day).reduce((a, r) => (!a || beats(r, a) ? r : a), null);
  return best && best.day;
}

export const isGiftDay = (ref, day) => giftDay(ref, day) === day;

// The latest happiest day on or before `day`; null while there is none yet.
export function lastGift(ref, day) {
  const g = giftDay(ref, day);
  return g !== null && g <= day ? g : giftDay(ref, firstOfMonth(day) - 1);
}

// The latest `count` happiest days on or before `day`, oldest first (fewer when there are not that many yet).
export function recentGifts(ref, day, count) {
  const out = [];
  for (let g = lastGift(ref, day); g !== null && out.length < count; g = lastGift(ref, g - 1)) out.unshift(g);
  return out;
}

// Everything about the gift on `day`, for the dev note (hold V): { ref, n (this day's number), chain (its chain, null before ref),
// first, last, next, today (is it a happiest day), count (happiest days so far), upcoming (the next `upcoming` ones) }; null when
// ref is not set.
export function giftInfo(ref, day, upcoming = 6) {
  if (ref === null || ref === undefined) return null;
  const n = day - ref + C, ahead = [];
  for (let g = nextGift(ref, day); g !== null && ahead.length < upcoming; g = nextGift(ref, g)) ahead.push(g);
  return {
    ref, n, chain: n >= 1 ? chain(n) : null, first: firstGift(ref), last: lastGift(ref, day), next: nextGift(ref, day),
    today: isGiftDay(ref, day), count: recentGifts(ref, day, 100000).length, upcoming: ahead,
  };
}

// The very first happiest day: in the month after the month of ref; null when ref is not set.
export const firstGift = ref => (ref === null || ref === undefined ? null : giftDay(ref, firstOfMonth(ref, 1)));

// The first happiest day after `day`; null when ref is not set.
export function nextGift(ref, day) {
  const first = firstGift(ref);
  if (first === null || day < first) return first;
  const g = giftDay(ref, day);
  return g > day ? g : giftDay(ref, firstOfMonth(day, 1));
}
