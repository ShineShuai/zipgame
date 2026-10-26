# Themes: design record and author's guide

`themes/` is the **author's workspace** for themes. It is not part of the web app and is never deployed as it is. The game contains only the
engine (`webapp/src/themes/`, `webapp/css/theme.css`); CI packs the themes into bundles and publishes those next to the app (below).

## What the design has to satisfy

1. Every player has light and dark; every theme has its own symbol; a pool holds up to 4 themes (the cap grows with awards).
2. A theme reaches a player by an **offer at an event**; **every player may get a different offer**. They see it, then take it (it replaces
   a theme when the pool is full) or leave it. Not taken, or after the choice or the event, it is gone.
3. How an event is triggered is not the theme system's business: it is handed an event id and the time the offer ends.
4. The themes are not listed or advertised, and are not easy to find or to pick: the app lists nothing until an event fires.
5. A device downloads nothing it does not use (no other theme, no manifest until an event or the dev reveal asks).
6. Adding a theme must not grow the app, and needs no manual step: push the theme, CI deploys it.
7. No backend: the site is static (GitHub Pages now, perhaps Cloudflare Pages later), there are no accounts.
8. **Dev reveal** (hold V, 5 taps on the bare app bar, or a pinned device): the theme list shows every theme of the pool, drafts too. A tap tries
   one (nothing is kept, the cap does not matter), "+" keeps it (it takes the place of one of the player's themes when the pool is full), and
   "Offer a theme now" runs the real offer. This is how a deployed build is looked at.

## Options and the decision

| | Option | Verdict |
|---|---|---|
| A1 | Bundles published by hand under random tokens (`offers/<token>.json`, `publish.mjs`), tokens handed to the offer mechanism | replaced: not part of CI (never deployed), a manual step per event, the app could not pick from a pool it does not know |
| **A2** | **CI packs every theme into the site: content-hashed file names and a manifest whose name is in `config.js`; the app reads the manifest only when needed** | **chosen** |
| B | All themes inside the app, locked by flags | rejected: everyone downloads everything, the app grows with every theme |
| C | A server API that checks who owns what | rejected for now: needs a service reachable from everywhere. It can replace `source.js` later (a Worker that draws and rate-limits) without touching the rest |
| D | Secrets (an HMAC salt, encrypted catalog, private repo) | rejected: the repository is public (free tier), so it could only be cosmetic; the cost in CI and for the dev reveal is not worth it |

**What A2 is, honestly: hiding, not protection.** The files are public static files. What stops a casual player is that the app lists no theme, a
file name is the hash of its content (it cannot be guessed from a theme id), and the manifest has a file name of its own that is not a standard one.
Anyone who reads the code and the repository can find every theme, build one, or put one in their own storage. That is accepted.

## Structure

```
themes/                  AUTHOR (the sources; CI reads them, the site never contains them)
  <id>/theme.json        metadata, ~25 seed colours, the vars the theme varies; "live": false marks a draft
  <id>/art.json          icons, brand mark, board skin
  <id>/fonts/*.woff2     optional, self-hosted, 60 KB at most each (embedded in the bundle)
  tools/                 pack.mjs (theme -> bundle), build-site.mjs (CI: bundles + manifest into the site), serve.mjs (preview server), derive, schema, tests
  preview/               author's page: the real controller on mock screens
  out/                   generated, git-ignored (preview bundles; out/site/ = what the dev server serves as the game's theme folder)
t/                       BUILT by CI into the site (config.js THEMES.base): <hash>.json per theme + the manifest (THEMES.pool)
webapp/src/themes/       ENGINE (changes with features, not with the number of themes)
  tokens.js bundle.js svg.js art.js   the contract and the whitelists: every bundle is rebuilt, never trusted
  pool.js store.js                    the player's themes: the pool (up to 4) and their copies on the device
  index.js apply.js                   the controller (event -> trial -> take / leave; dev pool) and the page
  source.js                           the manifest and the files behind it
  event.js offer.js picker.js         which theme an event offers; the markup of the offer sheet and the picker
webapp/src/ui/theme*.js              the button, the picker (+ dev rows) and the offer sheet on the page
```

## Flows

- **Add or change a theme.** Write `themes/<id>/`, push. CI (`webapp-ci.yml`) runs the theme tests; on `main`, `stage-site.sh` calls
  `build-site.mjs`, which packs every theme (a problem fails the build), writes `t/<hash>.json` for each and the manifest, and `--check` reads
  the folder back. Only those files are published: no `theme.json`, `art.json` or font file (the stage scan fails if one is staged).
- **Event.** The app's own trigger (not this system) calls `offerTheme({ id, until })` (`src/ui/theme.js`). The controller reads the manifest,
  drops drafts and themes the player owns, and picks one from a hash of the device's random seed and the event id: a reload within the event shows
  the same theme, devices differ. The bundle is fetched, validated and shown **on trial**; the offer sheet asks the player to keep or leave it
  until `until`. An event id is answered once (kept or left). No theme to offer (nothing reachable, all owned, only drafts): nothing happens.
- **Take.** `commit(replaceId)`: the copy is saved on the device (`zip_theme_b_<id>`) and the theme enters the pool (it replaces `replaceId` when
  the pool is full; the replaced theme's copy is deleted). The sheet asks which theme to replace.
- **Leave / event over.** `revert()`, a timer at `until`, any choice, or a reload: nothing was kept, the theme is gone.
- **Use.** An owned theme needs no network: the page's head script paints it from the device copy before the first frame.
- **Dev reveal.** Hold V (or 5 taps on the bare app bar, or a pinned device): the theme button always opens the list, which gains "All themes"
  (from the manifest, drafts marked). Try, keep, or offer now (see above). Nothing of this is in the translations.
- **Remove a theme.** Delete its folder (or set `"live": false` to keep it out of offers): the next deployment no longer has the file.
  A player who owns it keeps their copy.

## Author's guide

1. Write `themes/<id>/theme.json` (copy a sibling) and `art.json`. Everything not stated is derived and nudged to pass the contrast
   pairs (text 4.5, graphics 3); `pack` prints every nudge: a nudge in a seed you chose is a design decision to review.
2. `node themes/tools/pack.mjs` and `node themes/tools/test.mjs` (or `npm run themes:pack` / `npm run test:themes` in `webapp/`).
3. Look at it while writing: `node themes/tools/serve.mjs` (or `npm run themes:preview` in `webapp/`) packs every theme and serves the repo
   root: `http://localhost:8000/themes/preview/` (mock screens) and `http://localhost:8000/webapp/` (the game, with the theme files as CI builds
   them: hold V to try any of them).
4. Look at the deployed build: open the site, hold V (or tap the app bar 5 times), tap the theme button. Use `"live": false` while a theme
   is not ready: only the dev reveal lists it.
5. Raise a theme's `v` when its files change.
6. `npm run themes:build -- /tmp/site` builds the theme folder into `/tmp/site/t/` (what CI does), `... --check` reads it back.

## What a theme changes in the game

- **Tokens** (`css/theme.css` defaults, bundle overrides): colours, radii, borders, sizes, fonts, shadows, the number discs, the portal colours.
- **Art** (`art.json`): the variant icons (`variantIcon` in `apps/play/icons.js` draws the theme's icon, the classic one for any it does not draw),
  the brand mark, and the **board skin** (`apps/play/board.js`): inset rounded tiles with an edge and a lower edge on an optional plate, path
  width / cap / join and a top-to-bottom gradient, wall width and cap, number disc or square. The skin applies to plain boards; Cutout,
  Wrap-around and Pentagon keep their own tiles (in the theme's colours), Two paths keeps its circle and square. `board.solid` picks the
  light or dark 3D palette (a light board on a dark page, like wood).
- **Layout** (`css/layouts.css`, chosen by the theme's `layout` keys): menu `dashboard` (default) | `stack` | `bento`; picker `tiles` (default) |
  `list`; actions `side` (default) | `bar`. The defaults have no rule: they are `play.css`.
- **The pool picker** (`ui/theme-picker.js`): with two themes the header button switches (as light/dark always did), with three or more (or with the dev reveal on) it opens a list.
- **The offer sheet** (`ui/theme-offer.js`): keep or leave a theme on trial, with the time left, and which theme to replace when the pool is full.
- Every change of theme redraws the screen (`zip-theme`), so icons, boards and 3D tints follow.

## Rules a bundle cannot break (checked when it is built and again when the game receives it)

- Token values are held to `webapp/src/themes/tokens.js` (bounds keep touch targets and layouts intact; no `url()`; fonts only the ones the
  bundle ships plus system ones). The defaults there must equal `webapp/css/theme.css` (tested).
- Art is shapes only (no ids, style, links, script); fonts are woff2 registered with the FontFace API (binary data: no url, nothing for
  the CSP to allow). A bad token rejects the whole bundle.
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box.
- Budgets (tested): bundle 24 KB without fonts, a font 60 KB, a published file 220 KB.
