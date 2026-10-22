import { newStat, statSummary, updateStat } from '../core/stats.js';

// Local statistics of the trial: per board size, how many games, the mean time and the best time.
// Kept under its own storage key, apart from the stats of the play app, so that removing the trial
// leaves nothing of it in the app's data. Pure functions on a plain record, plus load / save.
export const STATS_KEY = 'zip_coop_stats';

const empty = () => ({ v: 1, sizes: {} });

export function parseStats(text) {
  try {
    const data = JSON.parse(text);
    return data && data.v === 1 && data.sizes && typeof data.sizes === 'object' ? data : empty();
  } catch {
    return empty();
  }
}

// Adds one solved game of size n (seconds) to `data`; -> { n, mean, best } of that size.
export function recordSolve(data, n, seconds) {
  const entry = data.sizes[n] ?? { stat: newStat(), best: null };
  updateStat(entry.stat, seconds);
  entry.best = entry.best === null ? seconds : Math.min(entry.best, seconds);
  data.sizes[n] = entry;
  return summaryOf(data, n);
}

export function summaryOf(data, n) {
  const entry = data.sizes[n];
  if (!entry) {
    return { n: 0, mean: 0, best: null };
  }
  return { n: statSummary(entry.stat).n, mean: statSummary(entry.stat).mean, best: entry.best };
}

export async function loadStats(storage) {
  const stored = await storage.get(STATS_KEY);
  return stored ? parseStats(stored.value) : empty();
}

export async function saveStats(storage, data) {
  return storage.set(STATS_KEY, JSON.stringify(data));
}
