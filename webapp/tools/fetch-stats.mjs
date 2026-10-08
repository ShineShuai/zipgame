// Saves every configured backend's /stats reply as JSON, for `size-level.mjs --stats FILE ...`.
//   node tools/fetch-stats.mjs [--days 60] [--dir stats]
import fs from 'node:fs';
import { LEADERBOARD } from '../src/config.js';
import { backendsFromConfig } from '../src/platform/leaderboard.js';
import { parseDays, dayList } from '../src/core/stats-merge.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const nDays = +opt('--days', 60), dir = opt('--dir', 'stats');
const list = dayList(nDays), range = { from: list[0], to: list.at(-1) };

fs.mkdirSync(dir, { recursive: true });
const saved = await Promise.all(backendsFromConfig(LEADERBOARD).list.map(async be => {
  const { url, init } = be.read(range), ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json(), reply = be.decode ? be.decode('read', body) : body;
    const days = parseDays(reply);
    if (!days) throw new Error('malformed reply');
    const file = `${dir}/${be.name}.json`;
    fs.writeFileSync(file, JSON.stringify(reply));
    console.log(`ok     ${be.name}: ${days.length} day(s) -> ${file}`);
    return file;
  } catch (e) {
    console.error(`FAILED ${be.name}: ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
}));

const files = saved.filter(Boolean);
if (!files.length) process.exit(1);
console.log(`\nnode tools/size-level.mjs ${files.map(f => `--stats ${f}`).join(' ')}`);
