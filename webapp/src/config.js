// Game-of-Day averages backends. A backend with an empty url (or key) is disabled; with none enabled the feature is off.
// `order` is the failover order; the first entry is tried first. Override for one page load with ?lb=<name>.
// The Supabase key is the public anon/publishable key (safe in the client: RLS blocks all direct table access).
export const LEADERBOARD = {
  order: ['cloudflare', 'supabase'],
  cloudflare: { url: 'https://zip-gotd.shineshine.workers.dev' },           // e.g. 'https://zip-gotd.<account>.workers.dev' (see server/README.md)
  supabase: { url: 'https://uxtmfpgxjdabpfzmmqzm.supabase.co', key: 'sb_publishable_fTLmg4p-Z73VYXYblWf0hQ_g8C79jg8' },    // e.g. 'https://<ref>.supabase.co'
};
