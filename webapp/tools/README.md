# Difficulty tools

All tools read the SAME labels: `tools/ratings-70.json` = `[{ key: puzzle text, human, lo?, hi? }]` (`human` = midpoint of the range
you gave, `lo`/`hi` = the range itself). Do not let a tool parse the text file on its own: `ladder-eval.mjs`'s text parser reads some
comments differently (7 of the first 70 labels differed), which made results from different tools incomparable.

| tool | what it does |
|---|---|
| `parse-ratings.mjs` | `difficulty_rate.txt` -> ratings JSON. Only NEW puzzles are parsed (comment must be `this is N`, `this is N or M`, or `this is N or M, close to C`); anything else is an error, never a guess. |
| `metrics-eval.mjs` | **Compare everything.** One row per metric (legacy solver, spatial, trap, ladder, puzzle shape) with Spearman rho + bootstrap CI + rho after removing size; then whole grading models under leave-one-out, a chronological holdout, and the ladder grade's own constants (sweep + nested re-tuning). Start here after adding ratings. |
| `fit-trap.mjs` | Refit the trap grade's ridge weights (`--write` rewrites the `<TRAP_MODEL>` block in `src/core/trap.js`). |
| `ladder-eval.mjs` | Ladder details per rated puzzle (hardest level, passes per level, ms) and `--gen` soundness/timing check on generated puzzles. |
| `weighted.mjs` | Exploratory composites of ladder outputs vs the ratings. |
| `calibrate.mjs` | Recompute the quantile cut points of the legacy grades on generated puzzles (`calibration.js`). These grades are calibrated to the generator's distribution, not to human ratings. |

## After adding ratings
1. Append the puzzles to `difficulty_rate.txt` (comment before each puzzle) or export the apps' rating log
   (`copy(localStorage.getItem('zip-difficulty-rating-log-v1'))`).
2. `node tools/parse-ratings.mjs difficulty_rate.txt --base tools/ratings-70.json > tools/ratings.json`
3. `node tools/metrics-eval.mjs tools/ratings.json` — which metric/grade is best now, and is the ladder still holding on the newest puzzles?
4. Trap grade: `node tools/fit-trap.mjs tools/ratings.json` to look, `--write` to apply, then `npm test`.
5. Ladder grade: Part 4 of `metrics-eval` shows whether `tWf` / `tTrials` in `ladder.js` `grade()` should move; change them by hand there.
6. Bump `src/version.js`, commit `tools/ratings.json`.
