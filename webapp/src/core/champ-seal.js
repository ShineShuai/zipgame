// The champion ledger: who beat 100% of the other players on the live Game of the Day, and how
// many reward picks that has earned. Pure and synchronous: no storage, no clock, no DOM.
//
// A win is a live Game of Day whose stored answer says "you beat 100%" (stats.pct, hist.js), with
// at least `minPlayers` players on the day and, on boards of FLOOR_FROM and up, a time that
// reaches the drawing floor (floor.js). Every PER_PICK wins earn one reward pick (a replay or an
// unlock chance, apps/play/game-flow.js grantChoice).
//
// One copy per device (merged by core/sync/merge.js):
//   { v, id, j, e, c, g, hi, z }
//   id  the ledger's own random id (the chains below are bound to it)
//   j   the UTC days already judged (the latest J_KEPT): a day is judged once, at its first answer
//   e   the wins not yet folded into the checkpoint, [day, ms, seal] each; the seal chains the
//       win to the one before it, so none can be inserted, changed or cut out of the middle
//   c   the checkpoint [count, tip, seal]: how many older wins were folded, the seal of the last
//   g   the reward picks this device has handed out
//   hi  the highest UTC day this device has seen (a clock set back is not live); it rises by at
//       most HI_STEP a launch, so a clock set far ahead by mistake does not shut the player out
//   z   the seal over c, g, hi, j
// A copy that fails its seals is dropped whole (the device starts again): a wrong seal never
// earns anything. The seals are a hash with a salt that is in this file: they keep a player who
// edits storage by hand out, not one who reads the code and rebuilds them.
import { floorMs } from './floor.js';
import { isDev, newDevId } from './sync/slice.js';

export const LEDGER_VERSION = 1;
export const PER_PICK = 5,
  FLOOR_FROM = 7,
  J_KEPT = 32,
  E_KEPT = 40,
  HI_STEP = 2;
const SALT = 'zz.champ.7f3a';

// cyrb53: a small 53-bit hash of a string, written in base 36.
function hash53(text) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const seal = (...parts) => hash53([SALT, ...parts].join('|'));
const entrySeal = (id, prev, day, ms) => seal('e', id, prev, day, ms);
const cpSeal = (id, count, tip) => seal('c', id, count, tip);
const wholeSeal = v => seal('z', v.id, v.c[0], v.c[1], v.g, v.hi, v.j.join(','));

const isObject = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const natural = x => Number.isInteger(x) && x >= 0;
const checkpoint = (id, count, tip) => [count, tip, cpSeal(id, count, tip)];
const sealed = v => ({ ...v, z: wholeSeal(v) });

// A new copy for a device that has none (or whose copy failed its seals).
export const fresh = (today, id = newDevId()) =>
  sealed({
    v: LEDGER_VERSION,
    id,
    j: [],
    e: [],
    c: checkpoint(id, 0, seal('genesis', id)),
    g: 0,
    hi: today,
  });

// A copy as it came from storage or from another device -> the same copy, or null when it is
// not one of this ledger (wrong shape, or any seal wrong).
export function clean(value) {
  if (!isObject(value) || value.v !== LEDGER_VERSION || !isDev(value.id)) return null;
  const { id, j, e, c, g, hi, z } = value;
  if (![j, e, c].every(Array.isArray) || !j.every(natural)) return null;
  if (!natural(g) || !natural(hi) || c.length !== 3 || !natural(c[0])) return null;
  if (typeof c[1] !== 'string' || c[2] !== cpSeal(id, c[0], c[1])) return null;
  let prev = c[1];
  for (const win of e) {
    const shaped = Array.isArray(win) && win.length === 3 && natural(win[0]) && natural(win[1]);
    if (!shaped || win[2] !== entrySeal(id, prev, win[0], win[1])) return null;
    prev = win[2];
  }
  if (z !== wholeSeal(value)) return null;
  return { v: LEDGER_VERSION, id, j: [...j], e: e.map(win => [...win]), c: [...c], g, hi, z };
}

// The group's ledger from the copies of its devices (sorted by device id, so every device folds
// them the same way). Not a chain: the wins of every device, one per day (the first device's
// stands), the folded counts added, the picks handed out added.
export function view(entries) {
  const seen = new Set(),
    e = [];
  let count = 0,
    g = 0;
  for (const { value } of entries) {
    count += value.c[0];
    g += value.g;
    for (const win of value.e) {
      if (!seen.has(win[0])) {
        seen.add(win[0]);
        e.push(win);
      }
    }
  }
  e.sort((a, b) => a[0] - b[0]);
  return { v: LEDGER_VERSION, id: null, j: [], e, c: [count, '', ''], g, hi: 0 };
}

// Works on a copy and on the group's view alike.
export const winsOf = v => v.c[0] + v.e.length;
export const daysOf = v => new Set(v.e.map(win => win[0]));
export const owedOf = v => Math.max(0, Math.floor(winsOf(v) / PER_PICK) - v.g);
export const progressOf = v => ({ wins: winsOf(v), done: winsOf(v) % PER_PICK, total: PER_PICK });

// The clock check: a Game of Day is live when it is not a replay, its date is the UTC day now, and
// the clock has not been set back below the highest day seen.
export const isLive = (v, day, today, replay) => !replay && day === today && today >= v.hi;
export const rise = (v, today) =>
  sealed({ ...v, hi: Math.max(v.hi, Math.min(today, v.hi + HI_STEP)) });

// Is the answer stored with a played Game of Day a win? rec = { time (s), live, n (the board
// size), stats: { n (players), pct } }, minPlayers = config.js CHAMP.minPlayers.
export function qualifies(rec, minPlayers) {
  const stats = rec && rec.stats;
  if (!rec || rec.live !== true || !stats || stats.pct !== 100) return false;
  if (!(stats.n >= minPlayers) || !Number.isInteger(rec.n)) return false;
  return rec.n < FLOOR_FROM || rec.time * 1000 >= floorMs(rec.n);
}

export const judged = (v, day) => sealed({ ...v, j: [...v.j, day].slice(-J_KEPT) });

// Adds a win; the oldest wins beyond E_KEPT are folded into the checkpoint.
export function win(v, day, ms) {
  const prev = v.e.length ? v.e[v.e.length - 1][2] : v.c[1];
  let e = [...v.e, [day, ms, entrySeal(v.id, prev, day, ms)]],
    c = v.c;
  if (e.length > E_KEPT) {
    const cut = e.length - E_KEPT;
    c = checkpoint(v.id, v.c[0] + cut, e[cut - 1][2]);
    e = e.slice(cut);
  }
  return sealed({ ...v, e, c });
}

export const handedOut = (v, count) => sealed({ ...v, g: v.g + count });
