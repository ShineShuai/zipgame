// Pure data model of the benchmark store. Shared by the Node tools and the report viewer
// (inlined into report.html with `export ` stripped): no imports, no I/O, no default export.
export const SCHEMA = 1;

// exact: deterministic (identical on every machine); better: direction of improvement (null = neutral).
export const METRICS = {
  nodes: { better: 'lower', exact: true },
  walls: { better: 'lower', exact: true },
  K: { better: null, exact: true },
  ms: { better: 'lower', exact: false },
  msMed: { better: 'lower', exact: false },
};

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return String(JSON.stringify(value));
}

// cyrb53 over canonical JSON (key order independent).
export function hash(value) {
  const text = canonical(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function emptyStore() {
  return { schema: SCHEMA, versions: {}, envs: {}, results: [] };
}

// bench = commit that provided the benchmark code: the version itself for a native run, a later commit for a backfill (--at).
// A version is a commit; results of a working tree with uncommitted changes form a separate version `sha+`
// (one slot per commit, env, suite: a rerun replaces it).
export const verId = r => r.sha + (r.dirty ? '+' : '');
export const baseSha = id => id.replace(/\+$/, '');
export const resultKey = r => `${verId(r)}|${r.envId}|${r.suite}|${r.bench || r.sha}`;

// true when the result was measured with the benchmark code of its own version (not backfilled)
export const isOwn = r => baseSha(r.bench || r.sha) === r.sha;

export function versionInfo(store, id) {
  const v = store.versions[baseSha(id)] || {};
  return id.endsWith('+') ? { ...v, subject: `${v.subject || ''} (uncommitted changes)`, note: '', dirty: true } : v;
}

// Results of a working tree with uncommitted changes are kept out unless allowDirty.
export function validateResult(r, allowDirty = false) {
  if (!r || !/^[0-9a-f]{40}$/.test(r.sha || '')) {
    return 'missing git sha';
  }
  if (r.dirty && !allowDirty) {
    return 'uncommitted changes';
  }
  if (!r.envId || !r.suite || !Array.isArray(r.rows) || !r.spec) {
    return 'incomplete result';
  }
  return null;
}

// Pure and idempotent. Same (sha, env, suite): the newer result wins.
export function mergeStores(base, incoming, reject = () => {}, allowDirty = false) {
  const out = {
    schema: SCHEMA,
    versions: { ...base.versions },
    envs: { ...base.envs },
    results: [...base.results],
  };
  const index = new Map(out.results.map((r, i) => [resultKey(r), i]));
  for (const r of incoming.results || []) {
    const problem = validateResult(r, allowDirty);
    if (problem) {
      reject(r, problem);
      continue;
    }
    const at = index.get(resultKey(r));
    if (at === undefined) {
      index.set(resultKey(r), out.results.length);
      out.results.push(r);
    } else if (r.ts > out.results[at].ts) {
      out.results[at] = r;
    }
  }
  for (const [sha, v] of Object.entries(incoming.versions || {})) {
    const old = out.versions[sha];
    out.versions[sha] = { ...v, ...old, note: (old && old.note) || v.note };
  }
  for (const [id, e] of Object.entries(incoming.envs || {})) {
    out.envs[id] = { ...e, ...out.envs[id] };
  }
  return out;
}

// One result per line: appending a run only adds lines to the git diff.
export function serializeStore(store) {
  const lines = store.results.map(r => JSON.stringify(r)).join(',\n');
  const text = `{"schema":${store.schema},\n"versions":${JSON.stringify(store.versions)},\n"envs":${JSON.stringify(store.envs)},\n"results":[\n${lines}\n]}`;
  return text.replace(/</g, '\\u003c');
}

export function orderedVersions(store) {
  const ids = [...new Set(store.results.map(verId))];
  const date = id => (id.endsWith('+')
    ? store.results.filter(r => verId(r) === id).map(r => r.ts).sort().pop()
    : (store.versions[id] && store.versions[id].date) || '');
  return ids.sort((a, b) => date(a).localeCompare(date(b)) || a.localeCompare(b));
}

export const specHashOf = r => hash([r.rev, r.spec]);

// Several results can exist for one (version, env, suite): the commit's own benchmark run and runs of a later
// benchmark backfilled onto it. Prefer the one measured with `specHash`, then this env, then the newest.
// ms are per environment; exact metrics fall back to any environment's result.
export function pickResult(store, suite, sha, env, metric, specHash) {
  const found = store.results.filter(r => r.suite === suite && verId(r) === sha);
  const pool = METRICS[metric] && METRICS[metric].exact ? found : found.filter(r => r.envId === env);
  const score = r => (specHash && specHashOf(r) === specHash ? 2 : 0) + (r.envId === env ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a) || b.ts.localeCompare(a.ts))[0];
}

// The benchmark of the newest version: older versions are shown with it when a backfilled result exists.
export function referenceSpec(store, suite, env, metric) {
  for (const sha of orderedVersions(store).reverse()) {
    const r = pickResult(store, suite, sha, env, metric);
    if (r) {
      return specHashOf(r);
    }
  }
  return null;
}

// Values of one (case, variant, metric) by instance seed.
export function cellAgg(result, c, v, metric) {
  const values = new Map();
  let capped = 0;
  for (const row of result.rows) {
    if (row.c !== c || row.v !== v || row.m[metric] === undefined) {
      continue;
    }
    values.set(row.s, row.m[metric]);
    capped += row.cap ? 1 : 0;
  }
  if (!values.size) {
    return null;
  }
  const sum = [...values.values()].reduce((a, b) => a + b, 0);
  return { values, mean: sum / values.size, n: values.size, capped };
}

// Cells are comparable only when the suite rev and this cell's own spec (suite params, case, variant) match.
export function cellSpecHash(result, c, v) {
  return hash([result.rev, result.spec.common, result.spec.cases[c], result.spec.variants[v]]);
}

// ratio = a / b over the instances (seeds) present in both results.
export function cellCompare(a, b, c, v, metric) {
  const A = cellAgg(a, c, v, metric);
  const B = cellAgg(b, c, v, metric);
  if (!A || !B) {
    return null;
  }
  const specDiff = cellSpecHash(a, c, v) !== cellSpecHash(b, c, v);
  let sumA = 0;
  let sumB = 0;
  let n = 0;
  for (const [seed, x] of A.values) {
    if (B.values.has(seed)) {
      sumA += x;
      sumB += B.values.get(seed);
      n++;
    }
  }
  let ratio = null;
  if (n && sumB !== 0) {
    ratio = sumA / sumB;
  } else if (n && sumA === 0) {
    ratio = 1;
  }
  return { ratio, n, specDiff, A, B };
}

export function geomean(values) {
  const good = values.filter(x => x > 0 && Number.isFinite(x));
  if (!good.length) {
    return null;
  }
  return Math.exp(good.reduce((s, x) => s + Math.log(x), 0) / good.length);
}

// 'better' | 'worse' | 'neutral' | 'same'. Exact metrics: any change counts; ms: within noise% is 'same'.
export function classify(ratio, metric, noisePct) {
  const m = METRICS[metric];
  const tolerance = m.exact ? 1e-12 : noisePct / 100;
  if (Math.abs(ratio - 1) <= tolerance) {
    return 'same';
  }
  if (!m.better) {
    return 'neutral';
  }
  return (m.better === 'lower') === ratio < 1 ? 'better' : 'worse';
}

const isObject = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

// What changed in the benchmark between two results: rev, suite params, cases, variants.
export function diffSpec(a, b) {
  const out = [];
  const show = x => JSON.stringify(x);
  const walk = (label, x, y) => {
    if (x === undefined || y === undefined) {
      out.push(`${label} ${x === undefined ? 'added' : 'removed'}`);
    } else if (isObject(x) && isObject(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        walk(`${label}.${k}`, x[k], y[k]);
      }
    } else if (Array.isArray(x) && Array.isArray(y)) {
      const kept = new Set(x.map(show));
      const had = new Set(y.map(show));
      const delta = [...y.filter(v => !kept.has(show(v))).map(v => `+${show(v)}`), ...x.filter(v => !had.has(show(v))).map(v => `−${show(v)}`)];
      if (delta.length) {
        out.push(`${label}: ${delta.join(' ')}`);
      }
    } else if (show(x) !== show(y)) {
      out.push(label.endsWith('.inputs') ? `${label.slice(0, -7)}: instances changed` : `${label}: ${show(x)} → ${show(y)}`);
    }
  };
  if (a.rev !== b.rev) {
    out.push(`rev ${a.rev} → ${b.rev}`);
  }
  const sections = { common: 'common', cases: 'case', variants: 'variant' };
  for (const [section, name] of Object.entries(sections)) {
    const x = a.spec[section] || {};
    const y = b.spec[section] || {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      walk(section === 'common' ? `common.${k}` : `${name} ${k}`, x[k], y[k]);
    }
  }
  return out;
}

// Cumulative change per variant over ordered column results: each (case, variant) row is chained version to version
// and indexed to 100 at its first value; a variant is the geomean of its rows. A benchmark change (spec/rev)
// between two versions breaks the line (broken = true) and carries the level over instead of inventing a delta.
export function trendSeries(results, rows, metric, anyway = false) {
  const chains = rows.map(([c, v]) => {
    const points = new Map();
    let prev = -1;
    results.forEach((res, i) => {
      if (!cellAgg(res, c, v, metric)) {
        return;
      }
      if (prev < 0) {
        points.set(i, { idx: 100, broken: false });
        prev = i;
        return;
      }
      const cmp = cellCompare(res, results[prev], c, v, metric);
      if (!cmp || !cmp.n || cmp.ratio === null) {
        return;
      }
      const broken = cmp.specDiff && !anyway;
      points.set(i, { idx: points.get(prev).idx * (broken ? 1 : cmp.ratio), broken });
      prev = i;
    });
    return { v, points };
  });
  const byVariant = new Map();
  for (const { v, points } of chains) {
    const list = byVariant.get(v) || [];
    list.push(points);
    byVariant.set(v, list);
  }
  const out = new Map();
  for (const [v, list] of byVariant) {
    const series = [];
    results.forEach((_, i) => {
      const here = list.map(points => points.get(i)).filter(Boolean);
      const idx = geomean(here.map(p => p.idx));
      if (idx !== null) {
        series.push({ i, idx, broken: here.some(p => p.broken) });
      }
    });
    out.set(v, series);
  }
  return out;
}
