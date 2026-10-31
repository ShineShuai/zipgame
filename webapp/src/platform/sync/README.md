# Device sync: one player, several devices

A player can keep their data (statistics, Game-of-Day records, streak, unlock and replay
chances, gift, rules shown) the same on all their devices, **without an account or login**.
It is **off for everybody until the player turns it on** on their device
(`SYNC.available` in `src/config.js` only lets them; `false` removes the feature).

## What is here (patches 1 to 3 of 4)

| Layer | Files | State |
|---|---|---|
| Merge rules, slice codec, sync phrase, key derivation and sealing | `src/core/sync/` | done, tested |
| Identity, group view, exchange protocol | `src/platform/sync/engine.js`, `proto.js` | done, tested |
| Features read the group's data | `stats-store`, `streak`, `unlock`, `replay`, `gift`, `rules-seen` (optional `sync` argument) | done, tested |
| Device-to-device link (option D) | `p2p.js`, wraps `coop/join.js`, `resume.js`, `rtc.js` | done, tested with fakes |
| Cloud (option C: sync phrase, Supabase primary, Turso second; its own config `SYNC.cloud` and its own SQL, apart from the averages and behaviour rows) | `cloud.js`, `cloud/`, `server/supabase/sync.sql`, `server/turso/sync.sql`, `tools/sync-prune.mjs` | done; Turso side run for real on SQLite, Supabase SQL **not run** (no Postgres here), see below |
| Menu card "Your devices" (the player's choice) | `src/apps/play/sync-card.js`, `sync-ui.js` | done; the card HTML is tested, the page itself is not run here |
| Hardening (caps, rotation, errors) | | next patch |

Sync is off for everybody until the player taps "Link another device" (host), confirms a link they
opened (guest: a link that joins devices must not join them by itself), or makes / types a sync
phrase. `SYNC.available: false` removes the card and the engine; `src/coop` may be deleted (the
link buttons are then not shown; the cloud way needs only WebCrypto and a configured server).

## The sync phrase and the cloud (option C)

* "Make a sync phrase" turns the cloud way on and shows 8 words (80 secret bits + a 16-bit checksum,
  `core/sync/words.js`). "I have a sync phrase" takes them on another device (every wrong word is
  caught). Anyone who knows the words can read and change that player's game data: they are shown as
  a secret.
* From the 80 bits (PBKDF2, 600,000 rounds, then HKDF) come the group id, an auth value and an
  AES-GCM key (`core/sync/cloud-keys.js`). A device seals its slice (id and device id are in the
  tag) and puts it on the servers of `SYNC.cloud.backends` (their own urls, keys, SQL and tokens;
  the averages and the behaviour rows keep theirs, Turso first): Supabase (primary: the first write claims the
  group, writes and the delete show the auth value, ids cannot be listed) and Turso (second:
  append-only with the public token, junk possible, skipped by the page). A pull asks both and
  keeps what opens. Server setup, tokens and pruning: `server/README.md`, "Device sync".
* The card says in two sentences what the servers can see (that a group exists, when it changes,
  how many devices write to it, their IP addresses) and what they cannot (the data).
* A device pushes after a change (5 s later, never twice within 60 s), when the page is hidden
  (`keepalive`), and pulls when it starts or is shown again.
* Links and phrase are one group: a linked device that has the cloud secret hands it to one that
  has none (over the sealed connection); two groups become one, the secret with the smaller short
  name wins on both. "Stop cloud sync" keeps the phrase; "Delete cloud copy" deletes the Supabase
  group at once and forgets the phrase (Turso's rows become unreadable and are pruned).

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
   the cloud.
4. "Turn off" (tap twice) deletes the cloud copy where it can, then forgets the identity, the
   linked devices and their slices; the player's own data stays untouched.

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
