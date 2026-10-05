# Difficulty tools

All tools read the SAME label files, both stored in git:
- `tools/ratings.json` — `[{ "key": puzzle text, "human": 2.75, "lo": 2, "hi": 3, "unsure": true? }]`. `lo`/`hi` = the range you stated,
  `human` = the number a model is fitted to (the midpoint, moved halfway toward the end you said it was "close to"), `unsure` = only
  written when true; a fit counts such a rating at weight 0.5 (`UNSURE_WEIGHT` in `src/core/ratings-io.js`).
- `tools/pairs.json` — `[{ "a": key, "b": key, "cmp": "harder" | "easier" | "same" }]`, `cmp` describes B relative to A
  ("this puzzle is harder than the previous one"). Pairs do not depend on what a "2" meant on the day, and are scored by RANKING accuracy.

Formats live in `src/core/ratings-io.js` and `src/core/pairs-io.js`. The design app's **Export / Import ratings.json** and
**Export / Import pairs.json** buttons (under "Correlation with your ratings") read and write exactly these files.

## Writing ratings in difficulty_rate.txt
A comment line BEFORE each puzzle block. Preferred form (parts in any order):

    human 2, range 2-3
    human 2.5, range 2-3, unsure
    range 3-5            (human = the midpoint, 4)
    human 4              (an exact rating)

Older forms are still read, with the same numbers as before: `this is 2`, `this is 2 or 3` (2.5), `this is 2 or 3, close to 3` (2.75),
`this is at least 3, close to 4 or 4` (human 4, range 3-5), `this is at least 4` (human 4, range 4-5), `this is at most 1` (human 0.5,
range 0-1), plus chatter such as `you graded as 3`, `not 4`, `instead of 3`. Anything else is an error, never a guess.

## Tools
| tool | what it does |
|---|---|
| `parse-ratings.mjs` | `difficulty_rate.txt` -> ratings JSON. Only NEW puzzles are read; **duplicates are reported, never skipped silently** (see below); `--check-labels` lists old comments whose parsed rating differs from the JSON. |
| `check-ratings.mjs` | Validates `ratings.json` and `pairs.json`: bad rows, exact duplicates (error), equivalent puzzles (warning, drawn as ASCII with their ratings), pairs that contradict your ratings. Exit 1 on errors. `npm test` runs it too. |
| `metrics-eval.mjs` | **Compare everything.** Per metric Spearman rho + bootstrap CI + rho after removing size; whole grading models under leave-one-out, a chronological holdout, the ladder grade's own constants, and (Part 5) **ranking accuracy** on pairs implied by your ratings and on `pairs.json`. Start here after adding labels. `--cap N` sets the reference-solve node cap (default 1e6; the app's own 9000 hides 15 of the rated puzzles). |
| `fit-trap.mjs` | Refit the trap grade's weighted ridge (`--write` rewrites the `<TRAP_MODEL>` block in `src/core/trap.js`; unsure ratings count 0.5). Same `--cap N`. |
| `ladder-eval.mjs` | Ladder details per rated puzzle (hardest level, passes per level, ms) and `--gen` soundness/timing check on generated puzzles. |
| `weighted.mjs` | Exploratory composites of ladder outputs vs the ratings. |
| `features.mjs` | Library: every metric of a puzzle in one object (`featuresOf`), shared by `metrics-eval`, `gotd-fit` and `gotd-seed`. |
| `gotd-fit.mjs` | Fits every metric / grade to `ratings.json` and ranks them -> `tools/gotd-models.json` (see below). |
| `gotd-seed.mjs` | Seeds a Game of Day with 3..8 synthetic players on every configured backend (see below). |
| `print-bin-edge.mjs` | The Turso table `bin_edge` (histogram bins of `src/core/hist.js` as integer ms ranges): prints it, `--write` puts it into `server/turso/schema.sql`, `--check` exits 1 when that file is stale. Run `--write` after changing `NB`, `T0_MS` or `RATIO` (`server/README.md`, "Changing the histogram bins"). |
| `tune-gen.mjs` | Generator quality/time knobs on paired seeds: `--sizes 8,10,12 --seeds 8 --check-cap-x 0.25,0.5,1 --candidates-x 1,2 --refine-x 0,1,2 [--freed-edge | --no-freed-edge]` prints mean walls and mean ms per combination (see `generate.js` CHECK_CAP_X, PROP_CAP_X, CANDIDATES, REFINE_NODES_PER_CELL). |
| `calibrate.mjs` | Recompute the quantile cut points of the legacy grades on generated puzzles (`calibration.js`); these are calibrated to the generator, not to human ratings. |

## Game-of-Day seed players
`.github/workflows/gotd-seed.yml` runs `gotd-seed.mjs` every evening for the next day's puzzle in `../demo/GameOfDay/`, so the first real players already see averages and a percentile.
- `gotd-fit.mjs` maps every metric to the human 0-5 scale (`h = a + b*f(x)`, `f` = identity or log; integer grades may use the mean rating per grade) and ranks them by **skill** = 1 - leave-one-out MAE / MAE of always predicting the mean, on the rows where the metric exists (solver metrics are undefined where the reference solve was capped). A candidate is dropped when: its skill is <= .02; a `grade:*` metric's own grades are not rated in increasing order (grade 3 rated easier than grade 2); its leave-one-out predictions rank the puzzles against the ratings (Spearman <= 0); a better one comes from the same metric (`grade:B` / `B/N`) or ranks the puzzles almost identically (|Spearman| >= .95). Every dropped candidate is listed with its reason in `gotd-models.json`. `top3` / `top10` in the output = how often a candidate lands there in 200 bootstrap fits: ranks with a low `top3` are noise. Trap and ladder keep their own fits (`fit-trap.mjs`, `ladder.js`); size `n` is not a candidate (the time model handles size).
- `gotd-seed.mjs`: the first 3 defined candidates of the day play, of the next 7 the lowest and highest `h` are dropped (3..8 players). The production grade (Play badge, `trapPredicted` unrounded) always plays: if it is not among the first 3 it takes the third place. Candidates behind the top 3 need skill >= 0.10 (`EXTRA_MIN_SKILL`; the bootstrap sd of the skill is 0.06-0.10, printed as `+-sd`). The output explains every selected name and prints the time at grade 0..5 for each. `h` -> time: `ln(median) = alpha + gamma*ln(N^2/49) + c*(h-1.5)`, a Bayesian regression over the backends' last 45 days (combined like the stats page: copies on the replicated days, sums on the others; real players only, seeds subtracted, days with >= 5 real players, `h` = the unrounded trap prediction); without data the prior in `src/core/gotd-model.js` applies (guesses, not measurements: 60 s at 7x7 / h 1.5, time ~ cells, time x2 per grade; a day only counts with >= 20 real players). Plays faster than the drawing floor, 0.5 s per cell (`FLOOR_S_PER_CELL`), are replays, not first solves: they are left out of the calibration and no seed player is faster; this applies to puzzles larger than 6x6 and to grade >= 1., and the printed `+-` shows how far the data has taken over.
- After changing `ratings.json` (and `fit-trap.mjs --write`): `node tools/gotd-fit.mjs`, commit `gotd-models.json`; `node tools/gotd-fit.mjs --check` tells whether it is stale. Real run by hand: `node tools/gotd-seed.mjs --day YYYYMMDD --token-file FILE` (FILE holds the shared secret `SEED_PLAYERS_SECRET`, see `server/README.md`; `--print-supabase-sql` prints the statement that gives each Supabase project its hash; `--only ID` seeds one backend of `src/config.js`). Dry run for a day: `npm run gotd:seed -- --day YYYYMMDD` (add `--stats cf.json` to use a saved `/stats` reply instead of fetching).

## Duplicates
The same puzzle rated twice counts twice in every fit, and a rotated / mirrored / reversed-numbering copy is the same puzzle to the solver.
- **exact** (identical puzzle): different ratings = error (exit 1, nothing written), same rating = warning and the first copy is kept.
- **equivalent** (same up to the 8 rotations/reflections of the board and reversing the numbering K..1): listed with locations, ratings and a
  picture; `--strict` makes them errors. A deliberate re-rating of the same puzzle is a useful noise check, so this is a warning by default.
- In the design app: a warning appears under the rating buttons when the puzzle you are rating is an equivalent copy of a rated one,
  and **Find duplicates** lists every group with a picture and a delete button per rating.

## After adding labels
1. Rate in the design app (range / unsure / pairwise buttons) and **Export** the files, or append puzzles to `difficulty_rate.txt`:
   `node tools/parse-ratings.mjs difficulty_rate.txt --base tools/ratings.json --out tools/ratings.json`
   (`--out` may be the base file itself; never use `>` onto it, the shell truncates it before it is read).
   **Import ratings.json** loads the repo file into a fresh browser and regrades every puzzle with the current code.
2. `node tools/check-ratings.mjs` — fix what it lists.
3. `node tools/metrics-eval.mjs` — which metric/grade is best now, and is the ladder still holding on the newest puzzles?
4. Trap grade: `node tools/fit-trap.mjs` to look, `--write` to apply, then `npm test`.
5. Ladder grade: Part 4 of `metrics-eval` shows whether `tWf` / `tTrials` in `ladder.js` `grade()` should move; change them by hand there.
6. Commit `tools/ratings.json` (and `tools/pairs.json`) together with the change.
