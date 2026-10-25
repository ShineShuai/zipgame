import { actionIcon, cardIcon } from '../apps/play/icons.js';
import { t } from '../ui/i18n.js';
import { tx } from './texts.js';
import { GREETING_MAX } from './join.js';
import { COOP_VARIANTS, sizesFor } from './variants.js';
import { surfaceTopology } from '../core/surface/topology.js';
import { PLAYER_COLORS } from './view.js';

// The markup of the Free draw screens (pure). They are built from the classes of the play app's
// own menu and game screens (card, btn, hud, grid-wrap, game-layout, actions ...), so that the
// trial looks and sits like the single-player game. What the game screen shows only while V is
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

// The type and the size of the puzzle: two selects, the sizes being those of the type.
const pickers = (variant, size) => `<div class="field">`
  + `<label class="field-label" for="coopVariant">${tx('variant')}</label>`
  + `<select id="coopVariant">${selectOptions(COOP_VARIANTS.map(v => v.id), variant,
    id => t(`mode.${id}`))}</select></div>`
  + `<div class="field size-field">`
  + `<label class="field-label" for="coopSize">${t('menu.size')}</label>`
  + `<select id="coopSize">${selectOptions(sizesFor(variant), size, n => sizeText(variant, n))}`
  + '</select>'
  + '</div>';

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

const note = (text, error = false) => `<p class="note${error ? ' error' : ''}" id="coopStatus" `
  + `role="status" aria-live="polite">${text}</p>`;

const copyRow = (id, value, canShare) => `<div class="coop-copy">`
  + `<input id="${id}" type="text" readonly value="${attr(value)}" spellcheck="false">`
  + `<button type="button" class="btn secondary" data-act="copy" data-from="${id}">`
  + `${tx('copy')}</button>`
  + (canShare ? `<button type="button" class="btn secondary" data-act="share" data-from="${id}">`
    + `${actionIcon('share')}${t('share.btn')}</button>` : '')
  + '</div>';

// The first screen: the solo card (like the play app's Free play card) and the online card.
export function menuPage({
  size, rtc, variant = 'standard', status = '', error = false,
}) {
  const solo = `<section class="card free-card">`
    + cardHead(cardIcon('free'), tx('title'), tx('menuSub'),
      ` <span class="coop-tag">${tx('trial')}</span>`)
    + `<p class="menu-caption">${tx('rules')}</p>`
    + `<div class="play-bar">${pickers(variant, size)}`
    + `<div class="button-row"><button class="btn" data-act="solo">${t('menu.playLocal')}`
    + `</button></div></div>${status ? note(status, error) : ''}</section>`;
  const online = `<section class="card">`
    + cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))
    + `<p class="blurb">${tx('onlineBlurb')}</p>`
    + `<div class="button-row"><button class="btn" data-act="host"${rtc ? '' : ' disabled'}>`
    + `${tx('invite')}</button></div>${rtc ? '' : note(tx('noRtc'), true)}</section>`;
  const back = `<div class="button-row"><button class="btn secondary" data-act="exit">`
    + `${tx('backToApp')}</button></div>`;
  return page(`${solo}${online}${back}`);
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
  return page(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
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
  return page(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
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
  return page(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
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
  return page(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${form}${note(status, error)}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('cancel')}`
    + '</button></div></section>');
}

// Connected, no game yet: the host picks the size, the guest waits.
export function lobbyPage({
  role, size, status, variant = 'standard', error = false,
}) {
  const choose = role === 'host'
    ? `<div class="play-bar">${pickers(variant, size)}`
      + `<div class="button-row"><button class="btn" data-act="start">${t('menu.playLocal')}`
      + '</button></div></div>'
    : '';
  return page(`<section class="card">${cardHead(PEOPLE_ICON, tx('onlineTitle'), tx('onlineSub'))}`
    + `${note(status, error)}${choose}`
    + `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('leave')}`
    + '</button></div></section>');
}

// Making the puzzle (percent), or, for the host, waiting until the other device has it.
export function generatingPage({ percent, waiting, online }) {
  const text = waiting ? tx('waitPuzzle') : tx('generating', percent);
  const leave = online
    ? `<div class="button-row"><button class="btn secondary" data-act="cancel">${tx('leave')}`
      + '</button></div>'
    : '';
  return page(`<section class="card"><p id="coopGen">${text}</p>`
    + `<div class="progress"><div style="width:${waiting ? 100 : percent}%"></div></div>${leave}`
    + '</section>');
}

const chips = ({ pid, peerHere }) => `<p class="coop-players">`
  + `<span class="coop-chip"><i style="background:${PLAYER_COLORS[pid]}"></i>${tx('you')}</span>`
  + `<span class="coop-chip${peerHere ? '' : ' gone'}" id="coopPeer"><i `
  + `style="background:${PLAYER_COLORS[1 - pid]}"></i>${tx('friend')}</span></p>`;

// The game: the same arrangement as the play app's game screen. `view` carries the numbers.
export function gamePage(view) {
  const {
    n, online, pid, peerHere, revealed, grade, seedText, devText, time, hintsLeft, variantName,
    sizeName = `${n}×${n}`, viewLabel = '',
  } = view;
  const badge = grade
    ? `<span class="difficulty-badge">${t('grade.' + grade)} · ${grade}/5</span>` : '';
  const kind = variantName ? ` · ${variantName}` : '';
  const title = `${tx('gameTitle', sizeName)}${kind}${online ? ` · ${tx('withFriend')}` : ''}`;
  // a solid game: the button that swaps the solid for its net and back (the play app's)
  const viewButton = viewLabel
    ? `<button class="btn secondary" data-act="view" id="coopView">${viewLabel}</button>` : '';
  const buttons = [
    `<button class="btn secondary" data-act="menu">${actionIcon('menu')}`
      + `${t('game.menu')}</button>`,
    `<button class="btn secondary" data-act="new" id="coopNew"${view.canNew ? '' : ' disabled'}>`
      + `${actionIcon('new')}${t('game.new')}</button>`,
    `<button class="btn secondary" data-act="clear">${actionIcon('reset')}${t('game.reset')}`
      + '</button>',
    `<button class="btn secondary" data-act="undo">${UNDO_ICON}${tx('undo')}</button>`,
    `<button class="btn secondary" data-act="hint" id="coopHint">${actionIcon('hint')}`
      + `${t('game.hint', hintsLeft.used, hintsLeft.cap)}</button>`,
    `<button class="btn secondary" data-act="export" ${dev(revealed)}>Export</button>`,
    viewButton,
  ].join('');
  return page(`<div class="game-layout"><section class="card board-card"><div class="hud">`
    + `<div class="hud-title"><span class="hud-icon">${cardIcon('free')}</span>`
    + `<span>${title}</span><span class="seed-tag" id="coopSeed" ${dev(revealed)}>`
    + `${seedText}</span></div>`
    + badge
    + `<span class="seed-tag" ${dev(revealed)}>${devText}</span>`
    + `<div class="hud-time">${t('game.time', `<b id="coopTime">${seconds(time)}</b>`)}</div>`
    + '</div>'
    + `${online ? chips({ pid, peerHere }) : ''}`
    + `<div class="grid-wrap" id="coopBoard"></div><p class="coop-msg" id="coopMsg" role="status" `
    + `aria-live="polite"></p></section><div class="side"><section class="card actions">`
    + `<div class="button-row">${buttons}</div></section><div id="coopDone"></div></div></div>`,
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
