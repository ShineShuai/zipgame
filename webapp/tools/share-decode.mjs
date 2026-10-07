// Decode (or build) a Zip share link.
//   node tools/share-decode.mjs <code | link | ?s=code>      -> the shared result as JSON
//   node tools/share-decode.mjs --encode '<result json>'      -> the code (to craft a test link)
// Exit code 1 when the code is damaged.
import { decodeShare, encodeShare } from '../src/core/share-code.js';
import { dateOfDay } from '../src/features/daily.js';
import { stripText } from '../src/features/share.js';
import { dailySeed } from '../src/core/rng.js';

const [first, second] = process.argv.slice(2);

function codeOf(arg) {
  const query = arg.includes('?') ? arg.slice(arg.indexOf('?')) : arg;
  return query.includes('s=') ? new URLSearchParams(query).get('s') : arg;
}

if (first === '--encode') {
  const code = encodeShare(JSON.parse(second));
  if (!code) {
    console.error('record out of range');
    process.exit(1);
  }
  console.log(code);
} else if (!first) {
  console.error('usage: share-decode.mjs <code | link>   |   --encode \'<json>\'');
  process.exit(2);
} else {
  const rec = decodeShare(codeOf(first));
  if (!rec) {
    console.error('not a valid share code (damaged, truncated or from another format version)');
    process.exit(1);
  }
  const extra = { date: dateOfDay(rec.day), strip: stripText(rec.levels) };
  if (rec.kind === 'local') {
    extra.seed = dailySeed(rec.day, rec.n, rec.index, rec.algo);
  }
  console.log(JSON.stringify({ ...rec, ...extra }, null, 2));
}
