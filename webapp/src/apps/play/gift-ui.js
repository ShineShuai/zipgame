// The happiest-day gift: its box in the menu, the toast offered on every screen, claiming it.
import { dateOfDay } from '../../features/daily.js';
import { dateLabel } from '../../features/share.js';
import { openSheet } from '../../ui/info.js';
import { LIST_DAYS, listDays, drawKind, present } from '../../features/gift.js';
import { giftInfo } from '../../core/gift.js';
import { t } from '../../ui/i18n.js';
import { $, S, dayNo, gift, giftRef, randomInt, render, replay, unlock } from './state.js';
import { ICON } from './menu-kit.js';
import { unlockView } from './lucky-ui.js';

// The happiest-day gift (core/gift.js, features/gift.js), above the menu cards. Its (i) explains how the day is chosen and, once enough
// gifts exist, lists the latest happiest days; it never says what the reference day is, so a player has to work that out from the list.
// While V is held and no gift is open, a test gift (day DEV_GIFT_DAY) stands in for it, so the box, the button and the toast can be checked.
const DEV_GIFT_DAY = -1;
export function giftOf() {
  const real = gift ? gift.view() : null;
  return real || !(gift && S.showDev) ? real : { day: DEV_GIFT_DAY, opened: S.giftTest !== null, kind: S.giftTest, test: true };
}
// The dev note under the gift box (hold V; English only, like the other dev notes).
function giftDevText(g) {
  const info = giftInfo(giftRef, dayNo());
  if (!info) return 'gift dev: off, SOLID_RELEASE.first is null (the rule needs a reference day)';
  const date = d => (d === null ? '-' : dateLabel(dateOfDay(d))), rec = gift.record(), c = info.chain;
  const today = info.n < 1 ? 'before the reference day' : `n ${info.n}, ${c.happy ? 'happy' : 'unhappy'}, ${c.steps} steps, peak ${c.peak}`;
  return [
    `gift dev: reference day ${date(info.ref)} (day 1) · today ${today} · happiest day today: ${info.today ? 'yes' : 'no'}`,
    `first ${date(info.first)} · last ${date(info.last)} · next ${date(info.next)}${info.next === null ? '' : ` (in ${info.next - dayNo()} d)`}`
      + ` · so far ${info.count} (the tooltip lists from ${LIST_DAYS})`,
    `upcoming: ${info.upcoming.map(date).join(', ') || '-'}`,
    `opened: ${rec && rec.day !== null ? `${date(rec.day)} ${rec.kind}` : 'never'}${g.test ? ` · test gift: ${g.opened ? `${g.kind}, nothing granted` : 'not opened (opening it only draws, nothing is granted or stored)'}` : ''}`,
  ].join('<br>');
}
function giftHowHtml() {
  const days = listDays(giftRef, dayNo()), latest = days.at(-1);
  const chips = days.map(d => `<span${d === latest ? ' class="win"' : ''}>${dateLabel(dateOfDay(d))}</span>`).join('');
  const guess = days.length ? `${t('gift.recent')}<span class="gift-days">${chips}</span>` : t('gift.soon');
  return `<b>${t('gift.how')}</b><br>${t('gift.howText')}<br>${guess}`;
}
const giftKindText = kind => t(kind === 'unlock' ? 'reward.unlock' : 'reward.replay');
export function giftBoxHtml(g) {
  const text = g.opened ? t('gift.opened', giftKindText(g.kind)) : t('gift.ready');
  const open = g.opened ? '' : `<button class="btn" id="giftOpen">${t('gift.open')}</button>`;
  return `
      <div class="lucky-box ready gift-box">
        <div class="lucky-row gift">
          <span class="lucky-icon">${ICON.gift}</span>
          <div class="lucky-text"><b>${t('gift.title')}</b><small>${text}</small></div>
          <button type="button" class="tip-btn" id="giftTip" aria-expanded="false" aria-label="${t('gift.how')}">i</button>
          <span class="tip-pop" id="giftTipPop" role="tooltip">${giftHowHtml()}</span>
          ${open}
        </div>
        ${S.showDev ? `<p class="small gift-dev">${giftDevText(g)}</p>` : ''}
      </div>`;
}

// Opens today's happiest-day gift: a random replay or unlock chance (only a replay once every variant is unlocked). Returns the kind.
export async function claimGift() {
  if (!gift || !unlock) return null;
  const g = giftOf(), v = unlockView(), onlyReplay = Boolean(v && v.allUnlocked);
  let kind;
  if (g && g.test) { // the test gift (hold V): only the draw, nothing is granted or stored
    kind = g.opened ? null : drawKind(randomInt, onlyReplay);
    if (kind) S.giftTest = kind;
  } else {
    kind = await gift.claim(randomInt, onlyReplay);
    if (kind === 'unlock') await unlock.addToken(); else if (kind === 'replay') await replay.addBonus();
  }
  syncGift();
  if (kind && S.screen !== 'menu') giftToast(`${ICON.gift}<span class="gift-toast-text">${t('gift.opened', giftKindText(kind))}</span>`, GIFT_DONE_MS, true);
  return kind;
}

// Nothing is fetched: the day comes from the device clock, so it works offline. Only a player's activity offers it, there is no timer: the
// page asks on boot, on a press or a key (at most every GIFT_CHECK_MS) and when the tab or window comes back, so an idle page is never
// offered a gift and a page left open overnight offers it at the player's next move.
// It offers in three places: the menu box (giftBoxHtml: the full text and the (i)), a pulsing button in the bar (every screen, also in a
// game) and a toast that says it once per happiest day. A running game is never re-rendered or covered: it only gets the button; the toast
// waits for the menu or the result screen (features/gift.js present).
const GIFT_CHECK_MS = 5000, GIFT_TOAST_MS = 9000, GIFT_DONE_MS = 4500;
let giftKey = '', giftTold = null, giftLast = 0, giftToastTimer = null, giftToastKind = null;
const giftKeyOf = g => (g ? `${g.day}:${g.opened}` : '');
// The menu box shows this gift now: a later change of the gift redraws the menu (syncGift).
export const noteGiftShown = g => { giftKey = giftKeyOf(g); };
// The V test gift goes with V: it has not been told any more.
export const forgetTestGift = () => { if (giftTold === DEV_GIFT_DAY) giftTold = null; };
const playingNow = () => (S.screen === 'game' && !S.finished) || S.screen === 'solid';
const hideGiftToast = () => { clearTimeout(giftToastTimer); giftToastKind = null; const el = $('giftToast'); if (el) el.hidden = true; };
function giftToast(html, ms, result = false) {
  let el = $('giftToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'giftToast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `gift-toast${result ? ' result' : ''}`;
  el.innerHTML = html;
  el.hidden = false;
  giftToastKind = result ? 'result' : 'offer';
  clearTimeout(giftToastTimer);
  giftToastTimer = setTimeout(hideGiftToast, ms);
}
function showGiftInfo() {
  openSheet({ icon: ICON.gift.replace('stat-icon', 'sheet-glyph'), title: t('info.gift'), html: giftHowHtml(), closeText: t('sheet.close') });
}
function giftOfferToast() {
  giftToast(`${ICON.gift}<span class="gift-toast-text">${t('gift.ready')}</span>`
    + `<button type="button" class="btn" id="giftToastOpen">${t('gift.open')}</button>`
    + `<button type="button" class="tip-btn" id="giftToastInfo" aria-label="${t('gift.how')}">i</button>`, GIFT_TOAST_MS);
  $('giftToastOpen').onclick = claimGift;
  $('giftToastInfo').onclick = showGiftInfo;
}
// Brings the button, the toast and the menu box in line with the gift of today.
export function syncGift() {
  const g = giftOf(), p = present(g, giftTold, playingNow()), btn = $('giftBtn');
  if (btn) { btn.hidden = !p.button; btn.title = t('gift.title'); btn.setAttribute('aria-label', t('gift.title')); }
  if (!p.button && giftToastKind === 'offer') hideGiftToast();
  if (p.toast) { giftTold = g.day; giftOfferToast(); }
  if (S.screen === 'menu' && giftKeyOf(g) !== giftKey) render(); // the menu box appears, or turns into the opened one
}
export function watchGift() {
  const btn = $('giftBtn');
  if (btn) btn.onclick = claimGift;
  const ping = () => { // a short delay: a press must not meet a menu that was drawn again under it
    const now = Date.now();
    if (now - giftLast < GIFT_CHECK_MS) return;
    giftLast = now;
    setTimeout(syncGift, 300);
  };
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, ping, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncGift(); });
  addEventListener('focus', syncGift);
  syncGift();
}
