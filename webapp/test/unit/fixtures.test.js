// The frozen test inputs are what their builders make now. Tests read them instead of running the
// generators (made() in test/fixtures/made.js, tools.test.js), so without this check a generator
// change could leave them stale unseen.
// If it fails: npm run fixtures:puzzles (or fixtures:step-ratings), look at the diff, commit it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SLOW } from '../harness.js';

const builder = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

for (const [name, script] of [
  ['puzzles.json', 'build-puzzles.mjs'],
  ['step-ratings.json', 'build-step-ratings.mjs'],
]) {
  test(`fixtures: ${name} is what ${script} makes now`, SLOW, () => {
    const run = spawnSync(process.execPath, [builder(script), '--check'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
}
