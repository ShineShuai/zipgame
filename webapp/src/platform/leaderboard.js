import { binOf, summarize, MIN_MS, MAX_MS, TOP_K } from '../core/hist.js';

// Backend adapters: request() turns { d: YYYYMMDD, t: ms, b: bin } into a fetch request (all reply { n, sum, below, cnt, best });
// read() turns { from, to } (YYYYMMDD, <= 90 days) into the stats page's fetch request (all reply { days: [{ d, n, sum, bins, best }] }).
// A factory takes a config entry and the backend's id (default: the type name); `name` is that id.
// Optional decode(kind, json), kind 'submit' | 'read': for a backend whose reply is not already in that shape (a database spoken to directly,
// whose answer comes in its own envelope). It returns the reply in the shape above, { rejected: true } for an invalid-input answer that arrives
// with HTTP 200, or throws / returns garbage for a malformed one (= failed). Without it the JSON body is the reply and 400/422 mean rejected.
// Cloudflare sends text/plain so the browser skips the CORS preflight (one request instead of two); the Worker parses JSON anyway.
export const trim = u => u.replace(/\/+$/, '');
export const cloudflareBackend = ({ url }, id = 'cloudflare') => ({
  name: id,
  request: ({ d, t, b }) => ({ url: trim(url) + '/gotd', init: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ d, t, b }) } }),
  read: ({ from, to }) => ({ url: `${trim(url)}/stats?from=${from}&to=${to}`, init: { method: 'GET' } }), // simple request: no preflight
});
export const supabaseBackend = ({ url, key }, id = 'supabase') => ({
  name: id,
  request: ({ d, t, b }) => ({ url: trim(url) + '/rest/v1/rpc/submit_gotd', init: { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ p_day: d, p_ms: t, p_bin: b }) } }),
  read: ({ from, to }) => ({ url: trim(url) + '/rest/v1/rpc/read_gotd', init: { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ p_from: from, p_to: to }) } }),
});

// Turso: the browser talks to the database's HTTP API (Hrana over HTTP, POST <url>/v2/pipeline) with a public token that can only read and
// INSERT into `submit` (server/turso/schema.sql; token: -p all:data_read -p submit:data_add). A statement error comes back inside an HTTP 200
// envelope, so decode() reads it: the trigger's 'invalid' = rejected; anything else (e.g. 'not authorized') = failed.
// The statements are exported so that server/turso/schema.test.mjs runs exactly what the browser sends.
export const TURSO_SQL = {
  insert: 'INSERT OR IGNORE INTO submit (uid, day, ms, bin) VALUES (?1, ?2, ?3, ?4)',
  // ?1 day, ?2 my bin -> one row { n, sum, below, cnt, best } (best = JSON text), the reply shape of the other backends
  summary: `SELECT COUNT(*) AS n, COALESCE(SUM(ms), 0) AS sum, COALESCE(SUM(bin < ?2), 0) AS below, COALESCE(SUM(bin = ?2), 0) AS cnt,
    (SELECT json_group_array(ms) FROM (SELECT ms FROM solve WHERE day = ?1 ORDER BY ms LIMIT ${TOP_K})) AS best
    FROM solve WHERE day = ?1`,
  // ?1 from, ?2 to -> one row { reply } = JSON text of { days: [{ d, n, sum, bins: [[bin, n]], best, seeds }] }, the shape of the Worker's GET /stats
  read: `WITH s AS (SELECT day, ms, bin FROM solve WHERE day BETWEEN ?1 AND ?2),
    dd AS (SELECT day, COUNT(*) AS n, SUM(ms) AS sum FROM s GROUP BY day),
    bb AS (SELECT day, json_group_array(json_array(bin, c)) AS bins FROM (SELECT day, bin, COUNT(*) AS c FROM s GROUP BY day, bin) GROUP BY day),
    tt AS (SELECT day, json_group_array(ms) AS best FROM (SELECT day, ms, ROW_NUMBER() OVER (PARTITION BY day ORDER BY ms) AS r FROM s) WHERE r <= ${TOP_K} GROUP BY day),
    xx AS (SELECT seed.day AS day, json_group_array(j.value) AS seeds FROM seed, json_each(seed.ms) j WHERE seed.day BETWEEN ?1 AND ?2 GROUP BY seed.day)
    SELECT json_object('days', json(COALESCE((SELECT json_group_array(json_object('d', dd.day, 'n', dd.n, 'sum', dd.sum, 'bins', json(bb.bins), 'best', json(tt.best),
      'seeds', json(COALESCE(xx.seeds, '[]')))) FROM dd JOIN bb USING (day) JOIN tt USING (day) LEFT JOIN xx USING (day)), '[]'))) AS reply`,
};
export const hranaInt = n => ({ type: 'integer', value: String(n) }); // Hrana sends integers as strings (they may exceed 2^53)
const newUid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
export const pipeline = stmts => JSON.stringify({ requests: [...stmts.map(([sql, args]) => ({ type: 'execute', stmt: { sql, args } })), { type: 'close' }] });
// the first row of one pipeline result as { column: value } (integers as numbers), or throws on an error result
function tursoRow(result) {
  if (!result || result.type !== 'ok') throw Object.assign(new Error((result && result.error && result.error.message) || 'no result'), { sqlError: true });
  const { cols, rows } = result.response.result;
  if (!rows.length) return null;
  return Object.fromEntries(cols.map((c, i) => [c.name, rows[0][i].type === 'integer' ? Number(rows[0][i].value) : rows[0][i].type === 'null' ? null : rows[0][i].value]));
}
export const tursoBackend = ({ url, key }, id = 'turso') => ({
  name: id,
  request: ({ d, t, b, u = newUid() }) => ({
    url: trim(url) + '/v2/pipeline',
    init: {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: pipeline([[TURSO_SQL.insert, [{ type: 'text', value: u }, hranaInt(d), hranaInt(t), hranaInt(b)]], [TURSO_SQL.summary, [hranaInt(d), hranaInt(b)]]]),
    },
  }),
  read: ({ from, to }) => ({
    url: trim(url) + '/v2/pipeline',
    init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: pipeline([[TURSO_SQL.read, [hranaInt(from), hranaInt(to)]]]) },
  }),
  decode(kind, body) {
    const results = body && body.results;
    if (!Array.isArray(results)) throw new Error('not a pipeline reply');
    if (kind === 'read') {
      const reply = JSON.parse(tursoRow(results[0]).reply);
      return { days: reply.days.sort((a, b) => a.d - b.d) };
    }
    if (results[0] && results[0].type === 'error' && /\binvalid\b/.test(results[0].error.message)) return { rejected: true };
    tursoRow(results[0]); // INSERT: throws on any other error
    const row = tursoRow(results[1]);
    return { n: row.n, sum: row.sum, below: row.below, cnt: row.cnt, best: JSON.parse(row.best) };
  },
});

const FACTORIES = { cloudflare: cloudflareBackend, supabase: supabaseBackend, turso: tursoBackend };
const KEYED = new Set(['supabase', 'turso']); // types whose entry needs a key (Supabase: the anon key; Turso: the insert-only token)
const configured = entry => Boolean(entry && FACTORIES[entry.type] && entry.url && (!KEYED.has(entry.type) || entry.key));

// The configured backends as { always, chain, list }:
//   always  the always-written backend, or null (not set, unknown or not configured)
//   chain   the backups in failover order (`always` is never part of it); `first` (optional id) is moved to the front
//   list    always, chain, then every other configured backend: the read side (stats page, seeder) uses all of them
export function backendsFromConfig(cfg, first) {
  const build = id => {
    const entry = cfg.backends[id];
    return configured(entry) ? FACTORIES[entry.type](entry, id) : null;
  };
  const always = build(cfg.always);
  const ids = [...new Set(cfg.order || [])].filter(id => id !== cfg.always);
  if (first && ids.includes(first)) {
    ids.splice(ids.indexOf(first), 1);
    ids.unshift(first);
  }
  const chain = ids.map(build).filter(Boolean);
  const named = new Set([cfg.always, ...ids]);
  const others = Object.keys(cfg.backends).filter(id => !named.has(id)).map(build).filter(Boolean);
  return { always, chain, list: [always, ...chain, ...others].filter(Boolean) };
}

// submit(date 'YYYYMMDD', seconds, done = []) -> { status, done, complete, backend?, summary? }
//   done      ids of the backends that now hold the solve (pass it back to a retry: those are not written again)
//   complete  every writer holds it: `always` (when set) and one backup (when there are backups)
//   ok        at least one backend stored it; `backend` / `summary` come from the first of always, backups that did
//   rejected  a backend said 400/422 (invalid input) and none stored it: never retried, no failover (a rejecting backend counts as done)
//   skipped   time outside the accepted range or no backend, nothing sent
//   failed    nothing stored: the caller keeps the solve pending and retries later
// `always` and the backup chain run in parallel. The chain fails over on timeout, network error, non-2xx (except 400/422) or a malformed reply.
// A timeout after the server already stored the solve can count it twice on that backend or on the next one (accepted, rare).
export function createLeaderboard({ always, chain }, { fetchFn = (...a) => fetch(...a), timeoutMs = 3000 } = {}) {
  const readOrder = [always, ...chain].filter(Boolean).map(be => be.name);

  async function tryBackend(be, req) {
    const { url, init } = be.request(req);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { ...init, signal: ctl.signal });
      if (res.status === 400 || res.status === 422) return { be, kind: 'rejected' };
      if (!res.ok) return { be, kind: 'failed' };
      const body = await res.json();
      const reply = be.decode ? be.decode('submit', body) : body;
      if (reply && reply.rejected) return { be, kind: 'rejected' };
      const summary = summarize(reply);
      return summary ? { be, kind: 'ok', summary } : { be, kind: 'failed' };
    } catch {
      return { be, kind: 'failed' }; // timeout / network / bad JSON
    } finally {
      clearTimeout(timer);
    }
  }

  async function firstAnswer(backends, req) {
    for (const be of backends) {
      const answer = await tryBackend(be, req);
      if (answer.kind !== 'failed') return answer;
    }
    return null;
  }

  return {
    enabled: readOrder.length > 0,
    readOrder, // backend ids, the one the summary is taken from first
    async submit(date, seconds, done = []) {
      const t = Math.round(seconds * 1000);
      if (!readOrder.length || !(t >= MIN_MS && t <= MAX_MS)) return { status: 'skipped', done };
      const req = { d: +date, t, b: binOf(t) };
      const writeAlways = Boolean(always) && !done.includes(always.name);
      const writeChain = chain.length > 0 && !chain.some(be => done.includes(be.name));
      if (!writeAlways && !writeChain) return { status: 'ok', done, complete: true };
      const [fromAlways, fromChain] = await Promise.all([
        writeAlways ? tryBackend(always, req) : null,
        writeChain ? firstAnswer(chain, req) : null,
      ]);
      const answers = [fromAlways, fromChain].filter(Boolean);
      const stored = answers.filter(a => a.kind === 'ok');
      const settled = answers.filter(a => a.kind !== 'failed').map(a => a.be.name);
      const nowDone = [...done, ...settled];
      if (stored.length) {
        const complete = (!always || nowDone.includes(always.name)) && (!chain.length || chain.some(be => nowDone.includes(be.name)));
        return { status: 'ok', done: nowDone, complete, backend: stored[0].be.name, summary: stored[0].summary };
      }
      if (settled.length) return { status: 'rejected', done: nowDone, complete: true };
      return { status: 'failed', done, complete: false };
    },
  };
}

// A backend a player can never reach (blocked) must not be retried on every page load: after MAX_ROUNDS submit rounds that stored the solve
// somewhere but left a writer failing, the solve counts as sent.
export const MAX_ROUNDS = 3;

// The attempt record after one submit round `r` (result of submit()); `order` = lb.readOrder.
//   sent: true = nothing left to do (complete, rejected, skipped or out of rounds); the record is then { solved, time, sent, stats } only.
//   sent: false keeps { done, rounds, statsFrom } for the retry (replay.unsent() finds it by sent === false).
// `stats` is the summary of the highest-priority backend that has answered so far: a retry replaces it only with an answer from a backend
// earlier in `order`. Returns `prev` itself when nothing was stored anywhere (e.g. offline): the next page load tries again without counting a round.
export function afterSubmit(prev, r, order) {
  if (r.status === 'failed' && !r.done.length) return prev;
  const rank = name => (order.includes(name) ? order.indexOf(name) : Infinity);
  const better = Boolean(r.summary) && (!prev.stats || rank(r.backend) < rank(prev.statsFrom));
  const stats = better ? r.summary : prev.stats || null;
  const rounds = (prev.rounds || 0) + 1;
  const finished = r.status === 'skipped' || r.status === 'rejected' || r.complete;
  const sent = finished || rounds >= MAX_ROUNDS;
  if (sent) return { solved: prev.solved, time: prev.time, sent: true, stats };
  return { solved: prev.solved, time: prev.time, sent: false, stats, statsFrom: better ? r.backend : prev.statsFrom, done: r.done, rounds };
}

// One submit round for the solved attempt of `date` (first submit, or a retry of a record with sent === false): writes the solve to the backends
// that do not hold it yet, saves the new record in `store`. Returns that record, or null when there was nothing to do or nothing was stored.
export async function submitAttempt(lb, store, date) {
  const prev = store.attemptOn(date);
  if (!prev || !prev.solved) return null;
  const result = await lb.submit(date, prev.time, prev.done || []);
  const next = afterSubmit(prev, result, lb.readOrder);
  if (next === prev) return null;
  await store.saveAttempt(date, next);
  return next;
}
