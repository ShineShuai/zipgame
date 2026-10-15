// Storage port: async get(key) -> {value}|null, set(key, value) -> boolean (false = refused, e.g. quota), remove(key), keys(prefix) -> string[].
// Swap the implementation per platform (wx.setStorage, native, ...). Callers may ignore the set() result: every write is best effort.
const mem = new Map();
const memory = {
  name: 'memory', shared: false,
  async get(k) { return mem.has(k) ? { value: mem.get(k) } : null; },
  async set(k, v) { mem.set(k, v); return true; },
  async remove(k) { mem.delete(k); },
  async keys(prefix = '') { return [...mem.keys()].filter(k => k.startsWith(prefix)); },
};
const local = {
  name: 'localStorage', shared: false,
  async get(k) { try { const v = localStorage.getItem(k); return v == null ? null : { value: v }; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; /* quota / disabled */ } },
  async remove(k) { try { localStorage.removeItem(k); } catch { /* disabled */ } },
  async keys(prefix = '') {
    try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k && k.startsWith(prefix)); } catch { return []; }
  },
};

// Keys that may be dropped, cheapest loss first, when a write hits the quota. Never evicted: stats, streak, unlock, attempts, ratings.
export const EVICT_ORDER = ['zip_playlog_v1', 'zip_playlog_v2'];

// A port whose set() frees the EVICT_ORDER keys one by one (never the key being written) and retries, instead of losing the write.
export function withEviction(base, order = EVICT_ORDER) {
  return {
    ...base,
    async set(k, v) {
      if (await base.set(k, v)) return true;
      for (const victim of order) {
        if (victim === k || !(await base.get(victim))) continue;
        await base.remove(victim);
        if (await base.set(k, v)) return true;
      }
      return false;
    },
  };
}

// What the app keeps on this device: { keys, chars } over keys with `prefix` (a char costs 2 bytes in most browsers' quota).
export async function usage(storage, prefix = 'zip') {
  let chars = 0;
  const keys = await storage.keys(prefix);
  for (const k of keys) { const r = await storage.get(k); chars += k.length + (r ? r.value.length : 0); }
  return { keys: keys.length, chars };
}

// One-time move of a legacy key to its compact successor. convert(oldText) -> newText | null (null: nothing usable, the old value is dropped).
// The old key is removed only after the new one is written and read back, so a refused write (quota) loses nothing and is retried on the next load.
// -> 'none' (no legacy value) | 'done' | 'failed'. Conversion window: keep the callers of this until 2026-10-29 or later, then delete them (this helper can stay).
export async function migrateKey(storage, oldKey, newKey, convert) {
  const old = await storage.get(oldKey);
  if (!old) return 'none';
  const drop = () => (storage.remove ? storage.remove(oldKey) : undefined);
  if (await storage.get(newKey)) { await drop(); return 'done'; } // the new format is already there: the old copy is stale
  let text = null;
  try { text = convert(old.value); } catch { /* corrupt: unusable */ }
  if (text == null) { await drop(); return 'done'; }
  if (!(await storage.set(newKey, text))) return 'failed';
  const back = await storage.get(newKey);
  if (!back || back.value !== text) return 'failed';
  await drop();
  return 'done';
}

export async function pickStorage() {
  try { localStorage.setItem('__probe__', '1'); localStorage.removeItem('__probe__'); return withEviction(local); } catch { return memory; }
}
