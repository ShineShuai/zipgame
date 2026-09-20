import { newStat, updateStat } from '../core/stats.js';

// Persistent per-size stats (all-time "total" and per-UTC-day "today"), Game-of-Day best time and once-per-day attempt flag.
// Total keys are unchanged from the old app; today's stats live under zip_today_stats_<n> = { day, stat }.
export function createStore(storage, sizes) {
  const total = {}, today = {}, best = {}; let attempt = null, attemptDate = null;
  const get = async k => { try { const r = await storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const set = async (k, v) => { try { await storage.set(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const store = {
    async hydrate(dateStr) {
      await Promise.all(sizes.map(async n => {
        total[n] = (await get('zip_local_stats_' + n)) || newStat(); today[n] = await get('zip_today_stats_' + n); best[n] = await get('zip_gotd_best_' + n);
      }));
      await store.hydrateAttempt(dateStr);
    },
    total: n => total[n] || newStat(),
    today: (n, day) => (today[n] && today[n].day === day ? today[n].stat : newStat()),
    async recordSolve(n, day, time) {
      total[n] = updateStat(total[n] || newStat(), time);
      today[n] = { day, stat: updateStat(store.today(n, day), time) };
      await Promise.all([set('zip_local_stats_' + n, total[n]), set('zip_today_stats_' + n, today[n])]);
    },
    gotdBest: n => best[n] || null,
    async recordGotd(n, date, time) {
      const prev = best[n];
      if (!prev || prev.date !== date || prev.time > time) { best[n] = { date, time }; await set('zip_gotd_best_' + n, best[n]); }
      await store.saveAttempt(date, { solved: true, time });
    },
    attempt: () => attempt, attemptDate: () => attemptDate,
    async hydrateAttempt(date) { attempt = await get('zip_gotd_attempt_' + date); attemptDate = date; },
    async saveAttempt(date, a) { attempt = a; attemptDate = date; await set('zip_gotd_attempt_' + date, a); },
  };
  return store;
}
