// Fetches what a theme needs, once, and only when the theme is wanted: its token file (themes/<id>/theme.css) and its art
// (themes/<id>/art.json). The catalog (themes/catalog.json: metadata of every theme) is fetched only by the picker and
// the award/random mechanisms. Nothing here runs for the built-in themes. The browser bits are injected, so the logic
// is testable: addStylesheet(href, id) -> Promise, fetchJson(url) -> Promise, applied(entry) -> bool (the tokens took effect).
import { cleanArt } from './art.js';
import { cleanEntry } from './pool.js';

export function createRegistry({ base, addStylesheet, fetchJson, applied }) {
  const loads = new Map();
  const url = (id, file, v) => `${base}${id}/${file}?v=${v}`;

  async function load(entry) {
    await addStylesheet(url(entry.id, 'theme.css', entry.v), entry.id);
    if (!applied(entry)) throw new Error(`theme ${entry.id}: its token file did not apply`);
    const art = entry.art ? cleanArt(await fetchJson(url(entry.id, 'art.json', entry.v))) : null;
    return { art };
  }

  // Resolves { art } (art null when the theme has none or it was unusable); rejects when the tokens are unavailable.
  function ensure(entry) {
    if (entry.builtin) return Promise.resolve({ art: null });
    const key = `${entry.id}@${entry.v}`;
    if (!loads.has(key)) {
      loads.set(key, load(entry).catch(error => { loads.delete(key); throw error; }));
    }
    return loads.get(key);
  }

  let catalogPromise = null;
  // The entries of themes/catalog.json that this build understands (themeApi 1).
  function catalog() {
    catalogPromise ??= fetchJson(`${base}catalog.json`).then(raw => {
      if (raw?.themeApi !== 1 || !Array.isArray(raw.themes)) throw new Error('catalog: unknown format');
      return raw.themes.filter(t => t?.themeApi === 1).map(cleanEntry).filter(Boolean);
    }).catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }

  return { ensure, catalog };
}

// The browser's side of the injected bits.
export function browserEnv(doc = document, root = doc.documentElement) {
  const meta = doc.querySelector('meta[name="themes-base"]');
  return {
    base: meta?.getAttribute('content') ?? '../themes/',
    // the page's <head> script may already have written the <link id="theme-css"> of the active theme
    addStylesheet: (href, id) => new Promise((resolve, reject) => {
      const had = doc.getElementById('theme-css');
      if (had && had.getAttribute('href') === href) { resolve(); return; }
      const link = doc.createElement('link');
      Object.assign(link, { rel: 'stylesheet', href, id: 'theme-css' });
      link.dataset.theme = id;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`${href} could not be loaded`));
      doc.head.append(link);
      if (had) had.remove();   // one theme file at a time; the new one is already in place when the old goes
    }),
    fetchJson: async href => {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`${href}: ${response.status}`);
      return response.json();
    },
    // themes/tools/derive.js sets --bg to the catalog's `chrome`, so the token file is in effect when they agree
    applied: entry => getComputedStyle(root).getPropertyValue('--bg').trim().toLowerCase() === entry.chrome,
  };
}
