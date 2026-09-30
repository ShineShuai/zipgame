// Design app panel: every difficulty diagnostic at once (see core/difficulty.js for what each one
// means and why). On-demand only (a button, not automatic on every board edit) — fullDiagnostics()
// is 4 solve() calls, fine for one puzzle at a time in a design tool but not something to run on
// every keystroke.
//
// KNOWN LIMITATION, worth reading before trusting any number here: against a first hand-labeled
// sample (17 puzzles, N=7-11), NONE of decisionNodes/B/maxDecisionDepth/naiveGap — nor the raw
// generation parameters (N, K, wall count) — correlated with human difficulty ratings (|r| < 0.35
// on every one, several near zero or slightly negative). See spatial.js for the metrics built in
// response to that finding. This panel still shows the solver-derived metrics because they're
// cheap and may yet prove useful combined with something else, but none should be read as
// validated. The "compare against your rating" section below exists to keep testing this honestly
// as more puzzles get labeled, rather than asserting a fix that hasn't been checked.
import { fullDiagnostics } from '../../core/difficulty.js';
import { GRADED_METRICS, DEFAULT_THRESHOLDS_BY_METRIC } from '../../core/gen/calibration.js';
import { gradesFromMetrics, GRADE_ORDER } from '../../core/grades.js';
import { validate } from '../../core/model.js';
import { spatialMetrics } from '../../core/spatial.js';
import { trapMetrics, trapRoute, TRAP_CFG, TRAP_MODEL } from '../../core/trap.js';
import { pickStorage } from '../../platform/storage.js';
import { parse } from '../../core/format.js';
import { ratingKey, ratingFromSelection, leanOf, describeRating, toRatingsJson, parseRatingsJson, mergeRatings } from '../../core/ratings-io.js';
import { initHints } from '../../ui/hint-popover.js';
import { ladder, grade as ladderGrade, wideFrac, LEVELS as LADDER_LEVELS } from '../../core/ladder.js';

const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const row = (label, value, title) => `<tr${title ? ` title="${escAttr(title)}"` : ''}><th>${label}</th><td>${value}</td></tr>`;
// Short always-visible label with its explanation available only on hover: the label sits inline, the
// long text lives in a data-hint icon (see ui/hint-popover.js) instead of taking panel space.
const hinted = (label, hint) => `<span class="diff-flag-label">${label}</span><span data-hint="${escAttr(hint)}"></span>`;
const fmt = x => Number.isFinite(x) ? (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(3)) : '—';

// All metrics worth showing/logging, keyed by a short id used both as the <table> row and as the
// column name in the correlation log below. Every metric is (label, extract(d), title). Extracted
// once per compute so the rating log and the table always agree on the same numbers.
const METRIC_DEFS = [
  ['decisionNodes', d => d.decisionNodes, 'Nodes where >=2 candidate moves survived every prune — real branch/guess points.'],
  ['maxDecisionDepth', d => d.maxDecisionDepth, 'Depth fraction (0-1) of the deepest decision node.'],
  ['B', d => d.B, 'nodes/cells - 1. Cheap cross-check from the same solve.'],
  ['naiveGap', d => d.naiveGap, 'naiveNodes - nodes (propagation+parity off vs on).'],
  ['firstGap', d => d.firstGap, 'nodes - firstNodes (prove-uniqueness cost vs find-a-solution cost).'],
  ['regression', d => d.regression, 'Unfitted placeholder log-linear combination — shape-inspection only.'],
  ['crossPerSeg', d => d.crossPerSeg, 'Geometric checkpoint-segment crossings per segment (spatial.js).'],
  ['overlapPerSeg', d => d.overlapPerSeg, 'Checkpoint-segment bounding-box overlaps per segment (spatial.js).'],
  // The normalized values the calibrated grades are actually bucketed from (see GRADED_METRICS).
  ['decisionNodes/cell', d => d.raw.decisionNodes, 'decisionNodes divided by cell count — the value the decisionNodes grade is bucketed from.'],
  ['B/N', d => d.raw.B, 'B divided by grid size N — the value the B grade is bucketed from.'],
  ['combined score', d => d.raw.combined, 'z(B/N) + z(crossPerSeg) — the value the combined grade is bucketed from. Picked after looking at the rated sample, so optimistic.'],
  // Trap grade (core/trap.js): needs no reference-solve result, so it also exists for puzzles the reference solve capped on.
  ['trapMax', d => d.trap?.ok ? d.trap.trapMax : undefined, `Score of the single worst step of the solution: sum over its wrong moves of 0 (refuted within ${TRAP_CFG.obvious} nodes) / 1 (within ${TRAP_CFG.shallow}) / 3 (deeper) / 5 (survives ${TRAP_CFG.cap} nodes).`],
  ['trapTop3', d => d.trap?.ok ? d.trap.trapTop3 : undefined, 'Sum of the three worst steps\' scores.'],
  ['altFrac', d => d.trap?.ok ? d.trap.altFrac : undefined, 'Fraction of solution steps that have any legal wrong move. Low = long forced corridors, which humans find easy (rho -0.45 vs hand ratings on 70 puzzles).'],
  ['trapPredicted', d => d.trap?.ok ? d.trap.predicted : undefined, 'Ridge model over trapMax, trapTop3, altFrac on your 0-5 scale; the trap grade is this rounded.'],
  // The five calibrated 0-5 grades themselves, so the rating log shows which grade correlates best.
  ...GRADE_ORDER.map(id => [`grade: ${id}`, d => d.grades[id], `Calibrated 0-5 grade from ${GRADED_METRICS[id].label}. Compare against your own rating.`]),
  ['grade: trap', d => d.trap?.ok ? d.trap.grade : undefined, 'Trap grade (the Play app badge): round(predicted), clamped to 0-5. Fit to hand ratings, not quantile-calibrated. Compare against your own rating.'],
  // Technique-ladder grade (core/ladder.js): a third, independent approach — propagates human-style
  // deduction rules (degree, chain, segment-slack territory, nested what-if guessing) instead of
  // trap's per-wrong-turn refutation cost or the calibrated solver-cost metrics above. Needs no
  // reference solve either, so it exists whenever the reference solve is capped, same as trap.
  ['ladderHardest', d => d.ladder ? LADDER_LEVELS[d.ladder.hardest] || '—' : undefined, 'Hardest technique-ladder level reached (local < chain < territory < probe1 < probe2 < search fallback).'],
  ['ladderWideFrac', d => d.ladder?.solved ? d.ladderWF?.frac : undefined, 'Fraction of the solved path\'s branch points that go against "always take the narrower opening" — rho=0.55 vs 43 hand ratings, the strongest single ladder.js signal found so far. See ladder.js grade() for how it feeds the grade.'],
  ['grade: ladder', d => d.ladder ? ladderGrade(d.puzzle, d.ladder).grade : undefined, 'Technique-ladder grade (core/ladder.js): N-floor, then a probe2 (nested-guessing) gate for 4/5, then a coarse wideFrac split for 1/2 below that. See ladder.js header comments for exactly how validated each piece is — it is NOT as calibrated as the trap grade. Compare against your own rating.'],
];
// Every 0-5 grade the panel compares against your rating: the calibrated ones, trap, and ladder.
const ALL_GRADES = [...GRADE_ORDER, 'trap', 'ladder'];
const GRADE_LABEL = { ...Object.fromEntries(GRADE_ORDER.map(id => [id, GRADED_METRICS[id].label])), trap: 'trap (Play badge)', ladder: 'technique ladder' };
// Metrics that exist even when the reference solve was capped (no solver-derived numbers, no grades).
const SOLVER_FREE = new Set(['crossPerSeg', 'overlapPerSeg', 'trapMax', 'trapTop3', 'altFrac', 'trapPredicted', 'grade: trap', 'ladderHardest', 'ladderWideFrac', 'grade: ladder']);

// Fit statistics are optional metadata (tools/fit-trap.mjs --write stores them next to the weights). An older trap.js
// without them must not take the whole diagnostics panel down, so every use goes through these two strings.
const fitN = () => TRAP_MODEL.fit ? `${TRAP_MODEL.fit.n} ` : '';
const fitStats = () => TRAP_MODEL.fit ? ` (leave-one-out rho about ${TRAP_MODEL.fit.looRho.toFixed(2)}, mean abs error ${TRAP_MODEL.fit.looMae.toFixed(2)} grades)` : ' (fit statistics not stored: run tools/fit-trap.mjs --write)';

const rc = (n, c) => `${(c / n) | 0},${c % n}`; // 0-based row,col — same convention as the puzzle text format
const topTraps = t => t.steps.filter(s => s.score >= TRAP_CFG.points[2]).slice(0, 3); // steps with at least one deep trap

// Trap section: the grade, its inputs, and the worst wrong turns (each can be drawn on the board).
function trapHtml(d) {
  const t = d.trap;
  if (!t.ok) return `<div class="diff-panel-flag">Trap grade unavailable: ${t.reason}.</div>`;
  const notUnique = t.nonUnique ? `<div class="diff-panel-flag">${hinted('⚠ Not unique', 'Some wrong turn leads to a second full solution, so this puzzle has more than one answer. Trap scores are measured against the first solution found and ignore those alternatives.')}</div>` : '';
  const top = topTraps(t);
  const traps = top.length
    ? top.map((s, k) => {
      const w = s.worst;
      return `<tr title="Solution step ${s.i + 1} is at ${rc(d.n, t.path[s.i])}. Going to ${rc(d.n, w.cell)} instead is wrong; ${w.capped ? `the solver could not refute it within ${TRAP_CFG.cap} nodes` : `the solver needed ${w.sub} nodes to refute it`}. All wrong moves at this step add up to ${s.score} points.">
        <th>step ${s.i + 1} · ${rc(d.n, t.path[s.i])} → ${rc(d.n, w.cell)}</th><td>${w.capped ? `${TRAP_CFG.cap}+ nodes` : `${w.sub} nodes`} · ${s.score} pts <button type="button" class="diff-trap-show" data-k="${k}" title="Draw the solution up to this step plus the wrong move (shown as the dashed path)">show</button></td></tr>`;
    }).join('')
    : '<tr><th colspan="2">no deep traps</th></tr>';
  return `${notUnique}
    <div class="diff-section-title">Trap grade (candidate)</div>
    <table class="diff-table">
      <tbody>
        ${row('trap grade (Play badge)', `<b>${t.grade} / 5</b>`, `Play app badge. Predicted ${t.predicted.toFixed(2)} on your 0-5 scale (ridge over trapMax, trapTop3, altFrac; fit to ${fitN()}hand ratings), rounded.`)}
        ${row('predicted', t.predicted.toFixed(2), 'Model output before rounding.')}
        ${row('trapMax', t.trapMax, METRIC_DEFS.find(m => m[0] === 'trapMax')[2])}
        ${row('trapTop3', t.trapTop3, METRIC_DEFS.find(m => m[0] === 'trapTop3')[2])}
        ${row('altFrac', t.altFrac.toFixed(3), METRIC_DEFS.find(m => m[0] === 'altFrac')[2])}
        ${row('wrong moves tested', t.alternatives, 'Legal wrong moves along the solution, each refuted by its own capped solve.')}
      </tbody>
    </table>
    <div class="diff-section-title">Worst wrong turns</div>
    <table class="diff-table"><tbody>${traps}</tbody></table>`;
}

// Technique-ladder section: its grade, the honest-limits note grade() returns, hardest level
// reached, and the per-level work breakdown — a structurally different result shape from trap's
// (edges/passes per propagation level vs trap's per-wrong-turn refutation cost), rendered
// separately for that reason, not because it means something different to the user.
function ladderHtml(d) {
  const r = d.ladder;
  if (!r) return '';
  if (r.error) return `<div class="diff-panel-flag">Technique ladder: ${r.error}.</div>`;
  const g = ladderGrade(d.puzzle, r);
  const rows = [];
  for (let l = 1; l <= 6; l++) if (r.edges[l] || r.passes[l]) rows.push(row(`${l} ${LADDER_LEVELS[l]}`, `${r.edges[l]} edges, ${r.passes[l]} passes`));
  const capWarn = r.exceeded ? `<div class="diff-panel-flag diff-panel-flag-red">⚠ work cap exceeded — no grade</div>` : '';
  return `
    <div class="diff-section-title">${hinted('Technique ladder (candidate)', 'A third, independent grader: propagates human-style deduction rules (degree, chain, segment-slack territory, then nested what-if guessing) instead of trap\'s per-wrong-turn refutation cost or the calibrated solver-cost metrics above. See its grade\'s own note below for exactly how validated that number is — treat it as a second opinion, not a replacement for trap.')}</div>
    <table class="diff-table"><tbody>
      ${row('ladder grade', `<b>${g.grade} / 5</b>`, g.note)}
      ${row('hardest level reached', LADDER_LEVELS[r.hardest] || '—')}
      ${row('probe trials', r.probeTrials)}
      ${row('search fallback nodes', r.search.nodes)}
    </tbody></table>
    ${capWarn}
    <div class="diff-panel-time">${g.note}</div>
    ${rows.length ? `<table class="diff-table diff-table-cmp"><thead><tr><th>level</th><th>work</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''}`;
}

// Renders the full breakdown as an HTML string for a results panel; `d` is fullDiagnostics()'s
// return value merged with spatialMetrics()'s, `thresholds` the pooled calibration in use (so the
// panel and the grade it explains always agree on the same cutpoints).
export function diagnosticsHtml(d) {
  if (d.exceeded) {
    return `<div class="diff-panel diff-panel-warn">
      Search capped before uniqueness was confirmed at this node limit — no grade. Raise Search
      limit (nodes) above and re-run, or accept this puzzle may be right at/beyond the grading
      budget (which is itself a signal: grade 5-and-up territory). The trap grade below does not
      depend on that solve.
    </div>${trapHtml(d)}`;
  }
  const legWarn = d.legCollideDependent
    ? `<div class="diff-panel-flag">${hinted('⚠ Leg-collision dependent', 'Uniqueness depends on the leg-collision check — a non-local inference humans rarely make proactively, so this puzzle is likely harder for a person than the grades suggest.')}</div>`
    : '';
  const gapWarn = d.naiveGap > d.nodes // gap bigger than the pruned cost itself: a strong signal
    ? `<div class="diff-panel-flag">${hinted('⚠ Large naive-solver gap', 'This puzzle looks much harder without propagation/parity than with them, so the solver-based grades may under-report the difficulty a human feels.')}</div>`
    : '';
  const gradeRows = GRADE_ORDER.map((id, i) => {
    const th = DEFAULT_THRESHOLDS_BY_METRIC[id];
    const where = i < 3 ? 'Play app, hold V (decisionNodes was the badge before the trap grade)' : 'Design app only';
    return row(GRADED_METRICS[id].label, `${d.grades[id]} / 5`,
      `${where}. Raw value ${fmt(d.raw[id])}, bucketed with its own calibrated cutpoints [${th.join(', ')}].`);
  }).join('');
  const rows = METRIC_DEFS.filter(([id]) => !id.startsWith('grade:')).map(([id, get, title]) => row(id, fmt(get(d)), title)).join('');
  return `
    <div class="diff-panel-flag diff-panel-flag-red">${hinted('⚠ Grades are unvalidated', `The solver-based grades correlate only about 0.4 with your hand ratings. The trap grade (the Play app badge) was fit to ${fitN()}hand-rated puzzles${fitStats()}, with its features picked on that sample, so that number is optimistic. It rarely outputs 0, 4 or 5. Rate puzzles below to test it on new ones.`)}</div>
    ${trapHtml(d)}
    <div class="diff-section-title">Grades (each calibrated on its own)</div>
    <table class="diff-table"><tbody>${gradeRows}</tbody></table>
    <div class="diff-section-title">Raw metrics</div>
    <table class="diff-table">
      <tbody>
        ${rows}
        ${row('legCollideDependent', d.legCollideDependent ? 'yes' : 'no', 'Does uniqueness survive with the leg-collision check off? A "yes" here flags a puzzle whose only-one-answer property depends on a non-local inference humans rarely make proactively.')}
      </tbody>
    </table>
    ${legWarn}${gapWarn}`;
}

// ---- rating log: lets the design app itself accumulate labeled (metric, human-rating) pairs and
// show a running Pearson r per metric, instead of a one-off offline script. Persisted via
// pickStorage() (same port the play app's stats use) so it survives reloads. ----
const LOG_KEY = 'zip-difficulty-rating-log-v1';

async function loadLog() {
  const storage = await pickStorage();
  const rec = await storage.get(LOG_KEY);
  if (!rec) return [];
  let entries; try { entries = JSON.parse(rec.value); } catch { return []; }
  // Older logs keyed each puzzle by serialize(p), whose text starts with "# ..." comment lines. The shared ratings.json
  // format (core/ratings-io.js) uses the comment-free key, so normalise here: the same puzzle then matches an imported row.
  const byKey = new Map();
  for (const e of entries) { let key = e.key; try { key = ratingKey(e.key); } catch { /* keep an unparseable key as it is */ } byKey.set(key, { ...e, key }); }
  return [...byKey.values()];
}
async function saveLog(entries) {
  const storage = await pickStorage();
  await storage.set(LOG_KEY, JSON.stringify(entries));
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

// Export / import / clear: shown even for an empty log, because a fresh browser is exactly when you import tools/ratings.json.
function logToolsHtml() {
  return `<div class="diff-log-tools">
      <button type="button" id="diffLogExport" class="diff-log-btn" title="Download every rating as ratings.json: the file tools/ and git use ({ key, human, lo, hi }; grades are not included, they are recomputed on import).">Export ratings.json</button>
      <button type="button" id="diffLogImport" class="diff-log-btn" title="Load a ratings.json, e.g. tools/ratings.json from the repo. A puzzle already in the log gets the file's rating; every imported puzzle is regraded with the current code.">Import ratings.json</button>
      <input type="file" id="diffLogFile" accept=".json,application/json" hidden>
      <button type="button" id="diffLogClear" class="diff-log-clear diff-log-btn">Clear rating log</button>
    </div>
    <div class="diff-log-status" id="diffLogStatus" role="status"></div>`;
}

function correlationHtml(entries) {
  if (entries.length < 3) {
    return `<div class="diff-panel-time">Rate a few more puzzles (${entries.length}/3 minimum) to see running correlations.</div>${logToolsHtml()}`;
  }
  // Each metric is correlated over the entries that HAVE it. Entries logged before a metric existed
  // (e.g. an older browser log from before the calibrated grades were added) simply lack that field;
  // dropping the whole metric because of them would hide the new rows until the log is cleared, so
  // instead each row shows its own n and the tooltip says when it is smaller than the full log.
  const lines = METRIC_DEFS.map(([id]) => {
    const pairs = entries.filter(e => e.metrics && Number.isFinite(e.metrics[id]));
    if (pairs.length < 3) return null;
    const r = pearson(pairs.map(e => e.metrics[id]), pairs.map(e => e.human));
    return r == null ? null : { id, r, n: pairs.length };
  }).filter(Boolean).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const rowsHtml = lines.map(l => `<tr title="${l.n === entries.length ? `all ${l.n} logged puzzles` : `only ${l.n} of ${entries.length} logged puzzles have this metric (older log entries predate it, or the puzzle could not be graded)`}"><th>${l.id}</th><td>${l.r.toFixed(3)}${l.n === entries.length ? '' : ` <span class="diff-n">n=${l.n}</span>`}</td></tr>`).join('');
  return `
    <div class="diff-panel-time">${hinted(`Correlation with your ratings, n=${entries.length}`, 'Pearson r of each metric or grade against your 0-5 ratings (for a rating with a range, its midpoint), sorted by |r|. Treat anything under about 0.5 as unreliable until n is much larger. A row with its own n was computed only over the logged puzzles that have that metric.')}</div>
    <table class="diff-table"><tbody>${rowsHtml}</tbody></table>
    ${logToolsHtml()}`;
}

// The numbers you asked for after rating: one row per calibrated grade showing
//   - THIS puzzle: the grade the metric gave it, your rating, and the signed error (grade - rating)
//   - ALL rated puzzles: mean signed error (bias), mean absolute error, and Pearson r
// so a single puzzle's miss and the metric's overall behaviour sit side by side. Only the calibrated
// 0-5 grades appear here because only those are on the same scale as your rating (a raw metric like
// decisionNodes/cell cannot be "off by 2"). Entries logged before the grades existed are skipped for
// the aggregate columns (shown via the row's n).
function ratedComparisonHtml(entries, thisMetrics, entry) {
  const lo = entry.lo ?? entry.human, hi = entry.hi ?? entry.human, said = describeRating(entry);
  const inRange = (g, e) => g >= (e.lo ?? e.human) && g <= (e.hi ?? e.human);
  const rows = ALL_GRADES.filter(id => Number.isFinite(thisMetrics[`grade: ${id}`])).map(id => {
    const field = `grade: ${id}`;
    const cur = thisMetrics[field];
    const err = cur < lo ? cur - lo : cur > hi ? cur - hi : 0; // how far outside the range you stated (0 = inside it)
    const have = entries.filter(e => e.metrics && Number.isFinite(e.metrics[field]));
    let bias = null, mae = null, hit = null, r = null;
    if (have.length) {
      bias = have.reduce((a, e) => a + (e.metrics[field] - e.human), 0) / have.length;
      mae = have.reduce((a, e) => a + Math.abs(e.metrics[field] - e.human), 0) / have.length;
      hit = have.filter(e => inRange(e.metrics[field], e)).length / have.length;
      if (have.length >= 3) r = pearson(have.map(e => e.metrics[field]), have.map(e => e.human));
    }
    const sgn = x => (x > 0 ? '+' : '') + x.toFixed(x % 1 ? 2 : 0);
    return `<tr title="${escAttr(`${GRADE_LABEL[id]}: this puzzle got ${cur}, you rated it ${said} (${err === 0 ? 'inside your range' : `${sgn(err)} outside your range`}). Over ${have.length} rated puzzles: inside your stated range ${hit == null ? '—' : Math.round(100 * hit) + '%'}, mean signed error vs the midpoint ${bias == null ? '—' : sgn(bias)} (positive = the grade runs harder than you), mean absolute error ${mae == null ? '—' : mae.toFixed(2)}, Pearson r ${r == null ? '—' : r.toFixed(3)}.`)}">
      <th>${GRADE_LABEL[id]}</th><td>${cur} vs ${said}<span class="diff-n"> (${err === 0 ? 'in range' : sgn(err)})</span></td>
      <td>${hit == null ? '—' : Math.round(100 * hit) + '%'}</td><td>${bias == null ? '—' : sgn(bias)}</td><td>${mae == null ? '—' : mae.toFixed(2)}</td><td>${r == null ? '—' : r.toFixed(2)}</td></tr>`;
  }).join('');
  return `
    <div class="diff-section-title">This puzzle vs all ${entries.length} rated</div>
    <table class="diff-table diff-table-cmp">
      <thead><tr><th></th><th title="grade vs your rating; in range = the grade is inside the range you gave, otherwise how far outside">this</th><th title="share of rated puzzles whose grade lies inside the range you stated">in range</th><th title="mean signed error vs the midpoint of your rating over all rated puzzles; + means the grade runs harder than you">bias</th><th title="mean absolute error vs the midpoint over all rated puzzles">MAE</th><th title="Pearson r over all rated puzzles">r</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Everything the panel shows and logs for one puzzle. Shared by "Compute diagnostics" and the ratings import (which regrades every
// imported puzzle with the current code, so a refit or a new metric never leaves stale numbers in the log).
function analyse(p, cap) {
  const t0 = performance.now();
  const d = fullDiagnostics(p, cap);
  Object.assign(d, spatialMetrics(p));
  d.n = p.n;
  if (!d.exceeded) {
    // Reuse the reference-solve fields fullDiagnostics already produced — no extra solve.
    const g = gradesFromMetrics({ ...d, n: p.n }, d);
    d.raw = g.raw; d.grades = g.grades;
  }
  d.ms = performance.now() - t0;
  d.puzzle = p; // grade: ladder's extractor needs the puzzle itself, not just the solve result
  // Trap grade: its own set of capped solves, independent of whether the reference solve above was capped.
  const t1 = performance.now();
  d.trap = trapMetrics(p);
  d.trapMs = performance.now() - t1;
  // Technique-ladder grade: its own independent solve, also unaffected by whether the reference solve was capped.
  const t2 = performance.now();
  d.ladder = ladder(p);
  d.ladderWF = d.ladder.solved && d.ladder.path ? wideFrac(p, d.ladder.path) : null;
  d.ladderMs = performance.now() - t2;
  return d;
}

// The metrics logged with a rating. A capped reference solve has no solver metrics/grades to log, but the trap/ladder/spatial
// ones still exist as long as AT LEAST ONE of trap or ladder actually solved the puzzle (each is an independent solve).
function metricsOf(d) {
  return d.exceeded
    ? ((d.trap.ok || d.ladder.solved) ? Object.fromEntries(METRIC_DEFS.filter(([id]) => SOLVER_FREE.has(id)).map(([id, get]) => [id, get(d)])) : null)
    : Object.fromEntries(METRIC_DEFS.map(([id, get]) => [id, get(d)]));
}

const RATE_HINT = 'Click a grade to rate this puzzle (saved at once). Unsure between two neighbouring grades? Click the second one too ("2 or 3"), then say which it is closer to. Click a selected single grade again to remove the rating. Ranges are what the in range score and ratings.json keep.';

// Download text as a file (export).
function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Mounts the panel: a button that runs fullDiagnostics() on the current puzzle (via getPuzzle())
// and renders into resultEl. Returns { run() } so the caller (main.js) can trigger it from its own
// button binding, matching how doSolve/doMinimize are wired there.
//
// Output is wrapped in a collapsible section (the diagnostics + rating log grow long once
// expanded) with a header the user can click to hide/show everything below it without losing the
// last computed result — collapsing never clears lastMetrics/lastPuzzleKey, so rating still works
// while collapsed, and re-running Compute diagnostics always expands again so a fresh result is
// never hidden from the user who just asked for it.
export function mountDifficultyPanel(resultEl, getPuzzle, getNodeCap, onShowPath) {
  let lastMetrics = null, lastPuzzleKey = null, collapsed = false, lastRoutes = [];
  let sel = null;       // { lo, hi, lean } rating of the current puzzle, or null = unrated
  let logStatus = '';   // last export/import message; survives re-rendering of the log section

  function applyCollapsed() {
    const body = resultEl.querySelector('.diff-body');
    const arrow = resultEl.querySelector('.diff-collapse-arrow');
    if (body) body.style.display = collapsed ? 'none' : '';
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  }

  function setStatus(msg) {
    logStatus = msg;
    const el = resultEl.querySelector('#diffLogStatus');
    if (el) el.textContent = msg;
  }

  async function renderLog() {
    const entries = await loadLog();
    const el = resultEl.querySelector('.diff-log-slot');
    if (el) { el.innerHTML = correlationHtml(entries); initHints(el); }
    const clearBtn = resultEl.querySelector('#diffLogClear');
    if (clearBtn) clearBtn.onclick = async () => { await saveLog([]); sel = null; setStatus(''); paintRating(); clearComparison(); renderLog(); };
    const exportBtn = resultEl.querySelector('#diffLogExport');
    if (exportBtn) exportBtn.onclick = async () => {
      const all = await loadLog();
      if (!all.length) { setStatus('Nothing to export yet: rate a puzzle first.'); return; }
      downloadText(toRatingsJson(all), 'ratings.json');
      setStatus(`Exported ${all.length} ratings to ratings.json (put it at tools/ratings.json to use it in the repo).`);
    };
    const fileInput = resultEl.querySelector('#diffLogFile'), importBtn = resultEl.querySelector('#diffLogImport');
    if (importBtn && fileInput) {
      importBtn.onclick = () => fileInput.click();
      fileInput.onchange = async () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) await importFile(f); };
    }
    setStatus(logStatus);
  }

  // Import a ratings.json: merge by puzzle (the file's rating wins), then regrade every imported puzzle with the current code,
  // yielding to the browser between puzzles so the page stays responsive and shows progress.
  async function importFile(file) {
    let text; try { text = await file.text(); } catch (e) { setStatus(`Could not read the file: ${e.message}`); return; }
    const { ratings, problems } = parseRatingsJson(text);
    if (!ratings.length) { setStatus(`Nothing imported: ${problems[0] || 'the file has no ratings'}.`); return; }
    const merged = mergeRatings(await loadLog(), ratings);
    const byKey = new Map(merged.entries.map(e => [e.key, e])), cap = getNodeCap ? getNodeCap() : undefined;
    let ungraded = 0;
    for (let i = 0; i < ratings.length; i++) {
      setStatus(`Regrading ${i + 1}/${ratings.length}…`);
      await new Promise(r => setTimeout(r, 0));
      const e = byKey.get(ratings[i].key);
      try {
        const puzzle = parse(ratings[i].key);
        if (validate(puzzle).ok) e.metrics = metricsOf(analyse(puzzle, cap));
      } catch (err) { /* leave metrics null */ }
      if (!e.metrics) ungraded++;
    }
    await saveLog(merged.entries);
    setStatus(`Imported ${ratings.length} ratings: ${merged.added} new, ${merged.updated} replaced (${merged.changed} with a different rating)`
      + (ungraded ? `, ${ungraded} could not be graded (invalid or non-unique puzzle; the rating is kept)` : '')
      + (problems.length ? `. ${problems.length} note(s): ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''}` : '') + '.');
    await syncRating();
    renderLog();
  }

  // ---- your rating of the current puzzle: one grade, or two neighbouring grades ("2 or 3") plus which one it is closer to ----
  function clearComparison() { const cmp = resultEl.querySelector('.diff-cmp-slot'); if (cmp) cmp.innerHTML = ''; }

  function paintRating() {
    resultEl.querySelectorAll('.diff-rate-btn').forEach(b => b.classList.toggle('sel', !!sel && +b.dataset.grade >= sel.lo && +b.dataset.grade <= sel.hi));
    const leanBox = resultEl.querySelector('.diff-rate-lean'), text = resultEl.querySelector('.diff-rate-text');
    const pair = !!sel && sel.hi - sel.lo === 1; // "closer to" only makes sense for two neighbouring grades
    if (leanBox) leanBox.style.display = pair ? '' : 'none';
    const lb = resultEl.querySelectorAll('.diff-lean-btn');
    if (pair) lb.forEach(b => { const d = +b.dataset.lean; b.textContent = d < 0 ? sel.lo : sel.hi; b.classList.toggle('sel', sel.lean === d); });
    if (text) text.textContent = sel ? (() => { const r = ratingFromSelection(sel); return `Saved: ${describeRating(r)}${r.lo === r.hi ? '' : ` (used as ${r.human})`}`; })() : 'Not rated.';
  }

  async function saveRating() {
    if (!lastMetrics && !sel) return;
    const entries = await loadLog();
    const idx = entries.findIndex(e => e.key === lastPuzzleKey);
    // One entry per distinct puzzle (by its canonical key) — re-rating the same puzzle updates its entry, never double-counts it.
    if (!sel) { if (idx >= 0) entries.splice(idx, 1); }
    else {
      const entry = { key: lastPuzzleKey, ...ratingFromSelection(sel), metrics: lastMetrics };
      if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    }
    await saveLog(entries);
    paintRating();
    const cur = sel && entries.find(e => e.key === lastPuzzleKey);
    const cmp = resultEl.querySelector('.diff-cmp-slot');
    if (cmp) cmp.innerHTML = cur && lastMetrics ? ratedComparisonHtml(entries, lastMetrics, cur) : '';
    renderLog();
  }

  function onGrade(g) {
    if (!lastMetrics) return;
    if (sel && sel.lo === sel.hi && sel.lo === g) sel = null;                                   // same single grade again: remove
    else if (sel && sel.lo === sel.hi && Math.abs(g - sel.lo) === 1) sel = { lo: Math.min(g, sel.lo), hi: Math.max(g, sel.lo), lean: 0 }; // neighbour: "N or M"
    else sel = { lo: g, hi: g, lean: 0 };
    return saveRating();
  }

  function onLean(d) {
    if (!sel || sel.hi - sel.lo !== 1) return;
    sel = { ...sel, lean: sel.lean === d ? 0 : d };
    return saveRating();
  }

  // After Compute diagnostics: show a rating this puzzle already has (typed earlier or imported) with its comparison table.
  async function syncRating() {
    const entries = await loadLog(), e = entries.find(x => x.key === lastPuzzleKey);
    sel = e ? { lo: e.lo ?? e.human, hi: e.hi ?? e.human, lean: leanOf({ human: e.human, lo: e.lo ?? e.human, hi: e.hi ?? e.human }) } : null;
    paintRating();
    const cmp = resultEl.querySelector('.diff-cmp-slot');
    if (cmp) cmp.innerHTML = e && lastMetrics ? ratedComparisonHtml(entries, lastMetrics, e) : '';
  }

  function run() {
    const p = getPuzzle();
    const v = validate(p);
    collapsed = false; // a fresh compute always expands, even if the panel was left collapsed
    if (!v.ok) {
      resultEl.innerHTML = `<div class="diff-panel diff-panel-warn">Fix the puzzle first: ${v.msg}</div>`;
      lastMetrics = null;
      return;
    }
    const d = analyse(p, getNodeCap ? getNodeCap() : undefined);
    lastRoutes = d.trap.ok ? topTraps(d.trap).map(s => trapRoute(d.trap.path, s)) : [];
    lastMetrics = metricsOf(d);
    lastPuzzleKey = ratingKey(p);
    sel = null;

    const rateHtml = !lastMetrics ? '' : `
      <div class="diff-rate">
        <span>Your rating for this puzzle:</span>
        ${[0, 1, 2, 3, 4, 5].map(g => `<button type="button" class="diff-rate-btn" data-grade="${g}">${g}</button>`).join('')}
        <span data-hint="${escAttr(RATE_HINT)}"></span>
        <span class="diff-rate-lean" style="display:none">closer to
          <button type="button" class="diff-lean-btn" data-lean="-1"></button><button type="button" class="diff-lean-btn" data-lean="1"></button></span>
      </div>
      <div class="diff-rate-text">Not rated.</div>`;
    resultEl.innerHTML = `
      <button type="button" class="diff-collapse-toggle"><span class="diff-collapse-arrow">▾</span> Diagnostics</button>
      <div class="diff-body">
        ${diagnosticsHtml(d)}${ladderHtml(d)}<div class="diff-panel-time">${d.ms.toFixed(0)}ms, 4 solve() calls + spatial (free) · trap grade ${d.trapMs.toFixed(0)}ms${d.trap.ok ? `, ${d.trap.alternatives} capped solves` : ''} · ladder grade ${d.ladderMs.toFixed(0)}ms</div>
        ${rateHtml}<div class="diff-cmp-slot"></div><div class="diff-log-slot"></div>
      </div>`;
    initHints(resultEl);
    resultEl.querySelector('.diff-collapse-toggle').onclick = () => { collapsed = !collapsed; applyCollapsed(); };
    resultEl.querySelectorAll('.diff-rate-btn').forEach(b => b.onclick = () => onGrade(+b.dataset.grade));
    resultEl.querySelectorAll('.diff-lean-btn').forEach(b => b.onclick = () => onLean(+b.dataset.lean));
    resultEl.querySelectorAll('.diff-trap-show').forEach(b => b.onclick = () => onShowPath && onShowPath(lastRoutes[+b.dataset.k]));
    applyCollapsed();
    renderLog();
    syncRating();
  }
  return { run };
}
