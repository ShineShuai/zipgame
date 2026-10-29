# Themes: design record and author's guide

`themes/` is the **author's workspace** for themes. It is not part of the web app and is never deployed as it is. The game contains only the
engine (`webapp/src/themes/`, `webapp/css/theme.css`); CI packs the themes into bundles and publishes those next to the app (below).

## What the design has to satisfy

1. Every player has light and dark; every theme has its own symbol; a pool holds up to 4 themes (the cap grows with awards). Light and dark are
   themes of the site's pool like all others: the manifest lists them (no file: the app has them), so an event can offer one again to a player
   who replaced it, and the dev reveal lists them.
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
                         remove, fonts), import-proto.mjs (design page -> theme), zh-fonts.py (the Chinese name's face, below), serve.mjs (preview server), derive, schema, tests
  preview/               author's page: the real controller on mock screens
  out/                   generated, git-ignored (preview bundles; out/site/ = what the dev server serves as the game's theme folder)
assets/design/           the design pages (zigzag-NN-<id>.html) and assets/images/logo/proto/ their icon sheets (NN-<id>-variants.svg, gen/*.py):
                         sources of themes, not published (stage-site.sh leaves them out)
t/                       BUILT by CI into the site (config.js THEMES.base): <hash>.json per theme + the manifest (THEMES.pool)
webapp/src/themes/       ENGINE (changes with features, not with the number of themes)
  builtin.js                          light and dark: the metadata the manifest lists, the css is css/theme.css (no file, no fetch)
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
- **Event.** The app's own trigger (not this system) calls `offerTheme({ id, until })` (`src/ui/theme.js`; `until` defaults to the end of the
  local day); `watchDay(check)` runs that check now, when the page is seen again, when the network is back and at local midnight, so the page needs
  no reload. The controller reads the manifest, drops drafts and themes the player owns, and picks one from a hash of the device's random seed and
  the event id: a reload within the event finds the same offer, devices differ. The bundle is fetched, validated and kept **waiting** (record
  `zip_theme_o`, `src/themes/trial.js`): a chip says "rare theme today, try it for 30 min". An event id is answered once. No theme to offer
  (nothing reachable, all owned, only drafts) or another offer still open: nothing happens, the next trigger tries again.
- **Trial.** A tap on the chip starts it: the page wears the theme for `THEMES.trialMs` (`config.js`, 30 min) of *foreground* time. The clock stops
  while the page is hidden or the player is choosing which theme to replace, and never ends in the middle of a puzzle (the next menu screen). The chip
  shows the countdown; a tap opens the sheet (keep / leave / minimize). The chip and the sheet show on menu screens only. The record survives a reload
  (the head script paints the trial theme before the first frame). Choosing another theme during the trial pauses it (the chip says "resume").
- **Time up.** The theme leaves the page and the sheet asks "keep it?" until the day ends (at least 30 min). No answer: it is gone and answered.
- **Take.** `keepOffer(replaceId)`: the copy is saved on the device (`zip_theme_b_<id>`) and the theme enters the pool (it replaces `replaceId` when
  the pool is full; the replaced theme's copy is deleted). The sheet asks which theme to replace.
- **Leave / day over.** `leaveOffer()`, or the end of the day for a waiting or final offer: nothing was kept, the theme is gone.
- **Slots.** A pool has 2 slots; 12 Game-of-Day solves in total (replays count, one per date) earn a third, a best streak of 30 days a fourth
  (`src/themes/slots.js`; the count is kept in the Game-of-Day blob as `n` so it survives the pruning of old dates). `awardSlots` only raises the
  cap; a notice shows when a slot is earned.
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
| **Add, from a design page** | Put `zigzag-NN-<id>.html` in `assets/design/` and `NN-<id>-variants.svg` in `assets/images/logo/proto/`, then `npm run themes:import` (one theme: `... -- <id>`). Colours, shapes, fonts, icons, brand mark and board skin are read from the page. The Chinese name, the symbol and the layout are in `tools/proto-meta.json`; a design without an entry gets the English name, a zigzag symbol and the default layout. A design whose page name differs from its theme id says so with `"page"` (the theme `bauhaus` is the page `zigzag-17-bauhaus-bento`). What a page cannot carry or the reader misreads (a tuned colour, a wood-grain background, a bento's sizes) is the entry's `"override"` (`seeds`, `vars`, `board`, `swatches`): edit that, never the generated theme. A theme without `"proto"` in its theme.json was written by hand and is never overwritten (`--force`); every theme of the pool is generated today. |
| **Change an icon design** | Edit the design's class in `assets/images/logo/proto/gen/concepts_*.py` (the engine is `core.py`, the helpers `kit.py` and `kit2.py`; the Two paths icon is the file `gen/two/NN-<id>.svg`), then from the repository root `python3 assets/images/logo/proto/gen/build_all.py assets` (rewrites every sheet and page in place; a design without a page is skipped), then `npm run themes:import` in `webapp/`. A design drawn on the board scenes (Wood: a palette on `core.Style`) needs no drawing of its own for Two paths; the others have `gen/two/NN-<id>.svg`. Run both only after a design changed: CI and the deployment read the committed `themes/`; `npm run test:themes` fails when a committed theme is not what its design gives. |
| **Add, by hand** | `npm run themes -- new <id>` (or `new <id> --from <other>` to start from another theme), then edit `themes/<id>/theme.json`: five colours and a name are a whole theme. Add `art.json` and fonts when you have them. |
| **Check** | `node themes/tools/pack.mjs <id>` (contrast nudges and problems), `npm run themes -- list` (every theme: mode, live or draft, bytes, problems), `npm run test:themes`. |
| **Look at it** | `npm run themes:preview`, then `http://localhost:8000/webapp/` and hold V: every theme of the pool (or `python3 -m http.server` from the repository root after `npm run themes:build -- .`). |
| **Publish** | Push. CI tests, packs and deploys; the new theme is in the pool of the next deployment and is offered from then on. |
| **Retire** | `npm run themes -- retire <id>` sets `"live": false`: never offered, still listed in the dev reveal (`restore` undoes it). |
| **Remove** | `npm run themes -- remove <id>` deletes `themes/<id>/`. The next deployment no longer has it; players who own it keep their copy. |
| **The Chinese name** | `zhFace` in the design's entry of `tools/proto-meta.json`: `<face>-<weight>`, the face being `sans`, `serif` or `mono` (Noto Sans / Serif / Sans Mono CJK SC, weights 100-900 as Noto has them) or a restyle of the sans: `round` (rounded terminals), `pixel` (a 24 x 24 grid), `hand` (a wobbling marker), `stencil` (condensed, bridges cut open). Pick the weight and style of the theme's Latin face (Fredoka: `round-700`, Playfair Display: `serif-900`, Saira Stencil One: `stencil-900`). Then `python3 themes/tools/zh-fonts.py [id ...]` (needs fontTools, numpy, opencv-python, Pillow, brotli and the Noto CJK .ttc files; `NOTO_DIR` names their folder; `--specimen FILE.html` writes a sheet of the faces) cuts the two glyphs of 之折 into `themes/<id>/fonts/zh.woff2` (about 1.3 KB), and `npm run themes:import` puts the font entry (`"weight": "100 900"`: never faked bold) and `--font-zh` in the theme. The file is committed; CI never runs the script. The Noto faces are OFL 1.1 (the licence and copyright stay in the font's name table; the restyles carry the name Zigzag Round / Pixel / Hand / Stencil, as the OFL asks of a modified font). A bundle carries three fonts at most: the importer takes two Latin fonts and this one. To use a real display face instead (ZCOOL KuaiLe for Candy, say): change `family` in theme.json, drop the file and run `fonts --fetch` with the text `之折` (`cssUrl(family, weight, '之折')`). |
| **Fonts** | `npm run themes -- fonts` lists the font files the themes name and do not have; `npm run themes -- fonts --fetch [id ...]` downloads them once from Google Fonts, already subset to the glyphs the UI uses (`FONT_TEXT` in `tools/fonts-fetch.mjs`: ASCII and a few marks, a few KB to some tens of KB each). Commit the files: `build-site` embeds them in that theme's bundle, so a player never contacts Google and downloads a font only with its theme. Until a file is there, the theme uses its fallback fonts. Fonts are OFL: keep the licence text with them. |

Everything not stated in a theme.json is derived and nudged to pass the contrast pairs (text 4.5, graphics 3; a visited number against an idle one
1.5, hue counts): `pack` prints every nudge, and a nudge in a seed you chose is a design decision to review. Raise a theme's `v` when its files change.

## What a theme changes in the game

- **Tokens** (`css/theme.css` defaults, bundle overrides): colours, radii, borders, sizes, fonts, shadows, the number discs, the portal colours.
- **The frame** (what the design's phone is): `--bw-card` (0 to 8 px), `--bs-card` (solid, dashed, double, dotted; a double line needs 3 px) and the theme's `line`
  / `lineStrong` colours, which the importer reads from the design's phone and small controls (a Memphis card is 3 px of ink, a Manuscript card a 6 px double
  line); `--bar-bw`, the line under the app bar, follows the frame (at most 3 px; a design without a frame keeps the light 1 px line). Cards take the frame as it
  is; popovers, nested cards and the pickers take at most 3 px of it (`--bw-sub`, `css/play.css`).
- **Radii of boxes with text.** A theme's `--r-1`, `--r-2` and `--r-tile` may be `999px` (pill buttons, round chips). Boxes that hold several lines (stat pills,
  shared games, notes, popovers, the lucky game) use `--rb-1`, `--rb-2` and `--rb-tile` (`css/play.css`: the theme's radius, at most 16, 18 and 20 px; `--rb-3`, 20 px, for the corners of the action bar), so a pill
  theme never cuts a corner through a text or an icon. Write new boxes with those, and one-line controls with `--r-*`.
- **The brand and its Chinese name.** The app bar shows the mark (the theme's `art.json` mark, else the shared one) and `#brandName`: `zigzag`, in Chinese 之折
  (`brand.name` in `src/ui/i18n.js`, set with the language; the same name heads the shared texts). In Chinese the name is set in `--font-zh`, a face the theme
  brings for those two glyphs (below).
- **Art** (`art.json`): the variant icons (`variantIcon` in `apps/play/icons.js` draws the theme's icon, the classic one for any it does not draw;
  Two paths is a composition of its own in every theme, matched to the design, always two separate paths that never cross or overlap: the
  drawing is `assets/images/logo/proto/gen/two/NN-<id>.svg` (a hand-finished SVG, `@` stands for the id prefix; `build_all.py` puts it on the sheet
  and the page), and the importer takes the two route colours of the game's Two paths boards from it unless `routes` in `proto-meta.json` sets them),
  the brand mark, and the **board skin** (`apps/play/board.js`): inset rounded tiles with an edge and a lower edge on an optional plate, path
  width / cap / join and a top-to-bottom gradient, wall width and cap, number disc or square. The skin applies to plain boards; Cutout,
  Wrap-around and Pentagon keep their own tiles (in the theme's colours), Two paths keeps its circle and square. `board.solid` picks the
  light or dark 3D palette (a light board on a dark page, like wood).
- **Layout** (`css/layouts.css`, chosen by the theme's `layout` keys): menu `dashboard` (default) | `stack` | `bento`; picker `tiles` (default) |
  `list`; actions `side` (default) | `bar`. The defaults have no rule: they are `play.css`.
- **The pool picker** (`ui/theme-picker.js`): with two themes the header button switches (as light/dark always did), with three or more (or with the dev reveal on) it opens a list.
- **The offer chip and sheet** (`ui/theme-offer.js`): try, keep or leave a theme, with the time left, and which theme to replace when the pool is full; menu screens only.
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
