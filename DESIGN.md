# Zip

A browser puzzle game, a puzzle designer, and the generator and solver behind them. The app lives in
[`webapp/`](webapp/) as plain ES modules: no build step, no runtime dependencies.
[`index.html`](index.html) is the project's home page for players, in English and 中文, with a link to play.

Inspired by [Zip on LinkedIn Games](https://www.linkedin.com/games/zip/). Built entirely with Claude
Free Sonnet 5 as the AI coding assistant: no libraries, all static, just standard web technology and a
lot of algorithms and maths.

![CI](https://github.com/ShineShuai/zipgame/actions/workflows/webapp-ci.yml/badge.svg)

**The puzzle.** A grid has numbered checkpoints and some walls. Draw one path that starts on `1`,
reaches the checkpoints in ascending order, ends on the highest number, and passes through **every
cell exactly once**. Paths cannot cross a wall. Every generated puzzle has exactly one solution.

## Quick start

The pages use ES modules, so serve them over HTTP (opening the files directly does not work). From the
repository root:

```sh
python3 -m http.server 8000        # or: npx serve .
```

| URL | What |
| --- | --- |
| `/` | Home page for players, with a Play link |
| `/webapp/` | Play app |
| `/webapp/design.html` | Puzzle designer |
| `/webapp/test/` | Unit tests in the browser |
| `/webapp/bench/` | Benchmark in the browser |

GitHub Pages works the same way: publish the repository root and the home page is the site's front page.

The command line tools need Node 20 or newer and run inside `webapp/`:

```sh
cd webapp
npm test          # unit tests (about 20 s)
npm run check     # every file parses, every import and html reference resolves
npm run bench     # solver and generator benchmark (about 2 minutes)
npm run golden    # print fresh golden hashes, see "Determinism"
```

### Docker

Without Node installed, the repository root has a `Dockerfile` that runs the same commands in a
throwaway container. Run these from the repository root:

```sh
docker build -t zip-webapp .
docker run --rm zip-webapp                  # checks + unit tests (the default)
docker run --rm zip-webapp npm run bench    # benchmark
docker build --build-arg NODE_VERSION=20 -t zip-webapp:node20 .   # another Node version
```

The build context is the whole repository, so the home page is checked too. `.dockerignore` keeps
`.git` and other clutter out of the image.

## Designer

Build or edit a puzzle by hand, or start from something random and refine it.

- **Numbers / Walls** editing modes.
- **Random** checkpoint placement, Hamiltonian path with checkpoints, and walls. Random walls never
  touch the template path.
- **Generate** (with *Max checkpoints*, *Max walls* and a retry count) searches for a puzzle with a
  unique solution inside those limits. *Pick max nodes* keeps, among the candidates it finds, the one
  whose solve needs the most search nodes. *Compare leg-collision pruning* runs generation twice at the
  same random seed, once without and once with the `legCollide` solver check (see
  [Solver algorithms](#solver-algorithms)), and reports total time and solve() call counts for both.
- **Minimize** removes every wall that is not needed for uniqueness.
- **Solve** shows up to two solutions and tells you whether the puzzle is unique. The *search limit*
  caps the nodes the solver may visit; *Leg-collision pruning* optionally enables the `legCollide` check
  for that one search, to compare against the default.
- **Play** tests the puzzle in place, with an optional *Highlights* panel (Connectivity, Dead ends,
  Forced edges, Leg collisions) that shows live what the solver's own pruning checks would already know
  about the current position.
- **Export / Import** use the text format below.

## Puzzle text format

```
# Zip Puzzle — plain text format
size 5
checkpoints 1,3=5 2,0=4 2,3=3 2,4=1 4,2=2
walls H,1,1 H,3,1
```

`checkpoints r,c=n` uses 0-based row and column. `walls T,r,c` uses `T` = `H` for a wall between
`(r,c)` and `(r+1,c)` or `V` between `(r,c)` and `(r,c+1)`.

An optional `path r,c ...` line records a specific line through the grid, in order, same `r,c`
coordinates as above — for example the designer's Play mode exports the line walked so far:

```
path 0,0 0,1 0,2 1,2 1,1 1,0 2,0 2,1 2,2
```

It is entirely optional: puzzles without one parse exactly as before. When present, each step must be
grid-adjacent to the last, cross no wall, and visit no cell twice, or `parse` rejects the file.

## Solver algorithms

`webapp/src/core/solver/solve.js`, `solve(p, opts)`: depth-first search over Hamiltonian paths, one cell
at a time, backtracking on failure, checkpoints required in ascending order. `nodeCap` bounds every
search; `limit` (default 2) stops it early once that many solutions are found. Pruning cuts branches
without changing which solutions exist; ordering just changes the order they're tried.

`solve()` itself defaults every check below except dead-end and connectivity pruning to **off** — call
it with no options and you get only those two, plus the always-on Manhattan bound. Each other check is
an `opts` flag (`prop`, `pocket`, `legCollide`, `seg`, `parity`, `prune2`) the *caller* must explicitly
set to `true` to turn on for that one call, because each one changes how many nodes a search visits, and
generation's `nodeCap` values are tuned per combination (see [Determinism](#determinism)).

That is the function's own default — it says nothing about what actually happens when this codebase
calls `solve()`. In practice:

- **`prop` is on in every real call site**: the generator, `minimizeWalls`, `hints.js`, and the design
  app's Solve and Minimize buttons all explicitly pass `prop: true`. `solve()`'s own default is off, but
  every caller opts in, so in effect `prop` is always running here — "opt-in" describes the function's
  default, not the current behaviour of this application.
- **`pocket`, `seg`, `parity` and `prune2` are off everywhere**: no call site in this codebase turns
  them on. They exist as tested, working options you can pass if you call `solve()` yourself, but
  nothing here does so today.
- **`legCollide` is off by default and on only where you ask for it turn-by-turn**: the design app's
  Solver panel has a "Leg-collision pruning" checkbox for one Solve call, and the Generate panel's
  "Compare leg-collision pruning" checkbox runs generation once without it and once with it, at the same
  random seed, so the two can be compared directly (see [Designer](#designer)). Nothing turns it on
  unconditionally.

### The checks

- **Dead-end pruning** (always on) — an unvisited neighbour with 0 free neighbours is an immediate
  fail; with exactly 1, it's only legal if it's the end cell. Strongest single prune (~780× alone on
  hard boards).
- **Connectivity pruning** (always on) — flood-fill from the current cell; if the reachable count
  doesn't match the cells still needed, the board has split into unjoinable pieces. Second-strongest
  (~127× alone).
- **`prop`: forced-edge propagation** (off in `solve()`, on in every real caller — see above) — every
  unvisited cell needs exactly 2 path-edges; a cell with exactly that many open edges has them all
  forced, and forcing propagates like unit propagation in SAT. A union-find over forced edges catches a
  forced cycle or a forced head→end chain of the wrong size immediately. By far the strongest of the
  checks below — see the benchmarks for how much of the others' own benefit it already subsumes.
- **`pocket`: single-entrance pocket check** — a connected region of unvisited cells that touches the
  rest of the grid through only one edge, and does not contain a checkpoint the path still needs, is a
  dead end even when no individual cell in it has dropped to degree ≤ 1 (a corridor or a wide block can
  keep every interior cell at degree ≥ 2 throughout). Flood-fills from the current cell's neighbours,
  excluding the cell itself as an obstacle, and checks each resulting component's boundary width.
- **`legCollide`: leg-collision check** — for the remaining journey (current cell → next checkpoint →
  next → … → end), each hop ("leg") has a set of must-pass-through cells (`segBlocker`, an s–t
  vertex-cut computed via two BFS passes plus one Tarjan articulation-point pass on the induced
  subgraph). A Hamiltonian path visits every cell once, so if two different legs are both forced to use
  the same cell — other than the one checkpoint two consecutive legs share — the position is already
  unsolvable, even when every check above still says it looks fine. This is a **necessary, not
  sufficient**, condition: it can prove some infeasible positions infeasible, but a position it doesn't
  flag isn't thereby proven solvable. Not a checkpoint-*order* check — the order is fixed throughout;
  what collides is two legs' required cells. O(K²) `segBlocker` calls per node it runs on (K = remaining
  checkpoints), each proportional to the size of the free region, so it is checked last and is the one
  check here expensive enough that it can be a net loss even when it visits fewer nodes (see
  benchmarks).
- **`seg`: forward must-pass-through blocker cells** — the same `segBlocker` used by `legCollide`, but
  applied only to the immediate next leg (`seg: true`) or every remaining forward leg (`seg: 'all'`),
  and used to exclude candidate cells reserved for a later leg rather than to detect a collision.
- **Manhattan-distance bound** (always on) — skip a move if the straight-line distance to the next
  checkpoint already exceeds the cells remaining. Cheap, matters most at high checkpoint counts.
- **`parity`: bipartite slack check** — the grid is bipartite (checkerboard colour flips every move), so
  any actual path length between two cells always shares parity with their Manhattan distance, and this
  is additive across concatenated legs. So the total remaining path length must share parity with the
  summed Manhattan distance over every remaining leg; a candidate whose slack comes out odd is
  rejected before the pricier BFS bound below runs. Implemented and correctness-verified, but measured
  to reject zero candidates on this codebase's own puzzle family (`backbite`-anchored paths, checkpoints
  placed on the anchor path) at every wall fraction and checkpoint count tried — the existing bounds
  already exclude the same odd-slack branches by other means on this generator's output. Kept because
  it is cheap and correct, not because it currently measures a benefit here; a different generator or
  puzzle family could see it fire.
- **`prune2`: wall-aware BFS bound** — precomputed shortest-path distances through every remaining
  checkpoint in order; tighter than Manhattan, costs the BFS passes upfront.
- **Move ordering** — candidates tried most-constrained-first (fewest free neighbours), so dead branches
  get found and pruned sooner.

### Benchmarks

Measured on `backbite`-generated puzzles (this codebase's own generator), N = 7–12, against plain
`base` (only the two always-on checks) and against `prop` alone, since `prop` dominates every other
opt-in check on this puzzle family:

| Check (alone) | vs `base` | vs `prop` (stacked on top) |
| --- | --- | --- |
| `prop` | −89% to −99.9% nodes | — |
| `seg` (next leg only) | −6% to −50% nodes | ~0 to −2% |
| `seg: 'all'` (every remaining leg) | −13% to −50% nodes, but 10×+ slower wall-clock at N ≥ 10 | ~0 to −2%, same wall-clock cost |
| `pocket` | −12% nodes | ~−0.5% |
| `parity` | 0% (zero candidates rejected, any N/K/wall-fraction tried) | 0% |
| `legCollide` | −23% to −91% nodes, but 10×+ slower wall-clock (O(K²) cost per node) | mixed, 0% to −56% nodes, always slower wall-clock |

The pattern is consistent across every opt-in check tried: `prop`'s forced-edge propagation already
captures most of what the pricier geometric checks (`seg`, `pocket`, `legCollide`) can add on this
generator's output, so stacking them on top of `prop` is rarely worth their extra per-node cost.
`legCollide` and `seg: 'all'` remain useful as opt-in, one-off tools — comparing a specific stuck
position (the design app's Solver panel and "Compare leg-collision pruning" toggle under Generate), or
diagnosing a hand-built puzzle where `prop` alone genuinely doesn't resolve it — rather than as defaults
paired with `prop`. `npm run bench` and `webapp/bench/*.js` reproduce these numbers on your machine.

## License

[MIT](https://opensource.org/license/mit) · © 2026 Shine.
