// The offer on the page (src/ui/theme-offer.js puts it there). Pure: the time left, the chip (a small pill: "try it", the trial's countdown,
// "keep it?") and the markup of the sheet's two steps (keep or leave; which of the player's themes to replace). `text(key, ...args)` is the
// app's translation.
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

// The chip's content. phase: 'pending' (tap to try; a `left` text: the rest of an interrupted trial), 'trial' (the theme and its
// countdown text), 'final' (keep it?). theme: { name, symbol }; trialMs: the whole trial, in ms.
export function chipHtml({ phase, theme, left = '', trialMs = 0 }, text) {
  if (phase === 'trial') return `${glyph(theme.symbol)}<b>${esc(theme.name)}</b><span data-left>${esc(left)}</span>`;
  if (phase === 'final') return `${glyph(theme.symbol)}<span>${esc(text('theme.offer.finalChip', theme.name))}</span>`;
  return `${glyph(theme.symbol)}<span>${esc(left ? text('theme.offer.resume', left) : text('theme.offer.try', Math.round(trialMs / 60000)))}</span>`;
}

// theme: { name, symbol, swatches }; left: the countdown text or null; replace: null (step one) or [{ id, name, symbol, swatches }]
// (step two: the player's themes, one of which the new one replaces); failed: the device refused the theme; phase: 'trial' or 'final'
// (the time is up: "keep it?"); minimize: the sheet can be folded into the chip.
export function offerHtml({
  theme, left = null, replace = null, failed = false, phase = 'trial', minimize = false,
}, text) {
  if (replace) {
    return `<p class="theme-offer-text">${esc(text('theme.offer.replace', theme.name))}</p>`
      + `<div class="theme-offer-list">${replace.map(r => `<button type="button" data-replace="${esc(r.id)}">${glyph(r.symbol)}<span class="theme-name">${esc(r.name)}</span>${swatches(r.swatches)}</button>`).join('')}</div>`
      + `<div class="theme-offer-actions"><button class="btn secondary" type="button" data-offer="back">${esc(text('theme.offer.back'))}</button></div>`;
  }
  return `<div class="theme-offer-head">${glyph(theme.symbol)}<div class="theme-offer-title"><b>${esc(theme.name)}</b><span>${esc(text(phase === 'final' ? 'theme.offer.finalTitle' : 'theme.offer.title'))}</span></div>${swatches(theme.swatches)}`
    + `${minimize ? `<button class="theme-offer-min" type="button" data-offer="minimize" aria-label="${esc(text('theme.offer.minimize'))}" title="${esc(text('theme.offer.minimize'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>` : ''}</div>`
    + `<p class="theme-offer-text">${esc(text(phase === 'final' ? 'theme.offer.finalText' : 'theme.offer.text'))}${left === null ? '' : ` <span data-left>${esc(left)}</span>`}</p>`
    + `${failed ? `<p class="theme-offer-text" role="alert">${esc(text('theme.offer.fail'))}</p>` : ''}`
    + `<div class="theme-offer-actions"><button class="btn secondary" type="button" data-offer="leave">${esc(text('theme.offer.leave'))}</button>`
    + `<button class="btn" type="button" data-offer="keep">${esc(text('theme.offer.keep'))}</button></div>`;
}
