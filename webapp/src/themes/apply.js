// Puts a theme on the page: the attributes the CSS keys on (data-theme = which token block, data-mode = light or dark,
// data-menu / data-picker / data-actions = the layout presets), the browser bar colour, and the brand mark. Idempotent:
// the page's <head> script has already set the attributes before the first paint; this is the same, plus the art.
export const THEME_EVENT = 'zip-theme';

function setMark(doc, svg) {
  const holder = doc.getElementById('brandMark');
  if (!holder) return;
  holder.querySelector('.brand-art')?.remove();
  holder.classList.toggle('has-art', Boolean(svg));
  if (svg) {
    const span = doc.createElement('span');
    span.className = 'brand-art';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = svg;   // rebuilt from the whitelist in svg.js
    holder.append(span);
  }
}

// entry: a pool entry; art: its cleaned art or null. Fires 'zip-theme' ({ id, mode, art }) so screens can draw again.
export function applyEntry(entry, art, doc = document) {
  const root = doc.documentElement;
  root.dataset.theme = entry.id;
  root.dataset.mode = entry.mode;
  for (const [axis, key] of Object.entries(entry.layout)) root.dataset[axis] = key;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', entry.chrome);
  setMark(doc, art?.mark ?? null);
  doc.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { id: entry.id, mode: entry.mode, art } }));
}
