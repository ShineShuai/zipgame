// Human-technique ladder grader (PROTOTYPE). Direction-independent: no search head, no DFS order.
//
// Model: one variable per grid edge (unknown / in / out). Cell degree must be 2 (1 for checkpoint 1
// and K). Chains (= runs of `in` edges) carry checkpoint info so ordering is enforced.
// Techniques are applied strictly easiest-first; a harder one runs only when all easier ones stall:
//   1 local      degree rules: cell with exactly `need` open edges -> all in; `need` in-edges -> rest out
//   2 chain      no cycles, checkpoint order at chain junctions, no premature full-length chain
//   3 territory  segment-slack: a cell can only lie on segments whose detour fits the global slack;
//                an edge between cells with no common possible segment is out
//   4 probe1     one what-if: assume an edge in/out, run 1-3; contradiction => opposite; the edges
//                forced in BOTH branches are forced
//   5 probe2     what-if nested inside a what-if
//   6 search     plain branching over 1-3 (fallback; node count reported)
// Result carries per-level counts, so a grade can be fitted on them (see tools/ladder-eval.mjs).
//
// Cost (T = N^2 cells, K checkpoints): L1+L2 amortised O(T) per solve; L3 = O(K*T) per call, run only
// when L1/L2 stall and edges were removed since the last run; probe1 = O(T) trials x cost(L1-3);
// probe2 = O(T^2) trials, hence the work cap.
import { maxNumber, startCell, endCell } from './model.js';
import { buildNeighbors } from './solver/prune.js';

export const LEVELS = ['', 'local', 'chain', 'territory', 'probe1', 'probe2', 'search'];
const FIELDS = ['es', 'din', 'dopen', 'other', 'sz', 'cnt', 'lo', 'hi', 'near', 'dflag', 'meta'];
const CAP = { cap: true };

export function ladder(p, o = {}) {
  const t0 = performance.now();
  const pdMax = o.probeDepth ?? 2;
  const workCap = o.workCap ?? 3e6;
  const { nb, T } = buildNeighbors(p);
  const K = maxNumber(p), cp = p.cp, start = startCell(p), end = endCell(p);
  if (K < 2) return { error: 'K<2' };
  const pos = new Int32Array(K + 2).fill(-1);
  for (let i = 0; i < T; i++) if (cp[i]) pos[cp[i]] = i;
  const need = new Uint8Array(T).fill(2);
  need[start] = 1; need[end] = 1;
  // Holes (puzzle.holes, see model.js) are not part of the board: no edges, nothing to cover.
  // A hole needs 0 edges, so its degree constraint is satisfied from the start, and the path
  // covers TC cells instead of T.
  const holes = p.holes || null;
  let TC = T;
  if (holes) {
    for (let i = 0; i < T; i++) {
      if (holes[i]) {
        need[i] = 0;
        TC--;
      }
    }
  }

  // ---- state (cloneable) ----
  // es[u*4+d]: 0 unknown, 1 in, 2 out (mirrored on both half-edges). dopen = non-out edges, din = in edges.
  // Chains, stored at both ends: other (opposite end), sz (cells), cnt/lo/hi (checkpoints inside),
  // near (nearest checkpoint walking inward, 0 = none). dflag = end cell whose chain changed (L2 recheck).
  // meta[0]: count of cells whose degree constraint is already satisfied (din === need).
  const mk = () => ({
    es: new Uint8Array(T * 4), din: new Uint8Array(T), dopen: new Uint8Array(T),
    other: new Int16Array(T), sz: new Int16Array(T), cnt: new Int16Array(T),
    lo: new Int16Array(T), hi: new Int16Array(T), near: new Int16Array(T),
    dflag: new Uint8Array(T), meta: new Int32Array(3),
  });
  const copy = (dst, src) => { for (const f of FIELDS) dst[f].set(src[f]); };
  const real = mk();
  let S = real;
  let initBad = false;
  for (let u = 0; u < T; u++) {
    let open = 0;
    for (let d = 0; d < 4; d++) { if (nb[u * 4 + d] >= 0) open++; else real.es[u * 4 + d] = 2; }
    real.dopen[u] = open;
    if (open < need[u]) initBad = true;
    real.other[u] = u; real.sz[u] = 1; real.cnt[u] = cp[u] ? 1 : 0;
    real.lo[u] = real.hi[u] = real.near[u] = cp[u]; real.dflag[u] = 1;
    if (need[u] === 0) real.meta[0]++;
  }
  if (initBad) return { error: 'cell with too few open edges' };

  // ---- bookkeeping ----
  const q = [];
  for (let u = 0; u < T; u++) q.push(u);
  let rec = true, lvl = 1, work = 0;
  const edgesBy = new Array(7).fill(0), passesBy = new Array(7).fill(0);
  let probeTrials = 0;

  const min0 = (a, b) => (!a ? b : !b ? a : Math.min(a, b));

  // Join the chains of u and v (edge u-v just went `in`, din already bumped). false = contradiction.
  function merge(u, v) {
    const a = S.other[u], b = S.other[v];
    if (a === v) return false;                                 // closes a cycle
    const pu = S.near[u], pv = S.near[v];
    if (pu && pv && pu - pv !== 1 && pv - pu !== 1) return false; // checkpoints at the junction not consecutive
    const size = S.sz[u] + S.sz[v];
    const lo = min0(S.lo[u], S.lo[v]), hi = Math.max(S.hi[u], S.hi[v]);
    // a full-length chain must cover everything
    if (lo === 1 && hi === K && size !== TC) return false;
    const c = S.cnt[u] + S.cnt[v];
    const nearA = S.near[a] || pv, nearB = S.near[b] || pu;
    S.other[a] = b; S.other[b] = a;
    S.sz[a] = S.sz[b] = size; S.cnt[a] = S.cnt[b] = c; S.lo[a] = S.lo[b] = lo; S.hi[a] = S.hi[b] = hi;
    S.near[a] = nearA; S.near[b] = nearB;
    S.dflag[a] = 1; S.dflag[b] = 1;
    return true;
  }

  function setEdge(u, d, val) {
    const i = u * 4 + d, cur = S.es[i];
    if (cur === val) return true;
    if (cur !== 0) return false;
    if (++work > workCap) throw CAP;
    const v = nb[i];
    S.es[i] = val; S.es[v * 4 + (d ^ 1)] = val;
    if (rec) edgesBy[lvl]++;
    if (val === 1) {
      if (++S.din[u] > need[u]) return false;
      if (++S.din[v] > need[v]) return false;
      if (S.din[u] === need[u]) S.meta[0]++;
      if (S.din[v] === need[v]) S.meta[0]++;
      if (!merge(u, v)) return false;
    } else {
      if (--S.dopen[u] < need[u] || --S.dopen[v] < need[v]) return false;
    }
    terrStale = true;
    q.push(u, v);
    return true;
  }

  // L1 for one cell.
  function settle(u) {
    const nd = S.din[u], no = S.dopen[u], nu = need[u];
    if (nd === nu && no > nu) {
      for (let d = 0; d < 4; d++) if (S.es[u * 4 + d] === 0 && !setEdge(u, d, 2)) return false;
    } else if (no === nu && nd < nu) {
      for (let d = 0; d < 4; d++) if (S.es[u * 4 + d] === 0 && !setEdge(u, d, 1)) return false;
    }
    return true;
  }
  function l1() {
    while (q.length) if (!settle(q.pop())) { q.length = 0; return false; }
    return true;
  }

  // L3 state, computed lazily and shared with L2 (see below). segOf[x] = bitmask of segments
  // s (1..K-1, i.e. between checkpoint s and s+1) that cell x could still lie on given the
  // current global slack; slackOK[x*4+d] = does edge (x,d) still fit some segment's budget.
  const dS = new Int16Array(K * T), dE = new Int16Array(K * T), Dseg = new Int32Array(K + 1);
  const segLo = new Int16Array(T), segHi = new Int16Array(T); // per-cell reachable segment range (0 = none)
  let slack = -1, terrStale = true;
  function bfs(src, out, off, s) {
    out.fill(-1, off, off + T);
    out[off + src] = 0; bq[0] = src;
    for (let h = 0, t = 1; h < t;) {
      const x = bq[h++], dx = out[off + x];
      for (let d = 0; d < 4; d++) {
        if (S.es[x * 4 + d] === 2) continue;
        const y = nb[x * 4 + d];
        if (y < 0 || out[off + y] >= 0) continue;
        const c = cp[y];
        if (c && c !== s && c !== s + 1) continue; // other checkpoints belong to other segments
        out[off + y] = dx + 1; bq[t++] = y;
      }
    }
  }
  const bq = new Int32Array(T);
  // Refresh dS/dE/slack/segLo/segHi from the current edge state. -1 = contradiction.
  function refreshTerritory() {
    let sum = 0;
    for (let s = 1; s < K; s++) {
      bfs(pos[s], dS, (s - 1) * T, s); bfs(pos[s + 1], dE, (s - 1) * T, s);
      const D = dS[(s - 1) * T + pos[s + 1]];
      if (D < 0) return -1;
      Dseg[s] = D; sum += D;
    }
    slack = TC - 1 - sum;
    if (slack < 0) return -1;
    segLo.fill(0); segHi.fill(0);
    for (let x = 0; x < T; x++) {
      if (holes && holes[x]) continue;
      const k = cp[x];
      if (k) { segLo[x] = Math.max(1, k - 1); segHi[x] = Math.min(K - 1, k); continue; }
      let lo = 0, hi = 0;
      for (let s = 1; s < K; s++) {
        const a = dS[(s - 1) * T + x], b = dE[(s - 1) * T + x];
        if (a >= 0 && b >= 0 && a + b <= Dseg[s] + slack) { if (!lo) lo = s; hi = s; }
      }
      if (!lo) return -1;
      segLo[x] = lo; segHi[x] = hi;
    }
    terrStale = false;
    return 0;
  }
  // Would edge (x,y) fit within some segment's slack budget? Cheap once dS/dE are fresh:
  // just checks whether x and y's reachable-segment ranges overlap (a necessary, not exact,
  // test vs. the true per-edge distance sum, but O(1) and enough to prune cycles/dead spurs).
  function edgeFits(x, y) {
    if (terrStale) return true; // no data yet, defer to territory()
    return segLo[x] <= segHi[y] && segLo[y] <= segHi[x];
  }

  // L2: would joining chains at end x and neighbour y be impossible?
  function chainOk(x, y) {
    if (S.other[x] === y) return false;
    const px = S.near[x], py = S.near[y];
    if (px && py && px - py !== 1 && py - px !== 1) return false;
    const full = min0(S.lo[x], S.lo[y]) === 1 && Math.max(S.hi[x], S.hi[y]) === K;
    if (full && S.sz[x] + S.sz[y] !== TC) return false;
    return edgeFits(x, y);
  }
  function chainPass() { // -1 contradiction, else #edges removed
    let ch = 0;
    for (let x = 0; x < T; x++) {
      if (!S.dflag[x]) continue;
      S.dflag[x] = 0;
      if (S.din[x] >= need[x]) continue;
      for (let d = 0; d < 4; d++) {
        if (S.es[x * 4 + d] !== 0) continue;
        if (!chainOk(x, nb[x * 4 + d])) { if (!setEdge(x, d, 2)) return -1; ch++; }
      }
    }
    return ch;
  }

  // L3: recompute segment-slack territory from scratch, then reject every edge that fails the
  // exact per-edge distance-sum test (stronger than chain's cached-range shortcut above).
  function territory() {
    if (K - 1 > 64) return 0;
    if (refreshTerritory() < 0) return -1;
    let ch = 0;
    for (let x = 0; x < T; x++) {
      for (let d = 0; d < 4; d++) {
        if (S.es[x * 4 + d] !== 0) continue;
        const y = nb[x * 4 + d];
        if (y < x) continue;
        let fits = false;
        for (let s = Math.max(segLo[x], segLo[y]); s <= Math.min(segHi[x], segHi[y]) && !fits; s++) {
          // exact test: x and y on segment s, edge used in the s-direction consistent with each end
          const dxs = dS[(s - 1) * T + x], dxe = dE[(s - 1) * T + x];
          const dys = dS[(s - 1) * T + y], dye = dE[(s - 1) * T + y];
          if (dxs >= 0 && dye >= 0 && dxs + 1 + dye <= Dseg[s] + slack) fits = true;
          else if (dys >= 0 && dxe >= 0 && dys + 1 + dxe <= Dseg[s] + slack) fits = true;
        }
        if (!fits) { if (!setEdge(x, d, 2)) return -1; ch++; }
      }
    }
    return ch;
  }

  // ---- driver ----
  const isSolved = () => S.meta[0] === T;
  // 0 contradiction, 1 solved, 2 stuck. pd = allowed what-if nesting depth.
  function propagate(maxLevel, pd) {
    for (;;) {
      lvl = 1;
      if (!l1()) return 0;
      if (isSolved()) return 1;
      let r;
      if (maxLevel >= 2) {
        lvl = 2; r = chainPass();
        if (r < 0) return 0;
        if (r > 0) { if (rec) passesBy[2]++; continue; }
      }
      if (maxLevel >= 3) {
        lvl = 3; r = territory();
        if (r < 0) return 0;
        if (r > 0) { if (rec) passesBy[3]++; continue; }
      }
      let progressed = false;
      for (let d = 1; d <= pd && !progressed; d++) {
        const L = lvl = 3 + d; r = probePass(d);
        if (r < 0) return 0;
        if (r > 0) { if (rec) passesBy[L]++; progressed = true; }
        if (isSolved()) return 1;
      }
      if (!progressed) return 2;
    }
  }

  const pool = [];
  const scratch = (d, k) => (pool[d * 2 + k] ??= mk());

  // Try `val` on edge (x,e) inside scratch buffer; returns true if it stays consistent.
  function trial(buf, x, e, val, d) {
    probeTrials++;
    const prev = S, prevRec = rec, prevLvl = lvl;
    copy(buf, S); S = buf; rec = false; q.length = 0;
    let ok = false;
    try { ok = setEdge(x, e, val) && propagate(3, d - 1) !== 0; } finally { q.length = 0; S = prev; rec = prevRec; lvl = prevLvl; }
    return ok;
  }

  // One sweep of what-if analysis at nesting depth d. Returns #forced edges, or -1 on contradiction.
  function probePass(d) {
    const A = scratch(d, 0), B = scratch(d, 1);
    let hits = 0;
    for (let x = 0; x < T; x++) {
      for (let e = 0; e < 4; e++) {
        if (S.es[x * 4 + e] !== 0) continue;
        const y = nb[x * 4 + e];
        if (y < x) continue;
        const okIn = trial(A, x, e, 1, d);
        const okOut = trial(B, x, e, 2, d);
        if (!okIn && !okOut) return -1;
        let n = 0;
        if (!okIn) { if (!setEdge(x, e, 2)) return -1; n = 1; }
        else if (!okOut) { if (!setEdge(x, e, 1)) return -1; n = 1; }
        else {
          for (let i = 0; i < T * 4; i++) { // consequences shared by both branches
            if (S.es[i] === 0 && A.es[i] !== 0 && A.es[i] === B.es[i]) {
              if (!setEdge(i >> 2, i & 3, A.es[i])) return -1;
              n++;
            }
          }
        }
        if (n) {
          hits += n;
          const r = propagate(3, 0);
          if (r === 0) return -1;
          if (r === 1) return hits;
        }
      }
    }
    return hits;
  }

  // Fallback: plain branching (L1-3 propagation) from the stuck state; counts nodes / guess depth.
  const sr = { nodes: 0, depth: 0, found: false };
  function search(depth) {
    if (++sr.nodes > (o.searchCap ?? 20000)) throw CAP;
    let best = -1, bs = 99;
    for (let u = 0; u < T; u++) { // most constrained cell: fewest surplus open edges, chain ends first
      if (S.din[u] >= need[u]) continue;
      const s = S.dopen[u] - need[u] + (S.din[u] ? 0 : 0.5);
      if (s < bs) { bs = s; best = u; }
    }
    let e = 0;
    while (S.es[best * 4 + e] !== 0) e++;
    const buf = scratch(pdMax + 1 + depth, 0);
    for (const val of [1, 2]) {
      const prev = S;
      copy(buf, S); S = buf; q.length = 0; rec = false;
      let r = 0;
      try { r = setEdge(best, e, val) ? propagate(3, 0) : 0; } finally { q.length = 0; }
      if (r === 1) { sr.found = true; sr.depth = Math.max(sr.depth, depth + 1); return; }
      if (r === 2) { search(depth + 1); if (sr.found) { sr.depth = Math.max(sr.depth, depth + 1); return; } }
      S = prev;
    }
  }

  let status = 2, exceeded = false;
  try {
    status = propagate(3, pdMax);
    if (status === 2 && o.search !== false) { rec = false; search(0); status = sr.found ? 1 : 2; passesBy[6] = 1; }
  } catch (err) { if (err !== CAP) throw err; exceeded = true; S = real; }

  const solved = status === 1 && !exceeded && (sr.found || isSolved());
  let hardest = 0;
  for (let l = 6; l >= 1; l--) if (passesBy[l] > 0 || (l === 1 && edgesBy[1] > 0)) { hardest = l; break; }
  // extractPath reads whichever buffer actually holds the solved edges: `real` when propagation
  // alone solved it, or the live `S` (a scratch buffer left pointing at the winning branch — see
  // search()'s success path above, which never copies back to `real`) when the search fallback
  // found it. Read S BEFORE anything below could touch it again.
  const path = solved ? extractPath(S, nb, start, TC) : null;
  return {
    solved, exceeded, contradiction: status === 0, hardest, edges: edgesBy, passes: passesBy,
    probeTrials, search: sr, work, ms: performance.now() - t0, path,
  };
}

// Grade 0-5 from a ladder() result, fitted against 44 hand-rated puzzles (see
// areas/zip-difficulty-grading.md). HONEST LIMITS, not tuning debt:
//  - Below the probe2 gate, grade now comes from wideFrac (see its own doc comment above): the
//    fraction of the solved path's branch points that go against "always take the narrower
//    opening". Excluding probe2-gated puzzles, wideFrac<=0.15 has mean human rating 1.07 (n=29),
//    wideFrac>0.15 has mean 2.20 (n=10) — a real, if coarse, 2-bucket split, NOT a fine-grained
//    fit: only 39 non-probe2 points total, and the buckets were chosen by eyeballing a genuine
//    but noisy trend (see areas/zip-difficulty-grading.md for the full sorted list), not a
//    regression. Don't read grade 1 vs 2 here as a validated fine distinction — it's "below" vs
//    "above" one coarse threshold on the one feature that's actually shown signal.
//  - 4 vs 5 is a best-effort split on only 4 labeled puzzles that reach probe2 (human 2,2,4,5);
//    probe1 trial count at probe2 depth does NOT order them correctly, so the split below just
//    uses probeTrials as the least-bad available number. Treat 4/5 as "needs nested guessing,
//    exact number fuzzy" rather than a validated 2-level distinction.
//  - N<=6 floor (grade 0) and N===... 6/7 boundary (grade <=1) matches Shine's stated prior
//    ("most 5x5 -> 0, most 6x6 -> 1") and is NOT independently derived from the 44 labels (only
//    4 N=6 puzzles exist there, human 1-2, consistent with but not proof of the floor).
export function grade(p, r) {
  const n = p.n;
  if (r.exceeded || r.contradiction) return { grade: 5, note: 'solver exceeded work cap or found a contradiction (bad puzzle?)' };
  if (n <= 5) return { grade: 0, note: 'N<=5 floor' };
  if (n === 6) return { grade: 1, note: 'N=6 floor' };
  if (r.hardest >= 5) {
    const g = r.probeTrials >= 3500 ? 5 : 4;
    return { grade: g, note: `needs nested (probe2) guessing — 4/5 split unreliable, n=4 labels only (probeTrials=${r.probeTrials})` };
  }
  if (!r.solved || !r.path) return { grade: 2, note: 'no solved path to compute wideFrac from — flat fallback' };
  const wf = wideFrac(p, r.path);
  const g = wf.frac > 0.15 ? 2 : 1;
  return { grade: g, note: `wideFrac=${wf.frac.toFixed(3)} (${wf.wide}/${wf.decisive} decisive branches went wide) — coarse 2-bucket split (rho=0.55 on 43 labels, see ladder.js header), not a fine-grained fit` };
}

// wideFrac: fraction of the solved path's branch points where the path took the WIDER-looking
// option instead of the narrower one. Validated against 1919 real branch points across 40
// puzzles' actual solved paths: narrow-first predicts the correct move 95.0% of the time
// (1383 narrow-wins vs 73 wide-wins, 463 ties excluded) — see areas/zip-difficulty-grading.md.
// Spearman rho=0.55 against 43 human ratings, stable within fixed N (0.53-0.81 at N=7/8/9/11) —
// the strongest single signal found for this grader so far, well above anything from the
// propagation-level features above (hardest level, probe trial counts: |rho|<0.3).
//
// Rationale: a puzzle whose correct solution mostly obeys the "always dive into the narrower
// opening first" intuition feels mechanical; one that frequently defies it (correct move is the
// WIDER option) is where a human's local judgment misleads them into a bad branch, which is the
// surprise/backtrack-inducing case. This is computed directly off the already-solved path (no
// extra solve), NOT a forward walk simulation — cheap and exact, unlike a simulated attempt.
//
// Cost: O(T) single pass over the path, each step counting free exits of its 2-4 neighbours —
// O(T) total (each cell's exits counted at most a constant number of times). Negligible next to
// the ladder solve itself.
export function wideFrac(p, path) {
  const { nb, T } = buildNeighbors(p);
  const vis = new Uint8Array(T);
  vis[path[0]] = 1;
  let decisive = 0, wide = 0;
  const freeExits = cell => { let n = 0; for (let d = 0; d < 4; d++) { const v = nb[cell * 4 + d]; if (v >= 0 && !vis[v]) n++; } return n; };
  for (let i = 1; i < path.length; i++) {
    const cur = path[i - 1], nxt = path[i];
    let branches = 0, minEx = 99, maxEx = -1, nextEx = -1;
    for (let d = 0; d < 4; d++) {
      const v = nb[cur * 4 + d];
      if (v < 0 || vis[v]) continue;
      branches++;
      vis[v] = 1; const ex = freeExits(v); vis[v] = 0;
      if (ex < minEx) minEx = ex;
      if (ex > maxEx) maxEx = ex;
      if (v === nxt) nextEx = ex;
    }
    if (branches > 1 && minEx !== maxEx) { // decisive branch point (>1 option, options differ in openness)
      decisive++;
      if (nextEx === maxEx) wide++;
    }
    vis[nxt] = 1;
  }
  return { decisive, wide, frac: decisive ? wide / decisive : 0 };
}

function extractPath(st, nb, start, T) {
  const path = [start];
  let prev = -1, cur = start;
  while (path.length <= T) {
    let nx = -1;
    for (let d = 0; d < 4; d++) if (st.es[cur * 4 + d] === 1 && nb[cur * 4 + d] !== prev) { nx = nb[cur * 4 + d]; break; }
    if (nx < 0) break;
    path.push(nx); prev = cur; cur = nx;
  }
  return path;
}
