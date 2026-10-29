// Starting, playing and finishing a game: the clock, solved, the Game-of-the-Day submit, the streak, the log.
import { cancellable, isAbort, isTimeout } from '../../platform/run.js';
import { runGeneration } from './gen-runner.js';
import { ALGO_VERSION } from '../../core/model.js';
import { dailySeed } from '../../core/rng.js';
import { dayOfDate } from '../../features/share.js';
import { penalizedTime } from '../../features/hints.js';
import { newPaths } from '../../features/twopaths-play.js';
import { variantOf, nearestSize, sizesFor } from './variants.js';
import { BEHAVIOUR } from '../../config.js';
import { submitAttempt } from '../../platform/leaderboard.js';
import { rowFromGame, skillBucket } from '../../core/behaviour.js';
import { buildRecord, newTrace } from '../../features/playlog.js';
import { sfxSolved } from '../../platform/sound.js';
import { awardSlots } from '../../ui/theme.js';
import {
  $, S, SIZES, behaviour, daily, dayNo, lb, playlog, randomInt, randomSeed, render, replay, sec,
  solid, storage, store, streak, unlock,
} from './state.js';
import { refreshNext } from './counters.js';
import { gradePuzzle } from './puzzle-kit.js';
import { maybeShowRules } from './popups.js';
import { paintGenerating } from './generating.js';

export function logPlay(solved) {
  if (!playlog || !S.puzzle || S.variant || !S.trace || S.logged || S.screen !== 'game' || (!solved && S.trace.pushes < 2)) return;
  S.logged = true;
  const ms = S.timerId != null ? performance.now() - S.startTime : S.elapsed * 1000;
  const mode = S.isGotd ? (S.isReplay ? 'replay' : 'gotd') : 'local';
  const history = playlog.all(); // asked before add(): the skill bucket of the upload must not count this game
  playlog.add(buildRecord(S.puzzle, { ms, solved, hints: S.hintsUsed, mode }));
  if (solved) uploadBehaviour(history, ms, mode);
}
// The anonymous behaviour row of a solved game (core/behaviour.js decides whether it is sent at all; platform/behaviour.js sends it).
// Everything of S is read now, before the await: the game state moves on. A Game of Day this device already solved is a repeat: not sent.
function uploadBehaviour(history, ms, mode) {
  if (!behaviour) return;
  const attempt = S.isGotd ? store.attemptOn(S.gotdDate) : null;
  const game = { puzzle: S.puzzle, mode, ms, hints: S.hintsUsed, hiddenMs: S.trace.hiddenMs, undone: S.trace.undone, maxUndone: S.trace.maxUndone,
    day: S.isGotd ? dayOfDate(S.gotdDate) : S.gameDay ?? dayNo(), variant: S.variant, shared: S.isShared, known: Boolean(attempt && attempt.solved) };
  history.then(h => { const row = rowFromGame({ ...game, skill: skillBucket(h) }, BEHAVIOUR); return row && behaviour.enqueue(row); })
    .catch(e => console.warn('behaviour upload skipped:', e));
}

export function onSolved() {
  logPlay(true); // before the hint penalty below: the log keeps the raw time
  if (streak) streak.record().then(milestone => { if (milestone) onStreakMilestone(); awardThemeSlots(); }).catch(e => console.warn('streak record failed:', e)); // a streak reward earned: a replay or unlock chance; a best streak of 30 days: a theme slot
  S.finished = true; stopTimer(); sfxSolved();
  if (S.lucky) finishLucky();
  if (!S.penaltyApplied) { S.elapsed = penalizedTime(S.elapsed, S.hintsUsed); S.penaltyApplied = true; } // once, even if the path is reset and re-solved
  if (S.isGotd) { const a = store.attemptOn(S.gotdDate); if (!(a && a.solved)) finishGotd(S.puzzle.n, S.gotdDate, S.elapsed, S.isReplay); } // a Game of Day (live or replay) counts once
  else { // stats and daily counter of the puzzle type (a variant has its own)
    const n = S.puzzle.n, scope = S.variant || ''; store.recordSolve(n, dayNo(), S.elapsed, scope);
    if (!S.isShared) daily.markSolved(n, S.gameIndex, scope).then(refreshNext); }
}

// Game of Day (live or replay): record locally, count it towards the next replay chance, then submit to the averages backend
// (stats are stored in the attempt record, so no refetch is needed). A replay is submitted like the live game: it counts in that day's averages.
async function finishGotd(n, date, time, isReplay) {
  await store.recordGotd(n, date, time, lb.enabled, isReplay);
  awardThemeSlots(); // the 12th Game of Day solved: a theme slot
  if (isReplay) await healStreak(date);
  await replay.addSolved();
  if (lb.enabled) await shareGotd(date);
}
// A replayed Game of Day heals its day for the streak (features/streak.js): the day counts, a spent freeze comes back, a broken
// streak is joined again; any freeze + reward days reached that way are granted like a milestone. onSolved has recorded today's solve by now.
async function healStreak(date) {
  if (!streak) return;
  try {
    const healed = await streak.heal(dayOfDate(date));
    if (!healed) return;
    S.healed = true;
    for (let i = 0; i < healed.rewards; i++) await onStreakMilestone();
    awardThemeSlots(); // a healed day can lift the best streak
    if (S.screen === 'game') render();
  } catch (e) { console.warn('streak heal failed:', e); }
}
// Unlock chances (features/unlock.js) come from the streak: with every streak reward the player picks a replay chance or an unlock
// chance (none left to unlock: a replay, as before).
// The theme slots follow the player's activity (src/themes/slots.js): Game-of-Day solves in total and the best streak.
export function awardThemeSlots() { awardSlots({ gotdSolves: store.gotdSolves(), bestStreak: streak?.view()?.best ?? 0 }); }
export async function onStreakMilestone() {
  if (unlock && !unlock.view().allUnlocked) await unlock.addChoice(); else await replay.addBonus();
  if (S.screen === 'game' || S.screen === 'menu') render();
}
export async function claimReward(kind) {
  if (unlock && await unlock.takeChoice()) { if (kind === 'unlock') await unlock.addToken(); else await replay.addBonus(); }
  render();
}
// One submit round (platform/leaderboard.js submitAttempt): the attempt record says which backends already hold the solve.
export async function shareGotd(date) {
  const saved = await submitAttempt(lb, store, date);
  if (saved && (S.screen === 'menu' || (S.screen === 'game' && S.isGotd && S.finished))) render();
}

export function beginGame(puzzle, gotdDate, isReplay = false, isShared = false, lucky = false) {
  logPlay(false); // a puzzle left unfinished is logged as abandoned
  // the menu's shared card starts afresh
  S.sharedNotice = null;
  S.sharedFocus = null;
  const variant = variantOf(puzzle);
  const difficulty = gradePuzzle(puzzle);
  Object.assign(S, { variant, lucky, luckyResult: null, luckyNote: null, genNotice: null, healed: false, trace: newTrace(), legs: [], isShared, logged: false, puzzle, isGotd: !!gotdDate, isReplay, replayPick: null, gotdDate: gotdDate || null, path: [], finished: false, elapsed: 0, hintsUsed: 0, penaltyApplied: false, hintCell: null, hintWrongCell: null, screen: 'game', gotdHint: null, difficulty, cam: null, pan: false });
  // Two paths: the red and the blue path, and the colour drawn now (S.path is that colour's path)
  S.paths = newPaths();
  S.colour = 0;
  if (puzzle.split) S.path = S.paths[0];
  startTimer(); render(); maybeShowRules(); markHowtoSeen();
}
const generateShown = (n, seed, mode, signal) => runGeneration({ task: 'flat', mode, n, seed }, {
  signal,
  onEvent: e => {
    S.gen = { frac: e.frac == null ? S.gen.frac : e.frac, walls: e.walls ?? e.arrows ?? e.labels, K: e.K };
    paintGenerating();
  },
});
// how: 'open' (Play local: current or next-if-solved) | 'skip' (New puzzle); a variant is always a new random one.
// lucky: the lucky game (startLucky): its chance is given back when the puzzle cannot be made.
export async function startLocal(how, mode = 'standard', lucky = false) {
  if (mode !== 'standard') S.size = nearestSize(S.size, sizesFor(mode, SIZES)); // e.g. after a shared 12x12 one
  S.screen = 'generating'; S.genMode = mode; S.gen = { frac: 0, walls: null, K: null }; S.genNotice = null; render();
  const job = S.genJob = cancellable();
  try {
    const scope = mode === 'standard' ? '' : mode, game = how === 'skip' ? await daily.skip(S.size, scope) : await daily.open(S.size, scope);
    const index = game.index, seed = scope ? randomSeed() : game.seed; // a variant is random: its counter only numbers the day's games
    const puzzle = await generateShown(S.size, seed, mode, job.signal);
    S.gameIndex = index; S.seed = seed;
    S.gameDay = mode !== 'standard' ? null : [dayNo(), dayNo() - 1].find(d => dailySeed(d, S.size, index, ALGO_VERSION) === seed) ?? null; // the day this seed was made on (the behaviour log wants it)
    beginGame(puzzle, null, false, false, lucky);
  } catch (e) { // cancelled by the player (silent), too slow, or failed: the menu comes back, the chance of a lucky game with it
    if (!isAbort(e)) { console.error('startLocal failed:', e); S.genNotice = isTimeout(e) ? 'err.generateSlow' : 'err.generate'; }
    if (lucky) await unlock.refund();
    S.screen = 'menu'; render();
  } finally {
    job.end();
    if (S.genJob === job) S.genJob = null;
  }
}
// Lucky game: open to everyone, once per offer. Draws a variant (a locked one has a size of 7-10, features/unlock.js) and plays
// it. With an unlock chance (spent now) solving it unlocks the variant; leaving the game (or reloading the page) loses the chance.
export async function startLucky() {
  if (!unlock) return;
  S.luckyNote = null;
  const pick = await unlock.begin(randomInt);
  if (!pick) return render();
  S.luckyHolder = pick.holder;
  if (solid.isKind(pick.id)) { // a solid kind: the solid game screen
    return solid.start({ kind: pick.id, size: pick.size, lucky: true });
  }
  S.size = pick.size;
  await startLocal('open', pick.id, true);
}
export async function finishLucky() {
  const r = await unlock.finish(true);
  if (!r) return; // a re-solve after a reset: the first solve counted
  S.luckyResult = r;
  if (r.newly) { // the new tile is picked in the menu
    if (solid.isKind(r.id)) {
      solid.pick(r.id);
    } else {
      S.mode = r.id;
    }
  }
  if (S.screen === 'game' || S.screen === 'solid') render();
}
// Back to the menu from a lucky game that was not solved: the chance is gone.
export function leaveLucky() {
  if (!S.lucky) return;
  S.lucky = false;
  const active = unlock && unlock.view().active;
  if (active) { unlock.finish(false); if (active.holder) S.luckyNote = 'lucky.lostNote'; }
}
// The rules line of the menu is open (on a phone) until the first game has been started on this device.
function markHowtoSeen() {
  if (S.howtoSeen) return;
  S.howtoSeen = true; S.howtoOpen = false;
  storage.set('howto-seen', '1');
}
export function startTimer() {
  stopTimer(); S.startTime = performance.now() - S.elapsed * 1000;
  S.timerId = setInterval(() => { S.elapsed = (performance.now() - S.startTime) / 1000; const el = $('hudTime'); if (el) el.textContent = sec(S.elapsed); }, 100);
}
export function stopTimer() { if (S.timerId) { clearInterval(S.timerId); S.timerId = null; } }
