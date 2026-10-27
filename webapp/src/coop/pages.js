import { actionIcon, cardIcon, variantIcon } from '../apps/play/icons.js';
import { t } from '../ui/i18n.js';
import { tx } from './texts.js';
import { GREETING_MAX } from './join.js';
import { COOP_VARIANTS, sizesFor } from './variants.js';
import { surfaceTopology } from '../core/surface/topology.js';
import { PLAYER_COLORS } from './view.js';

// The markup of the Patchwork screens (pure). They are built from the classes of the play app's
// own menu and game screens (card, variant-opt, play-bar, hud, grid-wrap, game-layout, actions ...),
// so that they look and sit like the single-player game. What the game screen shows only while V is
// held (the seed, the grade's numbers, Export) carries data-dev; screen.js shows and hides it.
const attr = text => String(text)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;');
const selectOptions = (values, current, label) => values
  .map(value => `<option value="${value}"${value === current ? ' selected' : ''}>`
    + `${label(value)}</option>`).join('');

// What a size is called in the select: 6×6, or for a tetra or cube the size and its cells, or for
// a ball (picked from the catalog) just "random".
function sizeText(variant, n) {
  if (variant === 'tetra' || variant === 'cube') {
    return `${n} (${t('solid.cells', surfaceTopology(variant, n).T)})`;
  }
  return variant === 'ball' ? t('solid.random') : `${n}×${n}`;
}

// The sizes of a type as <option>s.
export const sizeOptionsHtml = (variant, size) => selectOptions(sizesFor(variant), size,
  n => sizeText(variant, n));

// The type of the puzzle: tiles like the play app's (same classes, so the themes' picker layouts
// apply), one radio each; screen.js reads the pick from the radios.
const variantPicker = variant => `<fieldset class="variant-picker">`
  + `<legend class="field-label">${t('menu.mode')}</legend><div class="variant-options">`
  + COOP_VARIANTS.map(({ id }) => `<label class="variant-opt" id="coopOpt-${id}">`
    + `<input type="radio" name="coopVariant" value="${id}"${id === variant ? ' checked' : ''} `
    + `aria-describedby="coopTip-${id}">`
    + `<span class="variant-card">${variantIcon(id)}<span class="variant-name">${t(`mode.${id}`)}`
    + `</span><span class="variant-tag">${t(`mode.${id}Tag`)}</span></span>`
    // the rules popover of the play app's tiles (its hover handlers expect it)
    + `<span class="variant-rules" id="coopTip-${id}" role="tooltip"><b class="pop-title">`
    + `${t(`mode.${id}`)}</b>${variantRulesHtml(id)}</span></label>`).join('')
  + '</div></fieldset>';

// The line under the tiles: the type picked, its tagline, and a link that opens its rules.
export const captionHtml = variant => `<b>${t(`mode.${variant}`)}</b> — ${t(`mode.${variant}Tag`)}`
  + ` <button type="button" class="link-btn rules-link" data-act="variant-rules">`
  + `${t('menu.rulesLink')}</button>`;

export const variantRulesHtml = variant => t(`mode.${variant}Rules`);

// The size and the button, on one row (a bar fixed to the bottom of the card on a phone).
const playBar = (variant, size, act) => `<div class="play-bar"><div class="field size-field">`
  + `<label class="field-label" for="coopSize">${t('menu.size')}</label>`
  + `<select id="coopSize">${sizeOptionsHtml(variant, size)}</select></div>`
  + `<div class="button-row"><button class="btn" data-act="${act}">${t('menu.playLocal')}`
  + '</button></div></div>';

// Type, caption and size: what the setup screens share.
const setup = (variant, size, act) => `${variantPicker(variant)}`
  + `<p class="menu-caption" id="coopCaption" aria-live="polite">${captionHtml(variant)}</p>`
  + `<p class="small coop-variant-rules" id="coopVariantRules" hidden>${variantRulesHtml(variant)}</p>`
  + `${playBar(variant, size, act)}`;

const seconds = value => `${value.toFixed(1)}s`;
const dev = revealed => `data-dev style="${revealed ? '' : 'display:none'}"`;

const PEOPLE_ICON = '<svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
  + 'focusable="false"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>'
  + '<circle cx="17" cy="9" r="2.6"/><path d="M17 14.2c2.4 0 4.2 1.8 4.2 4.2"/></svg>';

const UNDO_ICON = '<svg class="bi" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
  + 'focusable="false"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';

const cardHead = (icon, title, sub, tag = '') => `<header class="card-head">`
  + `<span class="card-badge">${icon}</span><div class="card-head-text">`
  + `<h2 class="card-title">${title}${tag}</h2><p class="card-sub">${sub}</p></div></header>`;

const page = (body, extra = '') => `<div class="coop-page${extra}">${body}</div>`;
// the screens of one card (invite, join, generating ...): a column, not the width of the menu
const narrow = body => page(body, ' narrow');

const note = (text, error = false) => `<p class="note${error ? ' error' : ''}" id="coopStatus" `
  + `role="status" aria-live="polite">${text}</p>`;

const copyRow = (id, value, canShare) => `<div class="coop-copy">`
  + `<input id="${id}" type="text" readonly value="${attr(value)}" spellcheck="false">`
  + `<button type="button" class="btn secondary" data-act="copy" data-from="${id}">`
  + `${tx('copy')}</button>`
  + (canShare ? `<button type="button" class="btn secondary" data-act="share" data-from="${id}">`
    + `${actionIcon('share')}${t('share.btn')}</button>` : '')
  + '</div>';

// The first screen, laid out like the play app's menu: what needs two devices on the left (the
// game left open, the invitation), the puzzle to draw on the right (type, size, Play).
export function menuPage({
  size, rtc, variant = 'standard', status = '', error = false, saved = false,
}) {
  const top = `<div class="coop-top"><button type="button" class="btn secondary" data-act="exit">`
    + `${actionIcon('menu')}${t('game.menu')}</button></div>`;
  const intro = `<p class="menu-intro">${tx('rules')}</p>`
    + `<details class="howto"><summary>${t('menu.howto')}</summary><p>${tx('rules')}</p></details>`;
  const draw = `<section class="card free-card coop-draw">`
    + cardHead(cardIcon('coop'), t('coop.title'), t('coop.sub'))
    + `${status ? note(status, error) : ''}${setup(variant, size, 'solo')}</section>`;
  const online = `<section class="card coop-together">`
    + cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))
    + `<p class="blurb">${tx('onlineBlurb')}</p>`
    + `<div class="button-row"><button class="btn" data-act="host"${rtc ? '' : ' disabled'}>`
    + `${tx('invite')}</button></div>${rtc ? '' : note(tx('noRtc'), true)}</section>`;
  // a game with a friend that was left open (keep.js): taken up again, or given up
  const again = saved
    ? `<section class="card">${cardHead(PEOPLE_ICON, tx('rejoinTitle'), tx('onlineSub'))}`
      + `<p class="blurb">${tx('rejoinBlurb')}</p><div class="button-row">`
      + `<button class="btn" data-act="rejoin">${tx('rejoin')}</button>`
      + `<button class="btn secondary" data-act="discard">${tx('discard')}</button></div></section>`
    : '';
  return page(`${top}${intro}<div class="coop-menu"><div class="coop-side">${again}${online}</div>`
    + `${draw}</div>`);
}

// Host: the invite link to send, and the reply to paste.
export function invitePage({ link, status, error, canShare }) {
  const steps = link
    ? `<ol class="coop-steps"><li><b>${tx('step1')}</b>${copyRow('coopLink', link, canShare)}</li>`
      + `<li><b>${tx('step2')}</b><textarea id="coopReply" rows="3" spellcheck="false" `
      + `placeholder="${attr(tx('replyHere'))}"></textarea>`
      + `<div class="button-row"><button class="btn" data-act="connect">${tx('connect')}`
      + '</button></div></li></ol>'
    : '';
  return narrow(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${steps}${note(status, error)}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('cancel')}`
    + '</button></div></section>');
}

// Guest: the reply to send back to the host.
export function joinPage({ code, status, error, canShare }) {
  const reply = code
    ? `<ol class="coop-steps"><li><b>${tx('replyTitle')}</b>${copyRow('coopCode', code, canShare)}`
      + `<p class="small">${tx('replyNote')}</p></li></ol>`
    : '';
  return narrow(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${reply}${note(status, error)}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('cancel')}`
    + '</button></div></section>');
}

// Host, by link: the link to send, what the host asks of the guest, and the guests who wait for
// a decision (each with its greeting). `down`: no server could be reached, so a code can be used.
const requestItem = ({ id, greeting }) => `<li class="coop-request"><p class="coop-greeting">`
  + `${greeting ? `“${attr(greeting)}”` : attr(tx('noGreeting'))}</p>`
  + `<div class="button-row"><button type="button" class="btn" data-act="accept" `
  + `data-id="${attr(id)}">${tx('accept')}</button>`
  + `<button type="button" class="btn secondary" data-act="decline" data-id="${attr(id)}">`
  + `${tx('decline')}</button></div></li>`;

export function roomInvitePage({
  link, status, error, canShare, requests = [], needGreeting = false, down = false,
}) {
  const steps = link
    ? `<ol class="coop-steps"><li><b>${tx('step1')}</b>${copyRow('coopLink', link, canShare)}`
      + `<label class="coop-check"><input type="checkbox" id="coopNeedGreeting" `
      + `data-act="need-greeting"${needGreeting ? ' checked' : ''}>${tx('askGreeting')}</label>`
      + `<p class="small">${tx('keepOpen')}</p></li></ol>`
    : '';
  const asks = requests.length
    ? `<div class="coop-asks"><b>${tx('askJoin')}</b><ul class="coop-requests">`
      + `${requests.map(requestItem).join('')}</ul></div>`
    : '';
  const manual = down
    ? `<div class="button-row"><button class="btn secondary" data-act="manual">${tx('useCode')}`
      + '</button></div>'
    : '';
  return narrow(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${steps}${asks}${note(status, error)}${manual}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('cancel')}`
    + '</button></div></section>');
}

// What the guest's page says at each stage of a join by link (join.js STAGES): the text, and
// whether it is a problem.
export const STAGE_TEXT = {
  looking: ['lookingHost', false],
  ready: ['readyJoin', false],
  asked: ['asked', false],
  seen: ['hostSees', false],
  quiet: ['hostQuiet', false],
  connecting: ['connecting', false],
  declined: ['declined', true],
  taken: ['taken', true],
  timeout: ['hostNoAnswer', true],
  down: ['noSignal', true],
  failed: ['noRtc', true],
};

// Guest, by link: a greeting for the host and Join, then only what happens (stage: join.js).
export function roomJoinPage({
  stage, greeting = '', needGreeting = false, status, error,
}) {
  const form = stage === 'looking' || stage === 'ready'
    ? `<div class="coop-hello"><label class="field-label" for="coopGreeting">`
      + `${tx('greetingLabel')}${needGreeting ? ' *' : ''}</label>`
      + `<input id="coopGreeting" type="text" maxlength="${GREETING_MAX}" autocomplete="off" `
      + `spellcheck="false" value="${attr(greeting)}" placeholder="${attr(tx('greetingHint'))}">`
      + `<div class="button-row"><button class="btn" data-act="join">${tx('joinBtn')}</button>`
      + '</div></div>'
    : '';
  return narrow(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${form}${note(status, error)}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('cancel')}`
    + '</button></div></section>');
}

// Connected, no game yet: the host picks the type and the size, the guest waits.
export function lobbyPage({
  role, size, status, variant = 'standard', error = false,
}) {
  const choose = role === 'host' ? setup(variant, size, 'start') : '';
  return page(`<section class="card free-card coop-draw">`
    + `${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${note(status, error)}${choose}`
    + `<div class="button-row coop-leave"><button class="btn secondary" data-act="cancel">`
    + `${tx('leave')}</button></div></section>`, ' medium');
}

// Making the puzzle (percent), or, for the host, waiting until the other device has it: the play
// app's generating screen.
export function generatingPage({
  percent, waiting, online, variant = 'standard',
}) {
  const text = waiting ? tx('waitPuzzle') : tx('generating', percent);
  const leave = online
    ? `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('leave')}`
      + '</button></div>'
    : '';
  return page(`<div class="center-stage"><section class="card"><div class="gen-icon">`
    + `${variantIcon(variant)}</div><h2 class="card-title">${t('gen.title')}</h2>`
    + `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" `
    + `aria-valuenow="${waiting ? 100 : percent}"><div style="width:${waiting ? 100 : percent}%">`
    + `</div></div><p class="small" id="coopGen">${text}</p>${leave}</section></div>`);
}

const chips = ({ pid, peerHere }) => `<p class="coop-players">`
  + `<span class="coop-chip"><i style="background:${PLAYER_COLORS[pid]}"></i>${tx('you')}</span>`
  + `<span class="coop-chip${peerHere ? '' : ' gone'}" id="coopPeer"><i `
  + `style="background:${PLAYER_COLORS[1 - pid]}"></i>${tx('friend')}</span></p>`;

// The game: the same arrangement as the play app's game screen. `view` carries the numbers. The
// bar of buttons is the one of the single-player game plus Undo (a drawing has many lines); what
// only some games have (turn a solid, ask a friend, Export) sits under the board, so that the bar
// stays as short as on a phone it must be.
export function gamePage(view) {
  const {
    n, online, pid, peerHere, revealed, grade, seedText, devText, time, hintsLeft,
    variant = 'standard', variantName, sizeName = `${n}×${n}`, viewLabel = '', helpAvailable = false,
  } = view;
  const badge = grade
    ? `<span class="difficulty-badge">${t(`grade.${grade}`)} · ${grade}/5</span>` : '';
  const kind = variantName ? ` · ${variantName}` : '';
  const title = `${t('coop.title')} ${sizeName}${kind}`;
  const tools = [
    viewLabel
      ? `<button class="btn secondary" data-act="view" id="coopView">${viewLabel}</button>` : '',
    // ask a friend to join the game that is on (shown while nobody else is in it)
    helpAvailable
      ? `<button class="btn secondary" data-act="invite-help" id="coopHelp"`
        + `${peerHere ? ' style="display:none"' : ''}>${tx('inviteHelp')}</button>`
      : '',
    `<button class="btn secondary" data-act="export" ${dev(revealed)}>Export</button>`,
  ].join('');
  const buttons = [
    `<button class="btn secondary" data-act="menu">${actionIcon('menu')}${t('game.menu')}</button>`,
    `<button class="btn secondary" data-act="new" id="coopNew"${view.canNew ? '' : ' disabled'}>`
      + `${actionIcon('new')}${t('game.new')}</button>`,
    `<button class="btn secondary" data-act="clear">${actionIcon('reset')}${t('game.reset')}`
      + '</button>',
    `<button class="btn secondary" data-act="undo">${UNDO_ICON}${tx('undo')}</button>`,
    `<button class="btn secondary" data-act="hint" id="coopHint">${actionIcon('hint')}`
      + `${t('game.hint', hintsLeft.used, hintsLeft.cap)}</button>`,
  ].join('');
  return page(`<div class="game-layout"><section class="card board-card"><div class="hud">`
    + `<div class="hud-title"><span class="hud-icon">${variantIcon(variant)}</span>`
    + `<span>${title}</span><span class="seed-tag" id="coopSeed" ${dev(revealed)}>`
    + `${seedText}</span><button type="button" class="tip-btn rules-btn" data-act="rules" `
    + `id="coopRulesBtn" aria-label="${attr(t('game.rulesLabel'))}" aria-expanded="false">i`
    + `</button></div>${badge}`
    + `<span class="seed-tag" ${dev(revealed)}>${devText}</span>`
    + `<div class="hud-time">${t('game.time', `<b id="coopTime">${seconds(time)}</b>`)}</div>`
    + '</div>'
    + `<div class="note coop-rules" id="coopRules" hidden><p>${tx('rules')}</p>`
    + `<p><b>${t(`mode.${variant}`)}</b> — ${variantRulesHtml(variant)}</p></div>`
    + `${online ? chips({ pid, peerHere }) : ''}`
    + `<div class="grid-wrap" id="coopBoard"></div><p class="coop-msg" id="coopMsg" role="status" `
    + `aria-live="polite"></p><div class="coop-tools">${tools}</div></section>`
    + `<div class="side"><section class="card actions"><div class="button-row">${buttons}</div>`
    + '</section><div id="coopDone"></div></div></div>',
  ' has-actions');
}

// The result card under the actions, once solved.
export function resultCard({ solved, lines }) {
  return `<section class="card result-card"><p class="solved">${solved}</p>`
    + lines.map(line => `<p class="small">${line}</p>`).join('') + '</section>';
}

// A dialog in the style of the play app's modals (Export Puzzle, and the leave question).
export const exportDialog = text => `<div class="modal-backdrop show" id="coopExport">`
  + `<div class="modal"><h2>Export Puzzle</h2><textarea id="coopExportText" spellcheck="false" `
  + `readonly>${text.replace(/</g, '&lt;')}</textarea>`
  + `<div class="modal-msg ok" id="coopExportMsg"></div><div class="modal-actions">`
  + `<button class="btn secondary" data-act="export-close">Close</button>`
  + `<button class="btn" data-act="export-copy">Copy to clipboard</button></div></div></div>`;

export const confirmDialog = () => `<div class="modal-backdrop show" id="coopConfirm" `
  + `role="alertdialog" aria-modal="true" aria-labelledby="coopConfirmTitle"><div class="modal">`
  + `<h2 id="coopConfirmTitle">${tx('leaveTitle')}</h2><p>${tx('leaveBody')}</p>`
  + `<div class="modal-actions"><button class="btn secondary" data-act="leave">`
  + `${tx('leave')}</button><button class="btn" id="coopStay" data-act="stay">`
  + `${tx('stay')}</button></div></div></div>`;
