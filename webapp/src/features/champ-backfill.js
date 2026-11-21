// BACKFILL (remove after CHAMP.backfillUntil of config.js; the date switches it off by itself).
// What to delete: this file, its call in apps/play/main.js, CHAMP.backfillUntil and its check
// (config.js, test/check-config.js), store.allAttempts (stats-store.js),
// test/unit/champ-backfill.test.js.
//
// The champion rule counts live games from its release on. Players who beat 100% before it get
// their wins once from the records they already have: every stored answer with pct 100 on a day
// with enough players counts, replays too (lenient: the old records do not say which was which).
// A record written since the rule has a `live` field (true or false), an old one has none: only
// those are credited here, so a replay played after the release never is. It runs once per
// device (a marker key; a day that was judged or won is never counted twice, so the devices of a
// sync group do not double it), and only until the date.
export const BACKFILL_KEY = 'zip_champ_bf'; // device-local, not synced

const ymd = date => date.toISOString().slice(0, 10);

export const backfillOpen = (cfg, now = new Date()) =>
  Boolean(cfg.backfillUntil) && ymd(now) <= cfg.backfillUntil;

// A record from before the rule that says "you beat 100%" with enough players.
export const isOldWin = (rec, minPlayers) =>
  Boolean(rec) &&
  rec.solved === true &&
  rec.live === undefined &&
  Boolean(rec.stats) &&
  rec.stats.pct === 100 &&
  rec.stats.n >= minPlayers;

// champ = features/champ.js (after init), store = features/stats-store.js, cfg = config.js CHAMP.
// Returns the number of wins credited.
export async function backfillChamp(champ, store, storage, cfg, now = () => new Date()) {
  if (champ.progress() === null || !backfillOpen(cfg, now())) {
    return 0;
  }
  try {
    if (await storage.get(BACKFILL_KEY)) {
      return 0;
    }
  } catch {
    /* storage that cannot be read: try, a day is never counted twice */
  }
  const records = await store.allAttempts();
  let wins = 0;
  for (const date of Object.keys(records).sort()) {
    const rec = records[date];
    if (isOldWin(rec, cfg.minPlayers) && (await champ.settle(date, true, rec.time))) {
      wins++;
    }
  }
  await storage.set(BACKFILL_KEY, '1');
  return wins;
}
