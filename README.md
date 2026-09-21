# Zip

A browser puzzle game, a puzzle designer, and the generator and solver behind them. The app lives in
[`webapp/`](webapp/) as plain ES modules: no build step, no runtime dependencies.
[`index.html`](index.html) is the project's home page for players, in English and 中文, with a link to play.

<!-- Once the repo URL is known:
![CI](https://github.com/<owner>/<repo>/actions/workflows/webapp-ci.yml/badge.svg)
-->

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
  whose solve needs the most search nodes.
- **Minimize** removes every wall that is not needed for uniqueness.
- **Solve** shows up to two solutions and tells you whether the puzzle is unique. The *search limit*
  caps the nodes the solver may visit.
- **Play** tests the puzzle in place. **Export / Import** use the text format below.

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

The solver (`webapp/src/core/solver/solve.js`) is a depth-first Hamiltonian-path search with dead-end
and connectivity pruning, plus forced-edge propagation (`prop`, on by default in generation). Its
`nodeCap` bounds every search.

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
