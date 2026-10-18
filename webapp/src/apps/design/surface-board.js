// Draws a surface board (tetrahedron, cube, ball) as its flat net (view/surface-net.js), as the
// solid (view/proj.js) or as a ball (view/ball.js), or a flat Pentagon board (buildFlat in
// view/surface-net.js, with its border): one SVG, as markup. Walls, numbers, the
// template path, solutions and the path being played are layers on the picture; the letters on
// the border of a net mark the sides that touch when it is folded.
// The click and drag logic is in surface.js; the colours of the classes are in css/design.css.
import { SLOTS } from '../../core/surface/topology.js';
import { maxNumber } from '../../core/surface/puzzle.js';
import { routePieces, routeCrossings } from '../../view/surface-net.js';
import { TPL_C, PLAY_C, SOL_C } from './board.js';

const MAX_WIDTH = 620;
const MAX_HEIGHT = 560;
const MAX_SIDE_PX = 60;
// The fill of the cells of each face, and of a cell the path has been through.
const FACE_TINT = ['#18213a', '#1f1d38', '#15262f', '#232130', '#172435', '#1d2133'];
const VISITED_TINT = '#25336a';
// The fill of the cells of a ball by their number of sides (it has no faces to tell apart): the
// composition of the ball shows.
const SIDES_TINT = { 3: '#1a2a52', 4: '#2a2250', 5: '#15383a' };

const round = value => Math.round(value * 100) / 100;

// A colour '#rrggbb' made darker: factor 1 leaves it, 0 is black.
function darker(hex, factor) {
  const channel = at => Math.round(parseInt(hex.slice(at, at + 2), 16) * factor);
  return `rgb(${channel(1)},${channel(3)},${channel(5)})`;
}

// How the net maps to the picture: net units to pixels (y flipped), and back.
export function netFrame(net) {
  const { box, side } = net;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const sideCap = net.maxSidePx ?? MAX_SIDE_PX;
  const scale = Math.min(
    (net.maxWidth ?? MAX_WIDTH) / width,
    (net.maxHeight ?? MAX_HEIGHT) / height,
    sideCap / side,
  );
  // room around the net for the letters of the cuts, or for the arrows at the edge of a solid
  const margin = Math.ceil(side * scale * (net.tags.length ? 0.95 : 0.4));
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
//   idSuffix           makes the id of the gloss of a ball unique when two balls are on a page
// `net` is the flat net (view/surface-net.js) or the solid in a view (view/proj.js): a cell with
// net.hidden[cell] is not drawn, net.depth[cell] (how much it faces the viewer) shades it, and
// net.frameOf(cell) lays its number and the head marker into the plane of the cell. A ball
// (view/ball.js) also has net.outlines[cell] (the curved outline to draw), net.drawn[cell] (a
// cell partly in front is drawn, a cell with net.hidden is not marked), net.arcPieces,
// net.sideMid and net.routePieces (curved sides and routes), net.markRadius(cell) (cells differ
// in size), net.uniform and net.disc (no faces; the disc of the ball).
// Returns { markup, frame }.
export function surfaceSvg(net, V) {
  const { top } = net;
  const { P } = V;
  const frame = netFrame(net);
  const px = net.side * frame.scale;
  const points = poly => poly.map(corner => frame.toPixels(corner).join(',')).join(' ');
  const parts = [];
  // A mark centred on a cell at pixel (x, y): drawn at (x, y), or in a 3D view at the origin of a
  // matrix that lays it into the plane of the cell and moves it to (x, y).
  // Returns [cx, cy, transform].
  const placed = (cell, x, y) => {
    if (!net.frameOf) {
      return [x, y, ''];
    }
    const [a, b, c, d] = net.frameOf(cell).map(value => Math.round(value * 1e4) / 1e4);
    return [0, 0, ` transform="matrix(${a} ${b} ${c} ${d} ${x} ${y})"`];
  };

  const seen = cell => !net.hidden || !net.hidden[cell];
  const drawn = cell => (net.drawn ? Boolean(net.drawn[cell]) : seen(cell));
  const outline = cell => (net.outlines ? net.outlines[cell] : net.polys[cell]);
  if (net.disc) {
    const [x, y] = frame.toPixels([0, 0]);
    parts.push(`<circle class=\"sf-disc\" cx=\"${x}\" cy=\"${y}\" r=\"${round(frame.scale)}\"/>`);
  }
  // how much a cell faces the viewer: it is darker when turned away
  const facing = cell => (net.depth ? Math.min(1, Math.max(0, net.depth[cell])) : 1);
  const visited = new Set(V.playing ? V.path : []);
  for (let cell = 0; cell < top.T; cell++) {
    if (!drawn(cell)) {
      continue;
    }
    const classes = ['sf-cell', `sf-f${top.faceOf[cell]}`];
    if (visited.has(cell)) {
      classes.push('visited');
    }
    const faceTint = net.uniform
      ? SIDES_TINT[top.deg[cell]]
      : FACE_TINT[top.faceOf[cell] % FACE_TINT.length];
    const tint = visited.has(cell) ? VISITED_TINT : faceTint;
    const fill = darker(tint, 0.6 + 0.4 * facing(cell));
    parts.push(`<polygon class="${classes.join(' ')}" data-cell="${cell}" fill="${fill}" `
      + `points="${points(outline(cell))}"/>`);
  }
  if (net.disc) {
    // light from the upper left, dark towards the rim: the cells look round
    const [x, y] = frame.toPixels([0, 0]);
    const id = `sfGloss${V.idSuffix ?? ''}`;
    parts.push(`<defs><radialGradient id="${id}" cx="36%" cy="30%" r="80%">`
      + '<stop offset="0" stop-color="#fff" stop-opacity="0.16"/>'
      + '<stop offset="0.55" stop-color="#fff" stop-opacity="0"/>'
      + '<stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient></defs>'
      + `<circle class="sf-gloss" cx="${x}" cy="${y}" r="${round(frame.scale)}" `
      + `fill="url(#${id})"/>`);
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

  // the border of a flat board: the sides that have no neighbour
  if (top.flat) {
    for (let cell = 0; cell < top.T; cell++) {
      for (let slot = 0; slot < top.deg[cell]; slot++) {
        if (top.nb[cell * SLOTS + slot] < 0) {
          const poly = net.polys[cell];
          const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]].map(frame.toPixels);
          parts.push(`<line class="sf-border" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" `
            + `y2="${b[1]}"/>`);
        }
      }
    }
  }

  // a wall stands on a side; on a cut it stands on both copies
  const wallWidth = round(px * 0.14);
  for (let cell = 0; cell < top.T; cell++) {
    for (let slot = 0; slot < top.deg[cell]; slot++) {
      const other = top.nb[cell * SLOTS + slot];
      const shown = !net.glued[cell * SLOTS + slot] || cell < other;
      if (shown && (drawn(cell) || drawn(other)) && P.walls[top.edgeAt[cell * SLOTS + slot]]) {
        if (net.arcPieces) {
          // a curved side: the parts of its arc that are in front
          for (const piece of net.arcPieces(cell, slot)) {
            parts.push(`<polyline class="sf-wall" fill="none" stroke-width="${wallWidth}" `
              + `points="${piece.map(point => frame.toPixels(point)).join(' ')}"/>`);
          }
        } else {
          const poly = net.polys[cell];
          const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]].map(frame.toPixels);
          parts.push(`<line class="sf-wall" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" `
            + `stroke-width="${wallWidth}"/>`);
        }
      }
    }
  }

  // An arrow on the side a route leaves by (pointing out) or enters by (pointing in), with the
  // letter of the cut beside it: the route goes on at the same letter.
  const arrow = (mark, color) => {
    const poly = net.polys[mark.cell].map(corner => frame.toPixels(corner));
    const [a, b] = [poly[mark.slot], poly[(mark.slot + 1) % poly.length]];
    const [cx, cy] = frame.toPixels(net.centers[mark.cell]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const sign = (mid[0] - cx) * along[1] - (mid[1] - cy) * along[0] > 0 ? 1 : -1;
    const out = [along[1] * sign, -along[0] * sign];
    const size = px * 0.2;
    const at = (lift, spread) => [
      round(mid[0] + out[0] * lift * size + along[0] * spread * size),
      round(mid[1] + out[1] * lift * size + along[1] * spread * size),
    ];
    const [tip, left, right] = mark.kind === 'out'
      ? [at(0.9, 0), at(-0.4, 0.55), at(-0.4, -0.55)]
      : [at(-0.5, 0), at(0.9, 0.55), at(0.9, -0.55)];
    parts.push(`<polygon class="sf-arrow" points="${tip} ${left} ${right}" fill="${color}"/>`);
    if (mark.letter) {
      const [x, y] = at(1.9, 0);
      parts.push(`<text class="sf-cross" x="${x}" y="${y}" font-size="${round(px * 0.26)}">`
        + `${mark.letter}</text>`);
    }
  };
  const route = (cells, color, extra = '', thickness = net.depth ? 0.1 : 0.13) => {
    const width = round(px * thickness);
    for (const piece of net.routePieces ? net.routePieces(cells) : routePieces(net, cells)) {
      if (piece.length > 1) {
        const line = piece.map(corner => frame.toPixels(corner)).join(' ');
        parts.push(`<polyline class="sf-path" points="${line}" `
          + `stroke="${color}" stroke-width="${width}" ${extra}/>`);
      }
    }
    if (!net.routePieces) {
      routeCrossings(net, cells).forEach(mark => arrow(mark, color));
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
    const head = V.path[V.path.length - 1];
    if (seen(head)) {
      const [x, y] = frame.toPixels(net.centers[head]);
      const [cx, cy, at] = placed(head, x, y);
      const r = net.markRadius ? round(net.markRadius(head) * frame.scale * 0.5) : round(px * 0.17);
      parts.push(`<circle class="sf-head" cx="${cx}" cy="${cy}" r="${r}"${at}/>`);
    }
  }

  // numbers
  const K = maxNumber(P);
  const radiusOf = cell => (net.markRadius
    ? round(net.markRadius(cell) * frame.scale)
    : round(px * (top.deg[cell] === 3 ? 0.25 : 0.36)));
  const fontFor = (text, radius) => (net.markRadius
    ? round(radius * (String(text).length > 2 ? 0.72 : 0.95))
    : round(px * (String(text).length > 2 ? 0.26 : 0.34)));
  for (let cell = 0; cell < top.T; cell++) {
    if (!seen(cell)) {
      continue;
    }
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
    const radius = radiusOf(cell);
    const [cx, cy, at] = placed(cell, x, y);
    parts.push(`<g class="${classes.join(' ')}"${at}><circle cx="${cx}" cy="${cy}" r="${radius}"/>`
      + `<text x="${cx}" y="${cy}" font-size="${fontFor(number, radius)}">${number}</text></g>`);
  }

  if (V.selected >= 0 && !V.playing && drawn(V.selected)) {
    parts.push(`<polygon class="sf-sel" points="${points(outline(V.selected))}"/>`);
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
