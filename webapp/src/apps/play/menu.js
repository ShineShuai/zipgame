// The menu screen: the Game-of-the-Day card, free play (size and type) and the status panel.
import { generationWhere } from './gen-runner.js';
import { RAMP, FREEZE_EVERY, FREEZE_MAX, HEAL_DAYS } from '../../features/streak.js';
import { dateLabel } from '../../features/share.js';
import { variantIcon, cardIcon } from './icons.js';
import { PLAY_VARIANTS, sizesFor, nearestSize } from './variants.js';
import { SOLID_KINDS } from '../../features/solid-release.js';
import { BEHAVIOUR } from '../../config.js';
import { t } from '../../ui/i18n.js';
import {
  S, SIZES, replay, sec, solid, statsLineT, storage, storageUsed, store, streak, today, unlock,
} from './state.js';
import { ICON, weekday } from './menu-kit.js';
import { sizeLabel } from './puzzle-kit.js';
import { luckyBoxHtml, unlockView } from './lucky-ui.js';
import { genNoticeHtml } from './generating.js';
import { refreshAttemptIfStale, refreshNext, todayText } from './counters.js';
import { pruneShared, sharedCardHtml } from './shared-ui.js';
import { syncCardHtmlNow } from './sync-ui.js';
import { giftBoxHtml, giftOf, noteGiftShown } from './gift-ui.js';

// Radio tiles, each an icon of the board it plays (full square, square with holes, ...), a name and a tagline.
// Native radios: keyboard (arrows), screen readers and touch work without extra code; css/play.css draws the state.
// A locked variant is in the markup from the start (setDevReveal shows it while V is held, dashed and marked with a
// lock); once it has been picked it stays until the page is reloaded.
const isUnlocked = mode => mode === 'standard' || Boolean(unlock && unlock.unlocked(mode));
export const typeShown = mode => isUnlocked(mode) || S.showDev || S.mode === mode;

function variantPickerHtml() {
  const tiles = ['standard', ...PLAY_VARIANTS.map(v => v.id)].map(mode => {
    const checked = mode === S.mode ? ' checked' : '';
    const locked = isUnlocked(mode) ? '' : ' variant-locked';
    const style = typeShown(mode) ? '' : ' style="display:none"';
    return `
        <label class="variant-opt${locked}" id="variantOpt-${mode}"${style}>
          <input type="radio" name="variant" value="${mode}" aria-describedby="variantRules-${mode}"${checked}>
          <span class="variant-card">
            ${variantIcon(mode)}
            <span class="variant-name">${t('mode.' + mode)}</span>
            <span class="variant-tag">${t('mode.' + mode + 'Tag')}</span>
          </span>
          <span class="variant-rules" id="variantRules-${mode}" role="tooltip"><b class="pop-title">${t('mode.' + mode)}</b>${t('mode.' + mode + 'Rules')}</span>
        </label>`;
  });
  return `
      <fieldset class="variant-picker">
        <legend class="field-label">${t('menu.mode')}</legend>
        <div class="variant-options">${tiles.join('')}
        </div>
      </fieldset>`;
}

// Patchwork (src/coop): draw pieces anywhere and join them into one path, alone or with a friend. Its card is only in the markup
// when src/coop is there (boot.js sets data-coop on <html>); it shows while V is held, or always once the game is released
// (src/coop/config.js RELEASED). The card only asks src/coop to open (main.js): nothing else of the game is known here.
const coopMode = () => document.documentElement.dataset.coop;
export const coopShown = () => coopMode() === 'open' || (coopMode() === 'hidden' && S.showDev);

// What the player has unlocked, for Patchwork to lock the same types (it asks, main.js answers): per type 'all' | 'part' | 'none'
// (the 3D kinds can be 'part': only their first sizes, `sizes`), and whether the menu has the 3D tab at all. V held is not counted:
// Patchwork has its own reveal.
export function coopAccess() {
  const access = {};
  for (const mode of ['standard', ...PLAY_VARIANTS.map(v => v.id)]) access[mode] = isUnlocked(mode) ? 'all' : 'none';
  const sizes = {};
  for (const kind of SOLID_KINDS) {
    access[kind] = solid.access(kind);
    sizes[kind] = solid.openSizes(kind);
  }
  return { access, sizes, solid: SOLID_KINDS.some(kind => access[kind] !== 'none') };
}

function coopCardHtml() {
  if (!coopMode()) return '';
  return `
      <section class="card coop-card" id="coopCard"${coopShown() ? '' : ' style="display:none"'}>
        <header class="card-head">
          <span class="card-badge">${cardIcon('coop')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('coop.title')}</h2>
            <p class="card-sub">${t('coop.sub')}</p>
          </div>
        </header>
        <p class="blurb">${t('coop.blurb')}</p>
        <div class="button-row"><button class="btn" id="coopOpen">${t('coop.open')}</button></div>
      </section>`;
}

// Dedicated Game-of-Day card: today's date, one button, the result once played, replay chances and streak.
function gotdCardHtml() {
  const attempt = store.attempt();
  const chances = replay.chances();
  const date = today();
  const playButton = attempt
    ? `<button class="btn" disabled>${t('gotd.play')}</button>`
    : `<button class="btn" id="playGotd">${t('gotd.play')}</button>`;
  const replayButton = chances > 0
    ? `<button class="btn secondary" id="openReplay">${t('menu.replay', chances)}</button>`
    : `<button class="btn secondary" disabled>${t('menu.replay', 0)}</button>`;
  // why a button is off is written under the buttons: a title attribute is not shown on a touch screen
  const offReason = attempt ? t('menu.gotdOnce') : chances > 0 ? '' : t('replay.locked', replay.toNext());
  const offHint = offReason ? `<p class="btn-hint">${offReason}</p>` : '';
  const attemptText = attempt && attempt.solved
    ? t('menu.attemptSolved', sec(attempt.time))
    : t('menu.attemptDone');
  const stats = attempt && attempt.stats
    ? `<br><span class="gotd-stats">${statsLineT(attempt.stats, S.showDev)}</span>`
    : '';
  const attemptNote = attempt ? `<p class="note">${attemptText}${stats}</p>` : '';
  const hintNote = S.gotdHint ? `<p class="note error">${t(...S.gotdHint)}</p>` : '';
  return `
      <section class="card gotd-card">
        <header class="card-head">
          <span class="card-badge">${cardIcon('gotd')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.gotd')}</h2>
            <p class="card-sub">${dateLabel(date)} · ${weekday(date)}</p>
          </div>
        </header>
        <p class="blurb">${t('gotd.blurb')}</p>
        <div class="button-row">
          ${playButton}
          ${replayButton}
        </div>
        ${offHint}
        ${attemptNote}
        ${hintNote}
        ${statusPanelHtml(chances, streak && streak.view())}
        ${BEHAVIOUR.enabled ? `<p class="small storage-note" id="behaviourNote" style="${S.showDev ? '' : 'display:none'}" title="For each solved game: the puzzle, your time and how many cells you took back. No name, no identifier. Games with a hint or a long time in a hidden tab are not sent.">Anonymous play stats: <a href="#" id="behaviourToggle">${S.behaviourOn ? 'on' : 'off'}</a></p>` : ''}
      </section>`;
}

// Free-play card: pick the puzzle type (icon tiles) and the grid size, then play. Standard is always on offer, a variant once unlocked.
// The grid sizes on offer for the picked puzzle type (sizesFor in ./variants.js); S.size moves to the nearest one on offer.
export function sizeOptionsHtml() {
  const sizes = sizesFor(S.mode, SIZES);
  if (!sizes.includes(S.size)) S.size = nearestSize(S.size, sizes);
  return sizes.map(n => `<option value="${n}"${n === S.size ? ' selected' : ''}>${sizeLabel(S.mode, n)}</option>`).join('');
}

export function storageNoteText() {
  const uv = unlockView();
  const unlockDev = uv ? ` · unlock: ${uv.tokens} chance(s), lucky game ${uv.open ? 'open' : 'played'}, next lucky day in ${uv.daysToNext}` : '';
  const refused = storage.refused && storage.refused.size ? ` · writes refused: ${[...storage.refused].join(', ')}` : '';
  return `Storage: ${storage.name}${storage.shared ? '' : ' (local only)'}${storageUsed}${refused} · generation: ${generationWhere()}${unlockDev}`;
}
function freePlayCardHtml() {
  const sizeOptions = sizeOptionsHtml();
  const storageNote = storageNoteText();
  return `
      <section class="card free-card">
        <header class="card-head">
          <span class="card-badge">${cardIcon('free')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.title')}</h2>
            <p class="card-sub">${t('menu.sub')}</p>
          </div>
        </header>
        ${genNoticeHtml()}
        ${luckyBoxHtml()}
        ${variantPickerHtml()}
        <p class="menu-caption" id="typeCaption" aria-live="polite">${typeCaptionHtml(S.mode)}</p>
        <div class="play-bar">
          <div class="field size-field">
            <label class="field-label" for="sizeSel">${t('menu.size')}</label>
            <select id="sizeSel">${sizeOptions}</select>
            <span class="small" id="gameNo">${todayText()}</span>
          </div>
          <div class="button-row">
            <button class="btn" id="playLocal">${t('menu.playLocal')}</button>
          </div>
        </div>
        <p class="small storage-note" id="storageNote" style="${S.showDev ? '' : 'display:none'}">${storageNote}</p>
      </section>`;
}

// The line under the type tiles: the type picked, its tagline, and the link to its rules (shown on touch screens; a pointer has the
// popover). `mode` is a flat type or, in the 3D card, a kind (solid.js has the same line).
export const typeCaptionHtml = mode => `<b>${t('mode.' + mode)}</b> — ${t('mode.' + mode + 'Tag')}`
  + ` <button type="button" class="link-btn rules-link" data-rules="variantRules-${mode}">${t('menu.rulesLink')}</button>`;

// Flat | 3D: the menu offers the 3D puzzles only once a kind is unlocked or released (solid.available(), or V held).
// Free play and the 3D card are two panes of one column; the tabs sit over the right end of the card head.
function playColumnHtml() {
  const solidOn = solid.available();
  if (!solidOn) return `<div class="play-col"><div class="tab-pane">${freePlayCardHtml()}</div></div>`;
  const flat = S.menuTab !== '3d';
  const tab = (id, key, on) => `<button type="button" role="tab" id="tab-${id}" aria-selected="${on}" aria-controls="pane-${id}" data-tab="${id}">${t(key)}</button>`;
  return `
      <div class="play-col has-tabs">
        <div class="play-tabs" role="tablist" aria-label="${t('menu.tabs')}">${tab('flat', 'menu.tabFlat', flat)}${tab('3d', 'menu.tabSolid', !flat)}</div>
        <div class="tab-pane" id="pane-flat" role="tabpanel" aria-labelledby="tab-flat"${flat ? '' : ' hidden'}>${freePlayCardHtml()}</div>
        <div class="tab-pane" id="pane-3d" role="tabpanel" aria-labelledby="tab-3d"${flat ? ' hidden' : ''}>${solid.cardHtml()}</div>
      </div>`;
}

export function renderMenu() {
  refreshAttemptIfStale();
  refreshNext();
  pruneShared();
  const g = giftOf();
  noteGiftShown(g);
  // the device sync's card is below the grid: inside it, a card that is not placed would fill an empty area
  // (a missing shared card's) and land among the others
  return `
    <div class="menu-layout${g ? ' has-gift' : ''}">
      <p class="menu-intro">${t('menu.blurb')}</p>
      <details class="howto"${S.howtoOpen ? ' open' : ''}><summary>${t('menu.howto')}</summary><p>${t('menu.blurb')}</p></details>
      ${g ? giftBoxHtml(g) : ''}
      ${gotdCardHtml()}
      ${playColumnHtml()}
      ${sharedCardHtml()}
      ${coopCardHtml()}
    </div>
    ${syncCardHtmlNow()}`;
}

// Status panel under the menu buttons: two cards, each with a tooltip (hover on a desktop, tap on a phone; Esc or a tap elsewhere closes it).
//   replay card: chances left + dots for the solves made in the current price step; streak card: flame + days, 7 dots to the next reward, freeze slots.
function statusPanelHtml(chances, sv) { // sv: streak.view(), null before the streak is loaded
  const pips = (on, total, cls = '') => `<span class="pips ${cls}">${Array.from({ length: total }, (_, i) => `<i class="pip${i < on ? ' on' : ''}"></i>`).join('')}</span>`;
  const card = (cls, lines, body) => `
    <button type="button" class="stat-item ${cls}" aria-label="${lines.join(' ')}">
      ${body}
      <span class="stat-tip" role="tooltip">${lines.join('<br>')}</span>
    </button>`;
  const step = replay.step(), toNext = replay.toNext();
  const replayCard = card('stat-replay' + (chances > 0 ? ' ready' : ''), [t(chances > 0 ? 'replay.progress' : 'replay.locked', toNext)], `
      ${ICON.replay}
      <span class="stat-main">
        <span class="stat-top"><b>${chances}</b><small>${t('status.replays')}</small></span>
        ${pips(step.done, step.total)}
        <small class="stat-sub">${t('status.toGo', toNext)}</small>
      </span>`);
  const heals = streak ? streak.healable().length : 0, pg = sv && streak.progress();
  const lines = sv && [sv.streak > 0 ? t('streak.line', sv.streak, sv.freezes) + (sv.today ? '' : ' ' + t('streak.keep')) : t('streak.none'),
    t('streak.next', pg.left), ...(heals ? [t('streak.repair', heals)] : []), t('streak.help', RAMP.join(','), FREEZE_EVERY, FREEZE_MAX, HEAL_DAYS)];
  const streakCard = sv ? card('stat-streak' + (sv.streak > 0 ? (sv.today ? ' lit' : ' lit risk') : ''), lines, `
      ${ICON.flame}
      <span class="stat-main">
        <span class="stat-top"><b>${sv.streak}</b><small>${t('status.streak')}</small></span>
        ${pips(pg.on, pg.total, 'week')}
        <span class="freezes">${Array.from({ length: FREEZE_MAX }, (_, i) => `<span class="freeze${i < sv.freezes ? ' on' : ''}">${ICON.snow}</span>`).join('')}</span>
      </span>`) : '';
  return `<div class="status-panel">${replayCard}${streakCard}</div>`;
}
