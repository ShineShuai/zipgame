// The offer sheet on the page: a theme is on trial (the whole page already wears it) and a small sheet at the bottom asks the player to
// keep it or leave it. Keeping a theme with a full pool asks which of the player's themes it replaces. The sheet goes when the player
// answers, when the theme stops showing (the event ended, another choice) or when the time runs out. Markup: src/themes/offer.js.
import { formatLeft, offerHtml } from '../themes/offer.js';

let open = null;

export function closeThemeOffer() { open?.close(); }

// controller: src/themes/index.js; trial: what controller.event returned; until: ms or null; text, lang: the app's translation and language.
export function showThemeOffer({
  controller, trial, until = null, text, lang, now = Date.now,
}) {
  closeThemeOffer();
  const nameOf = e => e.name[lang] ?? e.name.en;
  const view = e => ({ id: e.id, name: nameOf(e), symbol: e.symbol, swatches: e.swatches ?? [] });
  const root = document.createElement('div');
  root.className = 'theme-offer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', text('theme.offer.title'));
  let step = 'offer';
  let failed = false;
  let ticker = null;
  let stopWatching = () => {};
  let closed = false;

  const left = () => (until ? text('theme.offer.left', formatLeft(until - now())) : null);
  const render = () => {
    root.innerHTML = offerHtml({
      theme: view(trial.entry), left: left(), failed, replace: step === 'replace' ? controller.state().pool.map(view) : null,
    }, text);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    stopWatching();
    root.remove();
    if (open?.root === root) open = null;
  };
  const commit = async replaceId => {
    if (await trial.commit(replaceId)) { close(); return; }
    failed = true;
    step = 'offer';
    render();
  };

  root.addEventListener('click', e => {
    const button = e.target.closest('[data-offer], [data-replace]');
    if (!button) return;
    const { offer, replace } = button.dataset;
    if (replace) commit(replace);
    else if (offer === 'leave') { trial.revert(); close(); }
    else if (offer === 'back') { step = 'offer'; render(); }
    else if (offer === 'keep') {
      const { pool, cap } = controller.state();
      if (pool.length >= cap) { step = 'replace'; render(); } else commit();
    }
  });
  // the theme stopped showing (the event ended, the player chose another theme): nothing left to decide
  stopWatching = controller.onChange(() => { if (controller.current().id !== trial.entry.id) close(); });
  if (until) {
    ticker = setInterval(() => {
      if (until <= now()) { close(); return; }
      const el = root.querySelector('[data-left]');
      if (el) el.textContent = left();
    }, 1000);
  }
  render();
  document.body.append(root);
  open = { root, close };
}
