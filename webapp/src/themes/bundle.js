// A theme bundle as the app accepts it: the one data object that carries a whole theme (made by themes/tools/pack.mjs,
// published as offers/<token>.json while its event runs, kept on the device once the player takes it). Whatever the bundle says is rebuilt from
// whitelists and bounds (tokens.js, svg.js, art.js, pool.cleanEntry), so a bundle cannot restyle the page beyond what a theme
// may, cannot carry script, markup or a url, and an out-of-bounds token rejects the whole bundle (a half-applied theme can be
// unreadable). Shape:
//   { themeApi: 1, id, v, meta: { mode, name: {en, zh}, chrome, layout, swatches, symbol },
//     tokens: { '--bg': '#efe7ff', ... },            every colour token of css/theme.css + the template tokens it varies
//     art: { icons, mark, board },                   see art.js
//     fonts: [{ family, weight, data }] }            woff2 as base64; registered with the FontFace API (no url, no CSP change)
import { cleanArt } from './art.js';
import { BUILTIN_IDS } from './builtin.js';
import { cleanEntry } from './pool.js';
import { buildCss, cleanTokens } from './tokens.js';

export const MAX_BUNDLE = 200 * 1024;   // characters of JSON
export const MAX_FONT = 60 * 1024;      // bytes of one woff2
export const MAX_FONTS = 3;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const REQUIRED = ['--bg', '--surface', '--text', '--accent'];

const bytesOf = b64 => (globalThis.Buffer ? Buffer.from(b64, 'base64') : Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

function cleanFonts(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FONTS) return null;
  const out = [];
  for (const f of raw) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/.test(f?.family ?? '') || !/^\d{3}( \d{3})?$/.test(f?.weight ?? '')) return null;
    if (typeof f.data !== 'string' || !BASE64.test(f.data) || f.data.length > MAX_FONT * 1.4) return null;
    const bytes = bytesOf(f.data);
    if (bytes.length > MAX_FONT || String.fromCharCode(...bytes.slice(0, 4)) !== 'wOF2') return null;
    out.push({ family: f.family, weight: f.weight, data: f.data });
  }
  return out;
}

// { entry, css, art, fonts } for a valid bundle, else null. `known(name)`: the custom properties this build defines
// (css/theme.css); a token it does not know is ignored, one it knows with a bad value rejects the bundle.
export function cleanBundle(raw, { known } = {}) {
  if (!raw || typeof raw !== 'object' || raw.themeApi !== 1 || BUILTIN_IDS.includes(raw.id)) return null;
  if (JSON.stringify(raw).length > MAX_BUNDLE) return null;
  const entry = cleanEntry({ ...raw.meta, id: raw.id, v: raw.v });
  const fonts = cleanFonts(raw.fonts);
  if (!entry || !fonts) return null;
  const { tokens, rejected } = cleanTokens(raw.tokens, { fonts: fonts.map(f => f.family), known });
  if (rejected.length || REQUIRED.some(name => !tokens[name]) || tokens['--bg'].toLowerCase() !== entry.chrome) return null;
  return { entry, css: buildCss(entry.id, entry.mode, tokens), art: cleanArt(raw.art), fonts };
}
