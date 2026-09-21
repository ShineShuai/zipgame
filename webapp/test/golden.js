// Golden puzzles: [size, seed, hash of serialize(generate(size, seed))] for the current ALGO_VERSION.
// Any change to the generator, the solver's node counts (through node caps) or the RNG stream shows up
// here first. If the change is intended, bump ALGO_VERSION (src/core/model.js) and replace this list
// with the output of `npm run golden`.
// Covers every play size except 16, which takes about 12 s to generate.
export const GOLDEN = [
  [5, 1, '5a3811fa'],
  [5, 2, 'f99c59a4'],
  [5, 3, '264b96ea'],
  [5, 4, '443e611d'],
  [5, 5, '368f9f21'],
  [5, 6, '4d5c7de1'],
  [7, 1, '0444f32b'],
  [7, 2, 'b2c84176'],
  [7, 3, 'dbb4b1e3'],
  [8, 1, '903f6e76'],
  [9, 1, '55819c1a'],
  [10, 1, 'b735b069'],
  [11, 1, 'f663cc9c'],
  [12, 1, '1f49fbf3'],
];
