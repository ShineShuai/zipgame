// Decode (or build) a Zip share link.
//   node tools/share-decode.mjs <code | link | ?s=code>      -> the shared result as JSON
//   node tools/share-decode.mjs --encode '<result json>'      -> the code (to craft a test link)
// A local game carries its puzzle, as plain arrays: { n, cp: [...], walls: [...], ... }; a Game of
// Day carries its date. Exit code 1 when the code is damaged.
import { decodeShare, encodeShare } from '../src/core/share-code.js';
import { dateOfDay } from '../src/features/daily.js';
import { stripText } from '../src/features/share.js';
import { readFileSync } from 'node:fs';

const [first, second] = process.argv.slice(2);

// --encode accepts inline JSON or a path to a .json file
function parseJsonArg(arg) {
  let text = arg;
  try {
    text = readFileSync(arg, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw e;   // real IO problem
    // not a path — assume it's inline JSON
  }
  return JSON.parse(text);
}

function codeOf(arg) {
  const query = arg.includes('?') ? arg.slice(arg.indexOf('?')) : arg;
  return query.includes('s=') ? new URLSearchParams(query).get('s') : arg;
}

// A puzzle's arrays are typed arrays in the app; JSON has plain ones.
const typed = rec => {
  const p = rec.puzzle;
  if (!p) return rec;
  const puzzle = { ...p, cp: Uint16Array.from(p.cp), walls: Uint8Array.from(p.walls) };
  if (p.holes) puzzle.holes = Uint8Array.from(p.holes);
  if (p.arrows) puzzle.arrows = Uint8Array.from(p.arrows);
  return { ...rec, puzzle };
};

if (first === '--encode') {
  const code = encodeShare(typed(parseJsonArg(second)));
  if (!code) {
    console.error('record out of range');
    process.exit(1);
  }
  console.log(code);
} else if (!first) {
  console.error("usage: share-decode.mjs <code | link>   |   --encode '<json>' | <file.json>");
  process.exit(2);
} else {
  const rec = decodeShare(codeOf(first));
  if (!rec) {
    console.error('not a valid share code (damaged, truncated or from another format version)');
    process.exit(1);
  }
  const extra = { strip: stripText(rec.levels) };
  if (rec.kind === 'gotd') {
    extra.date = dateOfDay(rec.day);
  }
  const plain = (key, value) => (ArrayBuffer.isView(value) ? [...value] : value); // typed -> plain
  console.log(JSON.stringify({ ...rec, ...extra }, plain, 2));
}
