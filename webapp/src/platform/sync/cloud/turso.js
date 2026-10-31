// The cloud of the device sync on Turso: the browser talks to the database's HTTP API (Hrana over
// HTTP, POST <url>/v2/pipeline) with the public token of config.js. The token can only read and
// INSERT (server/turso/schema.sql, `sync` table): a device never changes a row, it adds one with
// seq = its highest + 1, and readers take the newest row that opens. The statements are exported
// so that server/turso/sync.test.mjs runs exactly what the browser sends.
// A statement error comes back inside an HTTP 200 envelope; its message is the trigger's word.
import { DATA_MAX } from '../../../core/sync/cloud-keys.js';
import { isDev } from '../../../core/sync/slice.js';
import { hranaInt, pipeline, trim } from '../../leaderboard.js';
import { CloudError, fetchJson } from './http.js';

export const SYNC_SQL = {
  // ?1 id, ?2 dev, ?3 UTC day number, ?4 sealed slice (base64url): one row, whose seq is
  // the device's highest + 1
  put: `INSERT INTO sync (id, dev, seq, day, data)
    SELECT ?1, ?2, COALESCE(MAX(seq), 0) + 1, ?3, ?4 FROM sync WHERE id = ?1 AND dev = ?2`,
  // ?1 id -> one row per device: { dev, seq } with its newest seq
  heads: 'SELECT dev, MAX(seq) AS seq FROM sync WHERE id = ?1 GROUP BY dev',
  // ?1 id, ?2 dev -> its newest three rows, newest first (the newest may be somebody's junk)
  rows: 'SELECT seq, data FROM sync WHERE id = ?1 AND dev = ?2 ORDER BY seq DESC LIMIT 3',
};
const MAX_DEVICES = 8;
const text = value => ({ type: 'text', value });
const DATA = /^[A-Za-z0-9_-]+$/;

const valueOf = cell => (cell.type === 'integer' ? Number(cell.value)
  : cell.type === 'null' ? null : cell.value);

// the rows of one pipeline result as [{ column: value }], or throws on an error result
function rowsOf(result) {
  if (!result || result.type !== 'ok') {
    const message = (result && result.error && result.error.message) || 'no result';
    throw Object.assign(new Error(message), { sqlError: true });
  }
  const { cols, rows } = result.response.result;
  return rows.map(row => Object.fromEntries(cols.map((col, i) => [col.name, valueOf(row[i])])));
}

function failure(error) {
  const message = error.message || '';
  if (/\binvalid\b/.test(message)) return new CloudError('rejected');
  if (/\bclosed\b/.test(message)) return new CloudError('closed');
  if (/\bfull\b|UNIQUE constraint/.test(message)) return new CloudError('busy');
  if (/not authorized|SQLITE_AUTH|permission/i.test(message)) return new CloudError('denied');
  return new CloudError('network', message);
}

export function tursoCloud(
  { url, key }, name,
  { fetchFn = (...a) => fetch(...a), timeoutMs = 5000, now = () => Date.now() } = {},
) {
  const send = async (statements, keepalive = false) => {
    const reply = await fetchJson(fetchFn, `${trim(url)}/v2/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: pipeline(statements),
      ...(keepalive ? { keepalive: true } : {}),
    }, timeoutMs);
    if (!reply.ok) {
      throw new CloudError(reply.status === 401 || reply.status === 403 ? 'denied' : 'network',
        `HTTP ${reply.status}`);
    }
    const results = reply.body && reply.body.results;
    if (!Array.isArray(results) || results.length < statements.length) {
      throw new CloudError('network', 'not a pipeline reply');
    }
    return results.slice(0, statements.length); // without the reply to `close`
  };
  return {
    name,
    kind: 'turso',
    // The row's seq is the device's highest + 1, chosen by the statement; `seq` is only a hint.
    async put({ id, dev, data, keepalive }) {
      const day = Math.floor(now() / 86400000);
      const args = [text(id), text(dev), hranaInt(day), text(data)];
      const [result] = await send([[SYNC_SQL.put, args]], keepalive);
      try {
        rowsOf(result);
      } catch (error) {
        throw failure(error);
      }
      return 'stored';
    },
    // have: { dev: seq } of what the caller has seen of THIS server's rows
    // -> [{ dev, seq, data }], the newest rows of the devices with something new
    async get({ id, have = {} }) {
      let heads;
      try {
        [heads] = (await send([[SYNC_SQL.heads, [text(id)]]])).map(rowsOf);
      } catch (error) {
        throw error instanceof CloudError ? error : failure(error);
      }
      const news = heads.filter(head => isDev(head.dev) && Number.isSafeInteger(head.seq)
        && head.seq > (Number.isSafeInteger(have[head.dev]) ? have[head.dev] : 0))
        .slice(0, MAX_DEVICES);
      if (!news.length) return [];
      const results = await send(news.map(head => [SYNC_SQL.rows, [text(id), text(head.dev)]]));
      const rows = [];
      results.forEach((result, i) => {
        if (!result || result.type !== 'ok') return;
        for (const row of rowsOf(result)) {
          if (Number.isSafeInteger(row.seq) && typeof row.data === 'string'
            && row.data.length <= DATA_MAX && DATA.test(row.data)) {
            rows.push({ dev: news[i].dev, seq: row.seq, data: row.data });
          }
        }
      });
      return rows;
    },
    // Rows cannot be deleted with the public token: the group's copy becomes unreadable when its
    // secret is dropped, and is removed by tools/sync-prune.mjs.
  };
}
