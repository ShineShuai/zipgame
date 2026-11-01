// The device sync in the play app: the menu card, the link a player opens, the sync phrase, and
// the quiet meetings and cloud rounds. The work is platform/sync (engine.js, p2p.js, cloud.js);
// this file is the player's side of it. NOTHING STARTS BY ITSELF: sync is off until the player
// taps "Link another device", "Make a sync phrase" or "I have a sync phrase", or confirms a link
// they opened (a link opened on a page only asks).
import { SYNC } from '../../config.js';
import { fromWords, PhraseError, toWords } from '../../core/sync/words.js';
import { createCloud } from '../../platform/sync/cloud.js';
import { createHealth } from '../../platform/sync/health.js';
import { cloudBackends } from '../../platform/sync/cloud/backends.js';
import { createP2p, deviceLabel, tokenOfHash } from '../../platform/sync/p2p.js';
import { t } from '../../ui/i18n.js';
import { cardIcon } from './icons.js';
import { S, render, sync } from './state.js';
import { syncCardHtml } from './sync-card.js';
import { showSyncNotice } from './sync-notice.js';

// after a change of the player's data: before the linked devices are looked for, and before the
// cloud is written to (which keeps at least minPushMs between two writes)
const CHANGE_WAIT_MS = 30000;
const PUSH_WAIT_MS = 5000;
const PUSH_RETRY_MS = 20000;
const ARMED_MS = 5000; // how long "tap again" waits
const fresh = () => ({
  open: false, more: false, // the card is one line until the player opens it
  phase: 'idle', link: '', status: '', note: null, reason: '', armed: false, copied: false,
  token: null, phrase: null, phraseInput: '', phraseError: null, phraseCopied: false,
  cloudArmed: false,
});

let p2p = null;
let cloud = null;
let health = null; // when a failure is told as a notice (platform/sync/health.js)
let manualCloud = false; // the cloud round that is running was asked for by the player
let linkable = false; // this browser can link devices (WebRTC)
let ui = fresh();
let active = null; // the link being made or opened: { cancel() }
let changeTimer = null;
let pushTimer = null;
let armedTimer = null;
let cloudArmedTimer = null;

const redraw = () => { if (S.screen === 'menu') render(); };
const set = (patch, quiet = false) => {
  ui = { ...ui, ...patch };
  if (!quiet) redraw();
};
const shown = () => linkable || Boolean(cloud && cloud.available());

function model() {
  const status = cloud ? cloud.status() : {};
  return {
    shown: shown(),
    linkable,
    open: ui.open,
    more: ui.more,
    phase: ui.phase,
    enabled: sync.enabled(),
    peers: sync.peers().map(({ name, at }) => ({ name, at })),
    link: ui.link,
    status: ui.status,
    note: ui.note,
    reason: ui.reason,
    armed: ui.armed,
    canShare: typeof navigator.share === 'function',
    copied: ui.copied,
    now: Date.now(),
    cloud: {
      available: Boolean(cloud && cloud.available()),
      on: Boolean(cloud && cloud.on()),
      busy: Boolean(status.busy),
      error: status.error || null,
      lastOk: status.lastOk || 0,
      armed: ui.cloudArmed,
    },
    phrase: ui.phrase,
    phraseInput: ui.phraseInput,
    phraseError: ui.phraseError,
    phraseCopied: ui.phraseCopied,
  };
}

export const syncCardHtmlNow = () =>
  (sync && (p2p || cloud) ? syncCardHtml(model(), t, cardIcon('sync')) : '');

const STAGE_STATUS = { ready: 'waiting', asked: 'waiting', seen: 'waiting', quiet: 'waiting' };

// manual: the player asked for this round, so a failure is told at once.
function startCloud(options, manual = false) {
  if (cloud && cloud.on()) {
    manualCloud ||= manual;
    cloud.sync(options).then(redraw).catch(() => {});
  }
}

// What the cloud says about a round: a failure may be told (health.js), a success clears it.
function onCloudEvent(event) {
  if (event.type === 'cloud' && event.state === 'ok') health.cloudOk();
  if (event.type === 'cloud' && event.state === 'failed') {
    health.cloudFailed({ error: event.error, manual: manualCloud });
  }
  if (event.state !== 'syncing') manualCloud = false;
  redraw();
}

function onEvent(event) {
  const linking = event.kind === 'link' || event.type === 'waiting' || event.type === 'stage';
  switch (event.type) {
    case 'waiting': set({ phase: 'inviting', link: event.link, status: 'waiting' }); break;
    case 'stage':
      set({ phase: 'working', status: STAGE_STATUS[event.stage] || 'connecting' });
      break;
    case 'connecting': if (linking) set({ phase: 'working', status: 'connecting' }); break;
    case 'syncing': if (linking) set({ phase: 'working', status: 'syncing' }); break;
    case 'linked':
      active = null;
      set({ phase: 'done', note: { kind: 'linked', name: event.peer.name }, status: '' });
      break;
    case 'cloud-on':
      set({ phase: 'done', open: true, note: { kind: 'cloud-on', name: event.peer.name } });
      startCloud({ force: true });
      break;
    case 'synced':
      health.meetOk();
      set({ status: '' });
      break;
    case 'failed':
      if (linking) {
        active = null;
        health.linkFailed({ reason: event.reason, seen: S.screen === 'menu' && ui.open });
        set({ phase: 'failed', reason: event.reason, status: '' });
      } else {
        health.meetFailed({ reason: event.reason });
      }
      break;
    case 'cancelled': set(fresh()); break;
    default: redraw();
  }
}

function startMeeting(force = false) {
  const awake = document.visibilityState !== 'hidden';
  if (linkable && awake && sync.enabled() && sync.peers().length) {
    p2p.resume({ force }).catch(() => {});
  }
}

// The cloud is written to soon after a change, but not more often than minPushMs: when it is
// too soon, it tries again a little later.
function pushSoon(wait = PUSH_WAIT_MS) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await cloud.pushRound().catch(() => ({}));
    if (result.skipped === 'soon') {
      pushSoon(PUSH_RETRY_MS);
    } else {
      redraw();
    }
  }, wait);
}

async function makeLink() {
  set({ ...fresh(), open: true, phase: 'working', status: 'waiting' });
  try {
    active = await p2p.invite();
  } catch {
    set({ phase: 'failed', reason: 'connect', status: '' });
  }
}

async function openLink() {
  const { token } = ui;
  set({ ...fresh(), open: true, phase: 'working', status: 'waiting' });
  try {
    active = await p2p.join(token);
  } catch {
    set({ phase: 'failed', reason: 'connect', status: '' });
  }
}

async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.getElementById('syncLinkField')
      || document.getElementById('syncPhrase');
    if (field && field.select) field.select();
    try {
      document.execCommand('copy');
    } catch { /* it is selected: the player copies it */ }
  }
  set({ [key]: true });
}

// The player asks for a new sync phrase (or to see the one this device has): eight words.
async function showPhrase(makeNew) {
  if (makeNew) {
    await sync.enable({ cloud: true });
  }
  const secret = sync.secret();
  if (!secret) return;
  set({ ...fresh(), open: true, phase: 'phrase', phrase: toWords(secret) });
  startCloud({ force: true }, true);
}

async function joinPhrase() {
  let secret;
  try {
    secret = fromWords(ui.phraseInput);
  } catch (error) {
    if (!(error instanceof PhraseError)) throw error;
    set({ phraseError: { reason: error.reason, position: error.position } });
    return;
  }
  set({ phase: 'joining', phraseError: null });
  await sync.enable({ cloud: true, secret });
  manualCloud = true;
  const result = await cloud.sync({ force: true });
  set(result.ok
    ? { ...fresh(), open: true, phase: 'done', note: { kind: 'joined' } }
    : { ...fresh(), open: true, phase: 'idle' });
}

async function deleteCloud() {
  clearTimeout(cloudArmedTimer);
  if (!ui.cloudArmed) {
    set({ cloudArmed: true });
    cloudArmedTimer = setTimeout(() => set({ cloudArmed: false }), ARMED_MS);
    return;
  }
  set({ cloudArmed: false });
  const result = await cloud.erase();
  set(result.forgotten
    ? { phase: 'done', note: { kind: 'erased' } }
    : { phase: 'failed', reason: 'erase' });
}

async function turnOff() {
  clearTimeout(armedTimer);
  if (!ui.armed) {
    set({ armed: true });
    armedTimer = setTimeout(() => set({ armed: false }), ARMED_MS);
    return;
  }
  if (p2p) p2p.stop();
  if (cloud && cloud.on()) await cloud.erase().catch(() => {}); // as far as the servers let it
  await sync.leave();
  set(fresh());
}

// The buttons of the card; `on` is main.js's on(id, handler).
export function bindSyncCard(on) {
  on('syncLink', makeLink);
  on('syncConfirm', openLink);
  on('syncToggle', () => set({ open: !ui.open, more: false }));
  on('syncMore', () => set({ more: !ui.more }));
  on('syncDecline', () => set({ ...fresh(), open: true }));
  on('syncCancel', async () => {
    await active?.cancel();
    active = null;
    set({ ...fresh(), open: true });
  });
  on('syncCopy', () => copy(ui.link, 'copied'));
  on('syncShare', () => navigator.share({ title: t('sync.title'), url: ui.link }).catch(() => {}));
  on('syncNow', () => {
    set({ status: 'looking' });
    startMeeting(true);
    startCloud({ force: true }, true);
  });
  on('syncOff', turnOff);
  on('syncMakePhrase', () => showPhrase(true));
  on('syncCloudOn', () => showPhrase(true));
  on('syncShowPhrase', () => showPhrase(false));
  on('syncHavePhrase', () => set({ ...fresh(), open: true, phase: 'enter' }));
  on('syncCopyPhrase', () => copy(ui.phrase.join(' '), 'phraseCopied'));
  on('syncPhraseDone', () => set(fresh()));
  on('syncJoin', joinPhrase);
  on('syncCloudStop', async () => { await sync.disable({ cloud: true }); set(fresh()); });
  on('syncCloudDelete', deleteCloud);
  const link = document.getElementById('syncLinkField');
  if (link) link.onfocus = () => link.select();
  const field = document.getElementById('syncPhraseField');
  if (field) field.oninput = () => { ui.phraseInput = field.value; }; // kept over a redraw
}

// After the menu is drawn the first time: finds out what this browser can do (linking needs
// WebRTC and src/coop; the cloud needs WebCrypto and a configured server), reads a link the page
// was opened with, and starts the quiet meetings and the cloud rounds of a device that has them
// on.
export async function initSyncUi() {
  if (!SYNC.available || !sync) return;
  const webcrypto = Boolean(globalThis.crypto && crypto.subtle);
  const backends = webcrypto ? cloudBackends(SYNC.cloud, SYNC.cloud.backends) : [];
  cloud = createCloud({ sync, backends, minPushMs: SYNC.cloud.minPushMs });
  p2p = createP2p({ sync, name: () => deviceLabel(navigator.userAgent) });
  linkable = await p2p.supported();
  if (!shown()) return;
  health = createHealth({ notify: showSyncNotice, online: () => navigator.onLine !== false });
  cloud.onEvent(onCloudEvent);
  sync.onChange(redraw);
  window.addEventListener('online', () => { // the network is back: look again
    startMeeting();
    startCloud();
  });
  if (linkable) {
    p2p.onEvent(onEvent);
    const token = tokenOfHash(location.hash);
    if (token) { // the address is cleaned at once; the player decides on the card
      history.replaceState(null, '', location.pathname + location.search);
      ui = { ...fresh(), phase: 'confirm', token };
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (p2p) p2p.stop();
      if (cloud.on()) cloud.pushRound({ force: true, keepalive: true }).catch(() => {});
    } else {
      startMeeting();
      startCloud();
    }
  });
  sync.onLocalChange(() => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => startMeeting(true), CHANGE_WAIT_MS);
    if (cloud.on()) pushSoon();
  });
  startMeeting();
  startCloud();
  redraw();
  if (ui.phase === 'confirm') { // a link was opened: the question is below the cards
    requestAnimationFrame(
      () => document.getElementById('syncCard')?.scrollIntoView({ block: 'center' }));
  }
}
