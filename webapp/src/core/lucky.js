// Lucky day: the one day of every week (Monday to Sunday, UTC) on which an unlock chance can be
// played. The winner of a week is the day whose number climbs highest on its Collatz path: halve
// an even number, triple an odd one and add 1, repeat until 1; the highest number met on the way
// is the day's peak, the earlier day wins a tie. The number of a day is its day count since
// 1970-01-01 (UTC), the same number features/daily.js utcDayNumber returns.
//
// Pure and stateless: nothing is stored, every player gets the same days, and the dates move
// every year because the same calendar date has a different number each year. A week is decided
// by 7 paths of ~100 steps each (~10 microseconds). One lucky day per week means the gap between
// two lucky days is 1..13 days, so any 14 days in a row contain one.
//
// Each lucky day opens an offer (the lucky game, features/unlock.js) that lasts until the next
// lucky day replaces it, but at least OFFER_DAYS days.

export const WEEK_START = 4; // day 0 (1970-01-01) was a Thursday, so the first Monday is day 4 (1970-01-05):
// counting weeks from day 4 makes them run Monday to Sunday (from day 0 they would run Thursday to Wednesday)
export const OFFER_DAYS = 3;
export const STEP_CAP = 10000; // a path is far shorter (at most 559 steps below 3,000,000)

// The highest number on the Collatz path of n (n itself when the path never climbs).
export function collatzPeak(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a positive integer: ${n}`);
  let peak = n;
  for (let steps = 0; n !== 1; steps++) {
    if (steps >= STEP_CAP) throw new RangeError(`no end after ${STEP_CAP} steps: ${n}`);
    n = n % 2 ? 3 * n + 1 : n / 2;
    if (n > peak) peak = n;
  }
  return peak;
}

export const weekOf = day => Math.floor((day - WEEK_START) / 7); // for days >= WEEK_START
export const weekDays = week => Array.from({ length: 7 }, (_, i) => WEEK_START + 7 * week + i);

// The 7 days of a week with their peaks and the winner flagged: [{ day, peak, lucky }].
export function weekTable(week) {
  const rows = weekDays(week).map(day => ({ day, peak: collatzPeak(day), lucky: false }));
  const best = rows.reduce((a, r) => (r.peak > a.peak ? r : a), rows[0]);
  best.lucky = true;
  return rows;
}

export const luckyDayOf = week => weekTable(week).find(r => r.lucky).day;
export const isLucky = day => luckyDayOf(weekOf(day)) === day;

// The latest lucky day on or before `day`.
export function lastLucky(day) {
  const week = weekOf(day), lucky = luckyDayOf(week);
  return lucky <= day ? lucky : luckyDayOf(week - 1);
}

// The first lucky day after `day`.
export function nextLucky(day) {
  const week = weekOf(day), lucky = luckyDayOf(week);
  return lucky > day ? lucky : luckyDayOf(week + 1);
}

// The first day on which the offer of lucky day `lucky` is no longer open: the next lucky day
// replaces it, but never sooner than OFFER_DAYS days after it began.
export const offerEnd = lucky => Math.max(nextLucky(lucky), lucky + OFFER_DAYS);

// The offers open on `day`, oldest first, each named by its lucky day. The latest lucky day's offer
// is always open; an earlier one is still open when the next lucky day came less than OFFER_DAYS
// days after it.
export function activeOffers(day) {
  const offers = [];
  for (let lucky = lastLucky(day); day < offerEnd(lucky); lucky = lastLucky(lucky - 1)) offers.unshift(lucky);
  return offers;
}
