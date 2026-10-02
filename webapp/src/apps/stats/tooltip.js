// One floating tooltip for all charts: hovering (or tapping) any element with data-tip="line\nline" shows its text next to the pointer.
const OFFSET = 14;

export function initTooltip(root = document) {
  const box = document.createElement('div');
  box.className = 'tip';
  box.hidden = true;
  document.body.append(box);

  const place = event => {
    const left = Math.min(event.clientX + OFFSET, window.innerWidth - box.offsetWidth - OFFSET);
    const below = event.clientY + OFFSET;
    const fitsBelow = below + box.offsetHeight < window.innerHeight;
    box.style.left = `${Math.max(OFFSET / 2, left)}px`;
    box.style.top = `${fitsBelow ? below : event.clientY - OFFSET - box.offsetHeight}px`;
  };

  root.addEventListener('pointerover', event => {
    const target = event.target.closest('[data-tip]');
    box.hidden = !target;
    if (!target) return;
    box.textContent = target.dataset.tip;
    place(event);
  });
  root.addEventListener('pointermove', event => {
    if (!box.hidden) place(event);
  });
  root.addEventListener('pointerleave', () => {
    box.hidden = true;
  });
  return box;
}
