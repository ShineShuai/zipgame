import { parseDays } from '../core/stats-merge.js';

// Reads every backend in parallel (no failover: the stats page compares them).
// -> [{ name, status: 'ok' | 'failed', ms, days, error? }]; `days` is [] unless ok.
export function fetchStats(backends, range, { fetchFn = (...a) => fetch(...a), timeoutMs = 8000 } = {}) {
  return Promise.all(backends.map(async be => {
    const { url, init } = be.read(range), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs), t0 = performance.now();
    const result = extra => ({ name: be.name, ms: Math.round(performance.now() - t0), days: [], ...extra });
    try {
      const res = await fetchFn(url, { ...init, signal: ctl.signal });
      if (!res.ok) return result({ status: 'failed', error: 'HTTP ' + res.status });
      const body = await res.json();
      const days = parseDays(be.decode ? be.decode('read', body) : body);
      return days ? result({ status: 'ok', days }) : result({ status: 'failed', error: 'malformed reply' });
    } catch { return result({ status: 'failed', error: 'timeout / network' }); } finally { clearTimeout(timer); }
  }));
}
