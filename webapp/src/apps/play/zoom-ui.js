// The zoom buttons and the pinch hint under the title of a game: − + and "fit the board". They are
// drawn hidden (zoomToolsHtml) and shown by setupZoomTools once the board is on the page and its
// cells turn out small (a phone, a big puzzle). Whether they are there does not depend on the
// zoom: the board must not move on the page while a pinch is on.
import { ZOOM_STEP, isZoomed } from '../../view/camera.js';
import { t } from '../../ui/i18n.js';
import { actionIcon } from './icons.js';
import { storage } from './state.js';

// Below this many pixels a cell the buttons are offered (the numbers get hard to read).
export const TOOLS_BELOW_PX = 40;
export const HINT_KEY = 'zip_zoom_hint';

export function zoomToolsHtml() {
  const button = (id, icon, key) => `<button type="button" class="btn secondary zoom-btn" `
    + `id="${id}" title="${t(key)}" aria-label="${t(key)}">${actionIcon(icon)}</button>`;
  return `<div class="zoom-tools" id="zoomTools" hidden>`
    + `<p class="small zoom-hint" id="zoomHint" hidden>${t('zoom.hint')}</p>`
    + `${button('zoomOut', 'zoomOut', 'zoom.out')}`
    + `${button('zoomIn', 'zoomIn', 'zoom.in')}`
    + `${button('zoomFit', 'fit', 'zoom.fit')}`
    + '</div>';
}

// Whether the player has been told once that a pinch zooms: null until the device says.
let hintSeen = null;
let hintLoading = false;

function loadHint(done) {
  if (hintSeen !== null || hintLoading || !storage) {
    return;
  }
  hintLoading = true;
  storage.get(HINT_KEY).then(found => {
    hintSeen = Boolean(found);
    done();
  }, () => {
    hintSeen = false;
    done();
  });
}

function markHint() {
  if (hintSeen) {
    return;
  }
  hintSeen = true;
  if (storage) {
    storage.set(HINT_KEY, '1');
  }
}

const coarsePointer = () => (
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
);

// Wires the buttons to `zoom` (apps/play/zoom.js); `head()` is the picture point a button keeps
// still (the head of the path), or null. Returns the function that decides what is shown.
export function setupZoomTools(zoom, head) {
  const tools = document.getElementById('zoomTools');
  if (!tools) {
    return () => {};
  }
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomFit = document.getElementById('zoomFit');
  const hint = document.getElementById('zoomHint');
  // whether this page tells the player about the pinch: decided once the device has said whether
  // it did before (then the hint stays in its place, invisible after a zoom, until the next page)
  let hintOn = false;
  const decideHint = () => {
    hintOn = hintSeen === false && coarsePointer();
  };
  const update = cam => {
    const { width } = zoom.box();
    tools.hidden = width / zoom.across >= TOOLS_BELOW_PX;
    const zoomed = isZoomed(cam);
    zoomIn.disabled = cam.s >= zoom.limit() - 1e-6;
    zoomOut.disabled = !zoomed;
    zoomFit.disabled = !zoomed;
    if (zoomed) {
      markHint();
    }
    hint.hidden = !hintOn;
    hint.style.visibility = hintSeen ? 'hidden' : '';
  };
  zoomIn.onclick = () => zoom.zoomBy(ZOOM_STEP, head());
  zoomOut.onclick = () => zoom.zoomBy(1 / ZOOM_STEP, head());
  zoomFit.onclick = () => zoom.fit();
  zoom.listen(update);
  decideHint();
  loadHint(() => {
    decideHint();
    update(zoom.cam());
  });
  update(zoom.cam());
  return () => update(zoom.cam());
}
