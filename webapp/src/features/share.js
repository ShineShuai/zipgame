import { encodeShare, decodeShare, MAX_LEGS } from '../core/share-code.js';
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
// cell that is checkpoint k+1 closes leg k. Index 0 (the start) belongs to no leg.
// legs: sparse count array to add to; prevPath: the path before the move;
// keep: how many cells remain after it.
export function legsUndo(legs, p, prevPath, keep) {
  let hi = 0;
  for (let j = 0; j < prevPath.length; j++) {
    if (j >= keep && j > 0 && hi > 0) {
      legs[hi - 1] = (legs[hi - 1] || 0) + 1;
    }
    hi = Math.max(hi, p.cp[prevPath[j]]);
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

// gotdDate ('YYYYMMDD') given = a Game of Day, else a local game
// (day = UTC day of its seed, index 0-based).
export function makeShareRecord({ gotdDate, n, grade, timeS, pct, day, index, algo, legs, K }) {
  const common = {
    n,
    grade: grade == null ? null : grade,
    timeS: Math.round(timeS * 10) / 10,
    levels: legLevels(legs, K),
  };
  if (gotdDate) {
    return { kind: 'gotd', ...common, day: dayOfDate(gotdDate), pct: pct == null ? null : pct };
  }
  return { kind: 'local', ...common, day, index, algo };
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
    : tr('share.headLocal', rec.n, rec.index + 1);
  const grade = rec.grade == null ? '' : ` · ${tr('grade.' + rec.grade)} ${rec.grade}/5`;
  const result = [`⏱ ${rec.timeS.toFixed(1)}s`];
  if (rec.pct != null) {
    result.push(tr('share.beat', rec.pct));
  }
  return [head + grade, result.join(' · '), stripText(rec.levels), url].filter(Boolean).join('\n');
}

// What the receiver can do with a shared game.
//   ctx: { today: UTC day number, replayDates: replay window ('YYYYMMDD'),
//          attempt: stored record of that date | null, algo: ALGO_VERSION, sizes: playable sizes }
//   live    today's Game of Day, not played yet     -> the live game
//   replay  a missed day inside the replay window   -> a replay (spends no chance)
//   ok      local game of this app version          -> a local game
//   played | old | future | version | invalid       -> not playable
export function shareStatus(rec, ctx) {
  if (rec.kind === 'local') {
    if (!ctx.sizes.includes(rec.n)) {
      return { status: 'invalid' };
    }
    return { status: rec.algo === ctx.algo ? 'ok' : 'version' };
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
