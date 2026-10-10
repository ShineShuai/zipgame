// The owner's tool for the anonymous behaviour rows (src/core/behaviour.js, server/README.md "Behaviour rows").
//   node tools/behaviour.mjs export  --out rows.json [--gotd-dir DIR] [TOKENS]
//   node tools/behaviour.mjs delete  (--ids turso:12,cloudflare:3 | --puzzle FILE | --gotd YYYYMMDD | --day YYYYMMDD) [--yes] [TOKENS]
//   node tools/behaviour.mjs migrate [--d1-name NAME] [TOKENS]
// TOKENS (a backend without its token is left out; both are read from files, surrounding whitespace is ignored):
//   --turso-token-file F   Turso: the pruning token (turso db tokens create <db> -p all:data_read -p play:data_delete); migrate needs your own full-access token
//   --token-file F         Cloudflare: the PLAY_ADMIN_SECRET of the Worker (npx wrangler secret put PLAY_ADMIN_SECRET)
// The backends are the BEHAVIOUR.primary and BEHAVIOUR.backup of src/config.js.
// export   reads every row of both backends into one file: per row its backend and id, day, date, ms, u, deep, kind, skill, v, pz, and `key` = the
//          puzzle as plain text (a local row: decoded from pz; a Game of Day: the file DIR/<date>.txt when --gotd-dir is given). The same game stored
//          twice (a retry, or on both backends) is listed once; `dropped` says how many. A row whose puzzle does not decode is marked `bad`.
// delete   removes the rows a selector matches, on the backend that holds them: --ids (backend:id as in the export), --puzzle FILE (every row of that
//          puzzle, plain text), --gotd DAY (every Game-of-Day and replay row of that day), --day DAY (every row of that UTC day). One selector at a time.
//          Without --yes it only lists what it would delete. Duplicates are matched too (they are rows).
// migrate  adds the columns of COLUMNS (src/core/behaviour.js) that a table lacks. Turso: done. Cloudflare: prints the wrangler commands to run.
import fs from 'node:fs';
import { LEADERBOARD, BEHAVIOUR } from '../src/config.js';
import { dateOfDay } from '../src/features/daily.js';
import { createAdmin, describe, dedupe, select, idsOf } from './behaviour-lib.mjs';

const args = process.argv.slice(2), cmd = args[0];
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const die = msg => { console.error('ERROR: ' + msg); process.exit(1); };
const readFile = (flag, what) => {
  const file = opt(flag); if (!file) return null;
  try { return fs.readFileSync(file, 'utf8').trim() || die(`the ${what} file ${file} is empty`); } catch (e) { return die(`cannot read the ${what} file ${file}: ${e.code || e.message}`); }
};
if (!['export', 'delete', 'migrate'].includes(cmd)) die('usage: node tools/behaviour.mjs export|delete|migrate ... (see the top of this file)');

const entries = [...new Set([BEHAVIOUR.primary, BEHAVIOUR.backup])].map(id => LEADERBOARD.backends[id]).filter(Boolean);
const tursoEntry = entries.find(e => e.type === 'turso' && e.url), cloudflareEntry = entries.find(e => e.type === 'cloudflare' && e.url);
const tursoToken = readFile('--turso-token-file', 'Turso token'), secret = readFile('--token-file', 'Cloudflare secret');
const admin = createAdmin({
  turso: tursoEntry && tursoToken ? { url: tursoEntry.url, token: tursoToken } : null,
  cloudflare: cloudflareEntry && secret ? { url: cloudflareEntry.url, secret } : null,
});
if (!tursoToken && !secret) die('give --turso-token-file and/or --token-file');
if (tursoToken && !tursoEntry) console.log('note: no Turso backend in BEHAVIOUR (src/config.js): --turso-token-file ignored');
if (secret && !cloudflareEntry) console.log('note: no Cloudflare backend in BEHAVIOUR (src/config.js): --token-file ignored');

try {
  if (cmd === 'migrate') {
    const done = await admin.migrate(opt('--d1-name'));
    for (const sql of done.turso) console.log('Turso: ' + sql);
    if (!done.turso.length && tursoToken) console.log('Turso: nothing to add');
    for (const c of done.cloudflare) console.log('Cloudflare, run this: ' + c);
    if (!done.cloudflare.length && secret) console.log('Cloudflare: nothing to add');
  } else {
    const { rows, columns } = await admin.exportRows();
    console.log(`read ${rows.length} rows: ` + ['turso', 'cloudflare'].filter(w => columns[w]).map(w => `${w} ${rows.filter(r => r.where === w).length}`).join(', '));
    if (cmd === 'export') {
      const out = opt('--out') || die('export needs --out FILE');
      const dir = opt('--gotd-dir'), gotdFiles = {};
      if (dir) for (const day of new Set(rows.map(r => r.day))) {
        const date = dateOfDay(day);
        try { gotdFiles[date] = fs.readFileSync(`${dir}/${date}.txt`, 'utf8'); } catch { /* no file that day: key stays null */ }
      }
      const { rows: unique, dropped } = dedupe(rows), described = describe(unique, gotdFiles);
      fs.writeFileSync(out, JSON.stringify({ exported: new Date().toISOString(), dropped, columns, rows: described }, null, 1));
      console.log(`wrote ${described.length} rows to ${out} (${dropped} duplicates dropped, ${described.filter(r => r.bad).length} bad)`);
    } else {
      const sel = { ids: opt('--ids') && opt('--ids').split(','), puzzle: opt('--puzzle') && fs.readFileSync(opt('--puzzle'), 'utf8'), gotd: opt('--gotd'), day: opt('--day') };
      const hit = select(rows, sel), ids = idsOf(hit);
      console.log(`${hit.length} rows match (turso ${ids.turso.length}, cloudflare ${ids.cloudflare.length}):`);
      for (const r of hit.slice(0, 20)) console.log(`  ${r.where}:${r.id}  day ${r.day}  ${r.ms} ms`);
      if (hit.length > 20) console.log(`  ... and ${hit.length - 20} more`);
      if (!hit.length) process.exit(0);
      if (!args.includes('--yes')) console.log('nothing deleted: add --yes to delete them');
      else { const done = await admin.deleteRows(ids); console.log(`deleted: turso ${done.turso}, cloudflare ${done.cloudflare}`); }
    }
  }
} catch (e) { die(e.message); }
