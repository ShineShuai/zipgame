# Device sync: one player, several devices

A player can keep their data (statistics, Game-of-Day records, streak, unlock and replay
chances, gift, rules shown) the same on all their devices, **without an account or login**.
It is **off for everybody until the player turns it on** on their device
(`SYNC.available` in `src/config.js` only lets them; `false` removes the feature).

## What is here (patches 1 and 2 of 4)

| Layer | Files | State |
|---|---|---|
| Merge rules, slice codec, sync phrase | `src/core/sync/` | done, tested |
| Identity, group view, exchange protocol | `src/platform/sync/engine.js`, `proto.js` | done, tested |
| Features read the group's data | `stats-store`, `streak`, `unlock`, `replay`, `gift`, `rules-seen` (optional `sync` argument) | done, tested |
| Device-to-device link (option D) | `src/platform/sync/p2p.js`, wraps `coop/join.js`, `resume.js`, `rtc.js` | done, tested with fakes |
| Menu card "Your devices" (the player's choice) | `src/apps/play/sync-card.js`, `sync-ui.js` | done; the card HTML is tested, the page itself is not run here |
| Cloud (option C: phrase, Turso primary, Supabase backup) | `cloud/`, `server/` | next patch |

Sync is off for everybody until the player taps "Link another device" (host) or confirms a link
they opened (guest: a link that joins devices must not join them by itself). `SYNC.available:
false` removes the card and the engine; `src/coop` may be deleted (the card is then not shown).

## The link, step by step (option D)

1. Host: "Link another device" turns the P2P way on, opens a room on the public brokers
   (`coop/join.js`) and shows `<page>#y=<token>`. The page must stay open (15 minutes).
2. Guest: opening the link shows a card that asks once ("Link this device"); then everything
   is in the background: ask to join, the host lets the first in and closes the room, a WebRTC
   connection, one exchange of slices both ways (`proto.js`), and each remembers the other
   (`zip_sync.peers`: id, name, the secret they share, when they last traded).
3. Later, with nobody asked: while the page is visible, linked devices look for each other
   (20 minutes, then not again for 10, or 30 seconds after a change of the player's data, or
   "Sync now") and trade what is new. Both pages must be open together: devices that are not use
   the cloud (next patch).
4. "Turn off" (tap twice) forgets the identity, the linked devices and their slices; the
   player's own data stays untouched.

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
