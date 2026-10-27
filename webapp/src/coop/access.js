import { isSolidId, sizesFor } from './variants.js';

// Which types Patchwork offers, locked as the free play of the play app locks them (pure). `info` is
// what the menu answers to zip:coop-access (apps/play/menu.js coopAccess):
//   { access: { <type>: 'all' | 'part' | 'none' }, sizes: { <3D kind>: [n, ...] }, solid: boolean }
// 'none' = locked, 'part' = only the first sizes of a tetra (open to everyone from the first day).
// null = nothing is locked (no menu to ask: tests).
// As in free play, a locked type is shown only while the hidden things are revealed (V held) or once
// it was picked (`held`, until the screen closes); revealed, everything is playable.

export const levelOf = (info, id) => (info ? info.access[id] ?? 'none' : 'all');

export const isShown = (info, id, { revealed = false, held = new Set() } = {}) => (
  levelOf(info, id) !== 'none' || revealed || held.has(id)
);

// The 3D tab is there once a 3D kind is unlocked or released, or while revealed.
export const hasSolidTab = (info, { revealed = false, held = new Set() } = {}) => (
  !info || info.solid || revealed || [...held].some(isSolidId)
);

// The sizes on offer for a type: all of them, or the open ones of a 'part' type.
export function offeredSizes(info, id, revealed = false) {
  const all = sizesFor(id);
  if (revealed || levelOf(info, id) !== 'part') {
    return all;
  }
  const open = (info.sizes?.[id] ?? []).filter(n => all.includes(n));
  return open.length ? open : all;
}

// The type to start from in a tab: the one asked for if it is shown, else the first that is.
export function firstShown(ids, wanted, info, ctx) {
  return ids.includes(wanted) && isShown(info, wanted, ctx)
    ? wanted : ids.find(id => isShown(info, id, ctx)) ?? ids[0];
}
