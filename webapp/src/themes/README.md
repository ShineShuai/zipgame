# Theme engine

What runs themes in the game. Theme *content* (colours, art, fonts, the tools that build them) is not here: it lives in `themes/` at the
repo root; CI packs it into the site (see `themes/README.md` for the design, the options that were weighed and why this one was chosen).

| File | Role |
|---|---|
| `tokens.js` | the token contract (names, defaults, kinds, bounds) and `cleanTokens` / `buildCss` |
| `svg.js`, `art.js`, `layout.js` | whitelists for the SVG, icons, board skin and layout keys a theme brings |
| `bundle.js` | `cleanBundle`: a bundle is accepted whole or not at all |
| `pool.js` | pool state (2..4 themes), migration of the old key, pure functions |
| `store.js` | the player's own themes on the device (`zip_theme_b_<id>`) |
| `apply.js` | attributes, the token block `<style id="theme-css">`, brand mark, fonts; remembers the art (`art-state.js`) for the code that draws |
| `art-state.js` | the art on screen: `currentArt()` for icons and the board, `solidIsDark()` for the 3D palette |
| `picker.js` | the items and markup of the pool picker and of the dev reveal's rows (the DOM part is `ui/theme-picker.js`) |
| `index.js` | the controller: `start`, `next`, `select`, `setCap`, `event({id, until})` / `trial(bundle, {until})` -> `{commit(replaceId), revert}`; dev reveal: `pool`, `tryPool`, `keepPool`; `install` |
| `source.js` | the site's theme files: the manifest (`config.js` THEMES.pool) and `<hash>.json` bundles; the app lists none until an event or the dev reveal asks |
| `event.js` | which theme an event offers: a hash of the device seed and the event id, in a ring; the keys of the seed and of the last answered event |
| `offer.js` | the markup of the offer sheet (`ui/theme-offer.js`) and the time left |
| `builtin.js` | light and dark (their tokens are `css/theme.css`) |

The page's `<head>` script (`index.html`) paints the active theme from the device copy before the first frame; a test runs it against
`pool.js` so the two cannot drift apart.
