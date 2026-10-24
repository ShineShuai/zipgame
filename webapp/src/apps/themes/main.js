// Theme preview (dev page, themes.html): loads one theme at a time the way the game will (the theme's CSS by <link>, its
// art by import(), nothing else), and shows the log of what was fetched. Open it through a local server:
//   cd webapp && python3 -m http.server 8000   ->   http://localhost:8000/themes.html
import { BRAND_MARK, CATALOG, getTheme } from '../../themes/catalog.js';
import { boardSvg, iconSvg } from './render.js';

const $ = id => document.getElementById(id);
const FLAT = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon', 'solids'];
const LABEL = {
  standard: 'Standard', cutout: 'Cutout', arrows: 'Arrows', exact: 'Exact', wrap: 'Wrap-around', loop: 'Loop',
  teleport: 'Teleport', twopaths: 'Two paths', pentagon: 'Pentagon', solids: '3D solids',
};
const loaded = new Map();   // id -> { art } (the pool's themes stay loaded)
const log = [];

const glyph = symbol => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-stroke)"`
  + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbol}</svg>`;

function addCss(id) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = `theme-css-${id}`;
    link.href = `css/themes/${id}.css`;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`css/themes/${id}.css`));
    document.head.append(link);
  });
}

async function load(theme) {
  if (loaded.has(theme.id)) return loaded.get(theme.id);
  const entry = { art: null };
  if (!theme.builtin) {
    await addCss(theme.id);
    log.push(`css/themes/${theme.id}.css`);
    if (theme.art) { entry.art = (await import(`../../themes/${theme.id}/art.js`)).default; log.push(`src/themes/${theme.id}/art.js`); }
  }
  loaded.set(theme.id, entry);
  return entry;
}

function tiles(art, bento) {
  return FLAT.map((id, i) => {
    const inner = art?.icons?.[id];
    const icon = inner ? iconSvg(inner, id) : '<svg class="variant-icon missing" viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="6"/></svg>';
    const k = bento ? ` data-vt="${(i % 4) + 1}"` : '';
    return `<div class="pv-tile${inner ? '' : ' is-classic'}"${k}>${icon}<span>${LABEL[id]}</span></div>`;
  }).join('');
}

async function show(id) {
  const theme = getTheme(id);
  const { art } = await load(theme);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.mode = theme.mode;
  root.dataset.menu = theme.layout.menu;
  root.dataset.picker = theme.layout.picker;
  root.dataset.actions = theme.layout.actions;
  document.querySelector('meta[name="theme-color"]').content = theme.chrome;
  const mark = art?.mark ? `<span class="pv-mark">${art.mark}</span>` : `<img class="pv-mark" src="${BRAND_MARK[theme.mode]}" alt="">`;
  const bento = theme.layout.menu === 'bento';
  $('stage').innerHTML = `
    <header class="pv-bar">${mark}<span class="pv-name">zigzag</span>
      <span class="pv-spacer"></span><span class="pv-chip">EN</span><span class="pv-chip">中</span>
      <span class="pv-icon-btn" title="${theme.name.en}">${glyph(theme.symbol)}</span></header>
    <div class="pv-grid">
      <section class="pv-card"><h2>Game of Day <small>5 × 5 · 01:24</small></h2><div class="pv-board ${(art?.board ?? CLASSIC).grid}">${boardSvg(art?.board ?? CLASSIC)}</div>
        <button class="pv-btn">Play</button> <button class="pv-btn secondary">Hint</button></section>
      <section class="pv-card"><h2>Free play</h2><div class="pv-tiles">${tiles(art, bento)}</div>
        <p class="pv-note">${art ? '' : 'No art module: the classic icons are used (built-in theme).'}
        Layout: menu <b>${theme.layout.menu}</b>, picker <b>${theme.layout.picker}</b>, actions <b>${theme.layout.actions}</b>.</p></section>
    </div>`;
  $('log').textContent = log.length ? `Fetched so far:\n${log.join('\n')}` : 'Fetched so far: nothing (built-in themes ship with the page)';
  document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === id)));
}

// The classic board (today's constants in apps/play/board.js), for the built-in themes.
const CLASSIC = {
  grid: 'lines', tileRx: 0, tileInset: 0, tileEdgeW: 0.025, depth: 0, plateRx: 0, pathW: 0.28, cap: 'round', join: 'round',
  gradient: false, wallW: 0.1, wallCap: 'round', num: 'disc', numR: 0.32, numRingW: 0.05,
};

$('picker').innerHTML = CATALOG.map(t => `<button data-pick="${t.id}" aria-pressed="false">${glyph(t.symbol)}<span>${t.name.en}</span></button>`).join('');
$('picker').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) show(b.dataset.pick); });
show('light');
