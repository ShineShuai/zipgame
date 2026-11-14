#!/usr/bin/env node
// The automatic Game of Day: a queue of candidate puzzles that are Hard or harder, distinct from every puzzle we have, with the sizes of a fixed schedule.
//   node tools/gotd-gen.mjs fill     [--today YYYYMMDD] [--horizon 30] [--per-slot 3] [--max-new 24] [--max-attempts 120] [--dry-run] [--summary FILE] [--annotations]
//   node tools/gotd-gen.mjs promote  [--today YYYYMMDD] [--until YYYYMMDD | --horizon N] [--dry-run] [--summary FILE] [--annotations]   verdicts -> statuses, approved candidates -> published days
//   node tools/gotd-gen.mjs check    [--annotations]       every puzzle of the published days, the queue and its rejected ones is distinct; index and verdicts.json are valid (exit 1 if not)
//   node tools/gotd-gen.mjs status   [--today YYYYMMDD] [--horizon N]    stamp, days ahead, queue by size, the next 14 days
//   node tools/gotd-gen.mjs schedule [--from YYYYMMDD] [--days 28]    the size of each day and how often each size occurs
//   node tools/gotd-gen.mjs merge    --from FILE[,FILE...] [--dry-run]    verdicts.json files of other devices -> <queue>/verdicts.json (newer wins, a tie goes to reject)
//   node tools/gotd-gen.mjs harvest  [--from FILE[,FILE...]] [--solved-only] [--dry-run]    rated verdicts -> new rows of the ratings file (the labels of every grading fit)
//   node tools/gotd-gen.mjs keys     [--dry-run]    older verdicts get their puzzle (`key`) from the files, so <queue>/verdicts.json is self-contained
//   all: [--puzzles DIR] [--queue DIR] [--ratings FILE] [--verdicts FILE]    defaults: demo/GameOfDay, demo/GameOfDay-queue, webapp/tools/ratings.json (next to webapp/),
//   <queue>/verdicts.json
// fill: every open day (no file in demo/GameOfDay yet) from today to today + horizon gets per-slot candidates of the size the schedule gives that
//   day (src/core/gotd-schedule.js, a function of the date alone). A candidate comes from generateTargeted(size, 3 or harder, seed) and has to pass
//   the gates of src/core/gotd-gen.js (grade with margin, unique, distinct up to rotation / reflection / reversed numbering, from published puzzles,
//   the queue, rejected ones and the rated ones of ratings.json). No clock decides anything: the same files and arguments give the same candidates
//   (seed = stamp, day, size, attempt), so a rerun adds nothing. A stamp covers the generator, the trap model and the settings: a pending candidate of
//   an older stamp does not count, an approved one always does. Files: <queue>/c-<size>-<id>.txt (no solution path, a reviewer plays it blind; two comment lines say how it was made: the summary line of
//   gen-target.mjs and the gen-target command that makes it again, copied into the published day) and
//   <queue>/index.json (what the gates measured, the attempts spent per day, the status).
// promote: the human's side. The design app's "GOTD review" panel plays a pending candidate blind and the reviewer rates it; its export is <queue>/verdicts.json
//   (src/core/gotd-verdict.js: the reviewer's Approve / Reject decides, a rating is optional and only suggests). The panel offers the candidates in the order of the open days
//   they fill, then the extra ones that no open day needs (planReview of src/core/gotd-queue.js: a published, past or already covered day is never offered). promote sets the status of every candidate that has a verdict (a rejected one moves to <queue>/rejected/, where it stays
//   blocked as a duplicate), then gives every approved candidate the earliest open day (no file yet) of its size, as far ahead as it takes (the approval is the gate; --until or --horizon limit it): it is re-vetted with the code of today (a puzzle
//   that is no longer unique, valid or distinct is not published; one that only misses the grade or margin of the current model IS published, with a warning: the human judged it),
//   written as demo/GameOfDay/YYYYMMDD.txt with the reviewer's rating and play time in comments, and removed from the queue. An approved candidate that fails the re-vet
//   (exit 1) does not leave its day empty: the next approved candidate of that size takes the day. `fill` and `status` read the verdicts too.
// merge: the review runs on several devices, each with its own verdicts.json. A file is read alone (`key` in a verdict is its puzzle) and merged into the queue's verdicts.json
//   the way the panel's Import… does; verdicts both sides have with a different decision or rating are listed with the one that was kept.
// harvest: the fits (fit-trap.mjs --write, gotd-fit.mjs) read only tools/ratings.json, never verdicts. harvest appends every rated verdict (from <queue>/verdicts.json and --from files)
//   whose puzzle is not in the ratings file yet as { key, human, lo, hi, unsure? } rows; the next commit of ratings.json refits (tools/pre-commit-refresh.sh labels). A puzzle that is
//   already rated (another rating: listed, kept) or equivalent to a rated one (listed, not added) is never added twice, so a rerun adds nothing. A verdict without `key` (older panel)
//   takes its puzzle from the files by id (published days, queue, rejected); `keys` writes those keys into <queue>/verdicts.json once, while the files exist (a verdict whose puzzle
//   has no file anywhere stays as it is, listed). --solved-only leaves out a rating given after giving up. It refuses a ratings file that is not in canonical
//   form (node tools/check-ratings.mjs --fix first), because appending rewrites the file. `fill` keeps blocking puzzles of the ratings file, so a harvested puzzle is never offered again.
// check replaces demo/GameOfDay/check_unique_puzzles.py (exact copies only). Exit codes: 0 ok, 1 an error (or bad arguments; for promote: an approved candidate could not be published).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/core/format.js';
import { validate } from '../src/core/model.js';
import { parseRatingsJson, toRatingsJson, ratingKey, symmetryKey, asciiPuzzle } from '../src/core/ratings-io.js';
import { solutionPath } from '../src/core/trap.js';
import { OFFLINE_PATH_CAP } from './lib.mjs';
import { GOTD_CFG, genStamp, createDistinct, pathKey, puzzleId, candidateText, publishedText, carriedOrigin, vetCandidate } from '../src/core/gotd-gen.js';
import { dayOfDate, dateOfDay, sizeForDay, SIZE_BAG } from '../src/core/gotd-schedule.js';
import { emptyIndex, parseIndex, formatIndex, planFill, planPromote, planReview, fillQueue, applyFill, usable } from '../src/core/gotd-queue.js';
import { parseVerdicts, formatVerdicts, mergeVerdicts, verdictConflicts, harvestRatings, applyVerdicts, reviewStats } from '../src/core/gotd-verdict.js';

const args = process.argv.slice(2), cmd = args[0];
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = name => args.includes('--' + name);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = {
  puzzles: path.resolve(opt('puzzles', path.join(root, 'demo/GameOfDay'))),
  queue: path.resolve(opt('queue', path.join(root, 'demo/GameOfDay-queue'))),
  ratings: path.resolve(opt('ratings', path.join(root, 'webapp/tools/ratings.json'))),
};
const indexFile = path.join(dir.queue, 'index.json');
const verdictsFile = path.resolve(opt('verdicts', path.join(dir.queue, 'verdicts.json')));
const rejectedDir = path.join(dir.queue, 'rejected');
const rel = f => path.relative(root, f);
const note = (level, msg, file) => console.log(flag('annotations') ? `::${level}${file ? ` file=${rel(file)}` : ''}::${msg}` : `${level.toUpperCase()}: ${file ? rel(file) + ': ' : ''}${msg}`);
const die = msg => { console.error(`gotd-gen: ${msg}`); process.exit(1); };
const int = (name, dflt, min) => {
  const v = opt(name) === undefined ? dflt : Number(opt(name));
  if (!Number.isInteger(v) || v < min) die(`--${name} needs an integer >= ${min}`);
  return v;
};
const dayArg = (name, dflt) => {
  const v = opt(name);
  if (v === undefined) return dflt;
  try { return dayOfDate(v); } catch (e) { return die(`--${name}: ${e.message}`); }
};
const todayUtc = () => Math.floor(Date.now() / 86400000);

// ---- files ----
function txtFiles(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const f = path.join(d, e.name);
    return e.isDirectory() ? txtFiles(f) : e.name.endsWith('.txt') ? [f] : [];
  }).sort();
}
function loadPuzzle(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const p = parse(text), v = validate(p);
    return v.ok ? { file, text, p, symKey: symmetryKey(p) } : { file, text, error: v.msg };
  } catch (e) { return { file, text, error: e.message }; }
}
const dateOf = file => path.basename(file).match(/^(\d{8})\.txt$/)?.[1];
function readIndex() {
  if (!fs.existsSync(indexFile)) return emptyIndex();
  try { return parseIndex(fs.readFileSync(indexFile, 'utf8')); } catch (e) { return die(e.message); }
}
const loadVerdicts = () => (fs.existsSync(verdictsFile) ? parseVerdicts(fs.readFileSync(verdictsFile, 'utf8')) : []);
function readVerdicts() {
  try { return loadVerdicts(); } catch (e) { return die(e.message); }
}
// the index with the verdicts applied (statuses only; promote moves the files)
const readState = () => { const verdicts = readVerdicts(); return { verdicts, ...applyVerdicts(readIndex(), verdicts) }; };
function ratedKeys() {
  if (!fs.existsSync(dir.ratings)) return [];
  return parseRatingsJson(fs.readFileSync(dir.ratings, 'utf8')).ratings.map(r => symmetryKey(r.key));
}
const publishedDates = published => new Set(published.map(r => dateOf(r.file)).filter(Boolean));

// ---- check ----
function check() {
  const published = txtFiles(dir.puzzles).map(loadPuzzle), queued = txtFiles(dir.queue).map(loadPuzzle);
  let errors = 0;
  const seen = new Map(); // symmetry key -> record
  for (const [recs, kind] of [[published, 'published'], [queued, 'queue']]) {
    for (const r of recs) {
      if (r.error) {
        // a date-named file is a game that players load; any other .txt next to them is only reported, as before
        if (kind === 'queue' || dateOf(r.file)) { errors++; note('error', `does not parse or is not a valid puzzle: ${r.error}`, r.file); } else note('warning', r.error, r.file);
        continue;
      }
      const first = seen.get(r.symKey);
      if (first) {
        errors++;
        note('error', `duplicate of ${rel(first.file)} (the same puzzle up to rotation, reflection or reversed numbering)`, r.file);
        console.log(`--- ${rel(first.file)} ---\n${asciiPuzzle(first.symKey)}\n--- ${rel(r.file)} ---\n${asciiPuzzle(r.symKey)}`);
      } else seen.set(r.symKey, r);
    }
  }
  // the queue's files and its index describe the same candidates
  const index = readIndex(), files = new Map(queued.filter(r => !r.error).map(r => [path.basename(r.file), r]));
  for (const c of index.candidates) {
    const r = files.get(c.file);
    if (!r) { errors++; note('error', `candidate ${c.id} (${c.status}) has no file ${c.file}`, indexFile); continue; }
    if (puzzleId(r.symKey) !== c.id) { errors++; note('error', `the puzzle in ${c.file} is not the one the index calls ${c.id}`, r.file); }
  }
  try { loadVerdicts(); } catch (e) { errors++; note('error', e.message, verdictsFile); }
  const ids = new Set(index.candidates.map(c => c.file));
  for (const r of queued) if (!r.error && !ids.has(path.basename(r.file)) && !rel(r.file).includes(`${path.sep}rejected${path.sep}`)) note('warning', 'not in index.json', r.file);
  if (errors) return 1;
  console.log(`OK: ${seen.size} distinct puzzles (${published.length} published, ${queued.length} in the queue)`);
  return 0;
}

// ---- fill ----
const sizeLine = s => `${s.date} ${s.size}x${s.size}: have ${s.have}, need ${s.need}, runs used ${s.attempts}`;
function fill() {
  const today = dayArg('today', todayUtc()), stamp = genStamp();
  const horizon = int('horizon', GOTD_CFG.horizon, 1), perSlot = int('per-slot', GOTD_CFG.perSlot, 1);
  const maxNew = int('max-new', 24, 0), maxAttempts = int('max-attempts', 120, 0);
  const index = readState().index, published = txtFiles(dir.puzzles).map(loadPuzzle);
  for (const r of published) if (r.error) note('warning', `skipped: ${r.error}`, r.file);
  const plan = planFill({ today, horizon, perSlot, published: publishedDates(published), index, stamp });
  console.log(`stamp ${stamp}; today ${dateOfDay(today)}; ${plan.slots.length} open day(s) of ${horizon}; ${plan.adopt.length} candidate(s) move to another day`);
  for (const s of plan.slots) console.log('  ' + sizeLine(s));
  if (flag('dry-run')) return 0;
  const lines = [];
  let result = { added: [], slots: {}, fails: {}, starved: [], tries: 0 };
  if (plan.slots.some(s => s.need > 0) && maxNew > 0) {
    // what a new candidate must differ from: published days, the queue (rejected ones too), the rated puzzles
    const distinct = createDistinct(), byId = new Map(index.candidates.map(c => [c.file, c]));
    for (const r of published) {
      if (r.error) continue;
      const sol = solutionPath(r.p, OFFLINE_PATH_CAP); // a published 12x12 needs ~3M nodes, more than the app's own budget
      if (!sol) note('warning', 'no solution within the search budget: only its puzzle, not its path, is compared', r.file);
      distinct.add({ symKey: r.symKey, pathKey: sol && pathKey(r.p.n, sol), where: rel(r.file) });
    }
    for (const f of txtFiles(dir.queue)) {
      const r = loadPuzzle(f);
      if (!r.error) distinct.add({ symKey: r.symKey, pathKey: byId.get(path.basename(f))?.pathKey, where: rel(f) });
    }
    for (const k of ratedKeys()) distinct.add({ symKey: k, where: 'a rated puzzle of ' + rel(dir.ratings) });
    result = fillQueue({ plan, distinct, stamp, maxNew, maxAttempts, log: msg => { console.log('  ' + msg); lines.push(msg); } });
  }
  const next = applyFill(index, plan, result);
  fs.mkdirSync(dir.queue, { recursive: true });
  for (const a of result.added) fs.writeFileSync(path.join(dir.queue, a.entry.file), candidateText(a.puzzle, a.entry, a.origin));
  const text = formatIndex(next);
  if (plan.adopt.length || result.added.length || Object.keys(result.slots).length || !fs.existsSync(indexFile) || fs.readFileSync(indexFile, 'utf8') !== text) fs.writeFileSync(indexFile, text);
  const fails = Object.entries(result.fails).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`added ${result.added.length} candidate(s) in ${result.tries} generator run(s)${fails ? `; rejected by the gates: ${fails}` : ''}`);
  for (const d of result.starved) note('warning', `${d} used all ${GOTD_CFG.maxAttemptsPerSlot} generator runs and still lacks candidates`);
  const summary = opt('summary');
  if (summary) {
    const body = [`### gotd-gen fill (${stamp})`, '', `${result.added.length} candidate(s) added in ${result.tries} run(s)${fails ? `, rejected: ${fails}` : ''}.`, '',
      '| day | size | have | need after |', '|---|---|---|---|',
      ...plan.slots.map(s => `| ${s.date} | ${s.size} | ${s.have + result.added.filter(a => a.entry.slot === s.date).length} | ${Math.max(0, s.need - result.added.filter(a => a.entry.slot === s.date).length)} |`), ''].join('\n');
    fs.appendFileSync(summary, body);
  }
  return 0;
}

// ---- promote ----
function promote() {
  const today = dayArg('today', todayUtc()), dry = flag('dry-run');
  const until = dayArg('until'), horizon = until !== undefined ? until - today + 1 : opt('horizon') === undefined ? undefined : int('horizon', 0, 1); // no limit unless asked
  if (horizon !== undefined && horizon < 1) die('--until is before today');
  const { verdicts, index: applied, changed } = readState();
  for (const c of changed) console.log(`verdict: ${c.id} ${c.from} -> ${c.to}`);
  const published = txtFiles(dir.puzzles).map(loadPuzzle);
  for (const r of published) if (r.error) note('warning', `skipped: ${r.error}`, r.file);
  const dates = publishedDates(published), byId = new Map(applied.candidates.map(c => [c.id, c]));
  const out = { published: [], rejected: [], failed: [], missing: [] };
  let candidates = applied.candidates;
  // rejected candidates leave the queue for rejected/ (their files keep blocking the same puzzle, see fill)
  for (const c of applied.candidates.filter(x => x.status === 'rejected')) {
    out.rejected.push(c.id);
    console.log(`reject: ${c.file} -> ${rel(path.join(rejectedDir, c.file))}`);
    if (!dry) {
      fs.mkdirSync(rejectedDir, { recursive: true });
      if (fs.existsSync(path.join(dir.queue, c.file))) fs.renameSync(path.join(dir.queue, c.file), path.join(rejectedDir, c.file));
    }
  }
  candidates = candidates.filter(c => c.status !== 'rejected');
  // The days are planned again after every candidate: one that fails the re-vet is set aside and its day goes to the next approved candidate of its size.
  const plan = () => planPromote({ today, horizon, published: dates, index: { ...applied, candidates: candidates.filter(c => !out.failed.includes(c.id)) } });
  let distinct = null; // what an approved candidate must still differ from: the published days (worked out when the first one is needed)
  for (let t = plan().find(p => p.id); t; t = plan().find(p => p.id)) {
    if (!distinct) {
      distinct = createDistinct();
      for (const r of published) {
        if (r.error) continue;
        const sol = solutionPath(r.p, OFFLINE_PATH_CAP);
        distinct.add({ symKey: r.symKey, pathKey: sol && pathKey(r.p.n, sol), where: rel(r.file) });
      }
    }
    const c = byId.get(t.id), file = path.join(dir.queue, c.file), target = path.join(dir.puzzles, `${t.date}.txt`);
    const fail = msg => { out.failed.push(c.id); note('error', `approved candidate ${c.id} cannot be published on ${t.date}: ${msg}`, file); };
    if (!fs.existsSync(file)) { fail('its file is missing'); continue; }
    const q = loadPuzzle(file);
    if (q.error) { fail(q.error); continue; }
    const v = vetCandidate(q.p, c.size, distinct, { holdGrade: true });
    if (!v.ok) { fail(`${v.reason}${v.detail ? ` (${v.detail})` : ''}`); continue; }
    if (v.drift) note('warning', `${c.id} on ${t.date}: ${v.drift} under the current model (stamp ${c.stamp} at creation); published because a human approved it`, file);
    distinct.add({ symKey: v.symKey, pathKey: v.entry.pathKey, where: rel(target) });
    console.log(`publish: ${t.date} ${c.size}x${c.size} <- ${c.id} (made for ${c.slot})`);
    out.published.push({ date: t.date, id: c.id });
    if (!dry) {
      fs.writeFileSync(target, publishedText(q.p, c, verdicts.find(x => x.id === c.id) || null, carriedOrigin(q.text)));
      fs.rmSync(file);
    }
    dates.add(t.date); // the day is closed now (a dry run only pretends)
    candidates = candidates.filter(x => x.id !== c.id);
  }
  out.missing = plan().filter(p => !p.id);
  for (const m of out.missing) console.log(`open: ${m.date} ${m.size}x${m.size}: no approved candidate`);
  // a published or past day needs no counter any more
  const nowPublished = new Set([...dates, ...out.published.map(p => p.date)]);
  const slots = Object.fromEntries(Object.entries(applied.slots).filter(([d]) => !nowPublished.has(d) && dayOfDate(d) >= today));
  const next = { ...applied, slots, candidates };
  const text = formatIndex(next);
  if (!dry && (!fs.existsSync(indexFile) ? candidates.length || Object.keys(slots).length : fs.readFileSync(indexFile, 'utf8') !== text)) { fs.mkdirSync(dir.queue, { recursive: true }); fs.writeFileSync(indexFile, text); }
  console.log(`${dry ? 'would publish' : 'published'} ${out.published.length} day(s), ${out.rejected.length} candidate(s) rejected, ${out.missing.length} open day(s) without an approved candidate`);
  const summary = opt('summary');
  if (summary && !dry) fs.appendFileSync(summary, `### gotd-gen promote\n\n${out.published.length} published${out.published.length ? ': ' + out.published.map(p => `${p.date} (${p.id})`).join(', ') : ''}; ${out.rejected.length} rejected; ${out.missing.length} open without an approved candidate.\n\n`);
  return out.failed.length ? 1 : 0;
}

// ---- status / schedule ----
function status() {
  const today = dayArg('today', todayUtc()), horizon = opt('horizon') === undefined ? undefined : int('horizon', 0, 1), stamp = genStamp(), { index, verdicts } = readState();
  const published = txtFiles(dir.puzzles).map(loadPuzzle).filter(r => !r.error), dates = publishedDates(published);
  let ahead = 0;
  while (dates.has(dateOfDay(today + ahead))) ahead++;
  console.log(`stamp ${stamp}\npublished: ${dates.size} day(s); ${ahead} in a row from ${dateOfDay(today)}${ahead < GOTD_CFG.bufferDays ? `  <- fewer than ${GOTD_CFG.bufferDays} (MIN_PUZZLE_DAYS of the prod deploy: it warns, a strict deploy fails)` : ''}`);
  console.log('queue (size: pending / pending of an older stamp / approved / rejected):');
  for (const n of Object.keys(SIZE_BAG)) {
    const c = index.candidates.filter(x => x.size === +n), cnt = f => c.filter(f).length;
    console.log(`  ${n}x${n}: ${cnt(x => x.status === 'pending' && x.stamp === stamp)} / ${cnt(x => x.status === 'pending' && x.stamp !== stamp)} / ${cnt(x => x.status === 'approved')} / ${cnt(x => x.status === 'rejected')}`);
  }
  const stats = reviewStats(verdicts), { queue: toReview, open, span } = planReview({ today, horizon, published: dates, index, verdicts, stamp, reserve: true });
  const fit = toReview.filter(c => c.date).length;
  console.log(`review: ${toReview.length} candidate(s) to review (pending, this stamp: ${fit} can fill an open day, ${toReview.length - fit} extra); ${open.length} open day(s) of the next ${span} without an approved candidate`);
  for (const [st, v] of Object.entries(stats)) console.log(`  stamp ${st}: ${v.reviewed} reviewed, ${v.approved} approved (${Math.round(100 * v.approved / v.reviewed)}%), ${v.rejected} rejected${v.reviewed ? `, human - model grade: mean ${(v.sumErr / v.reviewed).toFixed(2)}, worst ${v.worst.toFixed(1)}` : ''}`);
  console.log('next 14 days:');
  for (let day = today; day < today + 14; day++) {
    const date = dateOfDay(day), have = index.candidates.filter(c => c.slot === date && usable(c, stamp)).length;
    console.log(`  ${date} ${sizeForDay(day)}x${sizeForDay(day)}  ${dates.has(date) ? 'published' : `open, ${have} candidate(s)`}`);
  }
  return 0;
}
function schedule() {
  const from = dayArg('from', todayUtc()), days = int('days', 28, 1), count = {};
  for (let day = from; day < from + days; day++) {
    const size = sizeForDay(day);
    count[size] = (count[size] || 0) + 1;
    console.log(`${dateOfDay(day)} ${size}`);
  }
  console.log(Object.keys(SIZE_BAG).map(n => `${n}: ${count[n] || 0} (${(100 * (count[n] || 0) / days).toFixed(0)}%)`).join('   '));
  return 0;
}

// ---- merge / harvest ----
// the verdict files named by --from (comma separated), read alone: a broken one stops everything
function readFrom() {
  const names = (opt('from') || '').split(',').filter(Boolean);
  return names.map(f => {
    try { return { file: f, verdicts: parseVerdicts(fs.readFileSync(path.resolve(f), 'utf8')) }; } catch (e) { return die(`${f}: ${e.message}`); }
  });
}
function merge() {
  const from = readFrom();
  if (!from.length) die('merge needs --from FILE[,FILE...]');
  let have = readVerdicts();
  const before = have.length;
  for (const { file, verdicts } of from) {
    for (const c of verdictConflicts(have, verdicts)) {
      const f = v => `${v.verdict}${v.human !== undefined ? ` (rated ${v.human})` : ''} at ${v.at}`;
      note('warning', `${c.id} differs in ${path.basename(file)}: kept ${f(c.kept)}, dropped ${f(c.dropped)}`);
    }
    have = mergeVerdicts(have, verdicts);
  }
  console.log(`${flag('dry-run') ? 'would write' : 'wrote'} ${have.length} verdict(s) (${have.length - before} new) to ${rel(verdictsFile)}`);
  if (!flag('dry-run')) { fs.mkdirSync(path.dirname(verdictsFile), { recursive: true }); fs.writeFileSync(verdictsFile, formatVerdicts(have)); }
  return 0;
}
// id -> canonical puzzle text of every puzzle file we have (published days, queue, rejected): where an older verdict finds its `key`
function keysById() {
  const found = new Map();
  for (const f of [...txtFiles(dir.puzzles), ...txtFiles(dir.queue)]) {
    const r = loadPuzzle(f);
    if (!r.error) found.set(puzzleId(r.symKey), ratingKey(r.p));
  }
  return found;
}
function harvest() {
  let verdicts = readVerdicts();
  for (const { verdicts: more } of readFrom()) verdicts = mergeVerdicts(verdicts, more);
  const keys = keysById();
  verdicts = verdicts.map(v => (v.key || !keys.has(v.id) ? v : { ...v, key: keys.get(v.id) }));
  const text = fs.existsSync(dir.ratings) ? fs.readFileSync(dir.ratings, 'utf8') : '[]\n';
  const { ratings, problems } = parseRatingsJson(text);
  if (problems.length) die(`${rel(dir.ratings)}: ${problems[0]} (node tools/check-ratings.mjs)`);
  if (ratings.length && toRatingsJson(ratings) !== text) die(`${rel(dir.ratings)} is not in canonical form: node tools/check-ratings.mjs --fix first (appending rewrites the file)`);
  const h = harvestRatings(verdicts, ratings, { solvedOnly: flag('solved-only') });
  for (const r of h.add) console.log(`add: ${r.id} ${r.key.split('\n')[0]} human ${r.human}${r.lo === r.hi ? '' : ` (${r.lo}-${r.hi})`}${r.unsure ? ' unsure' : ''}`);
  for (const d of h.differs) note('warning', `${d.id} is rated ${d.have.human} (${d.have.lo}-${d.have.hi}) in ${rel(dir.ratings)} but ${d.got.human} (${d.got.lo}-${d.got.hi}) in its verdict: kept the file's rating`);
  for (const e of h.equivalent) note('warning', `${e.id} is the same puzzle up to rotation / reflection as a rated one (${e.key.split('\n')[0]}): not added`);
  for (const id of h.unresolved) note('warning', `${id}: rated, but its puzzle is not in a verdict key or in any puzzle file: not added`);
  console.log(`${flag('dry-run') ? 'would add' : 'added'} ${h.add.length} rating(s) to ${rel(dir.ratings)}; ${h.same.length} already there, ${h.differs.length} differ, ${h.equivalent.length} equivalent to a rated puzzle, ${h.skipped.length} given up (skipped), ${h.unresolved.length} without a puzzle, ${h.unrated} unrated verdict(s) have nothing to add`);
  if (h.add.length && !flag('dry-run')) {
    fs.mkdirSync(path.dirname(dir.ratings), { recursive: true });
    fs.writeFileSync(dir.ratings, toRatingsJson([...ratings, ...h.add]));
    console.log('next: commit ratings.json (the pre-commit hook refits) or run node tools/fit-trap.mjs --write and node tools/gotd-fit.mjs');
  }
  return 0;
}

// older verdicts: embed the puzzle text from the files (the id is the hash of the puzzle, so the file of that id is the right one)
function keys() {
  const verdicts = readVerdicts(), found = keysById(), missing = [];
  let added = 0;
  const next = verdicts.map(v => {
    if (v.key) return v;
    if (!found.has(v.id)) { missing.push(v.id); return v; }
    added++;
    return { ...v, key: found.get(v.id) };
  });
  for (const id of missing) note('warning', `${id}: no puzzle file with this id (published days, queue, rejected): its verdict stays without a key`);
  console.log(`${flag('dry-run') ? 'would add' : 'added'} ${added} key(s) to ${rel(verdictsFile)}; ${verdicts.length - added - missing.length} verdict(s) had one, ${missing.length} without a puzzle file`);
  if (added && !flag('dry-run')) fs.writeFileSync(verdictsFile, formatVerdicts(next));
  return 0;
}

const commands = { fill, promote, check, status, schedule, merge, harvest, keys };
if (!commands[cmd]) die(`usage: gotd-gen.mjs ${Object.keys(commands).join(' | ')} [options] (see the top of this file)`);
process.exitCode = commands[cmd]();
