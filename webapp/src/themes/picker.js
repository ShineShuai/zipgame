// The pool picker: the list a player chooses their theme from once the pool holds three or more (the header button steps through a
// pool of two). Pure: the items for a pool and the markup for them (every string in an entry was cleaned by pool.cleanEntry, but is
// escaped here anyway); src/ui/theme-picker.js puts it on the page.
export const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// [{ id, name, symbol, swatches, current }] in pool order
export const pickerItems = (state, activeId, lang) => state.pool.map(e => ({
  id: e.id, name: e.name[lang] ?? e.name.en, symbol: e.symbol, swatches: e.swatches ?? [], current: e.id === activeId,
}));

export function pickerHtml(items, title) {
  const rows = items.map(i => `<button type="button" role="menuitemradio" aria-checked="${i.current}" data-theme-id="${esc(i.id)}"`
    + `${i.current ? ' class="current"' : ''}>`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-stroke)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.symbol}</svg>`
    + `<span class="theme-name">${esc(i.name)}</span>`
    + `<span class="theme-swatches" aria-hidden="true">${i.swatches.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span></button>`);
  return `<div class="theme-picker-title">${esc(title)}</div>${rows.join('')}`;
}

// ---- the dev reveal: every theme of the site's pool (controller.pool()), drafts included ----
// [{ id, name, symbol, swatches, live, owned, current }] in manifest order
export const devItems = (list, activeId, lang) => list.map(c => ({
  id: c.entry.id, name: c.entry.name[lang] ?? c.entry.name.en, symbol: c.entry.symbol, swatches: c.entry.swatches ?? [], live: c.live, owned: c.owned, current: c.entry.id === activeId,
}));

// labels: { all, draft, keep, offer, none }. A row: the theme (tap: try it, nothing is kept) and "+" (keep it, whatever the cap);
// the footer starts an offer as an event would.
export function devHtml(items, labels) {
  const rows = items.map(i => `<div class="theme-dev-row"><button type="button" data-try-id="${esc(i.id)}"${i.current ? ' class="current"' : ''}>`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-stroke)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.symbol}</svg>`
    + `<span class="theme-name">${esc(i.name)}${i.live ? '' : ` <em class="theme-draft">${esc(labels.draft)}</em>`}</span>`
    + `<span class="theme-swatches" aria-hidden="true">${i.swatches.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span></button>`
    + `${i.owned ? '' : `<button type="button" class="theme-keep" data-keep-id="${esc(i.id)}" aria-label="${esc(labels.keep)}" title="${esc(labels.keep)}">+</button>`}</div>`);
  return `<div class="theme-picker-title">${esc(labels.all)}</div>${rows.join('') || `<div class="theme-picker-empty">${esc(labels.none)}</div>`}`
    + `<button type="button" class="theme-offer-now" data-offer-now>${esc(labels.offer)}</button><div class="theme-picker-empty" data-note role="status"></div>`;
}
