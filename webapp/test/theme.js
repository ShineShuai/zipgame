// Tests of the light / dark theme: the token file css/theme.css (every colour of the play and stats pages comes from it), the contrast
// of the pairs the screens put together, and the choice logic of src/ui/theme.js. Registered by tests.js: themeTests(t, ok, eq).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolveTheme, parseTheme, THEME_KEY } from '../src/ui/theme.js';
import { POOL_KEY } from '../src/themes/pool.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const THEME = read('css/theme.css');

// The declarations of the first block that starts with `selector {` in the token file.
function tokens(selector) {
  const start = THEME.indexOf(`${selector} {`);
  const body = THEME.slice(start, THEME.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = tokens(':root');
const DARK = tokens(':root[data-theme="dark"]');

// Resolves var(--x) chains of one theme.
const value = (theme, name) => {
  let v = theme[name];
  for (let i = 0; i < 4 && v && v.startsWith('var('); i++) v = theme[v.slice(4, -1)];
  return v;
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = hex => {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum ratio]: text 4.5, graphics (a path, a ring, a button on a surface) 3.
const PAIRS = [
  ['--text', '--surface', 4.5], ['--heading', '--surface', 4.5], ['--muted', '--surface', 4.5], ['--muted', '--surface-2', 4.5],
  ['--accent-text', '--surface', 4.5], ['--accent-text', '--surface-2', 4.5], ['--accent-text', '--accent-soft', 4.5],
  ['--on-accent', '--accent', 4.5], ['--ok', '--ok-bg', 4.5], ['--warn', '--warn-bg', 4.5], ['--danger', '--surface', 4.5],
  ['--heal', '--heal-bg', 4.5], ['--on-orange', '--orange', 4.5], ['--text', '--bg', 4.5],
  ['--b-num', '--b-bg', 3], ['--b-wall', '--b-bg', 3], ['--b-path', '--b-bg', 3], ['--b-red', '--b-bg', 3], ['--b-blue', '--b-bg', 3],
  ['--b-wrong', '--b-bg', 3], ['--b-num-on', '--b-num', 4.5], ['--accent', '--surface', 3],
];

// Tokens the dark theme may leave as they are (the same value works on both).
const SAME_IN_BOTH = ['--accent', '--on-accent', '--radius', '--on-orange', '--icon-path', '--logo-plate', '--logo-tile', '--logo-line',
  '--logo-path', '--logo-dot', '--shadow-none'];

export function themeTests(t, ok, eq) {
  t('theme: the choice is the saved one, else the system setting', () => {
    eq([resolveTheme('dark', false), resolveTheme('light', true)], ['dark', 'light'], 'a saved choice wins');
    eq([resolveTheme(null, true), resolveTheme(null, false), resolveTheme('blue', true)], ['dark', 'light', 'dark']);
    eq([parseTheme('dark'), parseTheme('light'), parseTheme('x'), parseTheme(null)], ['dark', 'light', null, null]);
    eq(THEME_KEY, 'zip_theme', 'the page heads read this key before the first paint');
  });

  t('theme: the inline head scripts read the keys the theme code writes', () => {
    // the play page: the pool (themes/pool.js POOL_KEY) and, for a first run after the update, the old mode key
    const play = read('index.html');
    ok(play.includes(`getItem('${POOL_KEY}')`) && play.includes(`getItem('${THEME_KEY}')`), 'index.html sets data-theme before the first paint');
    ok(play.includes('css/theme.css'), 'index.html loads the tokens');
    // the stats page follows the mode the play page mirrors under THEME_KEY
    const stats = read('stats.html');
    ok(stats.includes(`localStorage.getItem('${THEME_KEY}')`) && stats.includes('css/theme.css'), 'stats.html');
  });

  t('theme: dark overrides the light tokens (and only those), except values that hold in both', () => {
    for (const name of Object.keys(DARK)) ok(name in LIGHT, `${name} is only in the dark block`);
    // the template tokens (shape, size, type ...) are the same in both; a theme may override them
    const block = THEME.slice(THEME.indexOf('template tokens:'), THEME.indexOf('end of template tokens'));
    const template = [...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]);
    ok(template.length > 40 && template.includes('--r-3') && template.includes('--ic-1'), 'the template block is found');
    const same = Object.keys(LIGHT).filter(name => !(name in DARK) && !SAME_IN_BOTH.includes(name) && !template.includes(name));
    // logo tokens alias the icon tokens, so they follow the dark values without an entry of their own
    eq(same.filter(name => !name.startsWith('--logo-')), [], 'tokens that dark forgot');
  });

  t('theme: contrast of the pairs the screens use, in light and in dark', () => {
    for (const [mode, theme] of [['light', LIGHT], ['dark', { ...LIGHT, ...DARK }]]) {
      for (const [fg, bg, min] of PAIRS) {
        const a = value(theme, fg), b = value(theme, bg);
        ok(/^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b), `${mode} ${fg} on ${bg}: plain hex values`);
        const ratio = contrast(a, b);
        ok(ratio >= min, `${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}`);
      }
    }
  });

  t('theme: no colour literal in the pages\' CSS or the board code; every var(--x) is defined', () => {
    const files = ['css/play.css', 'css/stats.css', 'src/apps/play/board.js', 'src/apps/play/pentagon-board.js'];
    for (const file of files) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      eq((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(h => !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(h)), [], `${file}: not a colour`);
      // the data: URI of the select arrow is the one literal CSS allows (a colour inside an image cannot use var())
      const literals = (text.replace(/url\("data:[^"]*"\)/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []);
      eq(literals, [], `${file}: colour literals`);
      // --arrow is not a colour: main.js sets it on a popover to keep its arrow on the tile
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) ok(m[1] in LIGHT || m[1] === '--arrow', `${file}: ${m[1]} is not in theme.css`);
    }
  });

  t('theme: the play app\'s JS has no colour literal outside the palettes of the 3D views and the portal colours', () => {
    const allowed = new Set(['solid.js', 'portal-icons.js']);
    const dir = new URL('../src/apps/play/', import.meta.url);
    for (const name of readdirSync(dir).filter(n => n.endsWith('.js') && !allowed.has(n))) {
      const text = readFileSync(new URL(name, dir), 'utf8').replace(/\/\/.*$/gm, '');
      eq(text.match(/['"`]#[0-9a-fA-F]{3,8}['"`]/g) || [], [], `${name}`);
    }
    ok(statSync(new URL('../css/theme.css', import.meta.url)).size > 1000);
  });
}
