// Theme preview (dev page, for the author): the game's real controller, bundle validator and apply code on a page of mock screens.
// Built-in themes are selected; a bundle from themes/out/ is put on trial, exactly as an offered theme is in the game, so what
// you see is what the validator let through and what the generated tokens and the art define. Nothing is stored beyond this page.
import { CLASSIC_BOARD } from '../../webapp/src/themes/art.js';
import { cleanBundle } from '../../webapp/src/themes/bundle.js';
import { BUILTIN } from '../../webapp/src/themes/builtin.js';
import { createThemes } from '../../webapp/src/themes/index.js';
import { createStore } from '../../webapp/src/themes/store.js';
import { boardSvg, iconSvg } from './render.js';

const $ = id => document.getElementById(id);
const FLAT = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon', 'solids'];
const LABEL = {
  standard: 'Standard', cutout: 'Cutout', arrows: 'Arrows', exact: 'Exact', wrap: 'Wrap-around', loop: 'Loop',
  teleport: 'Teleport', twopaths: 'Two paths', pentagon: 'Pentagon', solids: '3D solids',
};
const BRAND = { light: '../../assets/images/logo/zigzag-mark.svg', dark: '../../assets/images/logo/zigzag-mark-dark.svg' };

const memory = new Map();
const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
const known = name => getComputedStyle(document.documentElement).getPropertyValue(name) !== '';
const ctl = createThemes({ storage, media: matchMedia('(prefers-color-scheme: dark)'), store: createStore(storage), known });

const glyph = symbol => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-stroke)"`
  + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbol}</svg>`;

function tiles(art, bento) {
  return FLAT.map((id, i) => {
    const inner = art?.icons?.[id];
    const icon = inner ? iconSvg(inner, id)
      : '<svg class="variant-icon missing" viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="6"/></svg>';
    return `<div class="pv-tile${inner ? '' : ' is-classic'}"${bento ? ` data-vt="${(i % 4) + 1}"` : ''}>${icon}<span>${LABEL[id]}</span></div>`;
  }).join('');
}

const sizes = {};
function render() {
  const entry = ctl.current();
  const art = ctl.art();
  const board = art?.board ?? CLASSIC_BOARD;
  const bento = entry.layout.menu === 'bento';
  $('stage').innerHTML = `
    <header class="pv-bar"><span class="brand-mark" id="brandMark">
        <img class="logo logo-light" src="${BRAND.light}" alt=""><img class="logo logo-dark" src="${BRAND.dark}" alt=""></span>
      <span class="pv-name">zigzag</span><span class="pv-spacer"></span><span class="pv-chip">EN</span><span class="pv-chip">中</span>
      <span class="pv-icon-btn" title="${entry.name.en}">${glyph(entry.symbol)}</span></header>
    <div class="pv-grid">
      <section class="pv-card"><h2>Game of Day <small>5 × 5 · 01:24</small></h2>
        <div class="pv-board ${board.grid}">${boardSvg(board)}</div>
        <button class="pv-btn">Play</button> <button class="pv-btn secondary">Hint</button></section>
      <section class="pv-card"><h2>Free play</h2><div class="pv-tiles">${tiles(art, bento)}</div>
        <p class="pv-note">${art ? '' : 'No art: the classic icons would be used (built-in theme).'}
        Layout: menu <b>${entry.layout.menu}</b>, picker <b>${entry.layout.picker}</b>, actions <b>${entry.layout.actions}</b>.</p></section>
    </div>`;
  document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === entry.id)));
  $('log').textContent = `Bundle of ${entry.id}: ${sizes[entry.id] ? `${sizes[entry.id]} bytes on the stage` : 'built in (css/theme.css)'}. Nothing else is fetched.`;
  // apply() put the brand mark of the art in #brandMark before render rebuilt the header: put it back
  if (art?.mark) {
    $('brandMark').classList.add('has-art');
    $('brandMark').insertAdjacentHTML('beforeend', `<span class="brand-art" aria-hidden="true">${art.mark}</span>`);
  }
}

let index = [];
try { index = await (await fetch('../out/index.json')).json(); } catch { /* not packed yet */ }
const bundles = {};
const entries = [...BUILTIN, ...index.map(i => ({ id: i.id, file: i.file, name: { en: i.id }, symbol: '<circle cx="12" cy="12" r="6"/>' }))];
$('picker').innerHTML = entries.map(t => `<button data-pick="${t.id}" aria-pressed="false">${glyph(t.symbol)}<span>${t.name.en}</span></button>`).join('');
if (!index.length) $('log').textContent = 'No bundles yet: run  node themes/tools/pack.mjs  and reload.';
$('picker').addEventListener('click', async e => {
  const b = e.target.closest('[data-pick]');
  const entry = b && entries.find(t => t.id === b.dataset.pick);
  if (!entry) return;
  if (entry.builtin) { ctl.select(entry.id); return; }
  bundles[entry.id] ??= await (await fetch(`../out/${entry.file}`)).json();
  sizes[entry.id] = JSON.stringify(bundles[entry.id]).length;
  if (!ctl.trial(bundles[entry.id])) $('log').textContent = `The game would refuse ${entry.id}: ${cleanBundle(bundles[entry.id], { known }) ? 'trial refused' : 'bundle rejected by webapp/src/themes/bundle.js'}.`;
});
ctl.onChange(render);
ctl.start();
