// Hover-only hint popovers: converts a static .hint block (or any element with a data-hint
// attribute) into a small "?" icon that reveals its text in a positioned popover only while the
// mouse is over the icon (or it has keyboard focus, for accessibility) — no permanently-visible
// inline text taking up vertical space in the panel.
//
// Two ways to attach a hint:
//  1. A static block already in the HTML: <div class="hint">explanation text</div> — call
//     initHints() once after the page's DOM is built; it converts every .hint element it finds
//     into an icon + popover pair, using the element's own text as the popover content.
//  2. A dynamically-created control (e.g. a button rendered by innerHTML after a click) — give it
//     data-hint="explanation text" and call attachHint(el) on it once it's in the DOM, or call
//     initHints(root) again scoped to the container that was just re-rendered (idempotent — it
//     skips elements already converted).

const POPOVER_CLASS = 'hint-popover';

function attachOne(el) {
  if (el.dataset.hintAttached) return; // idempotent — safe to re-run initHints after a re-render
  el.dataset.hintAttached = '1';
  // Prefer the element's existing markup (innerHTML) over data-hint/textContent when both the
  // element has child markup AND no explicit data-hint was given — some static hints contain a
  // live child element (e.g. design.html's generate() hint has a <code id="playFlagsHex"> another
  // module writes into before initHints() runs); flattening to textContent would silently discard
  // that node. A data-hint attribute (used for dynamically-created controls) always wins when set,
  // since those are plain strings by convention, not markup.
  const usingMarkup = el.dataset.hint == null && el.children.length > 0;
  const content = el.dataset.hint != null ? el.dataset.hint : (usingMarkup ? el.innerHTML.trim() : el.textContent.trim());
  el.dataset.hint = usingMarkup ? '' : content; // markup form isn't representable as a single data-hint string; leave empty rather than store lossy text
  el.innerHTML = '';
  el.classList.add('hint-icon');
  el.setAttribute('tabindex', '0'); // keyboard-focusable, so the popover is reachable without a mouse
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Show hint');
  const pop = document.createElement('div');
  pop.className = POPOVER_CLASS;
  if (usingMarkup) pop.innerHTML = content; else pop.textContent = content;
  el.appendChild(pop);

  const show = () => {
    pop.classList.add('show');
    // Flip above the icon if the popover would overflow the viewport's bottom edge — computed on
    // show (not on creation) since layout may have changed since attachOne ran.
    const r = pop.getBoundingClientRect();
    pop.classList.toggle('flip-up', r.bottom > window.innerHeight - 8);
    // Same idea horizontally: an icon near the right edge of the page (e.g. in the right-hand side
    // column) would push a left-anchored popover off-screen, so anchor it to the icon's right edge.
    pop.classList.toggle('flip-left', r.right > window.innerWidth - 8);
  };
  const hide = () => pop.classList.remove('show', 'flip-up', 'flip-left');
  el.addEventListener('mouseenter', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
}

// Converts every .hint element under `root` (default: whole document) into an icon+popover, and
// attaches any element carrying a bare data-hint attribute that isn't a .hint block. Safe to call
// repeatedly (e.g. after re-rendering a panel's innerHTML) — already-converted elements are skipped.
export function initHints(root = document) {
  root.querySelectorAll('.hint:not([data-hint-attached]), [data-hint]:not([data-hint-attached])').forEach(attachOne);
}

// Attach a single dynamically-created element (already has data-hint set) without rescanning the
// whole root — cheaper when only one new control was just added.
export function attachHint(el) { attachOne(el); }

// Updates the text of an already-attached hint (e.g. a status hint whose message changes with
// app state, like design/main.js's mode-dependent #hint). Setting .textContent directly on an
// attached element would destroy the popover child node initHints() built — use this instead.
// No-ops harmlessly (just sets data-hint) if the element hasn't been attached yet.
export function setHintText(el, text) {
  el.dataset.hint = text;
  const pop = el.querySelector(`.${POPOVER_CLASS}`);
  if (pop) pop.textContent = text; else attachOne(el); // not yet attached — attach now with this text
}
