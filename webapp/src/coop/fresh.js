// A hard reload (Cmd+Shift+R) makes the browser skip its cache, but only for what the page loads
// until its load event. The trial's modules are imported later, when the hidden things are first
// revealed, so they came from the cache all the same, old copies included, and mixed with new
// ones: "the puzzle could not be made" from a new screen.js and an old drawing.js, for a while.
// So after a reload the loader (boot.js) first fetches every module of the trial afresh
// (cache: 'reload'), which also puts the new copies in the cache that the import() then reads.
// Best effort: a module that cannot be fetched is left to the import. (The import statements of
// this code base start a line, which keeps text that only looks like one from being fetched.)

const FROM = String.raw`^[ \t]*(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]`;
const DYNAMIC = String.raw`\bimport\(\s*['"]([^'"]+)['"]\s*\)`;
const SPECIFIER = new RegExp(`${FROM}|${DYNAMIC}`, 'gm');

// The relative modules that `source` imports, as specifiers.
export function importsOf(source) {
  const found = new Set();
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      found.add(specifier);
    }
  }
  return [...found];
}

// Fetches `entry` and everything it imports, afresh; resolves with the urls fetched.
export async function refreshModules(entry, fetcher = fetch) {
  const seen = new Set();
  let level = [entry];
  while (level.length) {
    const urls = level.filter(url => !seen.has(url));
    urls.forEach(url => seen.add(url));
    const next = await Promise.all(urls.map(async url => {
      try {
        const response = await fetcher(url, { cache: 'reload' });
        return response.ok ? importsOf(await response.text()).map(s => new URL(s, url).href) : [];
      } catch {
        return [];
      }
    }));
    level = next.flat();
  }
  return [...seen];
}

// Was this page loaded by a reload (soft or hard)?
export const wasReloaded = () => performance.getEntriesByType?.('navigation')[0]?.type === 'reload';
