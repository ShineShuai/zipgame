// Stats page: reads the Game-of-Day aggregates from every configured backend (in parallel), combines them (stats-merge combineDays) and draws the charts.
import { LEADERBOARD } from '../../config.js';
import { backendsFromConfig } from '../../platform/leaderboard.js';
import { fetchStats } from '../../platform/stats-client.js';
import { combineDays, isReplicated, dayStats, flagsOf, median, spearman, quantile, dayList } from '../../core/stats-merge.js';
import { withoutSeeds } from '../../core/gotd-model.js';
import { NB, binOf } from '../../core/hist.js';
import { parse } from '../../core/format.js';
import { validate } from '../../core/model.js';
import { trapMetrics } from '../../core/trap.js';
import { barsSvg, linesSvg, histSvg, scatterSvg, fmtSec } from './charts.js';
import { initTooltip } from './tooltip.js';

const MIN_SCATTER_N = 5, PUZZLE_URL = d => `../demo/GameOfDay/${d}.txt`;
const $ = id => document.getElementById(id);
const dot = color => `<i style="background:var(--${color})"></i>`;
const hollow = '<i class="hollow"></i>';
const S = { source: 'combined', seeds: true, sel: null, results: [], puzzles: new Map(), run: 0 };
const setup = backendsFromConfig(LEADERBOARD);
const backends = setup.list;
const COLORS = ['blue', 'orange', 'green', 'violet', 'teal', 'red'];
const colorIndex = name => backends.findIndex(be => be.name === name) % COLORS.length; // by position in the config: a backend keeps its colour when another one fails
const replicatedFrom = LEADERBOARD.replicatedFrom ?? Infinity;
const replicatedTo = LEADERBOARD.replicatedTo ?? Infinity;

const okResults = () => S.results.filter(r => r.status === 'ok');
const storedDays = () => (S.source === 'combined' ? combineDays(okResults(), replicatedFrom, replicatedTo) : (S.results.find(r => r.name === S.source) || { days: [] }).days);
const isoDay = d => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}`;

// The days as the charts show them: with the seed players as stored, or without them (n, sum, bins and best of the real players only).
// A day whose seeds do not fit into its aggregate (edited by hand) stays as stored; days with no real player drop out.
function shownDays() {
  const days = storedDays();
  if (S.seeds) return days;
  return days.map(day => withoutSeeds(day) ?? day).filter(day => day.n > 0);
}

// seed times of a day with how often each time occurs: a day added up from several backends (not a replicated day) lists every seed once per backend (the seeds are written to all).
function seedDots(day) {
  const copies = new Map();
  for (const ms of day.seeds) copies.set(ms, (copies.get(ms) ?? 0) + 1);
  return [...copies].map(([ms, count]) => ({ ms, copies: count }));
}
const copiesText = copies => (copies > 1 ? ` ×${copies}` : '');

// Marks the seed times among the fastest times (one best entry per seed).
function bestCells(day) {
  const pending = [...day.seeds];
  return day.best.map(ms => {
    const at = pending.indexOf(ms);
    if (at >= 0) pending.splice(at, 1);
    return { ms, seed: at >= 0 };
  });
}

function dayTip(day, stats) {
  const lines = [
    `${isoDay(day.d)} · ${day.n} players`,
    `mean ${fmtSec(stats.mean)}`,
    `median ${fmtSec(stats.p50)}`,
    `p10 – p90: ${fmtSec(stats.p10)} – ${fmtSec(stats.p90)}`,
  ];
  if (stats.top !== null) lines.push(`top-10 mean ${fmtSec(stats.top)}`);
  if (day.seeds.length) lines.push(`seed players (${day.seeds.length}): ${day.seeds.map(ms => fmtSec(ms / 1000)).join(' ')}`);
  return lines;
}

function renderStatus() {
  $('status').innerHTML = Object.keys(LEADERBOARD.backends).map(name => {
    const role = name === LEADERBOARD.always ? ' (always written)' : '';
    const r = S.results.find(x => x.name === name);
    if (!r) return `<span class="chip off">${name}${role}: not configured</span>`;
    return `<span class="chip ${r.status}">${name}${role}: ${r.status === 'ok' ? `ok · ${r.ms} ms · ${r.days.length} days` : `failed · ${r.error}`}</span>`;
  }).join('');
  $('source').innerHTML = ['combined', ...okResults().map(r => r.name)].map(v => `<option${v === S.source ? ' selected' : ''}>${v}</option>`).join('');
}

// Replicated days (replicatedFrom..replicatedTo) on which the always-written backend holds fewer players than the fullest copy: some solves never reached it.
// Days before the first one it has data for are not its gaps (it was added later: the switch to another always-written backend).
// null when there is no always-written backend or it failed on this load.
function daysPrimaryLags() {
  const primary = okResults().find(r => r.name === (setup.always && setup.always.name));
  if (!primary) return null;
  const own = new Map(primary.days.map(day => [day.d, day.n]));
  const firstOwn = Math.min(...own.keys());
  return combineDays(okResults(), replicatedFrom, replicatedTo)
    .filter(day => isReplicated(day.d, replicatedFrom, replicatedTo) && day.d >= firstOwn && (own.get(day.d) ?? 0) < day.n)
    .length;
}

function renderKpis(days) {
  const n = days.reduce((a, d) => a + d.n, 0), sumMs = days.reduce((a, d) => a + d.sum, 0), last = days.at(-1);
  const seedCount = days.reduce((a, d) => a + d.seeds.length, 0);
  const lag = daysPrimaryLags();
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
  $('kpis').innerHTML = [kpi(n, 'solves'), kpi(days.length, 'days with data'), n ? kpi(fmtSec(sumMs / n / 1000), 'mean solve time') : '',
    days.length ? kpi(fmtSec(Math.min(...days.map(d => d.best[0] ?? Infinity)) / 1000), 'fastest solve') : '',
    last ? kpi(`${last.n}`, `solves on ${last.d}`) : '', lag === null ? '' : kpi(lag, `days ${setup.always.name} lacks players`),
    seedCount ? kpi(seedCount, 'seed players among the solves') : ''].join('');
}

function renderTrend(days) {
  const axis = days.map(d => d.d);
  const stats = days.map(dayStats);
  const names = S.source === 'combined' ? okResults().map(r => r.name) : [S.source];
  const tips = days.map((day, i) => dayTip(day, stats[i]));

  // players per backend; a day counts for the backends it was taken from (one copy on a replicated day, the sum of all on any other).
  // With seeds on, the seed players are their own grey segment instead of part of the backend's count.
  const srcOf = new Map(storedDays().map(day => [day.d, day.src || [S.source]]));
  const takenFrom = (name, d) => (srcOf.get(d) || []).includes(name);
  const stored = new Map(names.map(name => [name, new Map(S.results.find(r => r.name === name).days.map(x => [x.d, x]))]));
  const series = names.map(name => ({
    name,
    cls: `bar${colorIndex(name)}`,
    values: axis.map(d => {
      const day = stored.get(name).get(d);
      return day && takenFrom(name, d) ? day.n - day.seeds.length : 0;
    }),
  }));
  if (S.seeds) {
    const seedsOf = d => names.reduce((total, name) => total + (takenFrom(name, d) ? stored.get(name).get(d)?.seeds.length ?? 0 : 0), 0);
    series.push({ name: 'seed players', cls: 'c-seed', values: axis.map(seedsOf) });
  }
  const barTips = axis.map((d, i) => {
    const total = series.reduce((sum, s) => sum + s.values[i], 0);
    return [`${isoDay(d)} · ${total} players`, ...series.filter(s => s.values[i]).map(s => `${s.name}: ${s.values[i]}`)];
  });
  $('solves').innerHTML = barsSvg(axis, series, S.sel, barTips);

  const lines = [
    { name: 'mean', cls: 'l-mean', values: stats.map(s => s.mean) },
    { name: 'median', cls: 'l-p50', values: stats.map(s => s.p50) },
    { name: 'top-10 mean', cls: 'l-top', values: stats.map(s => s.top) },
  ];
  const band = { lo: stats.map(s => s.p10), hi: stats.map(s => s.p90) };
  const seeds = S.seeds ? days.map(seedDots) : [];
  $('times').innerHTML = linesSvg(axis, lines, band, S.sel, { seeds, tips });

  const legend = [`${dot('blue')}mean`, `${dot('green')}median`, `${dot('orange')}top-10 mean (n &gt; 10)`];
  if (S.seeds) legend.push(`${hollow}seed players`);
  if (S.source === 'combined') legend.push(names.map(n => `${dot(COLORS[colorIndex(n)])}${n}`).join(' ') + ' (bars)');
  $('timesLegend').innerHTML = legend.join(' · ');
}

function renderDay(days) {
  const day = days.find(d => d.d === S.sel);
  if (!day) {
    $('dayTitle').textContent = 'Day';
    $('hist').innerHTML = '';
    $('best').innerHTML = '';
    $('histLegend').innerHTML = '';
    return;
  }
  const s = dayStats(day);
  $('dayTitle').innerHTML = `${day.d} <small>· ${day.n} solves · mean ${fmtSec(s.mean)} · median ${fmtSec(s.p50)} · p10 ${fmtSec(s.p10)} · p90 ${fmtSec(s.p90)} (percentiles ±5 %)</small>`;
  const marks = [['p10', s.p10], ['p50', s.p50], ['p90', s.p90], ['mean', s.mean]].map(([label, sec]) => ({ label: `${label} ${fmtSec(sec)}`, ms: sec * 1000, cls: `m-${label}` }));
  const seedBins = new Array(NB).fill(0);
  for (const ms of day.seeds) seedBins[binOf(ms)] += 1;
  $('hist').innerHTML = histSvg(day.bins, marks, seedBins);
  $('histLegend').innerHTML = day.seeds.length ? `${dot('blue')}real players ${dot('seed')}seed players (${day.seeds.length}, grey in the table too)` : '';

  const cells = bestCells(day);
  const heads = cells.map((_, i) => `<th>#${i + 1}</th>`).join('');
  const times = cells.map(c => `<td${c.seed ? ' class="seed"' : ''}>${fmtSec(c.ms / 1000)}</td>`).join('');
  $('best').innerHTML = `<div class="chart"><table><tr>${heads}</tr><tr>${times}</tr></table></div>`;
}

function renderFlags(days) {
  const medN = median(days.map(d => d.n)), rows = days.map(d => [d.d, flagsOf(d, medN)]).filter(([, f]) => f.invariant.length || f.heuristic.length);
  $('flags').innerHTML = rows.length
    ? `<table>${rows.map(([d, f]) => `<tr><td data-d="${d}">${d}</td><td>${f.invariant.map(t => `<span class="tag">${t}</span>`).join('')}${f.heuristic.map(t => `<span class="tag soft">${t}</span>`).join('')}</td></tr>`).join('')}</table>`
    : '<p class="note">No invariant violations or suspicious days in this range.</p>';
}

function renderScatter(days) {
  const pts = days.filter(d => d.n >= MIN_SCATTER_N && S.puzzles.get(d.d)).map(d => ({ d, p: S.puzzles.get(d.d), s: dayStats(d) }));
  const sizes = [...new Set(pts.map(x => x.p.size))].sort((a, b) => a - b);
  const rho = list => spearman(list.map(x => x.p.predicted), list.map(x => x.s.p50));
  const fmtRho = list => {
    const r = rho(list);
    return r === null ? 'ρ n/a' : `ρ ${r.toFixed(2)}`;
  };
  const seedsOf = x => (S.seeds ? seedDots(x.d) : []).map(seed => ({
    ms: seed.ms,
    label: `${isoDay(x.d.d)} · seed player ${fmtSec(seed.ms / 1000)}${copiesText(seed.copies)} · shown at the day's predicted ${x.p.predicted.toFixed(2)}`,
  }));
  $('scatterNote').textContent = 'x = trap grade prediction (0–5, unrounded); y = median from bins (±5 %); days with ≥ 5 solves. Times include +180 s per hint used. Sizes differ: compare ρ within a size.' +
    (S.seeds ? ' Hollow dots = the day\'s seed players (same x as the day; their own difficulty is not stored); medians include them.' : ' Seed players are left out.');
  $('scatter').innerHTML = scatterSvg(pts.map(x => ({
    x: x.p.predicted,
    y: x.s.p50,
    n: x.d.n,
    cls: `c${sizes.indexOf(x.p.size) % 6}`,
    label: `${x.d.d} · ${x.p.size}×${x.p.size} · predicted ${x.p.predicted.toFixed(2)} · median ${fmtSec(x.s.p50)} · n=${x.d.n}`,
    seeds: seedsOf(x),
  })));
  const colors = ['blue', 'orange', 'green', 'violet', 'teal', 'red'];
  const perSize = sizes.map((sz, i) => {
    const list = pts.filter(x => x.p.size === sz);
    return `<span><i class="c${i % 6}" style="background:var(--${colors[i % 6]})"></i>${sz}×${sz}: ${list.length} days, ${fmtRho(list)}</span>`;
  });
  $('scatterLegend').innerHTML = pts.length ? `all days: ${pts.length}, ${fmtRho(pts)} · ${perSize.join('')}` : '';
}

function render() {
  if (S.source !== 'combined' && !okResults().some(r => r.name === S.source)) S.source = 'combined'; // the chosen backend failed on this load
  renderStatus();
  const days = shownDays();
  if (!days.some(d => d.d === S.sel)) S.sel = days.at(-1)?.d ?? null;
  renderKpis(days);
  renderTrend(days);
  renderDay(days);
  renderFlags(storedDays()); // anomalies are about the stored data, whatever the seed toggle shows
  renderScatter(days);
}

// Grades each day's puzzle with the trap model (same code as the play badge); one puzzle per tick so the page stays responsive.
async function gradePuzzles(run) {
  const todo = storedDays().map(d => d.d).filter(d => !S.puzzles.has(d));
  for (const [i, d] of todo.entries()) {
    if (run !== S.run) return;
    let entry = null;
    try {
      const res = await fetch(PUZZLE_URL(d));
      const p = res.ok && parse(await res.text());
      const m = p && validate(p).ok && trapMetrics(p);
      if (m && m.ok) entry = { size: p.n, predicted: m.predicted, grade: m.grade };
    } catch { /* missing or unparsable puzzle file: day is left out of the scatter */ }
    S.puzzles.set(d, entry);
    if (i % 5 === 4 || i === todo.length - 1) { renderScatter(shownDays()); await new Promise(r => setTimeout(r)); }
  }
}

async function load() {
  const run = ++S.run, days = +$('range').value, list = dayList(days);
  $('status').innerHTML = '<span class="chip">loading…</span>';
  if (!backends.length) { $('status').innerHTML = '<span class="chip failed">no backend configured (src/config.js)</span>'; return; }
  S.results = await fetchStats(backends, { from: list[0], to: list.at(-1) });
  if (run !== S.run) return;
  render();
  await gradePuzzles(run);
}

$('range').addEventListener('change', load);
$('source').addEventListener('change', e => { S.source = e.target.value; render(); });
$('seeds').addEventListener('change', e => {
  S.seeds = e.target.checked;
  render();
});
initTooltip();
document.addEventListener('click', e => {
  const el = e.target.closest('[data-d]');
  if (el) { S.sel = +el.dataset.d; render(); }
});
load();
