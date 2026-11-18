#!/usr/bin/env node
// Checks the Game of Day puzzles a deploy is about to serve, with the code that will serve them:
// the code in the current directory (run from the repo root of the deployed commit). Every file
// has to be named YYYYMMDD.txt with a real date, and every file from FROM on has to pass
// parse() and validate(), as the app does when it fetches the day's file (src/features/daily.js).
// A puzzle of an earlier day is only used by a replay, and it is not checked again.
//   node check-puzzles.mjs DIR [FROM]
//   DIR: the folder of the files; FROM: YYYYMMDD, default today (UTC)
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = path => import(pathToFileURL(resolve(path)).href);
const { parse } = await load('webapp/src/core/format.js');
const { validate } = await load('webapp/src/core/model.js');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node check-puzzles.mjs DIR [FROM]');
  process.exit(2);
}
const from = process.argv[3] ?? new Date().toISOString().slice(0, 10).replaceAll('-', '');

const isDate = name => {
  const [, y, m, d] = /^(\d{4})(\d{2})(\d{2})$/.exec(name) ?? [];
  if (!y) {
    return false;
  }
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d;
};

let checked = 0;
let failed = 0;
const fail = (file, message) => {
  console.log(`::error file=${file}::${message}`);
  failed++;
};

for (const file of readdirSync(dir).filter(f => f.endsWith('.txt')).sort()) {
  const name = file.slice(0, -4);
  if (!isDate(name)) {
    fail(join(dir, file), 'not named YYYYMMDD.txt with a real date');
    continue;
  }
  if (name < from) {
    continue;
  }
  checked++;
  try {
    const result = validate(parse(readFileSync(join(dir, file), 'utf8')));
    if (!result.ok) {
      fail(join(dir, file), `validate: ${JSON.stringify(result).slice(0, 160)}`);
    }
  } catch (e) {
    fail(join(dir, file), `parse: ${e.message}`);
  }
}
const verdict = failed ? `${failed} failed` : 'all valid';
console.log(`Checked ${checked} puzzle(s) from ${from} on: ${verdict}`);
process.exit(failed ? 1 : 0);
