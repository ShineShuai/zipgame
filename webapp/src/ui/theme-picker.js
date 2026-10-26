// The pool picker on the page: a small menu under the theme button. Arrow keys move, Enter or a tap chooses, Escape or a tap outside
// closes it and gives the focus back to the button. The items and markup are src/themes/picker.js.
import { pickerHtml, pickerItems } from '../themes/picker.js';

let open = null;

export function closeThemePicker() {
  if (!open) return;
  open.menu.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  document.removeEventListener('keydown', open.keys, true);
  open.anchor.setAttribute('aria-expanded', 'false');
  open = null;
}

// anchor: the header button; controller: src/themes/index.js; lang and title: for the names and the heading.
export function toggleThemePicker(anchor, controller, lang, title) {
  if (open) { closeThemePicker(); return; }
  const menu = document.createElement('div');
  menu.className = 'theme-picker';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', title);
  menu.innerHTML = pickerHtml(pickerItems(controller.state(), controller.current().id, lang), title);
  const box = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 8)}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - box.right))}px`;
  document.body.append(menu);
  const items = [...menu.querySelectorAll('button')];
  const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeThemePicker(); };
  const keys = e => {
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeThemePicker(); anchor.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
    }
  };
  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-theme-id]');
    if (!item) return;
    controller.select(item.dataset.themeId);
    closeThemePicker();
    anchor.focus();
  });
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  anchor.setAttribute('aria-expanded', 'true');
  open = { menu, anchor, outside, keys };
  (items.find(i => i.classList.contains('current')) ?? items[0])?.focus();
}
