// The theme button of the app bar and the page's link to the theme system (src/themes). The page's <head> runs a tiny
// inline script that sets <html data-theme data-mode ...> before the first paint (no flash): the active theme from the pool,
// else the system setting. Here the controller takes over: it keeps the pool in storage, follows the system setting until the
// player has chosen, and drives the button.
// A theme the player owns is kept on the device (src/themes/store.js): nothing is fetched to show it.
// With the two built-in themes the button is the light/dark switch it always was; with another pool it steps through the
// pool and shows the glyph of the theme it switches to; with three or more (or the dev reveal on) it opens a list.
// An event calls `offerTheme({ id, until })`: a theme of the site's pool waits for the player as a chip (src/ui/theme-offer.js); a tap starts
// the trial, then the player keeps the theme or leaves it. `watchDay(check)` calls the app's event check when a day may have begun, with
// no reload. `awardSlots` raises the theme slots from the player's activity. The dev reveal (hold V) adds the whole pool to the list (src/ui/theme-picker.js).
import { THEMES } from '../config.js';
import { watchDay as watchDayOf } from '../themes/event.js';
import { createThemes } from '../themes/index.js';
import { MODE_KEY, parseMode, resolveMode } from '../themes/pool.js';
import { browserSource } from '../themes/source.js';
import { createStore } from '../themes/store.js';
import { initThemeOffer, showSlotToast } from './theme-offer.js';
import { closeThemePicker, toggleThemePicker } from './theme-picker.js';
import { showThemeRule } from './theme-rule.js';

export const THEME_KEY = MODE_KEY;   // the key the stats page reads; it mirrors the active theme's mode
export const parseTheme = parseMode;
export const resolveTheme = resolveMode;

const DARK_QUERY = '(prefers-color-scheme: dark)';
const NS = 'http://www.w3.org/2000/svg';

export const currentTheme = () => (document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light');
export const themeName = (entry, lang) => entry.name[lang] ?? entry.name.en;

let controller = null;
let ui = { text: key => key, lang: () => 'en' };
// The controller (select, setCap, event(...) -> { commit, revert } ...) for the pool picker and the award mechanisms.
export const themes = () => controller;

// An event fires (however the app decides that): a theme of the pool waits for the player to try, keep or leave, until `until` (ms; default
// the end of the local day). `id` names the event: the same id is answered once, and a reload within it finds the same offer.
// Promise<boolean>: false when nothing is offered (see controller.offer); the next trigger of the app's check tries again.
export async function offerTheme({ id, until = null }) {
  return controller ? controller.offer({ id, until: until ?? undefined }) : false;
}

// Calls check() when an event day may have come: now, when the page is seen again, when the network is back, at local midnight. The page
// needs no reload. Deciding that today is an event day, and calling offerTheme, is check's business. -> a function that stops it.
export const watchDay = check => watchDayOf(check);

// The player's activity ({ gotdSolves, bestStreak }) may have earned theme slots (src/themes/slots.js): they are raised, and a notice shows.
export function awardSlots(counts) {
  if (!controller?.awardSlots(counts)) return false;
  showSlotToast({ text: ui.text, cap: controller.state().cap });
  return true;
}

// A theme's glyph for the button: the symbol of the catalog entry (already whitelisted by pool.cleanEntry).
function setSymbol(button, entry) {
  button.querySelector('.theme-symbol')?.remove();
  if (!entry) { delete button.dataset.custom; return; }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'theme-symbol');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': 'var(--icon-stroke)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  svg.innerHTML = entry.symbol;
  button.append(svg);
  button.dataset.custom = '';
}

// button: the header button. label(current, next, classic) -> its text for the screen reader and the tooltip.
// pickLabel() / pickLang(): the heading of the list and the language of the names (the app passes its translations).
// text(key, ...args): the app's translation; revealed(): whether the dev reveal is on (the app's S.showDev).
export function initTheme(button, label = (cur, next, classic) => (classic ? (cur.mode === 'dark' ? 'Light mode' : 'Dark mode') : `Switch to ${next.name.en} theme`), pickLabel = () => 'Choose a theme', pickLang = () => 'en', { text = key => key, revealed = () => false, idle = () => true } = {}) {
  ui = { text, lang: pickLang };
  // a custom property this build defines (css/theme.css): a bundle's token the build does not know is ignored
  const known = name => getComputedStyle(document.documentElement).getPropertyValue(name) !== '';
  controller = createThemes({
    storage: localStorage, media: matchMedia(DARK_QUERY), store: createStore(localStorage), source: browserSource(THEMES), known,
    trialMs: THEMES.trialMs, idle, focused: document.visibilityState !== 'hidden',
  });
  const picking = () => controller.state().pool.length >= 3 || revealed();   // a pool of three or more (or the dev reveal) is chosen from a list, not stepped through
  // The dev reveal's rows are English only and not in the translations: no text a player can read mentions the reveal (see the test in tests.js).
  const labels = { all: 'All themes', draft: 'draft', keep: 'Keep this theme', offer: 'Offer a theme now', none: 'No themes found', nothing: 'Nothing to offer', loading: '…' };
  const dev = () => (revealed() ? { labels, offerNow: () => { controller.dropOffer(); return offerTheme({ id: `dev-${Date.now()}` }); } } : null);
  const rule = () => ({
    line: text('theme.offer.rule'), open: text('theme.rule.open'), show: () => showThemeRule(text),
  });
  const sync = () => {
    if (!button) return;
    const [cur, next, classic] = [controller.current(), controller.upcoming(), controller.isClassic()];
    if (classic && !picking()) button.setAttribute('aria-pressed', String(cur.mode === 'dark')); else button.removeAttribute('aria-pressed');
    setSymbol(button, classic ? null : (picking() ? cur : next));
    if (picking()) { button.setAttribute('aria-haspopup', 'menu'); if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false'); } else { button.removeAttribute('aria-haspopup'); button.removeAttribute('aria-expanded'); closeThemePicker(); }
    const text = picking() ? pickLabel() : label(cur, next, classic);
    button.setAttribute('aria-label', text);
    button.title = text;
  };
  controller.onChange(sync);
  controller.start();
  initThemeOffer({ controller, text, lang: pickLang, idle });
  // only the time the page is seen counts for a trial
  document.addEventListener('visibilitychange', () => controller.focus(document.visibilityState !== 'hidden'));
  addEventListener('pagehide', () => controller.focus(false));
  addEventListener('pageshow', () => controller.focus(document.visibilityState !== 'hidden'));
  sync();
  document.addEventListener('zip:reveal', sync);   // the dev reveal turns the button into the list, and back
  if (button) button.addEventListener('click', () => (picking() ? toggleThemePicker(button, controller, pickLang(), pickLabel(), dev(), rule()) : controller.next()));
  return { refresh: sync };
}
