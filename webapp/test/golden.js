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
  [7, 2, '53673ff6'],
  [7, 3, 'bb877728'],
  [8, 1, '96861e17'],
  [9, 1, '44cddce7'],
  [10, 1, 'fb3c57a3'],
  [11, 1, '7156b042'],
  [12, 1, 'feb16f8a'],
];
