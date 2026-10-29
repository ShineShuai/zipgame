// The overview of a zoomed board: the whole picture small, in a corner of the board, with the part
// that is on screen outlined, and the path and the checkpoints in it. A tap or a drag on it moves
// the view there. It is for boards with many cells (a zoomed board of 12 cells across or more
// shows only a part of them) and sits in the corner farthest from the head of the path, so that it
// is not in the way of the line being drawn.
import { isZoomed, viewOf } from '../../view/camera.js';
import { t } from '../../ui/i18n.js';
import { CELL, COLORS, routeCells } from './board.js';
import { cellPoint, fullViewOf, routeOf } from './puzzle-kit.js';

// The overview is offered from this many cells across.
export const MAP_MIN_CELLS = 12;
// Its width on the page, and the gap to the edge of the board (pixels).
export const MAP_PX = 84;
const GAP_PX = 8;

const round = value => Math.round(value * 100) / 100;

// The paths of the game as the d of svg paths: one, or one per colour (Two paths).
const pathsOf = S => (S.puzzle.split
  ? S.paths.map(path => (path.length > 1 ? routeOf(S.puzzle, path) : ''))
  : [(() => {
    const line = routeCells(S.puzzle, S.path, S.finished);
    return line.length > 1 ? routeOf(S.puzzle, line) : '';
  })()]);

// Hidden markup; setupZoomMap shows it. S is the play state.
export function zoomMapHtml(S) {
  const p = S.puzzle;
  const full = fullViewOf(p);
  const stroke = round(full.w / 36);
  const dots = [];
  p.cp.forEach((number, cell) => {
    if (number) {
      const [x, y] = cellPoint(p, cell);
      dots.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(CELL * 0.5)}"/>`);
    }
  });
  const paths = pathsOf(S).map((d, colour) => (
    `<path data-colour="${colour}" d="${d}" stroke="${COLORS.twoPath?.[colour] ?? COLORS.path}"/>`
  ));
  return `<div class="zoom-map" id="zoomMap" hidden role="img" aria-label="${t('zoom.map')}" `
    + `style="width:${MAP_PX}px;height:${round((MAP_PX * full.h) / full.w)}px">`
    + `<svg viewBox="${round(full.x)} ${round(full.y)} ${round(full.w)} ${round(full.h)}" `
    + `preserveAspectRatio="none"><rect class="zm-board" x="${round(full.x)}" y="${round(full.y)}" `
    + `width="${round(full.w)}" height="${round(full.h)}"/>`
    + `<g class="zm-paths" fill="none" stroke-width="${stroke}" stroke-linecap="round" `
    + `stroke-linejoin="round">${paths.join('')}</g>`
    + `<g class="zm-dots">${dots.join('')}</g>`
    + `<rect class="zm-view" x="0" y="0" width="0" height="0" `
    + `stroke-width="${stroke}"/></svg></div>`;
}

// Wires the overview of the page to `zoom` (zoom.js). `head()`: the picture point of the head of
// the path, or null. Returns refresh(): call it when the path has changed.
export function setupZoomMap(zoom, S, head) {
  const map = document.getElementById('zoomMap');
  if (!map) {
    return () => {};
  }
  const full = fullViewOf(S.puzzle);
  const svg = map.querySelector('svg');
  const frame = svg.querySelector('.zm-view');
  const board = zoom.target;
  const offered = zoom.across >= MAP_MIN_CELLS;

  // the corner of the board farthest from the head (an svg has no offsetLeft: measure on the page)
  function place(view) {
    const point = head();
    const fx = point ? (point[0] - view.x) / view.w : 0.5;
    const fy = point ? (point[1] - view.y) / view.h : 0.5;
    const parent = map.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const box = board.getBoundingClientRect();
    const right = box.left - parent.left + box.width - MAP_PX - GAP_PX;
    const bottom = box.top - parent.top + box.height - map.offsetHeight - GAP_PX;
    map.style.left = `${fx < 0.5 ? right : box.left - parent.left + GAP_PX}px`;
    map.style.top = `${fy < 0.5 ? bottom : box.top - parent.top + GAP_PX}px`;
  }

  function update(cam) {
    const zoomed = isZoomed(cam);
    map.hidden = !(offered && zoomed);
    if (map.hidden) {
      return;
    }
    const view = viewOf(full, cam);
    frame.setAttribute('x', round(view.x));
    frame.setAttribute('y', round(view.y));
    frame.setAttribute('width', round(view.w));
    frame.setAttribute('height', round(view.h));
    place(view);
  }

  // a tap or a drag on the overview puts the middle of the view there
  const centreAt = (event, animate) => {
    const box = svg.getBoundingClientRect();
    zoom.centreOn([
      full.x + ((event.clientX - box.left) / box.width) * full.w,
      full.y + ((event.clientY - box.top) / box.height) * full.h,
    ], animate);
  };
  let dragging = false;
  map.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    map.setPointerCapture(event.pointerId);
    centreAt(event, true);
  });
  map.addEventListener('pointermove', event => {
    if (dragging) {
      centreAt(event, false);
    }
  });
  const end = () => {
    dragging = false;
  };
  map.addEventListener('pointerup', end);
  map.addEventListener('pointercancel', end);

  zoom.listen(update);
  update(zoom.cam());
  return () => {
    const paths = pathsOf(S);
    map.querySelectorAll('.zm-paths path').forEach((el, colour) => {
      el.setAttribute('d', paths[colour] ?? '');
    });
    update(zoom.cam());
  };
}
