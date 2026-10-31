// Which puzzle types the player has been shown the rules of. The rules tooltip in the game screen
// (apps/play/popups.js maybeShowRules) opens by itself the first time a variant is played, so a player who meets
// a variant for the first time (say in the lucky game) is not left guessing; after that it opens on
// hover, focus or tap only. Kept per device, under RULES_SEEN_KEY: { v, seen: { id: true } }.
export const RULES_SEEN_KEY = 'zip_rules_seen', VERSION = 1;

export const fresh = () => ({ v: VERSION, seen: {} });

// A stored record, cleaned (unknown ids are dropped); null when it is not one.
export function sanitize(c, ids) {
  if (!c || typeof c !== 'object' || c.v !== VERSION || !c.seen || typeof c.seen !== 'object') return null;
  const seen = {};
  for (const id of ids) if (c.seen[id] === true) seen[id] = true;
  return { v: VERSION, seen };
}

// storage: { get(key) -> { value } | null, set(key, value) } (platform/storage.js); ids: the puzzle
// types that have rules to show. sync (platform/sync/engine.js, optional): the rules seen on
// the player's other devices count as seen here.
export function createRulesSeen(storage, ids, sync = null) {
  let state = fresh();
  const save = async () => { try { await storage.set(RULES_SEEN_KEY, JSON.stringify(state)); } catch { /* ignore */ } };
  return {
    // Loads the record (a new player has seen nothing).
    async init() {
      try {
        const stored = await storage.get(RULES_SEEN_KEY);
        const clean = stored && sanitize(JSON.parse(stored.value), ids);
        state = clean || fresh();
      } catch { state = fresh(); }
    },
    seen: id => (sync ? sync.view(RULES_SEEN_KEY, state) : state).seen[id] === true,
    async mark(id) {
      if (!ids.includes(id) || state.seen[id]) return;
      state.seen[id] = true;
      await save();
    },
  };
}
