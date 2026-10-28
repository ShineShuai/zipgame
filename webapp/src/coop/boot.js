import { ENABLED, RELEASED } from './config.js';
import { refreshModules, wasReloaded } from './fresh.js';

// The only file of Patchwork that the app loads up front (one <script type="module"> tag in
// index.html, placed before the app's own script). It stays tiny: it tells the menu that the game is
// there (data-coop on <html>: the menu draws its card from it) and does nothing else until the
// card is pressed (or an invite link is opened); then it loads the rest. Delete src/coop to remove
// Patchwork; with ENABLED = false this file registers nothing.
let revealed = false;
let loading = null;
let app = null;

// After a reload the modules are fetched afresh first (fresh.js): the browser's reload skips its
// cache for what the page loads before it is done, not for the modules imported now.
function load() {
  loading ??= (async () => {
    const entry = new URL('./app.js', import.meta.url).href;
    if (wasReloaded()) {
      await refreshModules(entry);
    }
    app = await import(entry);
  })();
  return loading;
}

// The app's hidden things are revealed (true) or hidden (false): passed on once Patchwork is loaded.
function onReveal(event) {
  revealed = Boolean(event.detail);
  app?.reveal(revealed);
}

// The menu's card was pressed.
async function onOpen() {
  try {
    await load();
    app.reveal(revealed);
    await app.open();
  } catch (error) {
    loading = null;
    console.warn('coop: not loaded', error);
  }
}

// A page opened by an invite link opens Patchwork as the guest, with no reveal: #j=<token> (the
// host's room, join.js) or #c=<code> (older: #coop=<code>), the host's connection offer itself.
const INVITE = /^#(?:c|coop|j)=/;

async function openInvite() {
  const code = location.hash.replace(INVITE, '');
  const room = location.hash.startsWith('#j=');
  history.replaceState(null, '', location.pathname + location.search);
  try {
    await load();
    await app.openFromLink(code, room);
  } catch (error) {
    loading = null;
    console.warn('coop: the invite could not be opened', error);
  }
}

if (ENABLED) {
  document.documentElement.dataset.coop = RELEASED ? 'open' : 'hidden';
  document.addEventListener('zip:reveal', onReveal);
  document.addEventListener('zip:coop-open', onOpen);
  if (INVITE.test(location.hash)) {
    openInvite();
  }
}
