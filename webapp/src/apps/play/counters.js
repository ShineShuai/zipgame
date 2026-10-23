// Free play's game counters of the day per size and variant: the number of the next game, and the refresh of a stale attempt.
import { scopeKey } from '../../features/daily.js';
import { PLAY_VARIANTS, sizesFor } from './variants.js';
import { t } from '../../ui/i18n.js';
import { S, SIZES, daily, render, store, today } from './state.js';

export function refreshAttemptIfStale() {
  if (store.attemptDate() === today()) return;
  store.hydrateAttempt(today()).then(() => {
    if (S.screen === 'menu') render();
  });
}

// "next game #" per size, from the per-size daily counters
// Keys of S.nextIdx: scopeKey(n, scope), scope '' = standard, else the variant id (each variant counts its own games).
const scopes = () => ['', ...PLAY_VARIANTS.map(v => v.id)];
export const scopeSizes = scope => (scope ? sizesFor(scope, SIZES) : SIZES);
export async function peekNext() {
  const next = {};
  for (const scope of scopes()) for (const n of scopeSizes(scope)) next[scopeKey(n, scope)] = (await daily.peek(n, scope)).index;
  return next;
}
export async function refreshNext() {
  const next = await peekNext();
  if (JSON.stringify(next) === JSON.stringify(S.nextIdx)) return;
  S.nextIdx = next;
  if (S.screen === 'menu') render();
}

export const gameNo = (n, scope = '') => { const i = S.nextIdx[scopeKey(n, scope)]; return i == null ? '-' : '#' + (i + 1); };

// Puzzle types: 'standard' and the variants of ./variants.js (Cutout, core/gen/cutout.js; One way arrows,
// core/gen/arrows.js). A variant is random, with no daily sequence (its counter only counts the day's games); it has its own grade
// (core/trap.js modelFor) and stats, per variant and size; a shared one carries its puzzle in the link. A variant is hidden until the player has unlocked it (features/unlock.js: the lucky game);
// hold V shows them all. The menu offers the shown ones as icon tiles (variantPickerHtml); the Game of Day is always
// a standard puzzle.
export const todayText = () => t('menu.today', gameNo(S.size, S.mode === 'standard' ? '' : S.mode));
