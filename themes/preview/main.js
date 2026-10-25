// Theme preview (dev page): the real controller, registry and apply code of the app (webapp/src/themes) on a page of mock
// screens. A theme is tried (pool.trial): its files are fetched only then, as in the game, and the log shows what came over
// the network. The sample screens read tokens only, so what you see is what the generated CSS and the art define.
import { CLASSIC_BOARD } from '../../webapp/src/themes/art.js';
import { createThemes } from '../../webapp/src/themes/index.js';
import { browserEnv, createRegistry } from '../../webapp/src/themes/registry.js';
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
const registry = createRegistry(browserEnv());
const ctl = createThemes({ storage, media: matchMedia('(prefers-color-scheme: dark)'), registry });

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
        <p class="pv-note">${art ? '' : 'No art module: the classic icons would be used (built-in theme).'}
        Layout: menu <b>${entry.layout.menu}</b>, picker <b>${entry.layout.picker}</b>, actions <b>${entry.layout.actions}</b>.</p></section>
    </div>`;
  document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === entry.id)));
  const files = performance.getEntriesByType('resource').map(r => new URL(r.name).pathname)
    .filter(p => /\/themes\/(?!preview\/)/.test(p) && !p.endsWith('.js')).map(p => p.replace(/^.*\/themes\//, 'themes/'));
  $('log').textContent = `Fetched from themes/ so far:\n${files.length ? [...new Set(files)].join('\n') : '(nothing: built-in themes ship with the page)'}`;
  // apply() put the brand mark of the art in #brandMark before render ran; render rebuilt the header, so put it back
  if (art?.mark) {
    $('brandMark').classList.add('has-art');
    $('brandMark').insertAdjacentHTML('beforeend', `<span class="brand-art" aria-hidden="true">${art.mark}</span>`);
  }
}

const catalog = await registry.catalog();
$('picker').innerHTML = catalog.map(t => `<button data-pick="${t.id}" aria-pressed="false">${glyph(t.symbol)}<span>${t.name.en}</span></button>`).join('');
$('picker').addEventListener('click', e => {
  const b = e.target.closest('[data-pick]');
  const entry = b && catalog.find(t => t.id === b.dataset.pick);
  if (!entry) return;
  if (entry.builtin) ctl.select(entry.id); else ctl.trial(entry);
});
ctl.onChange(render);
ctl.start();
