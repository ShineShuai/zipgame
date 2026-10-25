// The theme controller: the pool (pool.js), the fetching (registry.js) and the page (apply.js) put together. Storage and
// the system's colour scheme are injected. The mechanisms that award slots or offer a random theme call setCap, save and
// trial; the header button calls next (or, later, the picker calls select).
import { BUILTIN } from './builtin.js';
import { applyEntry } from './apply.js';
import {
  MODE_KEY, POOL_KEY, activeEntry, isClassicPool, nextEntry, parseState, save, select, serialize, setCap,
} from './pool.js';

export function createThemes({ storage, media, registry, apply = applyEntry }) {
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => {
    try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* private mode: not saved */ }
  };
  const systemMode = () => (media?.matches ? 'dark' : 'light');
  let state = parseState(read(POOL_KEY), read(MODE_KEY));
  let shown = null;
  let art = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn(api));

  function persist() {
    write(POOL_KEY, serialize(state));
    write(MODE_KEY, state.active ? activeEntry(state, systemMode()).mode : null);   // the old key: stats.html follows it
  }

  // Shows `entry` now (the attributes are cheap and idempotent), then its art once the files are in. A theme whose files
  // cannot be had is replaced on screen by the built-in of its mode; the pool is left alone (it may work next time).
  async function show(entry) {
    shown = entry;
    art = null;
    apply(entry, null);
    notify();
    if (entry.builtin) return;
    try {
      const loaded = await registry.ensure(entry);
      if (shown !== entry) return;
      art = loaded.art;
      apply(entry, art);
      notify();
    } catch {
      if (shown !== entry) return;
      await show(state.pool.find(e => e.builtin && e.mode === entry.mode) ?? BUILTIN.find(b => b.mode === entry.mode));
    }
  }

  const choose = next => { state = next; persist(); return show(activeEntry(state, systemMode())); };

  const api = {
    state: () => state,
    current: () => shown ?? activeEntry(state, systemMode()),
    art: () => art,
    isClassic: () => isClassicPool(state),
    upcoming: () => nextEntry(state, api.current().id),   // what the header button would switch to
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    // Shows the stored (or the system's) theme. Call once at start.
    start: () => {
      media?.addEventListener?.('change', () => { if (!state.active) show(activeEntry(state, systemMode())); });
      return show(activeEntry(state, systemMode()));
    },
    select: id => choose(select(state, id)),
    next: () => choose(select(state, nextEntry(state, api.current().id).id)),
    setCap: n => { state = setCap(state, n); persist(); notify(); },
    // A theme from the catalog into the pool; `replaceId` when the pool is full. The theme becomes the active one only
    // when it replaced the active one (see pool.save); call select after for "save and use".
    save: (entry, replaceId) => {
      const next = save(state, entry, replaceId);
      if (!next) return false;
      state = next;
      persist();
      show(activeEntry(state, systemMode()));
      return true;
    },
    // Shows a theme without keeping it: commit(replaceId) saves it into the pool and keeps it, revert() goes back.
    trial: entry => {
      const before = api.current();
      show(entry);
      return {
        // resolves true when the theme is now in the pool and active, false when the pool is full and `replaceId` is missing
        commit: async replaceId => {
          if (!api.save(entry, replaceId)) return false;
          await api.select(entry.id);
          return true;
        },
        revert: () => show(before),
      };
    },
  };
  return api;
}
