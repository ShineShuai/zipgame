// A game with a friend that is on, kept on this device, so that a reload or a break does not end
// it: the screen saves it as it goes (puzzle, every line, hints, the start) and offers it again.
// Kept: the puzzle text with its solution, the lines of both players, and the secret the two
// devices share, which only they can use to find each other again (resume.js). It goes when the
// game is solved or left on purpose, and after KEEP_MS in any case.
export const GAME_KEY = 'zip_coop_game';
export const KEEP_MS = 24 * 60 * 60 * 1000;
const TEXT_MAX = 100000;
const OPS_MAX = 5000;
const SECRET = /^[A-Za-z0-9_-]{22}$/;

export const makeRecord = ({
  role, seed, text, ops, hints, startedWall, secret,
}, saved = Date.now()) => ({
  v: 1, saved, role, seed, text, ops, hints, startedWall, secret,
});

const whole = value => Number.isInteger(value) && value >= 0;
const soundOp = op => Boolean(op) && (op.kind === 'add' || op.kind === 'remove')
  && [op.a, op.b, op.clock, op.seq, op.pid, op.owner ?? 0].every(whole);

// The saved text -> the record, or null for anything that is not one, or is too old.
export function parseGame(raw, now = Date.now()) {
  try {
    const data = JSON.parse(raw);
    const sound = data && data.v === 1 && (data.role === 'host' || data.role === 'guest')
      && whole(data.seed) && typeof data.text === 'string' && data.text.length <= TEXT_MAX
      && Array.isArray(data.ops) && data.ops.length <= OPS_MAX && data.ops.every(soundOp)
      && whole(data.hints) && whole(data.startedWall) && SECRET.test(data.secret)
      && whole(data.saved) && now - data.saved < KEEP_MS;
    return sound ? data : null;
  } catch {
    return null;
  }
}

// `storage` is the app's storage port (platform/storage.js); every call is best effort.
export async function loadGame(storage, now = Date.now()) {
  try {
    const stored = await storage.get(GAME_KEY);
    return stored ? parseGame(stored.value, now) : null;
  } catch {
    return null;
  }
}

export async function saveGame(storage, record) {
  try {
    return await storage.set(GAME_KEY, JSON.stringify(record));
  } catch {
    return false;
  }
}

export async function clearGame(storage) {
  try {
    await storage.remove(GAME_KEY);
  } catch {
    // nothing kept, nothing to clear
  }
}
