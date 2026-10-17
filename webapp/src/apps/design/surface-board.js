// Draws a surface board (tetrahedron, cube) as its flat net (view/surface-net.js): one SVG, as
// markup. Walls, numbers, the template path, solutions and the path being played are layers on
// the net; the letters on the border of the net mark the sides that touch when it is folded.
// The click and drag logic is in surface.js; the colours of the classes are in css/design.css.
import { SLOTS } from '../../core/surface/topology.js';
import { maxNumber } from '../../core/surface/puzzle.js';
import { buildNet, routePieces } from '../../view/surface-net.js';
import { TPL_C, PLAY_C, SOL_C } from './board.js';

const MAX_WIDTH = 620;
const MAX_HEIGHT = 560;
const MAX_SIDE_PX = 60;

const round = value => Math.round(value * 100) / 100;

// How the net maps to the picture: net units to pixels (y flipped), and back.
export function netFrame(net) {
  const { box, side } = net;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, MAX_SIDE_PX / side);
  // room around the net for the letters of the cuts
  const margin = Math.ceil(side * scale * 0.95);
  return {
    scale,
    width: round(width * scale + 2 * margin),
    height: round(height * scale + 2 * margin),
    toPixels: ([x, y]) => [
      round((x - box.minX) * scale + margin),
      round((box.maxY - y) * scale + margin),
    ],
    toNet: (px, py) => [(px - margin) / scale + box.minX, box.maxY - (py - margin) / scale],
  };
}

// The picture of puzzle V.P. View state V:
//   selected, buffer   the cell being numbered and the digits typed so far (edit mode)
//   playing, path      the path walked in play mode
//   template           the dashed path of the generator, or null
//   solutions, visible the solutions of Solve and which of them to show
// Returns { markup, frame }.
export function surfaceSvg(net, V) {
  const { top } = net;
  const { P } = V;
  const frame = netFrame(net);
  const px = net.side * frame.scale;
  const points = poly => poly.map(corner => frame.toPixels(corner).join(',')).join(' ');
  const parts = [];

  const visited = new Set(V.playing ? V.path : []);
  for (let cell = 0; cell < top.T; cell++) {
    const classes = ['sf-cell', `sf-f${top.faceOf[cell]}`];
    if (visited.has(cell)) {
      classes.push('visited');
    }
    parts.push(`<polygon class="${classes.join(' ')}" data-cell="${cell}" `
      + `points="${points(net.polys[cell])}"/>`);
  }

  // the cuts of the net: dashed, with the letter of the cut beside them
  for (let cell = 0; cell < top.T; cell++) {
    for (let slot = 0; slot < top.deg[cell]; slot++) {
      if (!net.glued[cell * SLOTS + slot]) {
        const poly = net.polys[cell];
        const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]].map(frame.toPixels);
        parts.push(`<line class="sf-cut" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
      }
    }
  }

  // a wall stands on a side; on a cut it stands on both copies
  const wallWidth = round(px * 0.14);
  for (let cell = 0; cell < top.T; cell++) {
    for (let slot = 0; slot < top.deg[cell]; slot++) {
      const other = top.nb[cell * SLOTS + slot];
      const shown = !net.glued[cell * SLOTS + slot] || cell < other;
      if (shown && P.walls[top.edgeAt[cell * SLOTS + slot]]) {
        const poly = net.polys[cell];
        const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]].map(frame.toPixels);
        parts.push(`<line class="sf-wall" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" `
          + `stroke-width="${wallWidth}"/>`);
      }
    }
  }

  const route = (cells, color, extra = '', thickness = 0.13) => {
    const width = round(px * thickness);
    for (const piece of routePieces(net, cells)) {
      if (piece.length > 1) {
        const line = piece.map(corner => frame.toPixels(corner)).join(' ');
        parts.push(`<polyline class="sf-path" points="${line}" `
          + `stroke="${color}" stroke-width="${width}" ${extra}/>`);
      }
    }
  };
  if (V.template && !V.playing) {
    route(V.template, TPL_C, `stroke-dasharray="${round(px * 0.2)} ${round(px * 0.14)}"`, 0.07);
  }
  if (!V.playing) {
    V.solutions.forEach((cells, i) => {
      if (V.visible[i]) {
        route(cells, SOL_C[i % SOL_C.length]);
      }
    });
  }
  if (V.playing && V.path.length) {
    route(V.path, PLAY_C);
    const [x, y] = frame.toPixels(net.centers[V.path[V.path.length - 1]]);
    parts.push(`<circle class="sf-head" cx="${x}" cy="${y}" r="${round(px * 0.17)}"/>`);
  }

  // numbers
  const K = maxNumber(P);
  const fontFor = text => round(px * (String(text).length > 2 ? 0.26 : 0.34));
  for (let cell = 0; cell < top.T; cell++) {
    const pending = cell === V.selected && !V.playing && V.buffer !== '';
    const number = pending ? V.buffer : P.cp[cell];
    if (!number) {
      continue;
    }
    const classes = ['sf-badge'];
    if (pending) {
      classes.push('pending');
    } else if (number === 1) {
      classes.push('start');
    } else if (number === K) {
      classes.push('end');
    }
    if (visited.has(cell)) {
      classes.push('visited');
    }
    const [x, y] = frame.toPixels(net.centers[cell]);
    const radius = round(px * (top.deg[cell] === 3 ? 0.25 : 0.36));
    parts.push(`<g class="${classes.join(' ')}"><circle cx="${x}" cy="${y}" r="${radius}"/>`
      + `<text x="${x}" y="${y}" font-size="${fontFor(number)}">${number}</text></g>`);
  }

  if (V.selected >= 0 && !V.playing) {
    parts.push(`<polygon class="sf-sel" points="${points(net.polys[V.selected])}"/>`);
  }

  // the letters of the cuts, outside the net
  const tagRadius = round(px * 0.3);
  for (const tag of net.tags) {
    const [x, y] = frame.toPixels([tag.x, tag.y]);
    const lift = px * 0.55;
    const cx = round(x + tag.dx * lift);
    const cy = round(y - tag.dy * lift);
    const font = round(tagRadius * 1.3);
    parts.push(`<g class="sf-tag"><circle cx="${cx}" cy="${cy}" r="${tagRadius}"/>`
      + `<text x="${cx}" y="${cy}" font-size="${font}">${tag.letter}</text></g>`);
  }

  const markup = `<svg class="sf-svg" xmlns="http://www.w3.org/2000/svg" `
    + `viewBox="0 0 ${frame.width} ${frame.height}" width="${frame.width}" `
    + `height="${frame.height}">${parts.join('')}</svg>`;
  return { markup, frame };
}
