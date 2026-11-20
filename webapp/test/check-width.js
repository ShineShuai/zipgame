// Line-width ratchet: no JavaScript file may have more lines of 100 columns or more than the
// number in test/long-lines.json, and a file that is not listed there may have none.
//
//   node test/check-width.js            check (npm run check does this)
//   node test/check-width.js --update   lower the numbers after a clean-up (never raises one)
//
// A formatter does not rewrap comments or split strings, so this is what keeps the limit.
// Columns are characters (code points), not bytes.
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
  const known = existsSync(baselinePath);
  const baseline = known ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
  const lines = measure();
  const allowed = file => baseline?.[file] ?? 0;
  // The first --update has nothing to compare with.
  const raised =
    known || !update ? Object.keys(lines).filter(file => lines[file].length > allowed(file)) : [];

  if (raised.length) {
    for (const file of raised.slice(0, SHOWN_FILES)) {
      const last = lines[file].slice(-3).join(', ');
      console.error(
        `${file}: ${lines[file].length} lines of more than ${MAX_COLUMNS} columns, ` +
          `${allowed(file)} allowed (last: ${last})`,
      );
    }
    if (raised.length > SHOWN_FILES) {
      console.error(`... and ${raised.length - SHOWN_FILES} more files`);
    }
    console.error('Wrap the lines (comments and strings by hand, code with the formatter).');
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
