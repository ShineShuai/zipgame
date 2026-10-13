// Board geometry: which cells touch, and how far apart two cells are. Two kinds of board:
//   grid   (p.wrap falsy): edges stop at the border; distance = Manhattan, |dr| + |dc|.
//   torus  (p.wrap true, Wrap-around variant, n >= 3): the right edge of the last column joins the
//          first column, the bottom edge of the last row joins the first row. Distance per axis is
//          the shorter way round, min(|d|, n - |d|).
// Directions d: 0 right, 1 left, 2 down, 3 up. d ^ 1 is the opposite direction (the solver's
// neighbour table, prune.js buildNeighbors(), relies on it).
export const DR = [0, 0, 1, -1];
export const DC = [1, -1, 0, 0];

// The cell next to cell i in direction d, or -1 when there is none.
// Walls and holes are not looked at.
export function neighbourCell(n, wrap, i, d) {
  let r = ((i / n) | 0) + DR[d];
  let c = (i % n) + DC[d];
  if (wrap) {
    r = (r + n) % n;
    c = (c + n) % n;
  } else if (r < 0 || r >= n || c < 0 || c >= n) {
    return -1;
  }
  return r * n + c;
}

// Fewest moves between cells a and b, walls and holes ignored.
export function gridDist(n, wrap, a, b) {
  let dr = Math.abs(((a / n) | 0) - ((b / n) | 0));
  let dc = Math.abs((a % n) - (b % n));
  if (wrap) {
    dr = Math.min(dr, n - dr);
    dc = Math.min(dc, n - dc);
  }
  return dr + dc;
}

// Distance function over cell indices, using the solver's row / col tables (buildNeighbors()).
export function distFn(n, wrap, row, col) {
  return (a, b) => {
    let dr = Math.abs(row[a] - row[b]);
    let dc = Math.abs(col[a] - col[b]);
    if (wrap) {
      dr = Math.min(dr, n - dr);
      dc = Math.min(dc, n - dc);
    }
    return dr + dc;
  };
}

// Are a and b one move apart (ignoring walls)?
export const adjacent = (n, wrap, a, b) => gridDist(n, wrap, a, b) === 1;

// Does every move change the checkerboard colour? Then the length of any path between two cells has
// the parity of their distance, which the solver's parity check relies on. A torus with odd n has
// odd cycles (a row of 3 wraps back to itself), so it is not bipartite.
export const bipartite = (n, wrap) => !wrap || n % 2 === 0;
