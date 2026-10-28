// Turns the design prototypes into themes: the one-off (and repeatable) step from a designer's page to themes/<id>/.
//   node themes/tools/import-proto.mjs [--assets DIR] [id ...]     (npm run themes:import in webapp/)
// Reads, from the assets folder (default: assets/ of the repository, where the design zip unpacks to)
//   design/zigzag-NN-name.html                       the design page: palette, shapes, fonts, the phone mock (app bar, button, board)
//   images/logo/proto/NN-name-variants.svg           the variant icons of the design (12 puzzle types)
// and writes themes/<id>/theme.json and art.json. A design page zigzag-NN-<id>.html is the theme <id>; every page of the folder is imported.
// What the pages do not carry (Chinese name, symbol, layout) is in proto-meta.json; a design with no entry there gets the English name,
// the default symbol and the default layout, so a new design page needs no other step (an entry with "skip" keeps a page out: its
// theme is written by hand). The generated theme.json says `"proto": ...`:
// a theme without it was written by hand and is never overwritten (unless --force).
// Every value is read from the page's own CSS and board mock, so a new version of a design is a new import, not a rewrite. Run it again
// and the generated files change: edit proto-meta.json (or the design) rather than the generated theme, or drop the theme from the
// meta and own it by hand. Prints what it could not read and fell back on.
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanLayout } from '../../webapp/src/themes/layout.js';
import { ID_RE } from '../../webapp/src/themes/pool.js';
import { cleanInner, cleanSvg } from '../../webapp/src/themes/svg.js';
import { SYSTEM_FONTS } from '../../webapp/src/themes/tokens.js';
import { checkValue } from '../../webapp/src/themes/tokens.js';
import {
  contrast, ensure, luminance, mix, onColour, rgb, toHex,
} from './color.js';
import { DEFAULT_SYMBOL } from './pack.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const THEMES = fileURLToPath(new URL('../', import.meta.url));
const META = JSON.parse(readFileSync(`${HERE}proto-meta.json`, 'utf8'));
const CELL = 60;   // the mock board is 300 units for 5 cells
const ICON_IDS = {
  std: 'standard', cut: 'cutout', arr: 'arrows', exact: 'exact', wrap: 'wrap', loop: 'loop', tele: 'teleport', two: 'twopaths', pent: 'pentagon', tetra: 'tetra', cube: 'cube', ball: 'ball',
};

// ---- colours ----
const NAMED = { white: '#ffffff', black: '#000000', transparent: 'rgba(0,0,0,0)' };
// "#abc", "#aabbcc", "rgb(..)", "rgba(..)", a name -> { r, g, b, a } or null
export function parseColour(text) {
  const v = String(text ?? '').trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(NAMED[v] ?? v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const [r, g, b] = rgb(`#${h.slice(0, 6)}`);
    return { r, g, b, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(NAMED[v] ?? v);
  if (fn) {
    const p = fn[1].split(/[\s,/]+/).filter(Boolean).map(x => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
    if (p.length >= 3 && p.every(Number.isFinite)) return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] > 1 ? p[3] / 2.55 : p[3] };
  }
  return null;
}
const hexOf = c => toHex([c.r, c.g, c.b]);
// the colour as an opaque hex on top of `under` (a hex)
const flatten = (c, under) => (c.a >= 0.999 ? hexOf(c) : mix(under, hexOf(c), c.a));

const splitTop = (s, sep = ',') => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const COLOUR_IN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const coloursIn = text => [...String(text ?? '').matchAll(COLOUR_IN)].map(m => parseColour(m[0])).filter(Boolean);

// the plain colour a `background` value rests on: its last layer if that is a colour, else (a gradient) its `which` stop
function baseColour(value, which = 'last') {
  if (!value) return null;
  for (const part of splitTop(value).reverse()) {
    const c = parseColour(part.replace(/\s+/g, ' '));
    if (c) return c;
  }
  const stops = coloursIn(value);
  return stops.length ? (which === 'first' ? stops[0] : stops[stops.length - 1]) : null;
}

// ---- the page's CSS ----
function parseCss(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  const rules = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const sel = raw.trim().replace(/\s+/g, ' ');
      const props = (rules[sel] ??= {});
      for (const d of splitTop(m[2], ';')) {
        const at = d.indexOf(':');
        if (at > 0) props[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
    }
  }
  return rules;
}
const first = (v, re) => (v ? (re.exec(v) ?? [])[1] : undefined);
const px = v => { const n = parseFloat(first(v, /(-?[\d.]+)px/) ?? 'x'); return Number.isFinite(n) ? n : undefined; };

// ---- the phone mock: the board, the numbers ----
const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const tagsOf = (markup, name) => [...markup.matchAll(new RegExp(`<${name}\\b[^>]*?/?>`, 'g'))].map(m => attrsOf(m[0]));

// where the app mock starts: the phone (class ph), or the bento (class am) of a design that has no phone
const mockAt = html => { const at = ['class="ph"', 'class="am"'].map(k => html.indexOf(k)).filter(i => i >= 0); return at.length ? Math.min(...at) : -1; };

function boardOf(html) {
  const at = mockAt(html);
  const boards = at < 0 ? [] : [...html.slice(at).matchAll(/<svg[^>]*viewBox="0 0 300 300"[^>]*>([\s\S]*?)<\/svg>/g)];
  return boards.length ? boards[0][1] : null;
}

// a paint value of the mock -> a colour (with the gradient it names resolved to a stop), or null
function paint(value, board, which = 'first') {
  if (!value || value === 'none') return null;
  const ref = /^url\(#([^)]+)\)$/.exec(value);
  if (!ref) return parseColour(value);
  const grad = new RegExp(`<(?:linear|radial)Gradient[^>]*id="${ref[1]}"[\\s\\S]*?</(?:linear|radial)Gradient>`).exec(board);
  const stops = grad ? tagsOf(grad[0], 'stop').map(s => parseColour(s['stop-color'])).filter(Boolean) : [];
  return stops.length ? (which === 'first' ? stops[0] : stops[stops.length - 1]) : null;
}

// ---- icons ----
function iconGroups(sheet) {
  const out = {};
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let depth = 0;
  let keep = null;
  for (const m of sheet.matchAll(tag)) {
    const [, close, name, rest, self] = m;
    if (close) {
      depth--;
      if (keep && depth === keep.depth) { out[keep.key] = sheet.slice(keep.from, m.index); keep = null; }
    } else {
      if (name === 'g' && depth === 1 && !keep) {
        const id = /id="v-([a-z]+)"/.exec(rest)?.[1];
        if (id) keep = { key: id, depth: depth, from: m.index + m[0].length };
      }
      if (!self) depth++;
    }
  }
  return out;
}

// `compact` in proto-meta.json: three or more equal dots in a row (<circle cx cy r fill/>, as in the marquee lights of a pinball plate) are one
// path of zero-length segments with round caps: the same picture in a fifth of the bytes, which keeps a design with a ring of lights inside
// the bundle budget (it moves a few edge pixels, so it is not done for a design that fits without).
// Not inside a filtered group: a blur region is a share of the group's box, and the box of bare points is smaller than that of dots.
const DOT = String.raw`<circle cx="[-\d.]+" cy="[-\d.]+" r="([\d.]+)" fill="(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))"/>`;
const DOTS = new RegExp(`${DOT}(?:<circle cx="[-\\d.]+" cy="[-\\d.]+" r="\\1" fill="\\2"/>){2,}`, 'g');
const inFilter = before => {
  const open = [];
  for (const m of before.matchAll(/<g\b[^>]*?(\/?)>|<\/g>/g)) {
    if (m[0] === '</g>') open.pop();
    else if (!m[1]) open.push(/\sfilter=/.test(m[0]));
  }
  return open.includes(true);
};
export function compactDots(markup) {
  return markup.replace(DOTS, (run, r, fill, at) => {
    if (inFilter(markup.slice(0, at))) return run;
    const d = [...run.matchAll(/cx="([-\d.]+)" cy="([-\d.]+)"/g)].map(m => `M${m[1]} ${m[2]}h0`).join('');
    return `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${+(2 * r).toFixed(3)}" stroke-linecap="round"/>`;
  });
}

// One icon of a sheet -> the markup the app accepts (shapes, paint servers, short labels), or null with a reason.
function cleanIcon(inner, notes, label, compact = false) {
  let s = inner
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>|<desc>[\s\S]*?<\/desc>/g, '')
    .replace(/<text\b[^>]*>(?!(?:[\w.]|&gt;|&lt;){1,4}<\/text>)[^<]*<\/text>/g, '')       // a caption, not a label
    .replace(/\sfont-family="[^"]*"/g, '')
    .replace(/\sxmlns(:\w+)?="[^"]*"/g, '')
    .replace(/\bid="\d+/g, 'id="').replace(/url\(#\d+/g, 'url(#')           // an id starts with a letter
    .replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  s = s.replace(/<(\w+)([^>]*?)\s*\/>/g, '<$1$2/>');
  if (compact) s = compactDots(s);
  const ok = cleanInner(s, 9000);
  if (ok === null) { notes.push(`${label}: the app's svg whitelist refuses it`); return null; }
  return ok;
}

// ---- the whole design ----
// The designs of an assets folder: { id: { design, sheet } } from the page names zigzag-NN-<id>.html
export function discover(assets) {
  const found = {};
  const dir = `${assets}/design`;
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir).sort()) {
    const m = /^zigzag-(\d+)-([a-z][a-z0-9-]*)\.html$/.exec(file);
    if (!m) continue;
    if (!ID_RE.test(m[2])) throw new Error(`${file}: "${m[2]}" is not a theme id`);
    if (META[m[2]]?.skip) continue;   // a page that a hand-written theme already stands for
    if (found[m[2]]) throw new Error(`${file}: the id ${m[2]} is the design of ${found[m[2]].design} too`);
    found[m[2]] = { design: file.replace(/\.html$/, ''), sheet: `${m[1]}-${m[2]}` };
  }
  return found;
}

const titleCase = id => id.replace(/(^|-)([a-z])/g, (_, a, b) => `${a ? ' ' : ''}${b.toUpperCase()}`);
const metaFor = (id, found) => ({
  name: { en: titleCase(id), zh: titleCase(id) }, layout: cleanLayout(), symbol: DEFAULT_SYMBOL, ...META[id], ...found,
});

export function importDesign(id, assets, notes = [], found = discover(assets)[id]) {
  const meta = metaFor(id, found);
  const html = readFileSync(`${assets}/design/${meta.design}.html`, 'utf8');
  const sheet = readFileSync(`${assets}/images/logo/proto/${meta.sheet}-variants.svg`, 'utf8');
  const css = parseCss(html);
  const rule = (sel, prop) => css[sel]?.[prop];
  const note = text => notes.push(`${id}: ${text}`);
  const palette = [...html.matchAll(/<div class="sw"[^>]*style="[^"]*background:\s*(#[0-9a-fA-F]{3,8})[^"]*"[^>]*>([^<]*)/g)].map(m => ({ hex: hexOf(parseColour(m[1])), label: m[2].trim() }));

  // page and surfaces
  const pageBg = baseColour(rule('.r', 'background') ?? rule('.r', 'background-color')) ?? parseColour(palette[0]?.hex);
  if (!pageBg) throw new Error(`${id}: no page background`);
  const bg = hexOf(pageBg);
  const dark = luminance(bg) < 0.25;
  const bento = html.includes('class="am"') && !html.includes('class="ph"');
  const card = bento ? '.aa' : '.ph';
  const phBg = baseColour(rule(card, 'background') ?? rule(card, 'background-color'));
  let surface = phBg && phBg.a > 0.02 ? flatten(phBg, bg) : bg;
  if (!phBg) note('no panel colour: the surface is the page colour');
  const ink = hexOf(parseColour(rule('.r', 'color')) ?? parseColour(rule('.t b', 'color')) ?? parseColour(palette[1]?.hex) ?? { r: 17, g: 17, b: 17 });
  const mutedC = parseColour(rule('.t span', 'color')) ?? parseColour(rule('.d', 'color'));
  const muted = mutedC ? flatten(mutedC, surface) : mix(surface, ink, 0.62);
  const go = baseColour(rule('.go', 'background') ?? rule('.go', 'background-color'));
  const accentC = go && go.a > 0.5 ? go : baseColour(rule('.ch span.o', 'background')) ?? parseColour(palette.find(p => p.hex !== bg && p.hex !== ink)?.hex);
  // a text colour on a fill: the design's, else the better of white and black; if neither reaches `min`, the fill moves a little
  const pairUp = (fillHex, textHex, min = 4.5) => {
    let text = textHex;
    if (contrast(text, fillHex) < min) text = onColour(fillHex);
    return contrast(text, fillHex) >= min ? [fillHex, text] : [ensure(fillHex, [text], min), text];
  };
  const accentRaw = hexOf(accentC);
  const [accent, onAccent] = pairUp(ensure(accentRaw, [surface], 3), hexOf(parseColour(rule('.go', 'color')) ?? { r: 255, g: 255, b: 255 }));
  if (accent !== accentRaw) note(`accent ${accentRaw} moved to ${accent} (3:1 on the surface, 4.5:1 for the text on it)`);

  // the board mock
  const board = boardOf(html);
  const skin = { grid: 'tiles', tileRx: 0.2, tileInset: 0.05, tileEdgeW: 0.017, depth: 0, plateRx: 0, pathW: 0.28, cap: 'round', join: 'round', gradient: false, wallW: 0.117, wallCap: 'round', num: 'disc', numR: 0.267, numRingW: 0.03 };
  const seeds = {};
  if (!board) note('no board mock in the page: board and number colours are guesses');
  let tile = surface;
  let tileEdge = mix(surface, ink, 0.12);
  if (board) {
    const pattern = /<pattern id="t"[\s\S]*?<\/pattern>/.exec(board)?.[0] ?? '';
    const rects = tagsOf(pattern, 'rect');
    const r0 = rects[rects.length - 1] ?? {};
    const fill = paint(r0.fill, board);
    tile = fill && fill.a > 0.02 ? flatten(fill, surface) : surface;
    const edge = paint(r0.stroke, board);
    tileEdge = edge ? flatten(edge, tile) : tileEdge;
    const inset = (parseFloat(r0.x) || 0) / CELL;
    skin.grid = r0.fill === 'none' && !inset ? 'lines' : 'tiles';
    skin.tileInset = +inset.toFixed(3);
    skin.tileRx = +((parseFloat(r0.rx) || 0) / CELL).toFixed(3);
    skin.tileEdgeW = +((parseFloat(r0['stroke-width']) || 0) / CELL).toFixed(3);
    if (rects.length > 1) {                       // a second rect under the first: the tile's lower edge
      const under = rects[0];
      const dy = ((parseFloat(r0.y) || 0) - (parseFloat(under.y) || 0)) / CELL;
      const c = paint(under.fill, board);
      if (dy > 0 && c) { skin.depth = +Math.min(dy, 0.5).toFixed(3); seeds.depth = flatten(c, surface); }
    }
    const line = tagsOf(board.replace(pattern, ''), 'line')[0];
    if (line) {
      seeds.wall = flatten(paint(line.stroke, board) ?? parseColour(ink), tile);
      skin.wallW = +Math.min((parseFloat(line['stroke-width']) || 7) / CELL, 0.5).toFixed(3);
      skin.wallCap = ['round', 'square', 'butt'].includes(line['stroke-linecap']) ? line['stroke-linecap'] : 'round';
    }
    const routes = [...board.matchAll(/<polyline\b[^>]*points="30,30[^"]*"[^>]*>/g)].map(m => attrsOf(m[0]));
    const main = routes[routes.length - 1];
    if (main) {
      const stroke = main.stroke ?? '';
      const grad = stroke.startsWith('url(');
      const c0 = paint(stroke, board, 'first');
      const c1 = paint(stroke, board, 'last');
      seeds.path = flatten(c0 ?? parseColour(accent), tile);
      if (grad && c1) { seeds.pathHi = flatten(c1, tile); skin.gradient = true; }
      skin.pathW = +Math.min((parseFloat(main['stroke-width']) || 16) / CELL, 0.5).toFixed(3);
      skin.cap = ['round', 'square', 'butt'].includes(main['stroke-linecap']) ? main['stroke-linecap'] : 'round';
      skin.join = main['stroke-linejoin'] === 'miter' ? 'miter' : 'round';
    }
    // the numbers: 1..3 idle, 4..5 visited
    const discs = [...board.matchAll(/<(circle|rect)\b([^>]*?)\/?>\s*<text\b([^>]*)>(\d)<\/text>/g)].map(m => ({ shape: m[1], a: attrsOf(m[2]), t: attrsOf(m[3]), n: +m[4] }));
    const idle = discs.find(d => d.n === 1);
    const done = discs.find(d => d.n === 4);
    if (idle) {
      skin.num = idle.shape === 'rect' ? 'square' : 'disc';
      skin.numR = +Math.min((idle.shape === 'rect' ? (parseFloat(idle.a.width) || 32) / 2 : parseFloat(idle.a.r) || 16) / CELL, 0.5).toFixed(3);
      skin.numRingW = +Math.min((parseFloat(idle.a['stroke-width']) || 0) / CELL, 0.5).toFixed(3);
      seeds.numFill = flatten(paint(idle.a.fill, board) ?? parseColour(accent), tile);
      seeds.numText = hexOf(paint(idle.t.fill, board) ?? parseColour(ink));
      const ring = paint(idle.a.stroke, board);
      if (ring) seeds.numRing = flatten(ring, tile);
    } else note('no number discs in the mock');
    if (done) {
      seeds.numvFill = flatten(paint(done.a.fill, board) ?? parseColour(accent), tile);
      seeds.numvText = hexOf(paint(done.t.fill, board) ?? { r: 255, g: 255, b: 255 });
      const ring = paint(done.a.stroke, board);
      if (ring) seeds.numvRing = flatten(ring, tile);
    }
  }
  seeds.wall ??= ink;
  seeds.path ??= accent;
  seeds.numFill ??= accent;
  seeds.numText ??= onAccent;
  [seeds.numFill, seeds.numText] = pairUp(seeds.numFill, seeds.numText);
  [seeds.numvFill, seeds.numvText] = pairUp(seeds.numvFill ?? ink, seeds.numvText ?? surface);
  skin.solid = luminance(tile) > 0.45 ? 'light' : 'dark';

  // the second accent (hint, highlights): a warm, saturated colour of the palette, else the idle number colour
  const hue = hex => {
    const [r, g, b] = rgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
    if (!d) return [0, 0];
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, d / (1 - Math.abs(mx + mn - 1) || 1)];
  };
  const warm = palette.map(p => p.hex).filter(h => h !== bg && h !== accent && h !== ink && !(h === surface)).find(h => { const [hh, s] = hue(h); return hh >= 12 && hh <= 62 && s > 0.5; });
  const orange = warm ?? seeds.numFill;

  // the two-paths colours (the red and blue routes of a Two paths board): the most used colours of the 'two' icon, its first shape (the
  // frame) left out. The first is the most used saturated colour, the second the next one of another hue, else a colour that contrasts
  // with it (then the ink); `routes` in proto-meta.json sets the pair by hand
  const groups = iconGroups(sheet);
  const gradients = {};   // a gradient counts as its first colour
  for (const m of (groups.two ?? '').matchAll(/<(?:linear|radial)Gradient id="([^"]+)"[^>]*><stop [^>]*stop-color="(#[0-9a-fA-F]{3,8})"/g)) gradients[m[1]] = m[2];
  const shapes = [...(groups.two ?? '').replace(/<defs>[\s\S]*?<\/defs>/, '').matchAll(/<(?:rect|path|polygon|polyline|circle|ellipse|line)\b[^>]*>/g)].map(m => m[0]);
  const used = {};
  for (const shape of shapes.slice(1)) {
    for (const m of shape.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8}|url\(#[^)]+\))"/g)) {
      const c = hexOf(parseColour(m[1].startsWith('url') ? gradients[m[1].slice(5, -1)] : m[1]) ?? parseColour('#000'));
      if (!m[1].startsWith('url') || gradients[m[1].slice(5, -1)]) used[c] = (used[c] ?? 0) + 1;
    }
  }
  const ranked = Object.entries(used).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const vivid = ranked.filter(h => hue(h)[1] > 0.3);
  const apart = (a, b) => { const d = Math.abs(hue(a)[0] - hue(b)[0]); return Math.min(d, 360 - d) >= 40; };
  const red = meta.routes?.[0] ?? vivid[0] ?? ranked[0] ?? accent;
  const blue = meta.routes?.[1] ?? vivid.find(h => h !== red && apart(h, red)) ?? ranked.find(h => h !== red && contrast(h, red) >= 2) ?? (contrast(ink, red) >= 2 ? ink : accent);

  // nudge the colours the contrast pairs constrain (derive nudges the rest)
  const tiled = [tile];
  const seedOut = {
    bg, surface, ink, muted, accent, onAccent, orange,
    tile, tileEdge, wall: ensure(seeds.wall, tiled, 3), path: ensure(seeds.path, tiled, 3), red: ensure(red, tiled, 3), blue: ensure(blue, tiled, 3),
    numFill: seeds.numFill, numText: seeds.numText, numvFill: ensure(seeds.numvFill, [seeds.numFill], 1.5), numvText: seeds.numvText, onOrange: onColour(orange),
  };
  for (const k of ['pathHi', 'numRing', 'numvRing', 'depth']) if (seeds[k]) seedOut[k] = seeds[k];
  // a bento menu colours its variant tiles from four palette slots: the design's first four tile colours, each with the text on it
  if (meta.layout?.menu === 'bento') {
    const tiles = [...new Map([...html.matchAll(/class="ak"[^>]*style="background:(#[0-9a-fA-F]{3,8});color:(#[0-9a-fA-F]{3,8})"/g)].map(m => [m[1].toLowerCase(), m[2].toLowerCase()])).entries()].slice(0, 4);
    if (tiles.length === 4) seedOut.vt = tiles.map(([fill, on]) => [fill, on, luminance(on) > 0.5 ? ink : surface]);
    else note('a bento layout needs four tile colours; the page has ' + tiles.length);
  }
  if (seedOut.pathHi) seedOut.pathHi = ensure(seedOut.pathHi, tiled, 3);

  // shape, size and type
  const radius = (v, max) => { const n = px(v); return n === undefined ? undefined : n >= 28 && max === 28 ? '999px' : `${Math.min(n, max)}px`; };
  const vars = {};
  const fam = rule('.r', 'font-family') ?? '';
  const fonts = [...html.matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)].flatMap(m => [...m[1].matchAll(/family=([^&:]+)(?::wght@([\d;]+))?/g)])
    .map(m => {
      const weights = (m[2] ?? '400').split(';').map(Number);
      const family = decodeURIComponent(m[1]).replace(/\+/g, ' ');
      return { family, weight: `${Math.max(100, Math.min(...weights))} ${Math.min(900, Math.max(...weights))}`.replace(/^(\d+) \1$/, '$1'), file: `${family.toLowerCase().replace(/[^a-z0-9]+/g, '')}-latin.woff2` };
    }).slice(0, 3);
  const stack = splitTop(fam).map(f => f.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
  const shipped = new Set(fonts.map(f => f.family));
  const generic = stack.filter(f => /^(sans-serif|serif|monospace|cursive)$/.test(f));
  // the shipped families (quoted), the design's own fallbacks (plain names: the app only checks quoted ones), then the CJK families the app trusts
  const fallback = stack.filter(f => !shipped.has(f) && !generic.includes(f) && /^[A-Za-z][\w ]*$/.test(f));
  const cjk = SYSTEM_FONTS.replace(/, sans-serif$/, '');
  const body = [...stack.filter(f => shipped.has(f)).map(f => `"${f}"`), ...fallback, cjk, generic[generic.length - 1] ?? 'sans-serif'].join(', ');
  vars['--font-body'] = body;
  const fw = parseInt(rule('.t b', 'font-weight') ?? '700', 10);
  vars['--fw-head'] = String(Math.min(900, Math.max(500, Number.isFinite(fw) ? fw : 700)));
  if (/uppercase/.test(rule('.t b', 'text-transform') ?? '')) vars['--tt-head'] = 'uppercase';
  const set = (name, value) => { if (value !== undefined) vars[name] = value; };
  set('--r-1', radius(rule('.vq', 'border-radius') ?? rule('.vi', 'border-radius'), 28));
  set('--r-2', radius(rule('.go', 'border-radius'), 28));
  set('--r-3', radius(rule('.ph', 'border-radius'), 40));
  set('--r-4', radius(rule('.ph', 'border-radius'), 40));
  set('--r-chip', radius(rule('.ch span', 'border-radius') ?? rule('.ab i', 'border-radius'), 28));
  set('--r-icon', radius(rule('.ab i', 'border-radius'), 28));
  const bw = v => { const n = px(first(v, /(-?[\d.]+px\s+(?:solid|dashed|double))/)); return n === undefined ? undefined : `${Math.min(3, n)}px`; };
  set('--bw', bw(rule('.ab i', 'border')) ?? '1px');
  set('--bw-card', bw(rule('.ph', 'border')) ?? '0px');
  const shadow = (rule('.ph', 'box-shadow') ?? '').replace(/\s+/g, ' ').trim();
  const shadowOk = shadow && shadow !== 'none' && checkValue('--shadow', shadow).length === 0;
  vars['--shadow'] = shadowOk ? shadow : 'none';
  vars['--pop-shadow'] = shadowOk ? shadow : '0 12px 30px rgba(0, 0, 0, 0.22)';
  const h = px(rule('.go', 'height'));
  if (h) vars['--ctl-h'] = `${Math.min(56, Math.max(40, h))}px`;
  for (const [k, v] of Object.entries(vars)) {
    const bad = checkValue(k, v, undefined, fonts.map(f => f.family));
    if (bad.length) { note(`${k} ${v}: ${bad[0]}; left at the default`); delete vars[k]; }
  }

  // art
  const icons = {};
  for (const [key, name] of Object.entries(ICON_IDS)) {
    if (!groups[key]) { note(`no icon ${key} in the sheet`); continue; }
    const cleaned = cleanIcon(groups[key], notes, `${id}/${name}`, meta.compact);
    if (cleaned) icons[name] = cleaned;
  }
  const markRaw = /<svg[^>]*aria-label="zigzag mark"[^>]*>([\s\S]*?)<\/svg>/.exec(html.slice(Math.max(0, mockAt(html))));
  let mark = null;
  if (markRaw) {
    const inner = markRaw[1].replace(/<!--[\s\S]*?-->/g, '').replace(/\sfont-family="[^"]*"/g, '').replace(/\bid="\d+/g, 'id="').replace(/url\(#\d+/g, 'url(#').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    mark = cleanSvg(`<svg viewBox="0 0 96 96" role="img" aria-label="zigzag mark">${inner}</svg>`, 4000);
    if (!mark) note('the brand mark of the app bar is refused by the whitelist or too long: the shared mark is used');
  } else note('no brand mark in the app bar');

  const swatches = [bg, surface, seedOut.accent, orange];
  const theme = {
    id, v: 1, themeApi: 1, proto: meta.design, mode: dark ? 'dark' : 'light', name: meta.name, symbol: meta.symbol, layout: meta.layout, swatches,
    ...(fonts.length ? { fonts } : {}), seeds: seedOut, vars,
  };
  const art = { id, ...(mark ? { mark } : {}), icons, board: skin };
  return { theme, art };
}

// ---- command line ----
function main(argv) {
  const args = [...argv];
  let assets = fileURLToPath(new URL('../../assets', import.meta.url)).replace(/\/$/, '');
  const at = args.indexOf('--assets');
  if (at >= 0) assets = args.splice(at, 2)[1].replace(/\/$/, '');
  const force = args.includes('--force');
  const found = discover(assets);
  const ids = args.filter(a => a !== '--force');
  const todo = ids.length ? ids : Object.keys(found);
  if (!todo.length) { console.error(`no design pages in ${assets}/design (zigzag-NN-<id>.html)`); process.exitCode = 1; return; }
  const notes = [];
  let written = 0;
  for (const id of todo) {
    if (!found[id]) { console.error(`${id}: no design page zigzag-NN-${id}.html in ${assets}/design`); process.exitCode = 1; continue; }
    const file = `${THEMES}${id}/theme.json`;
    if (existsSync(file) && !force && !JSON.parse(readFileSync(file, 'utf8')).proto) {
      console.log(`  skip   ${id}: themes/${id}/ was written by hand (--force replaces it)`);
      continue;
    }
    if (!META[id]) notes.push(`${id}: not in proto-meta.json: English name, default symbol and layout`);
    const { theme, art } = importDesign(id, assets, notes, found[id]);
    mkdirSync(`${THEMES}${id}`, { recursive: true });
    writeFileSync(file, `${JSON.stringify(theme, null, 1)}\n`);
    writeFileSync(`${THEMES}${id}/art.json`, `${JSON.stringify(art, null, 1)}\n`);
    written++;
  }
  notes.forEach(n => console.log(`  note   ${n}`));
  console.log(`${written} theme${written === 1 ? '' : 's'} written to themes/<id>/ (check: node themes/tools/pack.mjs)`);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) main(process.argv.slice(2));
