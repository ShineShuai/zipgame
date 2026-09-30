# Difficulty tools

All tools read ONE label file, `tools/ratings.json` (the copy stored in git):
`[{ "key": puzzle text, "human": 2.75, "lo": 2, "hi": 3 }, ...]` — `lo`/`hi` = the range you stated ("2 or 3"), `human` = the number a
model is fitted to (midpoint, moved 0.25 toward the end you said it was "close to"). The format lives in `src/core/ratings-io.js`;
the design app's **Export ratings.json / Import ratings.json** buttons (under "Correlation with your ratings") read and write exactly it.
Do not let a tool parse the text file on its own: `ladder-eval.mjs`'s old text parser read 7 of the first 70 labels differently, which
made results from different tools incomparable.

| tool | what it does |
|---|---|
| `parse-ratings.mjs` | `difficulty_rate.txt` -> ratings JSON. Only NEW puzzles are parsed (comment must be `this is N`, `this is N or M`, or `this is N or M, close to C`); anything else is an error, never a guess. |
| `metrics-eval.mjs` | **Compare everything.** One row per metric (legacy solver, spatial, trap, ladder, puzzle shape) with Spearman rho + bootstrap CI + rho after removing size; then whole grading models under leave-one-out, a chronological holdout, and the ladder grade's own constants (sweep + nested re-tuning). Start here after adding ratings. |
| `fit-trap.mjs` | Refit the trap grade's ridge weights (`--write` rewrites the `<TRAP_MODEL>` block in `src/core/trap.js`). |
| `ladder-eval.mjs` | Ladder details per rated puzzle (hardest level, passes per level, ms) and `--gen` soundness/timing check on generated puzzles. |
| `weighted.mjs` | Exploratory composites of ladder outputs vs the ratings. |
| `calibrate.mjs` | Recompute the quantile cut points of the legacy grades on generated puzzles (`calibration.js`). These grades are calibrated to the generator's distribution, not to human ratings. |

## After adding ratings
Either route ends in `tools/ratings.json`:
- **In the design app:** rate puzzles (a range is allowed), then **Export ratings.json** and replace `tools/ratings.json`
  with the download. Or the other way round: **Import ratings.json** loads the repo file into a fresh browser and regrades every
  puzzle with the current code (a rating in the file replaces the browser's rating for the same puzzle).
- **From the text file:** append the puzzles to `difficulty_rate.txt` (comment line before each puzzle), then
  `node tools/parse-ratings.mjs difficulty_rate.txt --base tools/ratings.json --out tools/ratings.json`
  (`--out` may be the base file itself; never use `>` onto it, the shell truncates it before it is read).

Then:
1. `node tools/metrics-eval.mjs` — which metric/grade is best now, and is the ladder still holding on the newest puzzles?
2. Trap grade: `node tools/fit-trap.mjs` to look, `--write` to apply, then `npm test`.
3. Ladder grade: Part 4 of `metrics-eval` shows whether `tWf` / `tTrials` in `ladder.js` `grade()` should move; change them by hand there.
4. Commit `tools/ratings.json` together with the change.
