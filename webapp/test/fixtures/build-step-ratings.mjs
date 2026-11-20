// Writes test/fixtures/step-ratings.json: the rated puzzles the tests of the research tools (test/tools.test.js) use as input,
// chosen from tools/ratings.json and frozen, so that rating more puzzles never changes what those tests see.
//   node test/fixtures/build-step-ratings.mjs          rebuild the file
//   node test/fixtures/build-step-ratings.mjs --check  say whether the file is what the choice below gives now
// The choice covers every case the tools meet: each size from 6 to 11, every grade the labels hold, puzzles with all four
// kinds of wrong turn (obvious, shallow, deep, capped; the fit needs the thin ones) and a few without the deep or the capped
// kind. Only puzzles the tools can use: a solution within CAP nodes, 6 <= n <= 11, at least 5 steps with a wrong turn.
import fs from 'node:fs';
import { stepsOfPuzzle } from '../../tools/step-lib.mjs';
import { toRatingsJson } from '../../src/core/ratings-io.js';

const CAP = 100000; // the cap the tests pass to the tools (--cap)
const QUOTA = { 6: 8, 7: 12, 8: 10, 9: 10, 10: 10, 11: 9 }; // 59 puzzles: the fit rule needs 40 with games, with room to spare
const rated = JSON.parse(
  fs.readFileSync(new URL('../../tools/ratings.json', import.meta.url), 'utf8'),
);

const usable = [];
for (const row of rated) {
  const P = stepsOfPuzzle(row.key, CAP);
  if (P && P.n >= 6 && P.n <= 11 && P.steps.length >= 5) {
    const kinds = [0, 1, 2, 3].map(k => P.steps.reduce((sum, step) => sum + step.c[k], 0));
    usable.push({ row, n: P.n, all4: kinds.every(count => count > 0) });
  }
}

// Per size: round-robin over the grades (the whole grade, 2.5 -> 2), the puzzles with all four kinds first, then by key.
const chosen = [];
for (const [size, quota] of Object.entries(QUOTA)) {
  const groups = new Map();
  usable
    .filter(u => u.n === Number(size))
    .sort((a, b) => b.all4 - a.all4 || (a.row.key < b.row.key ? -1 : 1))
    .forEach(u => {
      const grade = Math.floor(u.row.human);
      groups.set(grade, [...(groups.get(grade) || []), u]);
    });
  const order = [...groups.keys()].sort((a, b) => a - b);
  let taken = 0;
  for (let round = 0; taken < quota && order.some(g => groups.get(g)[round]); round++) {
    for (const grade of order) {
      const u = groups.get(grade)[round];
      if (u && taken < quota) {
        chosen.push(u.row);
        taken++;
      }
    }
  }
}
chosen.sort((a, b) => (a.key < b.key ? -1 : 1));

const text = toRatingsJson(chosen);
const file = new URL('./step-ratings.json', import.meta.url);
if (process.argv.includes('--check')) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(
    same
      ? 'step-ratings.json: this is what the choice gives'
      : 'step-ratings.json differs from what the choice gives now',
  );
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`${chosen.length} rated puzzles written to test/fixtures/step-ratings.json`);
