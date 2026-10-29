// The offer days: on which local days a theme is offered. Pure and stateless: the offer days of
// a month are a function of the year and the month alone, so every device agrees and nothing is
// stored. What happens on such a day (the chip, the trial) is src/themes/index.js.
//
// The rule is public, the secret is a set of four digits S (config.js THEMES.digits). The value
// of a date is
//     (day xor month xor last digit of the year) mod 16
// (xor: the bitwise exclusive or; mod 16: keep the last four bits). A day is a candidate when
// its value is a digit of S, so a player can work S out from the offer days by calculating their
// values. Every month has 7-8 candidates, over the whole month, and they change with the month
// and the year. From the candidates the month's seed (a hash of the year and the month) draws
// the offer days:
//   1. a first day, any candidate with the same chance;
//   2. with a chance of SECOND_CHANCE a second day, any candidate at least MIN_GAP days away from
//      the first.
import { hash } from './event.js';

export const SECOND_CHANCE = 0.25;
export const MIN_GAP = 10;

// mulberry32: a small seeded generator; every call gives a number in [0, 1)
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = n => String(n).padStart(2, '0');

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// four different digits
export const validDigits = digits => Array.isArray(digits)
  && digits.length === 4
  && new Set(digits).size === 4
  && digits.every(d => Number.isInteger(d) && d >= 0 && d <= 9);

// month: 1..12
export const dateValue = (year, month, day) => (day ^ month ^ (year % 10)) & 15;

// The days (1-based, ascending) of a month whose value is one of `digits`.
export function candidates(year, month, digits) {
  const secret = new Set(digits);
  const days = [];
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    if (secret.has(dateValue(year, month, day))) days.push(day);
  }
  return days;
}

// The offer days of a month, ascending: one or two of the candidates.
export function monthPlan(year, month, digits) {
  const days = candidates(year, month, digits);
  if (!days.length) return [];
  const random = mulberry32(hash(`ev|${year}-${month}`));
  const more = random();
  const first = random();
  const second = random();
  const firstDay = days[Math.floor(first * days.length)];
  const plan = [firstDay];
  if (more < SECOND_CHANCE) {
    const apart = days.filter(day => Math.abs(day - firstDay) >= MIN_GAP);
    if (apart.length) plan.push(apart[Math.floor(second * apart.length)]);
  }
  return plan.sort((a, b) => a - b);
}

// A date worked through by hand, for the rule text (src/themes/offer.js ruleHtml). Its value is 10
// or more, which is no digit, so it is no offer day and shows nothing of the secret.
export function ruleExample(year = 2031, month = 6, day = 27) {
  const last = year % 10;
  const first = day ^ month;
  const xor = first ^ last;
  return {
    date: `${year}-${pad(month)}-${pad(day)}`, day, month, last, first, xor, value: xor & 15,
  };
}

// The offer day of a local date (a Date: its local year, month and day count), or null:
// { id, year, month, day }. The id names the event for the offer ('d20271129'), see EVENT_RE.
export function eventAt(date, digits) {
  if (!validDigits(digits)) return null;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (!monthPlan(year, month, digits).includes(day)) return null;
  return {
    id: `d${year}${pad(month)}${pad(day)}`, year, month, day,
  };
}
