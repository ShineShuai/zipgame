// Line-width ratchet: no JavaScript file may have more lines of 100 columns or more than the
// number in test/long-lines.json, and a file that is not listed there may have none.
//
//   node test/check-width.js            check (npm run check does this). A file over its number
//                                       lists the lines new or changed since HEAD (file:line)
//   node test/check-width.js --fix      rewrap those lines when they are whole-line // comments
//                                       (npm run width:fix); code and strings are for the author
//   node test/check-width.js --base=REF compare with REF (origin/main, say) instead of HEAD
//   node test/check-width.js --update   lower the numbers after a clean-up (never raises one)
//
// A formatter does not rewrap comments or split strings, so this is what keeps the limit.
// Columns are characters (code points), not bytes.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_COLUMNS = 99;
const SHOWN_FILES = 20;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'test', 'long-lines.json');

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (path.endsWith('.js') || path.endsWith('.mjs')) found.push(path);
  }
  return found;
}

// The 1-based numbers of the lines that are too wide (code points <= UTF-16 units, so the
// cheap length test comes first).
export const longLines = text =>
  text.split('\n').flatMap((line, index) => {
    const wide = line.length > MAX_COLUMNS && [...line.replace(/\r$/, '')].length > MAX_COLUMNS;
    return wide ? [index + 1] : [];
  });

// A whole-line `// ` comment that is wider than MAX_COLUMNS, as the lines that replace it: the
// words
// move on to as many comment lines as it takes, with the indent and the marker of the first. Null
// for what is not that (code, a string, a comment after code, a directive for a tool, a line that
// is not too wide) or what cannot break (a word wider than a line): those are for the author.
export const wrapComment = line => {
  const match = /^(\s*)\/\/ (?!biome-|@ts-|eslint-)(\S.*)$/.exec(line);
  if (!match || [...line].length <= MAX_COLUMNS) return null;
  const prefix = `${match[1]}// `;
  const wrapped = [];
  let current = '';
  for (const word of match[2].split(/ +/)) {
    if ([...(prefix + word)].length > MAX_COLUMNS) return null;
    if (current && [...`${prefix}${current} ${word}`].length > MAX_COLUMNS) {
      wrapped.push(prefix + current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  return [...wrapped, prefix + current];
};

// Whether a line number of `file` is new or changed against `base` (a git ref; HEAD is the last
// commit, so staged and unstaged work counts), as a function. Every line is new in a file git does
// not know yet. Null when there is no git to ask.
export function changedSince(file, base = 'HEAD') {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    git('rev-parse', '--git-dir');
  } catch {
    return null;
  }
  try {
    git('ls-files', '--error-unmatch', '--', file);
  } catch {
    return () => true;
  }
  try {
    const changed = new Set();
    for (const [, start, count = '1'] of git(
      'diff',
      '-U0',
      '--no-color',
      base,
      '--',
      file,
    ).matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
      for (let at = 0; at < Number(count); at++) changed.add(Number(start) + at);
    }
    return line => changed.has(line);
  } catch {
    return null; // a ref that git does not know
  }
}

function fixComments(files, lines, base) {
  for (const file of files) {
    const isChanged = changedSince(file, base);
    if (!isChanged) {
      console.error('--fix needs git, and a ref that it knows (--base=REF).');
      process.exit(1);
    }
    const path = join(root, file);
    const wide = new Set(lines[file]);
    let count = 0;
    const text = readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        const parts = wide.has(index + 1) && isChanged(index + 1) ? wrapComment(line) : null;
        count += parts ? 1 : 0;
        return parts ?? [line];
      });
    if (count) {
      writeFileSync(path, text.join('\n'));
      console.log(`${file}: ${count} comment lines rewrapped`);
    }
  }
}

// What is over the number of a file: the lines that are new or changed (file:line, as a terminal
// can
// open it), or, when there are none (CI checks out one commit), the last three.
function report(file, lines, allowed, base) {
  console.error(
    `${file}: ${lines.length} lines of more than ${MAX_COLUMNS} columns, ${allowed} allowed`,
  );
  const isChanged = changedSince(file, base);
  const mine = isChanged ? lines.filter(isChanged) : [];
  if (!mine.length) {
    console.error(`  last: ${lines.slice(-3).join(', ')}`);
    return;
  }
  const text = readFileSync(join(root, file), 'utf8').split('\n');
  for (const line of mine.slice(0, 10)) {
    console.error(`  ${file}:${line}  ${[...text[line - 1]].length} columns`);
  }
}

function measure() {
  const lines = {};
  for (const file of sourceFiles(root)) {
    const found = longLines(readFileSync(file, 'utf8'));
    if (found.length) lines[relative(root, file).split('\\').join('/')] = found;
  }
  return lines;
}

function main() {
  const update = process.argv.includes('--update');
  const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7) ?? 'HEAD';
  const known = existsSync(baselinePath);
  const baseline = known ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
  const allowed = file => baseline?.[file] ?? 0;
  let lines = measure();
  // The first --update has nothing to compare with.
  const over = () =>
    known || !update ? Object.keys(lines).filter(file => lines[file].length > allowed(file)) : [];
  let raised = over();
  if (raised.length && process.argv.includes('--fix')) {
    fixComments(raised, lines, base);
    lines = measure();
    raised = over();
  }

  if (raised.length) {
    for (const file of raised.slice(0, SHOWN_FILES)) {
      report(file, lines[file], allowed(file), base);
    }
    if (raised.length > SHOWN_FILES) {
      console.error(`... and ${raised.length - SHOWN_FILES} more files`);
    }
    console.error(
      'Wrap the lines: npm run width:fix does the // comments, a string is split with +, ' +
        'code goes through npm run format.',
    );
    process.exit(1);
  }
  if (update) {
    const next = Object.fromEntries(
      Object.keys(lines)
        .sort()
        .map(file => [file, lines[file].length]),
    );
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(next).reduce((sum, n) => sum + n, 0);
    console.log(`long-lines.json: ${Object.keys(next).length} files, ${total} lines`);
    return;
  }
  const lowered = Object.keys(baseline ?? {}).filter(
    file => (lines[file]?.length ?? 0) < baseline[file],
  );
  if (lowered.length) {
    console.log(
      `${lowered.length} files are below their number in long-lines.json: ` +
        'run npm run width:update to keep it.',
    );
  }
  console.log(`ok: no file has more lines of more than ${MAX_COLUMNS} columns than before`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
