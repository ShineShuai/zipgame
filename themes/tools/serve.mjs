// One command for looking at themes while writing them: packs them, then serves the repo root so that both pages work:
//   node themes/tools/serve.mjs [port]      (npm run themes:preview in webapp/)
//   http://localhost:8000/themes/preview/   the preview of every theme (the game's real controller on mock screens)
//   http://localhost:8000/webapp/           the game itself, with the site's theme files as CI builds them (hold V: every theme)
// To look at the deployed site instead, hold V there. A plain static server for development only: it serves the whole repo, so never
// run it on a public address.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_DIR, buildSite } from './build-site.mjs';
import { packAll } from './pack.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SITE = fileURLToPath(new URL('../out/site/', import.meta.url));   // the theme files, as CI builds them; served at /<SITE_DIR>/ (the page's ../t/)
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

export function serve(port = 8000) {
  return createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const root = url.startsWith(`/${SITE_DIR}/`) ? SITE : ROOT;
      let path = normalize(join(root, url));
      if (path !== root.slice(0, -1) && !path.startsWith(root)) { res.writeHead(403).end('no'); return; }   // never above the repo root
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end('not found'); }
  }).listen(port);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const port = Number(process.argv[2]) || 8000;
  if (packAll()) console.log('(some themes have problems: they are not in the preview)');
  try { buildSite(SITE, { log: () => {} }); } catch (e) { console.log(`(no theme files for the game: ${e.message})`); }
  serve(port).on('listening', () => console.log(`\nthemes preview: http://localhost:${port}/themes/preview/\nthe game:       http://localhost:${port}/webapp/`));
}
