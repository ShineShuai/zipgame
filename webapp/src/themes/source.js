// Where an offered theme comes from: a plain file. The bundle of a theme offered at an event is `<token>.json` in the offers folder
// (config.js THEMES.offers), published by themes/tools/publish.mjs under a random 128-bit token and removed when the event is over. There
// is no index, no catalog and no list in the app: a page can only fetch a token it was handed, so a player never learns the address of a
// theme that was not offered to them. (Which token a player is handed, and when, is the offer mechanism's job; it hands it to `offer`.)
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const MAX_FILE = 220 * 1024;

// fetchText(url) -> Promise<string>; injected, so the logic is testable. bundle(token) resolves to the parsed JSON (not yet validated:
// controller.trial does that) or null: not a token, not there (an offer that is over is a 404), too big, not JSON.
export function createSource({ base, fetchText }) {
  return {
    async bundle(token) {
      if (!TOKEN_RE.test(token ?? '')) return null;
      try {
        const text = await fetchText(`${base}${token}.json`);
        return typeof text === 'string' && text.length <= MAX_FILE ? JSON.parse(text) : null;
      } catch { return null; }
    },
  };
}

// The page's own fetch. `no-store`: an offer that has ended must not come back from a cache, and none is kept here.
export const browserSource = (base, fetchFn = (...a) => fetch(...a)) => createSource({
  base,
  fetchText: async url => {
    const response = await fetchFn(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok || Number(response.headers?.get?.('content-length')) > MAX_FILE) throw new Error(`offer: ${response.status}`);
    return response.text();
  },
});
