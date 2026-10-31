// The play app: boot, the render router and the event handlers. The screens, the game flow and the shared state live in the modules next to it.
import { serialize } from '../../core/format.js';
import { serializeSurface } from '../../core/surface/puzzle.js';
import { usage, pickStorage } from '../../platform/storage.js';
import { createStore } from '../../features/stats-store.js';
import { tapCombo, DEV_TAP_MS, devLinkMode, savePin, loadPin } from '../../features/dev-reveal.js';
import { createDaily } from '../../features/daily.js';
import { createReplay } from '../../features/replay.js';
import { createStreak } from '../../features/streak.js';
import { parseShareLink } from '../../features/share.js';
import { createSharedGames } from '../../features/shared-games.js';
import { maxHints, computeHint, solutionOf } from '../../features/hints.js';
import { bindModal, copyText } from '../../ui/modal.js';
import { touchUI, openSheet, installPeek } from '../../ui/info.js';
import { initTheme, themeName } from '../../ui/theme.js';
import { createSolidPlay } from './solid.js';
import { isPentagon } from '../../core/pentagon.js';
import { hintTwo } from '../../features/twopaths-play.js';
import { PLAY_VARIANTS, luckyDefs } from './variants.js';
import { createUnlock } from '../../features/unlock.js';
import { createGift } from '../../features/gift.js';
import { createRulesSeen } from '../../features/rules-seen.js';
import { VERSION } from '../../version.js';
import { LEADERBOARD, BEHAVIOUR, SYNC } from '../../config.js';
import { createSync } from '../../platform/sync/engine.js';
import { bindSyncCard, initSyncUi } from './sync-ui.js';
import { createLeaderboard, backendsFromConfig } from '../../platform/leaderboard.js';
import { createBehaviour, sinksFromConfig } from '../../platform/behaviour.js';
import { t, getLang, setLang } from '../../ui/i18n.js';
import { createPlayLog } from '../../features/playlog.js';
import { isSoundEnabled, setSoundEnabled, sfxMove } from '../../platform/sound.js';
import { coopAccess, coopShown, renderMenu, sizeOptionsHtml, storageNoteText, typeCaptionHtml, typeShown } from './menu.js';
import { genNoticeHtml, paintGenerating, renderGenerating } from './generating.js';
import { hintShown, renderGame } from './game-view.js';
import {
  $, S, SIZES, bind, behaviour, dayNo, gift, giftRef, lastPointer, lb, modal, playlog, randomSeed,
  replay, rulesSeen, solidRelease, statsLineT, storage, store, streak, sync, today, unlock,
} from './state.js';
import { openReplay, renderReplay, startGameOfDay, startReplay } from './replay-ui.js';
import {
  awardThemeSlots, claimReward, finishLucky, leaveLucky, logPlay, onStreakMilestone, shareGotd, startLocal,
  startLucky, startTimer, stopTimer, watchThemeEvents,
} from './game-flow.js';
import {
  closeRules, closeStatTips, hidePeek, openExport, openRulesSheet, setChanceTip, setGiftTip,
  setLuckyTip, setShareTip, showPeek, showRules, toggleChanceTip, toggleGiftTip, toggleLuckyTip,
  toggleShareTip,
} from './popups.js';
import { luckyGameHtml } from './lucky-ui.js';
import { peekNext, todayText } from './counters.js';
import { claimGift, forgetTestGift, syncGift, watchGift } from './gift-ui.js';
import { initShared, removeShared, shareResult, startShared, stripShareParam } from './shared-ui.js';
import {
  onZoomKey, resetPaths, setupGridInput, showHintInView,
} from './grid-input.js';

let devPinned = false, devTimer = null; // a device kept revealed (features/dev-reveal.js); the tap reveal's fall-back timer
// ---------- render ----------
function render() {
  const screens = { menu: renderMenu, generating: renderGenerating, game: renderGame, replay: renderReplay, solid: () => solid.screenHtml() };
  const screen = screens[S.screen] || renderGame;
  $('app').innerHTML = screen() + devBadgeHtml();
  $('app').classList.toggle('has-actions', Boolean($('app').querySelector('.actions'))); // a phone's action bar floats over the page bottom
  attachHandlers();
}

// Hidden unless the dev reveal is held (see setDevReveal).
function devBadgeHtml() {
  const display = S.showDev ? 'block' : 'none';
  return `<div id="versionBadge" class="dev-badge" style="display:${display}">zigzag v${VERSION}</div>`;
}

// The solid puzzles (tetrahedron, cube, ball): their own card in the menu (from the release
// day, or with V) and game screen.
const solid = createSolidPlay({
  S, $, t, render, startTimer, stopTimer, randomSeed, openExport,
  release: solidRelease,
  today: dayNo,
  unlocked: kind => Boolean(unlock && unlock.unlocked(kind)),
  luckyHtml: luckyGameHtml,
  luckySolved: finishLucky,
  luckyFailed: () => unlock && unlock.refund(),
  leaveLucky,
  paintGenerating, genNoticeHtml,
});
bind({ render, solid });

function attachHandlers() {
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  on('playLocal', () => { S.size = +$('sizeSel').value; startLocal('open', S.mode); });
  const sel = $('sizeSel'); if (sel) sel.onchange = () => { S.size = +sel.value; $('gameNo').textContent = todayText(); };
  // Rules: a pointer gets a popover on hover or focus; a touch screen has the caption's "Rules" link (a bottom sheet) and the
  // long-press peek, so a tap only picks the tile
  document.querySelectorAll('.variant-opt, .rules-host').forEach(opt => {
    opt.addEventListener('mouseenter', () => { if (!touchUI()) showRules(opt); });
    opt.addEventListener('mouseleave', () => { if (!touchUI() && lastPointer !== 'touch') closeRules(); });
    opt.addEventListener('focusin', () => { if (!touchUI()) showRules(opt); });
    opt.addEventListener('focusout', () => { if (!touchUI()) closeRules(); });
    opt.addEventListener('click', e => {
      if (touchUI()) {
        if (e.target.closest('#rulesTip')) { e.stopPropagation(); openRulesSheet('rulesTipPop'); }
        return;
      }
      e.stopPropagation();
      showRules(opt);
    });
  });
  // the caption under the tiles (its content is replaced when the pick changes): its "Rules" link opens the sheet
  document.querySelectorAll('.menu-caption').forEach(cap => cap.addEventListener('click', e => {
    const link = e.target.closest('.rules-link');
    if (link) { e.stopPropagation(); openRulesSheet(link.dataset.rules); }
  }));
  document.querySelectorAll('input[name="variant"]').forEach(input => {
    input.onchange = () => {
      S.mode = input.value;
      S.size = +$('sizeSel').value;
      $('sizeSel').innerHTML = sizeOptionsHtml();
      $('gameNo').textContent = todayText();
      const cap = $('typeCaption');
      if (cap) cap.innerHTML = typeCaptionHtml(S.mode);
    };
  });
  document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { S.menuTab = b.dataset.tab; render(); }; });
  const howto = document.querySelector('.howto');
  if (howto) howto.addEventListener('toggle', () => { S.howtoOpen = howto.open; });
  const stats = $('playStats');
  if (stats) stats.addEventListener('toggle', () => { S.statsOpen = stats.open; });
  const sharedHead = $('sharedHead');
  if (sharedHead) sharedHead.addEventListener('click', e => {
    if (e.target.closest('button') || innerWidth > 640) return; // the banner opens on a phone; the (i) is its own button
    const card = $('sharedCard');
    S.sharedOpen = !card.classList.contains('open');
    card.classList.toggle('open', S.sharedOpen);
  });
  on('playGotd', startGameOfDay);
  on('playLucky', startLucky);
  on('luckyTip', toggleLuckyTip);
  on('luckyChance', toggleChanceTip);
  on('giftOpen', claimGift);
  on('giftTip', toggleGiftTip);
  on('rewardReplay', () => claimReward('replay'));
  on('rewardUnlock', () => claimReward('unlock'));
  document.querySelectorAll('.shared-play').forEach(b => {
    b.onclick = () => startShared(b.dataset.key);
  });
  document.querySelectorAll('.shared-del').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      removeShared(b.dataset.key);
    };
  });
  on('sharedMore', () => {
    S.sharedAll = !S.sharedAll;
    render();
  });
  on('shareBtn', shareResult);
  on('shareTip', toggleShareTip);
  on('openReplay', () => openReplay());
  on('coopOpen', () => document.dispatchEvent(new CustomEvent('zip:coop-open'))); // Patchwork (src/coop) opens in place of the menu
  bindSyncCard(on);
  on('replayBack', () => { S.replayPick = null; S.screen = 'menu'; render(); });
  on('toReplay', () => openReplay());
  document.querySelectorAll('.replay-day').forEach(b => { b.onclick = () => startReplay(b.dataset.date); });
  document.querySelectorAll('.stat-item').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      if (touchUI()) { // a sheet on a touch screen, a popover otherwise
        const tip = b.querySelector('.stat-tip');
        openSheet({ icon: b.querySelector('.stat-icon').outerHTML.replace('stat-icon', 'sheet-glyph'),
          title: t(b.classList.contains('stat-streak') ? 'info.streak' : 'info.replays'), html: tip.innerHTML, closeText: t('sheet.close') });
        return;
      }
      const open = !b.classList.contains('open'); closeStatTips(); b.classList.toggle('open', open);
    };
  });
  on('genCancel', () => { if (S.genJob) S.genJob.cancel(); });
  on('backMenu2', () => { logPlay(false); stopTimer(); leaveLucky(); S.screen = 'menu'; render(); });
  on('resetPath', resetPaths);
  on('behaviourToggle', async ev => { ev.preventDefault(); S.behaviourOn = !S.behaviourOn; await behaviour.setOn(S.behaviourOn); render(); });
  on('newPuzzle', () => { if (!S.isGotd) startLocal('skip', S.variant || 'standard'); });
  on('exportBtn', () => openExport(isPentagon(S.puzzle) ? serializeSurface(S.puzzle, { path: S.puzzle.path }) : serialize(S.puzzle)));
  on('hintBtn', () => {
    if (S.finished || S.hintsUsed >= maxHints(S.puzzle)) return;
    const two = Boolean(S.puzzle.split);
    const { colour, correctCell, wrongCell } = two
      ? hintTwo(S.puzzle, S.paths, S.colour) : computeHint(solutionOf(S.puzzle), S.path);
    if (correctCell == null) return;
    if (two) { S.colour = colour; S.path = S.paths[colour]; } // the hint is for that colour
    S.hintsUsed++; S.hintCell = correctCell; S.hintWrongCell = wrongCell; render();
    showHintInView();
  });
  const svg = document.querySelector('#gridWrap svg'); if (svg) setupGridInput(svg);
  solid.attach();
}

// ---------- hidden dev reveal: hold "v", or 5 taps on the bare app bar, or a pinned device ----------
// Patchwork (src/coop) listens for this event; with nothing listening it does nothing. It also asks what the player has unlocked
// (zip:coop-access, answered at once through detail.reply) to lock the same types.
document.addEventListener('zip:coop-access', event => event.detail.reply(coopAccess()));
const announceReveal = () => document.dispatchEvent(
  new CustomEvent('zip:reveal', { detail: S.showDev }),
);
function setDevReveal(on) {
  if (S.showDev === on || (!on && devPinned)) return; S.showDev = on;
  announceReveal();
  if (!on) { S.giftTest = null; forgetTestGift(); } // the test gift goes with V
  if (gift) syncGift(); // the gift box, button and toast (re-draws the menu when the box comes or goes)
  const b = $('versionBadge'); if (b) b.style.display = on ? 'block' : 'none';
  const h = $('hintBtn'); if (h) h.style.display = hintShown() ? '' : 'none';
  const x = $('exportBtn'); if (x) x.style.display = on ? '' : 'none';
  const sn = $('storageNote'); if (sn) sn.style.display = on ? '' : 'none';
  if (on) measureStorage();
  const bn = $('behaviourNote'); if (bn) bn.style.display = on ? '' : 'none';
  const tag = $('seedTag'); if (tag) tag.style.display = on ? 'inline' : 'none';
  solid.reveal();
  if (S.screen === 'menu' && solid.available() !== Boolean($('pane-3d'))) { render(); return; } // the Flat | 3D tabs come and go with the 3D card
  const d = $('difficultyDev'); if (d) d.style.display = on ? 'inline' : 'none';
  const g = $('genDev'); if (g) g.style.display = on ? 'inline' : 'none';
  const coopCard = $('coopCard'); if (coopCard) coopCard.style.display = coopShown() ? '' : 'none';
  for (const { id } of PLAY_VARIANTS) { const tile = $('variantOpt-' + id); if (tile) tile.style.display = typeShown(id) ? '' : 'none'; }
  const shown = S.screen === 'game' && S.isGotd ? store.attemptOn(S.gotdDate) : store.attempt(), st = shown && shown.stats;
  if (st) document.querySelectorAll('.gotd-stats').forEach(e => { e.textContent = statsLineT(st, on); });
}
function measureStorage() {
  usage(storage).then(u => { bind({ storageUsed: ` · ~${Math.max(1, Math.round(u.chars * 2 / 1024))} KB in ${u.keys} keys` }); const n = $('storageNote'); if (n) n.textContent = storageNoteText(); }).catch(() => {});
}
// Time the tab is hidden during a game (the timer runs on): a game with much of it is not uploaded (BEHAVIOUR.hiddenMaxMs).
let hiddenAt = null;
function trackHidden() {
  if (document.hidden) { hiddenAt = performance.now(); return; }
  if (hiddenAt != null && S.trace && S.screen === 'game' && !S.finished) S.trace.hiddenMs += performance.now() - hiddenAt;
  hiddenAt = null;
}
function installDevReveal() {
  const typing = t => t && t.tagName && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  addEventListener('keydown', e => { if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) setDevReveal(true); });
  addEventListener('keyup', e => { if (e.key === 'v' || e.key === 'V') setDevReveal(false); });
  addEventListener('blur', () => setDevReveal(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setDevReveal(false); trackHidden(); });
  // Touch: 5 quick taps on the bare app bar (not on the brand link or a button) toggle the reveal; it falls back by itself.
  const combo = tapCombo();
  document.querySelector('.app-bar').addEventListener('pointerup', e => {
    if (e.target.closest('a, button') || !combo(e.timeStamp)) return;
    clearTimeout(devTimer);
    setDevReveal(!S.showDev);
    if (S.showDev && !devPinned) devTimer = setTimeout(() => setDevReveal(false), DEV_TAP_MS);
  });
}
// A pinned device starts revealed. A dev link (a share link, see features/dev-reveal.js) pins or unpins it; it is taken before
// initShared so that it is no shared game, and its `s` parameter is dropped. The markup carries S.showDev: set it before render().
async function initDevPin() {
  const mode = devLinkMode(parseShareLink(location.search).rec);
  if (mode) { await savePin(storage, mode === 'on'); stripShareParam(); }
  devPinned = await loadPin(storage);
  S.showDev = devPinned;
  announceReveal();
  if (devPinned) measureStorage();
}

// ---------- sound toggle (lives in the app bar, outside #app — wired once, not by render()) ----------
function applySoundButtonState() {
  const b = $('soundToggle'); if (!b) return;
  const muted = !isSoundEnabled();
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-pressed', String(!muted));
  const label = t(muted ? 'sound.unmute' : 'sound.mute');
  b.setAttribute('aria-label', label);
  b.title = label;
}
async function initSoundToggle() {
  const saved = await storage.get('sound-muted');
  setSoundEnabled(!(saved && saved.value === '1'));
  applySoundButtonState();
  $('soundToggle').onclick = () => {
    setSoundEnabled(!isSoundEnabled());
    applySoundButtonState();
    storage.set('sound-muted', isSoundEnabled() ? '0' : '1');
    if (isSoundEnabled()) sfxMove(); // quick audible confirmation it's back on
  };
}

// ---------- language toggle (app bar, outside #app — wired once; a switch re-renders #app) ----------
function applyLang() {
  const lang = getLang(), b = $('langToggle');
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelector('.brand').setAttribute('aria-label', t('brand.home'));
  const brandName = $('brandName');   // the name of the game: zigzag, in Chinese 之折 (its own face in a theme, css/play.css)
  brandName.textContent = t('brand.name');
  brandName.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.title = t('brand.name');
  b.dataset.on = lang;
  b.firstElementChild.textContent = lang === 'zh' ? 'EN' : '中'; // like the theme button: it shows what a tap switches to
  b.setAttribute('aria-label', t('lang.switch'));
  b.title = t('lang.switch');
  applySoundButtonState();
  if (themeCtl) themeCtl.refresh();
  const giftButton = $('giftBtn');
  if (giftButton) { giftButton.title = t('gift.title'); giftButton.setAttribute('aria-label', t('gift.title')); }
}
let themeCtl = null; // the theme button (ui/theme.js); it follows the system setting until the player has picked a theme
async function initLang() {
  const saved = await storage.get('lang');
  setLang(saved ? saved.value : /^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  applyLang();
  $('langToggle').onclick = () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    storage.set('lang', getLang());
    applyLang(); render();
  };
}

// ---------- boot ----------
(async function boot() {
  bind({ storage: await pickStorage() });
  // Syncing the player's data across their devices does nothing until the player turns it on (platform/sync/engine.js).
  if (SYNC.available) {
    try {
      const engine = createSync({ storage, maxDevices: SYNC.maxDevices });
      await engine.init();
      bind({ sync: engine, storage: engine.wrap(storage) });
    } catch (e) { console.warn('sync init failed:', e); }
  }
  bind({
    store: createStore(storage, SIZES, Object.fromEntries(PLAY_VARIANTS.map(v => [v.id, v.sizes(SIZES)])), sync),
    daily: createDaily(storage),
    playlog: createPlayLog(storage),
  });
  try { await store.hydrate(today()); } catch (e) { console.warn('stats hydration failed:', e); }
  bind({ lb: createLeaderboard(backendsFromConfig(LEADERBOARD, new URLSearchParams(location.search).get('lb'))) });
  bind({ replay: createReplay(storage, store, undefined, sync) });
  try { await replay.init(); } catch (e) { console.warn('replay init failed:', e); }
  bind({ streak: createStreak(storage, playlog, undefined, sync) });
  let streakRewards = 0; // rewards of healed days a saved streak had not counted yet: granted once the rest is loaded
  try { streakRewards = (await streak.init()).rewards; } catch (e) { console.warn('streak init failed:', e); }
  bind({ unlock: createUnlock(storage, luckyDefs(SIZES, solidRelease), undefined, sync) });
  try { await unlock.init(); } catch (e) { console.warn('unlock init failed:', e); }
  bind({ gift: createGift(storage, giftRef, undefined, sync) });
  try { await gift.init(); } catch (e) { console.warn('gift init failed:', e); }
  bind({ rulesSeen: createRulesSeen(storage, PLAY_VARIANTS.map(v => v.id), sync) });
  if (sync) sync.onChange(() => store.refresh().catch(e => console.warn('stats refresh failed:', e)));
  await rulesSeen.init();
  bind({ shared: createSharedGames(storage) });
  if (lb.enabled) for (const { date } of await replay.unsent()) shareGotd(date); // today's and replayed days whose submit never got an answer
  bind({ behaviour: createBehaviour({ storage, cfg: BEHAVIOUR, sinks: sinksFromConfig(BEHAVIOUR, LEADERBOARD) }) });
  try { S.behaviourOn = await behaviour.isOn(); behaviour.flush().catch(() => {}); } catch (e) { console.warn('behaviour init failed:', e); } // rows left from an earlier page load
  try { S.nextIdx = await peekNext(); } catch (e) { console.warn('daily counters failed:', e); }
  await initDevPin();
  await initShared();
  document.addEventListener('click', () => { setShareTip(false); setLuckyTip(false); setChanceTip(false); setGiftTip(false); closeStatTips(); closeRules(); });
  // a press anywhere but on a rules tooltip's own host closes the tooltips, in the capture phase: the board takes its presses
  document.addEventListener('pointerdown', e => {
    bind({ lastPointer: e.pointerType });
    if (!e.target.closest('.variant-opt, .rules-host')) closeRules();
  }, true);
  document.addEventListener('keydown', solid.onKey);
  document.addEventListener('keydown', onZoomKey);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { setShareTip(false); setLuckyTip(false); setChanceTip(false); setGiftTip(false); closeStatTips(); closeRules(); } });
  bind({ modal: bindModal($('exportModal')) });
  $('exportClose').onclick = modal.close; $('exportCopy').onclick = () => copyText($('exportText'), $('exportMsg'));
  installDevReveal(); await initSoundToggle(); await initLang();
  themeCtl = initTheme($('themeToggle'), (cur, next, classic) => (classic
    ? t(cur.mode === 'dark' ? 'theme.toLight' : 'theme.toDark') : t('theme.switchTo', themeName(next, getLang()))),
  () => t('theme.pick'), getLang, { text: t, revealed: () => S.showDev, idle: () => S.screen === 'menu' });
  awardThemeSlots(); // the slots the player's activity has earned so far
  watchThemeEvents(); // an offer day (src/themes/calendar.js): the theme waits as a chip
  document.addEventListener('zip-theme', () => { if (S.screen !== 'generating') render(); }); // a theme's icons, board skin and 3D tints are drawn into the markup: draw the screen again
  installPeek({ selector: '.variant-opt', show: showPeek, hide: hidePeek });
  const howto = await storage.get('howto-seen'); S.howtoSeen = Boolean(howto && howto.value === '1'); S.howtoOpen = !S.howtoSeen;
  render();
  watchGift();
  initSyncUi().catch(e => console.warn('device sync not started:', e));
  for (let i = 0; i < streakRewards; i++) await onStreakMilestone();
})();
