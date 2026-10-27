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
  <id>/theme.json        the theme: five colours are enough (bg, surface, ink, muted, accent); everything else has a default
  <id>/art.json          optional: variant icons, brand mark, board skin (no art: the classic icons)
  <id>/fonts/*.woff2     optional, self-hosted, 60 KB at most each (embedded in the bundle)
  _template/             the smallest theme; `manage.mjs new` starts from it (folders starting with _ or . are not themes)
  tools/                 pack.mjs (theme -> bundle), build-site.mjs (CI: bundles + manifest into the site), manage.mjs (list, new, retire,
                         remove, fonts), import-proto.mjs (design page -> theme), serve.mjs (preview server), derive, schema, tests
  preview/               author's page: the real controller on mock screens
  out/                   generated, git-ignored (preview bundles; out/site/ = what the dev server serves as the game's theme folder)
assets/design/           the design pages (zigzag-NN-<id>.html) and assets/images/logo/proto/ their icon sheets (NN-<id>-variants.svg, gen/*.py):
                         sources of themes, not published (stage-site.sh leaves them out)
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

## Adding and removing a theme

A theme is a folder of `themes/`. Nothing else lists it (no registry, no pool file, no test names it), so adding and removing edit nothing else.
Run everything in `webapp/` as `npm run themes -- <command>` (or `node themes/tools/manage.mjs <command>` from anywhere).

| | |
|---|---|
| **Add, from a design page** | Put `zigzag-NN-<id>.html` in `assets/design/` and `NN-<id>-variants.svg` in `assets/images/logo/proto/`, then `npm run themes:import` (one theme: `... -- <id>`). Colours, shapes, fonts, icons, brand mark and board skin are read from the page. The Chinese name, the symbol and the layout are in `tools/proto-meta.json`; a design without an entry gets the English name, a zigzag symbol and the default layout. A theme without `"proto"` in its theme.json was written by hand and is never overwritten (`--force`). |
| **Add, by hand** | `npm run themes -- new <id>` (or `new <id> --from <other>` to start from another theme), then edit `themes/<id>/theme.json`: five colours and a name are a whole theme. Add `art.json` and fonts when you have them. |
| **Check** | `node themes/tools/pack.mjs <id>` (contrast nudges and problems), `npm run themes -- list` (every theme: mode, live or draft, bytes, problems), `npm run test:themes`. |
| **Look at it** | `npm run themes:preview`, then `http://localhost:8000/webapp/` and hold V: every theme of the pool (or `python3 -m http.server` from the repository root after `npm run themes:build -- .`). |
| **Publish** | Push. CI tests, packs and deploys; the new theme is in the pool of the next deployment and is offered from then on. |
| **Retire** | `npm run themes -- retire <id>` sets `"live": false`: never offered, still listed in the dev reveal (`restore` undoes it). |
| **Remove** | `npm run themes -- remove <id>` deletes `themes/<id>/`. The next deployment no longer has it; players who own it keep their copy. |
| **Fonts** | `npm run themes -- fonts` lists the font files the themes name and do not have, with where to get them; until a file is there, the theme uses its fallback fonts. |

Everything not stated in a theme.json is derived and nudged to pass the contrast pairs (text 4.5, graphics 3; a visited number against an idle one
1.5, hue counts): `pack` prints every nudge, and a nudge in a seed you chose is a design decision to review. Raise a theme's `v` when its files change.

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
- Art is shapes, gradients, clip paths, patterns, a few filters (blur, noise, displacement) and short number labels (`webapp/src/themes/svg.js`): ids only
  where a `url(#id)` points at them, never a url, a link, a script, an image or free style (one blend mode only); the page gives every drawing
  of an icon ids of its own. Fonts are woff2 registered with the FontFace API (binary data: no url, nothing for
  the CSP to allow). A bad token rejects the whole bundle.
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box.
- Budgets (tested): bundle 32 KB without fonts, a font 60 KB, a published file 220 KB.
