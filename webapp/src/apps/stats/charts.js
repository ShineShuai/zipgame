// Dependency-free SVG chart builders for the stats page: every function is pure and returns a markup string.
// Colors and fonts live in css/stats.css (classes only). Clickable days carry data-d="YYYYMMDD".
import { NB, T0_MS, RATIO } from '../../core/hist.js';

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
const hits = (days, x, sel, w) => days.map((d, i) => `<rect class="hit${d === sel ? ' sel' : ''}" data-d="${d}" x="${r1(x(i) - w / 2)}" y="${MT}" width="${r1(w)}" height="${H - MT - MB}"/>`).join('');

// Stacked bars: days = [YYYYMMDD], series = [{ name, cls, values }] (one value per day).
export function barsSvg(days, series, sel) {
  if (!days.length) return empty;
  const totals = days.map((_, i) => series.reduce((s, x) => s + x.values[i], 0)), max = Math.max(...totals), ticks = linTicks(max);
  const y = lin(0, ticks.at(-1), H - MB, MT), band = (W - ML - MR) / days.length, x = i => ML + band * (i + 0.5), bw = Math.max(2, band * 0.7);
  const bars = days.map((_, i) => { let base = 0; return series.map(s => { const v = s.values[i], top = base + v, out = v ? `<rect class="${s.cls}" x="${r1(x(i) - bw / 2)}" y="${r1(y(top))}" width="${r1(bw)}" height="${r1(y(base) - y(top))}"/>` : ''; base = top; return out; }).join(''); }).join('');
  return frame('Solves per day', grid(ticks, y, v => v) + bars + hits(days, x, sel, band) + dayLabels(days, x));
}

// Log-y lines with an optional p10..p90 band. lines = [{ cls, values }] (null = gap), band = { lo: [], hi: [] } (seconds).
export function linesSvg(days, lines, band, sel) {
  if (!days.length) return empty;
  const all = lines.flatMap(l => l.values).concat(band.lo, band.hi).filter(v => v > 0), lo = Math.min(...all) / 1.15, hi = Math.max(...all) * 1.15;
  const y = log(lo, hi, H - MB, MT), bandW = (W - ML - MR) / days.length, x = i => ML + bandW * (i + 0.5);
  const poly = days.map((_, i) => `${r1(x(i))},${r1(y(band.hi[i]))}`).concat(days.map((_, i) => days.length - 1 - i).map(i => `${r1(x(i))},${r1(y(band.lo[i]))}`)).join(' ');
  const path = v => v.map((val, i) => (val == null ? '' : `${v[i - 1] == null || i === 0 ? 'M' : 'L'}${r1(x(i))},${r1(y(val))}`)).join('');
  const dots = l => l.values.map((v, i) => (v == null ? '' : `<circle class="${l.cls}" cx="${r1(x(i))}" cy="${r1(y(v))}" r="2.5"/>`)).join('');
  return frame('Solve time per day', grid(timeTicks(lo, hi), y, fmtSec) + `<polygon class="band" points="${poly}"/>` +
    lines.map(l => `<path class="line ${l.cls}" d="${path(l.values)}"/>${dots(l)}`).join('') + hits(days, x, sel, bandW) + dayLabels(days, x));
}

// Histogram of one day. Bins are log-spaced, so the bin index IS a log time axis. marks = [{ label, ms, cls }].
export function histSvg(bins, marks) {
  const used = bins.flatMap((c, k) => (c ? [k] : []));
  if (!used.length) return empty;
  const k0 = Math.max(0, used[0] - 1), k1 = Math.min(NB - 1, used.at(-1) + 1), max = Math.max(...bins.slice(k0, k1 + 1)), ticks = linTicks(max);
  const raw = ms => Math.log(ms / T0_MS) / Math.log(RATIO), pos = ms => Math.max(k0, Math.min(k1 + 1, raw(ms))); // fractional bin index
  const x = lin(k0, k1 + 1, ML, W - MR), y = lin(0, ticks.at(-1), H - MB, MT), bw = (W - ML - MR) / (k1 + 1 - k0);
  const bars = bins.slice(k0, k1 + 1).map((c, i) => (c ? `<rect class="bar0" x="${r1(x(k0 + i) + 0.5)}" y="${r1(y(c))}" width="${r1(bw - 1)}" height="${r1(y(0) - y(c))}"/>` : '')).join('');
  const xt = TIME_TICKS.map(s => [s, raw(s * 1000)]).filter(([, p]) => p > k0 && p < k1 + 1);
  const axis = xt.map(([s, p]) => `<text class="tick" x="${r1(x(p))}" y="${H - 8}" text-anchor="middle">${fmtSec(s)}</text>`).join('');
  const lines = marks.map(m => `<line class="mark ${m.cls}" x1="${r1(x(pos(m.ms)))}" x2="${r1(x(pos(m.ms)))}" y1="${MT}" y2="${H - MB}"><title>${m.label}</title></line>`).join('');
  return frame('Solve time distribution', grid(ticks, y, v => v) + bars + lines + axis);
}

// Difficulty vs median solve time. points = [{ x: predicted grade 0..5, y: seconds, n, cls, label }]; log-y, dot area ~ n.
export function scatterSvg(points) {
  if (!points.length) return empty;
  const lo = Math.min(...points.map(p => p.y)) / 1.2, hi = Math.max(...points.map(p => p.y)) * 1.2, x = lin(0, 5, ML, W - MR), y = log(lo, hi, H - MB, MT);
  const xt = [0, 1, 2, 3, 4, 5].map(v => `<line class="grid" x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${MT}" y2="${H - MB}"/><text class="tick" x="${r1(x(v))}" y="${H - 8}" text-anchor="middle">${v}</text>`).join('');
  const dots = points.map(p => `<circle class="${p.cls}" cx="${r1(x(Math.max(0, Math.min(5, p.x))))}" cy="${r1(y(p.y))}" r="${r1(3 + Math.min(6, Math.sqrt(p.n) / 3))}"><title>${p.label}</title></circle>`).join('');
  return frame('Predicted difficulty vs median solve time', xt + grid(timeTicks(lo, hi), y, fmtSec) + dots);
}
