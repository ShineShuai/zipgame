// A theme's art as the game accepts it: themes/<id>/art.json run through the SVG whitelist and bounds. Whatever does not
// pass is dropped (an icon falls back to the classic one, a mark to the shared brand mark, a board value to today's).
import { cleanInner, cleanSvg } from './svg.js';

export const ICON_IDS = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon', 'solids',
  'lucky', 'tetra', 'cube', 'ball'];

// The flat board as apps/play/board.js draws it today, in CELL units (1 = one cell).
export const CLASSIC_BOARD = {
  grid: 'lines', tileRx: 0, tileInset: 0, tileEdgeW: 0.025, depth: 0, plateRx: 0, pathW: 0.28, cap: 'round', join: 'round',
  gradient: false, wallW: 0.1, wallCap: 'round', num: 'disc', numR: 0.32, numRingW: 0.05,
};
const ENUMS = { grid: ['lines', 'tiles'], cap: ['round', 'square', 'butt'], join: ['round', 'miter'], wallCap: ['round', 'square', 'butt'], num: ['disc', 'square'] };
// `solid`: which of the two 3D palettes (light, dark) the 3D puzzles use; a theme whose board is light on a dark page says 'light'.
const SOLID = ['light', 'dark'];
const UNITS = ['tileRx', 'tileInset', 'tileEdgeW', 'depth', 'plateRx', 'pathW', 'wallW', 'numR', 'numRingW'];

export function cleanBoard(raw) {
  const out = { ...CLASSIC_BOARD };
  for (const [key, values] of Object.entries(ENUMS)) if (values.includes(raw?.[key])) out[key] = raw[key];
  for (const key of UNITS) if (typeof raw?.[key] === 'number' && raw[key] >= 0 && raw[key] <= 0.5) out[key] = raw[key];
  if (typeof raw?.gradient === 'boolean') out.gradient = raw.gradient;
  if (SOLID.includes(raw?.solid)) out.solid = raw.solid;
  return out;
}

// { icons: {id: inner}, mark: svg | null, board } or null for something that is not an art object.
export function cleanArt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const icons = {};
  for (const id of ICON_IDS) {
    const inner = cleanInner(raw.icons?.[id]);
    if (inner) icons[id] = inner;
  }
  return { icons, mark: cleanSvg(raw.mark, 4000), board: cleanBoard(raw.board) };
}
