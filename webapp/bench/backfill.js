// Node-only: rerun the CURRENT benchmark (bench/) against the src/ of older commits (`bench.js --save --at REF`).
// Each ref is checked out into a temporary git worktree, this checkout's bench/ is copied over it and run there;
// the results are recorded under the old commit with bench = the current commit (see resultKey).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeStores } from './results.js';
import { writeStore } from './store.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// "a,b,c" or "old..new" (oldest first) -> full shas
export function resolveRefs(root, spec) {
  return spec.split(',').flatMap(part => (part.includes('..')
    ? git(root, 'rev-list', '--reverse', part).split('\n').filter(Boolean)
    : [git(root, 'rev-parse', '--verify', `${part}^{commit}`)]));
}

// Returns the child's result fragment, or null when the old commit cannot run the current benchmark.
// The git root may be above the project folder (e.g. repo/webapp): the project lives at <worktree>/<prefix>.
function runAt(root, sha, benchSha, extraArgs) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-at-'));
  try {
    git(root, 'worktree', 'add', '--detach', dir, sha);
    const project = path.join(dir, git(root, 'rev-parse', '--show-prefix'));
    if (!existsSync(path.join(project, 'src'))) {
      console.error(`bench: ${sha.slice(0, 7)} has no ${path.relative(dir, project) || '.'}/src`);
      return null;
    }
    cpSync(path.join(root, 'bench'), path.join(project, 'bench'), {
      recursive: true,
      filter: source => !/report\.html(\.tmp)?$/.test(source),
    });
    const out = path.join(dir, 'out.json');
    const args = [path.join(project, 'bench', 'bench.js'), '--out', out, '--bench-sha', benchSha, ...extraArgs];
    const run = spawnSync(process.execPath, args, { cwd: project, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    if (existsSync(out)) {
      process.stderr.write(run.stderr);
      return JSON.parse(readFileSync(out, 'utf8'));
    }
    const reason = run.stderr.split('\n').filter(line => /Error|Cannot find|SyntaxError/.test(line)).slice(0, 2).join('\n  ');
    console.error(`bench: ${reason || run.stderr.trim().split('\n').pop()}`);
    return null;
  } finally {
    try {
      git(root, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      git(root, 'worktree', 'prune');
    }
  }
}

export function backfill(options, recording, wanted) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const sha of resolveRefs(root, options.at)) {
    const short = sha.slice(0, 7);
    const recorded = id => recording.store.results.some(r => r.sha === sha && r.envId === recording.env.id && r.suite === id && (r.bench || r.sha) === recording.bench);
    const missing = wanted.filter(id => options.force || !recorded(id));
    if (!missing.length) {
      console.error(`bench: skip ${short}: already recorded with the benchmark of ${recording.bench.slice(0, 7)}`);
      continue;
    }
    console.error(`bench: backfill ${short} with the benchmark of ${recording.bench.slice(0, 7)}: ${missing.join(', ')}`);
    const extra = ['--only', missing.join(','), ...(options.note ? ['--note', options.note] : [])];
    const fragment = runAt(root, sha, recording.bench, extra);
    if (!fragment) {
      console.error(`bench: backfill of ${short} failed (does its src support the current benchmark?)`);
      continue;
    }
    recording.store = mergeStores(recording.store, fragment, (r, why) => console.error(`bench: rejected ${r.suite}: ${why}`));
    writeStore(recording.file, recording.store);
    console.error(`bench: saved ${fragment.results.length} backfilled result(s) for ${short}`);
  }
}
