#!/usr/bin/env node
// Prints, or writes into server/turso/schema.sql, the SQL of the Turso table `bin_edge`: the histogram bins of src/core/hist.js (NB, T0_MS, RATIO) as
// integer ms ranges [lo, hi). SQL has no exact log(), so the database looks the bin of a time up in this table instead of computing it.
//   node tools/print-bin-edge.mjs                  print the block to stdout
//   node tools/print-bin-edge.mjs --write          replace the block between the `-- bin_edge:begin` / `-- bin_edge:end` lines of the schema (no change when it is current)
//   node tools/print-bin-edge.mjs --check          exit 1 when the schema's block is not the one hist.js gives (server/turso/schema.test.mjs runs the same check)
//   --schema FILE                                  the schema to read / write (default: server/turso/schema.sql next to this tools/ directory)
// Change procedure after editing NB, T0_MS or RATIO: server/README.md ("Changing the histogram bins").
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { NB, T0_MS, RATIO, MAX_MS, binOf } from '../src/core/hist.js';

export const BEGIN = '-- bin_edge:begin', END = '-- bin_edge:end';
const OPEN_END = '4611686018427387904'; // 2^62: the last bin has no upper end (every time up to MAX_MS lands in some bin)

// [{ bin, lo, hi }] with binOf(ms) === bin exactly for lo <= ms < hi, for every whole ms from 0 to MAX_MS (the last bin's hi is OPEN_END).
export function binEdges() {
  const lo = new Array(NB).fill(null);
  for (let ms = 0, prev = -1; ms <= MAX_MS; ms++) {
    const b = binOf(ms);
    if (b === prev) continue;
    if (lo[b] !== null || b < prev) throw new Error(`binOf is not non-decreasing at ${ms} ms (bin ${b} after ${prev})`);
    lo[b] = ms;
    prev = b;
  }
  const empty = lo.findIndex(x => x === null);
  if (empty >= 0) throw new Error(`bin ${empty} holds no whole millisecond up to MAX_MS = ${MAX_MS}: NB is too large for T0_MS / RATIO`);
  return lo.map((from, bin) => ({ bin, lo: from, hi: bin + 1 < NB ? lo[bin + 1] : OPEN_END }));
}

// The text between (and including) the marker lines.
export function binEdgeBlock() {
  const rows = binEdges().map(e => `  (${e.bin}, ${e.lo}, ${e.hi})`).join(',\n');
  return [
    `${BEGIN}  (generated: node tools/print-bin-edge.mjs --write, from NB = ${NB}, T0_MS = ${T0_MS}, RATIO = ${RATIO} of src/core/hist.js; do not edit by hand)`,
    'INSERT OR REPLACE INTO bin_edge (bin, lo, hi) VALUES', rows + ';',
    `DELETE FROM bin_edge WHERE bin >= ${NB}; -- bins that no longer exist (NB shrank); the table is never empty in between, so a solve sent meanwhile is still checked`,
    END,
  ].join('\n');
}

// The block of a schema text, marker lines included; throws unless there is exactly one pair.
export function blockOf(sql) {
  const begin = [...sql.matchAll(/^-- bin_edge:begin.*$/gm)], end = [...sql.matchAll(/^-- bin_edge:end.*$/gm)];
  if (begin.length !== 1 || end.length !== 1 || end[0].index < begin[0].index) throw new Error(`the schema needs exactly one "${BEGIN}" line followed by one "${END}" line`);
  return { from: begin[0].index, to: end[0].index + end[0][0].length, text: sql.slice(begin[0].index, end[0].index + end[0][0].length) };
}
export const withBlock = (sql, block = binEdgeBlock()) => { const b = blockOf(sql); return sql.slice(0, b.from) + block + sql.slice(b.to); };

function main(args) {
  const i = args.indexOf('--schema');
  const file = i >= 0 ? args[i + 1] : fileURLToPath(new URL('../server/turso/schema.sql', import.meta.url));
  if (i >= 0 && !file) throw new Error('--schema needs a file');
  if (!args.includes('--write') && !args.includes('--check')) return console.log(binEdgeBlock());
  const sql = fs.readFileSync(file, 'utf8'), next = withBlock(sql);
  if (args.includes('--check')) {
    if (next === sql) return console.log(`${file}: bin_edge is current (${NB} bins)`);
    console.error(`${file}: bin_edge is stale: run node tools/print-bin-edge.mjs --write`);
    process.exit(1);
  }
  if (next === sql) return console.log(`${file}: already current (${NB} bins)`);
  fs.writeFileSync(file, next);
  console.log(`${file}: bin_edge rewritten (${NB} bins). Next: re-run it on the database (server/README.md, "Changing the histogram bins")`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
