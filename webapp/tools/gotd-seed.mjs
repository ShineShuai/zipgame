#!/usr/bin/env node
// Seeds one Game-of-Day with 3..8 synthetic players so the first real players already see averages and a percentile.
//   node tools/gotd-seed.mjs --token-file FILE --print-supabase-sql      prints the one SQL statement that gives Supabase the secret's hash, then exits
//   node tools/gotd-seed.mjs [--day YYYYMMDD] [--dry-run] [--token-file FILE] [--only cloudflare|supabase] [--stats file.json ...] [--puzzles dir] [--models file]
//                            [--summary FILE] [--annotations]
// Steps: the puzzle of the day gets its difficulty h (0-5, the scale of the hand ratings) from every fitted candidate (tools/gotd-models.json, written
// by gotd-fit.mjs); the first 3 defined candidates play, of the next 7 the lowest and highest h are dropped (gotd-model.js selectEntries).
// The production grade (Play badge, trapPredicted unrounded) always plays; its h is the raw value, the scale the time model is fitted on.
// Behind the top 3 a candidate needs skill >= EXTRA_MIN_SKILL. No time is below the drawing floor (gotd-model.js floorMs) when the puzzle needs thinking
// (larger than 6x6 or grade >= 1): in the calibration such plays are replays and are left out, and no seed player is faster. Each h becomes a
// solve time with a model learned from the backends' past days (their real players only, seeds are subtracted; before there is data the
// prior of gotd-model.js applies). Every backend gets the times once: a retry answers "exists" and changes nothing.
//   --token-file  file holding the shared secret of both backends (surrounding whitespace is ignored); required unless --dry-run
//   --summary   append a markdown summary to FILE (GitHub Actions: "$GITHUB_STEP_SUMMARY");  --annotations  print warnings/errors as ::warning:: / ::error::
//   --day       default: tomorrow UTC (the backends accept day +-1; the cron runs in the evening)
//   --stats     read this backend reply ({ days: [...] }, e.g. saved from GET /stats) instead of fetching; repeat for several backends
//   --puzzles   default ../demo/GameOfDay next to webapp/
// The output also lists, per selected metric, the time it would give for each grade 0..5 (grade:* metrics: their own grade mapped onto the human scale; the others are on it already).
// A missing puzzle file is a warning, not an error (the play app shows no Game of Day that day either).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { LEADERBOARD } from '../src/config.js';
import { backendsFromConfig } from '../src/platform/leaderboard.js';
import { fetchStats } from '../src/platform/stats-client.js';
import { parseDays, mergeDays, quantile, dayList } from '../src/core/stats-merge.js';
import { utcDateString } from '../src/features/daily.js';
import { parse } from '../src/core/format.js';
import { validate } from '../src/core/model.js';
import { trapMetrics } from '../src/core/trap.js';
import { binOf } from '../src/core/hist.js';
import { NAMES, INFO, featuresOf, needsSolver, isGrade } from './features.mjs';
import { TIME_PRIOR, EXTRA_MIN_SKILL, selectEntries, predictH, clampH, withoutSeeds, fitTime, predictMs, floorMs, needsThinking, aboveFloor, FLOOR_S_PER_CELL } from '../src/core/gotd-model.js';
const BADGE = 'trapPredicted';

const args = process.argv.slice(2), here = p => new URL(p, import.meta.url).pathname;
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const optAll = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const dry = args.includes('--dry-run'), only = opt('--only');
const note = (level, msg) => console.log(args.includes('--annotations') ? `::${level}::${msg}` : `${level.toUpperCase()}: ${msg}`);
const die = msg => { note('error', msg); process.exit(1); };

// the token is read first, so a wrong path fails at once and not after the calibration
const readToken = () => {
  const file = opt('--token-file') || die('--token-file FILE is required (or --dry-run)');
  let t; try { t = fs.readFileSync(file, 'utf8').trim(); } catch (e) { die(`cannot read the token file ${file}: ${e.code || e.message}`); }
  return t || die(`the token file ${file} is empty`);
};
if (args.includes('--print-supabase-sql')) { // Supabase keeps only the SHA-256 of the secret (gotd_secret); this is the statement for its SQL editor
  console.log(`insert into gotd_secret (name, hash) values ('seed', '${crypto.createHash('sha256').update(readToken(), 'utf8').digest('hex')}') on conflict (name) do update set hash = excluded.hash;`);
  process.exit(0);
}
const token = dry ? null : readToken();

const day = opt('--day') || utcDateString(new Date(Date.now() + 86400000));
if (!/^\d{8}$/.test(day)) die(`bad --day ${day}`);
const dir = opt('--puzzles') || here('../../demo/GameOfDay'), puzzleFile = d => `${dir}/${d}.txt`;
if (!fs.existsSync(puzzleFile(day))) { note('warning', `no puzzle file ${puzzleFile(day)}: nothing to seed for ${day}`); process.exit(0); }

// ---------- candidates of the day ----------
const models = JSON.parse(fs.readFileSync(opt('--models') || here('./gotd-models.json'), 'utf8')), byId = Object.fromEntries(models.ranked.map(c => [c.id, c]));
const unknown = models.ranked.filter(c => !NAMES.includes(c.id)).map(c => c.id);
if (unknown.length) die(`gotd-models.json names metrics that no longer exist (${unknown.join(', ')}): run node tools/gotd-fit.mjs`);
const sha = crypto.createHash('sha256').update(fs.readFileSync(here('./ratings.json'))).digest('hex');
if (sha !== models.ratings.sha256) note('warning', 'gotd-models.json was fitted on a different ratings.json: run node tools/gotd-fit.mjs');

const text = fs.readFileSync(puzzleFile(day), 'utf8'), puzzle = parse(text);
if (!validate(puzzle).ok) die(`${puzzleFile(day)} is not a valid puzzle`);
const f = featuresOf({ key: text });
let entries;
if (!Number.isFinite(f[BADGE])) note('warning', 'no trap grade for this puzzle: the production grade is not among the seed players');
try { entries = selectEntries(models.ranked, id => (needsSolver(id) && f._capped ? undefined : predictH(byId[id].model, f[id])), Number.isFinite(f[BADGE]) ? { id: BADGE, h: clampH(f[BADGE]) } : null, EXTRA_MIN_SKILL); } catch (e) { die(`${day}: ${e.message}`); }

// ---------- time model from the backends' past days ----------
async function loadDays() {
  const files = optAll('--stats');
  if (files.length) return mergeDays(files.map(p => { const d = parseDays(JSON.parse(fs.readFileSync(p, 'utf8'))); if (!d) die(`${p}: malformed stats reply`); return d; }));
  const list = dayList(45), results = await fetchStats(backendsFromConfig(LEADERBOARD), { from: list[0], to: list.at(-1) });
  for (const r of results) console.log(`read ${r.name}: ${r.status}${r.status === 'ok' ? `, ${r.days.length} day(s)` : ` (${r.error})`}`);
  return mergeDays(results.filter(r => r.status === 'ok').map(r => r.days));
}
const points = [], skipped = [];
for (const d of await loadDays()) {
  if (String(d.d) === day || !fs.existsSync(puzzleFile(d.d))) continue;
  const real = withoutSeeds(d);
  if (!real) { note('warning', `${d.d}: the seeds do not fit into the aggregate, day skipped`); continue; }
  if (real.n < TIME_PRIOR.minReal) { skipped.push(`${d.d} (${real.n} players)`); continue; }
  const p = parse(fs.readFileSync(puzzleFile(d.d), 'utf8')), m = trapMetrics(p);
  if (!m.ok) continue;
  const h = clampH(m.predicted), cut = needsThinking(p.n, h) ? aboveFloor(real.bins, p.n) : { bins: real.bins, n: real.n, cut: 0 };
  if (cut.n < TIME_PRIOR.minReal) { skipped.push(`${d.d} (${cut.n} of ${real.n} players above the ${(floorMs(p.n) / 1000).toFixed(0)} s floor)`); continue; }
  points.push({ day: d.d, n: p.n, h, y: Math.log(quantile(cut.bins, 0.5)), count: cut.n });
}
const tm = fitTime(points), [a, g, c] = tm.mean, [sa, sg, sc] = tm.sd;
console.log(`time model from ${points.length} past day(s) with >= ${TIME_PRIOR.minReal} real players${points.length ? '' : ' (none: prior only)'}${skipped.length ? `; too few players, not used: ${skipped.join(', ')}` : ''}:`);
console.log(`  median at 7x7, h ${TIME_PRIOR.refH}: ${(Math.exp(a) / 1000).toFixed(1)} s (x${Math.exp(sa).toFixed(2)})  size exponent ${g.toFixed(2)} (+-${sg.toFixed(2)})  per grade x${Math.exp(c).toFixed(2)} (c ${c.toFixed(2)} +-${sc.toFixed(2)})`);

const timeAt = h => Math.max(predictMs(tm, puzzle.n, h), needsThinking(puzzle.n, h) ? floorMs(puzzle.n) : 0);
console.log(`drawing floor ${(floorMs(puzzle.n) / 1000).toFixed(1)} s (${FLOOR_S_PER_CELL} s per cell): no seed player is faster when the puzzle needs thinking (larger than 6x6, or grade >= 1)`);
const times = entries.map(e => ({ ...e, ms: timeAt(e.h) })).sort((x, y) => x.ms - y.ms);
const ms = times.map(t => t.ms), bins = ms.map(binOf);
console.log(`${day}: ${puzzle.n}x${puzzle.n}${f._capped ? ', reference solve capped: solver metrics skipped' : ''} -> ${times.length} seed players (h = difficulty on the 0-5 scale of the hand ratings)`);
for (const t of times) console.log(`  ${(t.ms / 1000).toFixed(1).padStart(7)} s  h ${t.h.toFixed(2)}  ${t.role.padEnd(5)} ${t.id}${t.id === BADGE ? '  (production grade, Play badge before rounding)' : ''}`);
console.log('what the selected names mean (design app label in brackets):');
for (const t of times) console.log(`  ${t.id}: ${INFO[t.id][0]}${INFO[t.id][1] ? ` [${INFO[t.id][1]}]` : ' [not shown in the design app]'}`);
// time of a puzzle of this size at grade g = 0..5 of metric `id`. A grade:* metric first maps its own grade onto h (the mean rating of the rated puzzles
// with that grade, see gotd-fit.mjs); `*` = no rated puzzle had that grade (interpolated); [x] = the grade this puzzle has.
const GRADES = [0, 1, 2, 3, 4, 5], sec = ms => (ms < 1e5 ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(0));
const seenOf = id => byId[id].seen || (byId[id].model.kind === 'bucket' ? Object.keys(byId[id].model.table).map(Number) : null);
const byGrade = id => GRADES.map(g => { const h = isGrade(id) ? predictH(byId[id].model, g) : g; return { h, ms: timeAt(h), guess: isGrade(id) && !!seenOf(id) && !seenOf(id).includes(g), own: isGrade(id) && f[id] === g }; });
const grid = [['Play badge', GRADES.map(g => ({ h: g, ms: timeAt(g) }))], ...times.map(t => [t.id, byGrade(t.id)])];
const cell = c => (c.guess ? '*' : '') + (c.own ? `[${sec(c.ms)}]` : sec(c.ms));
console.log(`time (s) at grade 0..5, ${puzzle.n}x${puzzle.n}. Play badge row: grade g = h g. grade:* metrics: their own grade g means the h on the line below (mean rating of the rated puzzles with that grade); every other metric is on h already. [x] = this puzzle's grade, * = no rated puzzle had it`);
for (const [id, row] of grid) {
  console.log(`  ${id.padEnd(14)}${row.map(c => cell(c).padStart(8)).join('')}${row.some((c, i) => i && c.ms < row[i - 1].ms) ? '  not monotone' : ''}`);
  if (isGrade(id)) console.log(`  ${'  h at grade'.padEnd(14)}${row.map(c => c.h.toFixed(2).padStart(8)).join('')}`);
}
if (opt('--summary')) fs.appendFileSync(opt('--summary'), `### Seeds ${day} (${puzzle.n}x${puzzle.n}${dry ? ', dry run' : ''})\n| s | h | role | candidate |\n|--:|--:|---|---|\n${times.map(t => `| ${(t.ms / 1000).toFixed(1)} | ${t.h.toFixed(2)} | ${t.role} | ${t.id} |`).join('\n')}\n\ntime (s) at grade 0..5\n\n| candidate | 0 | 1 | 2 | 3 | 4 | 5 |\n|---|--:|--:|--:|--:|--:|--:|\n${grid.map(([id, row]) => `| ${id} | ${row.map(cell).join(' | ')} |`).join('\n')}\n\ntime model from ${points.length} day(s)\n`);
if (dry) { console.log('dry run: nothing sent'); process.exit(0); }

// ---------- write (once per backend; "exists" = already seeded) ----------
const d = +day, trim = u => u.replace(/\/+$/, '');
const REQUEST = {
  cloudflare: ({ url }) => ({ url: trim(url) + '/seed', headers: { Authorization: 'Bearer ' + token }, body: { d, ms, bins } }),
  supabase: ({ url, key }) => ({ url: trim(url) + '/rest/v1/rpc/seed_gotd', headers: { apikey: key }, body: { p_token: token, p_day: d, p_ms: ms, p_bin: bins } }),
};
async function send(name) {
  const { url, headers, body } = REQUEST[name](LEADERBOARD[name]);
  for (let attempt = 1, why; attempt <= 3; attempt++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
      const reply = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) return reply.status === 'exists' || res.status === 409 ? 'exists' : 'ok';
      if (res.status < 500 && res.status !== 429) return `failed: HTTP ${res.status} ${JSON.stringify(reply).slice(0, 120)}`; // rejected input / wrong token: retrying cannot help
      why = `HTTP ${res.status}`;
    } catch (e) { why = e.name === 'AbortError' ? 'timeout' : e.message; } finally { clearTimeout(timer); }
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    else return `failed: ${why}`;
  }
}
let failed = 0;
for (const name of LEADERBOARD.order.filter(n => REQUEST[n] && LEADERBOARD[n]?.url && (!only || only === n))) {
  const r = await send(name);
  console.log(`${name}: ${r}`);
  if (r.startsWith('failed')) { failed++; note('error', `${name} ${r}`); }
}
process.exit(failed ? 1 : 0);
