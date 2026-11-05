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
import { transformPuzzle, symmetryKey } from '../src/core/ratings-io.js';
import { makeVerdict, formatVerdicts } from '../src/core/gotd-verdict.js';

const tool = fileURLToPath(new URL('../tools/gotd-gen.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gotd-gen-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mk = name => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
const pub = mk('pub'), queue = path.join(tmp, 'queue'), ratings = path.join(tmp, 'ratings.json');
fs.writeFileSync(ratings, '[]');
const where = ['--puzzles', pub, '--queue', queue, '--ratings', ratings];
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
const snapshot = (dir, prefix = '') => Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(e => (e.isDirectory()
  ? Object.entries(snapshot(path.join(dir, e.name), `${prefix}${e.name}/`)) : [[prefix + e.name, fs.readFileSync(path.join(dir, e.name), 'utf8')]])));
// 20261122 and 20261123 are a 7x7 and an 8x8 in the schedule: two quick candidates
// the seconds in a candidate's origin comment are the one thing that depends on the machine
const notTimed = snap => Object.fromEntries(Object.entries(snap).map(([f, text]) => [f, text.replace(/, \d+\.\d s,/, ', X s,')]));
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

test('gotd-gen: the origin comment of a candidate says how to make it again: its gen-target command gives the same puzzle, and the summary line matches', () => {
  const index = JSON.parse(fs.readFileSync(path.join(queue, 'index.json'), 'utf8'));
  for (const c of index.candidates) {
    const text = fs.readFileSync(path.join(queue, c.file), 'utf8');
    const summary = text.match(/^# (seed \d+: .*)$/m)[1], command = text.match(/^# gen \S+: node tools\/gen-target\.mjs (.*)$/m)[1];
    const gen = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/gen-target.mjs', import.meta.url)), ...command.split(' ')], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    assert.equal(serialize(parse(gen.stdout)), serialize(parse(text)), `${c.file}: the command makes the same puzzle`);
    const stripTime = line => line.replace(/, \d+\.\d s,/, ', X s,');
    assert.equal(stripTime(gen.stderr.trim()), stripTime(summary), 'the summary line is the one gen-target prints (the seconds apart)');
    assert.match(summary, /^seed \d+: grade [3-5] \(target [3-5]\+, inside the margin\), \d+ walls, \d+ checkpoints, \d+\.\d s, \d+ changes, \d+ tries$/);
  }
});

test('gotd-gen: a second fill adds nothing and changes no byte; a fresh queue gets the same candidates (no clock, no randomness)', () => {
  const before = snapshot(queue), r = run(...FILL);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added 0 candidate\(s\) in 0 generator run\(s\)/);
  assert.deepEqual(snapshot(queue), before);
  const other = path.join(tmp, 'queue2'), again = run('fill', '--today', '20261122', '--horizon', '2', '--per-slot', '1', '--puzzles', pub, '--queue', other, '--ratings', ratings);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(notTimed(snapshot(other)), notTimed(before), 'an independent run gives the same files (the seconds in the origin comment apart)');
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

// ---- the human's side: verdicts -> statuses -> published days ----
const NOW = '2026-11-05T10:00:00Z';
function world(name) { // fresh published dir + queue with 2 candidates for each of 20261122 (7x7) and 20261123 (8x8)
  const w = { pub: mk(`${name}-pub`), queue: path.join(tmp, `${name}-queue`), ratings };
  w.where = ['--puzzles', w.pub, '--queue', w.queue, '--ratings', ratings];
  w.cli = (...args) => run(...args, ...w.where);
  const r = w.cli('fill', '--today', '20261122', '--horizon', '2', '--per-slot', '2');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  w.index = () => JSON.parse(fs.readFileSync(path.join(w.queue, 'index.json'), 'utf8'));
  w.verdicts = list => fs.writeFileSync(path.join(w.queue, 'verdicts.json'), formatVerdicts(list));
  w.say = (c, human, over = {}) => makeVerdict({ candidate: c, sel: { lo: human, hi: human, lean: 0 }, solved: true, playS: 95.46, takebacks: 4, now: NOW, ...over });
  return w;
}
const PROMOTE = ['promote', '--today', '20261122', '--horizon', '2'];

test('gotd-gen promote: an approved candidate becomes the day, a rejected one moves to rejected/, a dry run writes nothing, a rerun changes nothing', () => {
  const w = world('p1'), [c7a, c7b, c8a, c8b] = w.index().candidates;
  assert.deepEqual([c7a.size, c7b.size, c8a.size, c8b.size], [7, 7, 8, 8]);
  const approvedKey = symmetryKey(parse(fs.readFileSync(path.join(w.queue, c7a.file), 'utf8')));
  w.verdicts([w.say(c7a, 3), w.say(c8a, 1)]);
  const before = { pub: snapshot(w.pub), queue: snapshot(w.queue) };
  let r = w.cli(...PROMOTE, '--dry-run');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /publish: 20261122 7x7 <- /);
  assert.match(r.stdout, /would publish 1 day\(s\), 1 candidate\(s\) rejected, 1 open day\(s\)/);
  assert.deepEqual({ pub: snapshot(w.pub), queue: snapshot(w.queue) }, before, 'a dry run writes nothing');

  r = w.cli(...PROMOTE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /published 1 day\(s\), 1 candidate\(s\) rejected, 1 open day\(s\) without an approved candidate/);
  assert.deepEqual(fs.readdirSync(w.pub), ['20261122.txt']);
  const text = fs.readFileSync(path.join(w.pub, '20261122.txt'), 'utf8');
  assert.match(text, /^# play_time_s 95\.5$/m);
  assert.match(text, new RegExp(`^# gotd ${c7a.id} gen ${c7a.stamp} made-for 20261122 model-grade 3 score [\\d.]+$`, 'm'));
  assert.match(text, /^# review human 3 solved yes takebacks 4$/m);
  const lines = text.split('\n');
  assert.match(lines.find(l => l.startsWith('# seed ')), /^# seed \d+: grade [3-5] \(target [3-5]\+, inside the margin\), \d+ walls, \d+ checkpoints, \d+\.\d s, \d+ changes, \d+ tries$/, 'how it was made is carried into the published day');
  assert.match(lines.find(l => l.startsWith('# gen ')), /^# gen a\d+-[0-9a-f]{8}: node tools\/gen-target\.mjs --size 7 --grade 3 --at-least --margin 0\.5 --retries 12 --seed \d+$/);
  assert.equal(symmetryKey(parse(text)), approvedKey, 'the day is the approved candidate\'s puzzle');
  assert.equal(fs.existsSync(path.join(w.queue, c7a.file)), false, 'the published candidate left the queue');
  assert.equal(fs.existsSync(path.join(w.queue, c8a.file)), false);
  assert.equal(fs.existsSync(path.join(w.queue, 'rejected', c8a.file)), true, 'the rejected one is kept, blocked');
  const index = w.index();
  assert.deepEqual(index.candidates.map(c => c.id).sort(), [c7b.id, c8b.id].sort(), 'only the candidates without a verdict stay in the index');
  assert.equal(Object.keys(index.slots).includes('20261122'), false, 'a published day needs no counter');
  assert.equal(Object.keys(index.slots).includes('20261123'), true);

  r = w.cli('check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK: 4 distinct puzzles \(1 published, 3 in the queue\)/, 'the rejected file counts as a puzzle that stays blocked');
  const settled = { pub: snapshot(w.pub), queue: snapshot(w.queue), rejected: snapshot(path.join(w.queue, 'rejected')) };
  r = w.cli(...PROMOTE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /published 0 day\(s\), 0 candidate\(s\) rejected, 1 open day\(s\)/);
  assert.deepEqual({ pub: snapshot(w.pub), queue: snapshot(w.queue), rejected: snapshot(path.join(w.queue, 'rejected')) }, settled, 'a rerun changes nothing');
});

test('gotd-gen promote: the next fill tops the queue up (a rejected candidate does not count), and never repeats a rejected puzzle', () => {
  const w = world('p2'), rejected = w.index().candidates.filter(c => c.slot === '20261123');
  w.verdicts([w.say(rejected[0], 2)]);
  assert.equal(w.cli(...PROMOTE).status, 0);
  const rejectedKey = symmetryKey(parse(fs.readFileSync(path.join(w.queue, 'rejected', rejected[0].file), 'utf8')));
  const r = w.cli('fill', '--today', '20261122', '--horizon', '2', '--per-slot', '2');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /added 0 candidate\(s\)|added 1 candidate\(s\)/);
  const index = w.index(), day2 = index.candidates.filter(c => c.slot === '20261123' && c.status === 'pending');
  assert.equal(day2.length, 2, 'the day is back to 2 usable candidates');
  for (const c of index.candidates) assert.notEqual(symmetryKey(parse(fs.readFileSync(path.join(w.queue, c.file), 'utf8'))), rejectedKey);
});

test('gotd-gen promote: an approved candidate that repeats a published puzzle is not published (exit 1); a broken verdicts.json stops everything', () => {
  const w = world('p3'), c = w.index().candidates.find(x => x.slot === '20261123');
  w.verdicts([w.say(c, 4)]);
  const copy = path.join(w.pub, '20261101.txt'); // an older published day that is the same puzzle, turned
  fs.writeFileSync(copy, serialize(transformPuzzle(parse(fs.readFileSync(path.join(w.queue, c.file), 'utf8')), 2, true)) + '\n');
  let r = w.cli(...PROMOTE, '--annotations');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /::error file=.*c-8-[0-9a-f]{12}\.txt::approved candidate [0-9a-f]{12} cannot be published on 20261123: duplicate/);
  assert.deepEqual(fs.readdirSync(w.pub), ['20261101.txt'], 'nothing was published');
  assert.equal(fs.existsSync(path.join(w.queue, c.file)), true);
  fs.rmSync(copy);

  fs.writeFileSync(path.join(w.queue, 'verdicts.json'), '{"v":1,"verdicts":[{"id":"zz"}]}');
  r = w.cli('check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /verdicts\.json: verdict #1 \(zz\): "id" must be 12 hex digits/);
  r = w.cli(...PROMOTE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^gotd-gen: verdicts\.json: verdict #1/);
  assert.deepEqual(fs.readdirSync(w.pub), [], 'nothing was published');
});

test('gotd-gen status: shows what is to review and the reviewed numbers per stamp', () => {
  const w = world('p4'), [c7a, c7b, c8a] = w.index().candidates;
  w.verdicts([w.say(c7a, 3), w.say(c8a, 1)]);
  const r = w.cli('status', '--today', '20261122');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /review: 1 candidate\(s\) to review now/, `the sibling ${c7b.id} of the approved one is held back, the rejected one is done: only the other 8x8 is left`);
  assert.match(r.stdout, /stamp a\d+-[0-9a-f]{8}: 2 reviewed, 1 approved \(50%\), 1 rejected, human - model grade: mean -?\d+\.\d\d, worst -?\d+\.\d/);
});
