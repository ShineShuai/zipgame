// Light / dark theme. The page's <head> runs a tiny inline script that sets <html data-theme> before the first
// paint (no flash): the saved choice, else the system setting. This module wires the app-bar button and follows the
// system setting until the player has picked a theme (the pick is saved under THEME_KEY).
export const THEME_KEY = 'zip_theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const META_COLORS = { light: '#f4f7ff', dark: '#0d1224' }; // the browser bar colour (the page's --bg)

// 'light' | 'dark' | null for a stored value that is neither.
export const parseTheme = value => (value === 'light' || value === 'dark' ? value : null);

// The theme to show: the saved one, else the system's.
export function resolveTheme(saved, systemDark) {
  return parseTheme(saved) || (systemDark ? 'dark' : 'light');
}

const readSaved = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
const writeSaved = value => { try { localStorage.setItem(THEME_KEY, value); } catch { /* private mode: not saved */ } };

export const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLORS[theme]);
  document.dispatchEvent(new CustomEvent('zip-theme', { detail: theme }));
}

// button: the toggle (aria-pressed = dark); label(theme) -> its text for the screen reader and the tooltip.
export function initTheme(button, label = theme => (theme === 'dark' ? 'Light mode' : 'Dark mode')) {
  const media = matchMedia(DARK_QUERY);
  const sync = () => {
    const theme = currentTheme();
    if (!button) return;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    const text = label(theme);
    button.setAttribute('aria-label', text);
    button.title = text;
  };
  apply(resolveTheme(readSaved(), media.matches));
  sync();
  const follow = () => { if (!parseTheme(readSaved())) { apply(resolveTheme(null, media.matches)); sync(); } };
  if (media.addEventListener) media.addEventListener('change', follow);
  if (button) {
    button.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      writeSaved(next);
      apply(next);
      sync();
    });
  }
  return { refresh: sync };
}
