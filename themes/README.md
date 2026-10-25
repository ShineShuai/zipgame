# Theme templates

A theme is a **template**: data and art, no code, no per-theme CSS rules. Templates live here, outside the web app; the web
app holds only what runs them (`webapp/src/themes/`, `webapp/css/theme.css`, `webapp/css/layouts.css`).

```
themes/
  catalog.json        metadata of every theme (generated); fetched only when a picker or an award/random mechanism needs it
  <id>/theme.css      the tokens (generated from theme.json) + @font-face        fetched when the theme is in the pool or tried
  <id>/art.json       icons, brand mark, board skin                              same
  <id>/fonts/*.woff2  self-hosted fonts (OFL), Latin subset, 40 KB at most      only the faces the page uses
  <id>/theme.json     the source: metadata, ~25 seed colours, the vars it varies  never deployed
  tools/              generator, colour maths, schema, tests                      never deployed
  preview/            dev page that drives the real controller                    never deployed
```

Light and dark are built in (`webapp/src/themes/builtin.js`, `webapp/css/theme.css`): they cost no fetch and are every
player's first two themes. A player downloads only the themes in their pool (2 at the start, up to 4 as awards raise the cap).

## How the game uses it

1. The page's `<head>` script reads the pool from `localStorage` (`zip_theme_v2`), sets `data-theme` / `data-mode` / layout
   attributes and, for a downloadable theme, writes `<link href="../themes/<id>/theme.css?v=N">` (render-blocking: no flash).
   The base `../themes/` comes from `<meta name="themes-base">` of the page.
2. `webapp/src/themes/` takes over: `pool.js` (state, cap, save/replace), `registry.js` (fetch, once, validated),
   `apply.js` (attributes, bar colour, brand mark), `index.js` (the controller: `start`, `next`, `select`, `setCap`, `save`,
   `trial(entry)` -> `{ commit(replaceId), revert() }`). The mechanisms that award slots or offer a random theme call those.
3. Everything that comes from storage or the network is rebuilt from a whitelist (`svg.js`, `art.js`, `pool.cleanEntry`).
   A theme whose files cannot be had is shown as the built-in of its mode; the pool is left alone.

## Add a theme

1. `themes/<id>/theme.json`: `id`, `v`, `themeApi: 1`, `mode`, `name` (en, zh), `symbol` (the theme's own 24x24 glyph),
   `layout` (keys of `webapp/src/themes/layout.js`), `swatches`, `fonts`, `seeds` (colours) and `vars` (shape, size, type,
   shadows). Everything else is derived (tonal fills, hover, status colours, 3D tints) and each foreground is nudged until it
   passes the contrast pairs of `tools/schema.js` PAIRS (text 4.5, graphics 3). The generator prints each nudge: a nudge in a
   seed you chose is a design decision to review.
2. `art.json`: `icons` (the inside of a 48x48 viewBox; colours only `var(--ic-1..5)`, `--ic-ink`, `--ic-paper`, `--ic-shadow`,
   `currentColor`), an optional `mark` (brand art, no ids), the `board` skin in CELL units. Missing icons fall back to the
   classic ones in the theme's colours (not drawn yet: lucky, tetra, cube, ball).
3. `node themes/tools/gen.mjs` writes `theme.css` and `catalog.json` (commit them; `--check` fails when stale).
4. `node themes/tools/test.mjs` (or `npm run test:themes` in `webapp/`).
5. Look at it: from the repo root `python3 -m http.server 8000`, open `http://localhost:8000/themes/preview/`.
6. In the real game: serve the repo root the same way, open `http://localhost:8000/webapp/`, and in the console
   `localStorage.zip_theme_v2 = JSON.stringify({ v: 2, cap: 4, active: 'candy', pool: <entries of catalog.json: light, dark, candy> })`,
   then reload.

## Rules a template cannot break

- Values are checked against `tools/schema.js` (bounds keep touch targets and layouts intact; no `url()`; fonts only the ones the
  theme ships plus system ones). The defaults there must equal `webapp/css/theme.css` (tested).
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box. Frames,
  plates and depth are drawn inside the svg (`board.plateRx`, `board.depth`) or on the card around it.
- Fonts are self-hosted (the CSP allows `'self'` only; Google Fonts are blocked and unreliable in China), with the CJK fallback of
  `BASE_FONT` after the theme's family. Caps and tracking are switched off for `:lang(zh)` by the generated CSS.
- Budgets (tested): theme CSS 6 KB, art 12 KB, a catalog entry 0.9 KB, the catalog 8 KB.

## Deploying

Publish `themes/catalog.json` and each `themes/<id>/` without `theme.json`, `tools/` and `preview/`, next to `webapp/` and
`assets/` (same origin: the CSP needs no change). The URLs carry `?v=<v>`: raise a theme's `v` when its files change.
A CDN later is a change of `<meta name="themes-base">` plus the CSP (`style-src`, `font-src`, `connect-src`).
