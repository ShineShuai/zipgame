import { encodeShare, decodeShare, MAX_LEGS } from '../core/share-code.js';
import { labelRanks } from '../core/model.js';
import { dateOfDay } from './daily.js';

// Sharing a finished game and playing a shared one.
//   result record -> link (core/share-code.js) -> receiver's menu card + "Shared game" button.
// The "color strip" is one square per leg (checkpoint k -> k+1): how many cells you drew and
// took back inside that leg. It shows where the puzzle fought back without giving the path away.

export const LEVEL_EMOJI = ['🟩', '🟨', '🟧', '🟥'];

// Cells taken back within one leg -> level: 0 clean, 1 = 1-2 cells, 2 = 3-6 cells, 3 = 7 or more.
export function levelOf(cells) {
  if (cells <= 0) {
    return 0;
  }
  if (cells <= 2) {
    return 1;
  }
  return cells <= 6 ? 2 : 3;
}

// The cell at path index j belongs to leg (highest checkpoint on the path before it) - 1; the
// cell that is checkpoint k+1 closes leg k. Index 0 (the start) belongs to no leg. Checkpoints are
// counted by rank (an Exact puzzle's numbers are steps, not 1..K).
// legs: sparse count array to add to; prevPath: the path before the move;
// keep: how many cells remain after it.
export function legsUndo(legs, p, prevPath, keep) {
  const rank = labelRanks(p);
  let hi = 0;
  for (let j = 0; j < prevPath.length; j++) {
    if (j >= keep && j > 0 && hi > 0) {
      legs[hi - 1] = (legs[hi - 1] || 0) + 1;
    }
    hi = Math.max(hi, rank[prevPath[j]]);
  }
}

// K checkpoints -> K-1 levels ([] when there are none or too many for the code).
export function legLevels(legs, K) {
  const count = K - 1;
  if (count < 1 || count > MAX_LEGS) {
    return [];
  }
  const levels = [];
  for (let i = 0; i < count; i++) {
    let cells = legs[i] || 0;
    if (i === count - 1) {
      for (let j = count; j < legs.length; j++) {
        cells += legs[j] || 0;
      }
    }
    levels.push(levelOf(cells));
  }
  return levels;
}

export const stripText = levels => levels.map(v => LEVEL_EMOJI[v]).join('');

export const dateLabel = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6);
export const dayOfDate = date => {
  return Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 86400000;
};

// The puzzle a local record carries: a copy (the game goes on mutating its own) of what the code
// holds, by variant.
function puzzleCopy(variant, puzzle) {
  const { n, cp, walls } = puzzle;
  const copy = { n, cp: cp.slice(), walls: walls.slice() };
  if (variant === 'cutout') {
    return { ...copy, shape: puzzle.shape || null, holes: puzzle.holes.slice() };
  }
  if (variant === 'arrows') {
    return { ...copy, arrows: puzzle.arrows.slice() };
  }
  if (variant === 'teleport') {
    return { ...copy, portals: puzzle.portals.map(pair => pair.slice()) };
  }
  return variant ? { ...copy, [variant]: true } : copy;
}

// gotdDate ('YYYYMMDD') given = a Game of Day, else a local game. A local game carries its puzzle
// ({ n, cp, walls } plus shape + holes | arrows | exact | wrap | loop | portals by variant;
// variant =
// 'cutout' | 'arrows' | 'exact' | 'wrap' | 'loop' | 'teleport', null for a standard game), so the
// receiver
// needs no generator. Only a standard game has a grade: the receiver grades a variant's puzzle
// again, and a record with a grade there cannot be encoded.
export function makeShareRecord({
  gotdDate, n, grade, timeS, pct, legs, K, variant = null, puzzle,
}) {
  const common = {
    n,
    grade: variant || grade == null ? null : grade,
    timeS: Math.round(timeS * 10) / 10,
    levels: legLevels(legs, K),
  };
  if (gotdDate) {
    return { kind: 'gotd', ...common, day: dayOfDate(gotdDate), pct: pct == null ? null : pct };
  }
  return { kind: 'local', ...common, variant, puzzle: puzzleCopy(variant, puzzle) };
}

// ---------- the player's collection of shared games (features/shared-games.js) ----------

// What identifies a shared game: its code without what a player adds to it (time, strip, grade,
// percent). The same Game of Day, or the same puzzle, gives the same key; null if not encodable.
export const shareKey = rec => encodeShare({
  ...rec, timeS: 0.1, levels: [], grade: null, pct: null,
});

// How hard the game fought back on the colour strip: [sum of the levels, sum of their squares].
// The squares break a tie in favour of a spike (one red leg is worse than three yellow ones).
export const stripBadness = levels => [
  levels.reduce((sum, v) => sum + v, 0),
  levels.reduce((sum, v) => sum + v * v, 0),
];

// Is strip a strictly worse than strip b?
export function isWorseStrip(a, b) {
  const [sumA, squaresA] = stripBadness(a);
  const [sumB, squaresB] = stripBadness(b);
  return sumA !== sumB ? sumA > sumB : squaresA > squaresB;
}

// Adds a received game to the entries [{ key, rec, added }]. The same game twice keeps the record
// with the worse strip (a tie keeps the stored one), in the stored one's place.
// -> { entries, key, outcome: 'added' | 'replaced' | 'kept' | 'invalid' }
export function mergeShared(entries, rec, now) {
  const key = encodeShare(rec) && shareKey(rec); // the record has to be encodable, not only its key
  if (!key) {
    return { entries, key: null, outcome: 'invalid' };
  }
  const at = entries.findIndex(e => e.key === key);
  if (at < 0) {
    return { entries: [...entries, { key, rec, added: now }], key, outcome: 'added' };
  }
  if (!isWorseStrip(rec.levels, entries[at].rec.levels)) {
    return { entries, key, outcome: 'kept' };
  }
  const next = entries.slice();
  next[at] = { ...entries[at], rec };
  return { entries: next, key, outcome: 'replaced' };
}

export function shareUrl(base, rec) {
  const code = encodeShare(rec);
  return code ? `${base}?s=${code}` : null;
}

// search: location.search -> { rec, bad }: rec = the shared result;
// bad = there is an `s` parameter but it is not a valid code.
export function parseShareLink(search) {
  const code = new URLSearchParams(search).get('s');
  if (code == null) {
    return { rec: null, bad: false };
  }
  const rec = decodeShare(code);
  return { rec, bad: !rec };
}

// Text that goes with the link (chat apps show it; the link carries the data). tr = the app's t().
export function shareText(rec, url, tr) {
  const head = rec.kind === 'gotd'
    ? tr('share.headGotd', dateLabel(dateOfDay(rec.day)), rec.n)
    : rec.variant ? tr('share.head' + rec.variant[0].toUpperCase() + rec.variant.slice(1), rec.n)
      : tr('share.headLocal', rec.n);
  const grade = rec.grade == null ? '' : ` · ${tr('grade.' + rec.grade)} ${rec.grade}/5`;
  const result = [`⏱ ${rec.timeS.toFixed(1)}s`];
  if (rec.pct != null) {
    result.push(tr('share.beat', rec.pct));
  }
  return [head + grade, result.join(' · '), stripText(rec.levels), url].filter(Boolean).join('\n');
}

// What the receiver can do with a shared game.
//   ctx: { today: UTC day number, replayDates: replay window ('YYYYMMDD'),
//          attempt: stored record of that date | null, sizes: playable sizes,
//          sizesOf (optional): variant id -> the sizes that variant offers }
//   live    today's Game of Day, not played yet     -> the live game
//   replay  a missed day inside the replay window   -> a replay (spends no chance)
//   ok      local game (its puzzle is in the link)  -> a local game
//   future  a Game of Day that is not out yet       -> not playable yet
//   played | old | invalid                          -> not playable
export function shareStatus(rec, ctx) {
  if (rec.kind === 'local') {
    const own = rec.variant && ctx.sizesOf ? ctx.sizesOf(rec.variant) : [];
    return { status: ctx.sizes.includes(rec.n) || own.includes(rec.n) ? 'ok' : 'invalid' };
  }
  if (rec.day > ctx.today) {
    return { status: 'future' };
  }
  if (ctx.attempt) {
    return { status: 'played', attempt: ctx.attempt };
  }
  if (rec.day === ctx.today) {
    return { status: 'live' };
  }
  return { status: ctx.replayDates.includes(dateOfDay(rec.day)) ? 'replay' : 'old' };
}

const PLAYABLE = ['live', 'replay', 'ok'];
export const isPlayable = st => PLAYABLE.includes(st.status);

// A saved Game of Day that is played or out of the replay window will never be playable from the
// shared list again (it follows the replay scheme instead), so it leaves the list.
export const isSpent = (rec, st) => rec.kind === 'gotd'
  && (st.status === 'played' || st.status === 'old');
