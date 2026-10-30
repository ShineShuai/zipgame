# Device sync: one player, several devices

A player can keep their data (statistics, Game-of-Day records, streak, unlock and replay
chances, gift, rules shown) the same on all their devices, **without an account or login**.
It is **off for everybody until the player turns it on** on their device
(`SYNC.available` in `src/config.js` only lets them; `false` removes the feature).

## What is here (patch 1 of 4)

| Layer | Files | State |
|---|---|---|
| Merge rules, slice codec, sync phrase | `src/core/sync/` | done, tested |
| Identity, group view, exchange protocol | `src/platform/sync/engine.js`, `proto.js` | done, tested |
| Features read the group's data | `stats-store`, `streak`, `unlock`, `replay`, `gift`, `rules-seen` (optional `sync` argument) | done, tested |
| Device-to-device link (option D) | wraps `coop/join.js`, `resume.js`, `rtc.js` | next patch |
| Cloud (option C: phrase, Turso primary, Supabase backup) | `cloud/`, `server/` | next patch |
| Menu: "Sync my devices" (the player's choice) | `src/apps/play/` | next patch |

Until the menu exists nothing can turn sync on, so this patch changes no behaviour (the 750
existing tests pass; one expectation changed: a negative chance count is a valid record now).

## How it works

* Each device keeps **only its own part** in the usual `zip_*` keys. It offers a *slice*
  (a copy of the synced keys, numbered by `seq`) to the others; it keeps their slices apart
  (`zip_sync_f`).
* A feature reads `sync.view(key, ownCopy)`: the own copy and the other slices, merged by the rule
  of that key (`core/sync/merge.js`). Statistics add up (Chan's parallel update of Welford's
  mean/variance), chances are sums of "earned minus spent" per device, unlocks are a union,
  the streak is the state that got furthest. Every rule is a function of the *set* of slices, so
  order and repeats change nothing, and a game is never counted twice.
* `zip_sync` (identity: device id, `seq`, which ways are on, the cloud secret) and `zip_sync_f`
  are never synced. Not synced either: play log, behaviour upload, theme choice and trial, shared
  games, hints, co-op game and statistics.
* Two devices talk with `proto.exchange()` over any channel (`send`, `onmessage`, `onclose`):
  hello (which slices I have), the slices the other lacks (also third devices': gossip), done.
* The sync phrase (`core/sync/words.js`) is the 80-bit group secret as eight words (a 16-bit
  checksum catches every single wrong word). It is for the cloud way.

## Known limits (by design)

* Two devices that spend the same chance before they meet cost the next chance earned.
* A removed shared game or theme is not removed on the other devices (those are not synced yet).
* The number of dates solved (`n`) is the largest known, so after the records are pruned (120
  days) two devices that solved different old dates can show a few fewer than the truth.
