// The backends of the cloud way, from SYNC.cloud of config.js and the entries of
// LEADERBOARD.backends it names (the same urls and public keys; the cloud needs nothing else):
//   { primary: <id>, second: <id> }  -> [primary, second], the ones that are configured and
//                                       that know how to keep slices (Supabase and Turso)
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
