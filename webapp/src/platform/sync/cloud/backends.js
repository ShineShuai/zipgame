// The backends of the cloud way, from SYNC.cloud of config.js: its `primary` and `second` ids and
// its own `backends` entries (their own urls and public keys; nothing is shared with the
// leaderboard's backends):
//   cloud = { primary: <id>, second: <id> }, entries = SYNC.cloud.backends
//   -> [primary, second], the ones that are configured (url and key) and that know how to keep
//      slices (Supabase and Turso)
import { supabaseCloud } from './supabase.js';
import { tursoCloud } from './turso.js';

const FACTORIES = { supabase: supabaseCloud, turso: tursoCloud };

export function cloudBackends(cloud, entries, options = {}) {
  const ids = [cloud && cloud.primary, cloud && cloud.second].filter(Boolean);
  const backends = [];
  for (const id of new Set(ids)) {
    const entry = entries && entries[id];
    const make = entry && FACTORIES[entry.type];
    if (make && entry.url && entry.key) {
      backends.push(make(entry, id, options));
    }
  }
  return backends;
}
