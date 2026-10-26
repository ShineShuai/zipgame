// Tests of the theme system (src/themes): the whitelists, the bundle a theme arrives in, the device store, the stage the
// offers come from, the pool, the controller (offer -> take or leave), and the page's inline head script, run for real
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
import { BUILTIN } from '../src/themes/builtin.js';
import { createThemes } from '../src/themes/index.js';
import { cleanLayout } from '../src/themes/layout.js';
import {
  activeEntry, cleanEntry, fresh, isClassicPool, MODE_KEY, nextEntry, parseState, POOL_KEY, remove, save, select, serialize, setCap,
} from '../src/themes/pool.js';
import { browserSource, createSource, MAX_FILE, TOKEN_RE } from '../src/themes/source.js';
import { BUNDLE_KEY, createStore } from '../src/themes/store.js';
import { cleanTokens, buildCss } from '../src/themes/tokens.js';
import { DEFAULT_LAYOUT, LAYOUT as PRESETS } from '../src/themes/layout.js';
import { pickerHtml, pickerItems } from '../src/themes/picker.js';
import { cleanInner, cleanSvg } from '../src/themes/svg.js';

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

function rig({ stored, owned = [], legacy, dark = false, quota = false, clock = { t: 1000 }, offers = {} } = {}) {
  const initial = {};
  if (stored) initial[POOL_KEY] = typeof stored === 'string' ? stored : serialize(stored);
  if (legacy) initial[MODE_KEY] = legacy;
  for (const b of owned) initial[BUNDLE_KEY(b.id)] = ownedRecord(b);
  const storage = memoryStorage(initial, { quota });
  const listeners = [];
  const media = { matches: dark, addEventListener: (_, fn) => listeners.push(fn) };
  const applied = [];
  const timeouts = [];
  const cleared = [];
  const fontLoads = [];
  const ctl = createThemes({
    storage, media, store: createStore(storage), now: () => clock.t, source: { bundle: async token => offers[token] ?? null },
    apply: (e, loaded) => applied.push(loaded ? `${e.id}+css` : e.id),
    loadFonts: fonts => { fontLoads.push(fonts.length); return { release() { fontLoads.push('released'); } }; },
    timers: { setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; }, clearTimeout: id => cleared.push(id) },
  });
  return { storage, ctl, media, listeners, applied, timeouts, cleared, fontLoads, clock };
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
  t('themes: the svg whitelist keeps shapes and refuses everything else', () => {
    eq(cleanSvg(SYMBOL), SYMBOL, 'shapes pass unchanged');
    eq(cleanInner('<path d="M0 0" fill="color-mix(in srgb, var(--ic-1) 70%, #000)"/>') !== null, true, 'tokens and color-mix pass');
    for (const bad of [
      '<script>alert(1)</script>', '<path d="M0 0" onload="x()"/>', '<path d="M0 0" style="fill:red"/>', '<use href="#a"/>',
      '<image href="x.png"/>', '<path d="M0 0" fill="url(#a)"/>', '<path id="a" d="M0 0"/>', '<g><path d="M0 0"/>', '<path d="M0 0"/></g>',
      'text<path d="M0 0"/>', '<path d="M0 0" fill="javascript:x"/>', '<foreignObject/>', '<path d="M0 0" fill="a&b"/>',
    ]) eq(cleanSvg(bad), null, bad);
    eq(cleanSvg('x'.repeat(30)), null);
    eq(cleanSvg('<path d="M0 0"/>'.repeat(500), 1000), null, 'too long');
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

  ta('themes: an offered theme is a plain file behind an unguessable token: only a token can fetch it, and only while the file exists', async () => {
    const TOKEN = 'Abcdefghijklmnopqrstuv';   // 22 characters
    ok(TOKEN_RE.test(TOKEN) && !TOKEN_RE.test('short') && !TOKEN_RE.test(`${TOKEN}x`) && !TOKEN_RE.test('../../etc/passwd-aaaaaaaa') && !TOKEN_RE.test('Abcdefghijklmnopqrst.v'), 'the shape of a token');
    const fetched = [];
    const files = { [`../offers/${TOKEN}.json`]: JSON.stringify(CANDY), '../offers/Zzzzzzzzzzzzzzzzzzzzzz.json': 'not json', '../offers/Yyyyyyyyyyyyyyyyyyyyyy.json': 'x'.repeat(MAX_FILE + 1) };
    const source = createSource({ base: '../offers/', fetchText: async url => { fetched.push(url); if (!(url in files)) throw new Error('404'); return files[url]; } });
    eq((await source.bundle(TOKEN)).id, 'candy', 'a token fetches its bundle');
    eq(fetched, [`../offers/${TOKEN}.json`], 'one request, to exactly that file');
    for (const bad of [undefined, '', 'short', '../x', 'a/b', `${TOKEN}.json`, 'Qqqqqqqqqqqqqqqqqqqqqq', 'Zzzzzzzzzzzzzzzzzzzzzz', 'Yyyyyyyyyyyyyyyyyyyyyy']) eq(await source.bundle(bad), null, String(bad));
    eq(fetched.length, 4, 'a malformed token makes no request; a missing, broken or oversized file is nothing');
    const calls = [];
    const fetchFn = async (url, init) => { calls.push([url, init.cache, init.credentials]); return url.includes('gone') ? { ok: false, status: 404 } : { ok: true, headers: { get: () => '100' }, text: async () => JSON.stringify(CANDY) }; };
    eq((await browserSource('../offers/', fetchFn).bundle(TOKEN)).id, 'candy');
    eq(calls[0], [`../offers/${TOKEN}.json`, 'no-store', 'omit'], 'not cached, no cookies');
    eq(await browserSource('../gone/', fetchFn).bundle(TOKEN), null, 'a 404: the offer is over');
    eq(await browserSource('../offers/', async () => ({ ok: true, headers: { get: () => String(MAX_FILE + 1) }, text: async () => '{}' })).bundle(TOKEN), null, 'too big by its header');
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

  ta('themes: an offer is tried, then taken (kept on the device and in the pool) or left (gone, nothing kept)', async () => {
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

    const TOKEN = 'Abcdefghijklmnopqrstuv';
    const offered = rig({ offers: { [TOKEN]: CANDY } });
    offered.ctl.start();
    eq(await offered.ctl.offer('Qqqqqqqqqqqqqqqqqqqqqq'), null, 'no file: the event is over, nothing shown');
    eq(offered.ctl.current().id, 'light');
    const seen = await offered.ctl.offer(TOKEN, { until: 5000 });
    eq([seen.entry.id, offered.ctl.current().id, offered.ctl.state().pool.length], ['candy', 'candy', 2], 'a token puts its theme on trial');
    seen.revert();
    eq([offered.ctl.current().id, BUNDLE_KEY('candy') in offered.storage.data], ['light', false], 'left: gone, nothing kept');
    eq(await rig({ offers: { [TOKEN]: { ...CANDY, tokens: { ...CANDY.tokens, '--ctl-h': '90px' } } } }).ctl.offer(TOKEN), null, 'a bundle the game refuses is not shown');

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
}
