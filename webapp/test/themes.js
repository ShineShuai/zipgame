// Tests of the theme system (src/themes): the whitelists, the bundle a theme arrives in, the device store, the files
// the site serves, the pool, the controller (event -> offer -> take or leave; the dev reveal), and the page's inline head script, run for real
// (node:vm) and compared with the pool code it mirrors. Fakes stand in for storage, the network and the page. The templates
// themselves (the authoring side) are tested by themes/tools/test.mjs. Registered by tests.js.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyEntry, loadFonts } from '../src/themes/apply.js';
import { currentArt, setArt, solidIsDark } from '../src/themes/art-state.js';
import { variantIcon } from '../src/apps/play/icons.js';
import { boardSvg, COLORS } from '../src/apps/play/board.js';
import { makePuzzle } from '../src/core/model.js';
import { portalColorVar, PORTAL_COLORS } from '../src/view/portal-icons.js';
import { cleanArt, CLASSIC_BOARD } from '../src/themes/art.js';
import { cleanBundle } from '../src/themes/bundle.js';
import { BUILTIN, BUILTIN_IDS } from '../src/themes/builtin.js';
import { createThemes } from '../src/themes/index.js';
import {
  EVENT_KEY, SEED_KEY, endOfDay, hash, newSeed, offerOrder, watchDay,
} from '../src/themes/event.js';
import { SLOT_GOTD_SOLVES, SLOT_STREAK_DAYS, slotsFor } from '../src/themes/slots.js';
import {
  FINAL_MS, OFFER_KEY, parseOffer, serializeOffer,
} from '../src/themes/trial.js';
import { cleanLayout } from '../src/themes/layout.js';
import {
  activeEntry, cleanEntry, evictable, fresh, isClassicPool, MODE_KEY, nextEntry, parseState, POOL_KEY, remove, save, select, serialize, setCap,
} from '../src/themes/pool.js';
import { browserSource, cleanPool, createSource, FILE_RE, MAX_FILE, MAX_POOL, MAX_THEMES } from '../src/themes/source.js';
import { BUNDLE_KEY, createStore } from '../src/themes/store.js';
import { cleanTokens, buildCss } from '../src/themes/tokens.js';
import { DEFAULT_LAYOUT, LAYOUT as PRESETS } from '../src/themes/layout.js';
import { devHtml, devItems, pickerHtml, pickerItems } from '../src/themes/picker.js';
import { chipHtml, formatLeft, offerHtml } from '../src/themes/offer.js';
import {
  cleanInner, cleanSvg, freshScope, scopeIds,
} from '../src/themes/svg.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SYMBOL = '<circle cx="12" cy="12" r="5"/><path d="M7 12 2.5 8.5v7z"/>';
const LAYOUT = { menu: 'dashboard', picker: 'tiles', actions: 'side' };
const woff2 = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]).toString('base64');

// A valid bundle as themes/tools/pack.mjs makes it (a handful of tokens is enough for the app's checks).
const bundle = (id, mode = 'light', extra = {}) => ({
  themeApi: 1, id, v: 3,
  meta: { mode, name: { en: id.toUpperCase(), zh: '主题' }, chrome: mode === 'dark' ? '#2b1d14' : '#efe7ff', layout: LAYOUT, swatches: ['#efe7ff', '#ffffff', '#6a4cf0', '#e8384f'], symbol: SYMBOL },
  tokens: {
    '--bg': mode === 'dark' ? '#2b1d14' : '#efe7ff', '--surface': '#ffffff', '--text': '#2b1b5a', '--accent': '#6a4cf0',
    '--r-2': '22px', '--ctl-h': '50px', '--font-body': '"Trebuchet MS", sans-serif',
  },
  art: { icons: { standard: '<path d="M0 0"/>' }, mark: '<svg viewBox="0 0 96 96"><rect width="96" height="96"/></svg>', board: { grid: 'tiles' } },
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
    setItem: (k, v) => { if (quota && k.startsWith('zip_theme_b_')) throw new Error('QuotaExceededError'); data[k] = String(v); },
    removeItem: k => { delete data[k]; },
  };
};
const ownedRecord = b => { const c = cleanBundle(b); return JSON.stringify({ v: c.entry.v, css: c.css, art: c.art, fonts: c.fonts }); };

// files: the site's files by name (f -> bundle), pool: its manifest as source.pool() gives it (null: not reachable), calls: what was fetched
const stem = id => createHash('sha256').update(id).digest('hex').slice(0, 24);
const poolOf = (bundles, drafts = []) => bundles.map(b => ({ entry: entryOf(b), f: stem(b.id), live: !drafts.includes(b.id) }));
const manifestOf = (bundles, drafts = []) => bundles.map(b => ({ id: b.id, v: b.v, ...b.meta, f: stem(b.id), live: !drafts.includes(b.id) }));
const filesOf = bundles => Object.fromEntries(bundles.map(b => [stem(b.id), b]));
let counter = 0;
const steady = () => () => { counter = (counter + 0.3819) % 1; return counter; };   // a fixed, spread-out "random"

function rig({
  stored, owned = [], legacy, dark = false, quota = false, clock = { t: 1000 }, files = {}, pool = null, storage: given = null, trialMs = 1800000, idle = () => true,
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
    storage, media, store: createStore(storage), now: () => clock.t, random: steady(), trialMs, idle,
    source: { pool: async () => { calls.push('pool'); return pool; }, bundle: async f => { calls.push(f); return files[f] ?? null; } },
    apply: (e, loaded) => applied.push(loaded ? `${e.id}+css` : e.id),
    loadFonts: fonts => { fontLoads.push(fonts.length); return { release() { fontLoads.push('released'); } }; },
    timers: { setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; }, clearTimeout: id => cleared.push(id) },
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
    querySelector: sel => (sel.includes('theme-color') ? { setAttribute: (k, v) => { meta.color = v; } } : null),
  };
  vm.runInNewContext(script, {
    document, localStorage: { getItem: k => (k in storage ? storage[k] : null) }, matchMedia: () => ({ matches: dark }),
  });
  return { dataset, appended, meta };
}

export function themeSystemTests(t, ok, eq, ta) {
  t('themes: the svg whitelist keeps shapes and paint servers and refuses everything else', () => {
    eq(cleanSvg(SYMBOL), SYMBOL, 'shapes pass unchanged');
    eq(cleanInner('<path d="M0 0" fill="color-mix(in srgb, var(--ic-1) 70%, #000)"/>') !== null, true, 'tokens and color-mix pass');
    for (const bad of [
      '<script>alert(1)</script>', '<path d="M0 0" onload="x()"/>', '<path d="M0 0" style="fill:red"/>', '<use href="#a"/>',
      '<image href="x.png"/>', '<path d="M0 0" fill="url(https://evil/x.svg#a)"/>', '<path d="M0 0" fill="url(//evil/x)"/>', '<path d="M0 0" stroke-width="url(#a)"/>',
      '<path d="M0 0" fill="url(#a b)"/>', '<path id="1a" d="M0 0"/>', '<path id="a b" d="M0 0"/>', '<g><path d="M0 0"/>', '<path d="M0 0"/></g>',
      'text<path d="M0 0"/>', '<path d="M0 0" fill="javascript:x"/>', '<foreignObject/>', '<path d="M0 0" fill="a&b"/>',
      '<path d="M0 0" style="background:url(x)"/>', '<path d="M0 0" style="mix-blend-mode:multiply;fill:red"/>', '<g>12</g>', '<text>a long caption</text>',
      '<feImage href="x"/>', '<filter><feOffset dx="1"/></filter>', '<a href="x"/>', '<path d="M0 0" font-family="Evil"/>',
    ]) eq(cleanSvg(bad), null, bad);
    eq(cleanSvg('x'.repeat(30)), null);
    eq(cleanSvg('<path d="M0 0"/>'.repeat(500), 1000), null, 'too long');
    const rich = '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>'
      + '<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5" fx="0.3" fy="0.3"><stop offset="0" stop-color="#fff"/></radialGradient><clipPath id="c1"><rect width="4" height="4"/></clipPath>'
      + '<pattern id="p1" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="2"/></pattern>'
      + '<filter id="b1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs>'
      + '<g clip-path="url(#c1)"><rect width="4" height="4" fill="url(#g1)" filter="url(#b1)" style="mix-blend-mode:multiply"/><rect width="4" height="4" fill="url(#p1)" shape-rendering="crispEdges"/></g>'
      + '<text x="24" y="24" dy=".35em" text-anchor="middle" font-size="9" font-weight="700" fill="url(#g2)">7</text>';
    eq(cleanSvg(rich), rich, 'gradients, a clip path, a pattern, a blur, a blend mode and a short label pass unchanged');
    eq(cleanSvg('<text x=\"2\" y=\"2\">1&gt;</text>'), '<text x=\"2\" y=\"2\">1&gt;</text>', 'a prompt sign is a label too');
    eq(cleanSvg('<text x=\"2\" y=\"2\">1&amp;</text>'), null, 'any other entity is not');
    eq(cleanSvg('<text x=\"2\" y=\"2\">1<b>2</b></text>'), null, 'nor is markup in a label');
  });

  t('themes: the ids of a drawing are its own: a piece drawn twice does not share a gradient', () => {
    const piece = '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g1)" stroke="url(#g1)"/>';
    eq(scopeIds(piece, 'x'), '<defs><linearGradient id="g1-x"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g1-x)" stroke="url(#g1-x)"/>');
    ok(freshScope() !== freshScope(), 'every call a new scope');
    eq(scopeIds('<path d="M0 0"/>', 'x'), '<path d="M0 0"/>', 'nothing to rename');
    const scoped = scopeIds(piece, freshScope());
    ok(cleanSvg(scoped) === scoped, 'a scoped piece is still clean');
  });

  t('themes: tokens are held to the contract: bounds, kinds, no url(), no way out of the rule', () => {
    const good = { '--bg': '#fff', '--r-2': '22px', '--ctl-h': '50px', '--shadow': '0 10px 28px rgba(1, 2, 3, 0.2)', '--bg-image': 'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0 2px, transparent 2px 9px)' };
    eq(cleanTokens(good).rejected, [], 'all fine');
    for (const [name, value] of [
      ['--ctl-h', '80px'], ['--ctl-h', '10px'], ['--r-2', '90px'], ['--bg', 'red; } body { display: none'], ['--bg', 'url(x.png)'],
      ['--bg-image', 'url(x.png)'], ['--bg', 'expression(1)'], ['--font-body', '"Evil Font", sans-serif'], ['--shadow', '0 0 0 url(x)'],
      ['--bg', '#12345'], ['--tt-head', 'blink'], ['Bg', '#fff'], ['--bg', ''], ['--bg', 'x'.repeat(400)],
    ]) eq(cleanTokens({ [name]: value }).rejected, [name], `${name}: ${value}`);
    eq(cleanTokens({ '--from-the-future': '#fff' }, { known: () => false }).ignored, ['--from-the-future'], 'an unknown token is ignored, not an error');
    eq(buildCss('candy', 'light', { '--bg': '#fff' }), ':root[data-theme="candy"]{color-scheme:light;--bg:#fff;}');
  });

  t('themes: a bundle is accepted whole or not at all, and rebuilt from the whitelists', () => {
    const b = cleanBundle(CANDY);
    eq([b.entry.id, b.entry.mode, b.entry.name.zh, b.css.startsWith(':root[data-theme="candy"]{color-scheme:light;')], ['candy', 'light', '主题', true]);
    ok(b.art.mark.startsWith('<svg') && b.art.icons.standard && b.art.board.grid === 'tiles');
    const bad = (why, raw) => eq(cleanBundle(raw), null, why);
    bad('a built-in id', { ...CANDY, id: 'dark' });
    bad('another api version', { ...CANDY, themeApi: 2 });
    bad('an out-of-bounds token rejects the bundle', { ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } });
    bad('a url in a token', { ...CANDY, tokens: { ...CANDY.tokens, '--bg-image': 'url(//evil/x.png)' } });
    bad('a required token missing', { ...CANDY, tokens: { '--bg': '#efe7ff', '--surface': '#fff', '--text': '#000' } });
    bad('the bar colour is the theme\'s --bg', { ...CANDY, meta: { ...CANDY.meta, chrome: '#000000' } });
    bad('not an id', { ...CANDY, id: 'a b' });
    bad('too big', { ...CANDY, art: { ...CANDY.art, junk: 'x'.repeat(210000) } });
    bad('not an object', 'candy');
    eq(cleanBundle({ ...CANDY, tokens: { ...CANDY.tokens, '--from-the-future': '#fff' } }, { known: n => n.startsWith('--r-') || ['--bg', '--surface', '--text', '--accent', '--ctl-h', '--font-body'].includes(n) }) !== null, true, 'unknown tokens are skipped');
    eq(cleanBundle({ ...CANDY, art: { mark: '<svg><script/></svg>', icons: { standard: '<script/>' } } }).art.mark, null, 'unusable art falls back, the bundle stays');
    const withFont = cleanBundle({ ...CANDY, tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", "Trebuchet MS", sans-serif' }, fonts: [{ family: 'Fredoka', weight: '400 700', data: woff2 }] });
    eq(withFont.fonts.map(f => f.family), ['Fredoka'], 'a shipped font is usable in a font token');
    eq(cleanBundle({ ...CANDY, tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", sans-serif' } }), null, 'a family that is not shipped is not');
    bad('a font that is not woff2', { ...CANDY, fonts: [{ family: 'Fredoka', weight: '400', data: Buffer.from('not a font').toString('base64') }] });
    bad('too many fonts', { ...CANDY, fonts: Array.from({ length: 4 }, () => ({ family: 'Fredoka', weight: '400', data: woff2 })) });
  });

  t('themes: art is rebuilt from the whitelist and the bounds, unusable parts fall back', () => {
    const art = cleanArt({
      mark: '<svg viewBox="0 0 96 96"><rect width="96" height="96" fill="#fff"/></svg>',
      icons: { standard: '<path d="M0 0"/>', cutout: '<script/>', nonsense: '<path d="M0 0"/>' },
      board: { grid: 'tiles', pathW: 0.3, wallW: 9, cap: 'evil', gradient: true },
    });
    eq(Object.keys(art.icons), ['standard'], 'a bad icon and an unknown id are dropped');
    eq([art.board.grid, art.board.pathW, art.board.wallW, art.board.cap, art.board.gradient], ['tiles', 0.3, CLASSIC_BOARD.wallW, 'round', true]);
    eq(cleanArt(null), null);
    eq(cleanLayout({ menu: 'bento', picker: 'carousel' }), { menu: 'bento', picker: 'tiles', actions: 'side' }, 'an unknown preset becomes the default');
  });

  t('themes: an entry is cleaned; built-ins are never taken from storage', () => {
    const base = entryOf(CANDY);
    for (const bad of [null, {}, { ...base, id: 'A b' }, { ...base, id: 'a"><x' }, { ...base, mode: 'blue' }, { ...base, chrome: 'red' }]) eq(cleanEntry(bad), null);
    const e = cleanEntry({ ...base, symbol: '<script/>', name: { en: '<b>x</b>' }, v: -4, layout: { menu: 'zzz' }, swatches: ['x'] });
    eq([e.symbol, e.name.en, e.v, e.layout.menu, e.swatches], ['', 'candy', 1, 'dashboard', null]);
    eq(cleanEntry({ ...BUILTIN[1], chrome: '#000000', symbol: '<circle cx="1" cy="1" r="1"/>' }), BUILTIN[1], 'built-in metadata is the app\'s');
  });

  t('themes: the pool starts as light and dark, migrates the old key, survives damage, and loses a theme cleanly', () => {
    const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
    eq(parseState(null).pool.map(e => e.id), ['light', 'dark']);
    eq([parseState(null, 'dark').active, parseState(null, 'light').active, parseState(null, 'x').active, parseState(null).active], ['dark', 'light', null, null]);
    eq(parseState('{{{', 'dark').active, 'dark', 'damaged storage: start again, keep the old choice');
    eq(parseState(JSON.stringify({ v: 1, pool: [candy] })).pool.map(e => e.id), ['light', 'dark'], 'another version is ignored');
    const st = withPool([BUILTIN[0], candy, candy, { id: 'BAD' }, BUILTIN[1]], 'candy', 3);
    eq(parseState(serialize(st)).pool.map(e => e.id), ['light', 'candy', 'dark'], 'invalid and duplicate entries are dropped');
    eq([parseState(JSON.stringify({ ...st, cap: 99 })).cap, parseState(JSON.stringify({ ...st, cap: 0 })).cap], [4, 2], 'cap stays in 2..4');
    eq(parseState(JSON.stringify({ ...st, cap: 2 })).pool.map(e => e.id), ['light', 'candy'], 'the pool is cut to the cap');
    eq(parseState(JSON.stringify({ ...st, active: 'gone' })).active, null, 'an active theme that is not in the pool is forgotten');
    const pool = withPool([candy, wood], null, 2);
    eq([activeEntry(pool, 'light').id, activeEntry(pool, 'dark').id], ['candy', 'wood']);
    eq(activeEntry(withPool([candy]), 'dark').id, 'candy', 'no theme of the system mode: the first');
    eq(activeEntry({ ...pool, active: 'wood' }, 'light').id, 'wood', 'a chosen theme wins');
    const lost = remove(withPool([BUILTIN[0], candy], 'candy', 2), 'candy');
    eq([lost.pool.map(e => e.id), lost.active], [['light', 'dark'], 'light'], 'a lost theme: the built-ins refill, the built-in of its mode takes over');
    eq(remove(withPool([candy, wood], 'wood', 2), 'wood').pool.map(e => e.id), ['candy', 'light'], 'the pool is never left with fewer than two');
    eq(remove(fresh(null), 'nope'), fresh(null), 'nothing to remove');
  });

  t('themes: select, cap, save and replace', () => {
    const candy = entryOf(CANDY);
    let st = fresh(null);
    eq(select(st, 'dark').active, 'dark');
    eq(select(st, 'candy'), st, 'only a theme of the pool can be selected');
    eq(save(st, candy), null, 'a full pool needs a theme to replace');
    eq(save(st, candy, 'nope'), null);
    eq(save(st, { id: 'x y' }, 'dark'), null, 'not a theme');
    const replaced = save(select(st, 'dark'), candy, 'dark');
    eq([replaced.pool.map(e => e.id), replaced.active], [['light', 'candy'], 'candy'], 'replacing the active theme hands over to the new one');
    eq(save(select(st, 'light'), candy, 'dark').active, 'light', 'replacing another theme keeps the active one');
    eq(save(replaced, candy), replaced, 'saving a theme the pool has changes nothing');
    st = setCap(st, 3);
    const three = save(st, candy);
    eq(three.pool.map(e => e.id), ['light', 'dark', 'candy'], 'room: it is added');
    eq(setCap(st, 9).cap, 4);
    eq(setCap(three, 2).pool.map(e => e.id), ['light', 'dark'], 'lowering the cap keeps the earliest themes');
    eq(setCap({ ...three, active: 'candy' }, 2).pool.map(e => e.id), ['light', 'candy'], 'and the active one');
    eq([nextEntry(fresh(null), 'light').id, nextEntry(fresh(null), 'dark').id, nextEntry(three, 'candy').id], ['dark', 'light', 'light']);
    eq([isClassicPool(fresh(null)), isClassicPool(three), isClassicPool(replaced)], [true, false, false]);
  });

  t('themes: the device store keeps what the player owns, and refuses what is damaged or tampered with', () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    const b = cleanBundle(CANDY);
    ok(store.save(b) && store.has('candy'), 'saved');
    eq(store.load('candy').css, b.css);
    eq(store.load('candy').art.board.grid, 'tiles');
    eq(store.load('wood'), null);
    for (const css of ['body{display:none}', ':root[data-theme="wood"]{--bg:#000;}', ':root[data-theme="candy"]{--bg:url(x);}', ':root[data-theme="candy"]{}</style><script>', ':root[data-theme="candy"]{--a:1;} body{x:1}']) {
      storage.data[BUNDLE_KEY('candy')] = JSON.stringify({ v: 3, css });
      eq(store.load('candy'), null, css);
    }
    storage.data[BUNDLE_KEY('candy')] = '{{{';
    eq(store.has('candy'), false, 'damaged');
    store.save(b);
    store.remove('candy');
    eq(store.has('candy'), false, 'removed');
    eq(createStore(memoryStorage({}, { quota: true })).save(b), false, 'a device that refuses: not kept');
  });

  t('themes: the manifest lists themes by metadata and hashed file names; what is not a theme is dropped; light and dark need no file', () => {
    const good = manifestOf([CANDY, WOOD], ['wood']);
    const forged = { ...good[0], id: 'dark', mode: 'light', chrome: '#ffffff', name: { en: 'Forged' }, f: 'x' };
    const list = cleanPool([...good, { ...good[0] }, { ...good[0], id: 'light', f: undefined }, forged, { ...good[0], id: 'sea', f: '../etc/passwd' }, { id: 'x' }, null, 'text']);
    eq(list.map(c => [c.entry.id, c.f, c.live]), [['candy', stem('candy'), true], ['wood', stem('wood'), false], ['light', null, true], ['dark', null, true]], 'a repeat, a bad file name and a non-theme are dropped; a built-in has no file');
    eq([list[2].entry, list[3].entry], BUILTIN, 'a built-in is the app\'s own copy, whatever the manifest says');
    eq([cleanPool({}), cleanPool(null), cleanPool([]).length], [null, null, 0]);
    eq(cleanPool(Array.from({ length: 80 }, (_, i) => ({ ...good[0], id: `t${i}`, f: stem(`t${i}`) }))).length, MAX_THEMES, 'bounded');
    ok(FILE_RE.test(stem('a')) && !FILE_RE.test('A'.repeat(24)) && !FILE_RE.test(`${stem('a')}0`) && !FILE_RE.test('../'.repeat(8)) && !FILE_RE.test('-'.repeat(24)), 'the shape of a file name');
  });

  ta('themes: the files are fetched by name from one folder: a malformed name makes no request, a missing or broken file is nothing', async () => {
    const f = stem('candy');
    const fetched = [];
    const files = {
      '../t/m.json': JSON.stringify(manifestOf([CANDY])), [`../t/${f}.json`]: JSON.stringify(CANDY), [`../t/${stem('x')}.json`]: 'not json', [`../t/${stem('y')}.json`]: 'x'.repeat(MAX_FILE + 1),
    };
    const source = createSource({ base: '../t/', pool: 'm.json', fetchText: async (url, kind) => { fetched.push([url, kind]); if (!(url in files)) throw new Error('404'); return files[url]; } });
    eq((await source.pool()).map(c => c.entry.id), ['candy'], 'the manifest');
    eq((await source.bundle(f)).id, 'candy', 'a name fetches its bundle');
    eq(fetched, [['../t/m.json', 'pool'], [`../t/${f}.json`, 'bundle']], 'one request each, to exactly that file');
    for (const bad of [undefined, '', 'short', '../x', `${f}.json`, f.toUpperCase(), `${f}0`]) eq(await source.bundle(bad), null, String(bad));
    eq(fetched.length, 2, 'a malformed name makes no request');
    eq([await source.bundle(stem('x')), await source.bundle(stem('y')), await source.bundle(stem('z'))], [null, null, null], 'not JSON, too big, not there');
    eq(await createSource({ base: '../t/', pool: 'm.json', fetchText: async () => 'x'.repeat(MAX_POOL + 1) }).pool(), null, 'a manifest too big');
    eq(await createSource({ base: '../t/', pool: 'm.json', fetchText: async () => '{"a":1}' }).pool(), null, 'not a manifest');

    const calls = [];
    const fetchFn = async (url, init) => { calls.push([url, init.cache, init.credentials]); return url.includes('gone') ? { ok: false, status: 404 } : { ok: true, headers: { get: () => '100' }, text: async () => JSON.stringify(url.endsWith('m.json') ? manifestOf([CANDY]) : CANDY) }; };
    const page = browserSource({ base: '../t/', pool: 'm.json' }, fetchFn);
    eq([(await page.pool()).length, (await page.bundle(f)).id], [1, 'candy']);
    eq(calls, [['../t/m.json', 'no-cache', 'omit'], [`../t/${f}.json`, 'default', 'omit']], 'the manifest is revalidated, a bundle (which never changes under its name) may be cached; no cookies');
    eq(await browserSource({ base: '../gone/', pool: 'm.json' }, fetchFn).pool(), null, 'a 404');
    const huge = kind => ({ ok: true, headers: { get: () => String((kind === 'pool' ? MAX_POOL : MAX_FILE) + 1) }, text: async () => '[]' });
    eq(await browserSource({ base: '../t/', pool: 'm.json' }, async () => huge('bundle')).bundle(f), null, 'a bundle too big by its header');
    eq(await browserSource({ base: '../t/', pool: 'm.json' }, async () => huge('pool')).pool(), null, 'a manifest too big by its header');
  });

  t('themes: the page\'s head script picks what pool.js picks, and paints a theme the player owns from the local copy', () => {
    const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
    const own = { [BUNDLE_KEY('candy')]: ownedRecord(CANDY), [BUNDLE_KEY('wood')]: ownedRecord(WOOD) };
    const states = {
      none: [{}, false], 'none, system dark': [{}, true],
      'old key dark': [{ [MODE_KEY]: 'dark' }, false], 'old key junk': [{ [MODE_KEY]: 'blue' }, true],
      'chosen candy': [{ [POOL_KEY]: serialize(withPool([BUILTIN[0], BUILTIN[1], candy], 'candy', 3)), ...own }, false],
      'follow system (dark)': [{ [POOL_KEY]: serialize(withPool([BUILTIN[0], wood, candy], null, 3)), ...own }, true],
      'follow system (light)': [{ [POOL_KEY]: serialize(withPool([wood, candy, BUILTIN[1]], null, 3)), ...own }, false],
      'no theme of the system mode': [{ [POOL_KEY]: serialize(withPool([candy, BUILTIN[0]], null, 2)), ...own }, true],
      'built-ins replaced': [{ [POOL_KEY]: serialize(withPool([candy, wood], null, 2)), ...own }, true],
      'a tampered id': [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 3, active: 'x"><b', pool: [{ ...candy, id: 'x"><b' }, BUILTIN[0], BUILTIN[1]] }) }, true],
      duplicates: [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 2, active: null, pool: [BUILTIN[0], BUILTIN[0], BUILTIN[1]] }) }, true],
      'cut to the cap': [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 2, active: 'wood', pool: [BUILTIN[0], BUILTIN[1], wood] }), ...own }, false],
      damaged: [{ [POOL_KEY]: 'not json', [MODE_KEY]: 'dark' }, false],
      'another version': [{ [POOL_KEY]: JSON.stringify({ v: 1, pool: [candy] }) }, true],
    };
    for (const [name, [storage, dark]] of Object.entries(states)) {
      const want = activeEntry(parseState(storage[POOL_KEY], storage[MODE_KEY]), dark ? 'dark' : 'light');
      const got = runBoot({ storage, dark });
      eq([got.dataset.theme, got.dataset.mode], [want.id, want.mode], name);
      eq(got.meta.color, want.chrome, `${name}: the browser bar`);
      eq(got.appended.length, want.builtin ? 0 : 1, `${name}: a token block only for a theme the player owns`);
      if (!want.builtin) eq([got.appended[0].id, got.appended[0].textContent], ['theme-css', cleanBundle(want.id === 'candy' ? CANDY : WOOD).css], `${name}: painted from the local copy`);
    }
    const chosen = states['chosen candy'][0];
    const lost = { ...chosen };
    delete lost[BUNDLE_KEY('candy')];
    eq([runBoot({ storage: lost }).dataset.theme, runBoot({ storage: lost }).appended.length], ['light', 0], 'a theme whose copy is gone shows as the built-in of its mode');
    eq(runBoot({ storage: { ...chosen, [BUNDLE_KEY('candy')]: JSON.stringify({ css: ':root[data-theme="candy"]{--a:url(x);}' }) } }).dataset.theme, 'light', 'a tampered copy too');
    eq(runBoot({ storage: { ...chosen, [BUNDLE_KEY('candy')]: JSON.stringify({ css: ':root[data-theme="candy"]{}</style><script>x</script>' }) } }).appended.length, 0);
    eq(runBoot({ storage: chosen }).dataset.menu, 'dashboard');
  });

  t('themes: index.html pins its head script in the CSP; the page loads nothing from the network for a theme', () => {
    const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)[1];
    ok(INDEX.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`), 'the CSP hash is the script\'s');
    ok(!/document\.write|fetch\(|XMLHttpRequest|\.\.\/themes/.test(script), 'no request: the script only reads the device');
    ok(!INDEX.includes('Zip'), 'the brand is zigzag');
  });

  t('themes: applyEntry sets the attributes, the token block, the bar colour and the brand mark, and tells the page', () => {
    const attrs = {};
    const els = {};
    const holder = { classList: { toggle: (c, on) => { attrs.hasArt = on; } }, querySelector: () => null, append: n => { attrs.mark = n.innerHTML; } };
    const events = [];
    const doc = {
      documentElement: { dataset: attrs },
      head: { append: el => { els['theme-css'] = el; el.remove = () => { delete els['theme-css']; }; } },
      querySelector: () => ({ setAttribute: (k, v) => { attrs.chrome = v; } }),
      getElementById: id => (id === 'brandMark' ? holder : els[id] ?? null),
      createElement: () => ({ setAttribute() {} }),
      dispatchEvent: e => events.push(e),
    };
    const candy = cleanBundle(CANDY);
    applyEntry({ ...candy.entry, layout: { menu: 'bento', picker: 'tiles', actions: 'bar' } }, { css: candy.css, art: { mark: '<svg/>' } }, doc);
    eq([attrs.theme, attrs.mode, attrs.menu, attrs.picker, attrs.actions, attrs.chrome, attrs.hasArt, attrs.mark], ['candy', 'light', 'bento', 'tiles', 'bar', '#efe7ff', true, '<svg/>']);
    eq(els['theme-css'].textContent, candy.css);
    eq([events[0].type, events[0].detail.id, events[0].detail.mode], ['zip-theme', 'candy', 'light']);
    applyEntry(BUILTIN[1], null, doc);
    eq([attrs.theme, attrs.mode, attrs.hasArt, 'theme-css' in els], ['dark', 'dark', false, false], 'a built-in takes the token block away');
  });

  t('themes: fonts are registered from binary data and released with the theme', () => {
    const added = [];
    const set = { add: f => added.push(f), delete: f => added.splice(added.indexOf(f), 1) };
    class FakeFace { constructor(family, data, opts) { Object.assign(this, { family, size: data.length, opts }); } load() { return Promise.resolve(); } }
    const handle = loadFonts([{ family: 'Fredoka', weight: '400 700', data: woff2 }], { FontFace: FakeFace, set });
    eq([added.length, added[0].family, added[0].size, added[0].opts.display], [1, 'Fredoka', 8, 'swap']);
    handle.release();
    eq(added.length, 0);
    eq(typeof loadFonts([{ family: 'F', weight: '400', data: woff2 }], {}).release, 'function', 'no FontFace API: nothing to do');
  });

  t('themes: variant icons come from the theme on screen, with the classic icon for what it does not draw', () => {
    const classic = variantIcon('cutout');
    ok(classic.includes('class="variant-icon vi-cutout"') && classic.includes('vi-bg'), 'no theme: the classic icon');
    setArt(cleanArt({ icons: { standard: '<path d="M1 1"/>', cutout: '<path d="M2 2"/>' }, board: {} }));
    try {
      eq(variantIcon('cutout'), '<svg class="variant-icon vi-cutout" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M2 2"/></svg>');
      eq(variantIcon('anything-else').includes('<path d="M1 1"/>'), true, 'an unknown variant is the standard one');
      eq(variantIcon('lucky').includes('vi-q'), true, 'lucky is not drawn by this theme: the classic icon');
      eq(variantIcon('cube').includes('vi-cube'), true, 'so are the solids');
    } finally { setArt(null); }
    eq(variantIcon('cutout'), classic, 'back to the classic icon');
    // an icon with a gradient: every drawing of it has ids of its own (it may be on the page twice, once of them hidden)
    setArt(cleanArt({ icons: { standard: '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="8" height="8" fill="url(#g1)"/>' }, board: {} }));
    try {
      const [one, two] = [variantIcon('standard'), variantIcon('standard')];
      const idOf = svg => /id="(g1-[^"]+)"/.exec(svg)?.[1];
      ok(idOf(one) && idOf(two) && idOf(one) !== idOf(two), 'two drawings, two ids');
      ok(one.includes(`fill="url(#${idOf(one)})"`) && two.includes(`fill="url(#${idOf(two)})"`), 'each refers to its own');
    } finally { setArt(null); }
  });

  t('themes: the board is drawn in the theme\'s skin; the classic skin is what the game always drew; the svg\'s box never changes', () => {
    const puzzle = makePuzzle(3);
    puzzle.cp[0] = 1; puzzle.cp[8] = 2;
    const S = { puzzle, path: [0, 1], hintCell: null, hintWrongCell: null };
    const classic = boardSvg(S);
    ok(classic.includes('stroke-width="1.5"') && classic.includes('stroke-width="6" stroke-linecap="round"') && classic.includes('stroke-width="16.8"') && classic.includes('r="19.2"') && classic.includes('stroke-width="3"'), 'the classic numbers');
    ok(!classic.includes('skin-tiles') && !classic.includes('url(#zip-path)') && !classic.includes('num-shape'));
    const skin = { grid: 'tiles', tileRx: 0.2, tileInset: 0.05, tileEdgeW: 0.02, depth: 0.03, plateRx: 0.15, pathW: 0.2, cap: 'square', join: 'miter', gradient: true, wallW: 0.12, wallCap: 'butt', num: 'square', numR: 0.25, numRingW: 0, solid: 'light' };
    setArt(cleanArt({ board: skin }));
    try {
      const themed = boardSvg(S);
      eq(themed.match(/viewBox="[^"]*"/)[0], classic.match(/viewBox="[^"]*"/)[0], 'same viewBox: the pointer maps through the same box');
      ok(themed.includes('class="zip-svg skin-tiles"') && themed.includes('<g data-skin="tiles">'), 'tiles skin');
      eq([(themed.match(/fill="var\(--b-bg\)"/g) || []).length, (themed.match(/fill="var\(--b-depth\)"/g) || []).length], [9, 9], 'nine tiles, nine lower edges');
      ok(themed.includes(`<rect width="180" height="180" rx="9" fill="${COLORS.stage}"/>`), 'the plate');
      ok(themed.includes('stroke="url(#zip-path)"') && themed.includes('<linearGradient id="zip-path" gradientUnits="userSpaceOnUse"'), 'the path gradient is in the board\'s own defs');
      ok(themed.includes('stroke-width="12" fill="none" stroke-linecap="square" stroke-linejoin="miter"'), 'path width, cap, join');
      ok(themed.includes('stroke-width="7.2" stroke-linecap="butt"'), 'wall width and cap');
      ok(themed.includes('<rect class="num-shape"') && themed.includes('width="30"') && themed.includes('stroke-width="0"'), 'square numbers, no ring');
      eq(solidIsDark({ documentElement: { dataset: { mode: 'dark' } } }), false, 'the theme names the light 3D palette on a dark page');
    } finally { setArt(null); }
    eq(boardSvg(S), classic, 'back to the classic board, byte for byte');
    eq(solidIsDark({ documentElement: { dataset: { mode: 'dark' } } }), true, 'no theme: the page\'s mode');
    eq(currentArt(), null);
    eq(cleanArt({ board: { solid: 'purple' } }).board.solid, undefined, 'only light or dark');
  });

  t('themes: portals are drawn in tokens (the Design app keeps its hex), the defaults being the same colours', () => {
    eq(portalColorVar(0), 'var(--portal-1)');
    eq(portalColorVar(6), 'var(--portal-1)', 'wraps round');
    const css = readFileSync(new URL('../css/theme.css', import.meta.url), 'utf8');
    PORTAL_COLORS.forEach((hex, i) => ok(css.includes(`--portal-${i + 1}: ${hex};`), `--portal-${i + 1} defaults to ${hex}`));
  });

  t('themes: layouts.css has a block for every preset except the defaults (which are play.css), and only tokens', () => {
    const css = readFileSync(new URL('../css/layouts.css', import.meta.url), 'utf8');
    const theme = readFileSync(new URL('../css/theme.css', import.meta.url), 'utf8');
    for (const [axis, keys] of Object.entries(PRESETS)) {
      for (const key of keys) {
        const has = css.includes(`:root[data-${axis}="${key}"]`);
        eq(has, key !== DEFAULT_LAYOUT[axis], `${axis}=${key}: ${key === DEFAULT_LAYOUT[axis] ? 'the default has no rule (it is play.css)' : 'a preset needs a block'}`);
      }
    }
    for (const attr of css.matchAll(/data-(\w+)="([\w-]+)"/g)) ok(PRESETS[attr[1]]?.includes(attr[2]), `unknown preset ${attr[0]}`);
    ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'colour literals: use tokens');
    const local = new Set(['--tile', '--tile-on', '--tile-counter']);
    ok(!/(--ic-[12]):[^;]*var\(\1/.test(css), 'a custom property must not refer to itself');
    for (const m of css.matchAll(/var\((--[\w-]+)/g)) ok(local.has(m[1]) || theme.includes(`${m[1]}:`), `${m[1]} is not defined in theme.css`);
    ok(INDEX.includes('<link rel="stylesheet" href="css/layouts.css">') && INDEX.indexOf('css/play.css') < INDEX.indexOf('css/layouts.css'), 'index.html loads it after play.css');
  });

  t('themes: the pool picker lists the pool in order, marks the current theme, and escapes what it shows', () => {
    const [candy, wood] = [entryOf(CANDY), entryOf(WOOD)];
    const st = withPool([BUILTIN[0], candy, wood], null, 3);
    const items = pickerItems(st, 'candy', 'zh');
    eq(items.map(i => [i.id, i.name, i.current]), [['light', '浅色', false], ['candy', '主题', true], ['wood', '主题', false]]);
    eq(pickerItems(st, 'wood', 'xx').map(i => i.name), ['Light', 'CANDY', 'WOOD'], 'an unknown language: English');
    const html = pickerHtml(items, 'Choose a theme');
    ok(html.includes('data-theme-id="candy"') && html.includes('aria-checked="true"') && html.includes('role="menuitemradio"') && html.includes('class="current"'));
    eq((html.match(/<button /g) || []).length, 3);
    const hostile = pickerHtml([{ id: 'x"><script>', name: '<img src=x onerror=alert(1)>', symbol: SYMBOL, swatches: ['#fff"><i'], current: false }], '<b>t</b>');
    ok(!hostile.includes('<img') && !hostile.includes('<script>') && !hostile.includes('<b>'), 'no tag of theirs');
    ok(['&lt;img src=x onerror=alert(1)&gt;', 'x&quot;&gt;&lt;script&gt;', '&lt;b&gt;t&lt;/b&gt;', '#fff&quot;&gt;&lt;i'].every(piece => hostile.includes(piece)), 'shown as text');
  });

  ta('themes: the controller shows, steps, persists, follows the system, and shows what the player owns without any network', async () => {
    let r = rig();
    r.ctl.start();
    eq([r.applied, r.ctl.isClassic(), r.ctl.current().id], [['light'], true, 'light']);
    r.ctl.next();
    eq([r.applied, r.ctl.current().id, r.storage.data[MODE_KEY], JSON.parse(r.storage.data[POOL_KEY]).active], [['light', 'dark'], 'dark', 'dark', 'dark'], 'a step is a choice: kept, mirrored for the stats page');

    r = rig({ dark: false });
    r.ctl.start();
    r.media.matches = true;
    r.listeners.forEach(fn => fn());
    eq([r.ctl.current().id, MODE_KEY in r.storage.data], ['dark', false], 'until the player chooses, the system setting leads (and nothing is saved)');
    r.ctl.select('light');
    r.listeners.forEach(fn => fn());
    eq(r.ctl.current().id, 'light', 'after a choice the system no longer matters');

    r = rig({ stored: withPool([BUILTIN[0], BUILTIN[1], entryOf(CANDY)], 'candy', 3), owned: [CANDY] });
    r.ctl.start();
    eq([r.applied, r.ctl.isClassic(), r.ctl.art().mark.startsWith('<svg'), r.ctl.upcoming().id], [['candy+css'], false, true, 'light'], 'from the device copy');

    r = rig({ stored: withPool([BUILTIN[0], BUILTIN[1], entryOf(WOOD)], 'wood', 3) });   // no copy on this device
    r.ctl.start();
    eq([r.applied, r.ctl.current().id, r.ctl.state().pool.map(e => e.id), r.ctl.state().active], [['dark'], 'dark', ['light', 'dark'], 'dark'], 'a theme whose copy is gone leaves the pool; the built-in of its mode shows');
    eq(JSON.parse(r.storage.data[POOL_KEY]).pool.length, 2, 'and that is stored');
  });

  ta('themes: a theme on trial is taken (kept on the device and in the pool) or left (gone, nothing kept)', async () => {
    const r = rig();
    r.ctl.start();
    eq(r.ctl.trial({ ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } }), null, 'an invalid bundle is not shown');
    eq(r.ctl.trial(CANDY, { until: 500 }), null, 'an event that is over is not shown');
    const trial = r.ctl.trial(CANDY, { until: 5000 });
    eq([r.ctl.current().id, r.applied.at(-1), r.ctl.state().pool.length, r.timeouts.length, r.timeouts[0].ms], ['candy', 'candy+css', 2, 1, 4000], 'shown, with a timer for the end of the event');
    eq([r.storage.data[BUNDLE_KEY('candy')], POOL_KEY in r.storage.data], [undefined, false], 'nothing is kept while it is on trial');
    trial.revert();
    eq([r.ctl.current().id, r.cleared.length, BUNDLE_KEY('candy') in r.storage.data], ['light', 1, false], 'left: the previous theme is back, the timer is off, nothing was ever kept');

    const again = r.ctl.trial(CANDY);
    eq(await again.commit(), false, 'a full pool needs a theme to replace');
    eq([BUNDLE_KEY('candy') in r.storage.data, r.ctl.state().pool.length], [false, 2], 'and nothing was kept');
    eq(await again.commit('dark'), true);
    eq([r.ctl.state().pool.map(e => e.id), r.ctl.state().active, r.ctl.current().id, BUNDLE_KEY('candy') in r.storage.data], [['light', 'candy'], 'candy', 'candy', true]);
    eq(await again.commit('dark'), false, 'an offer is taken once');

    const second = r.ctl.trial(WOOD);
    await second.commit('candy');
    eq([r.ctl.state().pool.map(e => e.id), BUNDLE_KEY('candy') in r.storage.data, BUNDLE_KEY('wood') in r.storage.data], [['light', 'wood'], false, true], 'a replaced theme is gone from the device');

    r.ctl.setCap(4);
    ok(r.ctl.install(bundle('sea')) && r.ctl.install(bundle('sky')), 'awards raise the cap, a theme is installed without replacing');
    eq(r.ctl.state().pool.length, 4);
    r.ctl.setCap(2);
    eq([r.ctl.state().pool.length, Object.keys(r.storage.data).filter(k => k.startsWith('zip_theme_b_')).length], [2, r.ctl.state().pool.filter(e => !e.builtin).length], 'lowering the cap removes the cut themes from the device too');

    const quota = rig({ quota: true });
    quota.ctl.start();
    eq(await quota.ctl.trial(CANDY).commit('dark'), false, 'a device that refuses the copy: nothing changes');
    eq(quota.ctl.state().pool.map(e => e.id), ['light', 'dark']);
  });

  ta('themes: a trial ends by itself when its event does, and a choice ends it too', async () => {
    const r = rig();
    r.ctl.start();
    const trial = r.ctl.trial(CANDY, { until: 5000 });
    r.timeouts[0].fn();   // the end of the event
    eq(r.ctl.current().id, 'light', 'gone after the event');
    eq(await trial.commit('dark'), false, 'and it can no longer be taken');
    r.ctl.trial(WOOD);
    r.ctl.select('dark');
    eq(r.ctl.current().id, 'dark', 'choosing a theme of the pool ends a trial');
    r.ctl.trial(WOOD);
    r.listeners.forEach(fn => fn());
    eq(r.ctl.current().id, 'wood', 'the system setting does not interrupt a trial');
    const fonts = rig();
    fonts.ctl.start();
    fonts.ctl.trial({ ...CANDY, tokens: { ...CANDY.tokens, '--font-body': '"Fredoka", sans-serif' }, fonts: [{ family: 'Fredoka', weight: '400', data: woff2 }] }).revert();
    eq(fonts.fontLoads, [1, 'released'], 'fonts are registered for the trial and released when it ends');
  });

  t('themes: the offer is picked by device and event: stable, spread out, in a ring', () => {
    const cands = poolOf([CANDY, WOOD, bundle('sea'), bundle('sky')]);
    const seed = newSeed(steady());
    ok(/^[0-9a-f]{16}$/.test(seed), 'a device seed');
    eq(hash('a'), hash('a'));
    ok(hash('a') !== hash('b') && hash('') === 0x811c9dc5, 'FNV-1a');
    const ids = (list, s = seed, e = 'e1') => offerOrder(list, s, e).map(c => c.entry.id);
    eq(ids(cands), ids([...cands].reverse()), 'the order of the manifest does not matter');
    eq([...ids(cands)].sort(), ['candy', 'sea', 'sky', 'wood'], 'every theme comes up, once');
    const sorted = ['candy', 'sea', 'sky', 'wood'];
    const first = ids(cands);
    eq([...sorted.slice(sorted.indexOf(first[0])), ...sorted.slice(0, sorted.indexOf(first[0]))], first, 'a ring: the next one is the fall-back');
    ok(new Set(Array.from({ length: 12 }, (_, i) => ids(cands, seed, `ev${i}`)[0])).size > 1, 'events differ');
    ok(new Set(Array.from({ length: 12 }, (_, i) => ids(cands, `${i}`.padStart(16, '0'), 'e1')[0])).size > 1, 'devices differ');
    eq(offerOrder([], seed, 'e1'), []);
  });

  ta('themes: an event offers one theme of the pool: the same within the event on this device, never an owned theme or a draft, answered once', async () => {
    const SEA = bundle('sea');
    const SKY = bundle('sky');
    const all = [CANDY, WOOD, SEA, SKY];
    const site = { files: filesOf(all), pool: poolOf(all, ['sky']) };

    const r = rig(site);
    r.ctl.start();
    const first = await r.ctl.event({ id: 'spring', until: 5000 });
    ok(first && ['candy', 'wood', 'sea'].includes(first.entry.id), 'one of the live themes, never the draft');
    eq([r.ctl.current().id, r.ctl.state().pool.length, SEED_KEY in r.storage.data, r.timeouts[0].ms, EVENT_KEY in r.storage.data], [first.entry.id, 2, true, 4000, false], 'on trial until the event ends, nothing kept, not answered yet');
    const reload = rig({ ...site, storage: r.storage });
    reload.ctl.start();
    eq((await reload.ctl.event({ id: 'spring', until: 5000 })).entry.id, first.entry.id, 'a reload within the event shows the same theme');
    first.revert();
    eq([r.ctl.current().id, r.storage.data[EVENT_KEY], await r.ctl.event({ id: 'spring', until: 5000 })], ['light', 'spring', null], 'left: the event is answered and the theme is gone');
    const summer = await r.ctl.event({ id: 'summer', until: 5000 });
    ok(summer, 'another event, another offer');
    eq(await summer.commit(), false, 'a full pool needs a theme to replace');
    eq(r.storage.data[EVENT_KEY], 'spring', 'and that does not answer the event');
    eq(await summer.commit('dark'), true);
    eq([r.ctl.owns(summer.entry.id), r.ctl.current().id, r.storage.data[EVENT_KEY], await r.ctl.event({ id: 'summer' })], [true, summer.entry.id, 'summer', null], 'taken: kept, answered');

    const roomy = rig({ ...site, stored: withPool([BUILTIN[0]], null, 4) });
    roomy.ctl.start();
    const got = [];
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      const offer = await roomy.ctl.event({ id });
      if (offer) await offer.commit();
      got.push(offer ? offer.entry.id : null);
    }
    eq([got.slice(0, 3).sort(), got[3]], [['candy', 'sea', 'wood'], null], 'what the player owns is not offered again; with only a draft left there is no offer');

    const calls = rig(site);
    calls.ctl.start();
    for (const bad of [undefined, {}, { id: '' }, { id: 'a b' }, { id: 'x'.repeat(41) }, { id: '../x' }]) eq(await calls.ctl.event(bad), null, JSON.stringify(bad));
    eq(await calls.ctl.event({ id: 'late', until: 500 }), null, 'an event that is over');
    eq(calls.calls, [], 'and none of those asked the network');

    eq(await rig({ files: site.files, pool: null }).ctl.event({ id: 'e' }), null, 'the pool is not reachable');
    eq(await rig({ files: site.files, pool: [] }).ctl.event({ id: 'e' }), null, 'the pool is empty');
    eq((await rig({ files: { [stem('wood')]: WOOD }, pool: poolOf([CANDY, WOOD, SEA]) }).ctl.event({ id: 'e' })).entry.id, 'wood', 'a missing file: the next theme is tried');
    eq(await rig({ files: { [stem('candy')]: WOOD }, pool: poolOf([CANDY]) }).ctl.event({ id: 'e' }), null, 'a file that is not the theme the manifest names');
    const bad = { ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } };
    eq(await rig({ files: { [stem('candy')]: bad }, pool: poolOf([CANDY]) }).ctl.event({ id: 'e' }), null, 'a bundle the game refuses');
    const many = rig({ files: {}, pool: poolOf([CANDY, WOOD, SEA, SKY]) });
    await many.ctl.event({ id: 'e' });
    eq(many.calls.length, 1 + 3, 'one read of the pool, and at most three files before there is no offer');
  });

  ta('themes: light and dark are in the pool like any other theme: listed, offered again, tried and kept with no file', async () => {
    const BUILTIN_POOL = BUILTIN.map(b => ({ entry: b, f: null, live: true }));
    const site = { files: filesOf([CANDY, WOOD]), pool: [...BUILTIN_POOL, ...poolOf([CANDY, WOOD])] };
    const away = { ...site, stored: withPool([entryOf(CANDY), entryOf(WOOD)], null, 2), owned: [CANDY, WOOD] };   // a player who replaced both

    const r = rig(away);
    r.ctl.start();
    eq((await r.ctl.pool()).map(c => [c.entry.id, c.f, c.owned]), [['light', null, false], ['dark', null, false], ['candy', stem('candy'), true], ['wood', stem('wood'), true]], 'the dev reveal lists them, not owned');
    const offer = await r.ctl.event({ id: 'autumn', until: 5000 });
    ok(offer && BUILTIN_IDS.includes(offer.entry.id), 'the only themes this player does not own are light and dark: one is offered');
    eq([r.calls.filter(c => c !== 'pool'), r.ctl.current().id, r.applied[r.applied.length - 1]], [[], offer.entry.id, offer.entry.id], 'on trial with no file fetched, drawn from the app\'s own css');
    eq(await offer.commit(), false, 'a full pool needs a theme to replace');
    eq(await offer.commit('wood'), true);
    eq([r.ctl.state().pool.map(e => e.id), r.ctl.state().active, r.storage.data[EVENT_KEY]], [['candy', offer.entry.id], offer.entry.id, 'autumn'], 'taken: in the pool again, answered');
    eq([BUNDLE_KEY(offer.entry.id) in r.storage.data, BUNDLE_KEY('wood') in r.storage.data], [false, false], 'a built-in has no copy on the device, and the replaced theme\'s copy is gone');
    eq((await rig({ ...away, storage: r.storage }).ctl.event({ id: 'autumn', until: 5000 })), null, 'an answered event is not offered again');

    const left = await rig(away).ctl.event({ id: 'winter', until: 5000 });
    left.revert();
    eq([left.entry.id === 'light' || left.entry.id === 'dark', left.entry.builtin], [true, true], 'a built-in offer can be left like any other');

    const d = rig(away);
    d.ctl.start();
    await d.ctl.tryPool('dark');
    eq([d.ctl.current().id, d.ctl.state().pool.length, d.timeouts.length], ['dark', 2, 0], 'the dev reveal tries dark: shown, nothing kept');
    eq(await d.ctl.keepPool('light'), true);
    eq([d.ctl.state().pool.map(e => e.id), d.ctl.current().id], [['candy', 'light'], 'light'], 'kept: it takes the place of one of the player\'s own, not the one showing');
    eq([await d.ctl.keepPool('light'), d.ctl.owns('light')], [false, true], 'owned already');
  });

  const HOUR = 3600000;
  const site = bundles => ({ files: filesOf(bundles), pool: poolOf(bundles) });

  ta('themes: an offer waits as a chip, a tap starts the trial, only seen time counts, the time up leaves a last question, keeping takes the theme', async () => {
    const clock = { t: 1000000 };
    const until = clock.t + 10 * HOUR;
    const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
    r.ctl.start();
    const before = r.applied.length;
    eq(await r.ctl.offer({ id: 'e1', until }), true);
    const v = r.ctl.offerView();
    const id = v.entry.id;
    eq([v.phase, v.left, v.until, v.trialMs, r.applied.length, OFFER_KEY in r.storage.data], ['pending', 60000, until, 60000, before, true], 'it waits: the page does not wear it, the record is on the device');
    eq([r.ctl.startOffer(), r.applied[r.applied.length - 1], r.ctl.offerView().phase, r.timeouts[r.timeouts.length - 1].ms], [true, `${id}+css`, 'trial', 60000], 'a tap starts it: on the page, the clock runs');
    clock.t += 20000;
    r.ctl.focus(false);
    eq(r.ctl.offerView().left, 40000, 'the time seen is counted');
    clock.t += 5 * HOUR;
    eq([r.ctl.offerView().left, r.ctl.offerView().phase], [40000, 'trial'], 'hidden: it waits');
    r.ctl.focus(true);
    eq([r.ctl.offerView().left, r.timeouts[r.timeouts.length - 1].ms], [40000, 40000], 'seen again: the rest runs');
    clock.t += 10000;
    r.ctl.holdOffer(true);
    clock.t += HOUR;
    eq(r.ctl.offerView().left, 30000, 'a choice is being made: the clock waits');
    r.ctl.holdOffer(false);
    clock.t += 30000;
    r.timeouts[r.timeouts.length - 1].fn();
    const f = r.ctl.offerView();
    eq([f.phase, f.left, r.applied[r.applied.length - 1], f.until >= clock.t + FINAL_MS], ['final', 0, 'light', true], 'time up: the theme leaves the page, the question stays');
    eq(JSON.parse(r.storage.data[OFFER_KEY]).phase, 'final');
    eq(await r.ctl.keepOffer(), false, 'the pool is full: a theme to replace is needed');
    eq(await r.ctl.keepOffer('dark'), true);
    eq([r.ctl.state().pool.map(e => e.id), r.ctl.state().active, BUNDLE_KEY(id) in r.storage.data, OFFER_KEY in r.storage.data, r.storage.data[EVENT_KEY], r.ctl.offerView(), r.applied[r.applied.length - 1]],
      [['light', id], id, true, false, 'e1', null, `${id}+css`], 'kept: in the pool and active, the offer answered and gone');
  });

  ta('themes: the trial never ends in the middle of a puzzle; it waits for a menu screen', async () => {
    const clock = { t: 1000000 };
    let busy = true;
    const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000, idle: () => !busy });
    r.ctl.start();
    await r.ctl.offer({ id: 'e1', until: clock.t + HOUR });
    r.ctl.startOffer();
    clock.t += 60000;
    r.timeouts[r.timeouts.length - 1].fn();
    eq([r.ctl.offerView().phase, r.timeouts[r.timeouts.length - 1].ms], ['trial', 1000], 'still on trial, asking again in a second');
    busy = false;
    r.timeouts[r.timeouts.length - 1].fn();
    eq(r.ctl.offerView().phase, 'final');
  });

  ta('themes: a reload keeps the offer: the trial resumes with its time left, painted by the page before the first frame; the day ending takes a waiting offer', async () => {
    const clock = { t: 1000000 };
    const first = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
    first.ctl.start();
    await first.ctl.offer({ id: 'e1', until: clock.t + HOUR });
    first.ctl.startOffer();
    const id = first.ctl.offerView().entry.id;
    clock.t += 10000;
    first.ctl.focus(false);   // the tab goes: saved
    const boot = runBoot({ storage: first.storage.data });
    eq([boot.dataset.theme, boot.appended.length], [id, 1], 'the head script paints the trial theme');
    const second = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000, storage: first.storage });
    second.ctl.start();
    eq([second.ctl.offerView().phase, second.ctl.offerView().left, second.applied[second.applied.length - 1], second.timeouts[second.timeouts.length - 1].ms], ['trial', 50000, `${id}+css`, 50000]);
    eq(await second.ctl.offer({ id: 'e1' }), true, 'the same event again finds the offer');
    eq(await second.ctl.offer({ id: 'e2' }), false, 'one offer at a time');
    // a waiting offer: gone when its day ends, and answered
    const w = rig({ clock, ...site([CANDY, WOOD]) });
    w.ctl.start();
    await w.ctl.offer({ id: 'e5', until: clock.t + HOUR });
    eq(runBoot({ storage: w.storage.data }).appended.length, 0, 'a waiting offer is not on the page');
    clock.t += HOUR + 5;
    w.timeouts[w.timeouts.length - 1].fn();
    eq([w.ctl.offerView(), w.storage.data[EVENT_KEY], OFFER_KEY in w.storage.data, await w.ctl.offer({ id: 'e5' })], [null, 'e5', false, false]);
    ok(await w.ctl.offer({ id: 'e6', until: clock.t + HOUR }), 'the next event offers again');
    // no end given: the end of the local day
    const d = rig({ clock, ...site([CANDY, WOOD]) });
    await d.ctl.offer({ id: 'e7' });
    eq(d.ctl.offerView().until, endOfDay(clock.t));
  });

  ta('themes: a trial interrupted by another choice waits with its time left; leaving answers the event; a built-in can be the offer', async () => {
    const clock = { t: 1000000 };
    const r = rig({ clock, ...site([CANDY, WOOD]), trialMs: 60000 });
    r.ctl.start();
    await r.ctl.offer({ id: 'e1', until: clock.t + 5 * HOUR });
    r.ctl.startOffer();
    clock.t += 15000;
    r.ctl.select('dark');
    const v = r.ctl.offerView();
    eq([v.phase, v.left, r.applied[r.applied.length - 1]], ['pending', 45000, 'dark'], 'the chosen theme shows; the trial waits');
    r.ctl.startOffer();
    eq(r.ctl.offerView().left, 45000);
    r.ctl.leaveOffer();
    eq([r.ctl.offerView(), r.storage.data[EVENT_KEY], r.applied[r.applied.length - 1]], [null, 'e1', 'dark'], 'left: answered, the active theme is back');
    // a player who replaced both built-ins is offered one of them
    const BUILTIN_POOL = BUILTIN.map(b => ({ entry: b, f: null, live: true }));
    const away = rig({ stored: withPool([entryOf(CANDY), entryOf(WOOD)], null, 2), owned: [CANDY, WOOD], pool: BUILTIN_POOL, files: {}, clock });
    away.ctl.start();
    ok(await away.ctl.offer({ id: 'e9', until: clock.t + HOUR }));
    const id = away.ctl.offerView().entry.id;
    ok(BUILTIN_IDS.includes(id));
    away.ctl.startOffer();
    eq(await away.ctl.keepOffer('wood'), true);
    eq([away.ctl.state().pool.map(e => e.id), BUNDLE_KEY(id) in away.storage.data, away.calls.filter(c => c !== 'pool')], [['candy', id], false, []], 'taken without a copy or a fetch');
  });

  t('themes: the slots follow the activity: 2, +1 at 12 Game-of-Day solves, +1 at a best streak of 30 days, 4 at most, never lowered', () => {
    eq([SLOT_GOTD_SOLVES, SLOT_STREAK_DAYS], [12, 30]);
    eq([{}, { gotdSolves: 11, bestStreak: 29 }, { gotdSolves: 12 }, { bestStreak: 30 }, { gotdSolves: 12, bestStreak: 30 }, { gotdSolves: 999, bestStreak: 999 }, { gotdSolves: NaN, bestStreak: undefined }, undefined].map(slotsFor), [2, 2, 3, 3, 4, 4, 2, 2]);
    const r = rig();
    r.ctl.start();
    let changes = 0;
    r.ctl.onChange(() => { changes++; });
    eq([r.ctl.awardSlots({ gotdSolves: 11 }), r.ctl.state().cap, changes], [false, 2, 0]);
    eq([r.ctl.awardSlots({ gotdSolves: 12 }), r.ctl.state().cap], [true, 3]);
    eq([r.ctl.awardSlots({ gotdSolves: 12, bestStreak: 30 }), r.ctl.state().cap, JSON.parse(r.storage.data[POOL_KEY]).cap], [true, 4, 4], 'kept on the device');
    eq([r.ctl.awardSlots({ gotdSolves: 99, bestStreak: 99 }), r.ctl.awardSlots({}), r.ctl.state().cap], [false, false, 4], 'never lowered, never above four');
  });

  t('themes: the offer record is rebuilt from the whitelists, whatever the device holds', () => {
    const good = { event: 'e1', phase: 'trial', until: 5000, left: 40000, theme: cleanBundle(CANDY) };
    const text = serializeOffer(good);
    eq(parseOffer(text).theme.entry, good.theme.entry);
    eq(parseOffer(text, 10000).left, 10000, 'the time left is cut to the trial time of this build');
    const bad = patch => { const o = JSON.parse(text); patch(o); return parseOffer(JSON.stringify(o)); };
    for (const [name, got] of [
      ['not json', parseOffer('{')], ['nothing', parseOffer(null)], ['version', bad(o => { o.v = 2; })], ['phase', bad(o => { o.phase = 'now'; })], ['event', bad(o => { o.event = 'a b'; })],
      ['until', bad(o => { o.until = 'x'; })], ['left', bad(o => { o.left = -1; })], ['entry', bad(o => { o.theme.entry = { id: 'x' }; })],
      ['css url', bad(o => { o.theme.css = o.theme.css.replace('}', ';background:url(x)}'); })], ['css markup', bad(o => { o.theme.css += '<'; })],
      ['css of another theme', bad(o => { o.theme.css = o.theme.css.replace('"candy"', '"wood"'); })], ['font', bad(o => { o.theme.fonts = [{ family: 'F', weight: '400', data: '!!' }]; })],
      ['size', parseOffer(text + ' '.repeat(400 * 1024))],
    ]) eq(got, null, name);
    eq(parseOffer(serializeOffer({ ...good, theme: { entry: BUILTIN[0], css: null, art: null, fonts: [] } })).theme, { entry: BUILTIN[0], css: null, art: null, fonts: [] }, 'a built-in has no css');
    eq(runBoot({ storage: { [OFFER_KEY]: serializeOffer({ ...good, phase: 'pending' }) } }).appended.length, 0, 'only a trial is painted');
    eq(runBoot({ storage: { [OFFER_KEY]: serializeOffer({ ...good, left: 0 }) } }).appended.length, 0, 'a trial with no time left is not');
    eq(runBoot({ storage: { [OFFER_KEY]: serializeOffer({ ...good, theme: { entry: BUILTIN[1], css: null, art: null, fonts: [] } }) } }).dataset.theme, 'dark', 'a built-in on trial');
    eq(runBoot({ storage: { [OFFER_KEY]: text.replace('"mode":"light"', '"mode":"x"') } }).dataset.theme, 'light', 'a damaged record shows the usual theme');
  });

  t('themes: the chip and the sheet draw each phase; a name cannot inject markup', () => {
    const text = (k, ...a) => `${k}|${a.join('|')}`;
    const theme = { name: '<b>x</b>', symbol: SYMBOL, swatches: ['#fff'] };
    const pend = chipHtml({ phase: 'pending', theme, left: '', trialMs: 1800000 }, text);
    ok(pend.includes('theme.offer.try|30') && !pend.includes('<b>x'), pend);
    ok(chipHtml({ phase: 'pending', theme, left: '12:00', trialMs: 1800000 }, text).includes('theme.offer.resume|12:00'));
    const on = chipHtml({ phase: 'trial', theme, left: '29:59' }, text);
    ok(on.includes('data-left>29:59<') && on.includes('&lt;b&gt;x'), on);
    ok(chipHtml({ phase: 'final', theme }, text).includes('theme.offer.finalChip|<b>x</b>'.replace('<b>x</b>', '&lt;b&gt;x&lt;/b&gt;')));
    const sheetFinal = offerHtml({ theme, left: '1:00', phase: 'final', minimize: true }, text);
    ok(sheetFinal.includes('theme.offer.finalTitle') && sheetFinal.includes('theme.offer.finalText') && sheetFinal.includes('data-offer="minimize"'));
    const sheetTrial = offerHtml({ theme, left: '1:00' }, text);
    ok(sheetTrial.includes('theme.offer.title') && !sheetTrial.includes('data-offer="minimize"'), 'no minimize unless asked');
  });

  t('themes: watchDay checks now, when the page is seen again, when the network is back and at local midnight, and stops on request', () => {
    const calls = [];
    const doc = { visibilityState: 'visible', listeners: {}, addEventListener(n, f) { this.listeners[n] = f; }, removeEventListener(n) { delete this.listeners[n]; } };
    const win = { listeners: {}, addEventListener(n, f) { this.listeners[n] = f; }, removeEventListener(n) { delete this.listeners[n]; } };
    const timers = []; const cleared = [];
    const clock = { t: new Date(2026, 10, 3, 21, 0, 0).getTime() };
    const stop = watchDay(() => calls.push('check'), { doc, win, now: () => clock.t, timers: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => cleared.push(id) } });
    eq([calls.length, timers[0].ms], [1, 3 * HOUR + 1000], 'at once; the timer is at the next local midnight');
    doc.visibilityState = 'hidden'; doc.listeners.visibilitychange();
    eq(calls.length, 1, 'hidden: nothing');
    doc.visibilityState = 'visible'; doc.listeners.visibilitychange();
    win.listeners.online();
    eq(calls.length, 3);
    clock.t = endOfDay(clock.t) + 1000;
    timers[timers.length - 1].fn();
    eq([calls.length, timers[timers.length - 1].ms], [4, 24 * HOUR + 1000 - 1000], 'midnight: checked, the next midnight armed');
    stop();
    eq([Object.keys(doc.listeners), Object.keys(win.listeners)], [[], []]);
    const throwing = watchDay(() => { throw new Error('x'); }, { doc, win, now: () => clock.t, timers: { setTimeout: () => 1, clearTimeout() {} } });
    throwing();
  });

  ta('themes: the dev reveal lists the whole pool, drafts too, and tries or keeps any theme whatever the cap', async () => {
    const SEA = bundle('sea');
    const all = [CANDY, WOOD, SEA];
    const r = rig({ files: filesOf(all), pool: poolOf(all, ['sea']) });
    r.ctl.start();
    eq((await r.ctl.pool()).map(c => [c.entry.id, c.live, c.owned]), [['candy', true, false], ['wood', true, false], ['sea', false, false]], 'drafts too');
    eq(await rig({ pool: null }).ctl.pool(), [], 'not reachable: nothing');

    await r.ctl.tryPool('sea');
    eq([r.ctl.current().id, r.ctl.state().pool.length, r.timeouts.length, BUNDLE_KEY('sea') in r.storage.data], ['sea', 2, 0, false], 'a draft shows at once: no end, nothing kept');
    await r.ctl.tryPool('wood');
    eq(r.ctl.current().id, 'wood', 'one try replaces the other');
    eq(await r.ctl.tryPool('nope'), null);
    r.ctl.select('light');
    eq(r.ctl.current().id, 'light', 'choosing a theme of the pool ends it');

    eq(await r.ctl.keepPool('candy'), true);
    eq([r.ctl.state().pool.map(e => e.id), r.ctl.current().id, BUNDLE_KEY('candy') in r.storage.data], [['light', 'candy'], 'candy', true], 'a full pool: it takes the place of the first theme that is not showing');
    eq(await r.ctl.keepPool('wood'), true);
    eq(r.ctl.state().pool.map(e => e.id), ['wood', 'candy'], 'and a built-in can be replaced, as a player can');
    eq(await r.ctl.keepPool('sea'), true);
    eq([r.ctl.state().pool.map(e => e.id), BUNDLE_KEY('candy') in r.storage.data], [['wood', 'sea'], false], 'one of the player\'s own goes before a built-in, and its copy leaves the device');
    eq(await r.ctl.keepPool('sea'), false, 'owned already');
    eq(await r.ctl.keepPool('ghost'), false, 'not in the pool');
    r.ctl.setCap(4);
    eq([await r.ctl.keepPool('candy'), r.ctl.state().pool.length], [true, 3], 'with room, nothing is replaced');
    eq([evictable(withPool([BUILTIN[0], BUILTIN[1]], null, 2), 'light').id, evictable(withPool([BUILTIN[0], entryOf(CANDY)], null, 2), 'light').id], ['dark', 'candy']);
  });

  t('themes: the dev rows of the picker and the offer sheet are markup, escaped; the time left reads as a clock', () => {
    const labels = { all: 'All', draft: 'draft', keep: 'Keep', offer: 'Offer', none: 'None' };
    const list = [{ entry: entryOf(CANDY), f: 'x', live: true, owned: true }, { entry: entryOf(WOOD), f: 'y', live: false, owned: false }];
    const items = devItems(list, 'wood', 'zh');
    eq(items.map(i => [i.id, i.name, i.live, i.owned, i.current]), [['candy', '主题', true, true, false], ['wood', '主题', false, false, true]]);
    const html = devHtml(items, labels);
    ok(html.includes('data-try-id="candy"') && html.includes('data-try-id="wood"') && html.includes('class="current"') && html.includes('theme-draft') && html.includes('data-offer-now') && html.includes('data-note'));
    eq((html.match(/data-keep-id/g) || []).length, 1, 'a theme that is owned has no keep button');
    ok(devHtml([], labels).includes('None'), 'an empty pool says so');
    const hostile = devHtml([{ id: 'x"><script>', name: '<img src=x>', symbol: SYMBOL, swatches: ['#fff"><i'], live: false, owned: false, current: false }], { ...labels, all: '<b>', draft: '<u>' });
    ok(!/<(script|img|b|u)[ >]/.test(hostile), 'no tag of theirs');
    ok(['x&quot;&gt;&lt;script&gt;', '&lt;img src=x&gt;', '&lt;b&gt;', '&lt;u&gt;'].every(piece => hostile.includes(piece)), 'shown as text');

    eq([0, -5, 1, 90000, 3600000, 7325000, 2 * 86400000 + 3 * 3600000].map(formatLeft), ['0:00', '0:00', '0:01', '1:30', '1:00:00', '2:02:05', '2d 3h']);
    const text = (key, ...args) => (args.length ? `${key}(${args})` : key);
    const theme = { name: 'Candy <b>', symbol: SYMBOL, swatches: ['#fff'] };
    const step1 = offerHtml({ theme, left: '0:42 left' }, text);
    ok(step1.includes('data-offer="keep"') && step1.includes('data-offer="leave"') && step1.includes('data-left') && step1.includes('Candy &lt;b&gt;') && !step1.includes('Candy <b>'), 'keep or leave, the time left, the name as text');
    ok(!offerHtml({ theme, left: null }, text).includes('data-left'), 'no countdown for an offer with no end');
    ok(offerHtml({ theme, failed: true }, text).includes('role="alert"') && !offerHtml({ theme }, text).includes('role="alert"'));
    const step2 = offerHtml({ theme, replace: [{ id: 'light', name: 'Light', symbol: SYMBOL, swatches: [] }, { id: 'x"y', name: 'N', symbol: SYMBOL, swatches: [] }] }, text);
    ok(step2.includes('data-replace="light"') && step2.includes('data-replace="x&quot;y"') && step2.includes('data-offer="back"') && !step2.includes('data-offer="keep"'), 'which of the player\'s themes it replaces');
    ok(step2.includes('theme.offer.replace(Candy &lt;b&gt;)') || step2.includes('theme.offer.replace(Candy'), 'and the new theme is named');
  });
}
