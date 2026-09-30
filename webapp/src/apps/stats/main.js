// Stats page: reads the Game-of-Day aggregates from every configured backend (in parallel), merges them and draws the charts.
import { LEADERBOARD } from '../../config.js';
import { backendsFromConfig } from '../../platform/leaderboard.js';
import { fetchStats } from '../../platform/stats-client.js';
import { mergeDays, dayStats, flagsOf, median, spearman, quantile, dayList } from '../../core/stats-merge.js';
import { parse } from '../../core/format.js';
import { validate } from '../../core/model.js';
import { trapMetrics } from '../../core/trap.js';
import { barsSvg, linesSvg, histSvg, scatterSvg, fmtSec } from './charts.js';

const NAMES = ['supabase', 'cloudflare'], MIN_SCATTER_N = 5, PUZZLE_URL = d => `../demo/GameOfDay/${d}.txt`;
const $ = id => document.getElementById(id);
const dot = color => `<i style="background:var(--${color})"></i>`;
const S = { source: 'merged', sel: null, results: [], puzzles: new Map(), run: 0 };
const backends = backendsFromConfig(LEADERBOARD);

const okResults = () => S.results.filter(r => r.status === 'ok');
const currentDays = () => (S.source === 'merged' ? mergeDays(okResults().map(r => r.days)) : (S.results.find(r => r.name === S.source) || { days: [] }).days);

function renderStatus() {
  $('status').innerHTML = NAMES.map(name => {
    const r = S.results.find(x => x.name === name);
    if (!r) return `<span class="chip off">${name}: not configured</span>`;
    return `<span class="chip ${r.status}">${name}: ${r.status === 'ok' ? `ok · ${r.ms} ms · ${r.days.length} days` : `failed · ${r.error}`}</span>`;
  }).join('');
  $('source').innerHTML = ['merged', ...okResults().map(r => r.name)].map(v => `<option${v === S.source ? ' selected' : ''}>${v}</option>`).join('');
}

function renderKpis(days) {
  const n = days.reduce((a, d) => a + d.n, 0), sumMs = days.reduce((a, d) => a + d.sum, 0), last = days.at(-1);
  const failover = new Set(), seen = new Set();
  for (const d of okResults().flatMap(r => r.days.map(x => x.d))) (seen.has(d) ? failover : seen).add(d);
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
  $('kpis').innerHTML = [kpi(n, 'solves'), kpi(days.length, 'days with data'), n ? kpi(fmtSec(sumMs / n / 1000), 'mean solve time') : '',
    days.length ? kpi(fmtSec(Math.min(...days.map(d => d.best[0] ?? Infinity)) / 1000), 'fastest solve') : '',
    last ? kpi(`${last.n}`, `solves on ${last.d}`) : '', okResults().length > 1 ? kpi(failover.size, 'days on both backends') : ''].join('');
}

function renderTrend(days) {
  const axis = days.map(d => d.d), stats = days.map(dayStats), names = S.source === 'merged' ? okResults().map(r => r.name) : [S.source];
  const series = names.map(name => { const byDay = new Map(S.results.find(r => r.name === name).days.map(x => [x.d, x.n])); return { name, cls: `c-${name}`, values: axis.map(d => byDay.get(d) || 0) }; });
  $('solves').innerHTML = barsSvg(axis, series, S.sel);
  $('times').innerHTML = linesSvg(axis, [{ cls: 'l-mean', values: stats.map(s => s.mean) }, { cls: 'l-p50', values: stats.map(s => s.p50) }, { cls: 'l-top', values: stats.map(s => s.top) }],
    { lo: stats.map(s => s.p10), hi: stats.map(s => s.p90) }, S.sel);
  $('timesLegend').innerHTML = `${dot('blue')}mean ${dot('green')}median ${dot('orange')}top-10 mean (n &gt; 10)` + (S.source === 'merged' ? ' · ' + names.map(n => `${dot(n === 'supabase' ? 'blue' : 'orange')}${n}`).join(' ') + ' (bars)' : '');
}

function renderDay(days) {
  const day = days.find(d => d.d === S.sel);
  if (!day) { $('dayTitle').textContent = 'Day'; $('hist').innerHTML = $('best').innerHTML = ''; return; }
  const s = dayStats(day);
  $('dayTitle').innerHTML = `${day.d} <small>· ${day.n} solves · mean ${fmtSec(s.mean)} · median ${fmtSec(s.p50)} · p10 ${fmtSec(s.p10)} · p90 ${fmtSec(s.p90)} (percentiles ±5 %)</small>`;
  $('hist').innerHTML = histSvg(day.bins, [['p10', s.p10], ['p50', s.p50], ['p90', s.p90], ['mean', s.mean]].map(([label, sec]) => ({ label: `${label} ${fmtSec(sec)}`, ms: sec * 1000, cls: `m-${label}` })));
  $('best').innerHTML = `<div class="chart"><table><tr>${day.best.map((_, i) => `<th>#${i + 1}</th>`).join('')}</tr><tr>${day.best.map(ms => `<td>${fmtSec(ms / 1000)}</td>`).join('')}</tr></table></div>`;
}

function renderFlags(days) {
  const medN = median(days.map(d => d.n)), rows = days.map(d => [d.d, flagsOf(d, medN)]).filter(([, f]) => f.invariant.length || f.heuristic.length);
  $('flags').innerHTML = rows.length
    ? `<table>${rows.map(([d, f]) => `<tr><td data-d="${d}">${d}</td><td>${f.invariant.map(t => `<span class="tag">${t}</span>`).join('')}${f.heuristic.map(t => `<span class="tag soft">${t}</span>`).join('')}</td></tr>`).join('')}</table>`
    : '<p class="note">No invariant violations or suspicious days in this range.</p>';
}

function renderScatter(days) {
  const pts = days.filter(d => d.n >= MIN_SCATTER_N && S.puzzles.get(d.d)).map(d => ({ d, p: S.puzzles.get(d.d), s: dayStats(d) }));
  const sizes = [...new Set(pts.map(x => x.p.size))].sort((a, b) => a - b), rho = list => spearman(list.map(x => x.p.predicted), list.map(x => x.s.p50));
  const fmtRho = list => { const r = rho(list); return r === null ? 'ρ n/a' : `ρ ${r.toFixed(2)}`; };
  $('scatter').innerHTML = scatterSvg(pts.map(x => ({ x: x.p.predicted, y: x.s.p50, n: x.d.n, cls: `c${sizes.indexOf(x.p.size) % 6}`, label: `${x.d.d} · ${x.p.size}×${x.p.size} · predicted ${x.p.predicted.toFixed(2)} · median ${fmtSec(x.s.p50)} · n=${x.d.n}` })));
  $('scatterLegend').innerHTML = pts.length ? `all days: ${pts.length}, ${fmtRho(pts)} · ` + sizes.map((sz, i) => { const list = pts.filter(x => x.p.size === sz); return `<span><i class="c${i % 6}" style="background:var(--${['blue', 'orange', 'green', 'violet', 'teal', 'red'][i % 6]})"></i>${sz}×${sz}: ${list.length} days, ${fmtRho(list)}</span>`; }).join('') : '';
}

function render() {
  if (S.source !== 'merged' && !okResults().some(r => r.name === S.source)) S.source = 'merged'; // the chosen backend failed on this load
  renderStatus();
  const days = currentDays();
  if (!days.some(d => d.d === S.sel)) S.sel = days.at(-1)?.d ?? null;
  renderKpis(days); renderTrend(days); renderDay(days); renderFlags(days); renderScatter(days);
}

// Grades each day's puzzle with the trap model (same code as the play badge); one puzzle per tick so the page stays responsive.
async function gradePuzzles(run) {
  const todo = currentDays().map(d => d.d).filter(d => !S.puzzles.has(d));
  $('scatterNote').textContent = 'x = trap grade prediction (0–5, unrounded); y = median from bins (±5 %); days with ≥ 5 solves. Times include +180 s per hint used. Sizes differ: compare ρ within a size.';
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
    if (i % 5 === 4 || i === todo.length - 1) { renderScatter(currentDays()); await new Promise(r => setTimeout(r)); }
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
document.addEventListener('click', e => {
  const el = e.target.closest('[data-d]');
  if (el) { S.sel = +el.dataset.d; render(); }
});
load();
