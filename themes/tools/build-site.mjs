// Builds the theme files of the site: the folder `webapp/src/config.js` THEMES.base points at, next to webapp/.
//   node themes/tools/build-site.mjs <site-dir>          packs every theme and writes <site-dir>/<folder>/ (CI: stage-site.sh)
//   node themes/tools/build-site.mjs --check <site-dir>  reads that folder back: every manifest entry has its file, whose name is its hash
//   node themes/tools/build-site.mjs --dir               prints the folder's name
// What is written there:
//   <hash>.json   one bundle per theme; the name is the first 24 hex digits of the sha256 of the file, so it cannot be guessed from the
//                 theme's id and a changed theme is a new file (nothing stale in a cache)
//   <pool>        the manifest (THEMES.pool): [{ id, v, mode, name, chrome, layout, swatches, symbol, f, live }], `f` being the file's name
// `"live": false` in a theme's theme.json marks a draft: it is in the manifest (the dev reveal lists it) and is never offered to a player.
// Nothing of themes/ is copied: no theme.json, art.json or font file, only the packed bundles. A theme with a problem fails the build.
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '../../webapp/src/config.js';
import { FILE_RE, cleanPool } from '../../webapp/src/themes/source.js';
import { loadBase, loadThemes, packTheme } from './pack.mjs';

export const SITE_DIR = /([\w-]+)\/$/.exec(THEMES.base)?.[1];
export const POOL_FILE = THEMES.pool;
const stem = text => createHash('sha256').update(text).digest('hex').slice(0, 24);

// Packs `themes` (default: every theme of themes/) into `<out>/<SITE_DIR>/` (emptied first). Returns the manifest; throws on a problem.
export function buildSite(out, { themes = loadThemes(), base = loadBase(), log = () => {} } = {}) {
  if (!SITE_DIR) throw new Error(`config.js THEMES.base ${THEMES.base}: no folder name to build into`);
  const ids = themes.map(t => t.id);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length) throw new Error(`themes with the same id: ${[...new Set(repeated)].join(', ')}`);
  const dir = join(out, SITE_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const manifest = [];
  const failed = [];
  for (const theme of themes) {
    const { bundle, problems, size } = packTheme(theme, base);
    if (problems.length) { failed.push(`${theme.id}:\n  ${problems.join('\n  ')}`); continue; }
    const text = JSON.stringify(bundle);
    const f = stem(text);
    writeFileSync(join(dir, `${f}.json`), text);
    manifest.push({ id: theme.id, v: theme.v, ...bundle.meta, f, live: theme.live !== false });
    log(`${theme.id}${theme.live === false ? ' (draft)' : ''}: ${size} bytes -> ${f}.json`);
  }
  if (failed.length) throw new Error(`themes with problems:\n${failed.join('\n')}`);
  const pool = JSON.stringify(manifest);
  if (cleanPool(JSON.parse(pool))?.length !== manifest.length) throw new Error('the app would not accept the manifest (webapp/src/themes/source.js)');
  writeFileSync(join(dir, POOL_FILE), pool);
  return manifest;
}

// The problems of a built folder: [] when it is sound.
export function checkSite(out) {
  const dir = join(out, SITE_DIR);
  const problems = [];
  if (!existsSync(join(dir, POOL_FILE))) return [`${SITE_DIR}/${POOL_FILE}: missing`];
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(join(dir, POOL_FILE), 'utf8')); } catch { return [`${SITE_DIR}/${POOL_FILE}: not JSON`]; }
  const pool = cleanPool(manifest);
  if (!pool || pool.length !== manifest.length) problems.push(`${SITE_DIR}/${POOL_FILE}: the app drops entries of it`);
  const listed = new Set();
  for (const x of manifest) {
    if (!FILE_RE.test(x.f ?? '')) { problems.push(`${x.id}: malformed file name`); continue; }
    listed.add(`${x.f}.json`);
    const file = join(dir, `${x.f}.json`);
    if (!existsSync(file)) problems.push(`${x.id}: ${x.f}.json is missing`);
    else if (stem(readFileSync(file, 'utf8')) !== x.f) problems.push(`${x.id}: ${x.f}.json is not named by its content`);
  }
  for (const name of readdirSync(dir)) if (name !== POOL_FILE && !listed.has(name)) problems.push(`${name}: not in the manifest`);
  return problems;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const [a, b] = process.argv.slice(2);
  try {
    if (a === '--dir') {
      console.log(SITE_DIR);
    } else if (a === '--check' && b) {
      const problems = checkSite(b);
      if (problems.length) throw new Error(problems.join('\n'));
      console.log(`${SITE_DIR}/: ${readdirSync(join(b, SITE_DIR)).length} files, sound`);
    } else if (a && !a.startsWith('--')) {
      const manifest = buildSite(a, { log: console.log });
      console.log(`${manifest.length} themes (${manifest.filter(m => !m.live).length} drafts) -> ${join(a, SITE_DIR)}/`);
    } else {
      console.error('usage: build-site.mjs <site-dir> | --check <site-dir> | --dir');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
