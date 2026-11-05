// Small statistics helpers shared by the tools that read behaviour rows
// (behaviour-eval.mjs, step-fit.mjs, step-sim.mjs).
export const sum = a => a.reduce((s, v) => s + v, 0);
export const mean = a => sum(a) / a.length;
export const quant = (a, q) => {
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
export const median = a => quant(a, 0.5);
export function rank(a) { // average ranks for ties
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = [];
  for (let i = 0, j; i < idx.length; i = j + 1) {
    for (j = i; j + 1 < idx.length && idx[j + 1][0] === idx[i][0];) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
  }
  return r;
}
export function pearson(x, y) {
  const mx = mean(x), my = mean(y);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - mx) * (y[i] - my);
    b += (x[i] - mx) ** 2;
    c += (y[i] - my) ** 2;
  }
  return a / Math.sqrt(b * c);
}
export const spearman = (x, y) => (x.length < 4 ? NaN : pearson(rank(x), rank(y)));
export const fmt = v => (Number.isFinite(v) ? v.toFixed(2).padStart(6) : '     —');
export const pct = v => (100 * v).toFixed(0) + '%';
// groups: arrays of row indices, one per cluster (a puzzle). One bootstrap resample of whole
// clusters -> the concatenated row indices.
export const resampleClusters = (groups, rnd) =>
  groups.flatMap(() => groups[Math.floor(rnd() * groups.length)]);
// [low, high] percentiles (default 95%) of the finite values, or [NaN, NaN] when under half are.
export function interval(values, size, level = 0.95) {
  const v = values.filter(Number.isFinite);
  if (!v.length || v.length < size / 2) return [NaN, NaN];
  return [quant(v, (1 - level) / 2), quant(v, 1 - (1 - level) / 2)];
}
