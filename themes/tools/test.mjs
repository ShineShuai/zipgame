// Static tests of the theme templates (run from anywhere: node themes/tools/test.mjs). No browser, no dependencies:
// the sources (themes/<id>/theme.json), what is generated from them (theme.css, catalog.json), the art, and the contract with
// the app (the app's own whitelist and pool code must accept every template; the defaults must match css/theme.css).
import { existsSync, readFileSync } from 'node:fs';
import { audit, parseBase } from './derive.js';
import { BASE_CSS, build, buildCatalog, loadBuiltin, loadThemes } from './gen.mjs';
import { LAYOUT, PAIRS, TOKENS } from './schema.js';
import { isHex } from './color.js';
import { boardSvg, iconSvg } from '../preview/render.js';
import { cleanArt, ICON_IDS } from '../../webapp/src/themes/art.js';
import { cleanLayout } from '../../webapp/src/themes/layout.js';
import { cleanEntry } from '../../webapp/src/themes/pool.js';
import { cleanInner, cleanSvg } from '../../webapp/src/themes/svg.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const BASE = parseBase(readFileSync(BASE_CSS, 'utf8'));
const THEMES = loadThemes();
const CATALOG = JSON.parse(read('catalog.json'));
const FLAT_ICONS = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon'];
const BUDGET = { css: 6 * 1024, art: 12 * 1024, entry: 900, catalog: 8 * 1024 };
const ART = Object.fromEntries(THEMES.filter(t => existsSync(new URL(`${t.id}/art.json`, root)))
  .map(t => [t.id, JSON.parse(read(`${t.id}/art.json`))]));

// Minimal well-formedness check of svg markup: balanced tags, quoted attributes.
function wellFormed(markup) {
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  const stack = [];
  for (const m of markup.matchAll(tag)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0 && !/[<>]/.test(markup.replace(tag, ''));
}

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

t('the catalog is what the generator writes, and small', () => {
  eq(read('catalog.json'), buildCatalog(THEMES, loadBuiltin()), 'stale catalog.json: run node themes/tools/gen.mjs');
  ok(read('catalog.json').length <= BUDGET.catalog, `catalog.json is ${read('catalog.json').length} bytes, budget ${BUDGET.catalog}`);
});

t('the manifest entries are valid, and the app accepts every one unchanged', () => {
  const ids = CATALOG.themes.map(c => c.id);
  eq(new Set(ids).size, ids.length, 'unique ids');
  eq(CATALOG.themes.filter(c => c.builtin).map(c => c.id), ['light', 'dark'], 'light and dark are the built-ins');
  for (const c of CATALOG.themes) {
    ok(c.name.en && c.name.zh, `${c.id}: names in both languages`);
    ok(c.swatches.length === 4 && c.swatches.every(isHex), `${c.id}: four hex swatches`);
    for (const [axis, key] of Object.entries(c.layout)) ok(LAYOUT[axis]?.includes(key), `${c.id}: layout ${axis}=${key}`);
    eq(cleanLayout(c.layout), c.layout, `${c.id}: the app knows the layout`);
    ok(c.symbol && wellFormed(c.symbol) && cleanInner(c.symbol, 600) !== null, `${c.id}: the symbol passes the app's whitelist`);
    const entry = cleanEntry(c);
    ok(entry, `${c.id}: cleanEntry accepts it`);
    eq([entry.id, entry.mode, entry.chrome, entry.layout, entry.symbol], [c.id, c.mode, c.chrome, c.layout, c.symbol], `${c.id}: nothing is changed on the way in`);
    ok(JSON.stringify(c).length <= BUDGET.entry, `${c.id}: entry is ${JSON.stringify(c).length} bytes, budget ${BUDGET.entry}`);
  }
  for (const th of THEMES) {
    const c = CATALOG.themes.find(x => x.id === th.id);
    ok(c && c.mode === th.mode && c.chrome === th.seeds.bg, `${th.id}: in the catalog; the browser bar colour is its --bg (the app probes that to know the file applied)`);
    eq(c.art, existsSync(new URL(`${th.id}/art.json`, root)), `${th.id}: the art flag matches the file`);
  }
});

t('the committed theme.css is what the generator writes, with every token, in bounds', () => {
  for (const th of THEMES) {
    const { css, problems } = build(th, BASE);
    eq(read(`${th.id}/theme.css`), css, `${th.id}: stale, run node themes/tools/gen.mjs`);
    eq(problems, [], `${th.id}: problems`);
    ok(css.length <= BUDGET.css, `${th.id}: ${css.length} bytes of CSS, budget ${BUDGET.css}`);
    for (const name of Object.keys(BASE.light)) ok(css.includes(`  ${name}:`), `${th.id}: ${name}`);
    for (const name of Object.keys(TOKENS)) ok(css.includes(`  ${name}:`), `${th.id}: ${name}`);
  }
});

t('the template defaults here are the ones webapp/css/theme.css gives light and dark', () => {
  const css = readFileSync(BASE_CSS, 'utf8');
  const block = css.slice(css.indexOf('template tokens:'), css.indexOf('end of template tokens'));
  const have = Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const want = Object.fromEntries(Object.entries(TOKENS).filter(([, s]) => !s.base).map(([n, s]) => [n, s.d]));
  eq(have, want, 'theme.css and schema.js disagree');
});

t('contrast of every pair, for every theme', () => {
  for (const th of THEMES) {
    const tokens = Object.fromEntries([...read(`${th.id}/theme.css`).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    const { fails, rows } = audit(tokens);
    eq(fails, [], `${th.id}: contrast`);
    eq(rows.length, PAIRS.length, `${th.id}: every pair was measured`);
  }
});

t('a theme sets the colour tokens its art and tiles read', () => {
  for (const th of THEMES) {
    const art = ART[th.id];
    if (!art) continue;
    const used = new Set([...Object.values(art.icons).join('').matchAll(/var\((--ic-[\w-]+)\)/g)].map(m => m[1]));
    const set = new Set((th.seeds.icons ?? []).map((_, i) => `--ic-${i + 1}`));
    if (th.seeds.iconInk) set.add('--ic-ink');
    if (th.seeds.iconPaper) set.add('--ic-paper');
    if (th.seeds.iconShadow) set.add('--ic-shadow');
    for (const name of used) ok(set.has(name), `${th.id}: icons read ${name}, the theme does not set it`);
    if (th.layout.menu === 'bento') eq(th.seeds.vt?.length, 4, `${th.id}: a coloured-tile theme sets all four variant tiles`);
  }
});

t('art: the app accepts all of it, it covers the flat variants, and it stays small', () => {
  for (const [id, art] of Object.entries(ART)) {
    const cleaned = cleanArt(art);
    for (const icon of FLAT_ICONS) ok(art.icons[icon], `${id}: icon ${icon}`);
    for (const name of Object.keys(art.icons)) {
      ok(ICON_IDS.includes(name), `${id}/${name}: not an icon id`);
      ok(cleaned.icons[name], `${id}/${name}: rejected by the app's whitelist`);
      ok(!/#[0-9a-f]{3,8}\b/i.test(art.icons[name].replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, '')), `${id}/${name}: a colour literal, use --ic-*`);
    }
    if (art.mark) ok(cleaned.mark && cleaned.mark === cleanSvg(art.mark), `${id}: the mark passes the whitelist`);
    eq(cleaned.board, art.board, `${id}: the board skin is in bounds, nothing is dropped`);
    ok(JSON.stringify(art).length <= BUDGET.art, `${id}: art is ${JSON.stringify(art).length} bytes, budget ${BUDGET.art}`);
  }
});

t('the sample board and icons of the preview are well-formed and use tokens only', () => {
  for (const [id, art] of Object.entries(ART)) {
    const svg = boardSvg(art.board);
    ok(wellFormed(svg), `${id}: board svg is well-formed`);
    ok(!/#[0-9a-f]{3,8}\b/i.test(svg), `${id}: a colour literal in the board`);
    eq(art.board.gradient, svg.includes('url(#pv-path)'), `${id}: the path gradient follows the skin`);
    eq((svg.match(/<text /g) || []).length, 5, `${id}: five numbers`);
    for (const [name, inner] of Object.entries(art.icons)) ok(wellFormed(iconSvg(inner, name)), `${id}/${name}: icon svg`);
  }
});

let pass = 0;
let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log(`ok    ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
