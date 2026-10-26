// Static tests of the theme templates (run from anywhere: node themes/tools/test.mjs). No browser, no dependencies: the
// sources (themes/<id>/theme.json, art.json), the bundle each packs into, and the contract with the app (the app's own validators
// must accept every bundle; the defaults here must match webapp/css/theme.css).
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { audit } from './derive.js';
import { BUDGET, loadBase, loadThemes, packTheme, BASE_CSS } from './pack.mjs';
import { listOffers, publishBundle, withdraw } from './publish.mjs';
import { TOKEN_RE } from '../../webapp/src/themes/source.js';
import { LAYOUT, PAIRS, TOKENS } from './schema.js';
import { isHex } from './color.js';
import { boardSvg, iconSvg } from '../preview/render.js';
import { cleanArt, ICON_IDS } from '../../webapp/src/themes/art.js';
import { cleanBundle } from '../../webapp/src/themes/bundle.js';
import { cleanLayout } from '../../webapp/src/themes/layout.js';
import { cleanEntry } from '../../webapp/src/themes/pool.js';
import { cleanInner, cleanSvg } from '../../webapp/src/themes/svg.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const BASE = loadBase();
const THEMES = loadThemes();
const PACKED = Object.fromEntries(THEMES.map(th => [th.id, packTheme(th, BASE)]));
const FLAT_ICONS = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon'];
const BUDGET_ENTRY = 900;
const ART = Object.fromEntries(THEMES.filter(t => existsSync(new URL(`${t.id}/art.json`, root))).map(t => [t.id, JSON.parse(read(`${t.id}/art.json`))]));

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

t('every theme packs into a bundle the game accepts, without contrast problems, within budget', () => {
  ok(THEMES.length >= 4, 'themes found');
  for (const th of THEMES) {
    const { bundle, problems, size } = PACKED[th.id];
    eq(problems, [], `${th.id}: problems`);
    const accepted = cleanBundle(JSON.parse(JSON.stringify(bundle)), { known: n => n in BASE.light });
    ok(accepted, `${th.id}: the app rejects its bundle`);
    eq([accepted.entry.id, accepted.entry.mode, accepted.entry.chrome], [th.id, th.mode, th.seeds.bg], `${th.id}: identity survives the round trip`);
    ok(size <= BUDGET.bundle + (bundle.fonts ?? []).reduce((n, f) => n + f.data.length, 0), `${th.id}: ${size} bytes`);
    for (const name of Object.keys(BASE.light)) ok(name in bundle.tokens, `${th.id}: ${name}`);
    for (const name of Object.keys(TOKENS)) ok(name in bundle.tokens, `${th.id}: ${name}`);
  }
});

t('the metadata of every theme is valid, and the app takes it unchanged', () => {
  const ids = THEMES.map(c => c.id);
  eq(new Set(ids).size, ids.length, 'unique ids');
  for (const c of THEMES) {
    ok(c.themeApi === 1 && Number.isInteger(c.v) && c.v >= 1, `${c.id}: themeApi and v`);
    ok(c.name.en && c.name.zh, `${c.id}: names in both languages`);
    ok(c.swatches.length === 4 && c.swatches.every(isHex), `${c.id}: four hex swatches`);
    for (const [axis, key] of Object.entries(c.layout)) ok(LAYOUT[axis]?.includes(key), `${c.id}: layout ${axis}=${key}`);
    eq(cleanLayout(c.layout), c.layout, `${c.id}: the app knows the layout`);
    ok(c.symbol && wellFormed(c.symbol) && cleanInner(c.symbol, 600) !== null, `${c.id}: the symbol passes the app's whitelist`);
    const entry = cleanEntry({ ...c, chrome: c.seeds.bg });
    ok(entry, `${c.id}: cleanEntry accepts it`);
    eq([entry.id, entry.mode, entry.layout, entry.symbol], [c.id, c.mode, c.layout, c.symbol], `${c.id}: nothing is changed on the way in`);
    ok(JSON.stringify(PACKED[c.id].bundle.meta).length <= BUDGET_ENTRY, `${c.id}: meta is too big`);
  }
});

t('the template defaults here are the ones webapp/css/theme.css gives light and dark', () => {
  const css = readFileSync(BASE_CSS, 'utf8');
  const block = css.slice(css.indexOf('template tokens:'), css.indexOf('end of template tokens'));
  const have = Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const want = Object.fromEntries(Object.entries(TOKENS).filter(([, s]) => !s.base).map(([n, s]) => [n, s.d]));
  eq(have, want, 'theme.css and webapp/src/themes/tokens.js disagree');
});

t('contrast of every pair, for every theme (measured on the packed tokens)', () => {
  for (const th of THEMES) {
    const { fails, rows } = audit(PACKED[th.id].bundle.tokens);
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

t('publishing writes one unguessable file the game can read, withdrawing removes it, nothing else is touched', () => {
  const dir = pathToFileURL(`${mkdtempSync(`${tmpdir()}/offers-`)}/`);
  try {
    const { bundle } = PACKED.candy;
    const a = publishBundle(bundle, dir);
    const b = publishBundle(bundle, dir);
    ok(TOKEN_RE.test(a) && TOKEN_RE.test(b) && a !== b, 'a random token per publication, in the shape the game accepts');
    eq(readdirSync(dir).sort(), ['index.html', `${a}.json`, `${b}.json`].sort(), 'the files, and a blank index so no host lists the folder');
    eq(readFileSync(new URL('index.html', dir), 'utf8').includes('<script'), false);
    ok(cleanBundle(JSON.parse(readFileSync(new URL(`${a}.json`, dir), 'utf8')), { known: n => n in BASE.light }), 'the game accepts the published file');
    eq(listOffers(dir).map(o => [o.id, o.v]), [['candy', bundle.v], ['candy', bundle.v]]);
    eq(withdraw('../../etc/passwd', dir), [], 'a path is not a key');
    eq(withdraw('nothere', dir), []);
    eq(withdraw(a, dir), [a], 'by token');
    eq(listOffers(dir).length, 1);
    publishBundle(PACKED.wood.bundle, dir);
    eq(withdraw('candy', dir).length, 1, 'by theme id: every file of that theme');
    eq(listOffers(dir).map(o => o.id), ['wood'], 'the other theme stays');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

let pass = 0;
let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log(`ok    ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
