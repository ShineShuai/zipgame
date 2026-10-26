// The pool picker: the list a player chooses their theme from once the pool holds three or more (the header button steps through a
// pool of two). Pure: the items for a pool and the markup for them (every string in an entry was cleaned by pool.cleanEntry, but is
// escaped here anyway); src/ui/theme-picker.js puts it on the page.
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
