import { decodeShare, encodeShare } from '../core/share-code.js';
import { mergeShared } from './share.js';

// The games other players shared with this player, kept until the player removes them (or, for a
// Game of Day, until it can no longer be played: apps/play/shared-ui.js prunes those). One entry per
// game (shareKey in share.js); a game that arrives again keeps the worse colour strip.
// Kept per device, under SHARED_GAMES_KEY: { v, items: [{ c: share code, a: added at, ms }] }. The
// code is the record in its own checked format (core/share-code.js), so an entry needs no schema of
// its own and a damaged one is simply dropped.
// At most SHARED_MAX games are kept: past it the oldest go (a received game costs ~50 bytes, so the cap only matters for a device that
// collects thousands of links).
export const SHARED_GAMES_KEY = 'zip_shared_games',
  VERSION = 1,
  SHARED_MAX = 200;

// A stored record -> entries [{ key, rec, added }], newest last; invalid items are dropped and
// duplicates collapse as they do in mergeShared.
export function sanitize(c) {
  if (!c || typeof c !== 'object' || c.v !== VERSION || !Array.isArray(c.items)) {
    return [];
  }
  let entries = [];
  for (const item of c.items) {
    const rec = item && typeof item.c === 'string' ? decodeShare(item.c) : null;
    if (rec) {
      entries = mergeShared(entries, rec, Number.isFinite(item.a) ? item.a : 0).entries;
    }
  }
  return entries;
}

export const serialize = entries =>
  JSON.stringify({
    v: VERSION,
    items: entries.map(e => ({ c: encodeShare(e.rec), a: e.added })),
  });

// storage: { get(key) -> { value } | null, set(key, value) } (platform/storage.js).
export function createSharedGames(storage, now = Date.now, max = SHARED_MAX) {
  let entries = [];
  // Every change reads the stored list first, so two tabs do not overwrite each other's games.
  const load = async () => {
    try {
      const stored = await storage.get(SHARED_GAMES_KEY);
      entries = stored ? sanitize(JSON.parse(stored.value)) : [];
    } catch {
      entries = [];
    }
  };
  const save = async () => {
    try {
      await storage.set(SHARED_GAMES_KEY, serialize(entries));
    } catch {
      /* ignore */
    }
  };
  // one change at a time
  let queue = Promise.resolve();
  const change = fn => {
    queue = queue.then(async () => {
      await load();
      return fn();
    });
    return queue;
  };
  return {
    init: () => change(() => undefined),
    // [{ key, rec, added }], oldest first
    list: () => entries.slice(),
    // -> { key, outcome: 'added' | 'replaced' | 'kept' | 'invalid' }
    add: rec =>
      change(async () => {
        const merged = mergeShared(entries, rec, now());
        if (merged.outcome === 'added' || merged.outcome === 'replaced') {
          entries = merged.entries.slice(-max);
          await save();
        }
        return { key: merged.key, outcome: merged.outcome };
      }),
    remove: key =>
      change(async () => {
        const kept = entries.filter(e => e.key !== key);
        if (kept.length === entries.length) {
          return false;
        }
        entries = kept;
        await save();
        return true;
      }),
    // Drops the entries for which keep(entry) is false -> how many were dropped.
    prune: keep =>
      change(async () => {
        const kept = entries.filter(keep);
        const dropped = entries.length - kept.length;
        if (dropped) {
          entries = kept;
          await save();
        }
        return dropped;
      }),
  };
}
