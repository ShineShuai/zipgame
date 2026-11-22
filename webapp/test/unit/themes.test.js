// Tests of the themes: the light / dark token file css/theme.css (every colour of the play and
// stats pages comes from it), the contrast of the pairs the screens put together and the choice
// logic of src/ui/theme.js; the theme system (src/themes): the whitelists, the bundle a theme
// arrives in, the device store, the files the site serves, the pool, the controller (event ->
// offer -> take or leave; the dev reveal) and the page's inline head script, run for real
// (node:vm) and compared with the pool code it mirrors, with fakes for storage, the network and
// the page; and the offer days (src/themes/calendar.js): the rule, the draw of 1-2 days a month,
// the spread over the month, the offer day of a local date, and what a player can learn from the
// days. The templates themselves (the authoring side) are tested by themes/tools/test.mjs.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolveTheme, parseTheme, THEME_KEY } from '../../src/ui/theme.js';
import {
  POOL_KEY,
  activeEntry,
  cleanEntry,
  evictable,
  fresh,
  isClassicPool,
  MODE_KEY,
  nextEntry,
  parseState,
  remove,
  save,
  select,
  serialize,
  setCap,
} from '../../src/themes/pool.js';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { applyEntry, loadFonts } from '../../src/themes/apply.js';
import { currentArt, setArt, solidIsDark } from '../../src/themes/art-state.js';
import { variantIcon } from '../../src/apps/play/icons.js';
import { boardSvg, COLORS } from '../../src/apps/play/board.js';
import { makePuzzle } from '../../src/core/model.js';
import { portalColorVar, PORTAL_COLORS } from '../../src/view/portal-icons.js';
import { cleanArt, CLASSIC_BOARD } from '../../src/themes/art.js';
import { cleanBundle } from '../../src/themes/bundle.js';
import { BUILTIN, BUILTIN_IDS } from '../../src/themes/builtin.js';
import { createThemes } from '../../src/themes/index.js';
import {
  EVENT_KEY,
  SEED_KEY,
  TICK_MS,
  endOfDay,
  hash,
  newSeed,
  offerOrder,
  watchDay,
  EVENT_RE,
} from '../../src/themes/event.js';
import { SLOT_GOTD_SOLVES, SLOT_STREAK_DAYS, slotsFor } from '../../src/themes/slots.js';
import { FINAL_MS, OFFER_KEY, parseOffer, serializeOffer } from '../../src/themes/trial.js';
import { cleanLayout, DEFAULT_LAYOUT, LAYOUT as PRESETS } from '../../src/themes/layout.js';
import {
  browserSource,
  cleanPool,
  createSource,
  FILE_RE,
  MAX_FILE,
  MAX_POOL,
  MAX_THEMES,
} from '../../src/themes/source.js';
import { BUNDLE_KEY, createStore } from '../../src/themes/store.js';
import { cleanTokens, buildCss } from '../../src/themes/tokens.js';
import {
  devHtml,
  devItems,
  nextDayText,
  pickerHtml,
  pickerItems,
} from '../../src/themes/picker.js';
import { chipHtml, formatLeft, offerHtml, ruleHtml } from '../../src/themes/offer.js';
import { cleanInner, cleanSvg, freshScope, scopeIds } from '../../src/themes/svg.js';
import {
  MIN_GAP,
  candidates,
  dateValue,
  daysInMonth,
  eventAt,
  monthPlan,
  nextEvent,
  ruleExample,
  validDigits,
} from '../../src/themes/calendar.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { THEMES } from '../../src/config.js';

// ---- the light / dark tokens and the choice logic

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const THEME = read('css/theme.css');

// The declarations of the first block that starts with `selector {` in the token file.
function tokens(selector) {
  const start = THEME.indexOf(`${selector} {`);
  const body = THEME.slice(start, THEME.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = tokens(':root');
const DARK = tokens(':root[data-theme="dark"]');

// Resolves var(--x) chains of one theme.
const value = (theme, name) => {
  let v = theme[name];
  for (let i = 0; i < 4 && v && v.startsWith('var('); i++) v = theme[v.slice(4, -1)];
  return v;
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = hex => {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum ratio]: text 4.5, graphics (a path, a ring, a button on a surface) 3.
const PAIRS = [
  ['--text', '--surface', 4.5],
  ['--heading', '--surface', 4.5],
  ['--muted', '--surface', 4.5],
  ['--muted', '--surface-2', 4.5],
  ['--accent-text', '--surface', 4.5],
  ['--accent-text', '--surface-2', 4.5],
  ['--accent-text', '--accent-soft', 4.5],
  ['--on-accent', '--accent', 4.5],
  ['--ok', '--ok-bg', 4.5],
  ['--warn', '--warn-bg', 4.5],
  ['--danger', '--surface', 4.5],
  ['--heal', '--heal-bg', 4.5],
  ['--on-orange', '--orange', 4.5],
  ['--text', '--bg', 4.5],
  ['--b-num', '--b-bg', 3],
  ['--b-wall', '--b-bg', 3],
  ['--b-path', '--b-bg', 3],
  ['--b-red', '--b-bg', 3],
  ['--b-blue', '--b-bg', 3],
  ['--b-wrong', '--b-bg', 3],
  ['--b-num-on', '--b-num', 4.5],
  ['--accent', '--surface', 3],
];

// Tokens the dark theme may leave as they are (the same value works on both).
const SAME_IN_BOTH = [
  '--accent',
  '--on-accent',
  '--radius',
  '--on-orange',
  '--icon-path',
  '--logo-plate',
  '--logo-tile',
  '--logo-line',
  '--logo-path',
  '--logo-dot',
  '--shadow-none',
];

test('theme: the choice is the saved one, else the system setting', () => {
  assert.deepStrictEqual(
    [resolveTheme('dark', false), resolveTheme('light', true)],
    ['dark', 'light'],
    'a saved choice wins',
  );
  assert.deepStrictEqual(
    [resolveTheme(null, true), resolveTheme(null, false), resolveTheme('blue', true)],
    ['dark', 'light', 'dark'],
  );
  assert.deepStrictEqual(
    [parseTheme('dark'), parseTheme('light'), parseTheme('x'), parseTheme(null)],
    ['dark', 'light', null, null],
  );
  // compat pin: the key the page heads and the stored choice use
  assert.deepStrictEqual(
    THEME_KEY,
    'zip_theme',
    'the page heads read this key before the first paint',
  );
});

test('theme: the inline head scripts read the keys the theme code writes', () => {
  // the play page: the pool (themes/pool.js POOL_KEY) and, for a first run after the update, the old mode key
  const play = read('index.html');
  assert.ok(
    play.includes(`getItem('${POOL_KEY}')`) && play.includes(`getItem('${THEME_KEY}')`),
    'index.html sets data-theme before the first paint',
  );
  assert.ok(play.includes('css/theme.css'), 'index.html loads the tokens');
  // the stats page follows the mode the play page mirrors under THEME_KEY
  const stats = read('stats.html');
  assert.ok(
    stats.includes(`localStorage.getItem('${THEME_KEY}')`) && stats.includes('css/theme.css'),
    'stats.html',
  );
});

test('theme: dark overrides the light tokens (and only those), except values that hold in both', () => {
  for (const name of Object.keys(DARK))
    assert.ok(name in LIGHT, `${name} is only in the dark block`);
  // the template tokens (shape, size, type ...) are the same in both; a theme may override them
  const block = THEME.slice(
    THEME.indexOf('template tokens:'),
    THEME.indexOf('end of template tokens'),
  );
  const template = [...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]);
  assert.ok(
    template.length > 40 && template.includes('--r-3') && template.includes('--ic-1'),
    'the template block is found',
  );
  const same = Object.keys(LIGHT).filter(
    name => !(name in DARK) && !SAME_IN_BOTH.includes(name) && !template.includes(name),
  );
  // logo tokens alias the icon tokens, so they follow the dark values without an entry of their own
  assert.deepStrictEqual(
    same.filter(name => !name.startsWith('--logo-')),
    [],
    'tokens that dark forgot',
  );
});

test('theme: contrast of the pairs the screens use, in light and in dark', () => {
  for (const [mode, theme] of [
    ['light', LIGHT],
    ['dark', { ...LIGHT, ...DARK }],
  ]) {
    for (const [fg, bg, min] of PAIRS) {
      const a = value(theme, fg),
        b = value(theme, bg);
      assert.ok(
        /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b),
        `${mode} ${fg} on ${bg}: plain hex values`,
      );
      const ratio = contrast(a, b);
      assert.ok(ratio >= min, `${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}`);
    }
  }
});

test("theme: no colour literal in the pages' CSS or the board code; every var(--x) is defined", () => {
  const files = [
    'css/play.css',
    'css/stats.css',
    'src/apps/play/board.js',
    'src/apps/play/pentagon-board.js',
  ];
  for (const file of files) {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepStrictEqual(
      (text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(
        h => !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(h),
      ),
      [],
      `${file}: not a colour`,
    );
    // the data: URI of the select arrow is the one literal CSS allows (a colour inside an image cannot use var())
    const literals =
      text.replace(/url\("data:[^"]*"\)/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
    assert.deepStrictEqual(literals, [], `${file}: colour literals`);
    // --arrow is not a colour: main.js sets it on a popover to keep its arrow on the tile
    // --rb-* and --bw-sub are derived in play.css itself from template tokens (the radii of boxes with text, the border of nested boxes)
    const LOCAL = ['--arrow', '--rb-1', '--rb-2', '--rb-tile', '--rb-3', '--bw-sub'];
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g))
      assert.ok(m[1] in LIGHT || LOCAL.includes(m[1]), `${file}: ${m[1]} is not in theme.css`);
  }
});

test("theme: the play app's JS has no colour literal outside the palettes of the 3D views and the portal colours", () => {
  const allowed = new Set(['solid.js', 'portal-icons.js']);
  const dir = new URL('../../src/apps/play/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.js') && !allowed.has(n))) {
    const text = readFileSync(new URL(name, dir), 'utf8').replace(/\/\/.*$/gm, '');
    assert.deepStrictEqual(text.match(/['"`]#[0-9a-fA-F]{3,8}['"`]/g) || [], [], `${name}`);
  }
  assert.ok(statSync(new URL('../../css/theme.css', import.meta.url)).size > 1000);
});

// ---- the theme system

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const SYMBOL = '<circle cx="12" cy="12" r="5"/><path d="M7 12 2.5 8.5v7z"/>';
const LAYOUT = { menu: 'dashboard', picker: 'tiles', actions: 'side' };
const woff2 = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]).toString('base64');

// A valid bundle as themes/tools/pack.mjs makes it (a handful of tokens is enough for the app's checks).
const bundle = (id, mode = 'light', extra = {}) => ({
  themeApi: 1,
  id,
  v: 3,
  meta: {
    mode,
    name: { en: id.toUpperCase(), zh: '主题' },
    chrome: mode === 'dark' ? '#2b1d14' : '#efe7ff',
    layout: LAYOUT,
    swatches: ['#efe7ff', '#ffffff', '#6a4cf0', '#e8384f'],
    symbol: SYMBOL,
  },
  tokens: {
    '--bg': mode === 'dark' ? '#2b1d14' : '#efe7ff',
    '--surface': '#ffffff',
    '--text': '#2b1b5a',
    '--accent': '#6a4cf0',
    '--r-2': '22px',
    '--ctl-h': '50px',
    '--font-body': '"Trebuchet MS", sans-serif',
  },
  art: {
    icons: { standard: '<path d="M0 0"/>' },
    mark: '<svg viewBox="0 0 96 96"><rect width="96" height="96"/></svg>',
    board: { grid: 'tiles' },
  },
  ...extra,
});
const CANDY = bundle('candy');
const WOOD = bundle('wood', 'dark');
const entryOf = b => cleanBundle(b).entry;
const withPool = (pool, active = null, cap = pool.length) => ({ v: 2, cap, active, pool });

// ---- fakes ----
const memoryStorage = (initial = {}, { quota = false } = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (quota && k.startsWith('zip_theme_b_')) throw new Error('QuotaExceededError');
      data[k] = String(v);
    },
    removeItem: k => {
      delete data[k];
    },
  };
};
const ownedRecord = b => {
  const c = cleanBundle(b);
  return JSON.stringify({ v: c.entry.v, css: c.css, art: c.art, fonts: c.fonts });
};

// files: the site's files by name (f -> bundle), pool: its manifest as source.pool() gives it (null: not reachable), calls: what was fetched
const stem = id => createHash('sha256').update(id).digest('hex').slice(0, 24);
const poolOf = (bundles, drafts = []) =>
  bundles.map(b => ({ entry: entryOf(b), f: stem(b.id), live: !drafts.includes(b.id) }));
const manifestOf = (bundles, drafts = []) =>
  bundles.map(b => ({ id: b.id, v: b.v, ...b.meta, f: stem(b.id), live: !drafts.includes(b.id) }));
const filesOf = bundles => Object.fromEntries(bundles.map(b => [stem(b.id), b]));
let counter = 0;
const steady = () => () => {
  counter = (counter + 0.3819) % 1;
  return counter;
}; // a fixed, spread-out "random"

function rig({
  stored,
  owned = [],
  legacy,
  dark = false,
  quota = false,
  clock = { t: 1000 },
  files = {},
  pool = null,
  storage: given = null,
  trialMs = 1800000,
  idle = () => true,
} = {}) {
  const initial = {};
  if (stored) initial[POOL_KEY] = typeof stored === 'string' ? stored : serialize(stored);
  if (legacy) initial[MODE_KEY] = legacy;
  for (const b of owned) initial[BUNDLE_KEY(b.id)] = ownedRecord(b);
  const storage = given ?? memoryStorage(initial, { quota });
  const calls = [];
  const listeners = [];
  const media = { matches: dark, addEventListener: (_, fn) => listeners.push(fn) };
  const applied = [];
  const timeouts = [];
  const cleared = [];
  const fontLoads = [];
  const ctl = createThemes({
    storage,
    media,
    store: createStore(storage),
    now: () => clock.t,
    random: steady(),
    trialMs,
    idle,
    source: {
      pool: async () => {
        calls.push('pool');
        return typeof pool === 'function' ? pool() : pool;
      },
      bundle: async f => {
        calls.push(f);
        return files[f] ?? null;
      },
    },
    apply: (e, loaded) => applied.push(loaded ? `${e.id}+css` : e.id),
    loadFonts: fonts => {
      fontLoads.push(fonts.length);
      return {
        release() {
          fontLoads.push('released');
        },
      };
    },
    timers: {
      setTimeout: (fn, ms) => {
        timeouts.push({ fn, ms });
        return timeouts.length;
      },
      clearTimeout: id => cleared.push(id),
    },
  });
  return { storage, ctl, media, listeners, applied, timeouts, cleared, fontLoads, clock, calls };
}

function runBoot({ storage = {}, dark = false } = {}) {
  const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dataset = {};
  const appended = [];
  const meta = { color: '#f4f7ff' };
  const document = {
    documentElement: { dataset },
    head: { appendChild: el => appended.push(el) },
    createElement: () => ({}),
    querySelector: sel =>
      sel.includes('theme-color')
        ? {
            setAttribute: (_k, v) => {
              meta.color = v;
            },
          }
        : null,
  };
  vm.runInNewContext(script, {
    document,
    localStorage: { getItem: k => (k in storage ? storage[k] : null) },
    matchMedia: () => ({ matches: dark }),
  });
  return { dataset, appended, meta };
}

test('themes: the svg whitelist keeps shapes and paint servers and refuses everything else', () => {
  assert.deepStrictEqual(cleanSvg(SYMBOL), SYMBOL, 'shapes pass unchanged');
  assert.deepStrictEqual(
    cleanInner('<path d="M0 0" fill="color-mix(in srgb, var(--ic-1) 70%, #000)"/>') !== null,
    true,
    'tokens and color-mix pass',
  );
  for (const bad of [
    '<script>alert(1)</script>',
    '<path d="M0 0" onload="x()"/>',
    '<path d="M0 0" style="fill:red"/>',
    '<use href="#a"/>',
    '<image href="x.png"/>',
    '<path d="M0 0" fill="url(https://evil/x.svg#a)"/>',
    '<path d="M0 0" fill="url(//evil/x)"/>',
    '<path d="M0 0" stroke-width="url(#a)"/>',
    '<path d="M0 0" fill="url(#a b)"/>',
    '<path id="1a" d="M0 0"/>',
    '<path id="a b" d="M0 0"/>',
    '<g><path d="M0 0"/>',
    '<path d="M0 0"/></g>',
    'text<path d="M0 0"/>',
    '<path d="M0 0" fill="javascript:x"/>',
    '<foreignObject/>',
    '<path d="M0 0" fill="a&b"/>',
    '<path d="M0 0" style="background:url(x)"/>',
    '<path d="M0 0" style="mix-blend-mode:multiply;fill:red"/>',
    '<g>12</g>',
    '<text>a long caption</text>',
    '<feImage href="x"/>',
    '<filter><feOffset dx="1"/></filter>',
    '<a href="x"/>',
    '<path d="M0 0" font-family="Evil"/>',
  ])
    assert.deepStrictEqual(cleanSvg(bad), null, bad);
  assert.deepStrictEqual(cleanSvg('x'.repeat(30)), null);
  assert.deepStrictEqual(cleanSvg('<path d="M0 0"/>'.repeat(500), 1000), null, 'too long');
  const rich =
    '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>' +
    '<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5" fx="0.3" fy="0.3"><stop offset="0" stop-color="#fff"/></radialGradient><clipPath id="c1"><rect width="4" height="4"/></clipPath>' +
    '<pattern id="p1" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="2"/></pattern>' +
    '<filter id="b1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
    '<g clip-path="url(#c1)"><rect width="4" height="4" fill="url(#g1)" filter="url(#b1)" style="mix-blend-mode:multiply"/><rect width="4" height="4" fill="url(#p1)" shape-rendering="crispEdges"/></g>' +
    '<text x="24" y="24" dy=".35em" text-anchor="middle" font-size="9" font-weight="700" fill="url(#g2)">7</text>';
  assert.deepStrictEqual(
    cleanSvg(rich),
    rich,
    'gradients, a clip path, a pattern, a blur, a blend mode and a short label pass unchanged',
  );
  assert.deepStrictEqual(
    cleanSvg('<text x="2" y="2">1&gt;</text>'),
    '<text x="2" y="2">1&gt;</text>',
    'a prompt sign is a label too',
  );
  assert.deepStrictEqual(
    cleanSvg('<text x="2" y="2">1&amp;</text>'),
    null,
    'any other entity is not',
  );
  assert.deepStrictEqual(
    cleanSvg('<text x="2" y="2">1<b>2</b></text>'),
    null,
    'nor is markup in a label',
  );
});

test('themes: the ids of a drawing are its own: a piece drawn twice does not share a gradient', () => {
  const piece =
    '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g1)" stroke="url(#g1)"/>';
  assert.deepStrictEqual(
    scopeIds(piece, 'x'),
    '<defs><linearGradient id="g1-x"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g1-x)" stroke="url(#g1-x)"/>',
  );
  const [scopeA, scopeB] = [freshScope(), freshScope()];
  assert.ok(scopeA !== scopeB, 'every call a new scope');
  assert.deepStrictEqual(
    scopeIds('<path d="M0 0"/>', 'x'),
    '<path d="M0 0"/>',
    'nothing to rename',
  );
  const scoped = scopeIds(piece, freshScope());
  assert.ok(cleanSvg(scoped) === scoped, 'a scoped piece is still clean');
});

test('themes: tokens are held to the contract: bounds, kinds, no url(), no way out of the rule', () => {
  const good = {
    '--bg': '#fff',
    '--r-2': '22px',
    '--ctl-h': '50px',
    '--shadow': '0 10px 28px rgba(1, 2, 3, 0.2)',
    '--bg-image':
      'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0 2px, transparent 2px 9px)',
  };
  assert.deepStrictEqual(cleanTokens(good).rejected, [], 'all fine');
  for (const [name, value] of [
    ['--ctl-h', '80px'],
    ['--ctl-h', '10px'],
    ['--r-2', '90px'],
    ['--bg', 'red; } body { display: none'],
    ['--bg', 'url(x.png)'],
    ['--bg-image', 'url(x.png)'],
    ['--bg', 'expression(1)'],
    ['--font-body', '"Evil Font", sans-serif'],
    ['--shadow', '0 0 0 url(x)'],
    ['--bg', '#12345'],
    ['--tt-head', 'blink'],
    ['Bg', '#fff'],
    ['--bg', ''],
    ['--bg', 'x'.repeat(400)],
  ])
    assert.deepStrictEqual(cleanTokens({ [name]: value }).rejected, [name], `${name}: ${value}`);
  assert.deepStrictEqual(
    cleanTokens({ '--from-the-future': '#fff' }, { known: () => false }).ignored,
    ['--from-the-future'],
    'an unknown token is ignored, not an error',
  );
  assert.deepStrictEqual(
    buildCss('candy', 'light', { '--bg': '#fff' }),
    ':root[data-theme="candy"]{color-scheme:light;--bg:#fff;}',
  );
});

test('themes: a bundle is accepted whole or not at all, and rebuilt from the whitelists', () => {
  const b = cleanBundle(CANDY);
  assert.deepStrictEqual(
    [
      b.entry.id,
      b.entry.mode,
      b.entry.name.zh,
      b.css.startsWith(':root[data-theme="candy"]{color-scheme:light;'),
    ],
    ['candy', 'light', '主题', true],
  );
  assert.ok(b.art.mark.startsWith('<svg') && b.art.icons.standard && b.art.board.grid === 'tiles');
  const bad = (why, raw) => assert.deepStrictEqual(cleanBundle(raw), null, why);
  bad('a built-in id', { ...CANDY, id: 'dark' });
  bad('another api version', { ...CANDY, themeApi: 2 });
  bad('an out-of-bounds token rejects the bundle', {
    ...CANDY,
    tokens: { ...CANDY.tokens, '--ctl-h': '90px' },
  });
  bad('a url in a token', {
    ...CANDY,
    tokens: { ...CANDY.tokens, '--bg-image': 'url(//evil/x.png)' },
  });
  bad('a required token missing', {
    ...CANDY,
    tokens: { '--bg': '#efe7ff', '--surface': '#fff', '--text': '#000' },
  });
  bad("the bar colour is the theme's --bg", {
    ...CANDY,
    meta: { ...CANDY.meta, chrome: '#000000' },
  });
  bad('not an id', { ...CANDY, id: 'a b' });
  bad('too big', { ...CANDY, art: { ...CANDY.art, junk: 'x'.repeat(210000) } });
  bad('not an object', 'candy');
  assert.deepStrictEqual(
    cleanBundle(
      { ...CANDY, tokens: { ...CANDY.tokens, '--from-the-future': '#fff' } },
      {
        known: n =>
          n.startsWith('--r-') ||
          ['--bg', '--surface', '--text', '--accent', '--ctl-h', '--font-body'].includes(n),
      },
    ) !== null,
    true,
    'unknown tokens are skipped',
  );
  assert.deepStrictEqual(
    cleanBundle({
      ...CANDY,
      art: { mark: '<svg><script/></svg>', icons: { standard: '<script/>' } },
    }).art.mark,
    null,
    'unusable art falls back, the bundle stays',
  );
  const withFont = cleanBundle({
    ...CANDY,
    tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", "Trebuchet MS", sans-serif' },
    fonts: [{ family: 'Fredoka', weight: '400 700', data: woff2 }],
  });
  assert.deepStrictEqual(
    withFont.fonts.map(f => f.family),
    ['Fredoka'],
    'a shipped font is usable in a font token',
  );
  assert.deepStrictEqual(
    cleanBundle({
      ...CANDY,
      tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", sans-serif' },
    }),
    null,
    'a family that is not shipped is not',
  );
  bad('a font that is not woff2', {
    ...CANDY,
    fonts: [
      { family: 'Fredoka', weight: '400', data: Buffer.from('not a font').toString('base64') },
    ],
  });
  bad('too many fonts', {
    ...CANDY,
    fonts: Array.from({ length: 4 }, () => ({ family: 'Fredoka', weight: '400', data: woff2 })),
  });
});

test('themes: art is rebuilt from the whitelist and the bounds, unusable parts fall back', () => {
  const art = cleanArt({
    mark: '<svg viewBox="0 0 96 96"><rect width="96" height="96" fill="#fff"/></svg>',
    icons: { standard: '<path d="M0 0"/>', cutout: '<script/>', nonsense: '<path d="M0 0"/>' },
    board: { grid: 'tiles', pathW: 0.3, wallW: 9, cap: 'evil', gradient: true },
  });
  assert.deepStrictEqual(
    Object.keys(art.icons),
    ['standard'],
    'a bad icon and an unknown id are dropped',
  );
  assert.deepStrictEqual(
    [art.board.grid, art.board.pathW, art.board.wallW, art.board.cap, art.board.gradient],
    ['tiles', 0.3, CLASSIC_BOARD.wallW, 'round', true],
  );
  assert.deepStrictEqual(cleanArt(null), null);
  assert.deepStrictEqual(
    cleanLayout({ menu: 'bento', picker: 'carousel' }),
    { menu: 'bento', picker: 'tiles', actions: 'side' },
    'an unknown preset becomes the default',
  );
});

test('themes: an entry is cleaned; built-ins are never taken from storage', () => {
  const base = entryOf(CANDY);
  for (const bad of [
    null,
    {},
    { ...base, id: 'A b' },
    { ...base, id: 'a"><x' },
    { ...base, mode: 'blue' },
    { ...base, chrome: 'red' },
  ])
    assert.deepStrictEqual(cleanEntry(bad), null);
  const e = cleanEntry({
    ...base,
    symbol: '<script/>',
    name: { en: '<b>x</b>' },
    v: -4,
    layout: { menu: 'zzz' },
    swatches: ['x'],
  });
  assert.deepStrictEqual(
    [e.symbol, e.name.en, e.v, e.layout.menu, e.swatches],
    ['', 'candy', 1, 'dashboard', null],
  );
  assert.deepStrictEqual(
    cleanEntry({ ...BUILTIN[1], chrome: '#000000', symbol: '<circle cx="1" cy="1" r="1"/>' }),
    BUILTIN[1],
    "built-in metadata is the app's",
  );
});

test('themes: the pool starts as light and dark, migrates the old key, survives damage, and loses a theme cleanly', () => {
  const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
  assert.deepStrictEqual(
    parseState(null).pool.map(e => e.id),
    ['light', 'dark'],
  );
  assert.deepStrictEqual(
    [
      parseState(null, 'dark').active,
      parseState(null, 'light').active,
      parseState(null, 'x').active,
      parseState(null).active,
    ],
    ['dark', 'light', null, null],
  );
  assert.deepStrictEqual(
    parseState('{{{', 'dark').active,
    'dark',
    'damaged storage: start again, keep the old choice',
  );
  assert.deepStrictEqual(
    parseState(JSON.stringify({ v: 1, pool: [candy] })).pool.map(e => e.id),
    ['light', 'dark'],
    'another version is ignored',
  );
  const st = withPool([BUILTIN[0], candy, candy, { id: 'BAD' }, BUILTIN[1]], 'candy', 3);
  assert.deepStrictEqual(
    parseState(serialize(st)).pool.map(e => e.id),
    ['light', 'candy', 'dark'],
    'invalid and duplicate entries are dropped',
  );
  assert.deepStrictEqual(
    [
      parseState(JSON.stringify({ ...st, cap: 99 })).cap,
      parseState(JSON.stringify({ ...st, cap: 0 })).cap,
    ],
    [4, 2],
    'cap stays in 2..4',
  );
  assert.deepStrictEqual(
    parseState(JSON.stringify({ ...st, cap: 2 })).pool.map(e => e.id),
    ['light', 'candy'],
    'the pool is cut to the cap',
  );
  assert.deepStrictEqual(
    parseState(JSON.stringify({ ...st, active: 'gone' })).active,
    null,
    'an active theme that is not in the pool is forgotten',
  );
  const pool = withPool([candy, wood], null, 2);
  assert.deepStrictEqual(
    [activeEntry(pool, 'light').id, activeEntry(pool, 'dark').id],
    ['candy', 'wood'],
  );
  assert.deepStrictEqual(
    activeEntry(withPool([candy]), 'dark').id,
    'candy',
    'no theme of the system mode: the first',
  );
  assert.deepStrictEqual(
    activeEntry({ ...pool, active: 'wood' }, 'light').id,
    'wood',
    'a chosen theme wins',
  );
  const lost = remove(withPool([BUILTIN[0], candy], 'candy', 2), 'candy');
  assert.deepStrictEqual(
    [lost.pool.map(e => e.id), lost.active],
    [['light', 'dark'], 'light'],
    'a lost theme: the built-ins refill, the built-in of its mode takes over',
  );
  assert.deepStrictEqual(
    remove(withPool([candy, wood], 'wood', 2), 'wood').pool.map(e => e.id),
    ['candy', 'light'],
    'the pool is never left with fewer than two',
  );
  assert.deepStrictEqual(remove(fresh(null), 'nope'), fresh(null), 'nothing to remove');
});

test('themes: select, cap, save and replace', () => {
  const candy = entryOf(CANDY);
  let st = fresh(null);
  assert.deepStrictEqual(select(st, 'dark').active, 'dark');
  assert.deepStrictEqual(select(st, 'candy'), st, 'only a theme of the pool can be selected');
  assert.deepStrictEqual(save(st, candy), null, 'a full pool needs a theme to replace');
  assert.deepStrictEqual(save(st, candy, 'nope'), null);
  assert.deepStrictEqual(save(st, { id: 'x y' }, 'dark'), null, 'not a theme');
  const replaced = save(select(st, 'dark'), candy, 'dark');
  assert.deepStrictEqual(
    [replaced.pool.map(e => e.id), replaced.active],
    [['light', 'candy'], 'candy'],
    'replacing the active theme hands over to the new one',
  );
  assert.deepStrictEqual(
    save(select(st, 'light'), candy, 'dark').active,
    'light',
    'replacing another theme keeps the active one',
  );
  assert.deepStrictEqual(
    save(replaced, candy),
    replaced,
    'saving a theme the pool has changes nothing',
  );
  st = setCap(st, 3);
  const three = save(st, candy);
  assert.deepStrictEqual(
    three.pool.map(e => e.id),
    ['light', 'dark', 'candy'],
    'room: it is added',
  );
  assert.deepStrictEqual(setCap(st, 9).cap, 4);
  assert.deepStrictEqual(
    setCap(three, 2).pool.map(e => e.id),
    ['light', 'dark'],
    'lowering the cap keeps the earliest themes',
  );
  assert.deepStrictEqual(
    setCap({ ...three, active: 'candy' }, 2).pool.map(e => e.id),
    ['light', 'candy'],
    'and the active one',
  );
  assert.deepStrictEqual(
    [
      nextEntry(fresh(null), 'light').id,
      nextEntry(fresh(null), 'dark').id,
      nextEntry(three, 'candy').id,
    ],
    ['dark', 'light', 'light'],
  );
  assert.deepStrictEqual(
    [isClassicPool(fresh(null)), isClassicPool(three), isClassicPool(replaced)],
    [true, false, false],
  );
});

test('themes: the device store keeps what the player owns, and refuses what is damaged or tampered with', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const b = cleanBundle(CANDY);
  assert.ok(store.save(b) && store.has('candy'), 'saved');
  assert.deepStrictEqual(store.load('candy').css, b.css);
  assert.deepStrictEqual(store.load('candy').art.board.grid, 'tiles');
  assert.deepStrictEqual(store.load('wood'), null);
  for (const css of [
    'body{display:none}',
    ':root[data-theme="wood"]{--bg:#000;}',
    ':root[data-theme="candy"]{--bg:url(x);}',
    ':root[data-theme="candy"]{}</style><script>',
    ':root[data-theme="candy"]{--a:1;} body{x:1}',
  ]) {
    storage.data[BUNDLE_KEY('candy')] = JSON.stringify({ v: 3, css });
    assert.deepStrictEqual(store.load('candy'), null, css);
  }
  storage.data[BUNDLE_KEY('candy')] = '{{{';
  assert.deepStrictEqual(store.has('candy'), false, 'damaged');
  store.save(b);
  store.remove('candy');
  assert.deepStrictEqual(store.has('candy'), false, 'removed');
  assert.deepStrictEqual(
    createStore(memoryStorage({}, { quota: true })).save(b),
    false,
    'a device that refuses: not kept',
  );
});

test('themes: the manifest lists themes by metadata and hashed file names; what is not a theme is dropped; light and dark need no file', () => {
  const good = manifestOf([CANDY, WOOD], ['wood']);
  const forged = {
    ...good[0],
    id: 'dark',
    mode: 'light',
    chrome: '#ffffff',
    name: { en: 'Forged' },
    f: 'x',
  };
  const list = cleanPool([
    ...good,
    { ...good[0] },
    { ...good[0], id: 'light', f: undefined },
    forged,
    { ...good[0], id: 'sea', f: '../etc/passwd' },
    { id: 'x' },
    null,
    'text',
  ]);
  assert.deepStrictEqual(
    list.map(c => [c.entry.id, c.f, c.live]),
    [
      ['candy', stem('candy'), true],
      ['wood', stem('wood'), false],
      ['light', null, true],
      ['dark', null, true],
    ],
    'a repeat, a bad file name and a non-theme are dropped; a built-in has no file',
  );
  assert.deepStrictEqual(
    [list[2].entry, list[3].entry],
    BUILTIN,
    "a built-in is the app's own copy, whatever the manifest says",
  );
  assert.deepStrictEqual([cleanPool({}), cleanPool(null), cleanPool([]).length], [null, null, 0]);
  assert.deepStrictEqual(
    cleanPool(
      Array.from({ length: 80 }, (_, i) => ({ ...good[0], id: `t${i}`, f: stem(`t${i}`) })),
    ).length,
    MAX_THEMES,
    'bounded',
  );
  assert.ok(
    FILE_RE.test(stem('a')) &&
      !FILE_RE.test('A'.repeat(24)) &&
      !FILE_RE.test(`${stem('a')}0`) &&
      !FILE_RE.test('../'.repeat(8)) &&
      !FILE_RE.test('-'.repeat(24)),
    'the shape of a file name',
  );
});

test('themes: the files are fetched by name from one folder: a malformed name makes no request, a missing or broken file is nothing', async () => {
  const f = stem('candy');
  const fetched = [];
  const files = {
    '../t/m.json': JSON.stringify(manifestOf([CANDY])),
    [`../t/${f}.json`]: JSON.stringify(CANDY),
    [`../t/${stem('x')}.json`]: 'not json',
    [`../t/${stem('y')}.json`]: 'x'.repeat(MAX_FILE + 1),
  };
  const source = createSource({
    base: '../t/',
    pool: 'm.json',
    fetchText: async (url, kind) => {
      fetched.push([url, kind]);
      if (!(url in files)) throw new Error('404');
      return files[url];
    },
  });
  assert.deepStrictEqual(
    (await source.pool()).map(c => c.entry.id),
    ['candy'],
    'the manifest',
  );
  assert.deepStrictEqual((await source.bundle(f)).id, 'candy', 'a name fetches its bundle');
  assert.deepStrictEqual(
    fetched,
    [
      ['../t/m.json', 'pool'],
      [`../t/${f}.json`, 'bundle'],
    ],
    'one request each, to exactly that file',
  );
  for (const bad of [undefined, '', 'short', '../x', `${f}.json`, f.toUpperCase(), `${f}0`])
    assert.deepStrictEqual(await source.bundle(bad), null, String(bad));
  assert.deepStrictEqual(fetched.length, 2, 'a malformed name makes no request');
  assert.deepStrictEqual(
    [
      await source.bundle(stem('x')),
      await source.bundle(stem('y')),
      await source.bundle(stem('z')),
    ],
    [null, null, null],
    'not JSON, too big, not there',
  );
  assert.deepStrictEqual(
    await createSource({
      base: '../t/',
      pool: 'm.json',
      fetchText: async () => 'x'.repeat(MAX_POOL + 1),
    }).pool(),
    null,
    'a manifest too big',
  );
  assert.deepStrictEqual(
    await createSource({
      base: '../t/',
      pool: 'm.json',
      fetchText: async () => '{"a":1}',
    }).pool(),
    null,
    'not a manifest',
  );

  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init.cache, init.credentials]);
    return url.includes('gone')
      ? { ok: false, status: 404 }
      : {
          ok: true,
          headers: { get: () => '100' },
          text: async () => JSON.stringify(url.endsWith('m.json') ? manifestOf([CANDY]) : CANDY),
        };
  };
  const page = browserSource({ base: '../t/', pool: 'm.json' }, fetchFn);
  assert.deepStrictEqual([(await page.pool()).length, (await page.bundle(f)).id], [1, 'candy']);
  assert.deepStrictEqual(
    calls,
    [
      ['../t/m.json', 'no-cache', 'omit'],
      [`../t/${f}.json`, 'default', 'omit'],
    ],
    'the manifest is revalidated, a bundle (which never changes under its name) may be cached; no cookies',
  );
  assert.deepStrictEqual(
    await browserSource({ base: '../gone/', pool: 'm.json' }, fetchFn).pool(),
    null,
    'a 404',
  );
  const huge = kind => ({
    ok: true,
    headers: { get: () => String((kind === 'pool' ? MAX_POOL : MAX_FILE) + 1) },
    text: async () => '[]',
  });
  assert.deepStrictEqual(
    await browserSource({ base: '../t/', pool: 'm.json' }, async () => huge('bundle')).bundle(f),
    null,
    'a bundle too big by its header',
  );
  assert.deepStrictEqual(
    await browserSource({ base: '../t/', pool: 'm.json' }, async () => huge('pool')).pool(),
    null,
    'a manifest too big by its header',
  );
});

test("themes: the page's head script picks what pool.js picks, and paints a theme the player owns from the local copy", () => {
  const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
  const own = {
    [BUNDLE_KEY('candy')]: ownedRecord(CANDY),
    [BUNDLE_KEY('wood')]: ownedRecord(WOOD),
  };
  const states = {
    none: [{}, false],
    'none, system dark': [{}, true],
    'old key dark': [{ [MODE_KEY]: 'dark' }, false],
    'old key junk': [{ [MODE_KEY]: 'blue' }, true],
    'chosen candy': [
      { [POOL_KEY]: serialize(withPool([BUILTIN[0], BUILTIN[1], candy], 'candy', 3)), ...own },
      false,
    ],
    'follow system (dark)': [
      { [POOL_KEY]: serialize(withPool([BUILTIN[0], wood, candy], null, 3)), ...own },
      true,
    ],
    'follow system (light)': [
      { [POOL_KEY]: serialize(withPool([wood, candy, BUILTIN[1]], null, 3)), ...own },
      false,
    ],
    'no theme of the system mode': [
      { [POOL_KEY]: serialize(withPool([candy, BUILTIN[0]], null, 2)), ...own },
      true,
    ],
    'built-ins replaced': [
      { [POOL_KEY]: serialize(withPool([candy, wood], null, 2)), ...own },
      true,
    ],
    'a tampered id': [
      {
        [POOL_KEY]: JSON.stringify({
          v: 2,
          cap: 3,
          active: 'x"><b',
          pool: [{ ...candy, id: 'x"><b' }, BUILTIN[0], BUILTIN[1]],
        }),
      },
      true,
    ],
    duplicates: [
      {
        [POOL_KEY]: JSON.stringify({
          v: 2,
          cap: 2,
          active: null,
          pool: [BUILTIN[0], BUILTIN[0], BUILTIN[1]],
        }),
      },
      true,
    ],
    'cut to the cap': [
      {
        [POOL_KEY]: JSON.stringify({
          v: 2,
          cap: 2,
          active: 'wood',
          pool: [BUILTIN[0], BUILTIN[1], wood],
        }),
        ...own,
      },
      false,
    ],
    damaged: [{ [POOL_KEY]: 'not json', [MODE_KEY]: 'dark' }, false],
    'another version': [{ [POOL_KEY]: JSON.stringify({ v: 1, pool: [candy] }) }, true],
  };
  for (const [name, [storage, dark]] of Object.entries(states)) {
    const want = activeEntry(
      parseState(storage[POOL_KEY], storage[MODE_KEY]),
      dark ? 'dark' : 'light',
    );
    const got = runBoot({ storage, dark });
    assert.deepStrictEqual([got.dataset.theme, got.dataset.mode], [want.id, want.mode], name);
    assert.deepStrictEqual(got.meta.color, want.chrome, `${name}: the browser bar`);
    assert.deepStrictEqual(
      got.appended.length,
      want.builtin ? 0 : 1,
      `${name}: a token block only for a theme the player owns`,
    );
    if (!want.builtin)
      assert.deepStrictEqual(
        [got.appended[0].id, got.appended[0].textContent],
        ['theme-css', cleanBundle(want.id === 'candy' ? CANDY : WOOD).css],
        `${name}: painted from the local copy`,
      );
  }
  const chosen = states['chosen candy'][0];
  const lost = { ...chosen };
  delete lost[BUNDLE_KEY('candy')];
  assert.deepStrictEqual(
    [runBoot({ storage: lost }).dataset.theme, runBoot({ storage: lost }).appended.length],
    ['light', 0],
    'a theme whose copy is gone shows as the built-in of its mode',
  );
  assert.deepStrictEqual(
    runBoot({
      storage: {
        ...chosen,
        [BUNDLE_KEY('candy')]: JSON.stringify({
          css: ':root[data-theme="candy"]{--a:url(x);}',
        }),
      },
    }).dataset.theme,
    'light',
    'a tampered copy too',
  );
  assert.deepStrictEqual(
    runBoot({
      storage: {
        ...chosen,
        [BUNDLE_KEY('candy')]: JSON.stringify({
          css: ':root[data-theme="candy"]{}</style><script>x</script>',
        }),
      },
    }).appended.length,
    0,
  );
  assert.deepStrictEqual(runBoot({ storage: chosen }).dataset.menu, 'dashboard');
});

test('themes: index.html pins its head script in the CSP; the page loads nothing from the network for a theme', () => {
  const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(
    INDEX.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`),
    "the CSP hash is the script's",
  );
  assert.ok(
    !/document\.write|fetch\(|XMLHttpRequest|\.\.\/themes/.test(script),
    'no request: the script only reads the device',
  );
  assert.ok(!INDEX.includes('Zip'), 'the brand is zigzag');
});

test('themes: applyEntry sets the attributes, the token block, the bar colour and the brand mark, and tells the page', () => {
  const attrs = {};
  const els = {};
  const holder = {
    classList: {
      toggle: (_c, on) => {
        attrs.hasArt = on;
      },
    },
    querySelector: () => null,
    append: n => {
      attrs.mark = n.innerHTML;
    },
  };
  const events = [];
  const doc = {
    documentElement: { dataset: attrs },
    head: {
      append: el => {
        els['theme-css'] = el;
        el.remove = () => {
          delete els['theme-css'];
        };
      },
    },
    querySelector: () => ({
      setAttribute: (_k, v) => {
        attrs.chrome = v;
      },
    }),
    getElementById: id => (id === 'brandMark' ? holder : (els[id] ?? null)),
    createElement: () => ({ setAttribute() {} }),
    dispatchEvent: e => events.push(e),
  };
  const candy = cleanBundle(CANDY);
  applyEntry(
    { ...candy.entry, layout: { menu: 'bento', picker: 'tiles', actions: 'bar' } },
    { css: candy.css, art: { mark: '<svg/>' } },
    doc,
  );
  assert.deepStrictEqual(
    [
      attrs.theme,
      attrs.mode,
      attrs.menu,
      attrs.picker,
      attrs.actions,
      attrs.chrome,
      attrs.hasArt,
      attrs.mark,
    ],
    ['candy', 'light', 'bento', 'tiles', 'bar', '#efe7ff', true, '<svg/>'],
  );
  assert.deepStrictEqual(els['theme-css'].textContent, candy.css);
  assert.deepStrictEqual(
    [events[0].type, events[0].detail.id, events[0].detail.mode],
    ['zip-theme', 'candy', 'light'],
  );
  applyEntry(BUILTIN[1], null, doc);
  assert.deepStrictEqual(
    [attrs.theme, attrs.mode, attrs.hasArt, 'theme-css' in els],
    ['dark', 'dark', false, false],
    'a built-in takes the token block away',
  );
});

test('themes: fonts are registered from binary data and released with the theme', () => {
  const added = [];
  const set = { add: f => added.push(f), delete: f => added.splice(added.indexOf(f), 1) };
  class FakeFace {
    constructor(family, data, opts) {
      Object.assign(this, { family, size: data.length, opts });
    }
    load() {
      return Promise.resolve();
    }
  }
  const handle = loadFonts([{ family: 'Fredoka', weight: '400 700', data: woff2 }], {
    FontFace: FakeFace,
    set,
  });
  assert.deepStrictEqual(
    [added.length, added[0].family, added[0].size, added[0].opts.display],
    [1, 'Fredoka', 8, 'swap'],
  );
  handle.release();
  assert.deepStrictEqual(added.length, 0);
  assert.deepStrictEqual(
    typeof loadFonts([{ family: 'F', weight: '400', data: woff2 }], {}).release,
    'function',
    'no FontFace API: nothing to do',
  );
});

test('themes: variant icons come from the theme on screen, with the classic icon for what it does not draw', () => {
  const classic = variantIcon('cutout');
  assert.ok(
    classic.includes('class="variant-icon vi-cutout"') && classic.includes('vi-bg'),
    'no theme: the classic icon',
  );
  setArt(
    cleanArt({
      icons: { standard: '<path d="M1 1"/>', cutout: '<path d="M2 2"/>' },
      board: {},
    }),
  );
  try {
    assert.deepStrictEqual(
      variantIcon('cutout'),
      '<svg class="variant-icon vi-cutout" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M2 2"/></svg>',
    );
    assert.deepStrictEqual(
      variantIcon('anything-else').includes('<path d="M1 1"/>'),
      true,
      'an unknown variant is the standard one',
    );
    assert.deepStrictEqual(
      variantIcon('lucky').includes('vi-q'),
      true,
      'lucky is not drawn by this theme: the classic icon',
    );
    assert.deepStrictEqual(variantIcon('cube').includes('vi-cube'), true, 'so are the solids');
  } finally {
    setArt(null);
  }
  assert.deepStrictEqual(variantIcon('cutout'), classic, 'back to the classic icon');
  // an icon with a gradient: every drawing of it has ids of its own (it may be on the page twice, once of them hidden)
  setArt(
    cleanArt({
      icons: {
        standard:
          '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="8" height="8" fill="url(#g1)"/>',
      },
      board: {},
    }),
  );
  try {
    const [one, two] = [variantIcon('standard'), variantIcon('standard')];
    const idOf = svg => /id="(g1-[^"]+)"/.exec(svg)?.[1];
    assert.ok(idOf(one) && idOf(two) && idOf(one) !== idOf(two), 'two drawings, two ids');
    assert.ok(
      one.includes(`fill="url(#${idOf(one)})"`) && two.includes(`fill="url(#${idOf(two)})"`),
      'each refers to its own',
    );
  } finally {
    setArt(null);
  }
});

test("themes: the board is drawn in the theme's skin; the classic skin is what the game always drew; the svg's box never changes", () => {
  const puzzle = makePuzzle(3);
  puzzle.cp[0] = 1;
  puzzle.cp[8] = 2;
  const S = { puzzle, path: [0, 1], hintCell: null, hintWrongCell: null };
  const classic = boardSvg(S);
  assert.ok(
    classic.includes('stroke-width="1.5"') &&
      classic.includes('stroke-width="6" stroke-linecap="round"') &&
      classic.includes('stroke-width="16.8"') &&
      classic.includes('r="19.2"') &&
      classic.includes('stroke-width="3"'),
    'the classic numbers',
  );
  assert.ok(
    !classic.includes('skin-tiles') &&
      !classic.includes('url(#zip-path)') &&
      !classic.includes('num-shape'),
  );
  const skin = {
    grid: 'tiles',
    tileRx: 0.2,
    tileInset: 0.05,
    tileEdgeW: 0.02,
    depth: 0.03,
    plateRx: 0.15,
    pathW: 0.2,
    cap: 'square',
    join: 'miter',
    gradient: true,
    wallW: 0.12,
    wallCap: 'butt',
    num: 'square',
    numR: 0.25,
    numRingW: 0,
    solid: 'light',
  };
  setArt(cleanArt({ board: skin }));
  try {
    const themed = boardSvg(S);
    assert.deepStrictEqual(
      themed.match(/viewBox="[^"]*"/)[0],
      classic.match(/viewBox="[^"]*"/)[0],
      'same viewBox: the pointer maps through the same box',
    );
    assert.ok(
      themed.includes('class="zip-svg skin-tiles"') && themed.includes('<g data-skin="tiles">'),
      'tiles skin',
    );
    assert.deepStrictEqual(
      [
        (themed.match(/fill="var\(--b-bg\)"/g) || []).length,
        (themed.match(/fill="var\(--b-depth\)"/g) || []).length,
      ],
      [9, 9],
      'nine tiles, nine lower edges',
    );
    assert.ok(
      themed.includes(`<rect width="180" height="180" rx="9" fill="${COLORS.stage}"/>`),
      'the plate',
    );
    assert.ok(
      themed.includes('stroke="url(#zip-path)"') &&
        themed.includes('<linearGradient id="zip-path" gradientUnits="userSpaceOnUse"'),
      "the path gradient is in the board's own defs",
    );
    assert.ok(
      themed.includes(
        'stroke-width="12" fill="none" stroke-linecap="square" stroke-linejoin="miter"',
      ),
      'path width, cap, join',
    );
    assert.ok(themed.includes('stroke-width="7.2" stroke-linecap="butt"'), 'wall width and cap');
    assert.ok(
      themed.includes('<rect class="num-shape"') &&
        themed.includes('width="30"') &&
        themed.includes('stroke-width="0"'),
      'square numbers, no ring',
    );
    assert.deepStrictEqual(
      solidIsDark({ documentElement: { dataset: { mode: 'dark' } } }),
      false,
      'the theme names the light 3D palette on a dark page',
    );
  } finally {
    setArt(null);
  }
  assert.deepStrictEqual(boardSvg(S), classic, 'back to the classic board, byte for byte');
  assert.deepStrictEqual(
    solidIsDark({ documentElement: { dataset: { mode: 'dark' } } }),
    true,
    "no theme: the page's mode",
  );
  assert.deepStrictEqual(currentArt(), null);
  assert.deepStrictEqual(
    cleanArt({ board: { solid: 'purple' } }).board.solid,
    undefined,
    'only light or dark',
  );
});

test('themes: portals are drawn in tokens (the Design app keeps its hex), the defaults being the same colours', () => {
  assert.deepStrictEqual(portalColorVar(0), 'var(--portal-1)');
  assert.deepStrictEqual(portalColorVar(6), 'var(--portal-1)', 'wraps round');
  const css = readFileSync(new URL('../../css/theme.css', import.meta.url), 'utf8');
  PORTAL_COLORS.forEach((hex, i) =>
    assert.ok(css.includes(`--portal-${i + 1}: ${hex};`), `--portal-${i + 1} defaults to ${hex}`),
  );
});

test('themes: layouts.css has a block for every preset except the defaults (which are play.css), and only tokens', () => {
  const css = readFileSync(new URL('../../css/layouts.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../../css/theme.css', import.meta.url), 'utf8');
  for (const [axis, keys] of Object.entries(PRESETS)) {
    for (const key of keys) {
      const has = css.includes(`:root[data-${axis}="${key}"]`);
      assert.deepStrictEqual(
        has,
        key !== DEFAULT_LAYOUT[axis],
        `${axis}=${key}: ${key === DEFAULT_LAYOUT[axis] ? 'the default has no rule (it is play.css)' : 'a preset needs a block'}`,
      );
    }
  }
  for (const attr of css.matchAll(/data-(\w+)="([\w-]+)"/g))
    assert.ok(PRESETS[attr[1]]?.includes(attr[2]), `unknown preset ${attr[0]}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'colour literals: use tokens');
  const local = new Set(['--tile', '--tile-on', '--tile-counter', '--rb-2', '--rb-3']); // --rb-* are derived in play.css (the radii of boxes with text)
  assert.ok(!/(--ic-[12]):[^;]*var\(\1/.test(css), 'a custom property must not refer to itself');
  for (const m of css.matchAll(/var\((--[\w-]+)/g))
    assert.ok(
      local.has(m[1]) || theme.includes(`${m[1]}:`),
      `${m[1]} is not defined in theme.css`,
    );
  assert.ok(
    INDEX.includes('<link rel="stylesheet" href="css/layouts.css">') &&
      INDEX.indexOf('css/play.css') < INDEX.indexOf('css/layouts.css'),
    'index.html loads it after play.css',
  );
});

test('themes: the pool picker lists the pool in order, marks the current theme, and escapes what it shows', () => {
  const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
  const st = withPool([BUILTIN[0], candy, wood], null, 3);
  const items = pickerItems(st, 'candy', 'zh');
  assert.deepStrictEqual(
    items.map(i => [i.id, i.name, i.current]),
    [
      ['light', '浅色', false],
      ['candy', '主题', true],
      ['wood', '主题', false],
    ],
  );
  assert.deepStrictEqual(
    pickerItems(st, 'wood', 'xx').map(i => i.name),
    ['Light', 'CANDY', 'WOOD'],
    'an unknown language: English',
  );
  const html = pickerHtml(items, 'Choose a theme');
  assert.ok(
    html.includes('data-theme-id="candy"') &&
      html.includes('aria-checked="true"') &&
      html.includes('role="menuitemradio"') &&
      html.includes('class="current"'),
  );
  assert.deepStrictEqual((html.match(/<button /g) || []).length, 3);
  const hostile = pickerHtml(
    [
      {
        id: 'x"><script>',
        name: '<img src=x onerror=alert(1)>',
        symbol: SYMBOL,
        swatches: ['#fff"><i'],
        current: false,
      },
    ],
    '<b>t</b>',
  );
  assert.ok(
    !hostile.includes('<img') && !hostile.includes('<script>') && !hostile.includes('<b>'),
    'no tag of theirs',
  );
  assert.ok(
    [
      '&lt;img src=x onerror=alert(1)&gt;',
      'x&quot;&gt;&lt;script&gt;',
      '&lt;b&gt;t&lt;/b&gt;',
      '#fff&quot;&gt;&lt;i',
    ].every(piece => hostile.includes(piece)),
    'shown as text',
  );
});

test('themes: the controller shows, steps, persists, follows the system, and shows what the player owns without any network', async () => {
  let r = rig();
  r.ctl.start();
  assert.deepStrictEqual(
    [r.applied, r.ctl.isClassic(), r.ctl.current().id],
    [['light'], true, 'light'],
  );
  r.ctl.next();
  assert.deepStrictEqual(
    [
      r.applied,
      r.ctl.current().id,
      r.storage.data[MODE_KEY],
      JSON.parse(r.storage.data[POOL_KEY]).active,
    ],
    [['light', 'dark'], 'dark', 'dark', 'dark'],
    'a step is a choice: kept, mirrored for the stats page',
  );

  r = rig({ dark: false });
  r.ctl.start();
  r.media.matches = true;
  r.listeners.forEach(fn => fn());
  assert.deepStrictEqual(
    [r.ctl.current().id, MODE_KEY in r.storage.data],
    ['dark', false],
    'until the player chooses, the system setting leads (and nothing is saved)',
  );
  r.ctl.select('light');
  r.listeners.forEach(fn => fn());
  assert.deepStrictEqual(
    r.ctl.current().id,
    'light',
    'after a choice the system no longer matters',
  );

  r = rig({
    stored: withPool([BUILTIN[0], BUILTIN[1], entryOf(CANDY)], 'candy', 3),
    owned: [CANDY],
  });
  r.ctl.start();
  assert.deepStrictEqual(
    [r.applied, r.ctl.isClassic(), r.ctl.art().mark.startsWith('<svg'), r.ctl.upcoming().id],
    [['candy+css'], false, true, 'light'],
    'from the device copy',
  );

  r = rig({ stored: withPool([BUILTIN[0], BUILTIN[1], entryOf(WOOD)], 'wood', 3) }); // no copy on this device
  r.ctl.start();
  assert.deepStrictEqual(
    [r.applied, r.ctl.current().id, r.ctl.state().pool.map(e => e.id), r.ctl.state().active],
    [['dark'], 'dark', ['light', 'dark'], 'dark'],
    'a theme whose copy is gone leaves the pool; the built-in of its mode shows',
  );
  assert.deepStrictEqual(
    JSON.parse(r.storage.data[POOL_KEY]).pool.length,
    2,
    'and that is stored',
  );
});

test('themes: a theme on trial is taken (kept on the device and in the pool) or left (gone, nothing kept)', async () => {
  const r = rig();
  r.ctl.start();
  assert.deepStrictEqual(
    r.ctl.trial({ ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } }),
    null,
    'an invalid bundle is not shown',
  );
  assert.deepStrictEqual(
    r.ctl.trial(CANDY, { until: 500 }),
    null,
    'an event that is over is not shown',
  );
  const trial = r.ctl.trial(CANDY, { until: 5000 });
  assert.deepStrictEqual(
    [
      r.ctl.current().id,
      r.applied.at(-1),
      r.ctl.state().pool.length,
      r.timeouts.length,
      r.timeouts[0].ms,
    ],
    ['candy', 'candy+css', 2, 1, 4000],
    'shown, with a timer for the end of the event',
  );
  assert.deepStrictEqual(
    [r.storage.data[BUNDLE_KEY('candy')], POOL_KEY in r.storage.data],
    [undefined, false],
    'nothing is kept while it is on trial',
  );
  trial.revert();
  assert.deepStrictEqual(
    [r.ctl.current().id, r.cleared.length, BUNDLE_KEY('candy') in r.storage.data],
    ['light', 1, false],
    'left: the previous theme is back, the timer is off, nothing was ever kept',
  );

  const again = r.ctl.trial(CANDY);
  assert.deepStrictEqual(await again.commit(), false, 'a full pool needs a theme to replace');
  assert.deepStrictEqual(
    [BUNDLE_KEY('candy') in r.storage.data, r.ctl.state().pool.length],
    [false, 2],
    'and nothing was kept',
  );
  assert.deepStrictEqual(await again.commit('dark'), true);
  assert.deepStrictEqual(
    [
      r.ctl.state().pool.map(e => e.id),
      r.ctl.state().active,
      r.ctl.current().id,
      BUNDLE_KEY('candy') in r.storage.data,
    ],
    [['light', 'candy'], 'candy', 'candy', true],
  );
  assert.deepStrictEqual(await again.commit('dark'), false, 'an offer is taken once');

  const second = r.ctl.trial(WOOD);
  await second.commit('candy');
  assert.deepStrictEqual(
    [
      r.ctl.state().pool.map(e => e.id),
      BUNDLE_KEY('candy') in r.storage.data,
      BUNDLE_KEY('wood') in r.storage.data,
    ],
    [['light', 'wood'], false, true],
    'a replaced theme is gone from the device',
  );

  r.ctl.setCap(4);
  assert.ok(
    r.ctl.install(bundle('sea')) && r.ctl.install(bundle('sky')),
    'awards raise the cap, a theme is installed without replacing',
  );
  assert.deepStrictEqual(r.ctl.state().pool.length, 4);
  r.ctl.setCap(2);
  assert.deepStrictEqual(
    [
      r.ctl.state().pool.length,
      Object.keys(r.storage.data).filter(k => k.startsWith('zip_theme_b_')).length,
    ],
    [2, r.ctl.state().pool.filter(e => !e.builtin).length],
    'lowering the cap removes the cut themes from the device too',
  );

  const quota = rig({ quota: true });
  quota.ctl.start();
  assert.deepStrictEqual(
    await quota.ctl.trial(CANDY).commit('dark'),
    false,
    'a device that refuses the copy: nothing changes',
  );
  assert.deepStrictEqual(
    quota.ctl.state().pool.map(e => e.id),
    ['light', 'dark'],
  );
});

test('themes: a trial ends by itself when its event does, and a choice ends it too', async () => {
  const r = rig();
  r.ctl.start();
  const trial = r.ctl.trial(CANDY, { until: 5000 });
  r.timeouts[0].fn(); // the end of the event
  assert.deepStrictEqual(r.ctl.current().id, 'light', 'gone after the event');
  assert.deepStrictEqual(await trial.commit('dark'), false, 'and it can no longer be taken');
  r.ctl.trial(WOOD);
  r.ctl.select('dark');
  assert.deepStrictEqual(r.ctl.current().id, 'dark', 'choosing a theme of the pool ends a trial');
  r.ctl.trial(WOOD);
  r.listeners.forEach(fn => fn());
  assert.deepStrictEqual(
    r.ctl.current().id,
    'wood',
    'the system setting does not interrupt a trial',
  );
  const fonts = rig();
  fonts.ctl.start();
  fonts.ctl
    .trial({
      ...CANDY,
      tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", sans-serif' },
      fonts: [{ family: 'Fredoka', weight: '400', data: woff2 }],
    })
    .revert();
  assert.deepStrictEqual(
    fonts.fontLoads,
    [1, 'released'],
    'fonts are registered for the trial and released when it ends',
  );
});

test('themes: the offer is picked by device and event: stable, spread out, in a ring', () => {
  const cands = poolOf([CANDY, WOOD, bundle('sea'), bundle('sky')]);
  const seed = newSeed(steady());
  assert.ok(/^[0-9a-f]{16}$/.test(seed), 'a device seed');
  assert.deepStrictEqual(hash('a'), hash('a'));
  assert.ok(hash('a') !== hash('b') && hash('') === 0x811c9dc5, 'FNV-1a');
  const ids = (list, s = seed, e = 'e1') => offerOrder(list, s, e).map(c => c.entry.id);
  assert.deepStrictEqual(
    ids(cands),
    ids([...cands].reverse()),
    'the order of the manifest does not matter',
  );
  assert.deepStrictEqual(
    [...ids(cands)].sort(),
    ['candy', 'sea', 'sky', 'wood'],
    'every theme comes up, once',
  );
  const sorted = ['candy', 'sea', 'sky', 'wood'];
  const first = ids(cands);
  assert.deepStrictEqual(
    [...sorted.slice(sorted.indexOf(first[0])), ...sorted.slice(0, sorted.indexOf(first[0]))],
    first,
    'a ring: the next one is the fall-back',
  );
  assert.ok(
    new Set(Array.from({ length: 12 }, (_, i) => ids(cands, seed, `ev${i}`)[0])).size > 1,
    'events differ',
  );
  assert.ok(
    new Set(Array.from({ length: 12 }, (_, i) => ids(cands, `${i}`.padStart(16, '0'), 'e1')[0]))
      .size > 1,
    'devices differ',
  );
  assert.deepStrictEqual(offerOrder([], seed, 'e1'), []);
});

test('themes: an event offers one theme of the pool: the same within the event on this device, never an owned theme or a draft, answered once', async () => {
  const SEA = bundle('sea');
  const SKY = bundle('sky');
  const all = [CANDY, WOOD, SEA, SKY];
  const site = { files: filesOf(all), pool: poolOf(all, ['sky']) };

  const r = rig(site);
  r.ctl.start();
  const first = await r.ctl.event({ id: 'spring', until: 5000 });
  assert.ok(
    first && ['candy', 'wood', 'sea'].includes(first.entry.id),
    'one of the live themes, never the draft',
  );
  assert.deepStrictEqual(
    [
      r.ctl.current().id,
      r.ctl.state().pool.length,
      SEED_KEY in r.storage.data,
      r.timeouts[0].ms,
      EVENT_KEY in r.storage.data,
    ],
    [first.entry.id, 2, true, 4000, false],
    'on trial until the event ends, nothing kept, not answered yet',
  );
  const reload = rig({ ...site, storage: r.storage });
  reload.ctl.start();
  assert.deepStrictEqual(
    (await reload.ctl.event({ id: 'spring', until: 5000 })).entry.id,
    first.entry.id,
    'a reload within the event shows the same theme',
  );
  first.revert();
  assert.deepStrictEqual(
    [
      r.ctl.current().id,
      r.storage.data[EVENT_KEY],
      await r.ctl.event({ id: 'spring', until: 5000 }),
    ],
    ['light', 'spring', null],
    'left: the event is answered and the theme is gone',
  );
  const summer = await r.ctl.event({ id: 'summer', until: 5000 });
  assert.ok(summer, 'another event, another offer');
  assert.deepStrictEqual(await summer.commit(), false, 'a full pool needs a theme to replace');
  assert.deepStrictEqual(
    r.storage.data[EVENT_KEY],
    'spring',
    'and that does not answer the event',
  );
  assert.deepStrictEqual(await summer.commit('dark'), true);
  assert.deepStrictEqual(
    [
      r.ctl.owns(summer.entry.id),
      r.ctl.current().id,
      r.storage.data[EVENT_KEY],
      await r.ctl.event({ id: 'summer' }),
    ],
    [true, summer.entry.id, 'summer', null],
    'taken: kept, answered',
  );

  const roomy = rig({ ...site, stored: withPool([BUILTIN[0]], null, 4) });
  roomy.ctl.start();
  const got = [];
  for (const id of ['a1', 'a2', 'a3', 'a4']) {
    const offer = await roomy.ctl.event({ id });
    if (offer) await offer.commit();
    got.push(offer ? offer.entry.id : null);
  }
  assert.deepStrictEqual(
    [got.slice(0, 3).sort(), got[3]],
    [['candy', 'sea', 'wood'], null],
    'what the player owns is not offered again; with only a draft left there is no offer',
  );

  const calls = rig(site);
  calls.ctl.start();
  for (const bad of [
    undefined,
    {},
    { id: '' },
    { id: 'a b' },
    { id: 'x'.repeat(41) },
    { id: '../x' },
  ])
    assert.deepStrictEqual(await calls.ctl.event(bad), null, JSON.stringify(bad));
  assert.deepStrictEqual(
    await calls.ctl.event({ id: 'late', until: 500 }),
    null,
    'an event that is over',
  );
  assert.deepStrictEqual(calls.calls, [], 'and none of those asked the network');

  assert.deepStrictEqual(
    await rig({ files: site.files, pool: null }).ctl.event({ id: 'e' }),
    null,
    'the pool is not reachable',
  );
  assert.deepStrictEqual(
    await rig({ files: site.files, pool: [] }).ctl.event({ id: 'e' }),
    null,
    'the pool is empty',
  );
  assert.deepStrictEqual(
    (
      await rig({
        files: { [stem('wood')]: WOOD },
        pool: poolOf([CANDY, WOOD, SEA]),
      }).ctl.event({ id: 'e' })
    ).entry.id,
    'wood',
    'a missing file: the next theme is tried',
  );
  assert.deepStrictEqual(
    await rig({ files: { [stem('candy')]: WOOD }, pool: poolOf([CANDY]) }).ctl.event({
      id: 'e',
    }),
    null,
    'a file that is not the theme the manifest names',
  );
  const bad = { ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } };
  assert.deepStrictEqual(
    await rig({ files: { [stem('candy')]: bad }, pool: poolOf([CANDY]) }).ctl.event({
      id: 'e',
    }),
    null,
    'a bundle the game refuses',
  );
  const many = rig({ files: {}, pool: poolOf([CANDY, WOOD, SEA, SKY]) });
  await many.ctl.event({ id: 'e' });
  assert.deepStrictEqual(
    many.calls.length,
    1 + 3,
    'one read of the pool, and at most three files before there is no offer',
  );
});

test('themes: light and dark are in the pool like any other theme: listed, offered again, tried and kept with no file', async () => {
  const BUILTIN_POOL = BUILTIN.map(b => ({ entry: b, f: null, live: true }));
  const site = {
    files: filesOf([CANDY, WOOD]),
    pool: [...BUILTIN_POOL, ...poolOf([CANDY, WOOD])],
  };
  const away = {
    ...site,
    stored: withPool([entryOf(CANDY), entryOf(WOOD)], null, 2),
    owned: [CANDY, WOOD],
  }; // a player who replaced both

  const r = rig(away);
  r.ctl.start();
  assert.deepStrictEqual(
    (await r.ctl.pool()).map(c => [c.entry.id, c.f, c.owned]),
    [
      ['light', null, false],
      ['dark', null, false],
      ['candy', stem('candy'), true],
      ['wood', stem('wood'), true],
    ],
    'the dev reveal lists them, not owned',
  );
  const offer = await r.ctl.event({ id: 'autumn', until: 5000 });
  assert.ok(
    offer && BUILTIN_IDS.includes(offer.entry.id),
    'the only themes this player does not own are light and dark: one is offered',
  );
  assert.deepStrictEqual(
    [r.calls.filter(c => c !== 'pool'), r.ctl.current().id, r.applied[r.applied.length - 1]],
    [[], offer.entry.id, offer.entry.id],
    "on trial with no file fetched, drawn from the app's own css",
  );
  assert.deepStrictEqual(await offer.commit(), false, 'a full pool needs a theme to replace');
  assert.deepStrictEqual(await offer.commit('wood'), true);
  assert.deepStrictEqual(
    [r.ctl.state().pool.map(e => e.id), r.ctl.state().active, r.storage.data[EVENT_KEY]],
    [['candy', offer.entry.id], offer.entry.id, 'autumn'],
    'taken: in the pool again, answered',
  );
  assert.deepStrictEqual(
    [BUNDLE_KEY(offer.entry.id) in r.storage.data, BUNDLE_KEY('wood') in r.storage.data],
    [false, false],
    "a built-in has no copy on the device, and the replaced theme's copy is gone",
  );
  assert.deepStrictEqual(
    await rig({ ...away, storage: r.storage }).ctl.event({ id: 'autumn', until: 5000 }),
    null,
    'an answered event is not offered again',
  );

  const left = await rig(away).ctl.event({ id: 'winter', until: 5000 });
  left.revert();
  assert.deepStrictEqual(
    [left.entry.id === 'light' || left.entry.id === 'dark', left.entry.builtin],
    [true, true],
    'a built-in offer can be left like any other',
  );

  const d = rig(away);
  d.ctl.start();
  await d.ctl.tryPool('dark');
  assert.deepStrictEqual(
    [d.ctl.current().id, d.ctl.state().pool.length, d.timeouts.length],
    ['dark', 2, 0],
    'the dev reveal tries dark: shown, nothing kept',
  );
  assert.deepStrictEqual(await d.ctl.keepPool('light'), true);
  assert.deepStrictEqual(
    [d.ctl.state().pool.map(e => e.id), d.ctl.current().id],
    [['candy', 'light'], 'light'],
    "kept: it takes the place of one of the player's own, not the one showing",
  );
  assert.deepStrictEqual(
    [await d.ctl.keepPool('light'), d.ctl.owns('light')],
    [false, true],
    'owned already',
  );
});

const HOUR = 3600000;
const site = bundles => ({ files: filesOf(bundles), pool: poolOf(bundles) });

test('themes: an offer waits as a chip, a tap starts the trial, only seen time counts, the time up leaves a last question, keeping takes the theme', async () => {
  const clock = { t: 1000000 };
  const until = clock.t + 10 * HOUR;
  const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
  r.ctl.start();
  const before = r.applied.length;
  assert.deepStrictEqual(await r.ctl.offer({ id: 'e1', until }), true);
  const v = r.ctl.offerView();
  const id = v.entry.id;
  assert.deepStrictEqual(
    [v.phase, v.left, v.until, v.trialMs, r.applied.length, OFFER_KEY in r.storage.data],
    ['pending', 60000, until, 60000, before, true],
    'it waits: the page does not wear it, the record is on the device',
  );
  assert.deepStrictEqual(
    [
      r.ctl.startOffer(),
      r.applied[r.applied.length - 1],
      r.ctl.offerView().phase,
      r.timeouts[r.timeouts.length - 1].ms,
    ],
    [true, `${id}+css`, 'trial', 60000],
    'a tap starts it: on the page, the clock runs',
  );
  clock.t += 20000;
  r.ctl.focus(false);
  assert.deepStrictEqual(r.ctl.offerView().left, 40000, 'the time seen is counted');
  clock.t += 5 * HOUR;
  assert.deepStrictEqual(
    [r.ctl.offerView().left, r.ctl.offerView().phase],
    [40000, 'trial'],
    'hidden: it waits',
  );
  r.ctl.focus(true);
  assert.deepStrictEqual(
    [r.ctl.offerView().left, r.timeouts[r.timeouts.length - 1].ms],
    [40000, 40000],
    'seen again: the rest runs',
  );
  clock.t += 10000;
  r.ctl.holdOffer(true);
  clock.t += HOUR;
  assert.deepStrictEqual(r.ctl.offerView().left, 30000, 'a choice is being made: the clock waits');
  r.ctl.holdOffer(false);
  clock.t += 30000;
  r.timeouts[r.timeouts.length - 1].fn();
  const f = r.ctl.offerView();
  assert.deepStrictEqual(
    [f.phase, f.left, r.applied[r.applied.length - 1], f.until >= clock.t + FINAL_MS],
    ['final', 0, 'light', true],
    'time up: the theme leaves the page, the question stays',
  );
  assert.deepStrictEqual(JSON.parse(r.storage.data[OFFER_KEY]).phase, 'final');
  assert.deepStrictEqual(
    await r.ctl.keepOffer(),
    false,
    'the pool is full: a theme to replace is needed',
  );
  assert.deepStrictEqual(await r.ctl.keepOffer('dark'), true);
  assert.deepStrictEqual(
    [
      r.ctl.state().pool.map(e => e.id),
      r.ctl.state().active,
      BUNDLE_KEY(id) in r.storage.data,
      OFFER_KEY in r.storage.data,
      r.storage.data[EVENT_KEY],
      r.ctl.offerView(),
      r.applied[r.applied.length - 1],
    ],
    [['light', id], id, true, false, 'e1', null, `${id}+css`],
    'kept: in the pool and active, the offer answered and gone',
  );
});

test('themes: the trial never ends in the middle of a puzzle; it waits for a menu screen', async () => {
  const clock = { t: 1000000 };
  let busy = true;
  const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000, idle: () => !busy });
  r.ctl.start();
  await r.ctl.offer({ id: 'e1', until: clock.t + HOUR });
  r.ctl.startOffer();
  clock.t += 60000;
  r.timeouts[r.timeouts.length - 1].fn();
  assert.deepStrictEqual(
    [r.ctl.offerView().phase, r.timeouts[r.timeouts.length - 1].ms],
    ['trial', 1000],
    'still on trial, asking again in a second',
  );
  busy = false;
  r.timeouts[r.timeouts.length - 1].fn();
  assert.deepStrictEqual(r.ctl.offerView().phase, 'final');
});

test('themes: a reload keeps the offer: the trial resumes with its time left, painted by the page before the first frame; the day ending takes a waiting offer', async () => {
  const clock = { t: 1000000 };
  const first = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
  first.ctl.start();
  await first.ctl.offer({ id: 'e1', until: clock.t + HOUR });
  first.ctl.startOffer();
  const id = first.ctl.offerView().entry.id;
  clock.t += 10000;
  first.ctl.focus(false); // the tab goes: saved
  const boot = runBoot({ storage: first.storage.data });
  assert.deepStrictEqual(
    [boot.dataset.theme, boot.appended.length],
    [id, 1],
    'the head script paints the trial theme',
  );
  const second = rig({
    clock,
    ...site([CANDY, WOOD]),
    trialMs: 60000,
    storage: first.storage,
  });
  second.ctl.start();
  assert.deepStrictEqual(
    [
      second.ctl.offerView().phase,
      second.ctl.offerView().left,
      second.applied[second.applied.length - 1],
      second.timeouts[second.timeouts.length - 1].ms,
    ],
    ['trial', 50000, `${id}+css`, 50000],
  );
  assert.deepStrictEqual(
    await second.ctl.offer({ id: 'e1' }),
    true,
    'the same event again finds the offer',
  );
  assert.deepStrictEqual(await second.ctl.offer({ id: 'e2' }), false, 'one offer at a time');
  // a waiting offer: gone when its day ends, and answered
  const w = rig({ clock, ...site([CANDY, WOOD]) });
  w.ctl.start();
  await w.ctl.offer({ id: 'e5', until: clock.t + HOUR });
  assert.deepStrictEqual(
    runBoot({ storage: w.storage.data }).appended.length,
    0,
    'a waiting offer is not on the page',
  );
  clock.t += HOUR + 5;
  w.timeouts[w.timeouts.length - 1].fn();
  assert.deepStrictEqual(
    [
      w.ctl.offerView(),
      w.storage.data[EVENT_KEY],
      OFFER_KEY in w.storage.data,
      await w.ctl.offer({ id: 'e5' }),
    ],
    [null, 'e5', false, false],
  );
  assert.ok(await w.ctl.offer({ id: 'e6', until: clock.t + HOUR }), 'the next event offers again');
  // no end given: the end of the local day
  const d = rig({ clock, ...site([CANDY, WOOD]) });
  await d.ctl.offer({ id: 'e7' });
  assert.deepStrictEqual(d.ctl.offerView().until, endOfDay(clock.t));
});

test('themes: a trial interrupted by another choice waits with its time left; leaving answers the event; a built-in can be the offer', async () => {
  const clock = { t: 1000000 };
  const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
  r.ctl.start();
  await r.ctl.offer({ id: 'e1', until: clock.t + 5 * HOUR });
  r.ctl.startOffer();
  clock.t += 15000;
  r.ctl.select('dark');
  const v = r.ctl.offerView();
  assert.deepStrictEqual(
    [v.phase, v.left, r.applied[r.applied.length - 1]],
    ['pending', 45000, 'dark'],
    'the chosen theme shows; the trial waits',
  );
  r.ctl.startOffer();
  assert.deepStrictEqual(r.ctl.offerView().left, 45000);
  r.ctl.leaveOffer();
  assert.deepStrictEqual(
    [r.ctl.offerView(), r.storage.data[EVENT_KEY], r.applied[r.applied.length - 1]],
    [null, 'e1', 'dark'],
    'left: answered, the active theme is back',
  );
  // a player who replaced both built-ins is offered one of them
  const BUILTIN_POOL = BUILTIN.map(b => ({ entry: b, f: null, live: true }));
  const away = rig({
    stored: withPool([entryOf(CANDY), entryOf(WOOD)], null, 2),
    owned: [CANDY, WOOD],
    pool: BUILTIN_POOL,
    files: {},
    clock,
  });
  away.ctl.start();
  assert.ok(await away.ctl.offer({ id: 'e9', until: clock.t + HOUR }));
  const id = away.ctl.offerView().entry.id;
  assert.ok(BUILTIN_IDS.includes(id));
  away.ctl.startOffer();
  assert.deepStrictEqual(await away.ctl.keepOffer('wood'), true);
  assert.deepStrictEqual(
    [
      away.ctl.state().pool.map(e => e.id),
      BUNDLE_KEY(id) in away.storage.data,
      away.calls.filter(c => c !== 'pool'),
    ],
    [['candy', id], false, []],
    'taken without a copy or a fetch',
  );
});

test('themes: the slots follow the activity: 2, +1 at 12 Game-of-Day solves, +1 at a best streak of 30 days, 4 at most, never lowered', () => {
  const G = SLOT_GOTD_SOLVES,
    S = SLOT_STREAK_DAYS;
  assert.deepStrictEqual(
    [
      {},
      { gotdSolves: G - 1, bestStreak: S - 1 },
      { gotdSolves: G },
      { bestStreak: S },
      { gotdSolves: G, bestStreak: S },
      { gotdSolves: 999, bestStreak: 999 },
      { gotdSolves: NaN, bestStreak: undefined },
      undefined,
    ].map(slotsFor),
    [2, 2, 3, 3, 4, 4, 2, 2],
  );
  const r = rig();
  r.ctl.start();
  let changes = 0;
  r.ctl.onChange(() => {
    changes++;
  });
  assert.deepStrictEqual(
    [r.ctl.awardSlots({ gotdSolves: 11 }), r.ctl.state().cap, changes],
    [false, 2, 0],
  );
  assert.deepStrictEqual([r.ctl.awardSlots({ gotdSolves: 12 }), r.ctl.state().cap], [true, 3]);
  assert.deepStrictEqual(
    [
      r.ctl.awardSlots({ gotdSolves: 12, bestStreak: 30 }),
      r.ctl.state().cap,
      JSON.parse(r.storage.data[POOL_KEY]).cap,
    ],
    [true, 4, 4],
    'kept on the device',
  );
  assert.deepStrictEqual(
    [
      r.ctl.awardSlots({ gotdSolves: 99, bestStreak: 99 }),
      r.ctl.awardSlots({}),
      r.ctl.state().cap,
    ],
    [false, false, 4],
    'never lowered, never above four',
  );
});

test('themes: a slot another device has counts here (groupCap): 2..4, never lowered', () => {
  assert.deepStrictEqual(
    [
      { groupCap: 3 },
      { groupCap: 4 },
      { groupCap: 9 },
      { groupCap: 1 },
      { groupCap: NaN },
      { groupCap: 3, gotdSolves: 12, bestStreak: 30 },
      { groupCap: 3, gotdSolves: 12 },
    ].map(slotsFor),
    [3, 4, 4, 2, 2, 4, 3],
  );
  const r = rig();
  r.ctl.start();
  assert.deepStrictEqual(
    [
      r.ctl.awardSlots({ groupCap: 3 }),
      r.ctl.state().cap,
      r.ctl.awardSlots({ groupCap: 2 }),
      r.ctl.state().cap,
    ],
    [true, 3, false, 3],
  );
});

test('themes: settle fills a free slot with a theme of another device, also when no slot came just now', async () => {
  const r = rig({ pool: poolOf([CANDY, WOOD]), files: filesOf([CANDY, WOOD]) });
  r.ctl.start();
  r.ctl.awardSlots({ groupCap: 3 });
  assert.deepStrictEqual(r.ctl.state().pool.length, 2, 'the slot came earlier: 3 slots, 2 themes');
  const res = await r.ctl.settle({ groupCap: 3 }, ['light', 'wood']);
  assert.deepStrictEqual(
    [res.raised, res.added.map(e => e.id), r.ctl.state().pool.map(e => e.id)],
    [false, ['wood'], ['light', 'dark', 'wood']],
  );
  assert.deepStrictEqual(
    [(await r.ctl.settle({ groupCap: 3 }, ['candy'])).added, r.ctl.state().pool.length],
    [[], 3],
    'themes as many as slots: nothing more',
  );
});

test('themes: settle does not ask the site again for the same free slots and ids', async () => {
  const r = rig({ pool: poolOf([WOOD]), files: filesOf([WOOD]) });
  r.ctl.start();
  r.ctl.awardSlots({ groupCap: 3 });
  assert.deepStrictEqual((await r.ctl.settle({ groupCap: 3 }, ['gone-id'])).added, []);
  const asked = r.calls.length;
  assert.deepStrictEqual((await r.ctl.settle({ groupCap: 3 }, ['gone-id'])).added, []);
  assert.deepStrictEqual(r.calls.length, asked, 'once per the same ids and free slots');
  assert.deepStrictEqual(
    (await r.ctl.settle({ groupCap: 3 }, ['gone-id', 'wood'])).added.map(e => e.id),
    ['wood'],
    'other ids: tried',
  );
  assert.deepStrictEqual((await r.ctl.settle({ groupCap: 2 }, [])).added, [], 'no ids: nothing');
});

test('themes: adopt fills the free slots with themes of the site pool that other devices keep; nothing else changes', async () => {
  const r = rig({ pool: poolOf([CANDY, WOOD], ['candy']), files: filesOf([CANDY, WOOD]) });
  r.ctl.start();
  assert.deepStrictEqual(await r.ctl.adopt(['candy'], 1), [], 'no free slot: nothing');
  r.ctl.awardSlots({ groupCap: 4 });
  let changes = 0;
  r.ctl.onChange(() => {
    changes++;
  });
  const active = r.ctl.state().active;
  const added = await r.ctl.adopt(['light', 'gone-id', 'wood', 'candy', 'wood'], 1);
  assert.deepStrictEqual(
    [added.map(e => e.id), r.ctl.state().pool.map(e => e.id), r.ctl.state().active, changes],
    [['wood'], ['light', 'dark', 'wood'], active, 1],
    'at most one, a built-in or an unknown id is skipped, the shown theme stays',
  );
  assert.deepStrictEqual(
    (await r.ctl.adopt(['wood', 'candy'])).map(e => e.id),
    ['candy'],
    'one the device has is skipped; a draft of the other device counts; the cap is not passed',
  );
  assert.deepStrictEqual(
    [r.ctl.state().pool.length, (await r.ctl.adopt(['candy'])).length],
    [4, 0],
  );
  assert.ok(JSON.parse(r.storage.data[POOL_KEY]).pool.length === 4, 'kept on the device');
});

test('themes: the offer record is rebuilt from the whitelists, whatever the device holds', () => {
  const good = {
    event: 'e1',
    phase: 'trial',
    until: 5000,
    left: 40000,
    theme: cleanBundle(CANDY),
  };
  const text = serializeOffer(good);
  assert.deepStrictEqual(parseOffer(text).theme.entry, good.theme.entry);
  assert.deepStrictEqual(
    parseOffer(text, 10000).left,
    10000,
    'the time left is cut to the trial time of this build',
  );
  const bad = patch => {
    const o = JSON.parse(text);
    patch(o);
    return parseOffer(JSON.stringify(o));
  };
  for (const [name, got] of [
    ['not json', parseOffer('{')],
    ['nothing', parseOffer(null)],
    [
      'version',
      bad(o => {
        o.v = 2;
      }),
    ],
    [
      'phase',
      bad(o => {
        o.phase = 'now';
      }),
    ],
    [
      'event',
      bad(o => {
        o.event = 'a b';
      }),
    ],
    [
      'until',
      bad(o => {
        o.until = 'x';
      }),
    ],
    [
      'left',
      bad(o => {
        o.left = -1;
      }),
    ],
    [
      'entry',
      bad(o => {
        o.theme.entry = { id: 'x' };
      }),
    ],
    [
      'css url',
      bad(o => {
        o.theme.css = o.theme.css.replace('}', ';background:url(x)}');
      }),
    ],
    [
      'css markup',
      bad(o => {
        o.theme.css += '<';
      }),
    ],
    [
      'css of another theme',
      bad(o => {
        o.theme.css = o.theme.css.replace('"candy"', '"wood"');
      }),
    ],
    [
      'font',
      bad(o => {
        o.theme.fonts = [{ family: 'F', weight: '400', data: '!!' }];
      }),
    ],
    ['size', parseOffer(text + ' '.repeat(400 * 1024))],
  ])
    assert.deepStrictEqual(got, null, name);
  assert.deepStrictEqual(
    parseOffer(
      serializeOffer({ ...good, theme: { entry: BUILTIN[0], css: null, art: null, fonts: [] } }),
    ).theme,
    { entry: BUILTIN[0], css: null, art: null, fonts: [] },
    'a built-in has no css',
  );
  assert.deepStrictEqual(
    runBoot({ storage: { [OFFER_KEY]: serializeOffer({ ...good, phase: 'pending' }) } }).appended
      .length,
    0,
    'only a trial is painted',
  );
  assert.deepStrictEqual(
    runBoot({ storage: { [OFFER_KEY]: serializeOffer({ ...good, left: 0 }) } }).appended.length,
    0,
    'a trial with no time left is not',
  );
  assert.deepStrictEqual(
    runBoot({
      storage: {
        [OFFER_KEY]: serializeOffer({
          ...good,
          theme: { entry: BUILTIN[1], css: null, art: null, fonts: [] },
        }),
      },
    }).dataset.theme,
    'dark',
    'a built-in on trial',
  );
  assert.deepStrictEqual(
    runBoot({ storage: { [OFFER_KEY]: text.replace('"mode":"light"', '"mode":"x"') } }).dataset
      .theme,
    'light',
    'a damaged record shows the usual theme',
  );
});

test('themes: the chip and the sheet draw each phase; a name cannot inject markup', () => {
  const text = (k, ...a) => `${k}|${a.join('|')}`;
  const theme = { name: '<b>x</b>', symbol: SYMBOL, swatches: ['#fff'] };
  const pend = chipHtml({ phase: 'pending', theme, left: '', trialMs: 1800000 }, text);
  assert.ok(pend.includes('theme.offer.try|30') && !pend.includes('<b>x'), pend);
  assert.ok(
    chipHtml({ phase: 'pending', theme, left: '12:00', trialMs: 1800000 }, text).includes(
      'theme.offer.resume|12:00',
    ),
  );
  const on = chipHtml({ phase: 'trial', theme, left: '29:59' }, text);
  assert.ok(on.includes('data-left>29:59<') && on.includes('&lt;b&gt;x'), on);
  assert.ok(
    chipHtml({ phase: 'final', theme }, text).includes(
      'theme.offer.finalChip|<b>x</b>'.replace('<b>x</b>', '&lt;b&gt;x&lt;/b&gt;'),
    ),
  );
  const sheetFinal = offerHtml({ theme, left: '1:00', phase: 'final', minimize: true }, text);
  assert.ok(
    sheetFinal.includes('theme.offer.finalTitle') &&
      sheetFinal.includes('theme.offer.finalText') &&
      sheetFinal.includes('data-offer="minimize"'),
  );
  const sheetTrial = offerHtml({ theme, left: '1:00' }, text);
  assert.ok(
    sheetTrial.includes('theme.offer.title') && !sheetTrial.includes('data-offer="minimize"'),
    'no minimize unless asked',
  );
});

test('themes: watchDay checks now, when the page is seen again or the network is back, and stops on request', () => {
  const calls = [];
  const doc = {
    visibilityState: 'visible',
    listeners: {},
    addEventListener(n, f) {
      this.listeners[n] = f;
    },
    removeEventListener(n) {
      delete this.listeners[n];
    },
  };
  const win = {
    listeners: {},
    addEventListener(n, f) {
      this.listeners[n] = f;
    },
    removeEventListener(n) {
      delete this.listeners[n];
    },
  };
  const cleared = [];
  const clock = { t: new Date(2026, 10, 3, 21, 0, 0).getTime() };
  const timers = { setTimeout: () => 7, clearTimeout: id => cleared.push(id) };
  const stop = watchDay(() => calls.push('check'), { doc, win, now: () => clock.t, timers });
  assert.deepStrictEqual(calls.length, 1, 'at once');
  doc.visibilityState = 'hidden';
  doc.listeners.visibilitychange();
  assert.deepStrictEqual(calls.length, 1, 'hidden: nothing');
  doc.visibilityState = 'visible';
  doc.listeners.visibilitychange();
  win.listeners.online();
  assert.deepStrictEqual(calls.length, 3);
  stop();
  assert.deepStrictEqual(
    [Object.keys(doc.listeners), Object.keys(win.listeners), cleared.length > 0],
    [[], [], true],
  );
  const throwing = watchDay(
    () => {
      throw new Error('x');
    },
    { doc, win, now: () => clock.t, timers: { setTimeout: () => 1, clearTimeout() {} } },
  );
  throwing();
});

test('themes: watchDay wakes every minute, so a sleeping machine or a long-open tab notices the new day: the check runs on a changed day, on pageshow, not on every tick', () => {
  const calls = [];
  const doc = {
    visibilityState: 'visible',
    listeners: {},
    addEventListener(n, f) {
      this.listeners[n] = f;
    },
    removeEventListener(n) {
      delete this.listeners[n];
    },
  };
  const win = {
    listeners: {},
    addEventListener(n, f) {
      this.listeners[n] = f;
    },
    removeEventListener(n) {
      delete this.listeners[n];
    },
  };
  const timers = [];
  const clock = { t: new Date(2026, 10, 3, 23, 0, 0).getTime() };
  const stop = watchDay(() => calls.push('check'), {
    doc,
    win,
    now: () => clock.t,
    timers: {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout() {},
    },
  });
  const tick = () => timers[timers.length - 1].fn();
  assert.deepStrictEqual(
    [calls.length, timers[0].ms],
    [1, TICK_MS],
    'at once; the next wake-up is a minute away, not hours',
  );
  clock.t += 30000;
  tick();
  assert.deepStrictEqual(calls.length, 1, 'same day: the tick checks nothing');
  clock.t = new Date(2026, 10, 4, 8, 0, 0).getTime(); // the machine slept through midnight: the long timer would be hours late
  tick();
  assert.deepStrictEqual(calls.length, 2, 'a new day: checked at the first tick');
  tick();
  assert.deepStrictEqual(calls.length, 2, 'and once for that day');
  assert.deepStrictEqual(
    typeof win.listeners.pageshow,
    'function',
    'a page restored from the back-forward cache looks again',
  );
  win.listeners.pageshow();
  assert.deepStrictEqual(calls.length, 3);
  clock.t = new Date(2026, 10, 4, 23, 59, 40).getTime();
  win.listeners.online();
  assert.deepStrictEqual(
    [calls.length, timers[timers.length - 1].ms],
    [4, 21000],
    'near midnight the wake-up is the second after it',
  );
  clock.t = new Date(2026, 10, 5, 0, 0, 1).getTime();
  tick();
  assert.deepStrictEqual(calls.length, 5, 'midnight: checked');
  stop();
  assert.deepStrictEqual([Object.keys(doc.listeners), Object.keys(win.listeners)], [[], []]);
});

test('themes: an event day that comes while another offer still waits is not lost: it is offered when that offer ends', async () => {
  const clock = { t: new Date(2026, 10, 3, 23, 40, 0).getTime() };
  const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
  r.ctl.start();
  await r.ctl.offer({ id: 'd20261103' });
  r.ctl.startOffer();
  clock.t += 10000;
  r.ctl.select('dark'); // interrupted: waits, with a last half hour past midnight
  assert.deepStrictEqual(
    r.ctl.offerView().until,
    clock.t + FINAL_MS,
    'the wait runs past midnight',
  );
  clock.t = new Date(2026, 10, 4, 0, 0, 5).getTime();
  assert.deepStrictEqual(
    await r.ctl.offer({ id: 'd20261104' }),
    false,
    'one offer at a time: the new day waits',
  );
  clock.t += FINAL_MS;
  r.timeouts[r.timeouts.length - 1].fn(); // the old offer's end
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    [r.ctl.offerView()?.event, r.storage.data[EVENT_KEY]],
    ['d20261104', 'd20261103'],
    'the old one is answered; the new day offers by itself, no reload and no new trigger',
  );

  const left = rig({ clock, ...site([CANDY, WOOD]) });
  left.ctl.start();
  await left.ctl.offer({ id: 'x1', until: clock.t + 2 * HOUR });
  assert.deepStrictEqual(await left.ctl.offer({ id: 'x2', until: clock.t + 3 * HOUR }), false);
  left.ctl.leaveOffer();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(left.ctl.offerView()?.event, 'x2', 'leaving frees the place too');

  const late = rig({ clock, ...site([CANDY, WOOD]) });
  late.ctl.start();
  await late.ctl.offer({ id: 'y1', until: clock.t + HOUR });
  assert.deepStrictEqual(await late.ctl.offer({ id: 'y2', until: clock.t + 2 * HOUR }), false);
  clock.t += 3 * HOUR;
  late.timeouts[late.timeouts.length - 1].fn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    late.ctl.offerView(),
    null,
    'an event that ended while it waited is not offered',
  );

  const dev = rig({ clock, ...site([CANDY, WOOD]) });
  dev.ctl.start();
  await dev.ctl.offer({ id: 'z1', until: clock.t + HOUR });
  await dev.ctl.offer({ id: 'z2', until: clock.t + 2 * HOUR });
  dev.ctl.dropOffer();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    dev.ctl.offerView(),
    null,
    'the dev reveal starts afresh: nothing comes back by itself',
  );
});

test('themes: an offer that cannot be fetched (offline, a bad link) is asked again while the event lasts and the page is seen; once on offer it needs no network', async () => {
  const clock = { t: new Date(2026, 10, 3, 10, 0, 0).getTime() };
  let reachable = false;
  const bundles = [CANDY, WOOD];
  const r = rig({
    clock,
    files: filesOf(bundles),
    pool: () => (reachable ? poolOf(bundles) : null),
  });
  r.ctl.start();
  const timer = () => r.timeouts[r.timeouts.length - 1];
  assert.deepStrictEqual(
    await r.ctl.offer({ id: 'd20261103' }),
    false,
    'offline: nothing to offer',
  );
  assert.deepStrictEqual(
    timer().ms,
    5 * 60 * 1000,
    'asked again in 5 minutes, with no event of the browser to wait for',
  );
  await r.ctl.offer({ id: 'd20261103' });
  assert.deepStrictEqual(r.timeouts.length, 1, 'one timer, however many triggers fail');
  clock.t += 5 * 60 * 1000;
  timer().fn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    [r.ctl.offerView(), timer().ms],
    [null, 10 * 60 * 1000],
    'still offline: the wait doubles',
  );
  reachable = true;
  clock.t += 10 * 60 * 1000;
  timer().fn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(
    [r.ctl.offerView()?.event, r.ctl.offerView()?.phase],
    ['d20261103', 'pending'],
    'the link is back: the theme waits as a chip, with no reload',
  );
  assert.deepStrictEqual(
    r.timeouts.length,
    3,
    'two retries, then the end of the day armed for the waiting offer: no retry timer is left',
  );
  reachable = false;
  r.calls.length = 0;
  assert.deepStrictEqual(
    [r.ctl.startOffer(), r.ctl.offerView().phase, r.calls],
    [true, 'trial', []],
    'on offer: the trial needs no network',
  );
  assert.deepStrictEqual(await r.ctl.keepOffer('dark'), true, 'nor does keeping it');
  assert.deepStrictEqual(r.calls, []);

  const hidden = rig({ clock, files: filesOf(bundles), pool: null });
  hidden.ctl.start();
  hidden.ctl.focus(false);
  await hidden.ctl.offer({ id: 'd20261103' });
  assert.deepStrictEqual(hidden.timeouts.length, 0, 'a page nobody sees does not poll');

  const late = rig({ clock, files: filesOf(bundles), pool: null });
  late.ctl.start();
  clock.t = endOfDay(clock.t) - 1000;
  await late.ctl.offer({ id: 'd20261103', until: endOfDay(clock.t) });
  assert.deepStrictEqual(
    late.timeouts.length,
    1,
    'the wait is allowed to run past the end: the call finds the event over',
  );
  clock.t += 5 * 60 * 1000;
  late.timeouts[0].fn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(late.calls.length, 1, 'and asks nothing then');

  const empty = rig({ clock, files: {}, pool: [] });
  empty.ctl.start();
  await empty.ctl.offer({ id: 'd20261103' });
  const owned = rig({
    clock,
    files: filesOf(bundles),
    pool: poolOf(bundles),
    stored: withPool([entryOf(CANDY), entryOf(WOOD)], null, 2),
    owned: bundles,
  });
  owned.ctl.start();
  await owned.ctl.offer({ id: 'd20261103' });
  assert.deepStrictEqual(
    [empty.timeouts.length, owned.timeouts.length],
    [0, 0],
    'an empty pool, or a player who owns everything, is no failure to retry',
  );
});

test('themes: the end of an offer is the end of the day it was asked on, even when the files are slow past midnight', async () => {
  const clock = { t: new Date(2026, 10, 3, 23, 59, 59, 500).getTime() };
  const eve = endOfDay(clock.t);
  const slow = bundle('slow');
  const files = {
    get [stem('slow')]() {
      clock.t += 2000;
      return slow;
    },
  };
  const r = rig({ clock, files, pool: poolOf([slow]) });
  r.ctl.start();
  assert.deepStrictEqual(
    await r.ctl.offer({ id: 'd20261103' }),
    false,
    'the day was over when the file came',
  );
  assert.deepStrictEqual(
    [r.ctl.offerView(), OFFER_KEY in r.storage.data],
    [null, false],
    'no offer of yesterday that lives through today',
  );
  clock.t = new Date(2026, 10, 3, 12, 0, 0).getTime();
  const fast = rig({ clock, files: filesOf([slow]), pool: poolOf([slow]) });
  fast.ctl.start();
  await fast.ctl.offer({ id: 'd20261103' });
  assert.deepStrictEqual(fast.ctl.offerView().until, eve, 'by day: its own midnight');
});

test('themes: the dev reveal lists the whole pool, drafts too, and tries or keeps any theme whatever the cap', async () => {
  const SEA = bundle('sea');
  const all = [CANDY, WOOD, SEA];
  const r = rig({ files: filesOf(all), pool: poolOf(all, ['sea']) });
  r.ctl.start();
  assert.deepStrictEqual(
    (await r.ctl.pool()).map(c => [c.entry.id, c.live, c.owned]),
    [
      ['candy', true, false],
      ['wood', true, false],
      ['sea', false, false],
    ],
    'drafts too',
  );
  assert.deepStrictEqual(await rig({ pool: null }).ctl.pool(), [], 'not reachable: nothing');

  await r.ctl.tryPool('sea');
  assert.deepStrictEqual(
    [
      r.ctl.current().id,
      r.ctl.state().pool.length,
      r.timeouts.length,
      BUNDLE_KEY('sea') in r.storage.data,
    ],
    ['sea', 2, 0, false],
    'a draft shows at once: no end, nothing kept',
  );
  await r.ctl.tryPool('wood');
  assert.deepStrictEqual(r.ctl.current().id, 'wood', 'one try replaces the other');
  assert.deepStrictEqual(await r.ctl.tryPool('nope'), null);
  r.ctl.select('light');
  assert.deepStrictEqual(r.ctl.current().id, 'light', 'choosing a theme of the pool ends it');

  assert.deepStrictEqual(await r.ctl.keepPool('candy'), true);
  assert.deepStrictEqual(
    [r.ctl.state().pool.map(e => e.id), r.ctl.current().id, BUNDLE_KEY('candy') in r.storage.data],
    [['light', 'candy'], 'candy', true],
    'a full pool: it takes the place of the first theme that is not showing',
  );
  assert.deepStrictEqual(await r.ctl.keepPool('wood'), true);
  assert.deepStrictEqual(
    r.ctl.state().pool.map(e => e.id),
    ['wood', 'candy'],
    'and a built-in can be replaced, as a player can',
  );
  assert.deepStrictEqual(await r.ctl.keepPool('sea'), true);
  assert.deepStrictEqual(
    [r.ctl.state().pool.map(e => e.id), BUNDLE_KEY('candy') in r.storage.data],
    [['wood', 'sea'], false],
    "one of the player's own goes before a built-in, and its copy leaves the device",
  );
  assert.deepStrictEqual(await r.ctl.keepPool('sea'), false, 'owned already');
  assert.deepStrictEqual(await r.ctl.keepPool('ghost'), false, 'not in the pool');
  r.ctl.setCap(4);
  assert.deepStrictEqual(
    [await r.ctl.keepPool('candy'), r.ctl.state().pool.length],
    [true, 3],
    'with room, nothing is replaced',
  );
  assert.deepStrictEqual(
    [
      evictable(withPool([BUILTIN[0], BUILTIN[1]], null, 2), 'light').id,
      evictable(withPool([BUILTIN[0], entryOf(CANDY)], null, 2), 'light').id,
    ],
    ['dark', 'candy'],
  );
});

test('themes: the dev rows of the picker and the offer sheet are markup, escaped; the time left reads as a clock', () => {
  const labels = { all: 'All', draft: 'draft', keep: 'Keep', offer: 'Offer', none: 'None' };
  const list = [
    { entry: entryOf(CANDY), f: 'x', live: true, owned: true },
    { entry: entryOf(WOOD), f: 'y', live: false, owned: false },
  ];
  const items = devItems(list, 'wood', 'zh');
  assert.deepStrictEqual(
    items.map(i => [i.id, i.name, i.live, i.owned, i.current]),
    [
      ['candy', '主题', true, true, false],
      ['wood', '主题', false, false, true],
    ],
  );
  const html = devHtml(items, labels);
  assert.ok(
    html.includes('data-try-id="candy"') &&
      html.includes('data-try-id="wood"') &&
      html.includes('class="current"') &&
      html.includes('theme-draft') &&
      html.includes('data-offer-now') &&
      html.includes('data-note'),
  );
  assert.deepStrictEqual(
    (html.match(/data-keep-id/g) || []).length,
    1,
    'a theme that is owned has no keep button',
  );
  assert.ok(devHtml([], labels).includes('None'), 'an empty pool says so');
  assert.ok(!html.includes('data-next'), 'no next day: no row');
  const days = {
    ...labels,
    next: 'Next',
    today: 'today',
    tomorrow: 'tomorrow',
    inDays: 'in {n} days',
  };
  const day = n => ({ year: 2026, month: 11, day: 15, date: '2026-11-15', days: n });
  assert.deepStrictEqual(
    [0, 1, 3].map(n => nextDayText(day(n), days)),
    [
      'Next: Sun 2026-11-15 (today)',
      'Next: Sun 2026-11-15 (tomorrow)',
      'Next: Sun 2026-11-15 (in 3 days)',
    ],
  );
  assert.ok(
    devHtml(items, days, day(3)).includes(
      '<div class="theme-picker-empty" data-next>Next: Sun 2026-11-15 (in 3 days)</div>',
    ),
    'the row sits above the offer button',
  );
  assert.ok(
    devHtml(items, { ...days, next: '<b>' }, day(3)).includes('&lt;b&gt;: Sun'),
    'escaped',
  );
  const hostile = devHtml(
    [
      {
        id: 'x"><script>',
        name: '<img src=x>',
        symbol: SYMBOL,
        swatches: ['#fff"><i'],
        live: false,
        owned: false,
        current: false,
      },
    ],
    { ...labels, all: '<b>', draft: '<u>' },
  );
  assert.ok(!/<(script|img|b|u)[ >]/.test(hostile), 'no tag of theirs');
  assert.ok(
    ['x&quot;&gt;&lt;script&gt;', '&lt;img src=x&gt;', '&lt;b&gt;', '&lt;u&gt;'].every(piece =>
      hostile.includes(piece),
    ),
    'shown as text',
  );

  assert.deepStrictEqual(
    [0, -5, 1, 90000, 3600000, 7325000, 2 * 86400000 + 3 * 3600000].map(formatLeft),
    ['0:00', '0:00', '0:01', '1:30', '1:00:00', '2:02:05', '2d 3h'],
  );
  const text = (key, ...args) => (args.length ? `${key}(${args})` : key);
  const theme = { name: 'Candy <b>', symbol: SYMBOL, swatches: ['#fff'] };
  const step1 = offerHtml({ theme, left: '0:42 left' }, text);
  assert.ok(
    step1.includes('data-offer="keep"') &&
      step1.includes('data-offer="leave"') &&
      step1.includes('data-left') &&
      step1.includes('Candy &lt;b&gt;') &&
      !step1.includes('Candy <b>'),
    'keep or leave, the time left, the name as text',
  );
  assert.ok(
    !offerHtml({ theme, left: null }, text).includes('data-left'),
    'no countdown for an offer with no end',
  );
  assert.ok(
    offerHtml({ theme, failed: true }, text).includes('role="alert"') &&
      !offerHtml({ theme }, text).includes('role="alert"'),
  );
  const step2 = offerHtml(
    {
      theme,
      replace: [
        { id: 'light', name: 'Light', symbol: SYMBOL, swatches: [] },
        { id: 'x"y', name: 'N', symbol: SYMBOL, swatches: [] },
      ],
    },
    text,
  );
  assert.ok(
    step2.includes('data-replace="light"') &&
      step2.includes('data-replace="x&quot;y"') &&
      step2.includes('data-offer="back"') &&
      !step2.includes('data-offer="keep"'),
    "which of the player's themes it replaces",
  );
  assert.ok(
    step2.includes('theme.offer.replace(Candy &lt;b&gt;)') ||
      step2.includes('theme.offer.replace(Candy'),
    'and the new theme is named',
  );
});

// ---- the offer days

const DIGITS = [2, 1, 9, 0];
const CALENDAR_SYMBOL = '<circle cx="12" cy="12" r="5"/>';
const RULE_KEYS = [
  'offer.rule',
  'rule.open',
  'rule.title',
  'rule.lead',
  'rule.step1',
  'rule.step2',
  'rule.step3',
  'rule.step4',
  'rule.example',
  'rule.last',
].map(key => `theme.${key}`);
const keyText = (key, ...args) => (args.length ? `${key}(${args})` : key);
const fill =
  dict =>
  (key, ...args) =>
    String(dict[key]).replace(/\{(\d+)\}/g, (_, i) => args[i]);
const YEARS = Array.from({ length: 100 }, (_, i) => 2026 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// every month of 100 years: [{ year, month, plan }]
const calendar = () =>
  YEARS.flatMap(year =>
    MONTHS.map(month => ({
      year,
      month,
      plan: monthPlan(year, month, DIGITS),
    })),
  );

// the candidates of every month of 2027, as the rule gives them (a regression table)
const CANDIDATES_2027 = [
  [4, 6, 7, 15, 20, 22, 23, 31],
  [4, 5, 7, 12, 20, 21, 23, 28],
  [4, 5, 6, 13, 20, 21, 22, 29],
  [1, 2, 3, 10, 17, 18, 19, 26],
  [2, 3, 11, 16, 18, 19, 27],
  [1, 3, 8, 16, 17, 19, 24],
  [1, 2, 9, 16, 17, 18, 25],
  [6, 13, 14, 15, 22, 29, 30, 31],
  [7, 12, 14, 15, 23, 28, 30],
  [4, 12, 13, 15, 20, 28, 29, 31],
  [5, 12, 13, 14, 21, 28, 29, 30],
  [2, 9, 10, 11, 18, 25, 26, 27],
];

test("offer days: the value of a date is day ^ month ^ the year's last digit, mod 16", () => {
  assert.deepStrictEqual(dateValue(2027, 11, 29), 1, '29 ^ 11 ^ 7 = 17, mod 16 = 1');
  assert.deepStrictEqual(dateValue(2027, 3, 6), 2);
  assert.deepStrictEqual(dateValue(2027, 3, 29), 9);
  assert.deepStrictEqual(dateValue(2027, 11, 28), 0, '28 ^ 11 ^ 7 = 16, mod 16 = 0');
  assert.deepStrictEqual(dateValue(2027, 11, 5), 9);
  assert.deepStrictEqual(
    dateValue(2027, 11, 29),
    dateValue(2037, 11, 29),
    'the year counts by its last digit',
  );
});

test('offer days: the next offer day is the first one on or after a date, as day-by-day eventAt finds it; answered ones are left out', () => {
  const first = (from, skip = () => false) => {
    for (let i = 0; i < 400; i++) {
      const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const event = eventAt(date, DIGITS);
      if (event && !skip(event.id)) return { ...event, days: i };
    }
    return null;
  };
  for (let i = 0; i < 800; i += 3) {
    const from = new Date(2026, 10, 12 + i, 15, 30);
    const got = nextEvent(from, DIGITS);
    const want = first(from);
    assert.deepStrictEqual(
      [got.id, got.date, got.days],
      [
        want.id,
        `${want.year}-${String(want.month).padStart(2, '0')}-${String(want.day).padStart(2, '0')}`,
        want.days,
      ],
      from.toDateString(),
    );
  }
  assert.deepStrictEqual(
    nextEvent(new Date(2026, 10, 12), DIGITS).date,
    '2026-11-15',
    'the date of the review: the 15th is next',
  );
  assert.deepStrictEqual(
    [
      nextEvent(new Date(2026, 10, 15), DIGITS).days,
      nextEvent(new Date(2026, 10, 15, 23, 59), DIGITS).days,
    ],
    [0, 0],
    'on the day itself: today',
  );
  assert.deepStrictEqual(
    nextEvent(new Date(2026, 10, 15), DIGITS, id => id === 'd20261115').date,
    '2026-11-28',
    'an answered day is skipped',
  );
  const skipAll = nextEvent(new Date(2026, 10, 12), DIGITS, () => true);
  assert.deepStrictEqual(skipAll, null, 'nothing left within the search: null');
  assert.deepStrictEqual(
    nextEvent(new Date(2026, 11, 28), DIGITS).date.slice(0, 4),
    '2027',
    'over the year',
  );
  assert.deepStrictEqual(
    nextEvent(new Date(2026, 10, 12), [1, 1, 2, 3]),
    null,
    'no valid digits, no day',
  );
});

test('offer days: the candidates of a month are the days whose value is a secret digit', () => {
  assert.deepStrictEqual(
    MONTHS.map(month => candidates(2027, month, DIGITS)),
    CANDIDATES_2027,
  );
  for (const { year, month } of calendar()) {
    const days = candidates(year, month, DIGITS);
    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const wanted = DIGITS.includes(dateValue(year, month, day));
      assert.ok(days.includes(day) === wanted, `${year}-${month}-${day}`);
    }
  }
  assert.deepStrictEqual(
    candidates(2027, 11, [0, 1, 2, 9]),
    candidates(2027, 11, [9, 2, 1, 0]),
    'order is free',
  );
});

test('offer days: every month has 7-8 candidates, and a candidate for every digit', () => {
  for (const { year, month } of calendar()) {
    const days = candidates(year, month, DIGITS);
    assert.ok(days.length >= 7 && days.length <= 8, `${year}-${month}: ${days.length}`);
    const seen = new Set(days.map(day => dateValue(year, month, day)));
    assert.deepStrictEqual(
      [...seen].sort(),
      [0, 1, 2, 9],
      `${year}-${month}: every digit can be shown`,
    );
  }
});

test('offer days: the candidates change with the month and with the year', () => {
  assert.deepStrictEqual(
    new Set(CANDIDATES_2027.map(days => days.join())).size,
    12,
    'twelve different months',
  );
  const nov = year => candidates(year, 11, DIGITS).join();
  assert.deepStrictEqual(
    new Set([2026, 2027, 2028, 2029, 2030].map(nov)).size,
    5,
    'five different years',
  );
  assert.deepStrictEqual(nov(2027), nov(2037), 'ten years later the year digit comes round');
});

test('offer days: the draw of a month: one day, or two at least MIN_GAP days apart', () => {
  assert.deepStrictEqual(monthPlan(2027, 3, DIGITS), [6, 29], 'a month with two');
  assert.deepStrictEqual(monthPlan(2027, 11, DIGITS), [29], 'a month with one');
  assert.deepStrictEqual(
    monthPlan(2027, 3, DIGITS),
    monthPlan(2027, 3, DIGITS),
    'the same every time',
  );
  let events = 0;
  let months = 0;
  let twice = 0;
  for (const { year, month, plan } of calendar()) {
    const days = candidates(year, month, DIGITS);
    assert.ok(plan.length === 1 || plan.length === 2, `${year}-${month}`);
    assert.ok(
      plan.every(day => days.includes(day)),
      `${year}-${month}: only candidates`,
    );
    if (plan.length === 2) {
      assert.ok(plan[1] - plan[0] >= MIN_GAP, `${year}-${month}: ${plan}`);
      twice++;
    }
    events += plan.length;
    months++;
  }
  assert.ok(events / months > 1.15 && events / months < 1.35, `mean ${events / months}`);
  assert.ok(twice / months > 0.15 && twice / months < 0.35, `twice ${twice / months}`);
});

test('offer days: the days are spread over the whole month', () => {
  const thirds = [0, 0, 0];
  let events = 0;
  for (const { plan } of calendar()) {
    for (const day of plan) {
      thirds[day <= 10 ? 0 : day <= 20 ? 1 : 2]++;
      events++;
    }
  }
  for (const count of thirds) {
    assert.ok(count / events > 0.25 && count / events < 0.4, `${thirds}`);
  }
});

test('offer days: the offer day of a local date; the id names the event', () => {
  const early = eventAt(new Date(2027, 10, 29, 0, 0, 0), DIGITS);
  const late = eventAt(new Date(2027, 10, 29, 23, 59, 59), DIGITS);
  assert.deepStrictEqual(early, { id: 'd20271129', year: 2027, month: 11, day: 29 });
  assert.deepStrictEqual(late, early, 'the whole local day');
  assert.deepStrictEqual(eventAt(new Date(2027, 10, 28, 12), DIGITS), null);
  assert.deepStrictEqual(eventAt(new Date(2027, 10, 30, 12), DIGITS), null);
  assert.deepStrictEqual(eventAt(new Date(2027, 2, 6, 12), DIGITS).id, 'd20270306');
  assert.deepStrictEqual(eventAt(new Date(2027, 2, 29, 12), DIGITS).id, 'd20270329');
  const ids = new Set();
  for (const { year, month, plan } of calendar()) {
    for (const day of plan) {
      const event = eventAt(new Date(year, month - 1, day, 12), DIGITS);
      assert.ok(event && EVENT_RE.test(event.id), `${year}-${month}-${day}`);
      ids.add(event.id);
    }
  }
  assert.deepStrictEqual(
    ids.size,
    calendar().reduce((sum, c) => sum + c.plan.length, 0),
    'one id for each day',
  );
});

test('offer days: without four different digits nothing is offered', () => {
  assert.ok(validDigits(DIGITS) && validDigits([0, 1, 2, 9]));
  for (const bad of [
    [2, 1, 9],
    [2, 1, 9, 9],
    [2, 1, 9, 10],
    [2, 1, 9, -1],
    [2, 1, 9, 0.5],
    null,
    undefined,
    'x',
  ]) {
    assert.ok(!validDigits(bad), `${bad}`);
    assert.deepStrictEqual(eventAt(new Date(2027, 10, 29, 12), bad), null);
  }
  assert.ok(validDigits(THEMES.digits), 'the config has four different digits');
});

test('offer days: a player who sees every offer day learns all four digits, in time', () => {
  const months = calendar();
  let worst = 0;
  for (let start = 0; start + 60 < months.length; start++) {
    const seen = new Set();
    let used = 0;
    while (seen.size < 4) {
      const { year, month, plan } = months[start + used];
      for (const day of plan) seen.add(dateValue(year, month, day));
      used++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 9]);
    worst = Math.max(worst, used);
  }
  assert.ok(worst <= 30, `worst ${worst} months`);
});

test('offer days: the rule text has a worked example that is computed, and is no offer day', () => {
  const example = ruleExample();
  assert.deepStrictEqual(example, {
    date: '2031-06-27',
    day: 27,
    month: 6,
    last: 1,
    first: 29,
    xor: 28,
    value: 12,
  });
  assert.deepStrictEqual(example.value, dateValue(2031, 6, 27));
  assert.ok(example.value > 9, 'a value of 10 or more is no digit');
  assert.ok(!monthPlan(2031, 6, DIGITS).includes(27));
});

test('offer days: the offer sheet states the public rule and opens the info panel', () => {
  const theme = { name: 'Candy', symbol: CALENDAR_SYMBOL, swatches: [] };
  const sheet = offerHtml({ theme, left: '1:00' }, keyText);
  assert.ok(
    sheet.includes('theme.offer.rule') && sheet.includes('data-offer="rule"'),
    'in the trial',
  );
  assert.ok(
    offerHtml({ theme, phase: 'final' }, keyText).includes('data-offer="rule"'),
    'when over',
  );
  const replacing = offerHtml({ theme, replace: [] }, keyText);
  assert.ok(!replacing.includes('data-offer="rule"'), 'not when replacing');
  assert.ok(
    sheet.includes('data-offer="keep"') && sheet.includes('data-offer="leave"'),
    'still there',
  );
});

test('offer days: the info panel tells the rule, in both languages, and never the digits', () => {
  const example = ruleExample();
  for (const dict of [EN, ZH]) {
    for (const key of RULE_KEYS) assert.ok(typeof dict[key] === 'string' && dict[key], key);
    const html = ruleHtml(fill(dict), example);
    assert.deepStrictEqual((html.match(/<li>/g) || []).length, 4, 'four steps');
    assert.ok(html.includes('2031-06-27') && html.includes('27 ⊕ 6 = 29'), 'the worked example');
    assert.ok(html.includes('29 ⊕ 1 = 28') && html.includes('12'), 'and its steps');
    assert.ok(html.includes('110 ⊕ 011 = 101 = 5'), 'the XOR example');
    assert.ok(dict['theme.offer.rule'].includes('16') && dict['theme.rule.step3'].includes('16'));
  }
  const bits = n => n.toString(2).padStart(3, '0');
  assert.deepStrictEqual([bits(6), bits(3), bits(6 ^ 3)], ['110', '011', '101']);
  const hostile = ruleHtml(() => '<b>x</b>', example);
  assert.ok(!hostile.includes('<b>x'), 'the texts are escaped');
});

test('offer days: the theme picker shows the public rule and a button for the info panel', () => {
  const items = [{ id: 'a', name: 'A', symbol: CALENDAR_SYMBOL, swatches: [], current: true }];
  const rule = { line: 'the rule', open: 'How it works' };
  const html = pickerHtml(items, 'Choose', rule);
  assert.ok(html.includes('the rule') && html.includes('How it works'), 'both texts');
  assert.ok(html.includes('data-rule') && html.includes('role="menuitem"'), 'a menu item');
  assert.ok(html.indexOf('data-theme-id') < html.indexOf('data-rule'), 'under the list');
  assert.deepStrictEqual(
    pickerHtml(items, 'Choose', null),
    pickerHtml(items, 'Choose'),
    'the rule is optional',
  );
  assert.ok(!pickerHtml(items, 'Choose').includes('data-rule'), 'without it: no footer');
  const hostile = pickerHtml(items, 'Choose', { line: '<i>x</i>', open: '"><b>' });
  assert.ok(!hostile.includes('<i>x') && !hostile.includes('"><b>'), 'the texts are escaped');
});
