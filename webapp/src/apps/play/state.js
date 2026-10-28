// The play app's shared state: the one object S, the services boot() creates (late-bound: see bind) and small helpers.
import { PLAY_SIZES } from '../../core/gen/generate.js';
import { utcDateString, utcDayNumber } from '../../features/daily.js';
import { statsLine } from '../../core/hist.js';
import { SOLID_RELEASE } from '../../config.js';
import { releaseDays } from '../../features/solid-release.js';
import { t } from '../../ui/i18n.js';

export const SIZES = PLAY_SIZES;
export const S = { screen: 'menu', mode: 'standard', variant: null, genMode: 'standard', size: 7, puzzle: null, path: [], elapsed: 0, startTime: 0, timerId: null, finished: false,
  gen: { frac: 0, walls: null, K: null }, gameIndex: 0, seed: 0, nextIdx: {}, isGotd: false, isReplay: false, replayPick: null, gotdDate: null, gotdHint: null, hintsUsed: 0,
  penaltyApplied: false, hintCell: null, hintWrongCell: null, showDev: false, behaviourOn: false, difficulty: null,
  lucky: false, luckyHolder: false, luckyResult: null, luckyNote: null, genJob: null, genNotice: null, healed: false, giftTest: null,
  legs: [], paths: [[], []], colour: 0, gameDay: null, isShared: false, cam: null,
  sharedGames: [], sharedFocus: null, sharedAll: false, sharedArmed: null, sharedNotice: null, sharedMsg: null,
  menuTab: 'flat', howtoOpen: false, sharedOpen: false, statsOpen: null };

export let storage, store, daily, replay, streak, unlock, gift, rulesSeen, shared, modal, lb;
export const replayPuzzles = new Map(), replayNoFile = new Set(); // date -> puzzle (the file of a past day never changes, so each is fetched once per page load); dates without a file
export const $ = id => document.getElementById(id), today = () => utcDateString(new Date()), dayNo = () => utcDayNumber(new Date()), sec = x => x.toFixed(1) + 's';
const statsText = { everyone: (avg, n) => t('stats.everyone', avg, n), top: (k, avg) => t('stats.top', k, avg), beat: pct => t('stats.beat', pct) };
export const statsLineT = (s, detail) => statsLine(s, detail, statsText);

export const randomSeed = () => (globalThis.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296));
export const randomInt = n => Math.floor(randomSeed() / 4294967296 * n); // 0..n-1
// Which solid kinds are open to everyone, and from when (config.js SOLID_RELEASE); a bad
// config switches the release off.
export const solidRelease = (() => {
  try {
    return releaseDays(SOLID_RELEASE);
  } catch (e) {
    console.error('SOLID_RELEASE ignored:', e);
    return null;
  }
})();
// The reference day of the happiest-day gift (core/gift.js): the release day of the solid puzzles; null = no gift.
export const giftRef = solidRelease ? solidRelease.first : null;
// The dev note (hold V): storage kind, what the app keeps on this device (measured when V is pressed; ~2 bytes a char), refused writes, unlock state.
export let storageUsed = '';
export let lastPointer = 'mouse'; // pointerType of the last press: 'mouse', 'pen' or 'touch'
// Play log (features/playlog.js): one record per puzzle, on the solve or when the puzzle is left unsolved. Local only.
export let playlog = null, behaviour = null;

// What only main.js can make (the render router, the solid play) is late-bound: modules import these names and main.js
// sets them once at load, before anything is drawn.
export let render = null, solid = null;

// The services boot() creates, and the few values that change after load, are set here, never by the modules that read them
// (an imported binding cannot be assigned from outside its module).
const setters = {
  storage: v => { storage = v; }, store: v => { store = v; }, daily: v => { daily = v; }, replay: v => { replay = v; },
  streak: v => { streak = v; }, unlock: v => { unlock = v; }, gift: v => { gift = v; }, rulesSeen: v => { rulesSeen = v; },
  shared: v => { shared = v; }, modal: v => { modal = v; }, lb: v => { lb = v; }, playlog: v => { playlog = v; },
  behaviour: v => { behaviour = v; }, storageUsed: v => { storageUsed = v; }, lastPointer: v => { lastPointer = v; },
  render: v => { render = v; }, solid: v => { solid = v; },
};
export function bind(values) {
  for (const [name, value] of Object.entries(values)) setters[name](value);
}
