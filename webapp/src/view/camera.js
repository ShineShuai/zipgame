// The camera of a flat picture: which part of the whole picture is on screen. No DOM.
//
// `full` is the view box { x, y, w, h } of the whole picture (what the board is drawn in);
// a camera { s, cx, cy } shows the part of it that is 1/s of the width and height, centred on
// (cx, cy), in the units of the picture. The picture is zoomed by writing that part into the
// viewBox of its svg (the svg keeps its box on the page, so strokes stay sharp).
//
// `box` is the svg's box on the page, { left, top, width, height } (getBoundingClientRect).
// boardRect() is where the WHOLE picture would be on the page: the pointer code maps a point to
// a cell through it, as it did before there was a camera (s = 1 gives box itself).

// The most the picture is zoomed in: until a cell is about TARGET_CELL_PX wide, but at least
// MIN_MAX_ZOOM (a board that is big already) and never more than MAX_ZOOM_CAP.
export const TARGET_CELL_PX = 110;
export const MIN_MAX_ZOOM = 2;
export const MAX_ZOOM_CAP = 6;
// One press of a zoom button.
export const ZOOM_STEP = 1.5;
// An s this close to 1 is "not zoomed".
export const ZOOMED_AT = 1.001;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const fitCamera = full => ({ s: 1, cx: full.x + full.w / 2, cy: full.y + full.h / 2 });

export const isZoomed = cam => Boolean(cam) && cam.s > ZOOMED_AT;

// The largest s for a picture whose cells are `cellPx` wide on the page at s = 1.
export function maxZoom(cellPx) {
  if (!(cellPx > 0)) {
    return MIN_MAX_ZOOM;
  }
  return clamp(TARGET_CELL_PX / cellPx, MIN_MAX_ZOOM, MAX_ZOOM_CAP);
}

// The camera kept inside the picture: s between 1 and smax, the view never past the picture.
export function clampCamera(full, cam, smax = MAX_ZOOM_CAP) {
  const s = clamp(cam.s, 1, smax);
  const halfW = full.w / (2 * s);
  const halfH = full.h / (2 * s);
  return {
    s,
    cx: clamp(cam.cx, full.x + halfW, full.x + full.w - halfW),
    cy: clamp(cam.cy, full.y + halfH, full.y + full.h - halfH),
  };
}

// The part of the picture the camera shows: a view box.
export function viewOf(full, cam) {
  const w = full.w / cam.s;
  const h = full.h / cam.s;
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, w, h };
}

const round = value => Math.round(value * 1000) / 1000;

// The viewBox attribute of a view.
export const viewBoxAttr = view => (
  `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`
);

// Where the whole picture is on the page, given the box of the svg that shows `cam` of it.
export function boardRect(box, full, cam) {
  const view = viewOf(full, cam);
  const k = box.width / view.w;
  return {
    left: box.left - (view.x - full.x) * k,
    top: box.top - (view.y - full.y) * k,
    width: full.w * k,
    height: full.h * k,
  };
}

// A point of the page (client pixels) as a point of the picture.
export function boardPoint(box, full, cam, clientX, clientY) {
  const view = viewOf(full, cam);
  return [
    view.x + ((clientX - box.left) / box.width) * view.w,
    view.y + ((clientY - box.top) / box.height) * view.h,
  ];
}

// Zoom by `factor` so that the spot at (fx, fy) of the svg's box (fractions, 0..1) stays where it
// is on the screen.
export function zoomAt(full, cam, factor, smax, fx = 0.5, fy = 0.5) {
  const view = viewOf(full, cam);
  const s = clamp(cam.s * factor, 1, smax);
  const w = full.w / s;
  const h = full.h / s;
  const x = view.x + fx * view.w - fx * w;
  const y = view.y + fy * view.h - fy * h;
  return clampCamera(full, { s, cx: x + w / 2, cy: y + h / 2 }, smax);
}

// The picture dragged by (dx, dy) pixels.
export function panBy(full, cam, smax, box, dx, dy) {
  const view = viewOf(full, cam);
  return clampCamera(full, {
    s: cam.s,
    cx: cam.cx - (dx / box.width) * view.w,
    cy: cam.cy - (dy / box.height) * view.h,
  }, smax);
}

const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Two fingers: they went from a0, b0 to a1, b1 (client pixels) while the camera was `cam0`. The
// spot of the picture that was between the fingers stays between them (zoom and pan at once).
export function pinchCamera(full, cam0, smax, box, [a0, b0], [a1, b1]) {
  const before = middle(a0, b0);
  const after = middle(a1, b1);
  const apart = gap(a0, b0);
  const factor = apart > 1e-6 ? gap(a1, b1) / apart : 1;
  const [px, py] = boardPoint(box, full, cam0, before[0], before[1]);
  const s = clamp(cam0.s * factor, 1, smax);
  const w = full.w / s;
  const h = full.h / s;
  const fx = (after[0] - box.left) / box.width;
  const fy = (after[1] - box.top) / box.height;
  return clampCamera(full, { s, cx: px - fx * w + w / 2, cy: py - fy * h + h / 2 }, smax);
}

// The camera moved the least that puts the picture point (px, py) inside the middle of the view
// (`margin` is the share of the view kept free at every side). The same camera when it is there.
export function keepInView(full, cam, smax, [px, py], margin = 0.2) {
  const view = viewOf(full, cam);
  let { x, y } = view;
  const low = margin * view.w;
  const high = (1 - margin) * view.w;
  if (px < x + low) {
    x = px - low;
  } else if (px > x + high) {
    x = px - high;
  }
  const lowY = margin * view.h;
  const highY = (1 - margin) * view.h;
  if (py < y + lowY) {
    y = py - lowY;
  } else if (py > y + highY) {
    y = py - highY;
  }
  return clampCamera(full, { s: cam.s, cx: x + view.w / 2, cy: y + view.h / 2 }, smax);
}

// Dragging at the edge of the view moves it on: the speed of the camera, in views per second,
// for a pointer at (x, y) on the page. Zero in the middle; it grows to `speed` as the pointer
// goes into the outer `band` (a share of the box) and past the edge.
export const EDGE_BAND = 0.15;
export const EDGE_SPEED = 0.9;
export function edgeVelocity(x, y, box, band = EDGE_BAND, speed = EDGE_SPEED) {
  const along = (at, start, size) => {
    const edge = band * size;
    const fromStart = at - start;
    const fromEnd = start + size - at;
    if (fromStart < edge) {
      return -speed * Math.min(1, (edge - fromStart) / edge);
    }
    if (fromEnd < edge) {
      return speed * Math.min(1, (edge - fromEnd) / edge);
    }
    return 0;
  };
  return [along(x, box.left, box.width), along(y, box.top, box.height)];
}

// The camera moved by `v` views per second for `seconds`.
export function drift(full, cam, smax, [vx, vy], seconds) {
  const view = viewOf(full, cam);
  return clampCamera(full, {
    s: cam.s,
    cx: cam.cx + vx * seconds * view.w,
    cy: cam.cy + vy * seconds * view.h,
  }, smax);
}

export const sameCamera = (a, b) => a.s === b.s && a.cx === b.cx && a.cy === b.cy;

// A camera between two (t from 0 to 1): s by its logarithm, so a zoom looks even.
export function blend(a, b, t) {
  const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t);
  return { s, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}
