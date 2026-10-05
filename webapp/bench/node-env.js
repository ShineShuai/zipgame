// Node-only capture of the git version and the environment of a benchmark run.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { hash } from './results.js';

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Version = git commit of HEAD. `dirty` lists uncommitted changes in the measured code (src/, bench/);
// the generated report and results folder do not count, nor does .DS_Store.
export function captureGit(cwd) {
  const head = run('git', ['log', '-1', '--format=%H%x1f%cI%x1f%s'], cwd);
  if (!head) {
    return null;
  }
  const [sha, date, subject] = head.split('\x1f');
  const status = run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'bench',
    ':(exclude)bench/report.html', ':(exclude)bench/results', ':(exclude,glob)**/.DS_Store'], cwd);
  return { sha, date, subject, dirty: status ? status.split('\n') : [] };
}

function power() {
  if (process.platform !== 'darwin') {
    return null;
  }
  const out = run('pmset', ['-g', 'batt']);
  if (!out) {
    return null;
  }
  const source = /drawing from '([^']+)'/.exec(out);
  const percent = /(\d+)%/.exec(out);
  return [source && source[1], percent && `${percent[1]}%`].filter(Boolean).join(' ') || null;
}

// env.id = hash(CPU, cores, RAM, platform, arch, runtime name+major): same device + runtime = same env.
export function captureEnv(customName) {
  const cpus = os.cpus();
  const cpu = (cpus[0] && cpus[0].model.replace(/\s+/g, ' ')) || 'unknown CPU';
  const ramGb = Math.round(os.totalmem() / 2 ** 30);
  const major = Number(process.versions.node.split('.')[0]);
  const model = process.platform === 'darwin' ? run('sysctl', ['-n', 'hw.model']) : null;
  const osVersion = process.platform === 'darwin' ? run('sw_vers', ['-productVersion']) : os.release();
  const osName = process.platform === 'darwin' ? 'macOS' : os.type();
  const id = hash([cpu, cpus.length, ramGb, process.platform, os.arch(), 'node', major]);
  const env = {
    id,
    name: customName || `${model || cpu} · ${osName} · node ${major}`,
    kind: 'node',
    device: { model, cpu, cores: cpus.length, ramGb, os: `${osName} ${osVersion}`, arch: os.arch() },
    runtime: { name: 'node', major },
  };
  return { env, run: { runtime: `node ${process.versions.node} (v8 ${process.versions.v8})`, power: power() } };
}
