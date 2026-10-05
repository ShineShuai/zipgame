// Node-only: the report HTML is the store (JSON embedded in the page), re-rendered from the template on every write.
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { emptyStore, serializeStore, SCHEMA } from './results.js';

const here = name => new URL(name, import.meta.url);
const DATA = /(<script type="application\/json" id="bench-data">)([\s\S]*?)(<\/script>)/;

export function readStore(file) {
  if (!existsSync(file)) {
    return emptyStore();
  }
  const match = DATA.exec(readFileSync(file, 'utf8'));
  if (!match) {
    throw new Error(`${file}: no embedded bench-data`);
  }
  const store = JSON.parse(match[2]);
  if (store.schema !== SCHEMA) {
    throw new Error(`${file}: schema ${store.schema}, expected ${SCHEMA}`);
  }
  return store;
}

export function renderReport(store) {
  const model = readFileSync(here('./results.js'), 'utf8').replace(/^export /gm, '');
  return readFileSync(here('./report.template.html'), 'utf8')
    .replace('/*@MODEL@*/', () => model)
    .replace('@@DATA@@', () => serializeStore(store));
}

export function writeStore(file, store) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, renderReport(store));
  renameSync(temp, file);
}

export const DEFAULT_REPORT = fileURLToPath(here('./report.html'));
