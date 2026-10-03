// Game-of-Day averages backends. `backends` maps a free id to { type, url, key? }; type is 'cloudflare' (Worker + D1) or 'supabase', and the same
// type may appear several times (another project, another region). An entry with an empty url (Supabase: or key) is disabled; with none enabled the feature is off.
// Every solve is written to `always` (if set and enabled) and, in parallel, to the first backend of `order` that answers (a backup is only tried
// when the ones before it fail). The summary the player sees comes from `always`, else from the backup that answered. Override for one page load
// with ?lb=<id>: that backup moves to the front of `order`.
// replicatedFrom: the first UTC day (YYYYMMDD) on which every solve is stored twice. Other days were written to one backend only, so the
// backends hold different players and the stats page adds them up; on a replicated day they hold copies and the fullest copy is used.
// Set it to the first UTC day after this config went live. It stays valid when `always` changes later (another database, same two writes).
// replicatedTo (optional, add it below replicatedFrom): the last replicated day. Add it when the two writes stop (always: null, or no backup left),
// so that the days after it are added up again. Without it, replication is assumed to run on. With no replicatedFrom nothing counts as replicated.
// With `always: null` from the start, leave both out.
// The Supabase key is the public anon/publishable key (safe in the client: RLS blocks all direct table access).
export const LEADERBOARD = {
  backends: {
    'supabase-asia': { type: 'supabase', url: 'https://tjaidjrjcugkxkluxvrc.supabase.co', key: 'sb_publishable_x3Mq5hbPn9o5Xsg5FDZNSQ_4OWqZ-1N' },
    cloudflare: { type: 'cloudflare', url: 'https://zip-gotd.shineshine.workers.dev' },   // e.g. 'https://zip-gotd.<account>.workers.dev' (see server/README.md)
    supabase: { type: 'supabase', url: 'https://uxtmfpgxjdabpfzmmqzm.supabase.co', key: 'sb_publishable_fTLmg4p-Z73VYXYblWf0hQ_g8C79jg8' },    // e.g. 'https://<ref>.supabase.co'
  },
  always: 'supabase-asia',
  order: ['cloudflare', 'supabase'],
  replicatedFrom: 20261003,
};
