import { ENABLED } from './config.js';

// The only file of the trial that the app loads up front (one <script type="module"> tag in
// index.html, placed before the app's own script). It stays tiny: until the app's hidden things
// are revealed for the first time (or an invite link is opened) it does nothing, and then it loads
// the rest. Delete src/coop to remove the trial; with ENABLED = false this file registers nothing.
let wanted = false;
let loading = null;
let app = null;

function load() {
  loading ??= import('./app.js').then(module => {
    app = module;
  });
  return loading;
}

async function onReveal(event) {
  wanted = Boolean(event.detail);
  try {
    if (wanted) {
      await load();
    }
    app?.reveal(wanted);
  } catch (error) {
    loading = null;
    console.warn('coop: not loaded', error);
  }
}

// A page opened by an invite link (#coop=<code>) opens the trial as the guest, with no reveal.
async function openInvite() {
  const code = location.hash.slice('#coop='.length);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    await load();
    await app.openFromLink(code);
  } catch (error) {
    loading = null;
    console.warn('coop: the invite could not be opened', error);
  }
}

if (ENABLED) {
  document.addEventListener('zip:reveal', onReveal);
  if (location.hash.startsWith('#coop=')) {
    openInvite();
  }
}
