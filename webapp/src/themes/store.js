// The player's own themes, kept on the device: one record per theme in the pool (css, art, fonts), written when the player
// takes a theme and removed when it leaves the pool. Nothing here is ever fetched again: a theme that is not in this store
// is not the player's. The page's <head> script reads `css` straight from here, so the theme paints with the first frame
// and works offline.
import { cleanArt } from './art.js';

export const BUNDLE_KEY = id => `zip_theme_b_${id}`;
const CSS = id => new RegExp(`^:root\\[data-theme="${id}"\\]\\{[^<>{}]*\\}$`);
// a theme's token block as buildCss makes it: one rule for the theme's own attribute, no markup, no url, no import
export const validCss = (id, css) => typeof css === 'string' && CSS(id).test(css) && !/url\s*\(|@import/i.test(css);

export function createStore(storage) {
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  return {
    // false when the device refuses (quota, private mode): the theme is then not kept
    save({ entry, css, art, fonts }) {
      try {
        storage.setItem(BUNDLE_KEY(entry.id), JSON.stringify({ v: entry.v, css, art, fonts }));
        return true;
      } catch { return false; }
    },
    // { css, art, fonts } of an owned theme, or null (missing or damaged)
    load(id) {
      let rec = null;
      try { rec = JSON.parse(read(BUNDLE_KEY(id))); } catch { /* damaged */ }
      if (!rec || !validCss(id, rec.css)) return null;
      return { css: rec.css, art: cleanArt(rec.art), fonts: Array.isArray(rec.fonts) ? rec.fonts : [] };
    },
    has(id) { return this.load(id) !== null; },
    remove(id) { try { storage.removeItem(BUNDLE_KEY(id)); } catch { /* nothing to do */ } },
  };
}
