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
| `metrics-eval.mjs` | **Compare everything.** Per metric Spearman rho + bootstrap CI + rho after removing size; whole grading models under leave-one-out, a chronological holdout, the ladder grade's own constants, and (Part 5) **ranking accuracy** on pairs implied by your ratings and on `pairs.json`. Start here after adding labels. |
| `fit-trap.mjs` | Refit the trap grade's weighted ridge (`--write` rewrites the `<TRAP_MODEL>` block in `src/core/trap.js`; unsure ratings count 0.5). |
| `ladder-eval.mjs` | Ladder details per rated puzzle (hardest level, passes per level, ms) and `--gen` soundness/timing check on generated puzzles. |
| `weighted.mjs` | Exploratory composites of ladder outputs vs the ratings. |
| `calibrate.mjs` | Recompute the quantile cut points of the legacy grades on generated puzzles (`calibration.js`); these are calibrated to the generator, not to human ratings. |

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
