// Shared difficulty-rating log: accumulates (puzzle, metrics, human grade) entries so metric
// candidates can be checked against real human judgment as more puzzles get rated — see
// difficulty.js's and spatial.js's module comments for why this exists (every metric tried so far
// has failed a first 17-puzzle hand-labeled sample; this is how a larger sample gets built up
// without hand-encoding puzzles into scratch scripts every time).
//
// ONE log, shared by both apps (same storage key) — a puzzle rated in the play app while playing
// and a puzzle rated in the design app while editing land in the same place, so the running
// correlation and the export always reflect everything rated anywhere, not just one app's session.
import { pickStorage } from '../platform/storage.js';
import { serialize } from './format.js';
import { metricsFor, refNodeCap } from './difficulty.js';
import { spatialMetrics } from './spatial.js';

const LOG_KEY = 'zip-difficulty-rating-log-v1';

// All metrics captured per entry — this is the single source of truth for both apps' displays and
// for the export/import format, so they can't silently drift out of sync with each other.
// [id, extract(d), tooltip, category] — category is shown as its own (wider) column in the design
// app's diagnostics table: 'solver' = derived from a solve() call (search cost), 'spatial' =
// derived from checkpoint geometry alone, no solve() involved (see spatial.js).
export const METRIC_DEFS = [
  ['decisionNodes', d => d.decisionNodes, 'Nodes where >=2 candidate moves survived every prune — real branch/guess points.', 'solver'],
  ['maxDecisionDepth', d => d.maxDecisionDepth, 'Depth fraction (0-1) of the deepest decision node.', 'solver'],
  ['B', d => d.B, 'nodes/cells - 1. Cheap cross-check from the same solve.', 'solver'],
  ['crossPerSeg', d => d.crossPerSeg, 'Geometric checkpoint-segment crossings per segment (spatial.js).', 'spatial'],
  ['overlapPerSeg', d => d.overlapPerSeg, 'Checkpoint-segment bounding-box overlaps per segment (spatial.js).', 'spatial'],
];

// Computes every metric for a puzzle in one pass (1 solve + free spatial pass). Returns null if the reference solve couldn't confirm uniqueness within
// budget (nothing to log in that case — see exceeded handling at call sites).
export function computeMetrics(puzzle, nodeCap = refNodeCap(puzzle.n)) {
  const d = metricsFor(puzzle, nodeCap);
  if (d.exceeded) return null;
  Object.assign(d, spatialMetrics(puzzle));
  return Object.fromEntries(METRIC_DEFS.map(([id, get]) => [id, get(d)]));
}

async function loadLog() {
  const storage = await pickStorage();
  const rec = await storage.get(LOG_KEY);
  if (!rec) return [];
  try { const arr = JSON.parse(rec.value); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
async function saveLog(entries) {
  const storage = await pickStorage();
  await storage.set(LOG_KEY, JSON.stringify(entries));
}

// Adds/updates one rated entry. `source` is just a label ('play'|'design') so an exported log shows
// where each rating came from — it doesn't affect logging logic. Re-rating the same puzzle (by its
// serialized text) updates the existing entry rather than duplicating it.
export async function rate(puzzle, human, metrics, source) {
  const key = serialize(puzzle);
  const entries = await loadLog();
  const idx = entries.findIndex(e => e.key === key);
  const entry = { key, human, metrics, source, ratedAt: new Date().toISOString() };
  if (idx >= 0) entries[idx] = entry; else entries.push(entry);
  await saveLog(entries);
  return entries;
}

export async function getLog() { return loadLog(); }
export async function clearLog() { await saveLog([]); }

export function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

// Running correlation of every metric vs. the logged human grades, over the WHOLE log passed in —
// no cap; the log itself only grows until clearLog() is called, so this scales to any number of
// rated puzzles. Skips a metric for entries where it's missing (shouldn't normally happen —
// computeMetrics always fills every METRIC_DEFS key — but stays defensive against a log imported
// from an older/different metric set).
export function correlations(entries) {
  const humans = entries.map(e => e.human);
  return METRIC_DEFS.map(([id]) => {
    const xs = entries.map(e => e.metrics && e.metrics[id]).filter(x => Number.isFinite(x));
    if (xs.length !== entries.length) return { id, r: null, n: xs.length };
    return { id, r: pearson(xs, humans), n: xs.length };
  });
}

// Percentile (0-100) of `value` within `values` — fraction of the sample at or below it. Used to
// place ONE puzzle's own metric value in context against everything logged so far.
function percentileOf(value, values) {
  if (!values.length) return null;
  const below = values.filter(v => v <= value).length;
  return (below / values.length) * 100;
}

// For a single just-rated puzzle, report — per metric — how its OWN value compares to the logged
// sample: its percentile among all logged values for that metric, and its percentile among the
// human grades of entries at-or-below its own human grade (i.e. "is this puzzle's metric value
// consistent with where its own difficulty rating would predict it to fall"). A metric that tracks
// difficulty well should put a puzzle's metric-percentile close to its human-grade-percentile; a
// large gap flags this specific puzzle as an outlier for that metric (which the aggregate
// correlation, an average over every puzzle, can hide).
export function singlePuzzleComparison(entry, entries) {
  const humanPercentile = percentileOf(entry.human, entries.map(e => e.human));
  return METRIC_DEFS.map(([id]) => {
    const xs = entries.map(e => e.metrics && e.metrics[id]).filter(x => Number.isFinite(x));
    const own = entry.metrics && entry.metrics[id];
    if (!Number.isFinite(own) || xs.length !== entries.length) return { id, metricPercentile: null, humanPercentile, gap: null };
    const metricPercentile = percentileOf(own, xs);
    return { id, metricPercentile, humanPercentile, gap: Math.abs(metricPercentile - humanPercentile) };
  });
}

// ---- plain-text export/import, meant to be pasted into chat ----
//
// One line per entry: TSV-ish, human-readable, diffable, and small enough to paste directly rather
// than needing a file download. The puzzle's own plain-text format (format.js's serialize/parse) is
// embedded so a puzzle can be re-derived/re-graded from the exported log alone, not just its metrics.
const EXPORT_HEADER = '# Zip difficulty rating log — one entry per line: source|human|ratedAt|puzzleText(|-escaped)|metricsJSON';

export function exportLogText(entries) {
  const lines = [EXPORT_HEADER];
  for (const e of entries) {
    const puzzleLine = e.key.replace(/\n/g, '\\n').replace(/\|/g, '\\pipe;');
    lines.push([e.source || '', e.human, e.ratedAt || '', puzzleLine, JSON.stringify(e.metrics)].join('|'));
  }
  return lines.join('\n');
}

export function parseLogText(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const [source, human, ratedAt, puzzleLineEsc, ...metricsParts] = parts;
    // metricsJSON may itself have contained '|' before our own escaping — rejoin defensively in
    // case a future metric value ever contains one (JSON.stringify of numbers never does today).
    const metricsJson = metricsParts.join('|');
    const key = puzzleLineEsc.replace(/\\pipe;/g, '|').replace(/\\n/g, '\n');
    let metrics; try { metrics = JSON.parse(metricsJson); } catch { continue; }
    entries.push({ source, human: +human, ratedAt, key, metrics });
  }
  return entries;
}

// Merge an imported log into the stored one — by key, imported entries win on conflict (re-importing
// your own export after editing it should update, not duplicate).
export async function importLogText(text) {
  const imported = parseLogText(text);
  const entries = await loadLog();
  for (const imp of imported) {
    const idx = entries.findIndex(e => e.key === imp.key);
    if (idx >= 0) entries[idx] = imp; else entries.push(imp);
  }
  await saveLog(entries);
  return entries;
}
