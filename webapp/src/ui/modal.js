// Shared modal helpers (backdrop click / Escape close, copy-to-clipboard with fallback).
export function bindModal(backdrop) {
  const close = () => backdrop.classList.remove('show');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && backdrop.classList.contains('show')) close(); });
  return { open: () => backdrop.classList.add('show'), close, isOpen: () => backdrop.classList.contains('show') };
}
export async function copyText(ta, msg) {
  try { await navigator.clipboard.writeText(ta.value); msg.textContent = 'Copied to clipboard ✓'; }
  catch { ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } msg.textContent = 'Selected — press Ctrl/Cmd+C to copy.'; }
  msg.className = 'modal-msg ok';
}
