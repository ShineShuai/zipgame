// The stage: where an offered theme waits while its event runs. A row of `theme_stage` (server/turso/theme_stage.sql) holds one
// bundle and the window it is offered in; the author puts it there (themes/tools/stage.mjs) and takes it away when the event
// ends. The browser may only read the table, and only the offer(s) of the running event are ever in it: the library of themes
// is not in any database or on any web server, so a player can never fetch a theme that was not offered to them.
// `offers()` is for the mechanisms that decide who is shown what and when: it returns what is on the stage right now. The
// adapter is injected (the Turso one below follows platform/leaderboard.js); another backend only has to return the same rows.
import { hranaInt, pipeline, trim } from '../platform/leaderboard.js';

export const STAGE_SQL = 'SELECT event, theme, v, from_ms, until_ms, bundle FROM theme_stage WHERE until_ms > ?1 ORDER BY from_ms, event';
const EVENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ROW = 220 * 1024;

// A stage row as an offer { event, theme, v, from, until, bundle } (bundle parsed, not yet validated: controller.trial does that),
// or null for a row that is not one.
export function cleanOffer(row) {
  if (!row || !EVENT.test(row.event ?? '') || !Number.isFinite(row.from_ms) || !Number.isFinite(row.until_ms)) return null;
  if (typeof row.bundle !== 'string' || row.bundle.length > MAX_ROW) return null;
  let bundle = null;
  try { bundle = JSON.parse(row.bundle); } catch { return null; }
  if (!bundle || bundle.id !== row.theme || bundle.v !== row.v) return null;
  return { event: row.event, theme: row.theme, v: row.v, from: row.from_ms, until: row.until_ms, bundle };
}

// fetchRows(nowMs) -> Promise<[{ event, theme, v, from_ms, until_ms, bundle }]>. The window is checked here too, but the
// stage is the authority: a row is withdrawn by deleting it, so an old clock buys nothing.
export function createStage({ fetchRows, now = Date.now }) {
  return {
    async offers() {
      const t = now();
      return (await fetchRows(t)).map(cleanOffer).filter(o => o && o.from <= t && t < o.until);
    },
  };
}

// The rows of a Hrana result as objects (integers as numbers)
const rowsOf = result => {
  if (!result || result.type !== 'ok') throw new Error((result?.error?.message) || 'no result');
  const { cols, rows } = result.response.result;
  return rows.map(r => Object.fromEntries(cols.map((c, i) => [c.name, r[i].type === 'integer' ? Number(r[i].value) : r[i].type === 'null' ? null : r[i].value])));
};

// The Turso backend entry of config.js ({ url, key }): the same HTTP API and public read-only token as the leaderboard.
export const tursoStage = ({ url, key }, fetchFn = (...a) => fetch(...a), timeoutMs = 4000) => ({
  async fetchRows(nowMs) {
    const response = await fetchFn(`${trim(url)}/v2/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: pipeline([[STAGE_SQL, [hranaInt(nowMs)]]]),
      signal: AbortSignal.timeout?.(timeoutMs),
    });
    if (!response.ok) throw new Error(`stage: ${response.status}`);
    return rowsOf((await response.json()).results[0]);
  },
});
