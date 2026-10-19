// Prints the dev link: a share-looking link that pins (or unpins) the hidden dev reveal on the
// device that opens it (features/dev-reveal.js).
//   node tools/dev-link.mjs [--base <page url>] [--off]
// Without --base only the query (?s=<code>) is printed: append it to the play page's address.
import { devLinkUrl } from '../src/features/dev-reveal.js';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const base = at < 0 ? '' : args[at + 1];
if (at >= 0 && !base) {
  console.error('usage: dev-link.mjs [--base <page url>] [--off]');
  process.exit(2);
}
console.log(devLinkUrl(base, !args.includes('--off')));
