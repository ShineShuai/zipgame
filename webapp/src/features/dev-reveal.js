import { encodeShare } from '../core/share-code.js';

// The touch side of the hidden dev reveal (hold V on a keyboard). Nothing here is shown to players.
//   - tapCombo: 5 quick taps on the bare app bar toggle the reveal for a while (a hold is not
//     possible with one thumb).
//   - the pin: a device kept revealed across reloads, set and cleared by a dev link. A dev link is a
//     share link (`?s=<code>`) whose code is a Game of Day of day 0 (1970-01-01): no game makes
//     one, so a player cannot hit it by chance, and it looks like any other shared game.
// The key name says nothing; the value is '1' while the device is pinned.
export const DEV_KEY = 'zip_ui';
export const DEV_TAP_MS = 15000; // a reveal made by taps falls back after this long

const devRec = levels => ({
  kind: 'gotd', n: 2, grade: null, timeS: 1234.5, day: 0, pct: null, levels,
});
const ON = encodeShare(devRec([0, 1, 0, 0, 2, 0, 1]));
const OFF = encodeShare(devRec([0, 2, 0, 1, 0, 0, 1]));

export const devLinkCode = on => (on ? ON : OFF);
export const devLinkUrl = (base, on) => `${base}?s=${devLinkCode(on)}`;

// A decoded share record (or null) -> 'on' | 'off' | null (an ordinary share).
export function devLinkMode(rec) {
  const code = rec ? encodeShare(rec) : null;
  return code === ON ? 'on' : code === OFF ? 'off' : null;
}

// -> tap(timeStamp): true on the `count`-th tap in a row, each within gapMs of the one before.
export function tapCombo(count = 5, gapMs = 500) {
  let taps = 0;
  let last = -Infinity;
  return now => {
    taps = now - last <= gapMs ? taps + 1 : 1;
    last = now;
    if (taps < count) {
      return false;
    }
    taps = 0;
    return true;
  };
}

export async function loadPin(storage) {
  try {
    const r = await storage.get(DEV_KEY);
    return Boolean(r) && r.value === '1';
  } catch {
    return false;
  }
}

export async function savePin(storage, on) {
  try {
    await (on ? storage.set(DEV_KEY, '1') : storage.remove(DEV_KEY));
  } catch { /* best effort, like every write */ }
}
