// Tests of the theme system (src/themes): the whitelists, the bundle a theme arrives in, the device store, the stage the
// offers come from, the pool, the controller (offer -> take or leave), and the page's inline head script, run for real
// (node:vm) and compared with the pool code it mirrors. Fakes stand in for storage, the network and the page. The templates
// themselves (the authoring side) are tested by themes/tools/test.mjs. Registered by tests.js.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyEntry, loadFonts } from '../src/themes/apply.js';
import { cleanArt, CLASSIC_BOARD } from '../src/themes/art.js';
import { cleanBundle } from '../src/themes/bundle.js';
import { BUILTIN } from '../src/themes/builtin.js';
import { createThemes } from '../src/themes/index.js';
import { cleanLayout } from '../src/themes/layout.js';
import {
  activeEntry, cleanEntry, fresh, isClassicPool, MODE_KEY, nextEntry, parseState, POOL_KEY, remove, save, select, serialize, setCap,
} from '../src/themes/pool.js';
import { cleanOffer, createStage, STAGE_SQL, tursoStage } from '../src/themes/source.js';
import { BUNDLE_KEY, createStore } from '../src/themes/store.js';
import { cleanTokens, buildCss } from '../src/themes/tokens.js';
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

function rig({ stored, owned = [], legacy, dark = false, quota = false, clock = { t: 1000 } } = {}) {
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
    storage, media, store: createStore(storage), now: () => clock.t,
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

  t('themes: an offer on the stage is read back as it was published, and only while its window is open', () => {
    const row = (extra = {}) => ({ event: '202611-autumn', theme: 'candy', v: 3, from_ms: 1000, until_ms: 5000, bundle: JSON.stringify(CANDY), ...extra });
    eq(cleanOffer(row()).bundle.id, 'candy');
    for (const bad of [null, row({ event: 'Bad Event' }), row({ theme: 'wood' }), row({ v: 4 }), row({ bundle: '{{' }), row({ bundle: 'x'.repeat(230000) }), row({ from_ms: 'x' }), row({ event: undefined })]) eq(cleanOffer(bad), null);
    return (async () => {
      const stage = now => createStage({ fetchRows: async () => [row(), row({ event: 'later', from_ms: 9000, until_ms: 9999 }), row({ event: 'junk', bundle: 'no' })], now: () => now });
      eq((await stage(2000).offers()).map(o => o.event), ['202611-autumn'], 'running now');
      eq((await stage(500).offers()).length + (await stage(6000).offers()).length, 0, 'not yet, and over');
    })();
  });

  ta('themes: the Turso adapter asks for the running offers with the public read token, in the leaderboard\'s protocol', async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push([url, init.headers.Authorization, JSON.parse(init.body)]);
      const text = v => ({ type: 'text', value: v });
      const int = n => ({ type: 'integer', value: String(n) });
      return { ok: true, json: async () => ({ results: [{ type: 'ok', response: { type: 'execute', result: {
        cols: ['event', 'theme', 'v', 'from_ms', 'until_ms', 'bundle'].map(name => ({ name })),
        rows: [[text('e1'), text('candy'), int(3), int(1000), int(5000), text(JSON.stringify(CANDY))]],
      } } }, { type: 'ok', response: { type: 'close' } }] }) };
    };
    const rows = await tursoStage({ url: 'https://db.example/', key: 'tok' }, fetchFn).fetchRows(2000);
    eq([calls[0][0], calls[0][1], calls[0][2].requests[0].stmt.sql, calls[0][2].requests[0].stmt.args], ['https://db.example/v2/pipeline', 'Bearer tok', STAGE_SQL, [{ type: 'integer', value: '2000' }]]);
    eq([rows.length, rows[0].v, rows[0].from_ms, cleanOffer(rows[0]).theme], [1, 3, 1000, 'candy']);
    let failed = false;
    try { await tursoStage({ url: 'https://x', key: 'k' }, async () => ({ ok: false, status: 503 })).fetchRows(1); } catch { failed = true; }
    ok(failed, 'a failing stage is an error the caller can ignore');
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
