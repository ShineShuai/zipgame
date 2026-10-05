# Benchmarks

Solver and generator benchmarks for the Zip puzzle engine, plus a report that tracks results across versions and machines.

## What is measured

| file | purpose | output |
|---|---|---|
| `bench.js` | main benchmark, 4 suites (below). Runs in Node and in the browser (`index.html`). | console table; optional JSON / HTML report |
| `seg-bench.js` | segment-pruning variants (`seg`, `prop`, combinations) over N=7..12 | console only |
| `order-bench.js` | move-ordering variants (`order`, `prop+order`) | console only |
| `leg-collide-bench.js` | leg-collision pruning (`legCollide`, `prop+legCollide`) | console only |

The three `*-bench.js` scripts are standalone experiments and are not part of the report yet.

`bench.js` suites:

| suite | what it compares |
|---|---|
| `solver` | plain search vs `prune2` / `prop` / `seg` / `prop+seg` on seeded instances (n=7..11) |
| `incremental` | incremental propagation + fast path + local connectivity vs the reference search; must be node-for-node identical |
| `generator` | `generate()` per grid size, propagation off vs default (time, walls, K) |
| `candidates` | quality/time effect of the per-size candidate count |

Metrics: `nodes`, `walls`, `K` are deterministic (identical on every machine, gate regressions on these); `ms` / `msMed` (min / median over repeats) depend on the machine. `bad` rows (plain vs optimized search differ) make the run exit with code 1 and flag the result in the report; timings of such runs are not trustworthy.

## Quick start

```sh
npm run bench                         # run, print the console tables, write nothing
node bench/bench.js --only solver     # a subset of suites
npm run bench:save                    # run and append to bench/report.html (clean checkout)
open bench/report.html                # view (self-contained file, no server)
```

## Recording results

Recording is always opt-in. A **version is a git commit**; `VERSION` in `src/version.js` is not used.

| command | effect |
|---|---|
| `bench.js --save` | append to `bench/report.html` (updated in place). Suites already recorded for this commit + environment are skipped; `--force` reruns |
| `bench.js --save --report FILE.html` | append to another report; the file is created when it does not exist |
| `bench.js --out run.json` | write the results as JSON only. JSON is an *optional intermediate* (other device, browser, review); not needed for the normal flow |
| `report.mjs add run.json [more.json\|other.html ...]` | merge JSON files or other report files into `--report` (default `bench/report.html`); `--out NEW.html` writes the merge to a new file and leaves the source untouched |
| `bench.js --note "text" --env-name "name"` | note stored with the results; display name of the environment (captured automatically otherwise) |

### Uncommitted changes

Testing a benchmark change before committing works:

- `--out FILE.json` always works.
- `--save` into a report needs `--allow-dirty`: results are stored as a separate version `abc1234+` (one slot per commit/environment/suite, a rerun replaces it), marked ⚠ "uncommitted" in the report. `node bench/report.mjs add FILE.json --allow-dirty` does the same for a JSON file.
- To keep experiments out of the committed report, use a scratch report: `bench.js --save --allow-dirty --report /tmp/test.html`.
- Remove them later with `node bench/report.mjs rm --dirty`.
- Dirty = uncommitted change under `src/` or `bench/` (not `report.html`, `.DS_Store`).

### Other devices and the browser

- Another machine: clone, `bench.js --save`, then bring its `report.html` (or `--out` JSON) back with `report.mjs add`. Same commit on several machines is kept as separate environments.
- Browser: serve the repo (`python3 -m http.server`), open `bench/index.html`, run, press "Download results JSON" and paste `git log -1 --format='%H %cI %s'` when asked. Import the file in the report page ("Import") and "Save merged HTML", or use `report.mjs add`.

### Rerunning old versions with the current benchmark

After the benchmark changed (new case, new variant), older versions have no data for it:

```sh
node bench/bench.js --save --at abc1234              # one commit
node bench/bench.js --save --at v1..HEAD~1          # a range (oldest first), or a,b,c
```

Each commit is checked out into a temporary git worktree, the current `bench/` runs against its `src/`, and the result is recorded under that commit (tagged `↺ bench@<current sha>`). Needs a clean tree (or `--allow-dirty`). Commits whose `src/` cannot run the current benchmark are reported and skipped.

## The report (`report.html`)

One self-contained HTML file; the data is embedded as JSON, one result per line, so a new run only adds lines to the git diff. `report.mjs build` re-renders it from `report.template.html` after viewer changes, without touching the data.

- **Top bar**: environment, metric, baseline (previous / first / a chosen version), noise band for `ms`, "compare anyway", import.
- **Summary**: per suite and version, the geometric mean of all row ratios against the baseline.
- **Per suite**: trend chart (cumulative change per variant, first version = 100, log axis) and a matrix (rows: case × variant, columns: versions). Cell = per-instance mean, chip = change vs baseline over the instances both versions ran (`3/4` = 3 of 4 in common).
  - ▼ green better, ▲ red worse, ≈ within noise, `=` unchanged (exact metrics), blue = neutral metric (`K`).
  - Hatched "spec changed": the benchmark itself differs between the two versions (suite `rev`, case, variant), so the numbers are not comparable. `—` = not run. `≥` = instances hit the node cap. ✗ = equivalence check failed.
- **Benchmark changes**: what changed in the benchmark between versions (cases, seeds, caps, options, instances, `ALGO_VERSION`).
- **Runs / Environments / Coverage**: every stored result, the machines, and which suites exist per version × environment.

`ms` is compared only within one environment. Exact metrics use any environment's result.

## Changing the benchmark

Edit `suites.js`. Cases, seeds, caps and options are part of each result's `spec` and are compared automatically, so adding or removing rows is safe. Bump the suite's `rev` when the measured code path changes in a way the spec cannot show (different timing method, instance construction). Then backfill old versions with `--at` if you want a continuous history.

## Environment

Captured automatically: CPU, cores, RAM, OS, runtime, power source (macOS). The environment id is a hash of CPU, cores, RAM, platform, arch and runtime name + major version; the hostname is not stored. Keep the machine on AC power and idle for stable `ms`.

## Files

`bench.js` runner (CLI + browser) · `suites.js` suite definitions · `results.js` data model, merge, comparison (shared with the report) · `report.template.html` viewer · `report.html` generated report and data store · `report.mjs` report maintenance (`add`, `note`, `rm`, `list`, `build`) · `backfill.js` `--at` support · `node-env.js`, `store.js` Node helpers · `results.test.js` (`npm run test:bench`).
