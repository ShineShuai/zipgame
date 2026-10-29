// Fetches the font files the themes name and do not have yet, once, at authoring time (npm run themes -- fonts --fetch [id ...]).
//   themes/<id>/fonts/<file>.woff2 is written from Google Fonts' own subsetting: the CSS API is asked for the families' glyphs of FONT_TEXT
//   only (`&text=`), so what comes back is a small woff2 (a few KB to some tens of KB), not the whole font. The files are committed with
//   the theme; build-site.mjs embeds them in that theme's bundle. A player never contacts Google: the bundle carries the font.
// Everything the net gives is checked: woff2 magic, the font budget. A family that is static on Google Fonts refuses a weight range
// (HTTP 400): the lowest weight of the range is fetched then, and it is said so.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadThemes, BUDGET } from './pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';   // the API answers woff2 to a browser
// the glyphs a theme's font draws: ASCII (digits, Latin letters, punctuation) and the typographic marks of the UI. Anything else (an accent,
// Chinese) is drawn by the next font of the stack, glyph by glyph. Widen it here to ship accents (À-ÿ) as well: about 60% more bytes.
export const FONT_TEXT = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '’‘“”–—…·×←↑→↓';

export const cssUrl = (family, weight, text = FONT_TEXT) => {
  const [lo, hi] = String(weight).split(' ');
  const axis = hi ? `${lo}..${hi}` : lo;
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${axis}&text=${encodeURIComponent(text)}&display=swap`;
};

// the woff2 url of the first @font-face of a css text, or null
export const woff2Url = css => (/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)\s*format\(['"]woff2['"]\)/.exec(css) ?? [])[1] ?? null;

// -> { bytes, weight, note } for one font entry { family, weight }; throws with the reason. `get(url) -> { ok, status, text(), bytes() }`
export async function fetchFont({ family, weight }, get) {
  let used = weight;
  let note = '';
  let res = await get(cssUrl(family, weight));
  if (!res.ok && res.status === 400 && String(weight).includes(' ')) {
    used = String(weight).split(' ')[0];   // a static family: no range
    res = await get(cssUrl(family, used));
    note = `static family: only weight ${used} fetched (the range ${weight} was asked for)`;
  }
  if (!res.ok) throw new Error(`${family}: the css answered ${res.status}`);
  const url = woff2Url(await res.text());
  if (!url) throw new Error(`${family}: no woff2 url in the css`);
  const file = await get(url);
  if (!file.ok) throw new Error(`${family}: the font answered ${file.status}`);
  const bytes = Buffer.from(await file.bytes());
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${family}: not a woff2 file`);
  if (bytes.length > BUDGET.font) throw new Error(`${family}: ${bytes.length} bytes, budget ${BUDGET.font}`);
  return { bytes, weight: used, note };
}

export const realGet = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return { ok: res.ok, status: res.status, text: () => res.text(), bytes: async () => new Uint8Array(await res.arrayBuffer()) };
};

// Fetches every missing file of the themes (or of `only`); returns { got, failed } and logs each. `themes`: normalised themes (default: all of themes/), `root`: the themes folder.
export async function fetchMissing({
  only = [], themes = loadThemes(), get = realGet, root = ROOT, log = console.log,
} = {}) {
  let got = 0;
  let failed = 0;
  for (const th of themes) {
    if (only.length && !only.includes(th.id)) continue;
    for (const f of th.fonts ?? []) {
      const file = `${root}${th.id}/fonts/${f.file}`;
      if (existsSync(file)) continue;
      try {
        const { bytes, note } = await fetchFont(f, get);
        mkdirSync(`${root}${th.id}/fonts`, { recursive: true });
        writeFileSync(file, bytes);
        got++;
        log(`themes/${th.id}/fonts/${f.file}  ${f.family}  ${bytes.length} bytes${note ? `  (${note})` : ''}`);
      } catch (e) { failed++; log(`FAILED themes/${th.id}/fonts/${f.file}: ${e.message}`); }
    }
  }
  return { got, failed };
}
