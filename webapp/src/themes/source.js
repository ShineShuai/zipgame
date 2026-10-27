// Where the themes of the pool come from: plain static files in one folder (config.js THEMES), built by CI (themes/tools/build-site.mjs).
//   <pool>        the manifest: one entry per theme (the metadata the picker draws, `f`, and `live`)
//   <f>.json      the bundle of a theme; `f` is a hash of its content, so a name cannot be guessed and a changed theme is a new file
// The app knows no theme and no file name: it reads the manifest only when an event fires (themes().event) or the dev reveal is on.
// This hides the files, it does not protect them: anyone who reads the code and the repository can find them.
import { cleanEntry } from './pool.js';

export const FILE_RE = /^[0-9a-f]{24}$/;
export const MAX_FILE = 220 * 1024;
export const MAX_POOL = 64 * 1024;
export const MAX_THEMES = 64;

// The manifest text's JSON -> [{ entry, f, live }] (entry as pool.cleanEntry makes it), or null when it is not a manifest. Entries that are
// not themes, repeat an id, shadow a built-in or name a malformed file are dropped. `live: false` marks a draft (dev reveal only).
export function cleanPool(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [];
  for (const x of raw.slice(0, MAX_THEMES)) {
    const entry = cleanEntry(x);
    if (!entry || entry.builtin || !FILE_RE.test(x.f ?? '') || list.some(c => c.entry.id === entry.id)) continue;
    list.push({ entry, f: x.f, live: x.live !== false });
  }
  return list;
}

// fetchText(url, kind) -> Promise<string>; injected, so the logic is testable. kind: 'pool' | 'bundle'.
//   pool()   -> [{ entry, f, live }] or null (not there, too big, not JSON, not a manifest)
//   bundle(f) -> the parsed JSON (not yet validated: controller.trial does that) or null (malformed name, not there, too big, not JSON)
export function createSource({ base, pool, fetchText }) {
  const get = async (name, kind, limit) => {
    try {
      const text = await fetchText(`${base}${name}`, kind);
      return typeof text === 'string' && text.length <= limit ? JSON.parse(text) : null;
    } catch { return null; }
  };
  return {
    pool: async () => cleanPool(await get(pool, 'pool', MAX_POOL)),
    bundle: async f => (FILE_RE.test(f ?? '') ? get(`${f}.json`, 'bundle', MAX_FILE) : null),
  };
}

// The page's own fetch. The manifest is revalidated on every read (a new deployment shows at once); a bundle never changes under its name.
export const browserSource = ({ base, pool }, fetchFn = (...a) => fetch(...a)) => createSource({
  base,
  pool,
  fetchText: async (url, kind) => {
    const response = await fetchFn(url, { cache: kind === 'pool' ? 'no-cache' : 'default', credentials: 'omit' });
    if (!response.ok || Number(response.headers?.get?.('content-length')) > (kind === 'pool' ? MAX_POOL : MAX_FILE)) throw new Error(`themes: ${response.status}`);
    return response.text();
  },
});
