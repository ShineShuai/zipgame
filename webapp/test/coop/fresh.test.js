import test from 'node:test';
import assert from 'node:assert/strict';
import { importsOf, refreshModules, wasReloaded } from '../../src/coop/fresh.js';

// The sources below are text, not imports of this file (test/check.js reads the imports).
const IMPORT = 'import';
const EXPORT = 'export';
const lines = (...rows) => rows.join('\n');

test('importsOf: static, side-effect, re-exported, multi-line, dynamic; no packages', () => {
  const source = lines(
    `${IMPORT} a from './a.js';`,
    `${IMPORT} { b, c } from "../core/b.js";`,
    `${IMPORT} {`,
    '  d,',
    '  e,',
    `} from './d.js';`,
    `${IMPORT} './side.js';`,
    `${EXPORT} { f } from './f.js';`,
    `${EXPORT} * from '/abs/g.js';`,
    `${IMPORT} node from 'node:fs';`,
    `const lazy = () => ${IMPORT}('./lazy.js');`,
    `${EXPORT} const text = '${IMPORT} x from "./not-found.js"'.length;`,
  );
  assert.deepEqual(importsOf(source).sort(), [
    '../core/b.js', './a.js', './d.js', './f.js', './lazy.js', './side.js', '/abs/g.js',
  ].sort());
  assert.deepEqual(importsOf('export const answer = 42;'), []);
});

test('refreshModules fetches the entry and everything it imports, afresh, each once', async () => {
  const files = {
    'http://x/src/coop/app.js': lines(`${IMPORT} './screen.js';`, `${IMPORT} '../core/rules.js';`),
    'http://x/src/coop/screen.js': lines(
      `${IMPORT} { a } from './app.js';`,
      `${IMPORT}('./lazy.js');`,
    ),
    'http://x/src/core/rules.js': 'export const rules = 1;',
    'http://x/src/coop/lazy.js': 'export const lazy = 1;',
  };
  const asked = [];
  const fetcher = async (url, options) => {
    asked.push([url, options.cache]);
    return files[url] === undefined
      ? { ok: false } : { ok: true, text: async () => files[url] };
  };
  const done = await refreshModules('http://x/src/coop/app.js', fetcher);
  assert.deepEqual(done.sort(), Object.keys(files).sort());
  assert.equal(asked.length, 4); // the cycle app > screen > app is followed once
  assert.ok(asked.every(([, cache]) => cache === 'reload'));
});

test('a module that cannot be fetched is skipped, not fatal', async () => {
  const fetcher = async url => {
    if (url.endsWith('bad.js')) {
      throw new Error('offline');
    }
    const text = url.endsWith('app.js') ? `${IMPORT} './bad.js'` : '';
    return { ok: true, text: async () => text };
  };
  const done = await refreshModules('http://x/app.js', fetcher);
  assert.deepEqual(done.sort(), ['http://x/app.js', 'http://x/bad.js']);
});

test('outside a browser nothing was reloaded', () => {
  assert.equal(wasReloaded(), false);
});
