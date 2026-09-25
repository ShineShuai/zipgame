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

## Play app

- **Phones, tablets and computers.** One layout that adapts: a single column on a phone, and on a wide
  screen the board sits beside its buttons and stats. Its look matches the home page.
- **Grid sizes** 5, 7, 8, 9, 10, 11, 12 and 16.
- **Play local** starts today's next puzzle for the chosen size. Puzzles are deterministic: game *k* of
  size *n* on a UTC day is `generate(n, dailySeed(day, n, k - 1))`, so everyone gets the same puzzles in
  the same order, and playing one size never shifts another size's sequence. **New puzzle** skips ahead.
- **Game of Day** loads `GameOfDay/YYYYMMDD.txt` (the [text format](#puzzle-text-format)) from the same
  server as the play page, one attempt per day. If there is no file for today it says "No game of day
  today".
- Per-size **stats** (today and all time, by UTC day), kept in `localStorage` and falling back to memory
  when storage is unavailable.

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

## Home page

`index.html` at the repository root is the front door for players: what the game is, where it runs, what
the play app offers, and in plain words how puzzles are made and solved. It links to the play app and
nowhere else, and it grows along with the project.

It is written by hand and is bilingual. Every text exists twice, side by side, and the language buttons
switch between them:

```html
<p><span lang="en">English text</span><span lang="zh">中文文本</span></p>
```

To add a section, copy an existing one and keep both languages in every element. `npm run check`
verifies that every link on the page resolves and that the two languages have the same number of texts.

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

## How puzzles are generated

`webapp/src/core/gen/generate.js`, `generate(n, seed)`:

1. Pick the checkpoint count `K` once, from a normal distribution that peaks at 30 % of the allowed
   range (`pickK`). Every candidate of the puzzle has exactly `K` checkpoints.
2. Build a **candidate**: a random Hamiltonian path (Warnsdorff walk), `K` checkpoints spaced along it
   (a new path gives a new placement), then pre-wall 40 % of the non-path edges at random
   (`SEED_FRACTION`). While the solver still finds two solutions, wall an edge that only one of them
   uses. Path edges are never walled, so the generated path stays a solution and the search ends with
   exactly one. Some attempts fail (a dead-end path, or no unique puzzle within the search limit);
   they are cheap and simply retried.
3. **Minimize** the candidate: try removing each wall once, in random order, and keep only those the
   uniqueness needs.
4. Repeat 2 and 3 until there are `CANDIDATES[n]` candidates and keep the one left with the **fewest
   walls**.

Every step above calls the solver — see [Solver algorithms](#solver-algorithms) for what it actually
does with each search.

### Tuning

| Knob | Where | Effect |
| --- | --- | --- |
| `CANDIDATES[n]` | `generate.js` | More candidates: fewer walls, roughly proportionally more time. The keys are also the play app's grid sizes (`PLAY_SIZES`). |
| `SEED_FRACTION` | `generate.js` | Share of free edges pre-walled. Higher is faster to reach uniqueness but leaves more for minimizing. |
| `PROP_CAP_X` | `generate.js` | Node caps shrink by this factor because propagation makes each node much stronger. |

Extra *attempts* alone do not help: the wall count before minimizing predicts the final count only
weakly, and minimizing is far more expensive than an attempt, so the gain comes from minimizing
several candidates.

Current candidate counts and the time one puzzle takes (Node on a development machine; browsers and
phones are slower):

| Size | 5 | 7 | 8 | 9 | 10 | 11 | 12 | 16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CANDIDATES` | 32 | 20 | 16 | 16 | 8 | 6 | 4 | 3 |
| Time per puzzle | 20 ms | 0.1 s | 0.3 s | 1.1 s | 1.4 s | 2.2 s | 3 s | 13 s |

`npm run bench` measures this on your machine, including what each size gains from its candidate count.

To add a grid size, add it to `CANDIDATES`, add a golden case for it in `webapp/test/golden.js`, and
run the tests.

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

### Order of checks

Two separate places in the search apply checks, each cheapest-first with short-circuiting, so an
expensive check never runs once a cheaper one has already rejected the node or the candidate:

1. **Per node**, before any candidate move is considered — rejecting here skips the candidate loop
   entirely:
   1. Dead-end pruning (always on)
   2. Connectivity pruning (always on)
   3. `prop`: forced-edge propagation (off in `solve()`, on in every real caller — see above)
   4. `pocket`: single-entrance pocket check (off everywhere — see above)
   5. `legCollide`: leg-collision check (off by default, on only via the comparison checkboxes above —
      most expensive of all these checks, which is why it's checked last)
2. **Per candidate**, for each surviving neighbour of a node that passed step 1:

   6. `seg`: forward must-pass-through blocker cells (off everywhere — see above)
   7. Manhattan-distance bound (always on)
   8. `parity`: bipartite slack check (off everywhere — see above)
   9. `prune2`: wall-aware BFS bound (off everywhere — see above)

Candidates that survive both stages are then move-ordered (see below) before recursing.

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

## Complexity

Zip is easy to state and easy to play, but the questions the code above actually answers sit in
several different complexity classes. This section names them precisely; see
[`index.html`](index.html) for the player-facing version of the same ideas.

- **P** — solvable in polynomial time. Checking a candidate line against the rules
  (`webapp/src/core/rules.js`) is `O(cells)`: one pass confirms the start, the ascending checkpoints,
  full coverage, and no crossed wall. Building *some* solvable puzzle is P too, since step 2 of
  generation plants a Hamiltonian path first and only hides it behind numbers afterwards — the answer
  exists by construction.
- **NP** — a yes-answer has a polynomial-size certificate that a polynomial-time verifier can check. *Does
  a solution exist?* is in NP: the certificate is the path itself, and it is exactly the same
  linear-time check as above. Solving is the hard direction; it is what `solve.js` spends its search
  budget on.
- **co-NP** — the mirror of NP: a no-answer, not a yes-answer, has the short certificate. *Is the
  solution unique?* is a co-NP-flavored question in its "no" direction: a second, different path is a
  polynomial-size certificate that uniqueness fails. There is no known equally short certificate for
  the "yes, it's unique" direction — you cannot rule out every other path without something like a
  full search.
- **NP-complete** — Zip's underlying reachability problem is a checkpoint-ordered Hamiltonian path on a
  grid graph with holes (the walls). Unconstrained grid Hamiltonian path is a classic NP-complete
  problem, and numbers merely add ordering constraints on top of it, so *does a solution exist?* is
  (at least) NP-hard, and since it is also in NP, it is NP-complete. No polynomial algorithm is known,
  which is exactly why `solve.js` is DFS with pruning rather than a closed-form check, and why large
  boards (16×16) take noticeably longer per puzzle than small ones (see the timing table above).
- **NP-hard** — some of the generator's questions have no known short certificate at all, which puts
  them at NP-hard or above rather than in NP. *What is the fewest walls that still force a unique
  solution?* is one: minimality is a property of the *whole* wall set (no removable wall exists), not
  a single path, so there is nothing polynomial-size to hand a verifier as proof. The generator does
  not attempt this optimum; step 3 (`minimize`) only reaches a *locally* irreducible set — one pass of
  single-wall removals in random order — and step 4 keeps the best of `CANDIDATES[n]` such attempts.
  "Fewest walls, guaranteed" is not on the menu; "few walls, empirically" is.
- **D^P** (Difference Polynomial time, the class of problems expressible as one NP answer minus one
  co-NP answer) — *is this puzzle solvable **and** uniquely so?* is the natural conjunction: "a
  solution exists" (NP) and "no second solution exists" (co-NP). This is precisely what the generator
  tests at every step: after each candidate wall, it asks the solver whether more than one solution
  remains, stopping the search the instant a second one turns up (`solve.js` never enumerates beyond
  two). There is no shortcut to that conjunction; it is asked freshly after every edit, which is the
  main cost driver in generation.
- **Dynamic programming** — a different axis from the classes above: a technique, not a hardness
  class, and one this codebase does not use for solving. A DP over broken profiles (sweep the grid,
  keep only how the frontier's path segments connect) can solve Hamiltonian-path-style problems in
  time exponential in the *narrower* grid dimension rather than in cell count, which beats plain
  backtracking on long, thin boards but degrades quickly as both dimensions grow — worse than DFS with
  pruning on the roughly-square boards Zip actually uses (5×5 up to 16×16). That is why `solve.js` is
  backtracking with dead-end, connectivity, and forced-edge pruning instead.

None of this is specific to Zip: the same shape of question — solvable, uniquely solvable, minimally
so — recurs across constraint puzzles (Sudoku, Numberlink/Flow Free, Slitherlink), and the generator's
"propose, then ask the solver to break it" loop is the standard way to build a uniquely-solvable
instance of any of them without a direct construction.

## Determinism

Puzzles must not change for a given seed, or players would see different "same" daily puzzles.

- The RNG is a seeded generator, and `dailySeed` mixes in `ALGO_VERSION`
  (`webapp/src/core/model.js`).
- `webapp/test/golden.js` pins the hash of one generated puzzle per size (16 excepted, it takes about
  13 s).
- Anything that changes those puzzles needs a bump of `ALGO_VERSION`. That includes changing
  `CANDIDATES`, and solver changes that only reduce node counts, because node caps decide some
  generator steps. The golden tests are the arbiter. After an intended change:

  ```sh
  # bump ALGO_VERSION in webapp/src/core/model.js, then, inside webapp/:
  npm run golden        # paste the output over the list in test/golden.js
  npm test
  ```

## Repository layout

```
.
├── README.md                       this file
├── index.html                      home page for players (English / 中文)
├── Dockerfile, .dockerignore       run checks, tests and benchmark in a container
├── .github/
│   └── workflows/
│       └── webapp-ci.yml           CI for webapp/
└── webapp/
    ├── index.html                  play app
    ├── design.html                 puzzle designer
    ├── css/
    │   ├── play.css                matches the home page
    │   └── design.css
    ├── src/
    │   ├── version.js              the one app version, shared by both apps
    │   ├── core/                   pure logic, no DOM
    │   │   ├── model.js            grid, seeds, ALGO_VERSION
    │   │   ├── edges.js
    │   │   ├── format.js           the puzzle text format
    │   │   ├── rules.js            path/coverage/wall checks
    │   │   ├── rng.js
    │   │   ├── stats.js
    │   │   ├── run.js
    │   │   ├── solver/
    │   │   │   └── solve.js        Hamiltonian-path search
    │   │   └── gen/
    │   │       ├── hampath.js
    │   │       ├── checkpoints.js
    │   │       ├── walls.js
    │   │       └── generate.js
    │   ├── features/                daily counters, hints, stats store
    │   ├── platform/                storage port, async runner (time-sliced generation)
    │   ├── view/                    SVG geometry shared by both apps
    │   ├── ui/                      modal dialog
    │   └── apps/
    │       ├── play/                browser entry point (main.js) and board
    │       └── design/               browser entry point (main.js) and board
    ├── test/
    │   ├── tests.js                 Node and browser
    │   ├── golden.js
    │   └── check.js
    └── bench/
        └── bench.js                 Node and browser
```

`webapp/src/core` never touches the DOM, which is why the tests can run it in Node.

## Tests and CI

`.github/workflows/webapp-ci.yml` sits at the repository root and runs the commands inside `webapp/`.
It runs on every push and pull request that touches `webapp/`, the home page or the workflow itself,
on Node 20 and 22:

1. `npm run check`: syntax, import and html-reference check, plus the home page's links and its two
   languages. The app entry points need a browser, so the unit tests never load them; this catches a
   typo'd import that would otherwise break the page.
2. `npm test`: unit tests, including the golden puzzles.

A **benchmark** job runs on the default branch and on demand (Actions → Webapp CI → Run workflow). It
publishes the results in the job summary and as an artifact, and fails if the solver's pruning options
ever change the solutions found. Timings depend on the runner, so treat them as informational.

## Versioning

`webapp/src/version.js` holds the app version for both pages. `ALGO_VERSION` is separate: it versions
the generator's output and only changes under the rules in [Determinism](#determinism).

## License

[MIT](https://opensource.org/license/mit) · © 2026 Shine.
