import { pickStorage } from '../platform/storage.js';
import { openScreen } from './screen.js';
import { loadStats, saveStats } from './stats.js';
import { tx } from './texts.js';

// The lifecycle of the trial: the pill that appears while the app's hidden things are revealed,
// and the overlay it opens. Everything the trial does is guarded: a failure removes the trial's
// own elements and leaves the app as it was.
let revealed = false;
let pill = null;
let screen = null;
let styles = null;

function ensureStyles() {
  if (styles) {
    return;
  }
  styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = new URL('./coop.css', import.meta.url).href;
  document.head.append(styles);
}

function hidePill() {
  pill?.remove();
  pill = null;
}

function showPill() {
  if (pill || screen) {
    return;
  }
  pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'coopPill';
  pill.className = 'coop-pill';
  pill.textContent = tx('pill');
  pill.addEventListener('click', () => guard(open)());
  document.body.append(pill);
}

// Leaves nothing of the trial behind: no overlay, no pill.
export function destroy() {
  screen?.close();
  screen = null;
  hidePill();
}

function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.warn('coop: stopped after an error', error);
      document.getElementById('coopRoot')?.remove();
      screen = null;
      hidePill();
      return undefined;
    }
  };
}

async function open() {
  if (screen) {
    return;
  }
  const storage = await pickStorage();
  const stats = await loadStats(storage);
  hidePill();
  screen = openScreen({
    stats,
    saveStats: guard(() => saveStats(storage, stats)),
    isRevealed: () => revealed,
    onClose: () => {
      screen = null;
      if (revealed) {
        showPill();
      }
    },
  });
}

// Called by boot.js when the page was opened by an invite link (#coop=<code>): the trial opens
// by itself, as the guest. The code is the invite of the host.
export const openFromLink = guard(async code => {
  ensureStyles();
  await open();
  screen?.joinFrom(code);
});

// Called by boot.js whenever the app's hidden things are revealed (true) or hidden (false).
export function reveal(on) {
  revealed = on;
  ensureStyles();
  screen?.setRevealed(on);
  if (on) {
    showPill();
  } else {
    hidePill();
  }
}
