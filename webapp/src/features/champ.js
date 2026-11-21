// The champion ledger of this device: wins on the live Game of the Day (the rules and the sealed
// record are in core/champ-seal.js), the reward picks they earn, and the clock check.
//
// Wins are judged once per day, at the first answer the leaderboard gives for it (game-flow.js
// shareGotd -> judge). A day whose answer was stored but never judged (the page closed in
// between, or the record came from another device) is judged at the next start (catchUp).
// With device sync (platform/sync/engine.js) the picks are counted over the group's wins.
import {
  clean,
  daysOf,
  fresh,
  handedOut,
  isLive,
  judged,
  owedOf,
  progressOf,
  qualifies,
  rise,
  win,
} from '../core/champ-seal.js';
import { dateOfDay, utcDayNumber } from './daily.js';
import { dayOfDate } from './share.js';

export const CHAMP_KEY = 'zip_ledger';
export const CATCH_UP_DAYS = 3; // today and the two days before

// cfg: config.js CHAMP { minPlayers }
export function createChamp(storage, cfg, now = () => new Date(), sync = null) {
  let s = null; // this device's copy; null until init(): nothing is judged or live before that
  const group = () => (sync ? sync.view(CHAMP_KEY, s) : s);
  const today = () => utcDayNumber(now());
  const save = async () => {
    try {
      return (await storage.set(CHAMP_KEY, JSON.stringify(s))) !== false;
    } catch {
      return false;
    }
  };
  // Keeps `next` only when it was written; else the copy stays as it was (and so does the group).
  const commit = async next => {
    const before = s;
    s = next;
    if (await save()) {
      return true;
    }
    s = before;
    return false;
  };

  return {
    // Loads the copy. One that is missing or fails its seals starts again (no wins, no picks).
    async init() {
      let copy = null;
      try {
        const r = await storage.get(CHAMP_KEY);
        copy = r && clean(JSON.parse(r.value));
      } catch {
        /* a copy that cannot be read counts as none */
      }
      s = copy ? rise(copy, today()) : fresh(today());
      if (!copy || s.z !== copy.z) {
        await save();
      }
    },

    // Is the Game of Day of `date` a live one now (not a replay, today's date, an honest clock)?
    // Asked when the solve is recorded; the answer is stored with the record (`live`).
    live: (date, replay) => s !== null && isLive(s, dayOfDate(date), today(), replay),

    // Judges the stored answer `rec` of `date` (a live game only): once per day, at its first
    // answer. True = a win.
    async judge(date, rec) {
      if (!s || !rec?.live || !rec.stats) {
        return false;
      }
      return this.settle(date, qualifies(rec, cfg.minPlayers), rec.time);
    },

    // The day of `date` is judged: a win (with the solve time in seconds) or not. Once per day:
    // a day that was judged here or won anywhere in the group is not judged again. True = a win.
    async settle(date, won, time) {
      const day = dayOfDate(date);
      if (!s || s.j.includes(day) || daysOf(group()).has(day)) {
        return false;
      }
      const next = judged(s, day);
      return (await commit(won ? win(next, day, Math.round(time * 1000)) : next)) && won;
    },

    // Judges the days of the last CATCH_UP_DAYS that were played live, have an answer, and were
    // not judged yet. store = features/stats-store.js
    async catchUp(store) {
      for (let k = 0; s && k < CATCH_UP_DAYS; k++) {
        const date = dateOfDay(today() - k),
          rec = await store.loadAttempt(date);
        await this.judge(date, rec);
      }
    },

    // The reward picks earned and not yet handed out; each is counted as handed out here, before
    // the caller grants it, so a pick is never given twice (a crash in between loses it).
    async takePicks() {
      const owed = s ? owedOf(group()) : 0;
      return owed > 0 && (await commit(handedOut(s, owed))) ? owed : 0;
    },

    // { wins, done, total }: the progress to the next pick, null before init
    progress: () => (s ? progressOf(group()) : null),
  };
}
