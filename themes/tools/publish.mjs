// Puts a theme where the game can be handed it, and takes it away again. A published theme is ONE file, `offers/<token>.json`, in the
// folder next to webapp/ (config.js THEMES.offers). The token is random (128 bits) and every publication gets its own, so nothing can be
// guessed or listed from outside: a player can only fetch the token the offer mechanism gave them, and only while the file exists.
//   node themes/tools/publish.mjs publish <id>          packs the theme, writes offers/<token>.json, prints the token
//   node themes/tools/publish.mjs withdraw <token|id>   deletes that file (or every file of that theme): the offer is over
//   node themes/tools/publish.mjs list                  what is published right now
// Publish when an event starts and withdraw when it ends: at any time only the running event's files exist. The folder's names are what
// protects the themes, so do not commit `offers/` to a public repository (see themes/README.md).
import { randomBytes } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { loadBase, loadThemes, packTheme } from './pack.mjs';

export const OFFERS = new URL('../../offers/', import.meta.url);
const TOKEN = /^[A-Za-z0-9_-]{22}$/;     // the same rule as webapp/src/themes/source.js
const BLANK = '<!DOCTYPE html>\n<meta charset="utf-8">\n<title></title>\n';

// Writes `bundle` under a new token in `dir` (a URL of a folder); returns the token.
export function publishBundle(bundle, dir = OFFERS, token = randomBytes(16).toString('base64url')) {
  mkdirSync(dir, { recursive: true });
  const index = new URL('index.html', dir);
  if (!existsSync(index)) writeFileSync(index, BLANK);     // so that a host that lists folders has nothing to list
  writeFileSync(new URL(`${token}.json`, dir), JSON.stringify(bundle));
  return token;
}

// [{ token, id, v, bytes }] of the published files
export function listOffers(dir = OFFERS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => TOKEN.test(f.replace(/\.json$/, '')) && f.endsWith('.json')).map(f => {
    const text = readFileSync(new URL(f, dir), 'utf8');
    let bundle = {};
    try { bundle = JSON.parse(text); } catch { /* not ours: listed without an id */ }
    return { token: f.slice(0, -5), id: bundle.id ?? '?', v: bundle.v ?? 0, bytes: text.length };
  });
}

// Deletes the file of a token, or every file of a theme id; returns the tokens removed. Anything else removes nothing.
export function withdraw(key, dir = OFFERS) {
  const gone = listOffers(dir).filter(o => (TOKEN.test(key) ? o.token === key : o.id === key));
  for (const o of gone) rmSync(new URL(`${o.token}.json`, dir));
  return gone.map(o => o.token);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const [command, key] = process.argv.slice(2);
  try {
    if (command === 'publish') {
      const theme = loadThemes().find(t => t.id === key);
      if (!theme) throw new Error(`no theme ${key} in themes/`);
      const { bundle, problems } = packTheme(theme, loadBase());
      if (problems.length) throw new Error(`the theme has problems:\n  ${problems.join('\n  ')}`);
      const token = publishBundle(bundle);
      console.log(`${theme.id} v${theme.v} -> offers/${token}.json (${JSON.stringify(bundle).length} bytes)\ntoken: ${token}`);
    } else if (command === 'withdraw') {
      const tokens = withdraw(key ?? '');
      console.log(tokens.length ? `withdrawn: ${tokens.join(', ')}` : `nothing published for ${key}`);
    } else if (command === 'list') {
      const rows = listOffers();
      console.log(rows.length ? rows.map(o => `${o.token}  ${o.id} v${o.v}  ${o.bytes} bytes`).join('\n') : 'nothing published');
    } else {
      console.error('usage: publish.mjs publish <id> | withdraw <token|id> | list');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
