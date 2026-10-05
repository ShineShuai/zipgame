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

// Returns the child's result fragment, or null when the old src cannot run the current benchmark.
function runAt(root, sha, benchSha, extraArgs) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-at-'));
  try {
    git(root, 'worktree', 'add', '--detach', dir, sha);
    cpSync(path.join(root, 'bench'), path.join(dir, 'bench'), {
      recursive: true,
      filter: source => !/report\.html(\.tmp)?$/.test(source),
    });
    const out = path.join(dir, 'out.json');
    const args = [path.join(dir, 'bench', 'bench.js'), '--out', out, '--bench-sha', benchSha, ...extraArgs];
    spawnSync(process.execPath, args, { cwd: dir, stdio: 'inherit' });
    return existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
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
