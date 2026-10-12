// Golden puzzles: [size, seed, hash of serialize(generate(size, seed))] for the current ALGO_VERSION.
// Any change to the generator, the solver's node counts (through node caps) or the RNG stream shows up
// here first. If the change is intended, bump ALGO_VERSION (src/core/model.js) and replace this list
// with the output of `npm run golden`.
// Covers every play size except 16, which takes about 12 s to generate.
export const GOLDEN = [
  [5, 1, '5a3811fa'],
  [5, 2, 'f99c59a4'],
  [5, 3, '1764cba1'],
  [5, 4, '443e611d'],
  [5, 5, '368f9f21'],
  [5, 6, '4d5c7de1'],
  [6, 1, '9142cdac'],
  [7, 1, '0444f32b'],
  [7, 2, '58885d44'],
  [7, 3, 'dbb4b1e3'],
  [8, 1, 'a283556f'],
  [9, 1, 'd83a527d'],
  [10, 1, 'd8ec14ac'],
  [11, 1, '2977d67f'],
  [12, 1, 'f533be80'],
];

// Golden puzzles of the Play app's generator: [size, seed, hash of serialize(generatePlay(size, seed))]. They depend on the grade model
// (TRAP_MODEL, refitted by tools/fit-trap.mjs --write) as well as on the generators: after a refit, or an edit of gen/target.js or
// gen/play.js (PLAY_TARGET), replace this list with the output of `npm run golden`. A refit needs no ALGO_VERSION bump: a game's puzzle
// is stored on the device and carried in its share link, so only a rebuilt puzzle of an old seed differs.
// Sizes 5-9: the larger ones take seconds each.
export const GOLDEN_PLAY = [
  [5, 1, '51d9f120'],
  [6, 1, '4017bf71'],
  [7, 2, '5e586f79'],
  [8, 1, '31fbaec4'],
  [9, 1, 'cb2c7b6b'],
];
