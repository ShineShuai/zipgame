// The theme pool: which themes the player has and which one is active. Plain data and pure functions (the controller in
// index.js reads and writes the storage); everything read back from storage or the network goes through cleanEntry.
//   state = { v: 2, cap, active, pool: [entry] }   cap 2..4 (awards raise it), active = an id in the pool, or null while
//   the player has not chosen (then the system's light/dark setting picks, as before themes existed).
// An entry is the metadata of one theme (id, version, mode, names, bar colour, layout keys, swatches, symbol). The pool keeps
// it with the state so the page can start, and the picker can draw, without opening any theme's files.
import { BUILTIN, BUILTIN_IDS } from './builtin.js';
import { cleanLayout } from './layout.js';
import { cleanInner } from './svg.js';

export const POOL_KEY = 'zip_theme_v2';
export const MODE_KEY = 'zip_theme';   // the key before themes existed; now it mirrors the active theme's mode (stats.html reads it)
export const MIN_CAP = 2;
export const MAX_CAP = 4;
export const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const TEXT = /^[^<>"&]{1,40}$/;

export const parseMode = value => (value === 'light' || value === 'dark' ? value : null);
export const resolveMode = (saved, systemDark) => parseMode(saved) || (systemDark ? 'dark' : 'light');

// An entry (from storage or a bundle's meta) reduced to what the game uses, or null when it is not a theme.
export function cleanEntry(x) {
  if (!x || typeof x !== 'object' || !ID_RE.test(x.id ?? '') || !parseMode(x.mode) || !HEX.test(x.chrome ?? '')) return null;
  const builtin = BUILTIN_IDS.includes(x.id);
  if (builtin) return BUILTIN.find(b => b.id === x.id);           // built-ins are never taken from storage
  const name = {};
  for (const lang of ['en', 'zh']) if (TEXT.test(x.name?.[lang] ?? '')) name[lang] = x.name[lang];
  if (!name.en) name.en = x.id;
  return {
    id: x.id,
    v: Number.isInteger(x.v) && x.v > 0 && x.v < 10000 ? x.v : 1,
    themeApi: 1,
    mode: x.mode,
    name,
    chrome: x.chrome.toLowerCase(),
    layout: cleanLayout(x.layout),
    swatches: Array.isArray(x.swatches) && x.swatches.length === 4 && x.swatches.every(c => HEX.test(c)) ? x.swatches : null,
    symbol: cleanInner(x.symbol, 600) ?? '',
  };
}

export const fresh = legacyMode => ({ v: 2, cap: MIN_CAP, active: parseMode(legacyMode), pool: [...BUILTIN] });

// The state in `raw` (the stored JSON text), made valid; `legacyMode` is the old zip_theme value (a first run after the update).
export function parseState(raw, legacyMode = null) {
  let st = null;
  try { st = JSON.parse(raw); } catch { /* none, or damaged */ }
  const pool = [];
  if (st?.v === 2 && Array.isArray(st.pool)) {
    for (const x of st.pool) {
      const e = cleanEntry(x);
      if (e && !pool.some(p => p.id === e.id)) pool.push(e);
    }
  }
  if (!pool.length) return fresh(legacyMode);
  const cap = Math.min(MAX_CAP, Math.max(MIN_CAP, Number.isInteger(st.cap) ? st.cap : MIN_CAP));
  return { v: 2, cap, active: pool.some(e => e.id === st.active) ? st.active : null, pool: pool.slice(0, cap) };
}

export const serialize = state => JSON.stringify({ v: 2, cap: state.cap, active: state.active, pool: state.pool });

// The theme to show: the chosen one, else the pool's first theme of the system's mode, else its first theme.
export function activeEntry(state, systemMode) {
  return state.pool.find(e => e.id === state.active) ?? state.pool.find(e => e.mode === systemMode) ?? state.pool[0];
}

export const select = (state, id) => (state.pool.some(e => e.id === id) ? { ...state, active: id } : state);

// Awards raise the cap (never above 4); lowering it keeps the active theme and the earliest others.
export function setCap(state, n) {
  const cap = Math.min(MAX_CAP, Math.max(MIN_CAP, Math.trunc(n) || MIN_CAP));
  if (state.pool.length <= cap) return { ...state, cap };
  const keep = state.pool.filter(e => e.id === state.active);
  for (const e of state.pool) if (keep.length < cap && !keep.includes(e)) keep.push(e);
  return { ...state, cap, pool: state.pool.filter(e => keep.includes(e)) };
}

// Adds a theme to the pool; when the pool is full `replaceId` names the theme it takes the place of. Returns the new
// state, or null when it cannot (full without a valid replaceId, or not a theme). A replaced active theme hands over.
export function save(state, entry, replaceId = null) {
  const e = cleanEntry(entry);
  if (!e) return null;
  if (state.pool.some(p => p.id === e.id)) return state;
  if (state.pool.length < state.cap) return { ...state, pool: [...state.pool, e] };
  const at = state.pool.findIndex(p => p.id === replaceId);
  if (at < 0) return null;
  const pool = state.pool.map((p, i) => (i === at ? e : p));
  return { ...state, pool, active: state.active === replaceId ? e.id : state.active };
}

// The pool without `id` (a theme that left it, or whose files are not on this device any more). Never below the built-ins a
// small pool needs: light and dark come back when the pool would otherwise have fewer themes than its cap allows them to fill.
// A removed active theme hands over to the built-in of its mode.
export function remove(state, id) {
  const gone = state.pool.find(e => e.id === id);
  if (!gone) return state;
  const pool = state.pool.filter(e => e.id !== id);
  for (const b of BUILTIN) if (pool.length < 2 && !pool.some(e => e.id === b.id)) pool.push(b);
  const handover = pool.find(e => e.id === gone.mode && e.builtin);
  return { ...state, pool, active: state.active === id ? (handover?.id ?? null) : state.active };
}

// The theme after `id` in pool order (the header button's step; with the two built-ins it is the old light/dark toggle).
export function nextEntry(state, id) {
  const at = state.pool.findIndex(e => e.id === id);
  return state.pool[(at + 1) % state.pool.length];
}

// True while the pool is still the two built-ins in their original order: the button is then the classic light/dark switch.
export const isClassicPool = state => state.pool.length === 2 && state.pool[0].id === 'light' && state.pool[1].id === 'dark';
