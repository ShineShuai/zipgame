// Welford online mean/variance. JSON shape is unchanged (stored data stays compatible).
export const newStat = () => ({ n: 0, mean: 0, M2: 0, recent: [] });
export function updateStat(st, x) {
  st.n++; const d = x - st.mean; st.mean += d / st.n; st.M2 += d * (x - st.mean);
  st.recent.push(x); if (st.recent.length > 20) st.recent.shift();
  return st;
}
export const statSummary = st => st.n === 0 ? { n: 0, mean: 0, sd: 0 } : { n: st.n, mean: st.mean, sd: Math.sqrt(st.n > 1 ? st.M2 / (st.n - 1) : 0) };
