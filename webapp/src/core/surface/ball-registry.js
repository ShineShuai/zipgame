// The ball catalog as the app holds it. The data (ball-catalog.js, generated) is big and only a
// ball needs it, so it is not imported here: balls.js loadBalls() imports it when a ball is wanted
// and registers it; code that has the data at hand (tools, tests) registers it itself.
const byId = new Map();
let list = [];

// Makes `entries` (ball-catalog.js BALL_CATALOG) the catalog; balls are looked up by id.
export function registerBalls(entries) {
  list = entries;
  byId.clear();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
}

export const ballsLoaded = () => list.length > 0;

// All entries, in catalog order (empty until registered).
export const ballList = () => list;

// The catalog entry of a ball: { id, name, f, ok, why, v, r }, see ball-catalog.js.
export function ballEntry(id) {
  const entry = byId.get(id);
  if (!entry) {
    const why = ballsLoaded() ? 'unknown ball' : 'the ball catalog is not loaded';
    throw new Error(`${why} '${id}'`);
  }
  return entry;
}
