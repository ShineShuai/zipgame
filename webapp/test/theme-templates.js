// Static tests of the theme templates: the manifest (src/themes/catalog.js), the generated token files
// (css/themes/<id>.css), the art modules (src/themes/<id>/art.js) and their budgets. Node only, no browser.
//   node test/theme-templates.js            run alone
//   registered by tests.js: themeTemplateTests(t, ok, eq)
import { existsSync, readFileSync } from 'node:fs';
import { build, loadThemes } from '../tools/theme-gen.mjs';
import { audit, parseBase } from '../src/themes/derive.js';
import { isHex } from '../src/themes/color.js';
import { BUILTIN_IDS, CATALOG } from '../src/themes/catalog.js';
import { LAYOUT, PAIRS, TOKENS } from '../src/themes/schema.js';
import { boardSvg, iconSvg } from '../src/apps/themes/render.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const BASE = parseBase(read('css/theme.css'));
const THEMES = loadThemes();
const FLAT_ICONS = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon'];
const BUDGET = { css: 6 * 1024, art: 12 * 1024, catalogEntry: 900 };

const ARTS = {};
for (const theme of CATALOG.filter(c => c.art)) {
  ARTS[theme.id] = (await import(`../src/themes/${theme.id}/art.js`)).default;
}

// Minimal well-formedness check of svg markup: balanced tags, quoted attributes.
function wellFormed(markup) {
  const stack = [];
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  const stripped = markup.replace(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, '');
  return stack.length === 0 && !/[<>]/.test(stripped);
}

export function themeTemplateTests(t, ok, eq) {
  t('templates: the manifest is consistent', () => {
    const ids = CATALOG.map(c => c.id);
    eq(new Set(ids).size, ids.length, 'unique ids');
    eq(BUILTIN_IDS, ['light', 'dark'], 'light and dark are built in, and the only built-ins');
    for (const c of CATALOG) {
      ok(c.mode === 'light' || c.mode === 'dark', `${c.id}: mode`);
      ok(c.name.en && c.name.zh, `${c.id}: names in both languages`);
      ok(c.swatches.length === 4 && c.swatches.every(isHex), `${c.id}: four hex swatches`);
      ok(isHex(c.chrome) && c.chrome === c.swatches[0], `${c.id}: the browser bar colour is the page colour`);
      for (const [axis, key] of Object.entries(c.layout)) ok(LAYOUT[axis]?.includes(key), `${c.id}: layout ${axis}=${key}`);
      ok(c.symbol && wellFormed(c.symbol), `${c.id}: the symbol is well-formed svg`);
      ok(JSON.stringify(c).length <= BUDGET.catalogEntry, `${c.id}: manifest entry stays under ${BUDGET.catalogEntry} bytes`);
    }
  });

  t('templates: every non-built-in theme has its source, its generated CSS and (when listed) its art', () => {
    for (const c of CATALOG.filter(x => !x.builtin)) {
      ok(THEMES.some(th => th.id === c.id), `${c.id}: src/themes/${c.id}/theme.json`);
      ok(existsSync(new URL(`css/themes/${c.id}.css`, root)), `${c.id}: css/themes/${c.id}.css`);
      ok(Boolean(c.art) === existsSync(new URL(`src/themes/${c.id}/art.js`, root)), `${c.id}: art flag matches the file`);
    }
    for (const th of THEMES) ok(CATALOG.some(c => c.id === th.id && c.mode === th.mode), `${th.id}: in the manifest, same mode`);
  });

  t('templates: the committed CSS is what the generator writes, with every token, in bounds', () => {
    for (const th of THEMES) {
      const { css, problems } = build(th, BASE);
      eq(read(`css/themes/${th.id}.css`), css, `${th.id}: stale, run node tools/theme-gen.mjs`);
      eq(problems, [], `${th.id}: problems`);
      ok(css.length <= BUDGET.css, `${th.id}: ${css.length} bytes of CSS, budget ${BUDGET.css}`);
    }
  });

  t('templates: contrast of every pair, for every theme (the pairs css/theme.css already holds plus the board numbers)', () => {
    for (const th of THEMES) {
      const tokens = Object.fromEntries([...read(`css/themes/${th.id}.css`).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)]
        .map(m => [m[1], m[2].trim()]));
      const { fails, rows } = audit(tokens);
      eq(fails, [], `${th.id}: contrast`);
      eq(rows.length, PAIRS.length, `${th.id}: every pair was measured`);
    }
  });

  t('templates: a theme sets the colour tokens that its art and tiles read', () => {
    for (const th of THEMES) {
      const art = ARTS[th.id];
      if (!art) continue;
      const used = new Set([...Object.values(art.icons).join('').matchAll(/var\((--ic-[\w-]+)\)/g)].map(m => m[1]));
      const set = new Set(['--ic-ink', '--ic-paper', '--ic-shadow', ...(th.seeds.icons ?? []).map((_, i) => `--ic-${i + 1}`)]);
      if (!th.seeds.iconInk) set.delete('--ic-ink');
      if (!th.seeds.iconPaper) set.delete('--ic-paper');
      if (!th.seeds.iconShadow) set.delete('--ic-shadow');
      for (const name of used) ok(set.has(name), `${th.id}: icons read ${name}, the theme does not set it`);
    }
    for (const c of CATALOG.filter(x => x.layout?.menu === 'bento')) {
      eq(THEMES.find(th => th.id === c.id).seeds.vt?.length, 4, `${c.id}: a coloured-tile theme sets all four variant tiles`);
    }
  });

  t('templates: art covers the flat variants, uses tokens only, and stays small', () => {
    for (const [id, art] of Object.entries(ARTS)) {
      for (const icon of FLAT_ICONS) ok(art.icons[icon], `${id}: icon ${icon}`);
      for (const [name, inner] of Object.entries(art.icons)) {
        ok(wellFormed(inner), `${id}/${name}: well-formed`);
        ok(!/#[0-9a-f]{3,8}\b/i.test(inner.replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, '')), `${id}/${name}: a colour literal, use --ic-*`);
        ok(!/(?:^|[^\w-])(?:id|style)="/.test(inner) && !/url\(#/.test(inner), `${id}/${name}: no ids, no inline style`);
        ok(!/<(script|image|foreignObject)|\son\w+=/i.test(inner), `${id}/${name}: nothing but shapes`);
      }
      if (art.mark) {
        ok(wellFormed(art.mark), `${id}: the mark is well-formed`);
        ok(!/\sid="/.test(art.mark), `${id}: the mark has no ids (they would clash when it is on the page twice)`);
      }
      const b = art.board;
      ok(['lines', 'tiles'].includes(b.grid) && ['round', 'square', 'butt'].includes(b.cap), `${id}: board enums`);
      ok(['round', 'miter'].includes(b.join) && ['disc', 'square'].includes(b.num), `${id}: board join / number shape`);
      for (const key of ['tileRx', 'tileInset', 'tileEdgeW', 'depth', 'plateRx', 'pathW', 'wallW', 'numR', 'numRingW']) {
        ok(b[key] >= 0 && b[key] <= 0.5, `${id}: board.${key} (${b[key]}) is in CELL units, 0..0.5`);
      }
      ok(b.tileInset * 2 + b.depth < 1, `${id}: tiles leave room`);
      const bytes = JSON.stringify(art).length;
      ok(bytes <= BUDGET.art, `${id}: art is ${bytes} bytes, budget ${BUDGET.art}`);
    }
  });

  t('templates: the sample board and icons of the preview are well-formed and use tokens only', () => {
    for (const [id, art] of Object.entries(ARTS)) {
      const svg = boardSvg(art.board);
      ok(wellFormed(svg), `${id}: board svg is well-formed`);
      ok(!/#[0-9a-f]{3,8}\b/i.test(svg), `${id}: a colour literal in the board`);
      eq(art.board.gradient, svg.includes('url(#pv-path)'), `${id}: the path gradient follows the skin`);
      eq((svg.match(/<text /g) || []).length, 5, `${id}: five numbers`);
      for (const [name, inner] of Object.entries(art.icons)) ok(wellFormed(iconSvg(inner, name)), `${id}/${name}: icon svg`);
    }
  });

  t('templates: the new tokens exist in every generated file with the schema default or the theme\'s value', () => {
    for (const th of THEMES) {
      const css = read(`css/themes/${th.id}.css`);
      for (const name of Object.keys(TOKENS)) ok(css.includes(`  ${name}:`), `${th.id}: ${name}`);
    }
  });
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  let pass = 0;
  let fail = 0;
  const t = (name, fn) => {
    try { fn(); pass++; console.log(`ok    ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`); }
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  themeTemplateTests(t, ok, eq);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
