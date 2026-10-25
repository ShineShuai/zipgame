// What only the build needs: the contrast pairs a theme's tokens must pass. The token contract itself (names, defaults, kinds,
// bounds) is webapp/src/themes/tokens.js: the app applies the same checks to every bundle it receives.
export { BASE_FONT, SYSTEM_FONTS, TOKENS, checkValue } from '../../webapp/src/themes/tokens.js';
export { LAYOUT } from '../../webapp/src/themes/layout.js';

// [foreground, background, minimum ratio]: text 4.5, graphics 3. The first block is css/theme.css's own list.
export const PAIRS = [
  ['--text', '--surface', 4.5], ['--heading', '--surface', 4.5], ['--muted', '--surface', 4.5],
  ['--muted', '--surface-2', 4.5], ['--accent-text', '--surface', 4.5], ['--accent-text', '--surface-2', 4.5],
  ['--accent-text', '--accent-soft', 4.5], ['--on-accent', '--accent', 4.5], ['--ok', '--ok-bg', 4.5],
  ['--warn', '--warn-bg', 4.5], ['--danger', '--surface', 4.5], ['--heal', '--heal-bg', 4.5],
  ['--on-orange', '--orange', 4.5], ['--text', '--bg', 4.5], ['--accent', '--surface', 3],
  ['--b-wall', '--b-bg', 3], ['--b-path', '--b-bg', 3], ['--b-path-hi', '--b-bg', 3],
  ['--b-red', '--b-bg', 3], ['--b-blue', '--b-bg', 3], ['--b-wrong', '--b-bg', 3],
  // numbers: the digit on its disc (idle and visited), and visited told apart from idle
  ['--b-num', '--b-num-fill', 4.5], ['--b-num-on', '--b-numv-fill', 4.5],
  ['--b-numv-fill', '--b-num-fill', 3],
];
