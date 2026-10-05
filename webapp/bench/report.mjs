#!/usr/bin/env node
// Maintain the benchmark report (bench/report.html: viewer + embedded results).
//   node bench/report.mjs add FILE...          merge result .json files or other report .html files
//   node bench/report.mjs note SHA TEXT        set the note of a version (sha prefix ok)
//   node bench/report.mjs rm SHA[+] [--suite S] [--env ID]   remove results of a commit (SHA+ = its uncommitted-changes results)
//   node bench/report.mjs rm --dirty           remove all results recorded from uncommitted working trees
//   node bench/report.mjs list                 versions, environments, results
//   node bench/report.mjs build                re-render from report.template.html (after viewer changes)
// Options: --report FILE   report to read and update (default bench/report.html; created by `add` when missing)
//          --out FILE      write the result there instead and leave --report untouched
//          --allow-dirty   `add` also takes results recorded from uncommitted working trees
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { DEFAULT_REPORT, readStore, writeStore } from './store.js';
import { baseSha, isOwn, mergeStores, orderedVersions, verId, versionInfo } from './results.js';

const { values, positionals } = parseArgs({
  options: {
    report: { type: 'string' },
    out: { type: 'string' },
    suite: { type: 'string' },
    env: { type: 'string' },
    dirty: { type: 'boolean' },
    'allow-dirty': { type: 'boolean' },
  },
  allowPositionals: true,
});
const file = values.report || DEFAULT_REPORT;
const [command, ...args] = positionals;
const store = readStore(file);

// "abc12" or "abc12+" (uncommitted results of that commit) -> version id
function findId(prefix = '') {
  const matches = Object.keys(store.versions).filter(sha => sha.startsWith(baseSha(prefix) || '\0'));
  if (matches.length !== 1) {
    throw new Error(`version "${prefix}": ${matches.length} matches`);
  }
  return matches[0] + (prefix.endsWith('+') ? '+' : '');
}

const save = next => writeStore(values.out || file, next);

function load(path) {
  return path.endsWith('.html') ? readStore(path) : JSON.parse(readFileSync(path, 'utf8'));
}

if (command === 'add') {
  let merged = store;
  for (const path of args) {
    merged = mergeStores(merged, load(path), (r, why) => console.error(`${path}: rejected ${r.suite} ${String(r.sha).slice(0, 7)}: ${why} (--allow-dirty to accept)`), Boolean(values['allow-dirty']));
  }
  save(merged);
  console.log(`${values.out || file}: ${merged.results.length} result(s) (was ${store.results.length})`);
} else if (command === 'note') {
  store.versions[baseSha(findId(args[0]))].note = args.slice(1).join(' ');
  save(store);
} else if (command === 'rm') {
  const id = values.dirty ? null : findId(args[0]);
  const keep = r => (id ? verId(r) !== id : !r.dirty) || (values.suite && r.suite !== values.suite) || (values.env && r.envId !== values.env);
  const before = store.results.length;
  store.results = store.results.filter(keep);
  save(store);
  console.log(`removed ${before - store.results.length} result(s)`);
} else if (command === 'list') {
  for (const id of orderedVersions(store)) {
    const v = versionInfo(store, id);
    console.log(`${id.slice(0, 7)}${v.dirty ? '+' : ' '} ${(v.date || '').slice(0, 10)} algo ${v.algo} ${v.subject}${v.note ? `  [${v.note}]` : ''}`);
    for (const r of store.results.filter(x => verId(x) === id)) {
      const how = isOwn(r) ? '' : `  (backfill, bench@${r.bench.slice(0, 7)}${r.bench.endsWith('+') ? '+' : ''})`;
      console.log(`    ${r.suite.padEnd(12)} ${(store.envs[r.envId] || {}).name}  ${r.rows.length} rows${how}${r.checks.failed ? `  ${r.checks.failed} CHECK FAILURE(S)` : ''}`);
    }
  }
} else if (command === 'build') {
  save(store);
} else {
  console.error('usage: report.mjs add|note|rm|list|build (see header of this file)');
  process.exitCode = 2;
}
