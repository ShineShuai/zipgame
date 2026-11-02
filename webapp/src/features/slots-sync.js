// The theme slots across the player's devices. The NUMBER of slots follows: the group has as many
// as its best device. The themes do not: each device keeps its own. Besides the number, a device
// offers the ids of the themes it keeps, for one use only: a device that got a slot from a sync,
// and has no offer day coming, may take one of them (ui/theme.js awardSlots).
// Kept per device under SLOTS_KEY: { v, cap, themes: [id] }; cap 0: nothing published yet.
import { ID_RE, MAX_CAP } from '../themes/pool.js';

export const SLOTS_KEY = 'zip_slots';
export const VERSION = 1;

export const fresh = () => ({ v: VERSION, cap: 0, themes: [] });

// A record from storage or from another device, cleaned; null when it is not one.
export function sanitize(c) {
  const shaped = c && typeof c === 'object' && c.v === VERSION && Array.isArray(c.themes)
    && Number.isInteger(c.cap) && c.cap >= 0 && c.cap <= MAX_CAP;
  if (!shaped) {
    return null;
  }
  const themes = [];
  for (const id of c.themes) {
    const fresh = typeof id === 'string' && ID_RE.test(id) && !themes.includes(id);
    if (fresh && themes.length < MAX_CAP) {
      themes.push(id);
    }
  }
  return { v: VERSION, cap: c.cap, themes };
}

// storage: the app's storage port (wrapped by the sync engine); sync: optional
// (platform/sync/engine.js).
export function createSlotsSync(storage, sync = null) {
  let state = fresh();
  const save = async () => {
    try {
      await storage.set(SLOTS_KEY, JSON.stringify(state));
    } catch { /* best effort, like every write */ }
  };
  return {
    async init() {
      try {
        const stored = await storage.get(SLOTS_KEY);
        state = (stored && sanitize(JSON.parse(stored.value))) || fresh();
      } catch {
        state = fresh();
      }
    },
    // The group's: { cap: the most slots any device has, themes: the ids any device keeps }.
    view: () => (sync ? sync.view(SLOTS_KEY, state) : state),
    // This device tells its slots and the themes it keeps (ids, built-ins left out). Writes only
    // when something changed; never lowers the number.
    async publish(cap, themes) {
      const next = sanitize({ v: VERSION, cap: Math.max(cap, state.cap), themes });
      const same = next && next.cap === state.cap
        && next.themes.length === state.themes.length
        && next.themes.every((id, i) => id === state.themes[i]);
      if (!next || same) {
        return;
      }
      state = next;
      await save();
    },
  };
}
