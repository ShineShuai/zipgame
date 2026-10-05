// Browser: open bench/index.html via a local server. Node: node bench/bench.js
// Gate regressions on `nodes` (deterministic); ms is machine-dependent and only informational.
// Exit code 1 when any solver comparison differs (plain vs prop / seg / incremental prop + fast path + local connectivity).
//
// Default: run and print only; nothing is written. Recording is opt-in:
//   --save [--report FILE]   append to an HTML report (default bench/report.html; FILE is created when missing).
//                            Suites already recorded for this commit + env are skipped; --force reruns.
//   --out FILE.json          write the results as JSON (import into any report with `node bench/report.mjs add FILE.json`)
// A version is a git commit. With uncommitted changes in src/ or bench/ the run works and --out works; --save needs
// --allow-dirty and stores the results as a separate version "sha+" (a rerun replaces it; `report.mjs rm --dirty` removes them).
//   --at REF[,REF|A..B]      with --save: rerun the CURRENT benchmark against older commits (old src, this bench/), recorded under those commits
//   --only a,b               run only these suites (solver, incremental, generator, candidates)
//   --note TEXT              note stored with the results
//   --env-name NAME          display name of this environment (captured automatically otherwise)
import { SUITES } from './suites.js';
import { ALGO_VERSION } from '../src/core/model.js';
import { SCHEMA, emptyStore, hash, mergeStores } from './results.js';

const isNode = typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);
const lines = [];
let failures = 0;
const warn = text => (isNode ? console.error(`bench: ${text}`) : lines.push(`bench: ${text}`));

async function readOptions() {
  const { parseArgs } = await import('node:util');
  const spec = {
    only: { type: 'string' },
    save: { type: 'boolean' },
    report: { type: 'string' },
    out: { type: 'string' },
    note: { type: 'string' },
    'env-name': { type: 'string' },
    force: { type: 'boolean' },
    'allow-dirty': { type: 'boolean' },
    at: { type: 'string' },
    'bench-sha': { type: 'string' }, // internal: set by --at in the worktree run
  };
  return parseArgs({ options: spec }).values;
}

// { git, env, run, store } when results can be recorded, else null (the benchmark still runs).
async function prepareRecording(options) {
  const { captureGit, captureEnv } = await import('./node-env.js');
  const { readStore, DEFAULT_REPORT } = await import('./store.js');
  const { fileURLToPath } = await import('node:url');
  const git = captureGit(fileURLToPath(new URL('..', import.meta.url)));
  if (!git) {
    warn('results not recorded: not a git checkout');
    return null;
  }
  const dirty = options['bench-sha'] ? [] : git.dirty;
  const toReport = Boolean(options.save) && (!dirty.length || Boolean(options['allow-dirty']));
  if (options.save && !toReport) {
    warn(`not saving to the report: ${dirty.length} uncommitted change(s) in src/ or bench/:\n  ${dirty.slice(0, 5).join('\n  ')}\n  commit them, or add --allow-dirty (stored as version "${git.sha.slice(0, 7)}+")${options.out ? '' : ', or use --out FILE.json'}`);
    if (!options.out) {
      return null;
    }
  }
  const { env, run } = captureEnv(options['env-name']);
  const file = options.report || DEFAULT_REPORT;
  const store = options.save ? readStore(file) : emptyStore();
  return { git, env, run, store, file, dirty, toReport, bench: options['bench-sha'] || git.sha + (dirty.length ? '+' : '') };
}

function browserEnv() {
  const ua = navigator.userAgent;
  const known = [['Edg', 'Edge'], ['Firefox', 'Firefox'], ['Chrome', 'Chrome'], ['Version', 'Safari']];
  const [tag, name] = known.find(([t]) => ua.includes(`${t}/`)) || ['', 'browser'];
  const match = new RegExp(`${tag}/(\\d+)`).exec(ua);
  const major = match ? Number(match[1]) : 0;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform;
  const cores = navigator.hardwareConcurrency;
  const ramGb = navigator.deviceMemory || null;
  const env = {
    id: hash([name, major, platform, cores, ramGb]),
    name: `${name} ${major} · ${platform} · ${cores} cores`,
    kind: 'browser',
    device: { cpu: null, cores, ramGb, os: platform, arch: null },
    runtime: { name, major },
  };
  return { env, run: { runtime: ua, power: null } };
}

function toFragment({ git, env, run }, results) {
  const version = { sha: git.sha, date: git.date, subject: git.subject, algo: ALGO_VERSION };
  return { schema: SCHEMA, versions: { [git.sha]: version }, envs: { [env.id]: env }, results };
}

async function main() {
  const options = isNode ? await readOptions() : {};
  const wanted = options.only ? options.only.split(',') : SUITES.map(s => s.id);
  const unknown = wanted.filter(id => !SUITES.some(s => s.id === id));
  if (unknown.length) {
    throw new Error(`unknown suite(s): ${unknown.join(', ')}`);
  }
  const recording = options.save || options.out ? await prepareRecording(options) : null;
  if (options.at) {
    if (!options.save) {
      throw new Error('--at needs --save');
    }
    if (recording && recording.toReport) {
      (await import('./backfill.js')).backfill(options, recording, wanted);
    } else if (recording) {
      warn('--at needs a clean checkout or --allow-dirty');
    }
    return;
  }
  const session = new Date().toISOString();
  const results = [];
  for (const suite of SUITES.filter(s => wanted.includes(s.id))) {
    const recorded = recording && recording.toReport && !recording.dirty.length && !options.force
      && recording.store.results.some(r => r.sha === recording.git.sha && r.envId === recording.env.id && r.suite === suite.id && (r.bench || r.sha) === recording.bench);
    if (recorded) {
      warn(`skip ${suite.id}: already recorded for ${recording.git.sha.slice(0, 7)} on "${(recording.store.envs[recording.env.id] || recording.env).name}" (--force to rerun)`);
      continue;
    }
    const started = performance.now();
    let output;
    try {
      output = suite.run();
    } catch (error) {
      if (!options['bench-sha']) {
        throw error;
      }
      warn(`${suite.id} failed on this commit: ${error.message}`);
      continue;
    }
    const { rows, spec } = output;
    lines.push(...suite.text(rows));
    const failed = rows.filter(r => r.bad).length;
    failures += failed;
    const result = {
      suite: suite.id,
      rev: suite.rev,
      ts: new Date().toISOString(),
      session,
      durationMs: Math.round(performance.now() - started),
      note: options.note || '',
      checks: { failed },
      spec,
      rows,
    };
    if (recording) {
      Object.assign(result, { sha: recording.git.sha, bench: recording.bench, envId: recording.env.id, runtime: recording.run.runtime, power: recording.run.power });
      if (recording.dirty.length) {
        result.dirty = recording.dirty.slice(0, 20);
      }
    }
    results.push(result);
  }
  if (failures > 0) {
    lines.push(`\nFAILED: ${failures} solver comparison(s) differ between plain and prop search`);
  }
  const text = lines.join('\n');
  if (isNode) {
    console.log(text);
  } else {
    document.getElementById('out').textContent = text;
    window.__benchRun = results;
    offerDownload();
  }
  if (recording && results.length) {
    await record(options, recording, results);
  }
  if (failures > 0 && isNode) {
    process.exitCode = 1;
  }
}

async function record(options, recording, results) {
  const fragment = toFragment(recording, results);
  if (options.out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(options.out, JSON.stringify(fragment));
    console.error(`bench: wrote ${results.length} result(s) to ${options.out}`);
  }
  if (recording.toReport) {
    const { writeStore } = await import('./store.js');
    const merged = mergeStores(recording.store, fragment, (r, why) => warn(`rejected ${r.suite}: ${why}`), true);
    if (options['env-name']) {
      merged.envs[recording.env.id].name = options['env-name'];
    }
    writeStore(recording.file, merged);
    console.error(`bench: saved ${results.length} result(s) to ${recording.file}`);
  }
}

// Browser: no git access, so the commit comes from the person (pasted `git log` output); results are downloaded as JSON.
function offerDownload() {
  const button = document.getElementById('download');
  if (!button) {
    return;
  }
  button.hidden = false;
  button.onclick = () => {
    const answer = prompt("Paste the output of: git log -1 --format='%H %cI %s'");
    const match = /^'?([0-9a-f]{40}) (\S+) ?(.*?)'?$/.exec((answer || '').trim());
    if (!match) {
      return;
    }
    const ctx = { git: { sha: match[1], date: match[2], subject: match[3] }, ...browserEnv() };
    window.__benchRun.forEach(r => Object.assign(r, { sha: ctx.git.sha, envId: ctx.env.id, runtime: ctx.run.runtime, power: null }));
    const blob = new Blob([JSON.stringify(toFragment(ctx, window.__benchRun))], { type: 'application/json' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `bench-${match[1].slice(0, 7)}.json` }).click();
  };
}

await main();
