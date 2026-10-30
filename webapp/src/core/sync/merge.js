// How the copies of one key held by the devices of a sync group become ONE value.
//
// Each device offers its own copy of every synced key (slice.js). Nothing is written back
// into the local keys: a feature reads `view(entries, self)`, the group's value, computed on
// every read from the device's own copy plus the other devices' copies, and writes only its
// own copy. That keeps "what this device did" apart from "what the group did", which is what
// lets additive data (statistics, counters) be merged without ever counting a game twice.
//
// A rule is { clean, view, shrink? }:
//   clean(value)   a copy as it came from storage or from another device -> the same copy,
//                  cleaned, or null when it is not one of this key
//   view(entries, self)  entries = [{ dev, value }] (cleaned, one per device, sorted by `dev`
//                  so that every device folds them in the same order and gets the same
//                  result), self = this device's id -> the group's value, in the shape of one copy
//   shrink(value)  optional: a smaller copy that lost what matters least (slice.js)
// Every rule is a function of the SET of entries: the order they arrived in, and a copy that
// arrived twice, change nothing. Not synced (kept on each device): the play log, the
// behaviour upload and its switch, the theme choice and the theme trial, the device seed
// of the theme offers, the shared games, the hints and the co-op game and its statistics.
import { GIFT_KEY, KINDS } from '../../features/gift.js';
import { CREDIT_KEY } from '../../features/replay.js';
import { RULES_SEEN_KEY } from '../../features/rules-seen.js';
import { GOTD_KEY, STATS_KEY } from '../../features/stats-store.js';
import { FREEZE_EVERY, RAMP, STREAK_KEY } from '../../features/streak.js';
import { PLAYED_KEPT, UNLOCK_KEY } from '../../features/unlock.js';

export const RECENT_MAX = 20; // the recent times a statistic keeps (core/stats.js)

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const natural = value => Number.isInteger(value) && value >= 0;
const finite = Number.isFinite;
// Names that become keys of a plain object: scope ids, variant ids, dates.
const safeKey = key => /^[\w-]{1,40}$/.test(key) && key !== '__proto__';
const sum = (entries, field) => entries.reduce((total, entry) => total + entry.value[field], 0);
const keysOf = (entries, field) => [...new Set(entries.flatMap(e => Object.keys(e.value[field])))];

// ---- statistics: zip_stats_v2 { v: 2, t, d, b } ------------------------------------------
// t: per scope [n, mean, M2, recent], all-time. d: per scope [day, n, mean, M2, recent],
// today's. b: per size [date, time], the Game-of-Day time.

const statOf = a => (Array.isArray(a) && a.length === 4 && a.slice(0, 3).every(finite)
  && a[0] > 0 && Array.isArray(a[3]) && a[3].every(finite)
  ? { n: a[0], mean: a[1], M2: a[2], recent: a[3].slice() } : null);
const packStat = st => [st.n, st.mean, st.M2, st.recent];
const todayOf = a => {
  const stat = Array.isArray(a) && finite(a[0]) ? statOf(a.slice(1)) : null;
  return stat && { day: a[0], stat };
};

// The statistic of two disjoint sets of games (Chan et al.'s parallel update of Welford's).
function combine(a, b) {
  if (!a) {
    return b;
  }
  const n = a.n + b.n;
  const delta = b.mean - a.mean;
  return {
    n,
    mean: a.mean + (delta * b.n) / n,
    M2: a.M2 + b.M2 + (delta * delta * a.n * b.n) / n,
    recent: [...a.recent, ...b.recent].slice(-RECENT_MAX),
  };
}

const stats = {
  clean(value) {
    const shaped = value && value.v === 2
      && [value.t, value.d, value.b].every(isObject);
    if (!shaped) {
      return null;
    }
    const t = {};
    const d = {};
    const b = {};
    for (const [key, a] of Object.entries(value.t)) {
      const stat = safeKey(key) && statOf(a);
      if (stat) {
        t[key] = packStat(stat);
      }
    }
    for (const [key, a] of Object.entries(value.d)) {
      const today = safeKey(key) && todayOf(a);
      if (today) {
        d[key] = [today.day, ...packStat(today.stat)];
      }
    }
    for (const [key, a] of Object.entries(value.b)) {
      if (safeKey(key) && Array.isArray(a) && a.length === 2 && a[0] != null && finite(a[1])) {
        b[key] = [a[0], a[1]];
      }
    }
    return { v: 2, t, d, b };
  },
  view(entries) {
    const t = {};
    const d = {};
    const b = {};
    for (const key of keysOf(entries, 't')) {
      const total = entries.reduce((acc, e) => {
        const stat = statOf(e.value.t[key]);
        return stat ? combine(acc, stat) : acc;
      }, null);
      if (total) {
        t[key] = packStat(total);
      }
    }
    for (const key of keysOf(entries, 'd')) { // only the newest day: older ones are never shown
      const days = entries.map(e => todayOf(e.value.d[key])).filter(Boolean);
      const newest = Math.max(...days.map(x => x.day));
      const total = days.filter(x => x.day === newest)
        .reduce((acc, x) => combine(acc, x.stat), null);
      if (total) {
        d[key] = [newest, ...packStat(total)];
      }
    }
    for (const key of keysOf(entries, 'b')) { // the newest date; on the same date the best time
      const [date, time] = entries.map(e => e.value.b[key]).filter(Boolean)
        .reduce((best, x) => (String(x[0]) > String(best[0])
          || (String(x[0]) === String(best[0]) && x[1] < best[1]) ? x : best));
      b[key] = [date, time];
    }
    return { v: 2, t, d, b };
  },
  // The recent times are only for show: the slice keeps its statistics without them.
  shrink: value => ({
    ...value,
    t: Object.fromEntries(Object.entries(value.t).map(([k, a]) => [k, [...a.slice(0, 3), []]])),
    d: Object.fromEntries(Object.entries(value.d).map(([k, a]) => [k, [...a.slice(0, 4), []]])),
  }),
};

// ---- Game-of-Day records: zip_gotd_v2 { v: 2, a: { <YYYYMMDD>: record }, n } ----------------
// record = { solved, time, sent?, stats? }. A device's own solved record always stands for its
// own date (it carries `sent`, the submit still to be retried, which is nobody else's business).
// Otherwise the fastest solved record of the others fills the date, without `sent`; otherwise
// a record that is not solved (abandoned) is kept as it is. n, the number of dates solved in
// total, only grows: the largest n, or the dates the records show, if more.

const isRecord = r => isObject(r) && typeof r.solved === 'boolean';
const byTime = (x, y) => (x.rec.time - y.rec.time) || (x.dev < y.dev ? -1 : 1);

const gotd = {
  clean(value) {
    if (!value || value.v !== 2 || !isObject(value.a)) {
      return null;
    }
    const a = {};
    for (const [date, rec] of Object.entries(value.a)) {
      if (/^\d{8}$/.test(date) && isRecord(rec)) {
        a[date] = { ...rec };
      }
    }
    return { v: 2, a, n: natural(value.n) ? value.n : 0 };
  },
  view(entries, self) {
    const a = {};
    for (const date of keysOf(entries, 'a')) {
      const recs = entries.filter(e => e.value.a[date])
        .map(e => ({ dev: e.dev, rec: e.value.a[date] }));
      const mine = recs.find(r => r.dev === self);
      const others = recs.filter(r => r.dev !== self && r.rec.solved && finite(r.rec.time));
      if (mine && mine.rec.solved) {
        a[date] = mine.rec;
      } else if (others.length) {
        const rec = { ...others.sort(byTime)[0].rec };
        delete rec.sent;
        a[date] = rec;
      } else {
        a[date] = (mine || recs[0]).rec;
      }
    }
    const solved = Object.values(a).filter(r => r.solved).length;
    return { v: 2, a, n: Math.max(solved, ...entries.map(e => e.value.n)) };
  },
};

// ---- streak: zip_streak (features/streak.js) ----------------------------------------------
// A state machine, not a sum: the group's state is the one that has got furthest (the latest
// solve day, then the longer streak, then more rewards), and the best streak is the best of all.

const needFor = earned => RAMP[earned] ?? FREEZE_EVERY;
const validGap = b => isObject(b) && [b.from, b.to, b.a, b.e, b.p].every(natural)
  && b.to > b.from + 1 && typeof b.frozen === 'boolean' && Array.isArray(b.healed)
  && b.healed.every(Number.isInteger) && (b.x === undefined || natural(b.x));
const farther = (x, y) => (y.value.last ?? -1) - (x.value.last ?? -1)
  || y.value.streak - x.value.streak || y.value.earned - x.value.earned
  || (x.dev < y.dev ? -1 : 1);

const streak = {
  clean(value) {
    if (!isObject(value) || ![value.streak, value.best, value.freezes].every(natural)
      || !(value.last === null || Number.isInteger(value.last))) {
      return null;
    }
    const old = value.earned === undefined; // a state saved before rewards were counted
    const earned = old ? RAMP.length : value.earned;
    const prog = old ? value.streak % FREEZE_EVERY : value.prog;
    if (!natural(earned) || !natural(prog) || prog >= needFor(earned)) {
      return null;
    }
    return { ...value, earned, prog, brk: validGap(value.brk) ? value.brk : null };
  },
  view(entries) {
    const first = [...entries].sort(farther)[0];
    return { ...first.value, best: Math.max(...entries.map(e => e.value.best)) };
  },
};

// ---- unlock chances and unlocked variants: zip_unlock (features/unlock.js) -----------------
// unlocked: every variant any device unlocked, on the earliest day. tokens and choices are
// counters of what each device earned minus what it spent, so the group's count is their sum
// (never below 0: two devices that spent the same chance cost the next one earned). The
// offers played are all offers played anywhere. The game in progress belongs to its device.

const unlock = {
  clean(value) {
    if (!isObject(value) || value.v !== 1 || !isObject(value.unlocked)) {
      return null;
    }
    const tokens = Array.isArray(value.tokens) ? value.tokens.length : value.tokens;
    const played = value.played === undefined ? [] : value.played;
    if (!Number.isInteger(tokens) || !Number.isInteger(value.choices)
      || !Array.isArray(played) || !played.every(natural)) {
      return null;
    }
    const unlocked = {};
    for (const [id, day] of Object.entries(value.unlocked)) {
      if (safeKey(id) && natural(day)) {
        unlocked[id] = day;
      }
    }
    return {
      v: 1, unlocked, tokens, choices: value.choices, played: played.slice(), active: null,
    };
  },
  view(entries) {
    const unlocked = {};
    for (const id of keysOf(entries, 'unlocked')) {
      unlocked[id] = Math.min(...entries.map(e => e.value.unlocked[id]).filter(natural));
    }
    const played = [...new Set(entries.flatMap(e => e.value.played))].sort((a, b) => a - b);
    return {
      v: 1,
      unlocked,
      tokens: Math.max(0, sum(entries, 'tokens')),
      choices: Math.max(0, sum(entries, 'choices')),
      played: played.slice(-PLAYED_KEPT),
      active: null,
    };
  },
};

// ---- replay chances: zip_gotd_credit { solved, used, bonus } -------------------------------
// Three counters that only grow on each device: the group's are their sums.

const credit = {
  clean(value) {
    if (!isObject(value) || !natural(value.solved) || !natural(value.used)
      || !(value.bonus === undefined || natural(value.bonus))) {
      return null;
    }
    return { solved: value.solved, used: value.used, bonus: value.bonus ?? 0 };
  },
  view: entries => ({
    solved: sum(entries, 'solved'), used: sum(entries, 'used'), bonus: sum(entries, 'bonus'),
  }),
};

// ---- the happiest-day gift: zip_gift { v, day, kind } --------------------------------------
// Opened once per happiest day, wherever: the record of the latest day.

const gift = {
  clean(value) {
    if (!isObject(value) || value.v !== 1) {
      return null;
    }
    if (value.day === null) {
      return { v: 1, day: null, kind: null };
    }
    return natural(value.day) && KINDS.includes(value.kind)
      ? { v: 1, day: value.day, kind: value.kind } : null;
  },
  view: entries => [...entries].sort(
    (x, y) => (y.value.day ?? -1) - (x.value.day ?? -1) || (x.dev < y.dev ? -1 : 1),
  )[0].value,
};

// ---- rules shown: zip_rules_seen { v, seen: { id: true } } ---------------------------------

const rulesSeen = {
  clean(value) {
    if (!isObject(value) || value.v !== 1 || !isObject(value.seen)) {
      return null;
    }
    const seen = {};
    for (const [id, flag] of Object.entries(value.seen)) {
      if (safeKey(id) && flag === true) {
        seen[id] = true;
      }
    }
    return { v: 1, seen };
  },
  view: entries => ({ v: 1, seen: Object.assign({}, ...entries.map(e => e.value.seen)) }),
};

export const MERGES = Object.freeze({
  [STATS_KEY]: stats,
  [GOTD_KEY]: gotd,
  [STREAK_KEY]: streak,
  [UNLOCK_KEY]: unlock,
  [CREDIT_KEY]: credit,
  [GIFT_KEY]: gift,
  [RULES_SEEN_KEY]: rulesSeen,
});

export const SYNCED_KEYS = Object.freeze(Object.keys(MERGES));
export const SHRINKS = Object.freeze(Object.fromEntries(
  Object.entries(MERGES)
    .filter(([, rule]) => rule.shrink)
    .map(([key, rule]) => [key, rule.shrink]),
));
