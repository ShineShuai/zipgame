// The offer sheet: what a player sees when a theme is on offer (src/ui/theme-offer.js puts it on the page). Pure: the time left and the
// markup of the sheet's two steps (keep or leave; which of the player's themes to replace). `text(key, ...args)` is the app's translation.
import { esc } from './picker.js';

// 90 s -> "1:30", 2 h -> "2:00:00", more than a day -> "2d 3h"
export function formatLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const [d, h, m, r] = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = n => String(n).padStart(2, '0');
  if (d) return `${d}d ${h}h`;
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

const glyph = symbol => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-stroke)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbol}</svg>`;
const swatches = list => `<span class="theme-swatches" aria-hidden="true">${list.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>`;

// theme: { name, symbol, swatches }; left: the countdown text or null; replace: null (step one) or [{ id, name, symbol, swatches }]
// (step two: the player's themes, one of which the new one replaces); failed: the device refused the theme.
export function offerHtml({ theme, left = null, replace = null, failed = false }, text) {
  if (replace) {
    return `<p class="theme-offer-text">${esc(text('theme.offer.replace', theme.name))}</p>`
      + `<div class="theme-offer-list">${replace.map(r => `<button type="button" data-replace="${esc(r.id)}">${glyph(r.symbol)}<span class="theme-name">${esc(r.name)}</span>${swatches(r.swatches)}</button>`).join('')}</div>`
      + `<div class="theme-offer-actions"><button class="btn secondary" type="button" data-offer="back">${esc(text('theme.offer.back'))}</button></div>`;
  }
  return `<div class="theme-offer-head">${glyph(theme.symbol)}<div class="theme-offer-title"><b>${esc(theme.name)}</b><span>${esc(text('theme.offer.title'))}</span></div>${swatches(theme.swatches)}</div>`
    + `<p class="theme-offer-text">${esc(text('theme.offer.text'))}${left === null ? '' : ` <span data-left>${esc(left)}</span>`}</p>`
    + `${failed ? `<p class="theme-offer-text" role="alert">${esc(text('theme.offer.fail'))}</p>` : ''}`
    + `<div class="theme-offer-actions"><button class="btn secondary" type="button" data-offer="leave">${esc(text('theme.offer.leave'))}</button>`
    + `<button class="btn" type="button" data-offer="keep">${esc(text('theme.offer.keep'))}</button></div>`;
}
