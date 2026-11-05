# zigzag Puzzle Designer

A browser tool to build, generate, solve, grade and export puzzles of every type. It is a development
tool: the test site (GitHub Pages) publishes it, production does not. The code is in
[`webapp/src/apps/design/`](webapp/src/apps/design/), the page is [`webapp/design.html`](webapp/design.html).
The puzzle rules, the types and the generators are described in the [README](README.md); this file covers
what the designer adds on top.

Serve the repository root over HTTP and open `/webapp/design.html`:

```sh
python3 -m http.server 8000        # or: npx serve .
```

## Types and boards

- **Grid size** 4 × 4 to 12 × 12.
- **Puzzle type**: Standard, Cutout, One way arrows, Wrap-around, Exact, Loop, Teleport pairs, Two paths,
  Pentagon, and the solids Tetrahedron, Cube and Ball. A solid has its own *Size*, is shown as a solid you
  can turn (**3D**, the default, with *Follow head* turning it after your path) or as an assist (**Net** of a
  tetrahedron or cube, the two halves of a ball). Pentagon is a flat board with nothing to turn.
- **Tools** depend on the type: *Numbers* and *Walls* everywhere, plus *Arrows* (One way arrows), *Holes*
  (Cutout) and *Portals* (Teleport pairs). For Two paths a *Number colour* (red or blue) is chosen first.
  A hole removes the walls around its cell and never carries a number. Solid and Pentagon boards are edited
  by the same tools on their cell graph (`surface.js`).

## Generators

Every generator uses the **Seed** field above the board, so the same seed gives the same puzzle on every
machine. All of them look for puzzles with exactly one solution.

- **Unique puzzle generator** (Standard and the flat types): *Max checkpoints*, *Max walls* and *Search
  retries*. Every retry draws a new random path and a new checkpoint placement. *Pick max nodes* uses all
  retries to collect candidates and keeps the one whose solve needs the most search nodes. The search is
  heuristic: a failed run does not prove that no puzzle exists.
- **Random** buttons build the parts by hand: checkpoint *Placement*, a Hamiltonian *Path* with
  checkpoints, *Random* walls (never on the path) and *Minimize*, which removes every wall that is not
  needed for uniqueness. *Clear walls* and *Reset board* undo them.
- **One way arrows**: *Candidates* and *Generate arrows*, then *Minimize*.
- **Cutout**: *Outline* (any, square, octagon, L, cross, T, U, H), *Holes inside*, a *Target grade* and a
  *Time cap*. To design on a board of your own, cut the holes with the *Holes* tool and use *Path* or
  *Generate*: both keep the holes and need a board that a path can cover (the checkerboard rule; the
  designer says why a board cannot be covered).
- **Exact**: *Min numbers* and *Candidates*. Exact puzzles have no walls; the numbers alone make the path
  unique.
- **Target difficulty**: searches for a unique puzzle whose grade equals the target (0 easy to 5 hardest).
  It starts from a generated puzzle and keeps every wall or checkpoint change that moves the score towards
  the band of the target grade; *Search effort* and *Retries* are counts, not seconds, so the same seed
  gives the same puzzle everywhere. If the target is missed, the closest puzzle is shown with the grade it
  reached. Grades 4 and 5 and bigger boards take longer.
- **Reproduce Play puzzle**: paste a seed from the Play app to get its exact puzzle. For One way arrows,
  Wrap-around, Exact, Loop and Teleport it runs that type's own Play generator (seed only).
- Solids and Pentagon have their own *Generate* and *Minimize walls* on the cell graph. A tetrahedron needs
  few or no walls, a cube needs them.

## Algorithm flags and comparison

A Standard generation makes solver calls in three phases, and each phase can use a different set of
solver checks (the options described under *Solver algorithms* in the [README](README.md)):

| Phase | Solver calls |
| --- | --- |
| build | making the puzzle unique (adding walls) |
| minimize | the check of every wall removal |
| score | scoring the candidates, and the plain *Solve* button |

The flags panel above the board sets `prop`, `legCollide`, `pocket`, `parity`, `prune2` and `seg` (off,
next leg, all legs) per phase, the path builder (`warnsdorff` or `backbite`) and the checkpoint
placement (`gap` or `random`). Everything packs into one integer, shown as a hex field, so a run can be
reproduced from a seed and that number (`webapp/src/core/gen/flags.js`). The default is `prop` on and
everything else off, which is what the Play app uses.

**Compare A / B** runs the generator twice at the same seed, once with the flags of side A and once with
side B, and reports the total time and the number of `solve()` calls of both. It is an honest comparison
up to the first point where the two runs behave differently; after that the random sequences can diverge,
so later attempts do not necessarily line up. `legCollide` and `seg: 'all'` are the checks worth trying
this way: one-off tools for a stuck position or a hand-built puzzle where `prop` alone does not resolve it,
not defaults.

## Solving and difficulty

- **Solve** shows up to two solutions and tells you whether the puzzle is unique. The *search limit* caps
  the nodes the solver may visit; the number of nodes it needs is itself a measure of the puzzle's
  difficulty. It uses the score-phase flags (side A when comparing).
- **Difficulty** (*Compute diagnostics*, on demand, never on every edit) shows every diagnostic of one
  puzzle at once. The **trap grade** is the Play app's badge grade: the solver finds the solution, then for
  every wrong turn along it measures how many solver nodes are needed to refute that turn, and maps the
  worst steps to 0-5 with weights fitted to hand-rated puzzles (`webapp/tools/ratings.json`, fitted with
  `webapp/tools/fit-trap.mjs`, so a refit moves the grade bands automatically). *Show* draws a trap on the
  board. Below it are the other calibrated grades and their raw metrics, all from one reference solve. The
  panel states its own known limits; read them before trusting a number.

## Play and data

- **Play** tests the puzzle in place. The optional *Highlights* panel (Connectivity, Dead ends, Forced
  edges, Leg collisions, Checkpoint graph) shows live what the solver's own checks already know about the
  current position.
- **Export** copies a plain-text description to the clipboard, optionally with the current path
  (*Include current path*); **Import** replaces the board from such text and can also load its path into
  Play (*Also load path into Play mode*).

### Puzzle text format

The keywords are listed in the [README](README.md#puzzle-text-format). In an export, lines starting with
`#` are comments that name each keyword, and the puzzle follows:

```
size 5
checkpoints 1,3=5 2,0=4 2,3=3 2,4=1 4,2=2
walls H,1,1 H,3,1
```

An optional `path r,c ...` line records a specific line through the grid, in order, with the same `r,c`
coordinates, for example the line walked so far in Play:

```
path 0,0 0,1 0,2 1,2 1,1 1,0 2,0 2,1 2,2
```

Puzzles without one parse exactly as before. When present, each step must be grid-adjacent to the last,
cross no wall and visit no cell twice, or `parse` rejects the file. For Two paths the line lists the red
path followed by the blue one. The solids and Pentagon export their own cell-graph text
(`webapp/src/core/surface/puzzle.js`).

## Code map

| File | What |
| --- | --- |
| `main.js` | the page: controls, generators, solver, play, export and import for the flat types |
| `board.js` | drawing of the flat board: walls, arrows, holes, portals, paths, both Two paths colours |
| `holes.js` | cutting holes and why a cut board cannot be covered; runs without a page |
| `surface.js`, `surface-board.js` | the controller and picture for solids and Pentagon (shared view in `view/surface-board.js`) |
| `k-field.js` | what the Checkpoints field of the solids shows after the board changes |
| `flags-panel.js` | the per-phase algorithm flags and the hex field |
| `compare.js`, `compare-view.js` | Compare A / B: two runs at one seed, and their report |
| `difficulty-panel.js` | the on-demand difficulty diagnostics |

The designer's parts that need no page are tested in Node (`webapp/test/design-*.js`).
