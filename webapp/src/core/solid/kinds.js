// The kinds of solid board (the 3D boards). A kind is the type of a board: see the vocabulary in
// core/surface/topology.js.

export const BALL_KIND = 'ball';
// The solids with a size n (a whole number); a ball has a catalog id instead.
export const SIZED_SOLIDS = ['tetra', 'cube'];
// Every kind of solid.
export const SOLID_KINDS = [...SIZED_SOLIDS, BALL_KIND];
