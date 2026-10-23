// Rules tooltips and sheets, the small info popovers of the menu and the export dialog.
import { touchUI, openSheet } from '../../ui/info.js';
import { t } from '../../ui/i18n.js';
import { $, S, modal, rulesSeen } from './state.js';

// The export window, with `text` (a puzzle in the plain text format the design app reads).
export function openExport(text) {
  $('exportText').value = text;
  $('exportMsg').textContent = '';
  modal.open();
  setTimeout(() => $('exportText').focus(), 30);
}
export const closeStatTips = () => document.querySelectorAll('.stat-item.open').forEach(b => b.classList.remove('open'));
// The rules of the puzzle being played, as a small (i) after the title in the game screen: the same tooltip as the
// type's tile in the menu (the text is the tile's), so a player can look the rules up while playing. The first time a
// variant is played it opens by itself (maybeShowRules).
export function rulesTipHtml() {
  const mode = S.variant || 'standard';
  return `<button type="button" class="tip-btn rules-btn" id="rulesTip" aria-label="${t('game.rulesLabel')}" aria-describedby="rulesTipPop">i</button>`
    + `<span class="variant-rules" id="rulesTipPop" role="tooltip"><b class="pop-title">${t('mode.' + mode)}</b>${t('mode.' + mode + 'Rules')}</span>`;
}
// The first game of a variant on this device shows its rules without being asked, once. It closes like any rules
// tooltip: by a press anywhere else (the first press on the board starts the path), a tap, or Esc.
export function maybeShowRules() {
  if (!S.variant || !rulesSeen || rulesSeen.seen(S.variant) || !$('hudTitle')) return;
  rulesSeen.mark(S.variant);
  if (touchUI()) openRulesSheet('rulesTipPop'); else showRules($('hudTitle'));
}

// The rules tooltip of a puzzle type tile (and of the game screen's title): shown on hover, keyboard focus or a tap, and moved sideways to stay
// inside the window (a tile at the edge of the card). Esc or a tap elsewhere closes it.
export const closeRules = () => document.querySelectorAll('.variant-rules.show').forEach(pop => pop.classList.remove('show'));
export function showRules(opt) {
  closeRules();
  const pop = opt.querySelector('.variant-rules');
  pop.style.transform = 'translateX(-50%)';
  pop.classList.add('show');
  const r = pop.getBoundingClientRect(), edge = 8;
  const dx = Math.max(edge - r.left, Math.min(0, innerWidth - edge - r.right));
  pop.style.transform = `translateX(calc(-50% + ${dx}px))`;
  pop.style.setProperty('--arrow', `calc(50% - ${dx}px)`); // the arrow keeps pointing at the tile
}

// A long press on a tile (touch) peeks at its rules above it while the finger stays down; lifting closes it, the tile is not picked.
export function showPeek(opt) {
  closeRules();
  const pop = opt.querySelector('.variant-rules');
  if (!pop) return;
  pop.classList.add('above', 'peek');
  showRules(opt);
}
export function hidePeek(opt) {
  const pop = opt.querySelector('.variant-rules');
  if (pop) pop.classList.remove('above', 'peek', 'show');
}

// The rules of a type as a bottom sheet (touch): its icon, name and rules text, from the popover's markup.
export function openRulesSheet(popId) {
  const pop = $(popId);
  if (!pop) return;
  const body = pop.cloneNode(true);
  const title = body.querySelector('.pop-title');
  const name = title ? title.textContent : '';
  if (title) title.remove();
  const host = pop.closest('.variant-opt, .rules-host');
  const icon = host && host.querySelector('.variant-icon');
  openSheet({ icon: icon ? icon.outerHTML : '', title: name, html: body.innerHTML, closeText: t('sheet.close') });
}

export function setShareTip(open) {
  const pop = $('shareTipPop');
  const button = $('shareTip');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (!open) button.blur(); // a focused button would keep the tip visible (:focus-visible)
}

export function toggleShareTip(ev) {
  ev.stopPropagation();
  if (touchUI()) return openTipSheet('shareTipPop', t('info.shared'));
  setShareTip(!$('shareTipPop').classList.contains('open'));
}

export function setLuckyTip(open) {
  const pop = $('luckyTipPop'), button = $('luckyTip');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (!open) button.blur();
}
export function setGiftTip(open) {
  const pop = $('giftTipPop'), button = $('giftTip');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (!open) button.blur();
}
export function toggleGiftTip(ev) {
  ev.stopPropagation();
  if (touchUI()) return openTipSheet('giftTipPop', t('info.gift'));
  setGiftTip(!$('giftTipPop').classList.contains('open'));
}
export function setChanceTip(open) {
  const pop = $('luckyChancePop'), button = $('luckyChance');
  if (!pop || !button) return;
  pop.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
}
export function toggleChanceTip(ev) {
  ev.stopPropagation();
  if (touchUI()) return openTipSheet('luckyChancePop', t('info.chances'));
  setChanceTip(!$('luckyChancePop').classList.contains('open'));
}
export function toggleLuckyTip(ev) {
  ev.stopPropagation();
  if (touchUI()) return openTipSheet('luckyTipPop', t('info.lucky'));
  setLuckyTip(!$('luckyTipPop').classList.contains('open'));
}
// On a touch screen the (i) buttons and the status cards open a bottom sheet with the text of their popover (ui/info.js).
function openTipSheet(popId, title, icon = '') {
  const pop = $(popId);
  if (pop) openSheet({ icon, title, html: pop.innerHTML, closeText: t('sheet.close') });
}
