// The buttons of the zoom: pan (a drag moves the board instead of drawing), − + and "fit the
// board", and the pinch hint, under the title of a game (the 3D board has them in its tool row).
// They are drawn hidden (zoomToolsHtml) and shown by setupZoomTools once the board is on the page:
// always with a mouse, and on a touch screen when the cells are small (a phone, a big puzzle).
// Whether they are there does not depend on the zoom: the board must not move during a pinch.
import { ZOOM_STEP, isZoomed } from '../../view/camera.js';
import { t } from '../../ui/i18n.js';
import { actionIcon } from './icons.js';

// Below this many pixels a cell the buttons are offered on a touch screen (the numbers get hard
// to read).
export const TOOLS_BELOW_PX = 40;
export const HINT_KEY = 'zip_zoom_hint';

// hint: the line about the pinch (flat boards); inline: a group in a row of buttons, not a row.
export function zoomToolsHtml({ hint = true, inline = false } = {}) {
  const button = (id, icon, key) => `<button type="button" class="btn secondary zoom-btn" `
    + `id="${id}" title="${t(key)}" aria-label="${t(key)}">${actionIcon(icon)}</button>`;
  const tag = inline ? 'span' : 'div';
  const line = hint ? `<p class="small zoom-hint" id="zoomHint" hidden>${t('zoom.hint')}</p>` : '';
  return `<${tag} class="zoom-tools${inline ? ' zoom-inline' : ''}" id="zoomTools" hidden>`
    + line
    + button('zoomPan', 'pan', 'zoom.pan')
    + button('zoomOut', 'zoomOut', 'zoom.out')
    + button('zoomIn', 'zoomIn', 'zoom.in')
    + button('zoomFit', 'fit', 'zoom.fit')
    + `</${tag}>`;
}

// Whether the player has been told once that a pinch zooms: null until the device says.
let hintSeen = null;
let hintLoading = false;

// `store` keeps it on the device: { read(): Promise<value>, write() }, or null (no hint then).
function loadHint(store, done) {
  if (hintSeen !== null || hintLoading || !store) {
    return;
  }
  hintLoading = true;
  store.read().then(found => {
    hintSeen = Boolean(found);
    done();
  }, () => {
    hintSeen = false;
    done();
  });
}

function markHint(store) {
  if (hintSeen) {
    return;
  }
  hintSeen = true;
  store?.write();
}

const media = query => typeof matchMedia === 'function' && matchMedia(query).matches;
const coarsePointer = () => media('(pointer: coarse)');

const defaultById = id => document.getElementById(id);

// Wires the buttons to `zoom` (apps/play/zoom.js); `head()` is the picture point a button keeps
// still (the head of the path), or null; always: shown on a touch screen too; byId: how to find an
// element of the page; hintStore: where the pinch hint is remembered (see loadHint). Returns the
// function that brings what is shown up to date.
export function setupZoomTools(zoom, head, {
  always = false, byId = defaultById, hintStore = null,
} = {}) {
  const tools = byId('zoomTools');
  if (!tools) {
    return () => {};
  }
  const zoomPan = byId('zoomPan');
  const zoomIn = byId('zoomIn');
  const zoomOut = byId('zoomOut');
  const zoomFit = byId('zoomFit');
  const hint = byId('zoomHint');
  // whether this page tells the player about the pinch: decided once the device has said whether
  // it did before (then the hint stays in its place, invisible after a zoom, until the next page)
  let hintOn = false;
  const decideHint = () => {
    hintOn = Boolean(hint) && hintSeen === false && coarsePointer();
  };
  const update = cam => {
    const { width } = zoom.box();
    tools.hidden = !(always || !coarsePointer() || width / zoom.across < TOOLS_BELOW_PX);
    const zoomed = isZoomed(cam);
    zoomPan.hidden = zoom.centred();
    zoomPan.classList.toggle('active', zoom.panning());
    zoomPan.setAttribute('aria-pressed', String(zoom.panning()));
    zoomIn.disabled = cam.s >= zoom.limit() - 1e-6;
    zoomOut.disabled = !zoomed;
    zoomFit.disabled = !zoomed;
    if (zoomed) {
      markHint(hintStore);
    }
    if (hint) {
      hint.hidden = !hintOn;
      hint.style.visibility = hintSeen ? 'hidden' : '';
    }
  };
  zoomPan.onclick = () => zoom.setPanning(!zoom.panning());
  zoomIn.onclick = () => zoom.zoomBy(ZOOM_STEP, head());
  zoomOut.onclick = () => zoom.zoomBy(1 / ZOOM_STEP, head());
  zoomFit.onclick = () => zoom.fit();
  zoom.listen(update);
  decideHint();
  loadHint(hintStore, () => {
    decideHint();
    update(zoom.cam());
  });
  update(zoom.cam());
  return () => update(zoom.cam());
}
