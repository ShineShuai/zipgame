// Turn difficulty_rate.txt (comment line(s) BEFORE each puzzle block) into the ratings JSON that fit-trap.mjs reads.
//   node tools/parse-ratings.mjs difficulty_rate.txt [--base tools/ratings.json] [--out tools/ratings.json]
// Without --out the JSON goes to stdout. --out may be the --base file itself (it is read completely before anything is written);
// do NOT use shell redirection onto the base file, the shell truncates it before it is read.
// Puzzles already in --base (matched by puzzle text) are kept as they are and NOT re-parsed: to change an old label, edit the
// JSON. Only NEW puzzles are read, and their comment must be exactly one of
//   this is N            -> human N
//   this is N or M       -> human (N+M)/2
//   this is N or M, close to C   -> human (N+M)/4 + C/2   (2 or 3, close to 3 -> 2.75)
// (trailing "." allowed, N/M/C in 0..5). Anything else stops with an error listing it — no guessing.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const file = args.find(a => !a.startsWith('--') && a !== opt('base') && a !== opt('out'));
if (!file) { console.error('usage: node tools/parse-ratings.mjs difficulty_rate.txt [--base tools/ratings.json] [--out tools/ratings.json]'); process.exit(1); }
const base = opt('base') ? JSON.parse(fs.readFileSync(opt('base'), 'utf8')) : [];
const known = new Set(base.map(e => e.key));

const puzzles = []; let comment = [], cur = null;
for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const l = raw.trim();
  if (!l || l.startsWith('#')) continue;
  if (l.startsWith('size ')) { cur = { lines: [l], comment: comment.join(' ') }; comment = []; continue; }
  if (cur && l.startsWith('checkpoints')) { cur.lines.push(l); continue; }
  if (cur && l.startsWith('walls')) { cur.lines.push(l); puzzles.push(cur); cur = null; continue; }
  comment.push(l);
}

const RE = /^this is ([0-5])(?: or ([0-5]))?(?:,? close to ([0-5]))?\.?$/i;
const out = [...base], bad = []; let added = 0;
puzzles.forEach((q, i) => {
  const key = q.lines.join('\n');
  if (known.has(key)) return;
  const m = RE.exec(q.comment.trim());
  if (!m) { bad.push(`puzzle #${i + 1}: "${q.comment}"`); return; }
  const a = +m[1], b = m[2] == null ? a : +m[2], c = m[3] == null ? null : +m[3];
  if (b < a || (c != null && (c < a || c > b))) { bad.push(`puzzle #${i + 1}: "${q.comment}" (needs N <= M and N <= C <= M)`); return; }
  const mid = (a + b) / 2;
  out.push({ key, human: c == null ? mid : (mid + c) / 2, lo: a, hi: b });
  known.add(key); added++;
});
if (bad.length) { console.error('cannot parse these comments (fix them or add the rating to the JSON by hand):\n  ' + bad.join('\n  ')); process.exit(1); }
console.error(`${puzzles.length} puzzles in file, ${base.length} already in base, ${added} new -> ${out.length} ratings`);
const json = JSON.stringify(out, null, 1) + '\n';
if (opt('out')) { fs.writeFileSync(opt('out'), json); console.error('wrote ' + opt('out')); } else process.stdout.write(json);
