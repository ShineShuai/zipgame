// Shared input of the Game-of-Day analyses: the backends' day statistics and the plain puzzle files.
//   loadDays({ statsFiles, days, log })   all backends' days as combineDays makes them (see gotd-seed.mjs, which keeps its own copy):
//                                         from saved /stats replies (statsFiles) or, without them, read from the configured backends
//   loadPuzzles(dir, { log })             Map(day number -> { n, h, authorS? }) of the files YYYYMMDD.txt in dir: size, h = the unrounded Play
//                                         badge score (clamped to 0-5) and the author's own `# play_time_s` comment, when the file has one
import fs from 'node:fs';
import { LEADERBOARD } from '../src/config.js';
import { backendsFromConfig } from '../src/platform/leaderboard.js';
import { fetchStats } from '../src/platform/stats-client.js';
import { parseDays, combineDays, dayList } from '../src/core/stats-merge.js';
import { parse, commentTimes } from '../src/core/format.js';
import { validate } from '../src/core/model.js';
import { trapMetrics } from '../src/core/trap.js';
import { clampH } from '../src/core/gotd-model.js';

export async function loadDays({ statsFiles = [], days = 45, log = console.log } = {}) {
  if (statsFiles.length) {
    const results = statsFiles.map(path => {
      const parsed = parseDays(JSON.parse(fs.readFileSync(path, 'utf8')));
      if (!parsed) throw new Error(`${path}: malformed stats reply`);
      return { name: path, days: parsed };
    });
    return combineDays(results, LEADERBOARD.replicatedFrom, LEADERBOARD.replicatedTo);
  }
  const list = dayList(days), setup = backendsFromConfig(LEADERBOARD);
  const results = await fetchStats(setup.list, { from: list[0], to: list.at(-1) });
  for (const r of results) log(`read ${r.name}: ${r.status}${r.status === 'ok' ? `, ${r.days.length} day(s)` : ` (${r.error})`}`);
  if (!results.some(r => r.status === 'ok')) throw new Error('no backend could be read (offline? save /stats replies and pass them with --stats)');
  return combineDays(results.filter(r => r.status === 'ok'), LEADERBOARD.replicatedFrom, LEADERBOARD.replicatedTo);
}

export function loadPuzzles(dir, { log = console.log } = {}) {
  const out = new Map();
  if (!fs.existsSync(dir)) throw new Error(`no puzzle directory ${dir} (use --puzzles DIR)`);
  for (const f of fs.readdirSync(dir).filter(f => /^\d{8}\.txt$/.test(f)).sort()) {
    const text = fs.readFileSync(`${dir}/${f}`, 'utf8');
    try {
      const p = parse(text), m = validate(p).ok ? trapMetrics(p) : null;
      if (!m || !m.ok) { log(`skipped ${f}: no trap grade`); continue; }
      out.set(+f.slice(0, 8), { n: p.n, h: clampH(m.predicted), authorS: commentTimes(text).playS });
    } catch (e) { log(`skipped ${f}: ${e.message}`); }
  }
  return out;
}
