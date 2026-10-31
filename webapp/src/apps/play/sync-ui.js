// The device sync in the play app: the menu card, the link a player opens, and the quiet
// meetings of linked devices. The work is platform/sync (engine.js, p2p.js); this file is the
// player's side of it. NOTHING STARTS BY ITSELF: sync is off until the player taps "Link another
// device" or confirms a link they opened, and a link opened on a page only asks.
import { SYNC } from '../../config.js';
import { t } from '../../ui/i18n.js';
import { createP2p, deviceLabel, tokenOfHash } from '../../platform/sync/p2p.js';
import { cardIcon } from './icons.js';
import { S, render, sync } from './state.js';
import { syncCardHtml } from './sync-card.js';

// after a change of the player's data, before the linked devices are looked for
const CHANGE_WAIT_MS = 30000;
const ARMED_MS = 5000; // how long "tap again" waits
const fresh = () => ({
  phase: 'idle', link: '', status: '', note: null, reason: '', armed: false, copied: false,
  token: null,
});

let p2p = null;
let supported = false;
let ui = fresh();
let active = null; // the link being made or opened: { cancel() }
let changeTimer = null;
let armedTimer = null;

const redraw = () => { if (S.screen === 'menu') render(); };
const set = (patch, quiet = false) => {
  ui = { ...ui, ...patch };
  if (!quiet) redraw();
};

function model() {
  return {
    shown: supported,
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
  };
}

export const syncCardHtmlNow = () =>
  (sync && p2p ? syncCardHtml(model(), t, cardIcon('sync')) : '');

const STAGE_STATUS = { ready: 'waiting', asked: 'waiting', seen: 'waiting', quiet: 'waiting' };

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
      set({ phase: 'done', note: { name: event.peer.name }, status: '' });
      break;
    case 'synced': set({ status: '' }); break;
    case 'failed':
      if (linking) {
        active = null;
        set({ phase: 'failed', reason: event.reason, status: '' });
      }
      break;
    case 'cancelled': set(fresh()); break;
    default: redraw();
  }
}

function startMeeting(force = false) {
  const awake = document.visibilityState !== 'hidden';
  if (supported && awake && sync.enabled() && sync.peers().length) {
    p2p.resume({ force }).catch(() => {});
  }
}

async function makeLink() {
  set({ ...fresh(), phase: 'working', status: 'waiting' });
  try {
    active = await p2p.invite();
  } catch {
    set({ phase: 'failed', reason: 'connect', status: '' });
  }
}

async function openLink() {
  const { token } = ui;
  set({ ...fresh(), phase: 'working', status: 'waiting' });
  try {
    active = await p2p.join(token);
  } catch {
    set({ phase: 'failed', reason: 'connect', status: '' });
  }
}

async function copyLink() {
  const field = document.getElementById('syncLinkField');
  try {
    await navigator.clipboard.writeText(ui.link);
  } catch {
    field?.select();
    try {
      document.execCommand('copy');
    } catch { /* the field is selected: the player copies it */ }
  }
  set({ copied: true });
}

function turnOff() {
  clearTimeout(armedTimer);
  if (!ui.armed) {
    set({ armed: true });
    armedTimer = setTimeout(() => set({ armed: false }), ARMED_MS);
    return;
  }
  p2p.stop();
  sync.leave().then(() => set(fresh()));
}

// The buttons of the card; `on` is main.js's on(id, handler).
export function bindSyncCard(on) {
  on('syncLink', makeLink);
  on('syncConfirm', openLink);
  on('syncDecline', () => set(fresh()));
  on('syncCancel', async () => { await active?.cancel(); active = null; set(fresh()); });
  on('syncCopy', copyLink);
  on('syncShare', () => navigator.share({ title: t('sync.title'), url: ui.link }).catch(() => {}));
  on('syncNow', () => { set({ status: 'looking' }); startMeeting(true); });
  on('syncOff', turnOff);
  const field = document.getElementById('syncLinkField');
  if (field) field.onfocus = () => field.select();
}

// After the menu is drawn the first time: finds out whether this browser can link devices (and
// loads src/coop for it), reads a link the page was opened with, and starts the quiet meetings.
export async function initSyncUi() {
  if (!SYNC.available || !sync) return;
  p2p = createP2p({ sync, name: () => deviceLabel(navigator.userAgent) });
  supported = await p2p.supported();
  if (!supported) return;
  p2p.onEvent(onEvent);
  sync.onChange(redraw);
  const token = tokenOfHash(location.hash);
  if (token) { // the address is cleaned at once; the player decides on the card
    history.replaceState(null, '', location.pathname + location.search);
    ui = { ...fresh(), phase: 'confirm', token };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') p2p.stop();
    else startMeeting();
  });
  sync.onLocalChange(() => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => startMeeting(true), CHANGE_WAIT_MS);
  });
  startMeeting();
  redraw();
}
