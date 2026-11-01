// A short notice over the page that goes by itself (and can be closed): for things the player
// should hear while playing, like a sync that stopped working. role="status": a screen reader
// says it without taking the focus. One notice per `key` at a time: a new one replaces the old.
// -> { close() }.
export const NOTICE_MS = 10000;

// doc / setTimer: only tests pass them.
export function showNotice(
  { key, text, kind = 'info', ms = NOTICE_MS, dismiss = 'Close' },
  { doc = document, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  if (key) {
    for (const old of doc.querySelectorAll(`[data-notice="${key}"]`)) old.remove();
  }
  const el = doc.createElement('div');
  el.className = `notice notice-${kind}`;
  el.setAttribute('role', 'status');
  if (key) el.setAttribute('data-notice', key);
  const message = doc.createElement('span');
  message.className = 'notice-text';
  message.textContent = text;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'notice-close';
  button.setAttribute('aria-label', dismiss);
  button.textContent = '×';
  el.append(message, button);
  doc.body.append(el);
  let timer = null;
  const close = () => {
    clearTimer(timer);
    el.remove();
  };
  button.addEventListener('click', close);
  timer = setTimer(close, ms);
  return { close };
}
