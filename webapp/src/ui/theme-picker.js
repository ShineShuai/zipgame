// The pool picker on the page: a small menu under the theme button. Arrow keys move, Enter or a tap chooses, Escape or a tap outside
// closes it and gives the focus back to the button. The items and markup are src/themes/picker.js.
// With the dev reveal on (`dev` is given) the menu also lists every theme of the site's pool: a tap tries one (nothing is kept, the
// cap does not matter), "+" keeps it, and a last row offers a theme as an event would.
import { devHtml, devItems, esc, pickerHtml, pickerItems } from '../themes/picker.js';

let open = null;

export function closeThemePicker() {
  if (!open) return;
  open.menu.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  document.removeEventListener('keydown', open.keys, true);
  open.anchor.setAttribute('aria-expanded', 'false');
  open = null;
}

// anchor: the header button; controller: src/themes/index.js; lang and title: for the names and the heading;
// dev: null, or { labels: { all, draft, keep, offer, none, nothing, loading }, offerNow() -> Promise<boolean> }.
export function toggleThemePicker(anchor, controller, lang, title, dev = null) {
  if (open) { closeThemePicker(); return; }
  const menu = document.createElement('div');
  menu.className = 'theme-picker';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', title);
  let list = null;    // the site's pool, once it has been read
  const here = () => open?.menu === menu;
  const draw = (focus = null) => {
    menu.innerHTML = pickerHtml(pickerItems(controller.state(), controller.current().id, lang), title) + (dev ? '<div class="theme-dev" data-dev></div>' : '');
    const host = menu.querySelector('[data-dev]');
    if (host) host.innerHTML = list ? devHtml(devItems(list, controller.current().id, lang), dev.labels) : `<div class="theme-picker-title">${esc(dev.labels.all)}</div><div class="theme-picker-empty">${esc(dev.labels.loading)}</div>`;
    if (focus) menu.querySelector(focus)?.focus();
  };
  const reload = async focus => { list = await controller.pool(); if (here()) draw(focus); };
  const note = text => { const el = menu.querySelector('[data-note]'); if (el) el.textContent = text; };

  draw();
  const box = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 8)}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - box.right))}px`;
  document.body.append(menu);
  const buttons = () => [...menu.querySelectorAll('button')];
  const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeThemePicker(); };
  const keys = e => {
    const items = buttons();
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeThemePicker(); anchor.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
    }
  };
  menu.addEventListener('click', async e => {
    const item = e.target.closest('[data-theme-id]');
    if (item) {
      controller.select(item.dataset.themeId);
      closeThemePicker();
      anchor.focus();
      return;
    }
    if (!dev) return;
    const [tried, kept, offer] = [e.target.closest('[data-try-id]'), e.target.closest('[data-keep-id]'), e.target.closest('[data-offer-now]')];
    if (tried) { await controller.tryPool(tried.dataset.tryId); if (here()) draw(`[data-try-id="${tried.dataset.tryId}"]`); }
    else if (kept) { await controller.keepPool(kept.dataset.keepId); await reload(`[data-try-id="${kept.dataset.keepId}"]`); }
    else if (offer) {
      if (await dev.offerNow()) closeThemePicker(); else note(dev.labels.nothing);
    }
  });
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  anchor.setAttribute('aria-expanded', 'true');
  open = { menu, anchor, outside, keys };
  (buttons().find(i => i.classList.contains('current')) ?? buttons()[0])?.focus();
  if (dev) reload();
}
