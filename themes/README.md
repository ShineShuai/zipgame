# Themes: design record and author's guide

`themes/` is the **author's workspace** for themes. It is not part of the web app and is never deployed. The game contains only the
engine (`webapp/src/themes/`, `webapp/css/theme.css`) and receives a theme as a **bundle**, only when it is offered.

## What the design has to satisfy

1. Every player has light and dark; every theme has its own symbol; a pool holds up to 4 themes (the cap grows with awards).
2. A theme reaches a player only by an **offer at an event**: they see it, then take it (it replaces a theme when the pool is full) or
   leave it. Not taken, or after the choice, it is gone after the event.
3. Players see only the themes they own and the one on offer. The themes are **not public and not directly reachable**.
4. A device downloads nothing it does not use (no catalog, no other theme).
5. Adding themes must not grow the app: theme content stays out of the app's code.
6. Constraints of this project: a static site, no accounts, anonymous play, backends that must work in China (Cloudflare does not),
   a Turso token in the page that is public (and reads every table). The mechanisms (who gets which offer, when, awards) are separate tasks.

## Options considered

| | Option | Not public (3) | No catalog / only what's used (4) | App stays small (5) | Fits this project (6) |
|---|---|---|---|---|---|
| A | Theme files in a folder next to the app (`../themes/x.css`) | no: any URL can be fetched, a catalog lists all | pool only, but all reachable | yes | yes |
| B | All themes inside the app, locked by flags | no (everything is shipped) | no | no: grows with every theme | yes |
| C | Server API that checks who owns what | yes | yes | yes | no: needs accounts (none) and a Worker (blocked in China) |
| D | Sealed (encrypted) files + keys released per grant | files opaque, keys gated | yes | yes | works, but adds crypto and a key store to an event that is a single row |
| **E** | **Event stage: the library stays with the author; a theme is on a stage table only while its event runs; the player keeps what they take** | **yes: nothing exists to fetch outside an event** | **yes** | **yes** | **yes: existing Turso, no accounts, no new service** |

**Chosen: E.** A and B break the requirement that themes are not public. C needs identity this app deliberately does not have and
a service China cannot reach. D protects files that never need to be public in the first place. In E the library is not on any web
server or database at all; the stage holds only what is on offer; the player's own themes live on their device. The cost is stated
below.

## Structure

```
themes/                  AUTHOR (private workspace, never deployed)
  <id>/theme.json        metadata, ~25 seed colours, the vars the theme varies
  <id>/art.json          icons, brand mark, board skin
  <id>/fonts/*.woff2     optional, self-hosted, 60 KB at most each
  tools/                 pack.mjs (theme -> bundle), stage.mjs (publish / withdraw SQL), derive, schema, tests
  preview/               debug page: the real controller on the packed bundles
  out/                   packed bundles (git-ignored; for preview and stage.mjs)
webapp/src/themes/       ENGINE (in the app; changes with features, not with the number of themes)
  tokens.js bundle.js svg.js art.js   the contract and the whitelists: every bundle is rebuilt, never trusted
  pool.js store.js                    the player's themes: the pool (up to 4) and their copies on the device
  index.js apply.js                   the controller (offer -> trial -> take / leave) and the page
  source.js                           the stage adapter (Turso): reads what is on offer now
webapp/server/turso/theme_stage.sql  STAGE: one table, one row per running offer
```

## Flows

- **Offer.** `node themes/tools/pack.mjs` -> `node themes/tools/stage.mjs publish <id> --event E --from D --until D | turso db shell <db>`.
  The mechanisms read the stage (`themeStage().offers()` in `src/ui/theme.js`) and decide who sees what; the controller shows a bundle with
  `themes().trial(bundle, { until })`.
- **Take.** `trial.commit(replaceId)`: the copy is saved on the device (`zip_theme_b_<id>`) and the theme enters the pool (it replaces
  `replaceId` when the pool is full; the replaced theme's copy is deleted).
- **Leave / event over.** `trial.revert()`, a timer at `until`, any choice, or a reload: nothing was kept, the theme is gone.
- **End the event.** `stage.mjs withdraw --event E`. That, not a clock, ends the offer.
- **Use.** An owned theme needs no network: the page's head script paints it from the device copy before the first frame.

## What this design does not do (decide if it matters)

- It cannot stop a player from keeping or sharing what they were shown (devtools, a copied bundle). It controls *access*, not copying.
- During an event the offered theme(s) can be read by anyone who asks (the stage is anonymous): per-player randomness is the
  mechanism's job (for example a local seed picks one of several rows), not an access control.
- Themes live on the device only: clearing the browser's data loses them (the pool falls back to light/dark). Backup/restore would be a
  separate feature (the app's export could carry the pool).
- If this repository is public, `themes/` is public too: keep `themes/` (except `tools/`) in a private repository and run the tools there
  (they find the app through relative paths, so keep the same layout).

## Author's guide

1. Write `themes/<id>/theme.json` (copy a sibling) and `art.json`. Everything not stated is derived and nudged to pass the contrast
   pairs (text 4.5, graphics 3); `pack` prints every nudge: a nudge in a seed you chose is a design decision to review.
2. `node themes/tools/pack.mjs` and `node themes/tools/test.mjs` (or `npm run themes:pack` / `npm run test:themes` in `webapp/`).
3. Look: from the repo root `python3 -m http.server 8000`, open `http://localhost:8000/themes/preview/`.
4. Try it in the game: serve the repo root the same way, open `http://localhost:8000/webapp/`, then in the console
   `const { themes } = await import('/webapp/src/ui/theme.js'); themes().trial(await (await fetch('/themes/out/candy.bundle.json')).json())`
   (`.commit('dark')` keeps it, replacing dark; `.revert()` leaves it).
5. Stage it for an event (see Flows). Raise a theme's `v` when its files change.

## Rules a bundle cannot break (checked when it is built and again when the game receives it)

- Token values are held to `webapp/src/themes/tokens.js` (bounds keep touch targets and layouts intact; no `url()`; fonts only the ones the
  bundle ships plus system ones). The defaults there must equal `webapp/css/theme.css` (tested).
- Art is shapes only (no ids, style, links, script); fonts are woff2 registered with the FontFace API (binary data: no url, nothing for
  the CSP to allow). A bad token rejects the whole bundle.
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box.
- Budgets (tested): bundle 24 KB without fonts, a font 60 KB, a stage row 200 KB.
