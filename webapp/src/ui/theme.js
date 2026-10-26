// The theme button of the app bar and the page's link to the theme system (src/themes). The page's <head> runs a tiny
// inline script that sets <html data-theme data-mode ...> before the first paint (no flash): the active theme from the pool,
// else the system setting. Here the controller takes over: it keeps the pool in storage, shows the offered theme of an event
// on trial (the player takes it or leaves it), follows the system setting until the player has chosen, and drives the button.
// A theme the player owns is kept on the device (src/themes/store.js): nothing is fetched to show it.
// With the two built-in themes the button is the light/dark switch it always was; with another pool it steps through the
// pool and shows the glyph of the theme it switches to.
import { THEMES } from '../config.js';
import { createThemes } from '../themes/index.js';
import { MODE_KEY, parseMode, resolveMode } from '../themes/pool.js';
import { browserSource } from '../themes/source.js';
import { createStore } from '../themes/store.js';

export const THEME_KEY = MODE_KEY;   // the key the stats page reads; it mirrors the active theme's mode
export const parseTheme = parseMode;
export const resolveTheme = resolveMode;

const DARK_QUERY = '(prefers-color-scheme: dark)';
const NS = 'http://www.w3.org/2000/svg';

export const currentTheme = () => (document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light');
export const themeName = (entry, lang) => entry.name[lang] ?? entry.name.en;

let controller = null;
// The controller (select, setCap, offer(token) -> { commit, revert }, install ...) for the pool picker and the award / offer mechanisms.
export const themes = () => controller;

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
export function initTheme(button, label = (cur, next, classic) => (classic ? (cur.mode === 'dark' ? 'Light mode' : 'Dark mode') : `Switch to ${next.name.en} theme`)) {
  // a custom property this build defines (css/theme.css): a bundle's token the build does not know is ignored
  const known = name => getComputedStyle(document.documentElement).getPropertyValue(name) !== '';
  controller = createThemes({ storage: localStorage, media: matchMedia(DARK_QUERY), store: createStore(localStorage), source: browserSource(THEMES.offers), known });
  const sync = () => {
    if (!button) return;
    const [cur, next, classic] = [controller.current(), controller.upcoming(), controller.isClassic()];
    if (classic) { button.setAttribute('aria-pressed', String(cur.mode === 'dark')); setSymbol(button, null); } else { button.removeAttribute('aria-pressed'); setSymbol(button, next); }
    const text = label(cur, next, classic);
    button.setAttribute('aria-label', text);
    button.title = text;
  };
  controller.onChange(sync);
  controller.start();
  sync();
  if (button) button.addEventListener('click', () => controller.next());
  return { refresh: sync };
}
