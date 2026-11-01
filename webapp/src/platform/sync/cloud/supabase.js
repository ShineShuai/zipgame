// The cloud of the device sync on Supabase: three functions of server/supabase/sync.sql called
// over PostgREST (POST <url>/rest/v1/rpc/<name>) with the public anon key. The server checks the
// writer (the group's auth value), so a stranger cannot write or delete; reading needs only the
// group id. Every method answers or throws a CloudError (http.js).
import { DATA_MAX } from '../../../core/sync/cloud-keys.js';
import { isDev } from '../../../core/sync/slice.js';
import { trim } from '../../leaderboard.js';
import { CloudError, fetchJson } from './http.js';

const DATA = /^[A-Za-z0-9_-]+$/;

// PostgREST: an error of a function comes with a status and { code, message }.
function failure({ status, body }) {
  const message = body && typeof body.message === 'string' ? body.message : '';
  if (message === 'busy') return new CloudError('busy');
  if (message === 'closed' || status === 503) return new CloudError('closed');
  if (message === 'unauthorized' || status === 401 || status === 403) {
    return new CloudError('unauthorized');
  }
  if (status === 400 || status === 422) return new CloudError('rejected', message);
  return new CloudError('network', `HTTP ${status}`);
}

export function supabaseCloud(
  { url, key }, name, { fetchFn = (...a) => fetch(...a), timeoutMs = 5000 } = {},
) {
  const rpc = async (fn, args, keepalive = false) => {
    const reply = await fetchJson(fetchFn, `${trim(url)}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify(args),
      ...(keepalive ? { keepalive: true } : {}),
    }, timeoutMs);
    if (!reply.ok) throw failure(reply);
    return reply.body;
  };
  return {
    name,
    kind: 'supabase',
    // -> 'stored' | 'stale' (the server has this slice or a newer one)
    async put({ id, auth, dev, seq, data, keepalive }) {
      const body = await rpc('sync_put',
        { p_id: id, p_auth: auth, p_dev: dev, p_seq: seq, p_data: data }, keepalive);
      if (!body || body.ok !== true) throw new CloudError('network', 'not a reply');
      return body.stored ? 'stored' : 'stale';
    },
    // have: { dev: seq } -> [{ dev, seq, data }] newer than that
    async get({ id, have }) {
      const body = await rpc('sync_get', { p_id: id, p_have: have || {} });
      if (!body || !Array.isArray(body.slices)) throw new CloudError('network', 'not a reply');
      return body.slices.filter(row => row && isDev(row.dev) && Number.isSafeInteger(row.seq)
        && typeof row.data === 'string' && row.data.length <= DATA_MAX && DATA.test(row.data));
    },
    // -> true when a group was deleted, false when there was none
    async remove({ id, auth }) {
      const body = await rpc('sync_delete', { p_id: id, p_auth: auth });
      return Boolean(body && body.deleted);
    },
  };
}
