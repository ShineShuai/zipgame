// One way to show extra information, in two presentations chosen by the input device (not by the screen width):
//   pointer devices (hover): a popover next to the element, on hover or keyboard focus (CSS + main.js showRules);
//   touch devices: a bottom sheet (openSheet), and a long press on a type tile peeks at its rules (installPeek).
// The text is the same in both: it lives once in the markup (.variant-rules, .stat-tip, .tip-pop).

// Whether the main input cannot hover: a phone or a tablet (a laptop with a touch screen still has its mouse).
export const touchUI = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let sheet = null, opener = null;

export function closeSheet() {
  if (!sheet) return;
  sheet.remove();
  sheet = null;
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', onSheetKey, true);
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

function onSheetKey(e) {
  if (!sheet) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const focusable = [...sheet.querySelectorAll('button, [href], select, input, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// icon: trusted markup (an svg); title: text; html: trusted markup (the texts of the i18n dictionary); closeText: the button.
export function openSheet({ icon = '', title, html, closeText }) {
  closeSheet();
  opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet-grab"></div>
    <div class="sheet-head">${icon}<h2 id="sheetTitle">${esc(title)}</h2></div>
    <div class="sheet-body">${html}</div>
    <button type="button" class="btn" data-close>${esc(closeText)}</button>
  </div>`;
  document.body.appendChild(back);
  document.body.classList.add('sheet-open');
  sheet = back;
  const panel = back.firstElementChild;
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) closeSheet(); });
  // drag the handle or the head down to dismiss
  let from = null;
  const head = panel.querySelector('.sheet-grab, .sheet-head');
  panel.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !e.target.closest('.sheet-grab, .sheet-head')) return;
    from = e.clientY; panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', e => {
    if (from == null) return;
    panel.style.transform = `translateY(${Math.max(0, e.clientY - from)}px)`;
  });
  const drop = e => {
    if (from == null) return;
    const dy = e.clientY - from;
    from = null;
    panel.style.transform = '';
    if (dy > 80) closeSheet();
  };
  panel.addEventListener('pointerup', drop);
  panel.addEventListener('pointercancel', () => { from = null; panel.style.transform = ''; });
  document.addEventListener('keydown', onSheetKey, true);
  void head;
  back.querySelector('[data-close]').focus({ preventScroll: true });
}

// A long press (touch only, `ms` without moving more than `slop` px) on an element matching `selector` calls show(el); lifting the
// finger calls hide(el). The click that follows a peek is swallowed, so peeking does not pick the tile. Installed once, on the document.
export function installPeek({ selector, show, hide, ms = 380, slop = 10 }) {
  let timer = null, from = null, host = null, peeked = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const finish = () => {
    cancel();
    if (peeked && host) hide(host);
    if (peeked) setTimeout(() => { peeked = false; }, 450); // the click right after the lift is the one to swallow
  };
  document.addEventListener('pointerdown', e => {
    peeked = false;
    if (e.pointerType !== 'touch') return;
    const el = e.target.closest(selector);
    if (!el) return;
    host = el;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { peeked = true; show(el); if (navigator.vibrate) navigator.vibrate(8); }, ms);
  }, true);
  document.addEventListener('pointermove', e => {
    if (timer && from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > slop) cancel();
  }, true);
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
  document.addEventListener('click', e => {
    if (!peeked) return;
    e.preventDefault();
    e.stopPropagation();
    peeked = false;
  }, true);
  document.addEventListener('contextmenu', e => { if (touchUI() && e.target.closest(selector)) e.preventDefault(); });
}
