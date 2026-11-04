// Calibration games. A tester opens the play app with ?calib; "Play local" then serves the puzzles
// of a fixed set (demo/Calibration, built by tools/calib-set.mjs: every Play badge 0-5, in
// balanced blocks) instead of generating them, and the badge is hidden while playing. Such a game
// is an ordinary local game for the behaviour upload: the packed puzzle in the row says which one.
// Per size n the device keeps { pos, solved } (key zip_calib_<n>): pos = place in the size's play
// order (file = list[pos % list.length]), started at a random block so that testers cover
// different blocks; open(n) = the current puzzle, or the next one when it was solved; skip(n) =
// the next one. Without ?calib nothing here runs.
import { parse } from '../core/format.js';
import { validate } from '../core/model.js';

export const CALIB_DIR = '../demo/Calibration/';
export const calibRequested = search => new URLSearchParams(search).has('calib');
const keyOf = n => 'zip_calib_' + n;

export function createCalib(storage, { fetchFn = (...a) => fetch(...a), rnd = Math.random } = {}) {
  let index = null;
  async function load() {
    if (index) return index;
    const res = await fetchFn(CALIB_DIR + 'index.json');
    if (!res.ok) throw new Error('calibration index: HTTP ' + res.status);
    const v = await res.json();
    const lists = v && v.v === 1 && v.sizes && Object.values(v.sizes);
    const ok = lists && lists.every(l => Array.isArray(l) && l.length);
    if (!ok) throw new Error('calibration index: bad format');
    return (index = v);
  }
  async function read(n, list) {
    try {
      const r = await storage.get(keyOf(n)), v = r && JSON.parse(r.value);
      if (v && Number.isInteger(v.pos) && v.pos >= 0) return { pos: v.pos, solved: !!v.solved };
    } catch { /* fall through: a new start */ }
    const block = Math.max(1, (index.block && index.block[n]) | 0);
    return { pos: Math.floor(rnd() * Math.floor(list.length / block)) * block, solved: false };
  }
  const write = async (n, rec) => {
    try { await storage.set(keyOf(n), JSON.stringify(rec)); } catch { /* ignore */ }
  };
  async function puzzleAt(n, list, pos) {
    const file = list[pos % list.length], res = await fetchFn(CALIB_DIR + file);
    if (!res.ok) throw new Error(`calibration puzzle ${file}: HTTP ${res.status}`);
    const p = parse(await res.text());
    if (p.n !== n || !validate(p).ok) throw new Error(`calibration puzzle ${file}: invalid`);
    p.calib = file;
    return { puzzle: p, pos };
  }
  return {
    // the sizes the set has, ascending
    async sizes() { return Object.keys((await load()).sizes).map(Number).sort((a, b) => a - b); },
    async open(n) {
      const list = (await load()).sizes[n], r = await read(n, list);
      const pos = r.solved ? r.pos + 1 : r.pos;
      await write(n, { pos, solved: false });
      return puzzleAt(n, list, pos);
    },
    async skip(n) {
      const list = (await load()).sizes[n], r = await read(n, list), pos = r.pos + 1;
      await write(n, { pos, solved: false });
      return puzzleAt(n, list, pos);
    },
    async markSolved(n, pos) {
      const list = (await load()).sizes[n], r = await read(n, list);
      if (r.pos === pos) await write(n, { pos, solved: true });
    },
  };
}
