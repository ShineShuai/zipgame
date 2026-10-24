# Theme templates

A theme is a **template**: data and art, no code, no per-theme CSS rules.

| Part | File | Loaded |
|---|---|---|
| manifest entry (metadata only) | `catalog.js` | always, with the page (about 0.6 KB a theme) |
| tokens | `css/themes/<id>.css`, generated | only when the theme is in the player's pool or is being tried |
| art (icons, mark, board skin) | `<id>/art.js` | same |
| source of the tokens | `<id>/theme.json` | never by the game; read by `tools/theme-gen.mjs` and the tests |

`light` and `dark` are built in: their tokens are `css/theme.css`, their art is the classic one, they cost nothing to fetch.

## Add a theme

1. `src/themes/<id>/theme.json`: `mode`, about 25 `seeds` (colours) and the `vars` it varies (shape, size, type, shadows).
   Everything else is derived (tonal fills, hover, status colours, 3D tints) and each foreground is nudged until it passes the
   contrast pairs of `schema.js` PAIRS (text 4.5, graphics 3). The generator prints each nudge: a nudge in a seed you chose is a
   design decision to review, not noise.
2. `node tools/theme-gen.mjs` writes `css/themes/<id>.css` (commit it; `--check` fails when it is stale).
3. `src/themes/<id>/art.js`: `icons` (the inside of a 48x48 viewBox; colours only `var(--ic-1..5)`, `--ic-ink`, `--ic-paper`,
   `--ic-shadow`, `currentColor`), an optional `mark` (brand art; no ids), and the `board` skin in CELL units.
   Missing icons (lucky, tetra, cube, ball today) fall back to the classic icons, drawn in the theme's colours.
4. One entry in `catalog.js` (names in en and zh, `layout` keys, four swatches, the `symbol`).
5. `node test/theme-templates.js`. Open `themes.html` through a local server to look at it.

## Rules a template cannot break

- Colour, shape, size and type values are checked against `schema.js` (bounds keep touch targets and layouts intact; no `url()`).
- A theme never pads, borders or transforms the board svg: pointer positions map to cells through its bounding box.
  Frames, plates and depth are drawn inside the svg (`board.plateRx`, `board.depth`) or on the card around it.
- Fonts are self-hosted woff2 in `fonts/` (the CSP allows `'self'` only; Google Fonts are blocked and unreliable in China),
  Latin subset, 40 KB at most, with the CJK fallback of `BASE_FONT` after the theme's family. Caps and tracking are switched
  off for `lang="zh"` by the generated CSS.
- Budgets (tested): theme CSS 6 KB, art 12 KB, manifest entry 0.9 KB.
