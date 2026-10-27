// Builds a theme's bundle: the one data object the game receives (webapp/src/themes/bundle.js), from the sources
//   themes/<id>/theme.json   metadata, the seed colours (five are enough), the vars the theme varies
//   themes/<id>/art.json     icons, brand mark, board skin
//   themes/<id>/fonts/*.woff2  (optional) self-hosted fonts, Latin subset, 60 KB at most each
//   webapp/css/theme.css     the base tokens every theme starts from
// Usage (from anywhere):
//   node themes/tools/pack.mjs [id ...]   writes themes/out/<id>.bundle.json (+ index.json): for the preview page (build-site.mjs packs again, into the site)
// The bundle is run through the app's own validator before it is written, so what is written is what the game accepts.
// Prints every contrast nudge (a seed that had to move to pass schema.js PAIRS) and every problem; exit 1 on a problem.
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { cleanBundle } from '../../webapp/src/themes/bundle.js';
import { cleanLayout } from '../../webapp/src/themes/layout.js';
import { audit, derive, parseBase, validate } from './derive.js';

const root = new URL('../', import.meta.url);
export const BASE_CSS = new URL('../../webapp/css/theme.css', import.meta.url);
export const OUT = new URL('out/', root);
const read = path => readFileSync(new URL(path, root), 'utf8');
export const BUDGET = { bundle: 32 * 1024, font: 60 * 1024 };   // a bundle is fetched once, when it is offered

// A theme.json may leave out what follows from the rest: themeApi and v (1), the id (the folder's name), the Chinese name (the English one;
// `name` may be a plain string), the layout (dashboard, tiles, side), the symbol (a zigzag), the four swatches (from the seeds).
export const DEFAULT_SYMBOL = '<path d="M4 7h16L4 17h16"/>';
export function normalise(raw, dir) {
  if (raw.id !== undefined && raw.id !== dir) throw new Error(`themes/${dir}/theme.json: the id "${raw.id}" is not the folder name "${dir}"`);
  const s = raw.seeds ?? {};
  const name = typeof raw.name === 'string' ? { en: raw.name } : raw.name ?? { en: dir };
  return {
    themeApi: 1,
    v: 1,
    ...raw,
    id: dir,
    name: { ...name, zh: name.zh ?? name.en },
    layout: cleanLayout(raw.layout),
    symbol: raw.symbol ?? DEFAULT_SYMBOL,
    swatches: raw.swatches ?? [s.bg, s.surface, s.accent, s.orange ?? s.ink],
  };
}

// Every theme of themes/ (a folder with a theme.json; names starting with _ or . are not themes), in folder order.
export function loadThemes() {
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && !/^[_.]/.test(d.name) && existsSync(new URL(`${d.name}/theme.json`, root)))
    .map(d => d.name).sort()
    .map(dir => normalise(JSON.parse(read(`${dir}/theme.json`)), dir));
}

export const loadBase = () => parseBase(readFileSync(BASE_CSS, 'utf8'));

// { bundle, notes, problems, missingFonts } for one theme. `bundle` is the plain object (JSON.stringify it to write it).
export function packTheme(theme, base) {
  const { tokens, notes } = derive(theme, base);
  const problems = [...validate(theme, tokens, base, (theme.fonts ?? []).map(f => f.family)), ...audit(tokens).fails];
  const fonts = [];
  const missingFonts = [];
  for (const f of theme.fonts ?? []) {
    const file = new URL(`${theme.id}/fonts/${f.file}`, root);
    if (!existsSync(file)) { missingFonts.push(`${theme.id}/fonts/${f.file}`); continue; }
    const data = readFileSync(file);
    if (data.length > BUDGET.font) problems.push(`${f.file}: ${data.length} bytes, budget ${BUDGET.font}`);
    fonts.push({ family: f.family, weight: f.weight, data: data.toString('base64') });
  }
  // a font token naming a family whose file is missing would be refused by the game: until the file exists, use the system stack
  const shipped = fonts.map(f => f.family);
  for (const name of ['--font-body', '--font-head', '--font-num']) {
    if (tokens[name] && /"([^"]+)"/.test(tokens[name])) {
      const unshipped = [...tokens[name].matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(fam => (theme.fonts ?? []).some(f => f.family === fam) && !shipped.includes(fam));
      if (unshipped.length) tokens[name] = tokens[name].replace(new RegExp(`"(?:${unshipped.join('|')})", `, 'g'), '');
    }
  }
  const art = existsSync(new URL(`${theme.id}/art.json`, root)) ? JSON.parse(read(`${theme.id}/art.json`)) : undefined;
  const bundle = {
    themeApi: 1,
    id: theme.id,
    v: theme.v,
    meta: { mode: theme.mode, name: theme.name, chrome: theme.chrome ?? theme.seeds.bg, layout: theme.layout, swatches: theme.swatches, symbol: theme.symbol },
    tokens,
    ...(art ? { art } : {}),
    ...(fonts.length ? { fonts } : {}),
  };
  const accepted = cleanBundle(bundle, { known: name => name in base.light });
  if (!accepted) problems.push('the game would not accept this bundle (webapp/src/themes/bundle.js)');
  const size = JSON.stringify(bundle).length;
  if (size - fonts.reduce((n, f) => n + f.data.length, 0) > BUDGET.bundle) problems.push(`bundle is ${size} bytes without fonts, budget ${BUDGET.bundle}`);
  return { bundle, notes, problems, missingFonts, size };
}

// Packs `only` (every theme when empty) into themes/out/; returns the number of themes with problems.
export function packAll(only = [], log = console.log) {
  const base = loadBase();
  let bad = 0;
  mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const theme of loadThemes().filter(t => !only.length || only.includes(t.id))) {
    const { bundle, notes, problems, missingFonts, size } = packTheme(theme, base);
    log(`${theme.id}: ${notes.length} nudged, ${problems.length} problems, ${size} bytes`);
    notes.forEach(n => log(`  nudge  ${n}`));
    problems.forEach(p => log(`  PROBLEM ${p}`));
    missingFonts.forEach(f => log(`  warn   themes/${f} is not there: the theme uses its system font stack`));
    if (problems.length) { bad++; continue; }
    writeFileSync(new URL(`${theme.id}.bundle.json`, OUT), JSON.stringify(bundle));
    index.push({ id: theme.id, file: `${theme.id}.bundle.json`, bytes: size });
  }
  writeFileSync(new URL('index.json', OUT), `${JSON.stringify(index, null, 1)}\n`);
  return bad;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  process.exit(packAll(process.argv.slice(2)) ? 1 : 0);
}
