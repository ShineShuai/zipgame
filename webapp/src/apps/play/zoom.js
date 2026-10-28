// The zoom of one board on the page: it writes the camera (view/camera.js) into the viewBox of the
// board's svg and takes the inputs that are not the drawing pointer: the wheel, the trackpad
// pinch, the keys and the zoom buttons. The pinch of two fingers and the drag-to-pan are routed by
// the page (gesture.js) and come in through pinch() and panBy().
//
//   svg      the board's svg; its box on the page does not change with the zoom
//   full     the view box of the whole picture
//   across   how many cells are across the picture (the size of a cell on the page, for the limit)
//   get()    the camera kept for this puzzle, or null (not zoomed yet)
//   set(cam) keeps it (it survives the page being drawn again)
import {
  ZOOM_STEP,
  blend,
  boardPoint,
  boardRect,
  clampCamera,
  drift,
  fitCamera,
  isZoomed,
  keepInView as keepCameraInView,
  maxZoom,
  panBy as panCamera,
  pinchCamera,
  sameCamera,
  viewBoxAttr,
  viewOf,
  zoomAt,
} from '../../view/camera.js';

const TWEEN_MS = 160;
// The zoom a wheel notch or a trackpad pinch step makes: e^(delta * this), at most e^LIMIT.
const WHEEL_ZOOM = 0.01;
const WHEEL_LIMIT = 0.5;
// A press of an arrow key pans by this share of the view.
const KEY_PAN = 0.25;
const LINE_PX = 16;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const reducedMotion = () => (
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
);

export function createZoom({ svg, full, across, get, set, touchBusy = () => false }) {
  let box = svg.getBoundingClientRect();
  let frame = 0;
  let listener = () => {};
  let pinchStart = null;
  let gestureStart = null;

  const cam = () => get() ?? fitCamera(full);
  const limit = () => maxZoom(box.width / across);

  const stop = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  // Shows camera `next` (kept inside the picture) and keeps it.
  function apply(next) {
    const clamped = clampCamera(full, next, limit());
    set(clamped);
    svg.setAttribute('viewBox', viewBoxAttr(viewOf(full, clamped)));
    svg.classList.toggle('zoomed', isZoomed(clamped));
    listener(clamped);
    return clamped;
  }

  function animateTo(target) {
    stop();
    const from = cam();
    const to = clampCamera(full, target, limit());
    if (sameCamera(from, to)) {
      return;
    }
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      apply(to);
      return;
    }
    const started = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - started) / TWEEN_MS);
      const eased = 1 - (1 - t) ** 3;
      apply(t < 1 ? blend(from, to, eased) : to);
      frame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
  }

  // The share of the svg's box where picture point `point` is now, or the middle when it is
  // not in view: what a zoom button keeps still.
  function anchorOf(point) {
    if (!point) {
      return [0.5, 0.5];
    }
    const view = viewOf(full, cam());
    const fx = (point[0] - view.x) / view.w;
    const fy = (point[1] - view.y) / view.h;
    return fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 ? [fx, fy] : [0.5, 0.5];
  }

  const refresh = () => {
    box = svg.getBoundingClientRect();
  };

  // ----- the controls the page calls -----

  function zoomBy(factor, point = null) {
    refresh();
    const [fx, fy] = anchorOf(point);
    animateTo(zoomAt(full, cam(), factor, limit(), fx, fy));
  }

  function fit() {
    refresh();
    animateTo(fitCamera(full));
  }

  function panBy(dx, dy) {
    apply(panCamera(full, cam(), limit(), box, dx, dy));
  }

  // The camera drifts by `velocity` views per second for `seconds`; true if it moved.
  function driftBy(velocity, seconds) {
    const before = cam();
    const after = apply(drift(full, before, limit(), velocity, seconds));
    return !sameCamera(before, after);
  }

  function pinchBegin(a, b) {
    stop();
    refresh();
    pinchStart = { cam: cam(), a, b };
  }

  function pinchMove(a, b) {
    if (pinchStart) {
      const { cam: before, a: a0, b: b0 } = pinchStart;
      apply(pinchCamera(full, before, limit(), box, [a0, b0], [a, b]));
    }
  }

  const pinchEnd = () => {
    pinchStart = null;
  };

  // Eases the camera so that picture point `point` is well inside the view.
  function keepInView(point) {
    refresh();
    animateTo(keepCameraInView(full, cam(), limit(), point));
  }

  // ----- the wheel, the trackpad, the keys -----

  const wheelPixels = e => (e.deltaMode === 1 ? LINE_PX : 1);

  function onWheel(e) {
    refresh();
    const scale = wheelPixels(e);
    if (e.ctrlKey || e.metaKey) { // a trackpad pinch arrives as a wheel with ctrlKey
      e.preventDefault();
      stop();
      const step = clamp(-e.deltaY * scale * WHEEL_ZOOM, -WHEEL_LIMIT, WHEEL_LIMIT);
      const fx = (e.clientX - box.left) / box.width;
      const fy = (e.clientY - box.top) / box.height;
      apply(zoomAt(full, cam(), Math.exp(step), limit(), fx, fy));
      return;
    }
    if (!isZoomed(cam())) {
      return; // the page scrolls
    }
    const next = clampCamera(full, panCamera(
      full, cam(), limit(), box, -e.deltaX * scale, -e.deltaY * scale,
    ), limit());
    if (sameCamera(next, cam())) {
      return; // at the edge of the picture: the page scrolls
    }
    e.preventDefault();
    stop();
    apply(next);
  }

  // Safari on a Mac: a trackpad pinch is a gesture event, not a wheel. (On a touch screen the
  // fingers are routed by the page; touchBusy() says so, and the gesture is left alone.)
  function onGestureStart(e) {
    e.preventDefault();
    if (touchBusy()) {
      return;
    }
    refresh();
    stop();
    gestureStart = cam();
  }

  function onGestureChange(e) {
    e.preventDefault();
    if (!gestureStart || touchBusy()) {
      return;
    }
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    apply(zoomAt(full, gestureStart, e.scale, limit(), fx, fy));
  }

  const onGestureEnd = e => {
    e.preventDefault();
    gestureStart = null;
  };

  // + - 0 and the arrows (when zoomed). `point` is what + and - keep still. True when handled.
  function onKey(e, point = null) {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return false; // those are the browser's own zoom
    }
    if (e.key === '+' || e.key === '=') {
      zoomBy(ZOOM_STEP, point);
      return true;
    }
    if (e.key === '-' || e.key === '_') {
      zoomBy(1 / ZOOM_STEP, point);
      return true;
    }
    if (e.key === '0') {
      fit();
      return true;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && isZoomed(cam())) {
      refresh();
      const view = viewOf(full, cam());
      const [dx, dy] = arrows[e.key];
      const now = cam();
      animateTo({
        s: now.s,
        cx: now.cx + dx * KEY_PAN * view.w,
        cy: now.cy + dy * KEY_PAN * view.h,
      });
      return true;
    }
    return false;
  }

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('gesturestart', onGestureStart);
  svg.addEventListener('gesturechange', onGestureChange);
  svg.addEventListener('gestureend', onGestureEnd);

  return {
    svg,
    across,
    cam,
    limit,
    refresh,
    stop,
    apply,
    animateTo,
    zoomBy,
    fit,
    panBy,
    driftBy,
    pinchBegin,
    pinchMove,
    pinchEnd,
    keepInView,
    anchorOf,
    onKey,
    listen: fn => {
      listener = fn;
    },
    // The svg's box on the page, as last measured (refresh() measures it again).
    box: () => box,
    // Where the WHOLE picture is on the page: what the pointer is mapped to cells through.
    rect: () => boardRect(box, full, cam()),
    // A point of the page as a point of the picture.
    pointAt: (x, y) => boardPoint(box, full, cam(), x, y),
  };
}
