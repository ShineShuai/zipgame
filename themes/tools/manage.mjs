// Adding, retiring and removing themes. A theme is a folder of themes/; nothing else lists it, so none of this edits anything else.
//   node themes/tools/manage.mjs list                    every theme (light and dark too): mode, live, draft or built-in, bundle size, problems (npm run themes -- list)
//   node themes/tools/manage.mjs new <id> [--from <id>]  a new theme from themes/_template, or a copy of another theme to start from
//   node themes/tools/manage.mjs retire <id>             "live": false: out of every offer, still in the dev reveal (restore: live again)
//   node themes/tools/manage.mjs remove <id>             deletes themes/<id>/. Players who own it keep it; nobody is offered it again
//   node themes/tools/manage.mjs fonts [--fetch [id ...]]  the font files the themes name and do not have yet, with where to get them;
//                                                        --fetch downloads them from Google Fonts, subset to the glyphs the UI uses (fonts-fetch.mjs)
// Pushing is what publishes: CI builds the site from whatever themes/ holds (build-site.mjs).
import {
  cpSync, existsSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN, BUILTIN_IDS } from '../../webapp/src/themes/builtin.js';
import { ID_RE } from '../../webapp/src/themes/pool.js';
import { fetchMissing } from './fonts-fetch.mjs';
import { loadBase, loadThemes, packTheme } from './pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const dirOf = (id, root = ROOT) => `${root}${id}`;
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);

function need(id) {
  if (!ID_RE.test(id ?? '')) throw new Error('give the theme id: lowercase letters, digits and dashes, starting with a letter, 24 characters at most');
  return id;
}
function theme(id, root) {
  if (!existsSync(`${dirOf(need(id), root)}/theme.json`)) throw new Error(`themes/${id}/ is not there`);
  return `${dirOf(id, root)}/theme.json`;
}

// Rows for `list`: [{ id, mode, state, bytes, problems, fonts }]; the built-ins (light, dark) first: in the pool, no file
export function rows() {
  const base = loadBase();
  const builtin = BUILTIN.map(b => ({ id: b.id, mode: b.mode, state: 'built-in', bytes: 0, problems: 0, fonts: 0 }));
  return builtin.concat(loadThemes().map(th => {
    const { problems, size, missingFonts } = packTheme(th, base);
    return { id: th.id, mode: th.mode, state: th.live === false ? 'draft' : 'live', bytes: size, problems: problems.length, fonts: missingFonts.length };
  }));
}

// themes/<id>/ from the template, or from another theme (its fonts and art too). Returns the folder.
export function create(id, from = '_template', root = ROOT) {
  need(id);
  if (BUILTIN_IDS.includes(id)) throw new Error(`${id} is a built-in theme`);
  if (existsSync(dirOf(id, root))) throw new Error(`themes/${id}/ is already there`);
  if (!existsSync(`${dirOf(from, root)}/theme.json`)) throw new Error(`themes/${from}/ is not there`);
  cpSync(dirOf(from, root), dirOf(id, root), { recursive: true });
  const file = `${dirOf(id, root)}/theme.json`;
  const data = readJson(file);
  delete data.proto;
  delete data.live;
  data.id = id;
  data.v = 1;
  if (from !== '_template') data.name = { en: id, zh: id };
  writeJson(file, data);
  return `themes/${id}/`;
}

export function setLive(id, live, root = ROOT) {
  const file = theme(id, root);
  const data = readJson(file);
  if (live) delete data.live; else data.live = false;
  writeJson(file, data);
}

export function remove(id, root = ROOT) {
  theme(id, root);
  rmSync(dirOf(id, root), { recursive: true, force: true });
}

function main([cmd, id, ...rest]) {
  switch (cmd) {
    case 'list': {
      const list = rows();
      const w = Math.max(2, ...list.map(r => r.id.length));
      list.forEach(r => console.log(`${r.id.padEnd(w)}  ${r.mode.padEnd(5)}  ${r.state.padEnd(8)}  ${String(r.bytes).padStart(6)} bytes${r.problems ? `  ${r.problems} PROBLEMS` : ''}${r.fonts ? `  ${r.fonts} font file(s) missing` : ''}`));
      console.log(`${list.length} themes (${list.filter(r => r.state === 'built-in').length} built-in, ${list.filter(r => r.state === 'draft').length} drafts)`);
      process.exitCode = list.some(r => r.problems) ? 1 : 0;
      break;
    }
    case 'new': {
      const from = rest[0] === '--from' ? rest[1] : undefined;
      const dir = create(id, from);
      console.log(`${dir} created. Edit ${dir}theme.json (five colours are enough), then:\n  node themes/tools/pack.mjs ${id}      check it\n  npm run themes:preview               look at it (hold V in the game: every theme)\nA new theme is live as soon as it is pushed; "live": false keeps it a draft.`);
      break;
    }
    case 'fonts': {
      if (id === '--fetch') {
        fetchMissing({ only: rest }).then(({ got, failed }) => { console.log(`${got} font file(s) fetched, ${failed} failed (npm run themes -- fonts lists what is still missing)`); process.exitCode = failed ? 1 : 0; });
        break;
      }
      let missing = 0;
      for (const th of loadThemes()) {
        for (const f of th.fonts ?? []) {
          if (existsSync(`${dirOf(th.id)}/fonts/${f.file}`)) continue;
          missing++;
          const [lo, hi] = f.weight.split(' ');
          console.log(`themes/${th.id}/fonts/${f.file}\n  ${f.family} ${f.weight}: https://fonts.google.com/specimen/${f.family.replace(/ /g, '+')}   (Latin subset, woff2, 60 KB at most; weights ${lo}${hi ? `-${hi}` : ''})`);
        }
      }
      console.log(missing ? `${missing} font file(s) missing: those themes use their fallback fonts until they are added` : 'every font file is there');
      break;
    }
    case 'retire': setLive(id, false); console.log(`${id}: draft (no offer; the dev reveal still lists it)`); break;
    case 'restore': setLive(id, true); console.log(`${id}: live`); break;
    case 'remove': remove(id); console.log(`themes/${id}/ removed. The next deployment no longer has it; players who own it keep it.`); break;
    default:
      console.error('usage: manage.mjs list | new <id> [--from <id>] | retire <id> | restore <id> | remove <id> | fonts [--fetch [id ...]]');
      process.exitCode = 2;
  }
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
