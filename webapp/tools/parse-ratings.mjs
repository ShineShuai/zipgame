// Turn difficulty_rate.txt (comment line(s) BEFORE each puzzle block) into the ratings JSON every tool reads.
//   node tools/parse-ratings.mjs difficulty_rate.txt [--base tools/ratings.json] [--out tools/ratings.json] [--check-labels] [--strict]
// Without --out the JSON goes to stdout. --out may be the --base file itself (it is read completely before anything is written);
// never use shell redirection onto the base file: the shell truncates it before it is read.
//
// Comments (grammar in src/core/ratings-io.js parseRatingComment):
//   human 2, range 2-3            the explicit form; also "range 3-5" or "human 4"; add ", unsure" for an unsure rating
//   this is 2 | 2 or 3 | 2 or 3, close to 3 | at least 3, close to 4 | at most 1     the older forms, same numbers as before
// Puzzles already in --base are kept as they are and not re-read (edit the JSON to change an old label); --check-labels prints
// every old comment whose parsed rating differs from the JSON, so edits made in the text file do not go unnoticed.
//
// Duplicates are reported, never skipped silently:
//   exact       the same puzzle twice in the file. Different ratings = error (exit 1); same rating = warning, first copy kept.
//   equivalent  the same puzzle up to rotation / reflection / reversed numbering (see symmetryKey): listed with locations and
//               ratings so you can decide; only an error with --strict.
import fs from 'node:fs';
import { parseRatingComment, findDuplicateGroups, ratingKey, toRatingsJson, parseRatingsJson } from '../src/core/ratings-io.js';
import { printDuplicateGroups, labelText, sameLabel } from './lib.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const flag = n => args.includes('--' + n);
const file = args.find(a => !a.startsWith('--') && a !== opt('base') && a !== opt('out'));
if (!file) { console.error('usage: node tools/parse-ratings.mjs difficulty_rate.txt [--base tools/ratings.json] [--out tools/ratings.json] [--check-labels] [--strict]'); process.exit(1); }

let base = [];
if (opt('base')) {
  const parsed = parseRatingsJson(fs.readFileSync(opt('base'), 'utf8'));
  if (parsed.problems.length) { console.error(`${opt('base')} has problems:\n  ` + parsed.problems.join('\n  ')); process.exit(1); }
  base = parsed.ratings;
}
const baseByKey = new Map(base.map((r, i) => [r.key, i]));

// ---- read the text file into blocks ----
const blocks = []; let comment = [], cur = null, start = 0;
fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
  const l = raw.trim();
  if (!l || l.startsWith('#')) return;
  if (l.startsWith('size ')) { cur = { lines: [l], comment: comment.join(' '), line: i + 1 }; comment = []; return; }
  if (cur && l.startsWith('checkpoints')) { cur.lines.push(l); return; }
  if (cur && l.startsWith('walls')) { cur.lines.push(l); blocks.push(cur); cur = null; return; }
  comment.push(l);
});
blocks.forEach((b, i) => { b.i = i + 1; b.where = `puzzle #${i + 1} (line ${b.line})`; try { b.key = ratingKey(b.lines.join('\n')); } catch (e) { b.key = null; b.err = e.message; } b.parsed = parseRatingComment(b.comment); });

const errors = [];
for (const b of blocks) if (!b.key) errors.push(`${b.where}: the puzzle does not parse (${b.err})`);
const good = blocks.filter(b => b.key);
const labelOf = b => (b.parsed.ok ? b.parsed : (baseByKey.has(b.key) ? base[baseByKey.get(b.key)] : null));

// ---- 1. exact duplicates inside the file ----
const dupFile = findDuplicateGroups(good.map(b => ({ key: b.key }))).exact;
const exactGroups = dupFile.map(g => g.map(i => ({ where: good[i].where, key: good[i].key, label: labelOf(good[i]) })));
const { conflicts: exactConflicts } = printDuplicateGroups('EXACT duplicates in the text file (the same puzzle commented twice)', exactGroups);
if (exactConflicts) errors.push(`${exactConflicts} exact duplicate group(s) with different ratings (listed above)`);

// ---- 2. new puzzles: first copy of each key, not already in the base ----
const seen = new Set(), added = []; let inBase = 0;
for (const b of good) {
  if (seen.has(b.key)) continue; seen.add(b.key);
  if (baseByKey.has(b.key)) { inBase++; continue; }
  if (!b.parsed.ok) { errors.push(`${b.where}: ${b.parsed.why}`); continue; }
  added.push(b);
}

// ---- 3. old comments vs the JSON ----
if (flag('check-labels')) {
  const diffs = [];
  for (const b of good) {
    const j = baseByKey.get(b.key); if (j == null) continue;
    if (!b.parsed.ok) { diffs.push(`${b.where}: comment not machine-readable (${b.parsed.why.slice(0, 50)}...) — label kept from ratings.json: ${labelText(base[j])}`); continue; }
    if (!sameLabel(b.parsed, base[j]) || !!b.parsed.unsure !== !!base[j].unsure) diffs.push(`${b.where}: comment says ${labelText(b.parsed)} but ratings.json has ${labelText(base[j])}`);
  }
  console.error(`\nold comments vs ${opt('base') || 'the base'}: ${diffs.length ? diffs.length + ' difference(s)' : 'all readable comments match'}` + (diffs.length ? ':\n  ' + diffs.join('\n  ') : ''));
}

// ---- 4. equivalent (rotated / mirrored / reversed) puzzles over the final list ----
const finalList = [...base.map((r, i) => ({ key: r.key, where: `ratings.json #${i + 1}`, label: r })), ...added.map(b => ({ key: b.key, where: `NEW ${b.where}`, label: b.parsed }))];
const fileWhere = new Map(good.map(b => [b.key, b.where]));
const eq = findDuplicateGroups(finalList).equivalent.map(g => g.map(i => ({ ...finalList[i], where: finalList[i].where.startsWith('NEW') ? finalList[i].where : `${finalList[i].where}${fileWhere.has(finalList[i].key) ? ' = ' + fileWhere.get(finalList[i].key) : ''}` })));
printDuplicateGroups('EQUIVALENT puzzles (same up to rotation / reflection / reversed numbering)', eq);
const exactInFinal = findDuplicateGroups(finalList).exact;
if (exactInFinal.length) errors.push(`${exactInFinal.length} exact duplicate(s) inside ratings.json itself: ${exactInFinal.map(g => g.map(i => finalList[i].where).join(' = ')).join('; ')}`);
if (flag('strict') && eq.length) errors.push(`--strict: ${eq.length} equivalent puzzle group(s)`);

// ---- result ----
console.error(`\n${blocks.length} puzzles in the file, ${inBase} already in the base, ${added.length} new${exactGroups.length ? `, ${exactGroups.length} exact-duplicate group(s)` : ''}.`);
for (const b of added) console.error(`  new ${b.where}: "${b.comment.slice(0, 50)}" -> ${labelText(b.parsed)} [${b.parsed.form}]`);
if (errors.length) { console.error('\nNOTHING WRITTEN. Fix these first:\n  ' + errors.join('\n  ')); process.exit(1); }
const out = [...base, ...added.map(b => ({ key: b.key, human: b.parsed.human, lo: b.parsed.lo, hi: b.parsed.hi, ...(b.parsed.unsure ? { unsure: true } : {}) }))];
const json = toRatingsJson(out);
if (opt('out')) { fs.writeFileSync(opt('out'), json); console.error(`wrote ${opt('out')} (${out.length} ratings)`); } else process.stdout.write(json);
