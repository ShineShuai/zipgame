# Themes: design record and author's guide

`themes/` is the **author's workspace** for themes. It is not part of the web app and is never deployed. The game contains only the
engine (`webapp/src/themes/`, `webapp/css/theme.css`) and receives a theme as a **bundle**, only when one is offered to the player.

## What the design has to satisfy

1. Every player has light and dark; every theme has its own symbol; a pool holds up to 4 themes (the cap grows with awards).
2. A theme reaches a player only by an **offer at an event**; **every player may get a different offer**. They see it, then take it (it
   replaces a theme when the pool is full) or leave it. Not taken, or after the choice, it is gone after the event.
3. Players only know the themes they own and the one offered: the themes are not listed or advertised anywhere.
4. A device downloads nothing it does not use (no catalog, no other theme).
5. Adding themes must not grow the app: theme content stays out of the app's code.
6. No additional backend: the site is static, there are no accounts (the mechanisms for awards and offers are separate tasks).

## Options and the decision

| | Option | Verdict |
|---|---|---|
| **A** | **Bundles are static files next to the app, each under a random token name; nothing lists them** | **chosen (by you)** |
| B | All themes inside the app, locked by flags | rejected: everyone downloads everything, the app grows with every theme |
| C | A server API that checks who owns what | rejected: needs accounts and a service reachable from China |
| D | Encrypted files plus keys released per grant | rejected: crypto and a key store for what A does with a file name |
| E | An "event stage" table in the existing Turso database | rejected (by you): an extra backend for little gain |

**Why A fits.** There is nothing to run: an offered theme is one file, `offers/<token>.json`. The app contains no list of themes or
addresses, so a player cannot learn the address of a theme that was not offered to them (128-bit random token; a malformed token makes
no request). A per-player random offer needs no server either: the offer mechanism picks one of the running event's tokens on the device
and hands it to `themes().offer(token)`. The player's own themes live on their device, so owned themes need no network.

**What A is, honestly: protection by not being listed**, not access control.
- The file *names* are the secret. **If the repository is public, `offers/` is visible there** and every address is known: keep `offers/`
  out of a public repo (a private repo, or upload the folder to the host when an event starts).
- Whoever receives a token can fetch it and keep it. Where the mechanism keeps its tokens decides how many people can see them: tokens in
  `config.js` are visible to anyone who reads it, but only for the themes of running events, if you publish at the start and withdraw at the
  end (below). `publish` makes a new token every time, so a leaked token dies with its file.
- A static host cannot make a file vanish from a browser that already has it: "gone" means the file is removed (404) and the app keeps
  nothing from a trial.
- Themes live on the device: clearing the browser's data loses them (the pool falls back to light/dark). Backup/restore would be a
  separate feature.

## Structure

```
themes/                  AUTHOR (private workspace, never deployed)
  <id>/theme.json        metadata, ~25 seed colours, the vars the theme varies
  <id>/art.json          icons, brand mark, board skin
  <id>/fonts/*.woff2     optional, self-hosted, 60 KB at most each
  tools/                 pack.mjs (theme -> bundle), publish.mjs (publish / withdraw / list), derive, schema, tests
  preview/               debug page: the real controller on the packed bundles
  out/                   packed bundles (git-ignored; for the preview)
offers/                  PUBLISHED bundles: <token>.json (+ a blank index.html). Only what is on offer. Deployed next to webapp/
webapp/src/themes/       ENGINE (changes with features, not with the number of themes)
  tokens.js bundle.js svg.js art.js   the contract and the whitelists: every bundle is rebuilt, never trusted
  pool.js store.js                    the player's themes: the pool (up to 4) and their copies on the device
  index.js apply.js                   the controller (offer -> trial -> take / leave) and the page
  source.js                           fetches the bundle behind a token
```

## Flows

- **Start an event.** `node themes/tools/pack.mjs`, then `node themes/tools/publish.mjs publish <id>` for each theme of the event: it prints
  a token. Deploy `offers/`. Hand the tokens to the offer mechanism (for example in `config.js`, next to the event's dates).
- **Offer.** The mechanism picks a token for this player and calls `themes().offer(token, { until })` (`src/ui/theme.js`): the bundle is
  fetched, validated, and shown on trial.
- **Take.** `trial.commit(replaceId)`: the copy is saved on the device (`zip_theme_b_<id>`) and the theme enters the pool (it replaces
  `replaceId` when the pool is full; the replaced theme's copy is deleted).
- **Leave / event over.** `trial.revert()`, a timer at `until`, any choice, or a reload: nothing was kept, the theme is gone.
- **End the event.** `node themes/tools/publish.mjs withdraw <token|id>` and deploy: the files are gone (404), the offer cannot be shown.
- **Use.** An owned theme needs no network: the page's head script paints it from the device copy before the first frame.

## Author's guide

1. Write `themes/<id>/theme.json` (copy a sibling) and `art.json`. Everything not stated is derived and nudged to pass the contrast
   pairs (text 4.5, graphics 3); `pack` prints every nudge: a nudge in a seed you chose is a design decision to review.
2. `node themes/tools/pack.mjs` and `node themes/tools/test.mjs` (or `npm run themes:pack` / `npm run test:themes` in `webapp/`).
3. Look: from the repo root `python3 -m http.server 8000`, open `http://localhost:8000/themes/preview/`.
4. Try it in the game: `node themes/tools/publish.mjs publish candy` prints a token; serve the repo root the same way, open
   `http://localhost:8000/webapp/`, then in the console
   `const { themes } = await import('/webapp/src/ui/theme.js'); const t = await themes().offer('<token>'); await t.commit('dark')`
   (`t.revert()` leaves it). `publish.mjs withdraw candy` removes the file again.
5. Raise a theme's `v` when its files change.

## Rules a bundle cannot break (checked when it is built and again when the game receives it)

- Token values are held to `webapp/src/themes/tokens.js` (bounds keep touch targets and layouts intact; no `url()`; fonts only the ones the
  bundle ships plus system ones). The defaults there must equal `webapp/css/theme.css` (tested).
- Art is shapes only (no ids, style, links, script); fonts are woff2 registered with the FontFace API (binary data: no url, nothing for
  the CSP to allow). A bad token rejects the whole bundle.
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box.
- Budgets (tested): bundle 24 KB without fonts, a font 60 KB, a published file 220 KB.
