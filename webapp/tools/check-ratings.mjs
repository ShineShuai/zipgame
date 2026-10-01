#!/usr/bin/env node
// Validate the label files before using them. Exit 1 on any error; warnings (equivalent puzzles) exit 0 unless --strict.
//   node tools/check-ratings.mjs [tools/ratings.json] [--pairs tools/pairs.json] [--strict] [--no-draw] [--fix]
// ratings.json: every row parses, ranges contain `human`, keys are canonical (rows that are not are listed with the reason),
//   NO exact duplicates, and equivalent puzzles
//   (same up to rotation / reflection / reversed numbering) are listed with their ratings so they can be corrected.
//   --fix rewrites the file in canonical form (keys + layout), keeping the order and every rating. It refuses to run while there are
//   invalid rows or exact duplicates, because rewriting would silently drop them.
// pairs.json:   every row parses, both puzzles are valid, no pair compares a puzzle with itself, no contradictory repeats,
//   and (if ratings.json is given) pairs that contradict your ratings (A rated harder than B with non-overlapping ranges,
//   but the pair says the opposite) are listed.
import fs from 'node:fs';
import { parseRatingsJson, findDuplicateGroups, toRatingsJson, keyDifference } from '../src/core/ratings-io.js';
import { parsePairsJson, pairKeyOf } from '../src/core/pairs-io.js';
import { printDuplicateGroups } from './lib.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ratingsFile = args.find(a => !a.startsWith('--') && a !== opt('pairs')) || new URL('./ratings.json', import.meta.url).pathname;
const pairsFile = opt('pairs') || new URL('./pairs.json', import.meta.url).pathname;
let errors = 0, warnings = 0;
const show = !args.includes('--no-draw');

const text = fs.readFileSync(ratingsFile, 'utf8'), { ratings, problems } = parseRatingsJson(text);
console.log(`${ratingsFile}: ${ratings.length} ratings`);
for (const p of problems) { console.log('  problem: ' + p); errors++; }
const items = ratings.map((r, i) => ({ key: r.key, label: r, where: `ratings #${i + 1}` }));
const { exact, equivalent } = findDuplicateGroups(items);
const toMembers = g => g.map(i => items[i]);
errors += exact.length; printDuplicateGroups('EXACT duplicates', exact.map(toMembers), { show, out: console.log });
warnings += equivalent.length; printDuplicateGroups('EQUIVALENT puzzles (rotation / reflection / reversed numbering)', equivalent.map(toMembers), { show, out: console.log });
let rawRows = []; try { rawRows = JSON.parse(text); } catch { /* reported above */ }
const nonCanonical = Array.isArray(rawRows) ? rawRows.map((r, i) => ({ i, why: r && typeof r.key === 'string' ? keyDifference(r.key) : '' })).filter(x => x.why) : [];
if (nonCanonical.length) {
  console.log(`\n${nonCanonical.length} of ${rawRows.length} key(s) are not in canonical form (they parse, but differ from what the app would export):`);
  for (const x of nonCanonical.slice(0, 10)) console.log(`  ratings #${x.i + 1}: ${x.why}`);
  if (nonCanonical.length > 10) console.log(`  ... and ${nonCanonical.length - 10} more`);
  console.log('  fix: node tools/check-ratings.mjs --fix');
  errors++;
}
const canonicalText = !problems.length && !exact.length ? toRatingsJson(ratings) : null;
if (canonicalText && !nonCanonical.length && canonicalText !== text.replace(/\r\n/g, '\n')) { console.log('\nnote: the keys are fine but the file layout differs from what the app exports (indentation / field order / trailing newline: an editor or formatter rewrote it?)\n  fix: node tools/check-ratings.mjs --fix'); warnings++; }
if (args.includes('--fix')) {
  if (!canonicalText) { console.log('\n--fix refused: fix the problems / exact duplicates above first (rewriting would drop rows).'); process.exit(1); }
  if (canonicalText === text) console.log('\n--fix: nothing to change.');
  else { fs.writeFileSync(ratingsFile, canonicalText); console.log(`\n--fix: rewrote ${ratingsFile} in canonical form (${nonCanonical.length} key(s) changed, ${ratings.length} ratings kept, order unchanged).`); errors = 0; }
}

if (fs.existsSync(pairsFile)) {
  const pt = parsePairsJson(fs.readFileSync(pairsFile, 'utf8'));
  console.log(`\n${pairsFile}: ${pt.pairs.length} pairs`);
  for (const p of pt.problems) { console.log('  problem: ' + p); errors++; }
  const byKey = new Map(ratings.map(r => [r.key, r])), contra = [];
  for (const pr of pt.pairs) {
    const ra = byKey.get(pr.a), rb = byKey.get(pr.b); if (!ra || !rb) continue;
    const harder = rb.lo > ra.hi ? 'harder' : rb.hi < ra.lo ? 'easier' : null; // ranges do not overlap: your ratings already say which is harder
    if (harder && pr.cmp !== harder) contra.push(`pair says B is ${pr.cmp} than A, but your ratings say ${harder}: A rated ${ra.lo}-${ra.hi}, B rated ${rb.lo}-${rb.hi}`);
  }
  if (contra.length) { console.log(`\n${contra.length} pair(s) contradict your ratings (check which one is right):\n  ` + contra.join('\n  ')); warnings += contra.length; }
}
console.log(`\n${errors ? 'FAILED' : 'ok'}: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors || (args.includes('--strict') && warnings) ? 1 : 0);
