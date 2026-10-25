// The layout presets css/layouts.css defines (each theme's catalog entry picks one per axis). The app owns the list:
// a theme naming a key this build does not know gets the default (so a newer theme never breaks an older app).
export const LAYOUT = {
  menu: ['dashboard', 'stack', 'bento'],
  picker: ['tiles', 'list'],
  actions: ['side', 'bar'],
};
export const DEFAULT_LAYOUT = { menu: 'dashboard', picker: 'tiles', actions: 'side' };

// A layout object with every axis present and known.
export const cleanLayout = raw => Object.fromEntries(Object.entries(LAYOUT)
  .map(([axis, keys]) => [axis, keys.includes(raw?.[axis]) ? raw[axis] : DEFAULT_LAYOUT[axis]]));
