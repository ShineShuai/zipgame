# zigzag

A browser puzzle game, and the generator and solver behind it. The app lives in
[`webapp/`](webapp/) as plain ES modules: no build step, no runtime dependencies.
[`index.html`](index.html) is the project's home page for players, in English and 中文, with a link to play.

Play it at <https://play.vintoshine.com/zigzag/>.

Inspired by [Zip on LinkedIn Games](https://www.linkedin.com/games/zip/). Built entirely with Claude
Free Sonnet 5 as the AI coding assistant: no libraries, all static, just standard web technology and a
lot of algorithms and maths.

![CI](https://github.com/ShineShuai/zipgame/actions/workflows/webapp-ci.yml/badge.svg)

**The puzzle.** A grid has numbered checkpoints and some walls. Draw one path that starts on `1`,
reaches the checkpoints in ascending order, ends on the highest number, and passes through **every
cell exactly once**. Paths cannot cross a wall. Every generated puzzle has exactly one solution.

## Puzzle types

Standard is the base game; every other type changes one rule and has its own generator and solver.

| Type | What changes |
| --- | --- |
| Standard | The rules above, on a full square grid. |
| Cutout | The board has holes (donut, pillars, octagon, L, cross, T, U and H shapes); only the other cells are visited. |
| One way arrows | No walls; an arrow can be crossed only in the direction it points. |
| Exact | A number is the step on which the path enters its cell (the `20` is the 20th cell). |
| Wrap-around | The board edges connect: leave on one side, enter on the opposite one. |
| Loop | The path closes into a ring: the last cell touches cell `1`. |
| Teleport | Cells with matching portal icons are linked; moving between them is one step. |
| Two paths | A red and a blue path, each with its own numbers from `1`, together cover every cell. |
| Pentagon | The cells are pentagons: each touches up to five others. |
| Tetrahedron, Cube, Ball | The board is the surface of a solid you can turn; the path continues across its edges. |

Standard is open from the start. The other flat types unlock one by one as a player plays. The solids
open by date (`SOLID_RELEASE` in [`webapp/src/config.js`](webapp/src/config.js)): the smallest tetrahedron
from 2026-12-06, every tetrahedron size 7 days later, the cube after 21 days and the ball after 35.

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
| `/webapp/test/` | Unit tests in the browser |
| `/webapp/bench/` | Benchmark in the browser |

The command line tools need Node 20 or newer and run inside `webapp/`:

```sh
cd webapp
npm test          # unit, co-op and sync tests (a few minutes)
npm run check     # every file parses, every import and html reference resolves
npm run bench     # solver and generator benchmark (about 2 minutes)
npm run golden    # print fresh golden hashes, see "Determinism"
```

`npm run test:themes` tests the theme tooling and `npm run test:server` the backend code in
`webapp/server/`. More tools (rating fits, Game of the Day seeding, benchmarks) are in
[`webapp/tools/`](webapp/tools/README.md).

## Play app

- **Phones, tablets and computers.** One layout that adapts: a single column on a phone, and on a wide
  screen the board sits beside its buttons and stats. Light and dark mode, plus a collection of themes
  (`themes/`, `webapp/src/themes/`) that players collect. English and 中文, sound on or off.
- **Grid sizes** 5, 6, 7, 8, 9, 10, 11, 12 and 16 (`PLAY_SIZES`); the variants use the sizes that suit them.
- **Free play** starts today's next puzzle for the chosen type and size. Standard puzzles are
  deterministic: game *k* of size *n* on a UTC day is `generate(n, dailySeed(day, n, k - 1))`, so everyone
  gets the same puzzles in the same order, and playing one size never shifts another size's sequence.
  **New puzzle** skips ahead.
- **Game of the Day** loads `demo/GameOfDay/YYYYMMDD.txt` (the [text format](#puzzle-text-format)) from the
  same server as the play page, one attempt per day, and compares the time with other players' averages.
  If there is no file for today, there is no Game of the Day. Missed days of the last two weeks can be
  replayed, and playing every day builds a day streak.
- **Hints** in free play, and **share codes** to hand a puzzle to a friend.
- Per-type, per-size **stats** (today and all time, by UTC day), kept in `localStorage` and falling back
  to memory when storage is unavailable. **Device sync** is optional and needs no account: link two of
  your own devices directly, or use a cloud sync phrase (`webapp/src/core/sync/`, `webapp/src/platform/sync/`).
- Game of the Day averages and sync use the small backends in [`webapp/server/`](webapp/server/README.md)
  (a Cloudflare Worker, Turso and Supabase); their public endpoints are set in `webapp/src/config.js`.
- `webapp/src/coop/` holds a two-player drawing mode that is switched off until it is released; deleting
  the folder leaves the rest of the app working.

## Puzzle text format

Plain text, one keyword per line (`#` starts a comment). Game of the Day files, the tests and the tools
all use it (`webapp/src/core/format.js`): `size N`, `checkpoints r,c=n ...` (0-based row and column),
`walls T,r,c ...` (`H` spans `(r,c)-(r+1,c)`, `V` spans `(r,c)-(r,c+1)`), and for the variants `holes`,
`arrows r,c>r,c`, `exact`, `wrap`, `loop`, `split k` (Two paths) and `portals r,c~r,c`. A `path` line may
carry a solution. For example:

```
size 5
checkpoints 3,3=1 1,4=2 0,2=3 1,0=4 3,1=5
walls H,1,3 H,2,4
```

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
5. Give the winner a deeper **second look** at the walls it kept only because a check hit its node cap
   (`refineWalls`), within a budget of `REFINE_NODES_PER_CELL` solver nodes per cell.

Every step above calls the solver — see [Solver algorithms](#solver-algorithms) for what it actually
does with each search.

The other puzzle types follow the same plan (build, make unique with the solver, minimize) with their own
generators in `webapp/src/core/gen/` (`cutout.js`, `arrows.js`, `exact.js`, `loop.js`, `teleport.js`,
`twopaths.js`, `pentagon.js`; wrap-around is an option of `generate`) and `webapp/src/core/surface/gen.js`
for the 3D boards.

### Tuning

| Knob | Where | Effect |
| --- | --- | --- |
| `CANDIDATES[n]` | `generate.js` | More candidates: fewer walls, roughly proportionally more time. The keys are also the play app's grid sizes (`PLAY_SIZES`). |
| `SEED_FRACTION` | `generate.js` | Share of free edges pre-walled. Higher is faster to reach uniqueness but leaves more for minimizing. |
| `PROP_CAP_X` | `generate.js` | Node caps shrink by this factor because propagation makes each node much stronger. |

Extra *attempts* alone do not help: the wall count before minimizing predicts the final count only
weakly, and minimizing is far more expensive than an attempt, so the gain comes from minimizing
several candidates.

Current candidate counts (`CANDIDATES`); the time one puzzle takes grows roughly with the count and the
board size, and phones are slower than a development machine:

| Size | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CANDIDATES` | 64 | 64 | 64 | 64 | 64 | 32 | 32 | 16 | 8 |

`npm run bench` measures the time on your machine, including what each size gains from its candidate count.

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

- **`prop` is on in every real call site**: the generators, `minimizeWalls`, `hints.js`, the Exact generator
  and the difficulty grading all explicitly pass `prop: true`. `solve()`'s own default is off, but every
  caller opts in, so in effect `prop` is always running here — "opt-in" describes the function's default,
  not the current behaviour of this application.
- **`parity` is on for Exact puzzles and for the difficulty reference solve** (`EXACT_SOLVE` in
  `core/gen/exact.js`, `REF_FLAGS` in `core/difficulty.js`) and off everywhere else.
- **`pocket`, `seg` and `prune2` are off everywhere**: no call site in this codebase turns them on. They
  exist as tested, working options you can pass if you call `solve()` yourself, but nothing here does so today.
- **`legCollide` is off by default**: used for experiments so far. Nothing turns it on unconditionally.

The variants that change how a step works have their own searches next to `solve.js` in
`webapp/src/core/solver/` (`solve-dir.js` for One way arrows, `solve-loop.js`, `solve-two.js`), with
the same ideas (dead ends, connectivity, forced-edge propagation); the 3D boards are solved on their
cell graph in `webapp/src/core/surface/solve.js`.

### Order of checks

Two separate places in the search apply checks, each cheapest-first with short-circuiting, so an
expensive check never runs once a cheaper one has already rejected the node or the candidate:

1. **Per node**, before any candidate move is considered — rejecting here skips the candidate loop
   entirely:
   1. Dead-end pruning (always on)
   2. Connectivity pruning (always on)
   3. `prop`: forced-edge propagation (off in `solve()`, on in every real caller — see above)
   4. `pocket`: single-entrance pocket check (off everywhere — see above)
   5. `legCollide`: leg-collision check (off by default, used for experiments only — most expensive of
      all these checks, which is why it's checked last)
2. **Per candidate**, for each surviving neighbour of a node that passed step 1:

   6. `seg`: forward must-pass-through blocker cells (off everywhere — see above)
   7. Manhattan-distance bound (always on)
   8. `parity`: bipartite slack check (on for Exact puzzles and the difficulty reference solve — see above)
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
  rejected before the pricier BFS bound below runs. Measured to reject zero candidates on the standard
  puzzle family (`backbite`-anchored paths, checkpoints placed on the anchor path) at every wall fraction
  and checkpoint count tried — the existing bounds already exclude the same odd-slack branches there —
  so the standard generator leaves it off. Exact puzzles, where a number is a step, are a different
  family and turn it on.
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
| `parity` | 0% on standard puzzles (zero candidates rejected, any N/K/wall-fraction tried) | 0% |
| `legCollide` | −23% to −91% nodes, but 10×+ slower wall-clock (O(K²) cost per node) | mixed, 0% to −56% nodes, always slower wall-clock |

The pattern is consistent across every opt-in check tried: `prop`'s forced-edge propagation already
captures most of what the pricier geometric checks (`seg`, `pocket`, `legCollide`) can add on this
generator's output, so stacking them on top of `prop` is rarely worth their extra per-node cost.
`legCollide` and `seg: 'all'` remain useful as opt-in, one-off tools — comparing a specific stuck
position, or diagnosing a hand-built puzzle where `prop` alone genuinely doesn't resolve it — rather
than as defaults paired with `prop`. `npm run bench` and `webapp/bench/*.js` reproduce these numbers
on your machine.

## Complexity

zigzag is easy to state and easy to play, but the questions the code above actually answers sit in
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
- **NP-complete** — zigzag's underlying reachability problem is a checkpoint-ordered Hamiltonian path on a
  grid graph with holes (the walls). Unconstrained grid Hamiltonian path is a classic NP-complete
  problem, and numbers merely add ordering constraints on top of it, so *does a solution exist?* is
  (at least) NP-hard, and since it is also in NP, it is NP-complete. No polynomial algorithm is known,
  which is exactly why `solve.js` is DFS with pruning rather than a closed-form check, and why large
  boards (16×16) take noticeably longer per puzzle than small ones (see `npm run bench`).
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
  pruning on the roughly-square boards zigzag actually uses (5×5 up to 16×16). That is why `solve.js` is
  backtracking with dead-end, connectivity, and forced-edge pruning instead.

None of this is specific to zigzag: the same shape of question — solvable, uniquely solvable, minimally
so — recurs across constraint puzzles (Sudoku, Numberlink/Flow Free, Slitherlink), and the generator's
"propose, then ask the solver to break it" loop is the standard way to build a uniquely-solvable
instance of any of them without a direct construction.

## Determinism

Puzzles must not change for a given seed, or players would see different "same" daily puzzles.

- The RNG is a seeded generator, and `dailySeed` mixes in `ALGO_VERSION`
  (`webapp/src/core/model.js`, currently version 6).
- `webapp/test/golden.js` pins the hash of one generated puzzle per size (16 excepted, it is too slow
  for the default run).
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
├── auto_bump_version.sh            pre-commit helper that bumps a version constant
├── .pre-commit-config.yaml         hooks: version bump, data refresh, Game of the Day uniqueness
├── .github/
│   ├── workflows/                  webapp-ci.yml, prod.yml, unique-puzzles.yml, gotd-seed.yml
│   ├── scripts/                    site staging, release selection, smoke tests
│   └── dependabot.yml              weekly updates of the pinned actions
├── assets/                         images and logo, audio, UI style prototypes
├── demo/GameOfDay/                 one puzzle per day (YYYYMMDD.txt) and the uniqueness check
├── deploy/                         production hosting (Cloudflare Worker) and its README
├── themes/                         the themes' sources and tools, packed by CI (own README)
└── webapp/
    ├── index.html                  play app
    ├── css/                        styles (play.css, theme.css)
    ├── server/                     backends: Cloudflare Worker, Turso, Supabase (own README)
    ├── src/
    │   ├── version.js              the one app version
    │   ├── config.js               backends, release dates, switches
    │   ├── core/                   pure logic, no DOM
    │   │   ├── model.js            grid, seeds, ALGO_VERSION
    │   │   ├── format.js           the puzzle text format
    │   │   ├── rules.js            path/coverage/wall checks
    │   │   ├── solver/             Hamiltonian-path searches (standard and variants)
    │   │   ├── gen/                generators, one file per puzzle type
    │   │   ├── surface/, solid/    3D boards: cell graph, generator, solver, solid shapes
    │   │   ├── difficulty.js, trap.js, grades.js   difficulty grade 0-5
    │   │   └── sync/               device sync: merge, words, slices
    │   ├── features/               daily counters, streaks, replays, unlocks, hints, stats store
    │   ├── platform/               storage, leaderboard client, sync, sound, async runner
    │   ├── themes/                 theme engine
    │   ├── ui/, view/              texts (i18n), dialogs, SVG and 3D geometry
    │   ├── coop/                   two-player drawing mode (not released yet; removable)
    │   └── apps/play/              browser entry point (main.js) and board
    ├── test/                       unit tests (Node and browser), golden puzzles, check.js
    ├── bench/                      solver and generator benchmark (Node and browser)
    └── tools/                      analysis and data tools (ratings, Game of the Day, benchmarks)
```

`webapp/src/core` never touches the DOM, which is why the tests can run it in Node.

## Tests and CI

`.github/workflows/webapp-ci.yml` runs the commands inside `webapp/`. It runs on every pull request and every
push to `main` that touches the home page, `assets/`, `demo/`, `webapp/`, `themes/`, the CI scripts or the
workflow itself:

1. **Tests** on Node 20 and 22: `npm run check` (syntax, import and html-reference check, plus the home
   page's links and its two languages; the app entry points need a browser, so the unit tests never load
   them and this catches a typo'd import that would otherwise break the page), then `npm test` (unit,
   co-op and sync tests, including the golden puzzles). On Node 22 it also runs the theme tests, the
   self-test of the release selection and a dry run of the site staging.
2. **Benchmark** on `main` and on demand (Actions → Webapp CI → Run workflow). It publishes the results
   in the job summary and as an artifact, and fails if the solver's pruning options ever change the
   solutions found. Timings depend on the runner, so treat them as informational.
3. **Deploy to Pages** for a push to `main` once the tests pass (the test site, below).

`unique-puzzles.yml` checks that no two Game of the Day files hold the same puzzle, and `gotd-seed.yml`
seeds tomorrow's Game of the Day in the backends every evening (`webapp/tools/gotd-seed.mjs`).

## Deployment

Two sites are built from the same allowlist of files (`.github/scripts/stage-site.sh`):

- **Production: <https://play.vintoshine.com/zigzag/>**, a Cloudflare Worker that serves the files as static
  assets (`deploy/cloudflare/`) behind the portal Worker of the host (repo `play`). `.github/workflows/prod.yml` runs every day at 04:17 UTC and ships
  the newest commit of `main` that has been there for 7 days, if it is not live yet. Before it deploys it runs the checks and tests, requires (automatic runs) at least 10 days of Game of the Day
  puzzles ahead, and afterwards smoke-tests the live site and rolls back if that fails. It can also be run by
  hand for a given ref, for a rollback or a hotfix. The settings (repository variables `SOAK_DAYS`,
  `PROD_FREEZE` and `DRY_RUN`) and the one-time setup are in [`deploy/README.md`](deploy/README.md).
- **Test site: GitHub Pages**, published by the deploy job of the CI workflow for every push to `main`.

## Versioning

`webapp/src/version.js` holds the app version. A pre-commit hook (`.pre-commit-config.yaml`,
`auto_bump_version.sh`) bumps it whenever a commit touches the app, so do not edit it by hand.
`ALGO_VERSION` is separate: it versions the generator's output and only changes under the rules in
[Determinism](#determinism).

## License

[MIT](https://opensource.org/license/mit) · © 2026 Shine.
