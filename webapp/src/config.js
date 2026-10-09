// Game-of-Day averages backends. `backends` maps a free id to { type, url, key? }; type is 'cloudflare' (Worker + D1), 'supabase' or 'turso' (the database's
// HTTP API, called straight from the browser), and the same type may appear several times (another project, another region). An entry with an empty url
// (Supabase, Turso: or key) is disabled; with none enabled the feature is off.
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
// The Turso key is the public browser token, safe in the client because it can only read and INSERT into `submit` (server/turso/schema.sql validates every row):
//   turso db tokens create <db> -e never -p all:data_read -p submit:data_add     (url: turso db show <db> --http-url; check it with server/turso/smoke.sh)
// Never put a token without that permission list here: it would let anyone change or drop the data. Switching `always` to a Turso backend: server/README.md.
export const LEADERBOARD = {
  backends: {
    'supabase-asia': { type: 'supabase', url: 'https://tjaidjrjcugkxkluxvrc.supabase.co', key: 'sb_publishable_x3Mq5hbPn9o5Xsg5FDZNSQ_4OWqZ-1N' },
    'turso-asia': { type: 'turso', url: 'https://zipgame-becu.aws-ap-northeast-1.turso.io', key: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTE1Nzk5MjUsImlkIjoiMDFhMTA2MmQtYjcwMS03N2JkLWE0MGQtYTA5ODJhNDU4MDNkIiwia2lkIjoiMW1zR05ZbjRmV09xVWoxd1MzRTVkMkpfS0l4azUzdm80SVVjMmJaT21WUSIsInBlcm0iOlt7InQiOm51bGwsImEiOlsiZGF0YV9yZWFkIl19LHsidCI6WyJzdWJtaXQiXSwiYSI6WyJkYXRhX2FkZCJdfSx7InQiOlsicGxheSJdLCJhIjpbImRhdGFfYWRkIl19XSwicmlkIjoiZjA5MWE4ZTUtNDNiZC00OWM1LTljOGQtZmQyNmJjOGEyNDE3In0.tTfjWXKMxJ7J8Kb2yW08dAyevQN5rsNCEeSju8-dRgUgiqJHIBoD6Meh_33d-pAs6A-2jZfHjVxwFmCZv9FHAg' },   // disabled until the key (the insert-only token) is set; see above
    cloudflare: { type: 'cloudflare', url: 'https://zip-gotd.shineshine.workers.dev' },   // e.g. 'https://zip-gotd.<account>.workers.dev' (see server/README.md)
    supabase: { type: 'supabase', url: 'https://uxtmfpgxjdabpfzmmqzm.supabase.co', key: 'sb_publishable_fTLmg4p-Z73VYXYblWf0hQ_g8C79jg8' },    // e.g. 'https://<ref>.supabase.co'
  },
  always: 'turso-asia',
  order: ['supabase-asia', 'cloudflare', 'supabase'],
  replicatedFrom: 20261003,
};

// Anonymous play behaviour (src/core/behaviour.js, server/README.md "Behaviour rows"): for each solved game the page uploads the puzzle, the time and how
// many cells the player took back. No identifier. Only Turso and Cloudflare receive it (never Supabase): each row goes to `primary`, to `backup` only when
// the primary does not answer. Both are ids of LEADERBOARD.backends. The Turso token must also allow `play:data_add` (server/README.md).
//   enabled        THE GLOBAL SWITCH. false = nothing is queued or sent, the hold-V toggle is hidden, a queue left on a device is discarded.
//   defaultOn      a device's setting until its player changes it (hold V in the menu: "Anonymous play stats"). false = off until switched on.
//   localSizes     [min, max]: local games are logged at these sizes only. The Game of Day is logged at every size.
//   hiddenMaxMs    a game with more than this much time in a hidden tab is not uploaded (the timer keeps running there).
export const BEHAVIOUR = {
  enabled: true,
  defaultOn: true,
  localSizes: [7, 11],
  hiddenMaxMs: 5000,
  primary: 'turso-asia',
  backup: 'cloudflare',
};
