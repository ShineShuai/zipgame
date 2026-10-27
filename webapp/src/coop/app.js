import { pickStorage } from '../platform/storage.js';
import { openScreen } from './screen.js';
import { loadStats, saveStats } from './stats.js';

// The lifecycle of Patchwork: the screen that the menu's card (or an invite link) opens. Everything
// it does is guarded: a failure removes its own elements and leaves the app as it was.
let revealed = false;
let screen = null;
let styles = null;

// The stylesheet is waited for, so that the screen never shows unstyled for a moment.
function ensureStyles() {
  if (styles) {
    return styles.ready;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./coop.css', import.meta.url).href;
  const ready = new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
  document.head.append(link);
  styles = { link, ready };
  return ready;
}

// Leaves nothing of Patchwork behind: no screen, the app's page as it was.
export function destroy() {
  screen?.close();
  screen = null;
}

function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.warn('coop: stopped after an error', error);
      document.getElementById('coopRoot')?.remove();
      const host = document.getElementById('app');
      if (host) {
        host.style.display = '';
      }
      screen = null;
      return undefined;
    }
  };
}

// What the player has unlocked, asked of the menu (apps/play/menu.js answers zip:coop-access at
// once). With no answer only the standard type is on offer: a lock is never opened by mistake.
function askAccess() {
  let answer = null;
  document.dispatchEvent(new CustomEvent('zip:coop-access', {
    detail: { reply: info => { answer = info; } },
  }));
  return answer ?? { access: { standard: 'all' }, sizes: {}, solid: false };
}

// Opens the screen in place of the app's page (the menu); closing it brings the page back.
export const open = guard(async () => {
  if (screen) {
    return;
  }
  await ensureStyles();
  const storage = await pickStorage();
  const stats = await loadStats(storage);
  screen = openScreen({
    stats,
    storage,
    saveStats: guard(() => saveStats(storage, stats)),
    isRevealed: () => revealed,
    access: askAccess,
    onClose: () => {
      screen = null;
    },
  });
});

// Called by boot.js when the page was opened by an invite link: Patchwork opens by itself, as the
// guest. `code` is the host's connection offer (#c=) or, with `room`, the token of its room (#j=).
export const openFromLink = guard(async (code, room = false) => {
  await open();
  screen?.joinFrom(code, room);
});

// Called by boot.js whenever the app's hidden things are revealed (true) or hidden (false).
export function reveal(on) {
  revealed = on;
  screen?.setRevealed(on);
}
