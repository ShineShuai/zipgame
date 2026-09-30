#!/usr/bin/env node
// Evaluate the technique-ladder grader (src/core/ladder.js) against hand ratings.
//
// Usage:
//   node tools/ladder-eval.mjs difficulty_rate.txt        # rating file: comment line(s) BEFORE each puzzle
//   node tools/ladder-eval.mjs --gen 7,9,11 20 [seed]     # soundness + timing on generated puzzles
//
// Rating comments: numbers are taken from the text after removing "you graded as N", "not [word] N",
// "instead of N", "more than N", "N/5"; several numbers -> their mean; "rather N" -> N.
import fs from 'fs';
import { parse } from '../src/core/format.js';
import { ladder, LEVELS } from '../src/core/ladder.js';
import { isSolved } from '../src/core/rules.js';
import { maxNumber } from '../src/core/model.js';

export function parseRating(text) {
  let t = ' ' + text.toLowerCase() + ' ';
  const rather = t.match(/rather\s+(\d)/);
  if (rather) return +rather[1];
  t = t.replace(/(you )?graded as \d(\/5)?/g, ' ').replace(/(not|instead of|more than)\s+(\w+\s+)?\d/g, ' ').replace(/\d\/5/g, ' ');
  const nums = [...new Set((t.match(/\d/g) || []).map(Number))];
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function loadLabeled(file) {
  const items = []; let cur = null, buf = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('# Zip Puzzle')) { if (cur) items.push(cur); cur = { comment: buf.join(' ').trim(), body: [] }; buf = []; continue; }
    if (!cur) { if (l) buf.push(l); continue; }
    if (l.startsWith('#')) continue;
    if (/^(size|checkpoints|walls)\b/.test(l)) cur.body.push(l); else if (l) buf.push(l);
  }
  if (cur) items.push(cur);
  return items.map((it, k) => ({ k, human: parseRating(it.comment), comment: it.comment, puzzle: parse(it.body.join('\n')) }));
}

const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = []; for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pear = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let s = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return s / Math.sqrt(da * db); };
export const spearman = (a, b) => pear(rank(a), rank(b));

// Features read off a ladder() result; a grade formula is fitted on these.
export const features = r => ({
  hardest: r.hardest, chain: r.passes[2], terr: r.passes[3], probe1: r.passes[4], probe2: r.passes[5],
  search: r.search.nodes, trials: r.probeTrials, ms: r.ms,
});

if (import.meta.url === `file://${process.argv[1]}`) {
const args = process.argv.slice(2);
if (args[0] === '--gen') {
  const { generate } = await import('../src/core/gen/generate.js');
  const { runSync } = await import('../src/core/run.js');
  const { makeRng } = await import('../src/core/rng.js');
  const ns = args[1].split(',').map(Number), per = +(args[2] || 10), rnd = makeRng(+(args[3] || 1));
  let bad = 0, tot = 0;
  for (const n of ns) {
    const ms = [], tg = [], hist = {};
    for (let i = 0; i < per; i++) {
      const t0 = performance.now();
      const p = runSync(generate(n, Math.floor(rnd() * 4294967296) >>> 0));
      tg.push(performance.now() - t0);
      const r = ladder(p);
      tot++;
      const same = r.path && r.path.length === p.path.length && (r.path.every((c, j) => c === p.path[j]) || r.path.every((c, j) => c === p.path[p.path.length - 1 - j]));
      if (r.contradiction || (r.solved && !isSolved(p, r.path || p.path)) || (r.path && !same)) { bad++; console.log('UNSOUND', n, i, JSON.stringify(features(r))); }
      ms.push(r.ms); hist[r.hardest] = (hist[r.hardest] || 0) + 1;
    }
    const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
    console.log(`N=${n}: ladder median ${med(ms).toFixed(1)}ms max ${Math.max(...ms).toFixed(0)}ms | generate() median ${med(tg).toFixed(0)}ms | hardest-level hist ${JSON.stringify(hist)}`);
  }
  console.log(bad ? `${bad}/${tot} FAILED` : `soundness OK on ${tot} generated puzzles`);
} else {
  const rows = loadLabeled(args[0] || 'difficulty_rate.txt').map(x => ({ ...x, r: ladder(x.puzzle) }));
  console.log('k  N  K  human  hardest  chain terr probe1 probe2 search trials  ms   solved');
  for (const x of rows) { const f = features(x.r); console.log([x.k, x.puzzle.n, maxNumber(x.puzzle), x.human, LEVELS[f.hardest], f.chain, f.terr, f.probe1, f.probe2, f.search, f.trials, f.ms.toFixed(1), x.r.solved && (!x.r.path || isSolved(x.puzzle, x.r.path))].map(v => String(v).padEnd(6)).join(' ')); }
  const H = rows.map(x => x.human);
  console.log('\nSpearman vs human:');
  for (const f of ['hardest', 'chain', 'terr', 'probe1', 'probe2', 'search', 'trials']) console.log(f.padEnd(8), spearman(rows.map(x => features(x.r)[f]), H).toFixed(2));
  const ms = rows.map(x => x.r.ms).sort((a, b) => a - b);
  console.log(`\nladder ms: median ${ms[ms.length >> 1].toFixed(1)} p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(1)} max ${ms[ms.length - 1].toFixed(1)}`);
}
}
