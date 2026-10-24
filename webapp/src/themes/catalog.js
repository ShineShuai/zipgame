// The theme manifest: metadata only (~0.6 KB a theme), so the picker, the pool and the random-theme offer need no
// theme file. A theme's CSS (css/themes/<id>.css) and art (src/themes/<id>/art.js) are fetched only when the theme is
// in the player's pool (or is being tried); `light` and `dark` are built in (css/theme.css, the classic art).
//   mode      'light' | 'dark': color-scheme, the sun/moon logic, the 3D palette, the brand mark when the theme has none
//   chrome    the browser bar colour (<meta name="theme-color">), the theme's --bg
//   layout    keys of css/layouts.css (LAYOUT in schema.js)
//   swatches  [page, surface, accent, path]: the picker card and the random-theme offer are drawn from these
//   symbol    the theme's own glyph, the inside of a 24x24 svg (stroke = currentColor); the header button and the picker use it
export const BRAND_MARK = {
  light: '../assets/images/logo/zigzag-mark.svg',
  dark: '../assets/images/logo/zigzag-mark-dark.svg',
};

const STANDARD = { menu: 'dashboard', picker: 'tiles', actions: 'side' };

export const CATALOG = [
  {
    id: 'light', builtin: true, v: 1, mode: 'light', name: { en: 'Light', zh: '浅色' }, chrome: '#f4f7ff',
    layout: STANDARD, swatches: ['#f4f7ff', '#ffffff', '#3b68ee', '#f56a00'],
    symbol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },
  {
    id: 'dark', builtin: true, v: 1, mode: 'dark', name: { en: 'Dark', zh: '深色' }, chrome: '#0d1224',
    layout: STANDARD, swatches: ['#0d1224', '#151b32', '#3b68ee', '#ffb020'],
    symbol: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" fill="currentColor"/>',
  },
  {
    id: 'candy', v: 1, mode: 'light', name: { en: 'Candy', zh: '糖果' }, chrome: '#efe7ff',
    layout: STANDARD, swatches: ['#efe7ff', '#ffffff', '#6a4cf0', '#e8384f'], art: true,
    symbol: '<circle cx="12" cy="12" r="5"/><path d="M7 12 2.5 8.5v7zM17 12l4.5-3.5v7z"/>', // a wrapped sweet
  },
  {
    id: 'bauhaus', v: 1, mode: 'light', name: { en: 'Bauhaus', zh: '包豪斯' }, chrome: '#ece4d2',
    layout: { menu: 'bento', picker: 'tiles', actions: 'side' }, swatches: ['#ece4d2', '#fbf8f1', '#c8391d', '#e8a920'], art: true,
    symbol: '<circle cx="7.5" cy="8" r="3.8"/><rect x="13" y="4.2" width="7" height="7"/><path d="M12 13.5l4.5 7.5h-9z"/>', // circle, square, triangle
  },
  {
    id: 'bounce', v: 1, mode: 'light', name: { en: 'Bounce', zh: '弹跳' }, chrome: '#dbe6ff',
    layout: STANDARD, swatches: ['#dbe6ff', '#ffffff', '#2342c4', '#ffb020'], art: true,
    symbol: '<circle cx="12" cy="8" r="4"/><ellipse cx="12" cy="20" rx="6" ry="1.5"/>', // a ball over its shadow
  },
  {
    id: 'wood', v: 1, mode: 'dark', name: { en: 'Wood', zh: '木纹' }, chrome: '#2b1d14',
    layout: STANDARD, swatches: ['#2b1d14', '#3a281c', '#d4a017', '#a4281f'], art: true,
    symbol: '<ellipse cx="12" cy="12" rx="9" ry="8"/><ellipse cx="12.5" cy="12" rx="5.5" ry="4.8"/><circle cx="13" cy="12" r="1.4"/>', // growth rings
  },
];

export const BUILTIN_IDS = CATALOG.filter(t => t.builtin).map(t => t.id);
export const getTheme = id => CATALOG.find(t => t.id === id) ?? null;
// The shared brand mark (the variety-Z) of a theme's mode; a theme whose art.js has a `mark` shows that one instead.
export const markUrl = theme => BRAND_MARK[theme.mode];
