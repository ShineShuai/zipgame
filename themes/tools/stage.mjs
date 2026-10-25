// Puts a theme on the stage for an event, and takes it off again. The stage is the `theme_stage` table of the Turso database
// (server/turso/theme_stage.sql): the only place a theme is ever served from, and only while its event runs. This tool writes
// the SQL; you run it with your own login (the browser's token can only read):
//   node themes/tools/stage.mjs publish candy --event 202611-autumn --from 2026-11-01 --until 2026-11-08 | turso db shell zipgame
//   node themes/tools/stage.mjs withdraw --event 202611-autumn | turso db shell zipgame
// Dates are UTC days; --until is the first moment the offer is gone. Withdrawing deletes the row: that, not the clock, is what ends
// an offer (a browser's clock is not trusted). Several events (or several themes in one event, with different --event names) may
// be on the stage at once.
import { loadBase, loadThemes, packTheme } from './pack.mjs';

const EVENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const sql = text => `'${String(text).replaceAll("'", "''")}'`;
const day = text => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text ?? '')) throw new Error(`not a date (YYYY-MM-DD): ${text}`);
  return Date.parse(`${text}T00:00:00Z`);
};

export function publishSql({ bundle, event, from, until }) {
  if (!EVENT.test(event ?? '')) throw new Error(`event must be lowercase letters, digits and dashes (max 40): ${event}`);
  const [fromMs, untilMs] = [day(from), day(until)];
  if (!(untilMs > fromMs)) throw new Error('--until must be after --from');
  const json = JSON.stringify(bundle);
  return `INSERT OR REPLACE INTO theme_stage (event, theme, v, from_ms, until_ms, bundle) VALUES (${sql(event)}, ${sql(bundle.id)}, ${bundle.v}, ${fromMs}, ${untilMs}, ${sql(json)});\n`;
}

export const withdrawSql = event => {
  if (!EVENT.test(event ?? '')) throw new Error(`event must be lowercase letters, digits and dashes (max 40): ${event}`);
  return `DELETE FROM theme_stage WHERE event = ${sql(event)};\n`;
};

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const [command, ...rest] = process.argv.slice(2);
  const opt = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (command === 'publish') {
      const theme = loadThemes().find(t => t.id === rest[0]);
      if (!theme) throw new Error(`no theme ${rest[0]} in themes/`);
      const { bundle, problems } = packTheme(theme, loadBase());
      if (problems.length) throw new Error(`the theme has problems:\n  ${problems.join('\n  ')}`);
      process.stdout.write(publishSql({ bundle, event: opt('event'), from: opt('from'), until: opt('until') }));
    } else if (command === 'withdraw') {
      process.stdout.write(withdrawSql(opt('event')));
    } else {
      console.error('usage: stage.mjs publish <id> --event E --from YYYY-MM-DD --until YYYY-MM-DD | stage.mjs withdraw --event E');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
