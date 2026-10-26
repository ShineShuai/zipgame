# Theme engine

What runs themes in the game. Theme *content* (colours, art, fonts, the tools that build them) is not here: it lives in `themes/` at the
repo root (see `themes/README.md` for the design, the options that were weighed and why this one was chosen).

| File | Role |
|---|---|
| `tokens.js` | the token contract (names, defaults, kinds, bounds) and `cleanTokens` / `buildCss` |
| `svg.js`, `art.js`, `layout.js` | whitelists for the SVG, icons, board skin and layout keys a theme brings |
| `bundle.js` | `cleanBundle`: a bundle is accepted whole or not at all |
| `pool.js` | pool state (2..4 themes), migration of the old key, pure functions |
| `store.js` | the player's own themes on the device (`zip_theme_b_<id>`) |
| `apply.js` | attributes, the token block `<style id="theme-css">`, brand mark, fonts; remembers the art (`art-state.js`) for the code that draws |
| `art-state.js` | the art on screen: `currentArt()` for icons and the board, `solidIsDark()` for the 3D palette |
| `picker.js` | the items and markup of the pool picker (the DOM part is `ui/theme-picker.js`) |
| `index.js` | the controller: `start`, `next`, `select`, `setCap`, `offer(token, {until})` / `trial(bundle, {until})` -> `{commit(replaceId), revert}`, `install` |
| `source.js` | fetches the bundle behind a token: `offers/<token>.json`, nothing lists them (`config.js` THEMES.offers) |
| `builtin.js` | light and dark (their tokens are `css/theme.css`) |

The page's `<head>` script (`index.html`) paints the active theme from the device copy before the first frame; a test runs it against
`pool.js` so the two cannot drift apart.
