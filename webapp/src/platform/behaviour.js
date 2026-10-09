// Uploader of behaviour rows (core/behaviour.js): a small queue on this device, sent to Turso and Cloudflare only (never Supabase).
//   Each row goes to ONE backend: cfg.primary, or cfg.backup when the primary does not answer. (Two writes would double the storage for no gain.)
//   A row that no backend accepts is retried on the next page loads, MAX_ROUNDS times in all, then dropped: the data is best effort.
//   A backend that says `invalid` (HTTP 400/422, or the Turso trigger's error) is never retried.
// The player's setting (hold V in the menu) lives in the storage port under ON_KEY; cfg.enabled = false overrides it: nothing is queued or sent
// and a queue left from an earlier run is thrown away.
import { toWire, fromWire, validateRow, rowArgs, toB64, INSERT_SQL } from '../core/behaviour.js';
import { trim, pipeline, hranaInt } from './leaderboard.js';

export const QUEUE_KEY = 'zip_behaviour_queue_v1', ON_KEY = 'zip_behaviour_on', QUEUE_MAX = 20, MAX_ROUNDS = 3;

// A sink turns a row into a request and a reply into 'ok' | 'rejected' (throws = failed).
const hranaArg = v => (v === null ? { type: 'null' } : v instanceof Uint8Array ? { type: 'blob', base64: toB64(v) } : hranaInt(v));
export const SINKS = {
  // The database's HTTP API, called with the public token (-p all:data_read -p submit:data_add -p play:data_add). A statement error comes back
  // inside an HTTP 200 envelope; the trigger's 'invalid' is a rejection, anything else (not authorized, 'closed') a failure.
  turso: ({ url, key }) => ({
    json: true,
    request: row => ({
      url: trim(url) + '/v2/pipeline',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: pipeline([[INSERT_SQL, rowArgs(row).map(hranaArg)]]) },
    }),
    decode(status, body) {
      if (status !== 200) throw new Error('HTTP ' + status);
      const first = body && Array.isArray(body.results) && body.results[0];
      if (!first) throw new Error('not a pipeline reply');
      if (first.type === 'error') { if (/\binvalid\b/.test(first.error && first.error.message)) return 'rejected'; throw new Error(first.error && first.error.message); }
      return 'ok';
    },
  }),
  // Worker POST /play; text/plain skips the CORS preflight, like the Game-of-Day submit.
  cloudflare: ({ url }) => ({
    request: row => ({ url: trim(url) + '/play', init: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(toWire(row)) } }),
    decode(status) {
      if (status === 400 || status === 422) return 'rejected';
      if (status !== 200) throw new Error('HTTP ' + status);
      return 'ok';
    },
  }),
};

// [primary, backup] of the config, as sinks; an id that is missing, unconfigured or of another type (Supabase) is left out.
export function sinksFromConfig(cfg, leaderboard) {
  const make = id => {
    const entry = leaderboard.backends[id];
    if (!entry || !SINKS[entry.type] || !entry.url || (entry.type === 'turso' && !entry.key)) return null;
    return { name: id, ...SINKS[entry.type](entry) };
  };
  return [...new Set([cfg.primary, cfg.backup])].map(make).filter(Boolean);
}

export function createBehaviour({ storage, cfg, sinks, fetchFn = (...a) => fetch(...a), timeoutMs = 3000 }) {
  let queue = null, busy = null;
  const counted = new Set(); // rows that failed in this page load: a round is a page load, so a long offline session does not use them up
  const load = async () => {
    if (queue) return queue;
    queue = [];
    try {
      const r = await storage.get(QUEUE_KEY), list = r ? JSON.parse(r.value) : [];
      for (const it of Array.isArray(list) ? list : []) { const row = validateRow(fromWire(it.row)); if (row) queue.push({ row, rounds: it.rounds | 0 }); }
    } catch { /* corrupt value: start empty */ }
    return queue;
  };
  const save = async () => { try { await storage.set(QUEUE_KEY, JSON.stringify(queue.map(it => ({ row: toWire(it.row), rounds: it.rounds })))); } catch { /* best effort */ } };
  const isOn = async () => {
    if (!cfg.enabled) return false;
    const r = await storage.get(ON_KEY);
    return r ? r.value === '1' : Boolean(cfg.defaultOn);
  };

  async function sendTo(sink, row) {
    const { url, init } = sink.request(row), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { ...init, signal: ctl.signal });
      return sink.decode(res.status, sink.json && res.status === 200 ? await res.json() : null);
    } catch { return 'failed'; } finally { clearTimeout(timer); }
  }
  const sendRow = async row => {
    for (const sink of sinks) { const r = await sendTo(sink, row); if (r !== 'failed') return r; } // primary first; the backup only when it did not answer
    return 'failed';
  };

  async function flushNow() {
    const q = await load();
    if (!cfg.enabled || !sinks.length || !(await isOn())) { if (q.length) { q.length = 0; await save(); } return { sent: 0, rejected: 0, pending: 0 }; }
    let sent = 0, rejected = 0;
    for (const it of [...q]) {
      const r = await sendRow(it.row);
      if (r === 'ok') sent++;
      else if (r === 'rejected') rejected++;
      else {
        if (!counted.has(it)) { counted.add(it); it.rounds++; }
        if (it.rounds < MAX_ROUNDS) continue; // kept for the next page load
      }
      q.splice(q.indexOf(it), 1); // stored, rejected, or out of rounds
    }
    await save();
    return { sent, rejected, pending: q.length };
  }
  // one flush at a time; a call during a flush waits for it and then runs once more (it may hold rows added meanwhile)
  const flush = () => (busy = (busy || Promise.resolve()).then(flushNow, flushNow));

  return {
    isOn,
    async setOn(on) { await storage.set(ON_KEY, on ? '1' : '0'); if (!on) { (await load()).length = 0; await save(); } },
    // queue a row (when uploads are on) and send what is queued; resolves when that round is over
    async enqueue(row) {
      if (!(await isOn())) return false;
      const q = await load();
      q.push({ row, rounds: 0 });
      if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
      await save();
      await flush();
      return true;
    },
    flush, // the boot calls it for rows left from an earlier page load
    async pending() { return (await load()).length; },
  };
}
