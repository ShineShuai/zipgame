// Static tests of the theme templates (run from anywhere: node themes/tools/test.mjs). No browser, no dependencies: the
// sources (themes/<id>/theme.json, art.json), the bundle each packs into, and the contract with the app (the app's own validators
// must accept every bundle; the defaults here must match webapp/css/theme.css).
import { createHash } from 'node:crypto';
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from './derive.js';
import {
  POOL_FILE, SITE_DIR, buildSite, checkSite,
} from './build-site.mjs';
import { BUDGET, loadBase, loadThemes, packTheme, BASE_CSS } from './pack.mjs';
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

t('the site build writes one hashed file per theme and a manifest the app accepts; drafts are listed, never offered; no source is copied', () => {
  const out = mkdtempSync(`${tmpdir()}/site-`);
  try {
    const themes = THEMES.map(th => (th.id === 'wood' ? { ...th, live: false } : th));
    const manifest = buildSite(out, { themes, base: BASE });
    eq(manifest.map(m => m.id).sort(), THEMES.map(th => th.id).sort(), 'every theme');
    eq(manifest.filter(m => !m.live).map(m => m.id), ['wood'], 'the draft is flagged');
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

let pass = 0;
let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log(`ok    ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
