import { utcDayNumber } from './daily.js';

// Play streak: consecutive UTC days with at least one solved puzzle (local, Game of Day or replay alike).
// Rewards: a freeze (at most FREEZE_MAX are kept) and, in the app, one replay or unlock chance. A player's k-th reward comes after
// RAMP[k] streak days (2, 3, 5: new players get their first ones fast), every FREEZE_EVERY days once the ramp is used up. The days
// since the last reward are the progress; a restart of the streak resets the progress, never the number of rewards earned.
// A freeze covers one missed day, so the streak survives a gap of up to `freezes` days; a longer gap restarts it at 1.
// Healing: replaying the Game of Day of a missed day (replay.js) turns that day into a solve day: the streak counts it (+1), the freeze it
// cost comes back (never above FREEZE_MAX), and a streak the gap had broken is joined again. While a gap stays broken, the healed days
// right before the day the new streak started (the unbroken run ending at brk.to - 1) count into that streak, +1 day each. Only the
// latest gap can be healed, and a missed day only up to HEAL_DAYS days after it.
// State: { last: UTC day number of the last solve | null, streak, best, freezes, earned (rewards so far), prog (progress), brk }.
// brk = the latest gap, or null: { from, to (the solve days around it; the missed days are from+1 .. to-1), a, e, p (streak, earned and
//   prog before it), frozen (freezes covered it; else it broke the streak), healed (its days healed so far),
//   x (a broken gap: how many of the healed days right before `to` are already counted in the streak; absent = 0) }.
export const RAMP = [2, 3, 5], FREEZE_EVERY = 7, FREEZE_MAX = 2, HEAL_DAYS = 7;
const GAP_MAX = HEAL_DAYS + FREEZE_MAX; // a longer gap can never be repaired (at most 2 days stay for the freezes): nothing is kept
const KEY = 'zip_streak';

export const fresh = () => ({ last: null, streak: 0, best: 0, freezes: 0, earned: 0, prog: 0, brk: null });
export const needFor = earned => RAMP[earned] ?? FREEZE_EVERY; // streak days the next reward needs
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// (earned, prog) after `days` more streak days: a reward each time the progress reaches the days the next one needs.
function advance(earned, prog, days) {
  for (let i = 0; i < days; i++) if (++prog >= needFor(earned)) { earned++; prog = 0; }
  return { earned, prog };
}

// State after a solve on UTC day `day` (pure; the same state back when that day is already counted).
export function play(s, day) {
  if (s.last !== null && day <= s.last) return s;
  const gap = s.last === null ? Infinity : day - s.last - 1; // missed days in between
  const keep = gap <= s.freezes; // the freezes cover the gap
  let brk = s.brk && day - (s.brk.to - 1) <= HEAL_DAYS ? s.brk : null;
  if (gap > 0) brk = gap <= GAP_MAX ? { from: s.last, to: day, a: s.streak, e: s.earned, p: s.prog, frozen: keep, healed: [] } : null;
  const { earned, prog } = advance(s.earned, keep ? s.prog : 0, 1);
  const streak = keep ? s.streak + 1 : 1, spent = keep ? gap : 0;
  const freezes = Math.min(FREEZE_MAX, s.freezes - spent + earned - s.earned);
  return { last: day, streak, best: Math.max(s.best, streak), freezes, earned, prog, brk };
}

// The missed days that can be healed on `today`, newest first: the days since the last solve, else those of the latest gap.
export function healable(s, today) {
  if (s.last === null) return [];
  const open = s.last < today - 1, b = s.brk;
  const days = open ? (today - 1 - s.last <= GAP_MAX ? range(s.last + 1, today - 1) : [])
    : b ? range(b.from + 1, b.to - 1).filter(d => !b.healed.includes(d)) : [];
  return days.filter(d => today - d <= HEAL_DAYS).reverse();
}

// How many days in a row, ending the day before `to`, are in `healed`.
const runBefore = (healed, to) => { let n = 0; while (healed.includes(to - 1 - n)) n++; return n; };

// A gap that stays broken: its healed days right before its end day `brk.to` (where the streak began again) belong to that streak. The
// ones not counted yet (brk.x) are: +1 streak day each, and each is a day of reward progress. -> { state, rewards } (the same state back
// when there is nothing to count). Also repairs a state saved by a version that did not count them.
export function extend(s) {
  const b = s.brk, more = b && !b.frozen ? runBefore(b.healed, b.to) - (b.x ?? 0) : 0;
  if (more <= 0) return { state: s, rewards: 0 };
  const { earned, prog } = advance(s.earned, s.prog, more), streak = s.streak + more;
  const freezes = Math.min(FREEZE_MAX, s.freezes + earned - s.earned);
  return { state: { ...s, streak, best: Math.max(s.best, streak), freezes, earned, prog, brk: { ...b, x: (b.x ?? 0) + more } }, rewards: earned - s.earned };
}

// State after healing the missed day `day` on `today` (pure): { state, rewards }, or null when that day cannot be healed.
// Call it after play() of the same solve. rewards = rewards the streak reached through the heal (the caller grants them).
export function healDay(s, day, today) {
  const b = s.brk;
  if (!b || today - day > HEAL_DAYS || day <= b.from || day >= b.to || b.healed.includes(day)) return null;
  const healed = [...b.healed, day].sort((x, y) => x - y), left = b.to - b.from - 1 - healed.length;
  let { streak, freezes, earned, prog } = s, brk = { ...b, healed };
  if (b.frozen) { // the freeze spent on this day comes back; the day counts
    ({ earned, prog } = advance(earned, prog, 1)); streak++;
    freezes += 1 + earned - s.earned;
  } else if (left <= freezes) { // joined again with the streak before the gap; the days still missed are covered by freezes
    const c = streak - (b.x ?? 0); streak = b.a + healed.length + c; // c: the new streak without the healed days already counted in it
    ({ earned, prog } = advance(b.e, b.p, healed.length + c));
    freezes += earned - s.earned - left; brk = { ...brk, frozen: true };
  } // else: part of a broken gap healed, the streak stays broken (extend() counts the days that touch its new start)
  if (!left) brk = null;
  freezes = Math.min(FREEZE_MAX, freezes);
  const more = extend({ ...s, streak, best: Math.max(s.best, streak), freezes, earned, prog, brk });
  return { state: more.state, rewards: more.state.earned - s.earned };
}

// The streak as shown on `today`: 0 once the gap since the last solve is too long for the freezes left.
export const current = (s, today) => (s.last !== null && today - s.last - 1 <= s.freezes ? s.streak : 0);

// Progress to the next reward on `today`: { on, total, left } = days done, days needed, days to go. Right after a reward the bar of that
// reward stays full until the next solve.
export function progress(s, today) {
  const need = needFor(s.earned);
  if (!current(s, today)) return { on: 0, total: need, left: need };
  if (!s.prog) { const done = needFor(s.earned - 1); return { on: done, total: done, left: need }; }
  return { on: s.prog, total: need, left: need - s.prog };
}

const natural = x => Number.isInteger(x) && x >= 0;
const valid = c => c && [c.streak, c.best, c.freezes].every(natural) && (c.last === null || Number.isInteger(c.last))
  && (c.earned === undefined || (natural(c.earned) && natural(c.prog) && c.prog < needFor(c.earned)));
const validGap = b => b && [b.from, b.to, b.a, b.e, b.p].every(natural) && b.to > b.from + 1 && typeof b.frozen === 'boolean'
  && Array.isArray(b.healed) && b.healed.every(Number.isInteger) && (b.x === undefined || natural(b.x));
// A state saved before rewards were counted (no `earned`) belongs to an established player: the plain FREEZE_EVERY cycle.
const load = c => ({ ...c, brk: validGap(c.brk) ? c.brk : null,
  earned: c.earned ?? RAMP.length, prog: c.earned === undefined ? c.streak % FREEZE_EVERY : c.prog });

export function createStreak(storage, playlog, now = () => new Date()) {
  let s = null; // null until init()
  const save = async () => { try { await storage.set(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  return {
    // Loads the state; the very first time (nothing stored) it replays the solved days of the play log, so existing players keep their streak.
    // -> { rewards }: rewards reached by healed days a stored state had not counted yet (extend()); the caller grants them.
    async init() {
      try {
        const r = await storage.get(KEY), c = r && JSON.parse(r.value);
        if (valid(c)) {
          const loaded = load(c), fixed = extend(loaded);
          s = fixed.state;
          if (s !== loaded) await save();
          return { rewards: fixed.rewards };
        }
      } catch { /* fall through */ }
      const days = [...new Set((await playlog.all()).filter(r => r.solved).map(r => Math.floor(r.at / 86400000)))].sort((a, b) => a - b);
      s = days.reduce(play, fresh());
      await save();
      return { rewards: 0 };
    },
    // Call on every solve. true = the solve earned a reward (the day's first solve only).
    async record() { if (!s) return false; const n = play(s, utcDayNumber(now())); if (n === s) return false; const won = n.earned > s.earned; s = n; await save(); return won; },
    // Call after record() when the Game of Day of UTC day `day` was replayed and solved: null = nothing to heal, else { rewards } (the
    // rewards the heal reached; the caller grants them).
    async heal(day) {
      if (!s) return null;
      const r = healDay(s, day, utcDayNumber(now()));
      if (!r) return null;
      s = r.state; await save(); return { rewards: r.rewards };
    },
    healable() { return s ? healable(s, utcDayNumber(now())) : []; }, // UTC day numbers, newest first
    progress() { return s && progress(s, utcDayNumber(now())); },
    view() { const today = utcDayNumber(now()); return s && { streak: current(s, today), best: s.best, freezes: s.freezes, today: s.last === today }; },
  };
}
