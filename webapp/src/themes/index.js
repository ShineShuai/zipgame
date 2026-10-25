// The theme controller: the pool (pool.js), the device's own themes (store.js) and the page (apply.js) put together. Storage
// and the system's colour scheme are injected. There are two ways a theme reaches a player, both through `trial`:
// the mechanisms that run an event hand the controller the bundle on the stage; the player sees it (trial), and takes it
// (commit: it is saved on the device and in the pool, replacing a theme when the pool is full) or leaves it (revert: it is
// gone, nothing was kept). A theme that is in the pool needs no network. The mechanisms that award slots call setCap.
import { BUILTIN } from './builtin.js';
import { applyEntry, loadFonts as realLoadFonts } from './apply.js';
import { cleanBundle } from './bundle.js';
import {
  MODE_KEY, POOL_KEY, activeEntry, isClassicPool, nextEntry, parseState, remove, save, select, serialize, setCap,
} from './pool.js';

const MAX_TIMEOUT = 2 ** 31 - 1;

export function createThemes({
  storage, media, store, apply = applyEntry, loadFonts = realLoadFonts, known, now = Date.now, timers = globalThis,
}) {
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => {
    try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* private mode: not saved */ }
  };
  const systemMode = () => (media?.matches ? 'dark' : 'light');
  let state = parseState(read(POOL_KEY), read(MODE_KEY));
  let shown = null;
  let content = null;
  let fonts = null;
  let trialing = null;     // the bundle on trial, if any
  let timer = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn(api));

  function persist() {
    write(POOL_KEY, serialize(state));
    write(MODE_KEY, state.active ? activeEntry(state, systemMode()).mode : null);   // the old key: stats.html follows it
  }

  function show(entry, loaded) {
    shown = entry;
    content = loaded;
    fonts?.release();
    fonts = loaded?.fonts?.length ? loadFonts(loaded.fonts) : null;
    apply(entry, loaded);
    notify();
  }

  const builtinOf = mode => BUILTIN.find(b => b.mode === mode);

  // Shows the stored (or the system's) theme. A theme of the pool whose copy is not on this device any more (storage was
  // cleared, the device refused it) is not the player's now: it leaves the pool and the built-in of its mode shows.
  function showActive() {
    const entry = activeEntry(state, systemMode());
    if (entry.builtin) { show(entry, null); return; }
    const loaded = store.load(entry.id);
    if (loaded) { show(entry, loaded); return; }
    state = remove(state, entry.id);
    persist();
    show(builtinOf(entry.mode), null);
  }

  const clearTrial = () => { trialing = null; if (timer) timers.clearTimeout(timer); timer = null; };
  const choose = next => { clearTrial(); state = next; persist(); showActive(); };

  // Saves a valid bundle on the device and in the pool; false when it cannot (not a bundle, the pool is full and `replaceId`
  // names no theme, or the device refuses it). Nothing changes on false.
  function keep(bundle, replaceId) {
    const next = save(state, bundle.entry, replaceId);
    if (!next || !store.save(bundle)) return false;
    for (const e of state.pool) if (!next.pool.some(p => p.id === e.id) && !e.builtin) store.remove(e.id);
    state = next;
    return true;
  }

  const api = {
    state: () => state,
    current: () => shown ?? activeEntry(state, systemMode()),
    art: () => content?.art ?? null,
    owns: id => state.pool.some(e => e.id === id),
    isClassic: () => isClassicPool(state),
    upcoming: () => nextEntry(state, api.current().id),   // what the header button would switch to
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    // Call once at start.
    start: () => {
      media?.addEventListener?.('change', () => { if (!state.active && !trialing) showActive(); });
      showActive();
    },
    select: id => choose(select(state, id)),
    next: () => choose(select(state, nextEntry(state, api.current().id).id)),
    // Awards raise the cap (never above 4); the themes a lowered cap cuts leave the device too.
    setCap: n => {
      const next = setCap(state, n);
      for (const e of state.pool) if (!next.pool.some(p => p.id === e.id) && !e.builtin) store.remove(e.id);
      state = next;
      persist();
      showActive();
    },
    // A bundle (as the stage holds it, or from the console while developing) straight into the pool.
    install: (raw, replaceId) => {
      const bundle = cleanBundle(raw, { known });
      if (!bundle || !keep(bundle, replaceId)) return false;
      persist();
      return true;
    },
    // Shows an offered theme without keeping anything. `until` (ms, the end of the event): the theme goes by itself then.
    // Returns null for something that is not a valid bundle (or an event already over), else { entry, commit, revert }:
    // commit(replaceId) -> Promise<boolean> keeps it and makes it the active theme; revert() puts the previous theme back.
    trial: (raw, { until } = {}) => {
      const bundle = cleanBundle(raw, { known });
      if (!bundle || (until && until <= now())) return null;
      clearTrial();
      trialing = bundle;
      show(bundle.entry, { css: bundle.css, art: bundle.art, fonts: bundle.fonts });
      const revert = () => { if (trialing !== bundle) return; clearTrial(); showActive(); };
      if (until) timer = timers.setTimeout(revert, Math.min(until - now(), MAX_TIMEOUT));
      return {
        entry: bundle.entry,
        commit: async replaceId => {
          if (trialing !== bundle || !keep(bundle, replaceId)) return false;
          clearTrial();
          state = select(state, bundle.entry.id);
          persist();
          notify();
          return true;
        },
        revert,
      };
    },
  };
  return api;
}
