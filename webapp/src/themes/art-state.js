// The art of the theme on screen (cleaned: see art.js), for the code that draws: variant icons (apps/play/icons.js), the board
// (apps/play/board.js) and the 3D palette (apps/play/solid.js). apply.js sets it whenever a theme is shown; null = the classic look.
let current = null;
export const currentArt = () => current;
export const setArt = art => { current = art ?? null; };

// Which 3D palette the 3D puzzles use: the one the theme's art names (a light board on a dark page says 'light'), else the page's mode.
export const solidIsDark = doc => (current?.board?.solid ? current.board.solid === 'dark' : doc.documentElement.dataset.mode === 'dark');
