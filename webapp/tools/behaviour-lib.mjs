// The owner's side of the behaviour rows (src/core/behaviour.js): read every row from Turso and Cloudflare, delete rows, add a column.
// tools/behaviour.mjs is the command line around it; server/turso/schema.test.mjs runs this file against the real server code.
// Rows keep their backend and id, so a row found unuseful in the analysis can be deleted exactly: { where: 'turso' | 'cloudflare', id }.
import { COLUMNS, COLUMN_NAMES, describeRow, fromB64u, toB64u, packPuzzle } from '../src/core/behaviour.js';
import { serialize, parse } from '../src/core/format.js';
import { trim, pipeline, hranaInt } from '../src/platform/leaderboard.js';
import { dateOfDay } from '../src/features/daily.js';

const PAGE = 1000, CHUNK = 90; // rows per export page; ids per DELETE statement (D1 allows 100 bound values)

// Hrana (Turso) value -> JS; a BLOB comes out as base64url, like the Worker's export.
const fromHrana = v => (v.type === 'integer' ? Number(v.value) : v.type === 'null' ? null : v.type === 'blob' ? toB64u(Uint8Array.from(atob(v.base64), c => c.charCodeAt(0))) : v.value);
const hranaArg = v => (v === null ? { type: 'null' } : typeof v === 'number' ? hranaInt(v) : v);

export function createAdmin({ turso, cloudflare, fetchFn = (...a) => fetch(...a) }) {
  // turso: { url, token } (token: -p all:data_read -p play:data_delete; the owner's own token for migrate); cloudflare: { url, secret } (PLAY_ADMIN_SECRET)
  async function tursoRun(stmts) {
    const res = await fetchFn(trim(turso.url) + '/v2/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + turso.token }, body: pipeline(stmts) });
    if (!res.ok) throw new Error('Turso: HTTP ' + res.status);
    return (await res.json()).results.slice(0, stmts.length).map(r => {
      if (r.type !== 'ok') throw new Error('Turso: ' + ((r.error && r.error.message) || 'no result'));
      const { cols, rows, affected_row_count } = r.response.result;
      return { rows: rows.map(row => Object.fromEntries(cols.map((c, i) => [c.name, fromHrana(row[i])]))), changes: affected_row_count || 0 };
    });
  }
  async function cloudflareCall(path, init = {}) {
    const res = await fetchFn(trim(cloudflare.url) + path, { ...init, headers: { Authorization: 'Bearer ' + cloudflare.secret, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!res.ok) throw new Error(`Cloudflare ${path.split('?')[0]}: HTTP ${res.status}`);
    return res.json();
  }

  // the columns the tables really have: { turso?: [names], cloudflare?: [names] }
  async function realColumns() {
    const columns = {};
    if (turso) columns.turso = (await tursoRun([['PRAGMA table_info(play)', []]]))[0].rows.map(c => c.name);
    if (cloudflare) columns.cloudflare = (await cloudflareCall('/play-export?after=0&limit=1')).columns;
    return columns;
  }

  return {
    columns: realColumns,
    // -> { rows: [{ where, id, ...columns (BLOBs as base64url) }], columns: { turso?: [names], cloudflare?: [names] } }
    async exportRows() {
      const rows = [], columns = await realColumns();
      if (turso) {
        const have = COLUMN_NAMES.filter(n => columns.turso.includes(n)); // a column that the table lacks (not migrated yet) reads as null
        const sql = `SELECT rowid AS id, ${have.join(', ')} FROM play WHERE rowid > ?1 ORDER BY rowid LIMIT ?2`;
        for (let after = 0; ;) {
          const [r] = await tursoRun([[sql, [hranaInt(after), hranaInt(PAGE)]]]);
          for (const row of r.rows) rows.push({ where: 'turso', id: row.id, ...Object.fromEntries(COLUMN_NAMES.map(n => [n, row[n] === undefined ? null : row[n]])) });
          if (r.rows.length < PAGE) break;
          after = r.rows[r.rows.length - 1].id;
        }
      }
      if (cloudflare) {
        for (let after = 0; ;) {
          const page = await cloudflareCall(`/play-export?after=${after}&limit=${PAGE}`);
          for (const row of page.rows) rows.push({ where: 'cloudflare', ...row });
          if (page.next === null) break;
          after = page.next;
        }
      }
      return { rows, columns };
    },
    // ids: { turso?: [id], cloudflare?: [id] } -> { turso: n, cloudflare: n } rows deleted
    async deleteRows(ids) {
      const done = { turso: 0, cloudflare: 0 };
      for (let i = 0; turso && ids.turso && i < ids.turso.length; i += CHUNK) {
        const part = ids.turso.slice(i, i + CHUNK);
        done.turso += (await tursoRun([[`DELETE FROM play WHERE rowid IN (${part.map((_, k) => '?' + (k + 1)).join(', ')})`, part.map(hranaInt)]]))[0].changes;
      }
      for (let i = 0; cloudflare && ids.cloudflare && i < ids.cloudflare.length; i += 500) {
        done.cloudflare += (await cloudflareCall('/play-delete', { method: 'POST', body: JSON.stringify({ ids: ids.cloudflare.slice(i, i + 500) }) })).deleted;
      }
      return done;
    },
    // Turso: adds the columns of COLUMNS that the table lacks (needs the owner's token) -> the statements run.
    // D1 cannot be changed from here: -> the wrangler commands to run, one per missing column.
    async migrate(databaseName = 'zip-gotd') {
      const out = { turso: [], cloudflare: [] }, columns = await realColumns();
      const alter = c => {
        if (c.sql.includes('NOT NULL') && !c.sql.includes('DEFAULT')) throw new Error(`column ${c.name} is NOT NULL without a DEFAULT: ALTER TABLE cannot add it (make it nullable or give it a DEFAULT in COLUMNS)`);
        return `ALTER TABLE play ADD COLUMN ${c.name} ${c.sql}`;
      };
      if (columns.turso) for (const c of COLUMNS.filter(c => !columns.turso.includes(c.name))) { const sql = alter(c); await tursoRun([[sql, []]]); out.turso.push(sql); }
      if (columns.cloudflare) for (const c of COLUMNS.filter(c => !columns.cloudflare.includes(c.name))) out.cloudflare.push(`npx wrangler d1 execute ${databaseName} --remote --command "${alter(c)}"`);
      return out;
    },
  };
}

// ---------- reading the rows ----------
// The export, decoded: kind, skill, the date, and the puzzle as the plain text the other tools read (`key`): for a local row from its packed
// bytes, for a Game of Day from its file in gotdFiles ({ 'YYYYMMDD': text }) when given. `bad` = a local row whose puzzle does not decode.
export function describe(rows, gotdFiles = {}) {
  return rows.map(r => {
    const bytes = r.pz ? fromB64u(r.pz) : null, d = describeRow({ s: r.s, pz: bytes }), date = dateOfDay(r.day);
    return { ...r, kind: d.kind, skill: d.skill, date, key: d.puzzle ? serialize(d.puzzle) : bytes ? null : gotdFiles[date] || null, bad: Boolean(bytes && !d.puzzle) || d.kind === null };
  });
}
// Rows that are the same game stored twice (a retry after a timeout, or both backends): the first of each, and how many were dropped.
export function dedupe(rows) {
  const seen = new Set(), keep = [];
  for (const r of rows) { const k = JSON.stringify(COLUMN_NAMES.map(c => r[c])); if (!seen.has(k)) { seen.add(k); keep.push(r); } }
  return { rows: keep, dropped: rows.length - keep.length };
}

// ---------- choosing the rows to delete ----------
const dayOfYmd = ymd => { if (!/^\d{8}$/.test(ymd || '')) throw new Error(`not a date YYYYMMDD: ${ymd}`); return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86400000; };
// sel: exactly one of { ids: ['turso:12', 'cloudflare:3'] } | { puzzle: 'plain text of a puzzle' } | { gotd: 'YYYYMMDD' } | { day: 'YYYYMMDD' }
// -> the rows of `rows` (raw export rows, duplicates included) that match
export function select(rows, sel) {
  const keys = Object.keys(sel).filter(k => sel[k] !== undefined);
  if (keys.length !== 1) throw new Error('give exactly one selector: --ids, --puzzle, --gotd or --day');
  const [k] = keys;
  if (k === 'ids') { const want = new Set(sel.ids); return rows.filter(r => want.has(`${r.where}:${r.id}`)); }
  if (k === 'puzzle') { const pz = packPuzzle(parse(sel.puzzle)); if (!pz) throw new Error('that puzzle cannot be uploaded (size, numbering or holes)'); const b = toB64u(pz); return rows.filter(r => r.pz === b); }
  const day = dayOfYmd(sel[k]);
  return rows.filter(r => r.day === day && (k === 'day' || describeRow({ s: r.s, pz: null }).kind !== 'local'));
}
export const idsOf = rows => ({ turso: rows.filter(r => r.where === 'turso').map(r => r.id), cloudflare: rows.filter(r => r.where === 'cloudflare').map(r => r.id) });
