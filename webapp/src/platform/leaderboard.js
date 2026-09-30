import { binOf, summarize, MIN_MS, MAX_MS } from '../core/hist.js';

// Backend adapters: request() turns { d: YYYYMMDD, t: ms, b: bin } into a fetch request (both reply { n, sum, below, cnt, best });
// read() turns { from, to } (YYYYMMDD, <= 90 days) into the stats page's fetch request (both reply { days: [{ d, n, sum, bins, best }] }).
// Cloudflare sends text/plain so the browser skips the CORS preflight (one request instead of two); the Worker parses JSON anyway.
const trim = u => u.replace(/\/+$/, '');
export const cloudflareBackend = ({ url }) => ({
  name: 'cloudflare',
  request: ({ d, t, b }) => ({ url: trim(url) + '/gotd', init: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ d, t, b }) } }),
  read: ({ from, to }) => ({ url: `${trim(url)}/stats?from=${from}&to=${to}`, init: { method: 'GET' } }), // simple request: no preflight
});
export const supabaseBackend = ({ url, key }) => ({
  name: 'supabase',
  request: ({ d, t, b }) => ({ url: trim(url) + '/rest/v1/rpc/submit_gotd', init: { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ p_day: d, p_ms: t, p_bin: b }) } }),
  read: ({ from, to }) => ({ url: trim(url) + '/rest/v1/rpc/read_gotd', init: { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ p_from: from, p_to: to }) } }),
});

const FACTORIES = { cloudflare: cloudflareBackend, supabase: supabaseBackend };
const configured = (name, c) => c && c.url && (name !== 'supabase' || c.key);

// Enabled backends in failover order; `first` (optional name) is moved to the front.
export function backendsFromConfig(cfg, first) {
  const order = cfg.order.filter(n => FACTORIES[n] && configured(n, cfg[n]));
  if (first && order.includes(first)) order.splice(0, 0, ...order.splice(order.indexOf(first), 1));
  return order.map(n => FACTORIES[n](cfg[n]));
}

// submit(date 'YYYYMMDD', seconds) -> { status, backend?, summary? }
//   ok       stored + summary returned
//   rejected backend said 400/422 (invalid input): never retried, no failover
//   skipped  time outside the accepted range, nothing sent
//   failed   every backend timed out / errored: caller keeps the solve pending and retries later
// Failover on timeout, network error, non-2xx (except 400/422) or a malformed reply.
// A timeout after the server already stored the solve can double-count it on the next backend (accepted, rare).
export function createLeaderboard(backends, { fetchFn = (...a) => fetch(...a), timeoutMs = 3000 } = {}) {
  return {
    enabled: backends.length > 0,
    async submit(date, seconds) {
      const t = Math.round(seconds * 1000);
      if (!backends.length || !(t >= MIN_MS && t <= MAX_MS)) return { status: 'skipped' };
      const req = { d: +date, t, b: binOf(t) };
      for (const be of backends) {
        const { url, init } = be.request(req), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await fetchFn(url, { ...init, signal: ctl.signal });
          if (res.status === 400 || res.status === 422) return { status: 'rejected', backend: be.name };
          if (!res.ok) continue;
          const summary = summarize(await res.json());
          if (summary) return { status: 'ok', backend: be.name, summary };
        } catch { /* timeout / network / bad JSON: try the next backend */ } finally { clearTimeout(timer); }
      }
      return { status: 'failed' };
    },
  };
}
