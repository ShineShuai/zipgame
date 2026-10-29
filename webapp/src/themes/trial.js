// The offer record of the theme that waits for the player: one record, kept on the device (OFFER_KEY), so a reload, a closed tab or no
// network changes nothing. The player has trialMs (TRIAL_MS) of foreground time to try the theme, started by a tap:
//   pending  the theme waits (the chip says "try it"); it is gone when `until` (the end of the day) passes
//   trial    the theme is on the page; `left` ms of foreground time remain (the clock stops while the page is hidden)
//   final    the time is up: the theme is gone from the page, the sheet asks "keep it?" until `until` (at least FINAL_MS from then)
// { v: 1, event, phase, until, left, theme: { entry, css, art, fonts } } -- `theme` is a validated bundle (a built-in has no css), which
// is also what the page's <head> script paints from while the phase is trial. Whatever is read is rebuilt from the whitelists.
import { cleanArt } from './art.js';
import { cleanFonts } from './bundle.js';
import { EVENT_RE } from './event.js';
import { cleanEntry } from './pool.js';
import { validCss } from './store.js';

export const OFFER_KEY = 'zip_theme_o';
export const TRIAL_MS = 30 * 60 * 1000;
export const FINAL_MS = 30 * 60 * 1000;
const MAX_RECORD = 400 * 1024;   // characters
const PHASES = ['pending', 'trial', 'final'];

// text -> { event, phase, until, left, theme } or null (missing or damaged)
export function parseOffer(text, trialMs = TRIAL_MS) {
  if (typeof text !== 'string' || text.length > MAX_RECORD) return null;
  let r = null;
  try { r = JSON.parse(text); } catch { return null; }
  if (!r || r.v !== 1 || !PHASES.includes(r.phase) || !EVENT_RE.test(r.event ?? '')) return null;
  if (!Number.isFinite(r.until) || !Number.isFinite(r.left) || r.left < 0) return null;
  const entry = cleanEntry(r.theme?.entry);
  if (!entry) return null;
  let theme = { entry, css: null, art: null, fonts: [] };
  if (!entry.builtin) {
    const fonts = cleanFonts(r.theme.fonts);
    if (!validCss(entry.id, r.theme.css) || !fonts) return null;
    theme = { entry, css: r.theme.css, art: cleanArt(r.theme.art), fonts };
  }
  return { event: r.event, phase: r.phase, until: r.until, left: Math.min(r.left, trialMs), theme };
}

export const serializeOffer = o => JSON.stringify({
  v: 1, event: o.event, phase: o.phase, until: o.until, left: Math.round(o.left),
  theme: { entry: o.theme.entry, css: o.theme.css, art: o.theme.art, fonts: o.theme.fonts },
});
