// The theme offer on the page (the controller keeps the offer: src/themes/index.js, trial.js). It is a chip, never a window over the game:
//   pending  "A rare theme today: try it for 30 min" -- a tap starts the trial (the page then wears the theme)
//   trial    the theme's name and the time left; a tap opens the sheet (keep / leave / minimize)
//   final    the time is up and the theme has left the page: "Keep it?" -- the sheet is open until the player answers or the day ends
// The chip (top right, under the app bar) and the sheet (bottom) show on menu screens only (`idle()`): during a puzzle the trial's clock
// runs and nothing is drawn. Keeping a theme with a full pool asks which of the player's themes it replaces; the clock waits meanwhile.
// The sheet states the public rule of the offer days; its (i) opens the info panel, a sheet that
// explains the rule (src/themes/calendar.js).
// Markup: src/themes/offer.js. A theme slot earned shows a short notice (`showSlotToast`).
import { ruleExample } from '../themes/calendar.js';
import { chipHtml, formatLeft, offerHtml, ruleHtml } from '../themes/offer.js';
import { openSheet } from './info.js';

const TOAST_MS = 6000;

// controller: src/themes/index.js; text, lang(): the app's translation and language; idle(): true on a screen where it may show.
export function initThemeOffer({
  controller, text, lang, idle = () => true,
}) {
  const nameOf = e => e.name[lang()] ?? e.name.en;
  const view = e => ({ id: e.id, name: nameOf(e), symbol: e.symbol, swatches: e.swatches ?? [] });
  const root = document.createElement('div');
  root.className = 'theme-offer-host';
  root.hidden = true;
  const chip = document.createElement('button');
  chip.type = 'button';
  const sheet = document.createElement('div');
  sheet.className = 'theme-offer';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'false');
  sheet.setAttribute('aria-label', text('theme.offer.title'));
  root.append(chip, sheet);
  document.body.append(root);

  let expanded = false;
  let step = 'offer';
  let failed = false;
  let lastPhase = null;
  let lastKey = '';

  const countdown = v => (v.phase === 'trial' ? text('theme.offer.left', formatLeft(v.left)) : null);
  const leftText = v => (v.phase === 'trial' ? formatLeft(v.left) : (v.phase === 'pending' && v.left < v.trialMs ? formatLeft(v.left) : ''));
  const sheetLeft = v => text('theme.offer.left', formatLeft(v.phase === 'final' ? v.until - Date.now() : v.left));

  function render() {
    const v = controller.offerView();
    if (!v || !idle()) {
      root.hidden = true;
      if (v) controller.holdOffer(false);
      lastKey = '';
      return;
    }
    root.hidden = false;
    if (v.phase !== lastPhase) { lastPhase = v.phase; expanded = v.phase === 'final'; step = 'offer'; failed = false; }
    const open = expanded && v.phase !== 'pending';
    const key = JSON.stringify([v.phase, open, step, failed, v.entry.id, lang()]);
    if (key !== lastKey) {
      lastKey = key;
      const theme = view(v.entry);
      chip.className = `theme-chip theme-chip-${v.phase}`;
      chip.hidden = open;
      chip.innerHTML = chipHtml({ phase: v.phase, theme, left: leftText(v), trialMs: v.trialMs }, text);
      chip.setAttribute('aria-label', text(v.phase === 'pending' ? 'theme.offer.try' : 'theme.offer.open', Math.round(v.trialMs / 60000)));
      sheet.hidden = !open;
      if (open) {
        sheet.innerHTML = offerHtml({
          theme, left: sheetLeft(v), failed, phase: v.phase, minimize: true, replace: step === 'replace' ? controller.state().pool.map(view) : null,
        }, text);
      }
      controller.holdOffer(open && step === 'replace');
    } else {   // only the time moves
      const el = (chip.hidden ? sheet : chip).querySelector('[data-left]');
      if (el) el.textContent = chip.hidden ? sheetLeft(v) : formatLeft(v.left);
    }
  }

  const showRule = () => openSheet({
    title: text('theme.rule.title'),
    html: ruleHtml(text, ruleExample()),
    closeText: text('sheet.close'),
  });
  const keep = async replaceId => {
    if (await controller.keepOffer(replaceId)) return;
    failed = true;
    step = 'offer';
    lastKey = '';
    render();
  };
  chip.addEventListener('click', () => {
    const v = controller.offerView();
    if (!v) return;
    if (v.phase === 'pending') controller.startOffer();
    else { expanded = true; lastKey = ''; render(); }
  });
  sheet.addEventListener('click', e => {
    const button = e.target.closest('[data-offer], [data-replace]');
    if (!button) return;
    const { offer, replace } = button.dataset;
    if (replace) keep(replace);
    else if (offer === 'leave') controller.leaveOffer();
    else if (offer === 'rule') showRule();
    else if (offer === 'minimize') { expanded = false; lastKey = ''; render(); }
    else if (offer === 'back') { step = 'offer'; lastKey = ''; render(); }
    else if (offer === 'keep') {
      const { pool, cap } = controller.state();
      if (pool.length >= cap) { step = 'replace'; lastKey = ''; render(); } else keep();
    }
  });
  controller.onChange(() => { lastKey = ''; render(); });
  setInterval(render, 1000);   // the countdown, and a screen that came or went (menu / puzzle)
  render();
  return { render };
}

// A short notice that a theme slot was earned: cap = the slots the player has now.
export function showSlotToast({ text, cap }) {
  const el = document.createElement('div');
  el.className = 'theme-toast';
  el.setAttribute('role', 'status');
  el.textContent = text('theme.slot.earned', cap);
  document.body.append(el);
  setTimeout(() => el.remove(), TOAST_MS);
}
