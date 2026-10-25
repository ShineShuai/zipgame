// Tests of the theme system (src/themes): the SVG whitelist, the art and pool logic, the registry and the controller with
// fakes for storage, network and page, and the page's inline head script, run for real (node:vm) and compared with the pool
// code it mirrors. The templates themselves are tested by themes/tools/test.mjs. Registered by tests.js.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cleanArt, CLASSIC_BOARD } from '../src/themes/art.js';
import { applyEntry } from '../src/themes/apply.js';
import { BUILTIN } from '../src/themes/builtin.js';
import { createThemes } from '../src/themes/index.js';
import { cleanLayout } from '../src/themes/layout.js';
import {
  activeEntry, cleanEntry, fresh, isClassicPool, MODE_KEY, nextEntry, parseState, POOL_KEY, save, select, serialize, setCap,
} from '../src/themes/pool.js';
import { createRegistry } from '../src/themes/registry.js';
import { cleanInner, cleanSvg } from '../src/themes/svg.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SYMBOL = '<circle cx="12" cy="12" r="5"/><path d="M7 12 2.5 8.5v7z"/>';
const entry = (id, mode, extra = {}) => ({
  id, v: 3, themeApi: 1, mode, name: { en: id.toUpperCase(), zh: '主题' }, chrome: mode === 'dark' ? '#2b1d14' : '#efe7ff',
  layout: { menu: 'dashboard', picker: 'tiles', actions: 'side' }, swatches: ['#efe7ff', '#ffffff', '#6a4cf0', '#e8384f'],
  symbol: SYMBOL, art: true, ...extra,
});
const CANDY = entry('candy', 'light');
const WOOD = entry('wood', 'dark');
const withPool = (pool, active = null, cap = pool.length) => ({ v: 2, cap, active, pool });

// ---- fakes ----
function rig({ stored, legacy, dark = false, ensure } = {}) {
  const store = {};
  if (stored) store[POOL_KEY] = typeof stored === 'string' ? stored : serialize(stored);
  if (legacy) store[MODE_KEY] = legacy;
  const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const listeners = [];
  const media = { matches: dark, addEventListener: (_, fn) => listeners.push(fn) };
  const applied = [];
  const registry = { ensure: async e => (ensure ? ensure(e) : { art: null }) };
  const ctl = createThemes({ storage, media, registry, apply: (e, art) => applied.push(art ? `${e.id}+art` : e.id) });
  return { store, ctl, media, listeners, applied };
}

function runBoot({ storage = {}, dark = false, base = '../themes/' } = {}) {
  const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dataset = {};
  const written = [];
  const meta = { color: '#f4f7ff' };
  const document = {
    documentElement: { dataset },
    querySelector: sel => (sel.includes('theme-color') ? { setAttribute: (k, v) => { meta.color = v; } }
      : sel.includes('themes-base') ? { content: base } : null),
    write: s => written.push(s),
  };
  vm.runInNewContext(script, {
    document, localStorage: { getItem: k => (k in storage ? storage[k] : null) }, matchMedia: () => ({ matches: dark }),
  });
  return { dataset, written, meta };
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

  t('themes: art is rebuilt from the whitelist and the bounds, unusable parts fall back', () => {
    const art = cleanArt({
      mark: '<svg viewBox="0 0 96 96"><rect width="96" height="96" fill="#fff"/></svg>',
      icons: { standard: '<path d="M0 0"/>', cutout: '<script/>', nonsense: '<path d="M0 0"/>' },
      board: { grid: 'tiles', pathW: 0.3, wallW: 9, cap: 'evil', gradient: true },
    });
    eq(Object.keys(art.icons), ['standard'], 'a bad icon and an unknown id are dropped');
    ok(art.mark.startsWith('<svg'), 'a good mark stays');
    eq([art.board.grid, art.board.pathW, art.board.wallW, art.board.cap, art.board.gradient], ['tiles', 0.3, CLASSIC_BOARD.wallW, 'round', true]);
    eq(cleanArt(null), null);
    eq(cleanArt({ mark: '<svg><script/></svg>' }).mark, null);
    eq(cleanLayout({ menu: 'bento', picker: 'carousel' }), { menu: 'bento', picker: 'tiles', actions: 'side' }, 'an unknown preset becomes the default');
  });

  t('themes: an entry from storage or the catalog is cleaned; built-ins are never taken from it', () => {
    eq(cleanEntry(CANDY).id, 'candy');
    for (const bad of [null, {}, { ...CANDY, id: 'A b' }, { ...CANDY, id: 'a"><x' }, { ...CANDY, mode: 'blue' }, { ...CANDY, chrome: 'red' }]) eq(cleanEntry(bad), null);
    const e = cleanEntry({ ...CANDY, symbol: '<script/>', name: { en: '<b>x</b>' }, v: -4, layout: { menu: 'zzz' }, swatches: ['x'] });
    eq([e.symbol, e.name.en, e.v, e.layout.menu, e.swatches], ['', 'candy', 1, 'dashboard', null]);
    eq(cleanEntry({ ...BUILTIN[1], chrome: '#000000', symbol: '<circle cx="1" cy="1" r="1"/>' }), BUILTIN[1], 'built-in metadata is the app\'s');
  });

  t('themes: the pool starts as light and dark, migrates the old key, and survives damage', () => {
    eq(parseState(null).pool.map(e => e.id), ['light', 'dark']);
    eq([parseState(null, 'dark').active, parseState(null, 'light').active, parseState(null, 'x').active, parseState(null).active], ['dark', 'light', null, null]);
    eq(parseState('{{{', 'dark').active, 'dark', 'damaged storage: start again, keep the old choice');
    eq(parseState(JSON.stringify({ v: 1, pool: [CANDY] })).pool.map(e => e.id), ['light', 'dark'], 'another version is ignored');
    const st = withPool([BUILTIN[0], CANDY, CANDY, { id: 'BAD' }, BUILTIN[1]], 'candy', 3);
    const parsed = parseState(serialize(st));
    eq(parsed.pool.map(e => e.id), ['light', 'candy', 'dark'], 'invalid and duplicate entries are dropped');
    eq([parseState(JSON.stringify({ ...st, cap: 99 })).cap, parseState(JSON.stringify({ ...st, cap: 0 })).cap], [4, 2], 'cap stays in 2..4');
    eq(parseState(JSON.stringify({ ...st, cap: 2 })).pool.map(e => e.id), ['light', 'candy'], 'the pool is cut to the cap');
    eq(parseState(JSON.stringify({ ...st, active: 'gone' })).active, null, 'an active theme that is not in the pool is forgotten');
  });

  t('themes: which theme shows (chosen, else the pool\'s first of the system mode, else its first)', () => {
    const pool = withPool([CANDY, WOOD], null, 2);
    eq([activeEntry(pool, 'light').id, activeEntry(pool, 'dark').id], ['candy', 'wood']);
    eq(activeEntry(withPool([CANDY]), 'dark').id, 'candy', 'no theme of the system mode: the first');
    eq(activeEntry({ ...pool, active: 'wood' }, 'light').id, 'wood', 'a chosen theme wins');
    eq(activeEntry(fresh(null), 'dark').id, 'dark');
  });

  t('themes: select, cap, save and replace', () => {
    let st = fresh(null);
    eq(select(st, 'dark').active, 'dark');
    eq(select(st, 'candy'), st, 'only a theme of the pool can be selected');
    eq(save(st, CANDY), null, 'a full pool needs a theme to replace');
    eq(save(st, CANDY, 'nope'), null);
    eq(save(st, { id: 'x y' }, 'dark'), null, 'not a theme');
    const replaced = save(select(st, 'dark'), CANDY, 'dark');
    eq([replaced.pool.map(e => e.id), replaced.active], [['light', 'candy'], 'candy'], 'replacing the active theme hands over to the new one');
    eq(save(select(st, 'light'), CANDY, 'dark').active, 'light', 'replacing another theme keeps the active one');
    eq(save(replaced, CANDY), replaced, 'saving a theme the pool has changes nothing');
    st = setCap(st, 3);
    const three = save(st, CANDY);
    eq(three.pool.map(e => e.id), ['light', 'dark', 'candy'], 'room: it is added');
    eq(setCap(st, 9).cap, 4);
    eq(setCap(three, 2).pool.map(e => e.id), ['light', 'dark'], 'lowering the cap keeps the earliest themes');
    eq(setCap({ ...three, active: 'candy' }, 2).pool.map(e => e.id), ['light', 'candy'], 'and the active one');
    eq([nextEntry(fresh(null), 'light').id, nextEntry(fresh(null), 'dark').id, nextEntry(three, 'candy').id], ['dark', 'light', 'light']);
    eq([isClassicPool(fresh(null)), isClassicPool(three), isClassicPool(replaced)], [true, false, false]);
  });

  t('themes: the page\'s head script picks what pool.js picks, and writes the token file link for downloadable themes only', () => {
    const states = {
      none: [{}, false], 'none, system dark': [{}, true],
      'old key dark': [{ [MODE_KEY]: 'dark' }, false], 'old key junk': [{ [MODE_KEY]: 'blue' }, true],
      'chosen candy': [{ [POOL_KEY]: serialize(withPool([BUILTIN[0], BUILTIN[1], CANDY], 'candy', 3)) }, false],
      'follow system (dark)': [{ [POOL_KEY]: serialize(withPool([BUILTIN[0], WOOD, CANDY], null, 3)) }, true],
      'follow system (light)': [{ [POOL_KEY]: serialize(withPool([WOOD, CANDY, BUILTIN[1]], null, 3)) }, false],
      'no theme of the system mode': [{ [POOL_KEY]: serialize(withPool([CANDY, BUILTIN[0]], null, 2)) }, true],
      'built-ins replaced': [{ [POOL_KEY]: serialize(withPool([CANDY, WOOD], null, 2)) }, true],
      'a tampered id': [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 3, active: 'x"><b', pool: [{ ...CANDY, id: 'x"><b' }, BUILTIN[0], BUILTIN[1]] }) }, true],
      'duplicates': [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 2, active: null, pool: [BUILTIN[0], BUILTIN[0], BUILTIN[1]] }) }, true],
      'cut to the cap': [{ [POOL_KEY]: JSON.stringify({ v: 2, cap: 2, active: 'wood', pool: [BUILTIN[0], BUILTIN[1], WOOD] }) }, false],
      'damaged': [{ [POOL_KEY]: 'not json', [MODE_KEY]: 'dark' }, false],
      'another version': [{ [POOL_KEY]: JSON.stringify({ v: 1, pool: [CANDY] }) }, true],
    };
    for (const [name, [storage, dark]] of Object.entries(states)) {
      const want = activeEntry(parseState(storage[POOL_KEY], storage[MODE_KEY]), dark ? 'dark' : 'light');
      const got = runBoot({ storage, dark });
      eq([got.dataset.theme, got.dataset.mode], [want.id, want.mode], name);
      eq(got.meta.color, want.chrome, `${name}: the browser bar`);
      eq(got.written.length, want.builtin ? 0 : 1, `${name}: a link only for a downloadable theme`);
      if (!want.builtin) ok(got.written[0].includes(`href='../themes/${want.id}/theme.css?v=${want.v}'`), `${name}: ${got.written[0]}`);
      eq([got.dataset.menu, got.dataset.picker, got.dataset.actions].every(v => v === undefined || /^[a-z-]+$/.test(v)), true, `${name}: layout attributes`);
    }
    eq(runBoot({ storage: states['chosen candy'][0], base: '/t/' }).written[0].includes("href='/t/candy/theme.css"), true, 'the base comes from the page');
    eq(runBoot({ storage: states['chosen candy'][0] }).dataset.menu, 'dashboard');
  });

  t('themes: index.html pins its head script in the CSP, and the tokens it needs are in the page', () => {
    const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)[1];
    ok(INDEX.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`), 'the CSP hash is the script\'s');
    ok(INDEX.includes('<meta name="themes-base" content="../themes/">'), 'themes-base');
    ok(INDEX.indexOf('themes-base') < INDEX.indexOf('<script>'), 'the base is known before the script runs');
    ok(!INDEX.includes('Zip'), 'the brand is zigzag');
  });

  ta('themes: the registry fetches a theme once, only when asked, and refuses what did not apply', async () => {
    const calls = [];
    let applies = true;
    const reg = createRegistry({
      base: '../themes/',
      addStylesheet: async (href, id) => { calls.push(['css', href, id]); },
      fetchJson: async url => { calls.push(['json', url]); return url.endsWith('catalog.json') ? { themeApi: 1, themes: [CANDY, { ...WOOD, themeApi: 2 }, { id: 'x y' }] } : { icons: {}, board: { grid: 'tiles' } }; },
      applied: () => applies,
    });
    eq(await reg.ensure(BUILTIN[0]), { art: null });
    eq(calls, [], 'built-in themes fetch nothing');
    const [a, b] = await Promise.all([reg.ensure(CANDY), reg.ensure(CANDY)]);
    eq(calls, [['css', '../themes/candy/theme.css?v=3', 'candy'], ['json', '../themes/candy/art.json?v=3']], 'once, css then art');
    ok(a === b && a.art.board.grid === 'tiles');
    eq((await reg.ensure({ ...CANDY, id: 'noart', art: false })).art, null, 'a theme without art fetches no art');
    applies = false;
    let failed = false;
    try { await reg.ensure(WOOD); } catch { failed = true; }
    ok(failed, 'a token file that did not apply rejects');
    applies = true;
    await reg.ensure(WOOD);
    ok(calls.filter(c => c[0] === 'css' && c[2] === 'wood').length === 2, 'and a failure is not cached');
    eq((await reg.catalog()).map(e => e.id), ['candy'], 'only valid themeApi 1 entries');
    await reg.catalog();
    eq(calls.filter(c => c[1]?.endsWith('catalog.json')).length, 1, 'the catalog is fetched once');
  });

  ta('themes: the controller shows, steps, persists, follows the system and falls back', async () => {
    let r = rig();
    await r.ctl.start();
    eq([r.applied, r.ctl.isClassic(), r.ctl.current().id], [['light'], true, 'light']);
    await r.ctl.next();
    eq([r.applied, r.ctl.current().id, r.store[MODE_KEY], JSON.parse(r.store[POOL_KEY]).active], [['light', 'dark'], 'dark', 'dark', 'dark'], 'a step is a choice: kept, mirrored for the stats page');

    r = rig({ dark: false });
    await r.ctl.start();
    r.media.matches = true;
    r.listeners.forEach(fn => fn());
    await Promise.resolve();
    eq([r.ctl.current().id, MODE_KEY in r.store], ['dark', false], 'until the player chooses, the system setting leads (and nothing is saved)');
    await r.ctl.select('light');
    r.listeners.forEach(fn => fn());
    eq(r.ctl.current().id, 'light', 'after a choice the system no longer matters');

    r = rig({ stored: withPool([BUILTIN[0], BUILTIN[1], CANDY], 'candy', 3), ensure: async () => ({ art: { mark: '<svg/>' } }) });
    await r.ctl.start();
    eq([r.applied, r.ctl.isClassic(), r.ctl.art().mark], [['candy', 'candy+art'], false, '<svg/>'], 'attributes first, the art when it is in');
    eq(r.ctl.upcoming().id, 'light');

    r = rig({ stored: withPool([BUILTIN[0], BUILTIN[1], WOOD], 'wood', 3), ensure: async () => { throw new Error('offline'); } });
    await r.ctl.start();
    eq([r.applied, r.ctl.current().id, r.ctl.state().pool.length, r.ctl.state().active], [['wood', 'dark'], 'dark', 3, 'wood'], 'files unavailable: the built-in of its mode is shown, the pool is left alone');
  });

  ta('themes: a trial shows a theme without keeping it; commit saves it (replacing when full), revert goes back', async () => {
    const r = rig();
    await r.ctl.start();
    const trial = r.ctl.trial(CANDY);
    await Promise.resolve();
    eq([r.ctl.current().id, r.ctl.state().pool.length, JSON.parse(r.store[POOL_KEY] ?? 'null')], ['candy', 2, null], 'shown, not stored');
    await trial.revert();
    eq(r.ctl.current().id, 'light');
    const again = r.ctl.trial(CANDY);
    eq(await again.commit(), false, 'a full pool needs a theme to replace');
    ok(await again.commit('dark'));
    eq([r.ctl.state().pool.map(e => e.id), r.ctl.state().active, r.ctl.current().id], [['light', 'candy'], 'candy', 'candy']);
    r.ctl.setCap(4);
    ok(r.ctl.save(WOOD) && r.ctl.save(entry('sea', 'light')), 'awards raise the cap, a theme is added without replacing');
    eq(r.ctl.state().pool.length, 4);
    eq(parseState(r.store[POOL_KEY]).pool.length, 4, 'and it is stored');
  });

  t('themes: applyEntry sets the attributes, the bar colour and the brand mark, and tells the page', () => {
    const attrs = {};
    const holder = { classList: { toggle: (c, on) => { attrs.hasArt = on; } }, querySelector: () => null, append: n => { attrs.mark = n.innerHTML; } };
    const events = [];
    const doc = {
      documentElement: { dataset: attrs },
      querySelector: () => ({ setAttribute: (k, v) => { attrs.chrome = v; } }),
      getElementById: id => (id === 'brandMark' ? holder : null),
      createElement: () => ({ setAttribute() {}, set className(v) {} }),
      dispatchEvent: e => events.push(e),
    };
    applyEntry({ ...CANDY, layout: { menu: 'bento', picker: 'tiles', actions: 'bar' } }, { mark: '<svg/>' }, doc);
    eq([attrs.theme, attrs.mode, attrs.menu, attrs.picker, attrs.actions, attrs.chrome, attrs.hasArt, attrs.mark], ['candy', 'light', 'bento', 'tiles', 'bar', '#efe7ff', true, '<svg/>']);
    eq([events[0].type, events[0].detail.id, events[0].detail.mode], ['zip-theme', 'candy', 'light']);
    applyEntry(BUILTIN[1], null, doc);
    eq([attrs.theme, attrs.mode, attrs.hasArt], ['dark', 'dark', false]);
  });
}
