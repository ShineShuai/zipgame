// The drawing floor: the least time a first solve of an n x n board can take. Drawing the path
// alone takes time (0.5 s a cell = drawing plus about as much again for thinking, a judgement),
// so a time below it is a replay or a forged time. Shared by the seed players (gotd-model.js) and
// the champion rule (champ-seal.js); a module of its own so the play app does not load the model.
export const FLOOR_S_PER_CELL = 0.5;
export const floorMs = n => Math.round(FLOOR_S_PER_CELL * 1000 * n * n);
