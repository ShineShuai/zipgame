// Shared by the device-sync tests: a storage port in memory and two connected channels.
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    raw: map,
    async get(key) { return map.has(key) ? { value: map.get(key) } : null; },
    async set(key, value) { map.set(key, value); return true; },
    async remove(key) { map.delete(key); },
    async keys(prefix = '') { return [...map.keys()].filter(key => key.startsWith(prefix)); },
  };
}

// Two channels: what one sends arrives at the other, in order, on a later turn of the event
// loop (like a data channel). close() ends both. `log` collects what each side sent.
export function channelPair() {
  const log = { a: [], b: [] };
  const make = side => ({
    onmessage: null,
    onclose: null,
    closed: false,
    send(text) {
      log[side].push(text);
      const peer = side === 'a' ? b : a;
      setTimeout(() => { if (!peer.closed) peer.onmessage?.(text); }, 0);
    },
    close() {
      for (const end of [a, b]) {
        if (!end.closed) {
          end.closed = true;
          setTimeout(() => end.onclose?.(), 0);
        }
      }
    },
  });
  const a = make('a');
  const b = make('b');
  return { a, b, log };
}

export const manualTimers = () => {
  const pending = new Map();
  let next = 1;
  return {
    set(fn) { pending.set(next, fn); return next++; },
    clear(id) { pending.delete(id); },
    fire() { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    get count() { return pending.size; },
  };
};

export const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

// A stand-in for the Supabase functions of server/supabase/sync.sql (sync_put, sync_get,
// sync_delete),
// written from that file: the same checks, the same errors (PostgREST status and message). It is a
// MODEL: the SQL itself is run by server/supabase/sync_test.py on a Postgres.
export function fakeSupabase({ maxGroups = 100000, now = () => Date.now() } = {}) {
  // id -> { verifier, touched, slices: Map(dev -> { seq, data, touched }) }
  const groups = new Map();
  const fail = (status, message) => (
    { ok: false, status, json: async () => ({ code: 'X', message }) });
  const good = body => ({ ok: true, status: 200, json: async () => body });
  const ID = /^[0-9a-f]{32}$/;
  const AUTH = /^[A-Za-z0-9_-]{43}$/;
  const DEV = /^[A-Za-z0-9_-]{11}$/;
  const DATA = /^[A-Za-z0-9_-]+$/;
  const verifierOf = auth => `h(${auth})`;
  const calls = [];
  const rpc = {
    sync_put(a) {
      if (!ID.test(a.p_id ?? '') || !AUTH.test(a.p_auth ?? '') || !DEV.test(a.p_dev ?? '')
        || !Number.isSafeInteger(a.p_seq) || a.p_seq < 1 || typeof a.p_data !== 'string'
        || a.p_data.length < 16 || a.p_data.length > 24000 || !DATA.test(a.p_data)) {
        return fail(400, 'invalid');
      }
      let group = groups.get(a.p_id);
      if (!group) {
        if (groups.size >= maxGroups) return fail(503, 'closed');
        group = { verifier: verifierOf(a.p_auth), touched: now(), slices: new Map() };
        groups.set(a.p_id, group);
      }
      if (group.verifier !== verifierOf(a.p_auth)) return fail(403, 'unauthorized');
      const mine = group.slices.get(a.p_dev);
      if (!mine && group.slices.size >= 8) return fail(400, 'invalid');
      if (mine && now() - mine.touched < 5000) return fail(400, 'busy');
      let stored = false;
      if (!mine || mine.seq < a.p_seq) {
        group.slices.set(a.p_dev, { seq: a.p_seq, data: a.p_data, touched: now() });
        stored = true;
      }
      group.touched = now();
      return good({ ok: true, stored });
    },
    sync_get(a) {
      if (!ID.test(a.p_id ?? '') || !a.p_have || typeof a.p_have !== 'object') {
        return fail(400, 'invalid');
      }
      const group = groups.get(a.p_id);
      const slices = [];
      for (const [dev, s] of group ? [...group.slices].sort() : []) {
        const seen = /^[0-9]{1,15}$/.test(String(a.p_have[dev])) ? Number(a.p_have[dev]) : 0;
        if (s.seq > seen) slices.push({ dev, seq: s.seq, data: s.data });
      }
      return good({ slices });
    },
    sync_delete(a) {
      if (!ID.test(a.p_id ?? '') || !AUTH.test(a.p_auth ?? '')) return fail(400, 'invalid');
      const group = groups.get(a.p_id);
      if (!group) return good({ deleted: false });
      if (group.verifier !== verifierOf(a.p_auth)) return fail(403, 'unauthorized');
      groups.delete(a.p_id);
      return good({ deleted: true });
    },
  };
  const fetchFn = async (url, init) => {
    const name = url.split('/rest/v1/rpc/')[1];
    calls.push({ name, init, args: JSON.parse(init.body) });
    if (init.headers.apikey !== 'anon-key') return fail(401, 'bad key');
    return rpc[name](JSON.parse(init.body));
  };
  const entry = { type: 'supabase', url: 'https://x.supabase.co', key: 'anon-key' };
  return { fetchFn, groups, calls, entry };
}

// A Turso database as the tests need it: the REAL server/turso/sync.sql (tables and trigger) on
// SQLite, and a stand-in for its HTTP API (Hrana over HTTP) in front of it.
export async function tursoDatabase() {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../server/turso/sync.sql', import.meta.url), 'utf8'));
  return db;
}

const hranaValue = v => {
  if (v === null) return { type: 'null' };
  const whole = typeof v === 'bigint' || Number.isInteger(v);
  return { type: whole ? 'integer' : 'text', value: String(v) };
};

export const fakeTurso = (db, { token = 'public-token', down = () => false } = {}) =>
  async (url, init) => {
    if (down()) throw new Error('offline');
    if (init.headers.Authorization !== `Bearer ${token}`) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    const results = JSON.parse(init.body).requests.map(r => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      try {
        const args = r.stmt.args.map(a => (a.type === 'integer' ? BigInt(a.value) : a.value));
        const stmt = db.prepare(r.stmt.sql);
        stmt.setReadBigInts(true);
        if (!/^\s*(SELECT|WITH)/i.test(r.stmt.sql)) {
          const changes = Number(stmt.run(...args).changes);
          return { type: 'ok', response: { type: 'execute',
            result: { cols: [], rows: [], affected_row_count: changes } } };
        }
        const rows = stmt.all(...args);
        return { type: 'ok', response: { type: 'execute', result: {
          cols: stmt.columns().map(c => ({ name: c.name })),
          rows: rows.map(row => Object.values(row).map(hranaValue)), affected_row_count: 0 } } };
      } catch (e) {
        return { type: 'error', error: { message: `SQLite error: ${e.message}` } };
      }
    });
    return { ok: true, status: 200, json: async () => ({ baton: null, base_url: null, results }) };
  };
