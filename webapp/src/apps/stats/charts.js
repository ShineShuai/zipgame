// Dependency-free SVG chart builders for the stats page: every function is pure and returns a markup string.
// Colors and fonts live in css/stats.css (classes only). Clickable days carry data-d="YYYYMMDD".
// Hover text: any element with data-tip="line\nline" is shown by tooltip.js. Seed players are drawn as hollow dots (class seed) / grey bars (bar-seed).
import { NB, T0_MS, RATIO } from '../../core/hist.js';
import { binLo, binHi } from '../../core/stats-merge.js';

const W = 640, H = 230, ML = 46, MR = 12, MT = 10, MB = 28;
const r1 = x => +x.toFixed(1);
const lin = (d0, d1, a, b) => v => a + ((v - d0) / (d1 - d0 || 1)) * (b - a);
const log = (d0, d1, a, b) => { const l0 = Math.log(d0), l1 = Math.log(d1); return v => a + ((Math.log(v) - l0) / (l1 - l0 || 1)) * (b - a); };
const frame = (label, body) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${body}</svg>`;
export const empty = '<p class="empty">No data in this range.</p>';

export const fmtSec = s => (s < 60 ? `${+s.toFixed(s < 10 ? 1 : 0)}s` : `${+(s / 60).toFixed(1)}m`);
const mmdd = d => `${String(d).slice(4, 6)}-${String(d).slice(6)}`;

// Ticks: linear from 0 (1-2-5 steps, about 4 of them), or clock-friendly seconds for the log time axes (falls back to the two ends when fewer than 2 fit).
export function linTicks(max) {
  const raw = max / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw)), step = mag * ([1, 2, 5, 10].find(m => m * mag >= raw));
  const out = []; for (let v = 0; v < max + step; v += step) { out.push(v); if (v >= max) break; }
  return out;
}
export const TIME_TICKS = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800];
export const timeTicks = (lo, hi) => { const t = TIME_TICKS.filter(v => v >= lo && v <= hi); return t.length >= 2 ? t : [lo, hi]; };

const grid = (ticks, y, fmt) => ticks.map(t => `<line class="grid" x1="${ML}" x2="${W - MR}" y1="${r1(y(t))}" y2="${r1(y(t))}"/><text class="tick" x="${ML - 6}" y="${r1(y(t)) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
const dayLabels = (days, x) => { const every = Math.ceil(days.length / 8); return days.map((d, i) => (i % every ? '' : `<text class="tick" x="${r1(x(i))}" y="${H - 8}" text-anchor="middle">${mmdd(d)}</text>`)).join(''); };

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': '&#10;' };
const esc = text => String(text).replace(/[&<>"\n]/g, c => ESCAPES[c]);
const tip = lines => `data-tip="${esc([lines].flat().join('\n'))}"`;

// One transparent column per day: click selects the day, hover shows tips[i] (an array of lines, or a string).
function hits(days, x, sel, w, tips = []) {
  return days.map((d, i) => {
    const cls = d === sel ? 'hit sel' : 'hit';
    const text = tips[i] ? ` ${tip(tips[i])}` : '';
    return `<rect class="${cls}" data-d="${d}"${text} x="${r1(x(i) - w / 2)}" y="${MT}" width="${r1(w)}" height="${H - MT - MB}"/>`;
  }).join('');
}

// A visible dot plus a transparent, larger twin that takes the hover and the click.
function dot(cls, cx, cy, r, text, day) {
  const dayAttr = day ? ` data-d="${day}"` : '';
  const shape = `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  const target = `<circle class="pt"${dayAttr} ${tip(text)} cx="${cx}" cy="${cy}" r="${Math.max(r, 7)}"/>`;
  return shape + target;
}

// Stacked bars: days = [YYYYMMDD], series = [{ name, cls, values }] (one value per day), tips = one array of lines per day.
export function barsSvg(days, series, sel, tips = []) {
  if (!days.length) return empty;
  const totals = days.map((_, i) => series.reduce((total, s) => total + s.values[i], 0));
  const ticks = linTicks(Math.max(...totals));
  const y = lin(0, ticks.at(-1), H - MB, MT);
  const band = (W - ML - MR) / days.length;
  const x = i => ML + band * (i + 0.5);
  const barWidth = Math.max(2, band * 0.7);
  const bars = days.map((_, i) => {
    let base = 0;
    return series.map(s => {
      const value = s.values[i];
      const top = base + value;
      const rect = value
        ? `<rect class="${s.cls}" x="${r1(x(i) - barWidth / 2)}" y="${r1(y(top))}" width="${r1(barWidth)}" height="${r1(y(base) - y(top))}"/>`
        : '';
      base = top;
      return rect;
    }).join('');
  }).join('');
  return frame('Solves per day', grid(ticks, y, v => v) + hits(days, x, sel, band, tips) + bars + dayLabels(days, x));
}

// Log-y lines with an optional p10..p90 band.
//   lines = [{ name, cls, values }] (null = gap, seconds), band = { lo: [], hi: [] } (seconds)
//   seeds[i] = [{ ms, copies }]: the seed players of day i, drawn as hollow dots; tips[i] = lines of the day's tooltip
export function linesSvg(days, lines, band, sel, { seeds = [], tips = [] } = {}) {
  if (!days.length) return empty;
  const seedSeconds = seeds.flat().map(s => s.ms / 1000);
  const all = lines.flatMap(l => l.values).concat(band.lo, band.hi, seedSeconds).filter(v => v > 0);
  const lo = Math.min(...all) / 1.15;
  const hi = Math.max(...all) * 1.15;
  const y = log(lo, hi, H - MB, MT);
  const bandW = (W - ML - MR) / days.length;
  const x = i => ML + bandW * (i + 0.5);

  const upper = days.map((_, i) => `${r1(x(i))},${r1(y(band.hi[i]))}`);
  const lower = days.map((_, i) => days.length - 1 - i).map(i => `${r1(x(i))},${r1(y(band.lo[i]))}`);
  const path = values => values.map((v, i) => {
    if (v == null) return '';
    const move = i === 0 || values[i - 1] == null ? 'M' : 'L';
    return `${move}${r1(x(i))},${r1(y(v))}`;
  }).join('');
  const points = line => line.values.map((v, i) => {
    if (v == null) return '';
    return dot(line.cls, r1(x(i)), r1(y(v)), 2.5, `${mmdd(days[i])} · ${line.name} ${fmtSec(v)}`, days[i]);
  }).join('');
  const seedDots = seeds.map((list, i) => list.map(s => {
    const times = s.copies > 1 ? ` ×${s.copies}` : '';
    return dot('seed', r1(x(i)), r1(y(s.ms / 1000)), 3, `${mmdd(days[i])} · seed player ${fmtSec(s.ms / 1000)}${times}`, days[i]);
  }).join('')).join('');
  const drawn = lines.map(l => `<path class="line ${l.cls}" d="${path(l.values)}"/>${points(l)}`).join('');

  return frame('Solve time per day',
    grid(timeTicks(lo, hi), y, fmtSec) + hits(days, x, sel, bandW, tips) +
    `<polygon class="band" points="${upper.concat(lower).join(' ')}"/>` + drawn + seedDots + dayLabels(days, x));
}

// Histogram of one day. Bins are log-spaced, so the bin index IS a log time axis.
//   marks = [{ label, ms, cls }]; seedBins[k] = how many of the players in bin k are seed players (drawn grey on top of the real ones)
export function histSvg(bins, marks, seedBins = []) {
  const used = bins.flatMap((c, k) => (c ? [k] : []));
  if (!used.length) return empty;
  const k0 = Math.max(0, used[0] - 1);
  const k1 = Math.min(NB - 1, used.at(-1) + 1);
  const max = Math.max(...bins.slice(k0, k1 + 1));
  const ticks = linTicks(max);
  const raw = ms => Math.log(ms / T0_MS) / Math.log(RATIO); // fractional bin index
  const pos = ms => Math.max(k0, Math.min(k1 + 1, raw(ms)));
  const x = lin(k0, k1 + 1, ML, W - MR);
  const y = lin(0, ticks.at(-1), H - MB, MT);
  const bw = (W - ML - MR) / (k1 + 1 - k0);

  const bars = bins.slice(k0, k1 + 1).map((count, i) => {
    if (!count) return '';
    const k = k0 + i;
    const seed = seedBins[k] ?? 0;
    const real = count - seed;
    const text = [`${fmtSec(binLo(k) / 1000)} – ${fmtSec(binHi(k) / 1000)}`, `${count} player${count === 1 ? '' : 's'}${seed ? `, ${seed} of them seed` : ''}`];
    const left = r1(x(k) + 0.5);
    const width = r1(bw - 1);
    const realBar = real ? `<rect class="bar0" ${tip(text)} x="${left}" y="${r1(y(real))}" width="${width}" height="${r1(y(0) - y(real))}"/>` : '';
    const seedBar = seed ? `<rect class="bar-seed" ${tip(text)} x="${left}" y="${r1(y(count))}" width="${width}" height="${r1(y(real) - y(count))}"/>` : '';
    return realBar + seedBar;
  }).join('');
  const xt = TIME_TICKS.map(s => [s, raw(s * 1000)]).filter(([, p]) => p > k0 && p < k1 + 1);
  const axis = xt.map(([s, p]) => `<text class="tick" x="${r1(x(p))}" y="${H - 8}" text-anchor="middle">${fmtSec(s)}</text>`).join('');
  const lines = marks.map(m => {
    const at = r1(x(pos(m.ms)));
    const coords = `x1="${at}" x2="${at}" y1="${MT}" y2="${H - MB}"`;
    return `<line class="mark ${m.cls}" ${coords}/><line class="mark-hit" ${tip(m.label)} ${coords}/>`;
  }).join('');
  return frame('Solve time distribution', grid(ticks, y, v => v) + bars + lines + axis);
}

// Difficulty vs median solve time. points = [{ x: predicted grade 0..5, y: seconds, n, cls, label, seeds? }]; log-y, dot area ~ n.
// seeds = [{ ms, label }]: the day's seed players, hollow dots in the same column as the day's dot.
export function scatterSvg(points) {
  if (!points.length) return empty;
  const seedSeconds = points.flatMap(p => (p.seeds || []).map(s => s.ms / 1000));
  const values = points.map(p => p.y).concat(seedSeconds);
  const lo = Math.min(...values) / 1.2;
  const hi = Math.max(...values) * 1.2;
  const x = lin(0, 5, ML, W - MR);
  const y = log(lo, hi, H - MB, MT);
  const xt = [0, 1, 2, 3, 4, 5].map(v => `<line class="grid" x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${MT}" y2="${H - MB}"/><text class="tick" x="${r1(x(v))}" y="${H - 8}" text-anchor="middle">${v}</text>`).join('');
  const column = p => r1(x(Math.max(0, Math.min(5, p.x))));
  const seedDots = points.map(p => (p.seeds || []).map(s => dot('seed', column(p), r1(y(s.ms / 1000)), 3, s.label)).join('')).join('');
  const dots = points.map(p => {
    const radius = r1(3 + Math.min(6, Math.sqrt(p.n) / 3));
    return `<circle class="${p.cls}" ${tip(p.label)} cx="${column(p)}" cy="${r1(y(p.y))}" r="${radius}"/>`;
  }).join('');
  return frame('Predicted difficulty vs median solve time', xt + grid(timeTicks(lo, hi), y, fmtSec) + seedDots + dots);
}
