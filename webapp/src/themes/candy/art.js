// Art of the candy theme (loaded only while the theme is in the player's pool). Imported from
// assets/design/zigzag-12-candy.html; colours are tokens (css/themes/candy.css), never hex, so a theme's palette
// stays in one file. Icons are the inside of a 48x48 viewBox; the facade (src/apps/play/icons.js) adds the <svg>.
// Not drawn here (they fall back to the classic icons in the theme's colours): lucky, tetra, cube, ball.
export default {
  id: 'candy',
  mark: `<svg viewBox="0 0 96 96" role="img" aria-label="zigzag mark"><rect width="96" height="96" rx="30" fill="#6a4cf0"/><polyline points="16,16 80,16 80,48 16,48 16,80 80,80" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="8" fill="#ffc531"/><circle cx="80" cy="80" r="8" fill="#e8384f"/></svg>`,
  icons: {
    standard: `<path d="M21 9H27A12 12 0 0 1 39 21V27A12 12 0 0 1 27 39H21A12 12 0 0 1 9 27V21A12 12 0 0 1 21 9Z" fill-rule="evenodd" fill="var(--ic-1)"/>`,
    cutout: `<path d="M21 9H27A12 12 0 0 1 39 21V27A12 12 0 0 1 27 39H21A12 12 0 0 1 9 27V21A12 12 0 0 1 21 9ZM22.8 18H25.2A4.8 4.8 0 0 1 30 22.8V25.2A4.8 4.8 0 0 1 25.2 30H22.8A4.8 4.8 0 0 1 18 25.2V22.8A4.8 4.8 0 0 1 22.8 18Z" fill-rule="evenodd" fill="var(--ic-2)"/>`,
    arrows: `<path d="M4 18L23 18L23 7L44 24L23 41L23 30L4 30Z" fill="var(--ic-4)"/>`,
    exact: `<circle cx="24" cy="24" r="17" fill="var(--ic-3)"/><polyline points="17,17 31,17 22,33" fill="none" stroke="var(--ic-paper)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    wrap: `<path d="M24 11H24A11 11 0 0 1 35 22V26A11 11 0 0 1 24 37H24A11 11 0 0 1 13 26V22A11 11 0 0 1 24 11Z" fill-rule="evenodd" fill="var(--ic-1)"/><path d="M1 18L10 24L1 30Z" fill="var(--ic-2)"/><path d="M37 18L46 24L37 30Z" fill="var(--ic-2)"/>`,
    loop: `<polyline points="32.36,14.04 34.65,16.54 36.22,19.55 36.95,22.87 36.8,26.26 35.78,29.49 33.96,32.36 31.46,34.65 28.45,36.22 25.13,36.95 21.74,36.8 18.51,35.78 15.64,33.96 13.35,31.46 11.78,28.45 11.05,25.13 11.2,21.74 12.22,18.51 14.04,15.64 16.54,13.35 19.55,11.78" fill="none" stroke="var(--ic-2)" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M28.01 8.71L17.33 5.68L21.78 17.89Z" fill="var(--ic-2)"/>`,
    teleport: `<circle cx="24" cy="24" r="15" fill="none" stroke="var(--ic-4)" stroke-width="6.4"/><circle cx="24" cy="24" r="5.5" fill="var(--ic-3)"/>`,
    twopaths: `<path d="M9 9L37.4 9L9 37.4Z" fill="var(--ic-3)"/><path d="M39 10.6L39 39L10.6 39Z" fill="var(--ic-1)"/>`,
    pentagon: `<path d="M24 6L42.07 19.13L35.17 40.37L12.83 40.37L5.93 19.13Z" fill="var(--ic-1)"/>`,
    solids: `<path d="M24 6L5 39L24 39Z" fill="var(--ic-2)"/><path d="M24 6L43 39L24 39Z" fill="color-mix(in srgb, var(--ic-2) 70%, #000)"/>`,
  },
  // The flat board, in CELL units (60 = one cell); the defaults are today's constants in apps/play/board.js.
  board: { grid: 'tiles', tileRx: 0.267, tileInset: 0.083, tileEdgeW: 0.017, depth: 0, plateRx: 0, pathW: 0.3, cap: 'round', join: 'round', gradient: false, wallW: 0.117, wallCap: 'round', num: 'disc', numR: 0.267, numRingW: 0, fx: null },
};
