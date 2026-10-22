// Static checks that the unit tests cannot make, because the app entry points
// (src/apps/*/main.js) need a browser and are never imported by the tests:
//   - every .js file parses
//   - every relative import points at a file that exists
//   - every named import is exported by the module it comes from
//   - layering: the cell-graph engine (src/core/surface) knows no variant board (see LAYERS below)
//   - every <script src> / <link href> / <a href> in the html pages points at a file that exists
//   - the home page at the repository root (index.html next to webapp/) is checked the same way, and its
//     two languages must have the same number of texts
// Run: node test/check.js
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function filesUnder(dir, extension) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, extension));
    else if (path.endsWith(extension)) found.push(path);
  }
  return found;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const shortName = path => relative(root, path);
const report = (file, line, message) => problems.push(`${shortName(file)}:${line}  ${message}`);

// Names declared by `const a = ..., b = ...;` starting right after the keyword: the identifier at the
// start of each top-level declarator. Brackets and quoted strings are skipped so commas inside values
// do not count.
function declaratorNames(source, from) {
  const names = [];
  let depth = 0;
  let expectName = true;
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (expectName && /[\w$]/.test(ch)) {
      let end = i;
      while (end < source.length && /[\w$]/.test(source[end])) end++;
      names.push(source.slice(i, end));
      expectName = false;
      i = end;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < source.length && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
      i++;
    } else if ('([{'.includes(ch)) {
      depth++;
      i++;
    } else if (')]}'.includes(ch)) {
      depth--;
      i++;
    } else if (ch === ',' && depth === 0) {
      expectName = true;
      i++;
    } else if (ch === ';' && depth === 0) {
      break;
    } else {
      i++;
    }
  }
  return names;
}

// Names a module exports: `export function f`, `export const x = 1, y = 2`, `export { a, b as c }`.
// Returns null for modules with `export *` (cannot be checked statically).
function exportedNames(file) {
  const source = readFileSync(file, 'utf8');
  if (/export\s*\*/.test(source)) return null;
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+/g)) {
    for (const name of declaratorNames(source, match.index + match[0].length)) names.add(name);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

// Who may not import whom. The cell-graph engine in src/core/surface serves the 3D variants and
// the flat Pentagon board; it must not depend on a variant, and the variant owns its board:
//   - only topology.js (the kind table) may import the Pentagon board, src/core/pentagon.js, and the
//     boards of the solids, src/core/solid/
//   - a solid knows nothing of the engine or of the Pentagon board
//   - nothing in the engine imports the grid generator, src/core/gen/generate.js (use gen/pick-k.js)
const LAYERS = [
  {
    in: 'src/core/surface/',
    except: ['src/core/surface/topology.js'],
    deny: ['src/core/pentagon.js'],
  },
  {
    in: 'src/core/surface/',
    except: ['src/core/surface/topology.js'],
    deny: ['src/core/solid/meshes.js', 'src/core/solid/kinds.js'],
  },
  { in: 'src/core/solid/', except: [], deny: ['src/core/pentagon.js'] },
  { in: 'src/core/surface/', except: [], deny: ['src/core/gen/generate.js'] },
];

// src/coop is a hidden trial that must stay removable (delete src/coop and test/coop, nothing else
// breaks): nothing outside those folders may import it, and it may use only the read-only parts of
// the app listed here (no leaderboard, behaviour log or stats store: it uploads and writes nothing
// of the app's own). Its dynamic import (boot.js) is not seen by this static check.
const COOP_DIRS = ['src/coop/', 'test/coop/'];
const COOP_MAY_IMPORT = [
  /^src\/core\//,
  /^src\/view\/geometry\.js$/,
  /^src\/apps\/play\/(board|icons)\.js$/,
  /^src\/features\/hints\.js$/,
  /^src\/platform\/(run|sound|storage)\.js$/,
  /^src\/ui\/i18n\.js$/,
];
const inCoop = name => COOP_DIRS.some(dir => name.startsWith(dir));

const jsFiles = ['src', 'test', 'bench'].flatMap(dir => filesUnder(join(root, dir), '.js'));

for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    report(file, 1, 'syntax error: ' + String(error.stderr).split('\n').find(line => line.includes('Error')));
    continue;
  }

  const source = readFileSync(file, 'utf8');
  const importPattern = /import\s+(?:\{([^}]*)\}|([\w$]+))\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const [, namedList, , specifier] = match;
    if (!specifier.startsWith('.')) continue; // node: modules and packages are not ours to check
    const line = lineOf(source, match.index);
    const target = resolve(dirname(file), specifier);
    if (!existsSync(target)) {
      report(file, line, `import '${specifier}' does not exist`);
      continue;
    }
    for (const layer of LAYERS) {
      const name = shortName(file);
      if (name.startsWith(layer.in) && !layer.except.includes(name) && layer.deny.includes(shortName(target))) {
        report(file, line, `layering: ${name} must not import ${shortName(target)}`);
      }
    }
    const importer = shortName(file);
    const imported = shortName(target);
    if (inCoop(imported) && !inCoop(importer)) {
      report(file, line, `coop: ${importer} must not import ${imported} (the trial is removable)`);
    }
    if (importer.startsWith('src/coop/') && !inCoop(imported)
      && !COOP_MAY_IMPORT.some(allowed => allowed.test(imported))) {
      report(file, line, `coop: ${importer} may not import ${imported}`);
    }
    if (!namedList) continue;
    const exported = exportedNames(target);
    if (!exported) continue;
    for (const part of namedList.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name && !exported.has(name)) report(file, line, `'${name}' is not exported by ${shortName(target)}`);
    }
  }
}

function checkHtmlReferences(file) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue; // http:, data:, #anchor, //cdn
    const target = resolve(dirname(file), reference.split(/[?#]/)[0]);
    if (!existsSync(target)) report(file, lineOf(source, match.index), `'${reference}' does not exist`);
  }
}

// The home page is written twice, once per language: <span lang="en">..</span><span lang="zh">..</span>.
// Every English text needs its Chinese partner, so the two counts have to match.
function checkBothLanguages(file) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('data-lang')) return;
  const count = language => (source.match(new RegExp(`<(?!html)[^>]*\\blang="${language}"`, 'g')) || []).length;
  const english = count('en');
  const chinese = count('zh');
  if (english !== chinese) {
    report(file, 1, `${english} lang="en" elements but ${chinese} lang="zh" elements: every text needs both languages`);
  }
}

for (const file of filesUnder(root, '.html')) checkHtmlReferences(file);

// Pages directly in the repository root (the folder holding webapp/). Skipped when webapp/ is not
// inside a repository that has the .github folder next to it.
const repoRoot = resolve(root, '..');
const rootPages = existsSync(join(repoRoot, '.github'))
  ? readdirSync(repoRoot).filter(name => name.endsWith('.html')).map(name => join(repoRoot, name))
  : [];
for (const file of rootPages) {
  checkHtmlReferences(file);
  checkBothLanguages(file);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${jsFiles.length} js files`);
  process.exit(1);
}
const pages = rootPages.length ? ` (${rootPages.length} home page checked too)` : '';
console.log(`ok: ${jsFiles.length} js files parse; all imports and html references resolve${pages}`);
