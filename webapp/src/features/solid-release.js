// The release of the solid puzzles in the play app, by date (config.js SOLID_RELEASE). Pure: the day
// is a UTC day number (features/daily.js utcDayNumber), nothing is stored.
//
//   from `first`          the tetrahedron of size 2 is open to everyone (no other solid is)
//   first + tetra days    every tetrahedron size is open to everyone
//   first + cube days     the cube is open to everyone
//   first + ball days     the ball is open to everyone
//
// Before `first` no solid puzzle is shown or played (hold V still shows the card). A kind that is not
// open to everyone yet can be unlocked early through the lucky game (features/unlock.js), once the
// player has unlocked every flat variant.
import { SOLID_KINDS } from '../core/solid/kinds.js';

export { SOLID_KINDS };
// The sizes of a tetra or cube the play app offers (a ball is picked from the catalog instead).
export const SOLID_SIZES = { tetra: [2, 3, 4, 5], cube: [2, 3, 4] };
// The tetra sizes of the first stage.
export const FIRST_SIZES = [2];

const ymdOfDay = day => new Date(day * 86400000).toISOString().slice(0, 10).replaceAll('-', '');

// 'YYYYMMDD' (or the number) -> UTC day number; RangeError when it is no date.
export function dayOfYmd(ymd) {
  const text = String(ymd);
  const day = /^\d{8}$/.test(text)
    ? Date.UTC(+text.slice(0, 4), +text.slice(4, 6) - 1, +text.slice(6)) / 86400000
    : NaN;
  if (!Number.isInteger(day) || ymdOfDay(day) !== text) {
    throw new RangeError(`not a date (YYYYMMDD): ${ymd}`);
  }
  return day;
}

// The config -> { first, tetra, cube, ball }, each a day number (`tetra`: every tetra size, `cube`
// and `ball`: that kind); null when `first` is unset (nothing is released). Throws on a bad value.
export function releaseDays(cfg) {
  if (!cfg || cfg.first === null || cfg.first === undefined) {
    return null;
  }
  const first = dayOfYmd(cfg.first);
  const after = key => {
    const days = cfg[key];
    if (!Number.isInteger(days) || days < 0) {
      throw new RangeError(`SOLID_RELEASE.${key}: whole days, 0 or more, not ${days}`);
    }
    return first + days;
  };
  return { first, tetra: after('tetra'), cube: after('cube'), ball: after('ball') };
}

export const launched = (day, rel) => Boolean(rel) && day >= rel.first;

// What is open to everyone on `day`: 'none', 'part' (only the first sizes of a tetra) or 'all'.
export function stageOf(kind, day, rel) {
  if (!launched(day, rel)) {
    return 'none';
  }
  if (kind === 'tetra') {
    return day >= rel.tetra ? 'all' : 'part';
  }
  return day >= rel[kind] ? 'all' : 'none';
}

// The sizes of a tetra or cube open to everyone on `day`.
export function openSizes(kind, day, rel) {
  const stage = stageOf(kind, day, rel);
  if (stage === 'none') {
    return [];
  }
  return stage === 'part' ? FIRST_SIZES : SOLID_SIZES[kind];
}
