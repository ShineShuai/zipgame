// Static tests of the theme templates (run from anywhere: node themes/tools/test.mjs). No browser, no dependencies: the
// sources (themes/<id>/theme.json, art.json), the bundle each packs into, and the contract with the app (the app's own validators
// must accept every bundle; the defaults here must match webapp/css/theme.css).
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from './derive.js';
import { fileURLToPath } from 'node:url';
import {
  POOL_FILE, SITE_DIR, buildSite, checkSite,
} from './build-site.mjs';
import {
  BUDGET, DEFAULT_SYMBOL, loadBase, loadThemes, normalise, packTheme, BASE_CSS,
} from './pack.mjs';
import { create, remove, setLive } from './manage.mjs';
import { discover, importDesign } from './import-proto.mjs';
import { THEMES as SITE } from '../../webapp/src/config.js';
import { FILE_RE, MAX_POOL, cleanPool } from '../../webapp/src/themes/source.js';
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
  ok(THEMES.length >= 1, 'themes found');
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
    ok(c.live === undefined || typeof c.live === 'boolean', `${c.id}: live is true or false (false: a draft, only the dev reveal lists it)`);
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
    }
    if (art.mark) ok(cleaned.mark && cleaned.mark === cleanSvg(art.mark), `${id}: the mark passes the whitelist`);
    eq(cleaned.board, art.board, `${id}: the board skin is in bounds, nothing is dropped`);
  }
});

t('every theme draws its own Two paths composition (no two themes share one)', () => {
  const seen = new Map();
  for (const [id, art] of Object.entries(ART)) {
    const mine = art.icons.twopaths;
    ok(mine, `${id}: a twopaths icon`);
    ok(!seen.has(mine), `${id}: the same Two paths art as ${seen.get(mine)}`);
    seen.set(mine, id);
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

t('the site build writes one hashed file per theme and a manifest the app accepts; drafts are listed, never offered; no source is copied', () => {
  const out = mkdtempSync(`${tmpdir()}/site-`);
  try {
    const draft = THEMES[THEMES.length - 1].id;
    const themes = THEMES.map(th => (th.id === draft ? { ...th, live: false } : th));
    const manifest = buildSite(out, { themes, base: BASE });
    eq(manifest.map(m => m.id).sort(), THEMES.map(th => th.id).sort(), 'every theme');
    eq(manifest.filter(m => !m.live).map(m => m.id), [draft], 'the draft is flagged');
    const dir = join(out, SITE_DIR);
    eq(readdirSync(dir).sort(), [...manifest.map(m => `${m.f}.json`), POOL_FILE].sort(), 'the bundles and the manifest, nothing else (no theme.json, art.json or font)');
    eq([SITE_DIR, POOL_FILE], [/([\w-]+)\/$/.exec(SITE.base)[1], SITE.pool], 'the folder and the manifest are the ones config.js names');
    for (const m of manifest) {
      ok(FILE_RE.test(m.f), `${m.id}: the shape of the name the app accepts`);
      const text = readFileSync(join(dir, `${m.f}.json`), 'utf8');
      eq(createHash('sha256').update(text).digest('hex').slice(0, 24), m.f, `${m.id}: the name is the hash of the content`);
      const bundle = JSON.parse(text);
      eq(bundle.id, m.id);
      ok(cleanBundle(bundle, { known: n => n in BASE.light }), `${m.id}: the app accepts the file`);
      ok(!m.f.includes(m.id), `${m.id}: the name does not give the theme away`);
    }
    const pool = readFileSync(join(dir, POOL_FILE), 'utf8');
    ok(pool.length < MAX_POOL / 2, 'the manifest stays well inside what the app reads');
    eq(cleanPool(JSON.parse(pool)).map(c => [c.entry.id, c.live]).sort(), manifest.map(m => [m.id, m.live]).sort(), 'the app reads the manifest as it was written');
    eq(checkSite(out), [], 'a sound build');

    writeFileSync(join(dir, `${manifest[0].f}.json`), '{}');
    ok(checkSite(out).some(p => p.includes('not named by its content')), 'a changed file is found');
    rmSync(join(dir, `${manifest[1].f}.json`));
    ok(checkSite(out).some(p => p.includes('is missing')), 'a missing file is found');
    writeFileSync(join(dir, 'stray.json'), '{}');
    ok(checkSite(out).some(p => p.startsWith('stray.json')), 'a file the manifest does not list is found');
    writeFileSync(join(dir, POOL_FILE), '[1');
    eq(checkSite(out), [`${SITE_DIR}/${POOL_FILE}: not JSON`]);

    eq(buildSite(out, { themes, base: BASE }).length, themes.length, 'a new build starts from an empty folder');
    eq(checkSite(out), []);
    ok(!existsSync(join(out, SITE_DIR, 'stray.json')));
    let error = '';
    try { buildSite(out, { themes: [themes[0], themes[0]], base: BASE }); } catch (e) { error = e.message; }
    ok(error.includes('same id'), 'two themes with one id fail the build');
    error = '';
    try { buildSite(out, { themes: [{ ...themes[0], vars: { ...themes[0].vars, '--ctl-h': '90px' } }], base: BASE }); } catch (e) { error = e.message; }
    ok(error.includes('themes with problems') && error.includes('--ctl-h'), 'a theme with a problem (a token out of its bounds) fails the build');
  } finally { rmSync(out, { recursive: true, force: true }); }
});


t('a theme is easy to add: five colours and a name are a whole theme, and the template is one', () => {
  const minimal = { mode: 'light', name: 'Plain', seeds: { bg: '#f4f1ea', surface: '#ffffff', ink: '#1f2430', muted: '#5b6270', accent: '#2f6fed' } };
  const th = normalise(minimal, 'plain');
  eq([th.id, th.v, th.themeApi, th.name, th.symbol, th.layout, th.swatches], ['plain', 1, 1, { en: 'Plain', zh: 'Plain' }, DEFAULT_SYMBOL, { menu: 'dashboard', picker: 'tiles', actions: 'side' }, ['#f4f1ea', '#ffffff', '#2f6fed', '#1f2430']], 'what is left out is filled in (the fourth swatch is the second accent, else the ink)');
  const { bundle, problems } = packTheme(th, BASE);
  eq(problems, [], 'it packs without a problem');
  ok(cleanBundle(JSON.parse(JSON.stringify(bundle)), { known: n => n in BASE.light }), 'and the app accepts it');
  for (const dark of [false, true]) {
    const d = normalise({ ...minimal, mode: dark ? 'dark' : 'light', seeds: dark ? { bg: '#10131c', surface: '#1a1f2c', ink: '#eef0f6', muted: '#a3aabd', accent: '#7aa2ff' } : minimal.seeds }, 'plain');
    eq(packTheme(d, BASE).problems, [], `${dark ? 'dark' : 'light'} with five colours`);
  }
  eq(normalise({ ...minimal, name: { en: 'A', zh: '甲' }, v: 3, symbol: '<path d="M0 0"/>' }, 'plain').name.zh, '甲', 'what is stated wins');
  let error = '';
  try { normalise({ ...minimal, id: 'other' }, 'plain'); } catch (e) { error = e.message; }
  ok(error.includes('is not the folder name'), 'the id is the folder name');
  const template = JSON.parse(read('_template/theme.json'));
  eq(packTheme(normalise(template, 'my-theme'), BASE).problems, [], 'the template packs');
  ok(!THEMES.some(c => c.id.startsWith('_')), 'the template is not a theme of the pool');
});

t('a theme is easy to add and to remove: new, retire, restore, remove touch only its own folder', () => {
  const dir = mkdtempSync(`${tmpdir()}/themes-`);
  try {
    cpSync(new URL('_template/', root), join(dir, '_template'), { recursive: true });
    cpSync(new URL(`${THEMES[0].id}/`, root), join(dir, THEMES[0].id), { recursive: true });
    const before = readdirSync(dir).sort();
    eq(create('fresh', '_template', dir + '/'), 'themes/fresh/');
    eq(JSON.parse(readFileSync(join(dir, 'fresh/theme.json'), 'utf8')).id, 'fresh');
    eq(readdirSync(dir).sort(), [...before, 'fresh'].sort(), 'one new folder, nothing else');
    create('copy', THEMES[0].id, dir + '/');
    const copy = JSON.parse(readFileSync(join(dir, 'copy/theme.json'), 'utf8'));
    eq([copy.id, copy.v, copy.name, copy.proto, copy.live, existsSync(join(dir, 'copy/art.json'))], ['copy', 1, { en: 'copy', zh: 'copy' }, undefined, undefined, existsSync(new URL(`${THEMES[0].id}/art.json`, root))], 'a copy is a new theme of its own, with the art of the original');
    for (const bad of ['fresh', 'light', 'Bad Id', '', '9x', 'a'.repeat(30)]) {
      let msg = '';
      try { create(bad, '_template', dir + '/'); } catch (e) { msg = e.message; }
      ok(msg, `refused: ${bad}`);
    }
    setLive('fresh', false, dir + '/');
    eq(JSON.parse(readFileSync(join(dir, 'fresh/theme.json'), 'utf8')).live, false, 'retired: a draft');
    setLive('fresh', true, dir + '/');
    eq('live' in JSON.parse(readFileSync(join(dir, 'fresh/theme.json'), 'utf8')), false, 'restored');
    remove('copy', dir + '/');
    eq(readdirSync(dir).sort(), [...before, 'fresh'].sort(), 'removed: only that folder is gone');
    let msg = '';
    try { remove('copy', dir + '/'); } catch (e) { msg = e.message; }
    ok(msg.includes('is not there'), 'nothing to remove twice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t('a design page is a theme: every page of assets/design imports, packs without a problem and reproduces the committed theme', () => {
  const assets = fileURLToPath(new URL('../../assets', import.meta.url));
  const found = discover(assets);
  const ids = Object.keys(found);
  if (!ids.length) return;   // a checkout without the design pages
  for (const id of ids) {
    const notes = [];
    const { theme, art } = importDesign(id, assets, notes, found[id]);
    eq(packTheme(normalise(theme, id), BASE).problems, [], `${id}: the import packs`);
    ok(Object.keys(art.icons).length >= 9, `${id}: its icons came across`);
    const committed = existsSync(new URL(`${id}/theme.json`, root)) ? JSON.parse(read(`${id}/theme.json`)) : null;
    if (committed?.proto) {
      eq(theme, committed, `${id}: themes/${id}/theme.json is what the design gives (npm run themes:import)`);
      eq(art, JSON.parse(read(`${id}/art.json`)), `${id}: art.json is what the design gives`);
    }
  }
  // a new page needs no other step: a design the meta does not know gets the defaults
  const dir = mkdtempSync(`${tmpdir()}/assets-`);
  try {
    mkdirSync(join(dir, 'design'), { recursive: true });
    mkdirSync(join(dir, 'images/logo/proto'), { recursive: true });
    const id = ids[0];
    writeFileSync(join(dir, `design/zigzag-77-brand-new.html`), readFileSync(join(assets, `design/${found[id].design}.html`)));
    writeFileSync(join(dir, `images/logo/proto/77-brand-new-variants.svg`), readFileSync(join(assets, `images/logo/proto/${found[id].sheet}-variants.svg`)));
    writeFileSync(join(dir, 'design/notes.html'), '<p>not a design</p>');
    eq(Object.keys(discover(dir)), ['brand-new'], 'only zigzag-NN-<id>.html pages are designs');
    const { theme } = importDesign('brand-new', dir, [], discover(dir)['brand-new']);
    eq([theme.id, theme.name, theme.symbol, theme.layout, theme.proto], ['brand-new', { en: 'Brand New', zh: 'Brand New' }, DEFAULT_SYMBOL, { menu: 'dashboard', picker: 'tiles', actions: 'side' }, 'zigzag-77-brand-new'], 'the defaults');
    eq(packTheme(normalise(theme, 'brand-new'), BASE).problems, [], 'and it packs');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

let pass = 0;
let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log(`ok    ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
