// tools/gotd-gen.mjs end to end on temporary directories: fill (idempotent, deterministic), check (distinct up to symmetry), status, schedule, errors.
// Run: node --test test/gotd-gen-cli.test.js   (npm run test:gotd)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '../src/core/format.js';
import { transformPuzzle } from '../src/core/ratings-io.js';

const tool = fileURLToPath(new URL('../tools/gotd-gen.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gotd-gen-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mk = name => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
const pub = mk('pub'), queue = path.join(tmp, 'queue'), ratings = path.join(tmp, 'ratings.json');
fs.writeFileSync(ratings, '[]');
const where = ['--puzzles', pub, '--queue', queue, '--ratings', ratings];
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
// 20261122 and 20261123 are a 7x7 and an 8x8 in the schedule: two quick candidates
const FILL = ['fill', '--today', '20261122', '--horizon', '2', '--per-slot', '1', ...where];

test('gotd-gen: an empty repository is fine, and a dry run writes nothing', () => {
  let r = run('check', ...where);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK: 0 distinct puzzles \(0 published, 0 in the queue\)/);
  r = run(...FILL, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 open day\(s\) of 2/);
  assert.match(r.stdout, /20261122 7x7: have 0, need 1, runs used 0/);
  assert.match(r.stdout, /20261123 8x8: have 0, need 1, runs used 0/);
  assert.equal(fs.existsSync(queue), false, 'nothing is written');
});

test('gotd-gen: fill makes one candidate per open day of the scheduled size; the files and the index agree', () => {
  const r = run(...FILL);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /added 2 candidate\(s\) in \d+ generator run\(s\)/);
  const files = fs.readdirSync(queue).sort();
  assert.equal(files.length, 3, files.join(' '));
  const index = JSON.parse(fs.readFileSync(path.join(queue, 'index.json'), 'utf8'));
  assert.equal(index.candidates.length, 2);
  assert.deepEqual(index.candidates.map(c => [c.slot, c.size, c.status]), [['20261122', 7, 'pending'], ['20261123', 8, 'pending']]);
  for (const c of index.candidates) {
    const text = fs.readFileSync(path.join(queue, c.file), 'utf8'), p = parse(text);
    assert.equal(p.n, c.size);
    assert.ok(c.trap.grade >= 3 && !/^path /m.test(text), 'Hard or harder, no solution path in the file');
    assert.ok(index.slots[c.slot].attempts >= c.attempt + 1, 'the runs spent include the one that made the candidate');
  }
  assert.match(fs.readFileSync(path.join(queue, 'index.json'), 'utf8'), /^\{\n {2}"v": 1,\n {2}"slots": \{\n/);
});

test('gotd-gen: a second fill adds nothing and changes no byte; a fresh queue gets the same candidates (no clock, no randomness)', () => {
  const before = snapshot(queue), r = run(...FILL);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added 0 candidate\(s\) in 0 generator run\(s\)/);
  assert.deepEqual(snapshot(queue), before);
  const other = path.join(tmp, 'queue2'), again = run('fill', '--today', '20261122', '--horizon', '2', '--per-slot', '1', '--puzzles', pub, '--queue', other, '--ratings', ratings);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(snapshot(other), before, 'an independent run gives the same files');
});

test('gotd-gen: check passes for the queue, and fails for a copy of a candidate that is rotated, mirrored or numbered backwards', () => {
  let r = run('check', ...where);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK: 2 distinct puzzles \(0 published, 2 in the queue\)/);
  const index = JSON.parse(fs.readFileSync(path.join(queue, 'index.json'), 'utf8')), c = index.candidates[0];
  const original = parse(fs.readFileSync(path.join(queue, c.file), 'utf8'));
  for (const [k, rev] of [[0, false], [1, false], [5, true], [7, true]]) {
    const copy = path.join(pub, '20261201.txt');
    fs.writeFileSync(copy, serialize(transformPuzzle(original, k, rev)) + '\n');
    r = run('check', '--annotations', ...where);
    assert.equal(r.status, 1, `k=${k} rev=${rev}: ${r.stdout}`);
    // a published day comes first: the candidate that repeats it is the file the error names
    assert.match(r.stdout, /::error file=.*c-7-[0-9a-f]{12}\.txt::duplicate of .*20261201\.txt/);
    fs.rmSync(copy);
  }
  r = run('check', ...where);
  assert.equal(r.status, 0, 'the copy is gone');
});

test('gotd-gen: check reports a broken index and a file that is not the candidate the index names', () => {
  const index = fs.readFileSync(path.join(queue, 'index.json'), 'utf8'), c = JSON.parse(index).candidates[0];
  fs.rmSync(path.join(queue, c.file));
  let r = run('check', ...where);
  assert.equal(r.status, 1);
  assert.match(r.stdout, new RegExp(`candidate ${c.id} \\(pending\\) has no file ${c.file}`));
  const other = JSON.parse(index).candidates[1];
  fs.copyFileSync(path.join(queue, other.file), path.join(queue, c.file));
  r = run('check', ...where);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /duplicate of|is not the one the index calls/);
  fs.rmSync(path.join(queue, c.file));
  fs.writeFileSync(path.join(queue, 'index.json'), '{"v":2}');
  r = run('check', ...where);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /index\.json: "v" must be 1/);
});

test('gotd-gen: status and schedule print the pinned schedule and the queue', () => {
  let r = run('schedule', '--from', '20261121', '--days', '30');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 30).map(l => l.split(' ')[1]).join(','), '11,7,8,8,6,9,7,8,7,10,8,6,8,7,9,11,9,7,8,10,8,7,6,7,10,7,8,10,8,7');
  assert.equal(lines[0], '20261121 11');
  assert.match(lines[30], /^6: 3 \(10%\)\s+7: 9 \(30%\)\s+8: 9 \(30%\)\s+9: 3 \(10%\)\s+10: 4 \(13%\)\s+11: 2 \(7%\)$/);
  fs.writeFileSync(path.join(queue, 'index.json'), fs.readFileSync(path.join(tmp, 'queue2', 'index.json'), 'utf8'));
  r = run('status', '--today', '20261122', ...where);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^stamp a\d+-[0-9a-f]{8}\n/);
  assert.match(r.stdout, /published: 0 day\(s\); 0 in a row from 20261122 {2}<- fewer than 10/);
  assert.match(r.stdout, /7x7: 1 \/ 0 \/ 0 \/ 0\n {2}8x8: 1 \/ 0 \/ 0 \/ 0/);
  assert.match(r.stdout, /20261122 7x7 {2}open, 1 candidate\(s\)/);
});

test('gotd-gen: bad arguments and unknown commands exit 1 with a message', () => {
  for (const args of [['nope'], [], ['fill', '--horizon', '0'], ['fill', '--today', '2026-11-22'], ['fill', '--per-slot', 'x'], ['schedule', '--days', '0']]) {
    const r = run(...args, ...where);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /^gotd-gen: /, args.join(' '));
  }
});
