#!/usr/bin/env node
// Prunes the device sync's cloud copies (server/README.md, "Device sync"). Run nightly, like
// gotd-seed.
//
//   Turso      keeps the newest 3 rows of every device, drops older rows beyond them once
//              they are 7 days old, and drops groups that wrote nothing for 180 days.
//              Needs a token that may delete:
//                turso db tokens create <db> -e 7d -p all:data_read -p sync:data_delete
//   Supabase   sync_prune(token, 180): drops groups idle for 180 days (the pruning token of
//              server/supabase/sync.sql)
//
// Environment: TURSO_URL + TURSO_PRUNE_TOKEN and/or
//              SUPABASE_URL + SUPABASE_KEY (the anon key) + SYNC_PRUNE_TOKEN.
// It cannot tell junk from real rows (it has no key), so it prunes by age and count only.
import { hranaInt, pipeline, trim } from '../src/platform/leaderboard.js';

export const KEEP_ROWS = 3;
export const ROW_DAYS = 7;
export const GROUP_DAYS = 180;
export const PRUNE_SQL = {
  // ?1 = the day before which rows may go
  rows: `DELETE FROM sync WHERE rowid IN (
    SELECT rowid FROM (
      SELECT rowid, day, ROW_NUMBER() OVER (PARTITION BY id, dev ORDER BY seq DESC) AS r
      FROM sync)
    WHERE r > ${KEEP_ROWS} AND day < ?1)`,
  // ?1 = the day before which a group that wrote nothing goes
  groups: 'DELETE FROM sync WHERE id IN (SELECT id FROM sync GROUP BY id HAVING MAX(day) < ?1)',
};

const today = () => Math.floor(Date.now() / 86400000);

export async function pruneTurso({ url, token, fetchFn = fetch, day = today() }) {
  const reply = await fetchFn(`${trim(url)}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: pipeline([
      [PRUNE_SQL.rows, [hranaInt(day - ROW_DAYS)]],
      [PRUNE_SQL.groups, [hranaInt(day - GROUP_DAYS)]],
    ]),
  });
  if (!reply.ok) throw new Error(`Turso: HTTP ${reply.status}`);
  const { results } = await reply.json();
  const errors = results.filter(r => r.type === 'error');
  if (errors.length) throw new Error(`Turso: ${errors[0].error.message}`);
  return results.slice(0, 2).map(r => r.response.result.affected_row_count);
}

export async function pruneSupabase({ url, key, token, fetchFn = fetch }) {
  const reply = await fetchFn(`${trim(url)}/rest/v1/rpc/sync_prune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ p_token: token, p_days: GROUP_DAYS }),
  });
  if (!reply.ok) throw new Error(`Supabase: HTTP ${reply.status} ${await reply.text()}`);
  return (await reply.json()).deleted;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  let ran = 0;
  if (env.TURSO_URL && env.TURSO_PRUNE_TOKEN) {
    const [rows, groups] = await pruneTurso({ url: env.TURSO_URL, token: env.TURSO_PRUNE_TOKEN });
    console.log(`turso: ${rows} old rows and ${groups} rows of idle groups deleted`);
    ran++;
  }
  if (env.SUPABASE_URL && env.SUPABASE_KEY && env.SYNC_PRUNE_TOKEN) {
    const deleted = await pruneSupabase(
      { url: env.SUPABASE_URL, key: env.SUPABASE_KEY, token: env.SYNC_PRUNE_TOKEN });
    console.log(`supabase: ${deleted} idle groups deleted`);
    ran++;
  }
  if (!ran) {
    console.error('nothing to do: set TURSO_URL + TURSO_PRUNE_TOKEN and/or SUPABASE_URL'
      + ' + SUPABASE_KEY + SYNC_PRUNE_TOKEN');
    process.exit(2);
  }
}
