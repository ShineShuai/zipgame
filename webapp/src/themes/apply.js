// Puts a theme on the page: the attributes the CSS keys on (data-theme = which token block, data-mode = light or dark,
// data-menu / data-picker / data-actions = the layout presets), the theme's token block (one <style id="theme-css">, the
// same element the page's <head> script created from the local copy before the first paint), the browser bar colour and the
// brand mark. Idempotent: calling it again with the same theme changes nothing.
export const THEME_EVENT = 'zip-theme';
const STYLE_ID = 'theme-css';

function setStyle(doc, css) {
  let el = doc.getElementById(STYLE_ID);
  if (!css) { el?.remove(); return; }
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_ID;
    doc.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

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

// entry: a pool entry; loaded: { css, art } of a downloaded theme, null for a built-in. Fires 'zip-theme' ({ id, mode, art })
// so screens can draw again.
export function applyEntry(entry, loaded, doc = document) {
  const root = doc.documentElement;
  root.dataset.theme = entry.id;
  root.dataset.mode = entry.mode;
  for (const [axis, key] of Object.entries(entry.layout)) root.dataset[axis] = key;
  setStyle(doc, entry.builtin ? null : loaded?.css ?? null);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', entry.chrome);
  setMark(doc, loaded?.art?.mark ?? null);
  doc.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { id: entry.id, mode: entry.mode, art: loaded?.art ?? null } }));
}

// Registers a theme's fonts with the FontFace API (binary data: no url, so nothing for the CSP to allow). Returns { release }
// which takes them out again when the theme goes. `env` is injectable for tests.
export function loadFonts(fonts, env = { FontFace: globalThis.FontFace, set: globalThis.document?.fonts }) {
  const faces = [];
  if (!env.FontFace || !env.set) return { release() {} };
  for (const f of fonts) {
    try {
      const bytes = globalThis.Buffer ? Buffer.from(f.data, 'base64') : Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      const face = new env.FontFace(f.family, bytes, { weight: f.weight, display: 'swap' });
      env.set.add(face);
      faces.push(face);
      face.load?.().catch?.(() => {});
    } catch { /* a font that cannot load: the system stack is the fallback */ }
  }
  return { release() { for (const face of faces) env.set.delete(face); } };
}
