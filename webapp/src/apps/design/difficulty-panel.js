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
import { pickStorage } from '../../platform/storage.js';
import { serialize } from '../../core/format.js';
import { initHints } from '../../ui/hint-popover.js';

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
  // The five calibrated 0-5 grades themselves, so the rating log shows which grade correlates best.
  ...GRADE_ORDER.map(id => [`grade: ${id}`, d => d.grades[id], `Calibrated 0-5 grade from ${GRADED_METRICS[id].label}. Compare against your own rating.`]),
];

// Renders the full breakdown as an HTML string for a results panel; `d` is fullDiagnostics()'s
// return value merged with spatialMetrics()'s, `thresholds` the pooled calibration in use (so the
// panel and the grade it explains always agree on the same cutpoints).
export function diagnosticsHtml(d) {
  if (d.exceeded) {
    return `<div class="diff-panel diff-panel-warn">
      Search capped before uniqueness was confirmed at this node limit — no grade. Raise Search
      limit (nodes) above and re-run, or accept this puzzle may be right at/beyond the grading
      budget (which is itself a signal: grade 5-and-up territory).
    </div>`;
  }
  const legWarn = d.legCollideDependent
    ? `<div class="diff-panel-flag">${hinted('⚠ Leg-collision dependent', 'Uniqueness depends on the leg-collision check — a non-local inference humans rarely make proactively, so this puzzle is likely harder for a person than the grades suggest.')}</div>`
    : '';
  const gapWarn = d.naiveGap > d.nodes // gap bigger than the pruned cost itself: a strong signal
    ? `<div class="diff-panel-flag">${hinted('⚠ Large naive-solver gap', 'This puzzle looks much harder without propagation/parity than with them, so the solver-based grades may under-report the difficulty a human feels.')}</div>`
    : '';
  const gradeRows = GRADE_ORDER.map((id, i) => {
    const th = DEFAULT_THRESHOLDS_BY_METRIC[id];
    const where = i === 0 ? 'Play app badge' : i < 3 ? 'Play app, hold V' : 'Design app only';
    return row(GRADED_METRICS[id].label, `${d.grades[id]} / 5`,
      `${where}. Raw value ${fmt(d.raw[id])}, bucketed with its own calibrated cutpoints [${th.join(', ')}].`);
  }).join('');
  const rows = METRIC_DEFS.filter(([id]) => !id.startsWith('grade:')).map(([id, get, title]) => row(id, fmt(get(d)), title)).join('');
  return `
    <div class="diff-panel-flag diff-panel-flag-red">${hinted('⚠ Grades are unvalidated', 'No grade here has validated against your hand ratings yet: best r is about 0.3 to 0.4 on 25 rated puzzles, which is not distinguishable from noise. Use them to compare candidate gradings against your own rating; do not trust any single one.')}</div>
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
  try { return JSON.parse(rec.value); } catch { return []; }
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

function correlationHtml(entries) {
  if (entries.length < 3) {
    return `<div class="diff-panel-time">Rate a few more puzzles (${entries.length}/3 minimum) to see running correlations.</div>`;
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
  const rowsHtml = lines.map(l => `<tr title="${l.n === entries.length ? `all ${l.n} logged puzzles` : `only ${l.n} of ${entries.length} logged puzzles have this metric (older log entries predate it)`}"><th>${l.id}</th><td>${l.r.toFixed(3)}${l.n === entries.length ? '' : ` <span class="diff-n">n=${l.n}</span>`}</td></tr>`).join('');
  return `
    <div class="diff-panel-time">${hinted(`Correlation with your ratings, n=${entries.length}`, 'Pearson r of each metric or grade against your 0-5 ratings, sorted by |r|. Treat anything under about 0.5 as unreliable until n is much larger. A row with its own n was computed only over the logged puzzles that have that metric.')}</div>
    <table class="diff-table"><tbody>${rowsHtml}</tbody></table>
    <button id="diffLogClear" class="diff-log-clear">Clear rating log</button>`;
}

// The numbers you asked for after rating: one row per calibrated grade showing
//   - THIS puzzle: the grade the metric gave it, your rating, and the signed error (grade - rating)
//   - ALL rated puzzles: mean signed error (bias), mean absolute error, and Pearson r
// so a single puzzle's miss and the metric's overall behaviour sit side by side. Only the calibrated
// 0-5 grades appear here because only those are on the same scale as your rating (a raw metric like
// decisionNodes/cell cannot be "off by 2"). Entries logged before the grades existed are skipped for
// the aggregate columns (shown via the row's n).
function ratedComparisonHtml(entries, thisKey, thisMetrics, human) {
  const rows = GRADE_ORDER.map(id => {
    const field = `grade: ${id}`;
    const cur = thisMetrics[field];
    const err = cur - human;
    const have = entries.filter(e => e.metrics && Number.isFinite(e.metrics[field]));
    let bias = null, mae = null, r = null;
    if (have.length) {
      bias = have.reduce((a, e) => a + (e.metrics[field] - e.human), 0) / have.length;
      mae = have.reduce((a, e) => a + Math.abs(e.metrics[field] - e.human), 0) / have.length;
      if (have.length >= 3) r = pearson(have.map(e => e.metrics[field]), have.map(e => e.human));
    }
    const sgn = x => (x > 0 ? '+' : '') + x.toFixed(x % 1 ? 2 : 0);
    return `<tr title="${escAttr(`${GRADED_METRICS[id].label}: this puzzle got ${cur}, you rated it ${human} (error ${sgn(err)}). Over ${have.length} rated puzzles: mean signed error ${bias == null ? '—' : sgn(bias)} (positive = the grade runs harder than you), mean absolute error ${mae == null ? '—' : mae.toFixed(2)}, Pearson r ${r == null ? '—' : r.toFixed(3)}.`)}">
      <th>${GRADED_METRICS[id].label}</th><td>${cur} vs ${human}<span class="diff-n"> (${sgn(err)})</span></td>
      <td>${bias == null ? '—' : sgn(bias)}</td><td>${mae == null ? '—' : mae.toFixed(2)}</td><td>${r == null ? '—' : r.toFixed(2)}</td></tr>`;
  }).join('');
  return `
    <div class="diff-section-title">This puzzle vs all ${entries.length} rated</div>
    <table class="diff-table diff-table-cmp">
      <thead><tr><th></th><th title="grade vs your rating (grade - rating)">this</th><th title="mean signed error over all rated puzzles; + means the grade runs harder than you">bias</th><th title="mean absolute error over all rated puzzles">MAE</th><th title="Pearson r over all rated puzzles">r</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
export function mountDifficultyPanel(resultEl, getPuzzle, getNodeCap) {
  let lastMetrics = null, lastPuzzleKey = null, collapsed = false;

  function applyCollapsed() {
    const body = resultEl.querySelector('.diff-body');
    const arrow = resultEl.querySelector('.diff-collapse-arrow');
    if (body) body.style.display = collapsed ? 'none' : '';
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  }

  async function renderLog() {
    const entries = await loadLog();
    const el = resultEl.querySelector('.diff-log-slot');
    if (el) { el.innerHTML = correlationHtml(entries); initHints(el); }
    const clearBtn = resultEl.querySelector('#diffLogClear');
    if (clearBtn) clearBtn.onclick = async () => { await saveLog([]); renderLog(); };
  }

  async function rate(human) {
    if (!lastMetrics) return;
    const entries = await loadLog();
    // One entry per distinct puzzle (by its serialized text) — re-rating the same puzzle updates
    // its entry rather than double-counting it.
    const idx = entries.findIndex(e => e.key === lastPuzzleKey);
    const entry = { key: lastPuzzleKey, human, metrics: lastMetrics };
    if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    await saveLog(entries);
    const cmp = resultEl.querySelector('.diff-cmp-slot');
    if (cmp) cmp.innerHTML = ratedComparisonHtml(entries, lastPuzzleKey, lastMetrics, human);
    renderLog();
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
    const cap = getNodeCap ? getNodeCap() : undefined;
    const t0 = performance.now();
    const d = fullDiagnostics(p, cap);
    Object.assign(d, spatialMetrics(p));
    if (!d.exceeded) {
      // Reuse the reference-solve fields fullDiagnostics already produced — no extra solve.
      const g = gradesFromMetrics({ ...d, n: p.n }, d);
      d.raw = g.raw; d.grades = g.grades;
    }
    const ms = performance.now() - t0;

    lastMetrics = d.exceeded ? null : Object.fromEntries(METRIC_DEFS.map(([id, get]) => [id, get(d)]));
    lastPuzzleKey = serialize(p);

    const rateHtml = d.exceeded ? '' : `
      <div class="diff-rate">
        <span>Your rating for this puzzle:</span>
        ${[0, 1, 2, 3, 4, 5].map(g => `<button class="diff-rate-btn" data-grade="${g}">${g}</button>`).join('')}
      </div>`;
    resultEl.innerHTML = `
      <button type="button" class="diff-collapse-toggle"><span class="diff-collapse-arrow">▾</span> Diagnostics</button>
      <div class="diff-body">
        ${diagnosticsHtml(d)}<div class="diff-panel-time">${ms.toFixed(0)}ms, 4 solve() calls + spatial (free)</div>
        ${rateHtml}<div class="diff-cmp-slot"></div><div class="diff-log-slot"></div>
      </div>`;
    initHints(resultEl);
    resultEl.querySelector('.diff-collapse-toggle').onclick = () => { collapsed = !collapsed; applyCollapsed(); };
    resultEl.querySelectorAll('.diff-rate-btn').forEach(b => b.onclick = () => rate(+b.dataset.grade));
    applyCollapsed();
    renderLog();
  }
  return { run };
}
