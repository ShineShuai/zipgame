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

// Teleport pairs (puzzle.portals = [[a, b], ...], cells a and b linked, in no order). A portal
// edge
// joins its two cells like a grid edge does, but is never a wall's place. The solver's neighbour
// table (prune.js buildNeighbors) holds it in the extra slots 4 and 5 of each cell: the lower cell
// of a pair has the edge in slot 4, the higher in slot 5, so that d ^ 1 still gives the same edge
// seen from the other end.
export const PORTAL_SLOTS = 6;

// The cell linked to `cell` by a portal, or -1.
export function portalPartner(portals, cell) {
  if (portals) {
    for (const [a, b] of portals) {
      if (a === cell) return b;
      if (b === cell) return a;
    }
  }
  return -1;
}

// Are a and b the two ends of one portal pair?
export function isPortalPair(portals, a, b) {
  if (portals) {
    for (const [x, y] of portals) {
      if ((x === a && y === b) || (x === b && y === a)) return true;
    }
  }
  return false;
}

// Fewest moves between every two cells over the board's edges and its portals, walls ignored (a
// wall
// only makes a route longer, so this is a lower bound of the real distance). dist[a * T + b].
// The Manhattan distance of gridDist() is no lower bound any more once a portal shortens a route.
export function graphDistances(n, wrap, portals) {
  const T = n * n;
  const dist = new Int32Array(T * T).fill(-1);
  const queue = new Int32Array(T);
  for (let source = 0; source < T; source++) {
    const row = source * T;
    let head = 0;
    let tail = 0;
    dist[row + source] = 0;
    queue[tail++] = source;
    while (head < tail) {
      const u = queue[head++];
      const around = [];
      for (let d = 0; d < 4; d++) {
        const v = neighbourCell(n, wrap, u, d);
        if (v >= 0) around.push(v);
      }
      const partner = portalPartner(portals, u);
      if (partner >= 0) around.push(partner);
      for (const v of around) {
        if (dist[row + v] < 0) {
          dist[row + v] = dist[row + u] + 1;
          queue[tail++] = v;
        }
      }
    }
  }
  return dist;
}

// Does every move still flip the checkerboard colour once the portals are added? Only a portal
// between two cells of different colour (odd Manhattan distance) keeps a grid bipartite. The
// solver's parity rule needs it.
export function portalsBipartite(n, portals) {
  if (!portals) return true;
  return portals.every(([a, b]) => gridDist(n, false, a, b) % 2 === 1);
}

