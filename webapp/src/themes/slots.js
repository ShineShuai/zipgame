// The theme slots a player has: pool.js MIN_CAP (2) to MAX_CAP (4). Activity earns them, for good (the counts only grow):
//   one slot when the Game-of-Day solves in total reach SLOT_GOTD_SOLVES (a replayed Game of Day counts, each date once),
//   one slot when the best streak reaches SLOT_STREAK_DAYS days.
import { MAX_CAP, MIN_CAP } from './pool.js';

export const SLOT_GOTD_SOLVES = 12;
export const SLOT_STREAK_DAYS = 30;

export const slotsFor = ({ gotdSolves = 0, bestStreak = 0 } = {}) => Math.min(MAX_CAP,
  MIN_CAP + (gotdSolves >= SLOT_GOTD_SOLVES ? 1 : 0) + (bestStreak >= SLOT_STREAK_DAYS ? 1 : 0));
