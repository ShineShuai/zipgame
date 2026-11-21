// Installs Cloudflare Web Analytics (a cookieless visit counter) by hand into the staged pages
// that count visits, and lets the CSP of the page load it. Called by stage-prod.sh, never on
// the source pages.
//   node add-beacon.mjs SITE_DIR CONFIG      SITE_DIR: the staged site (dist/zigzag)
// CONFIG is analytics.json: { "token": "" }. An empty token is off: nothing is touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';
const REPORT = 'https://cloudflareinsights.com';
const PAGES = ['index.html', 'webapp/index.html'];
const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;

/** Adds a source to a directive of a policy; fails when the directive is missing. */
export function allow(policy, directive, source) {
  const parts = policy.split(';').map((d) => d.trim());
  const at = parts.findIndex((d) => d.split(/\s+/)[0] === directive);
  if (at < 0) throw new Error(`the CSP has no ${directive}`);
  parts[at] += ` ${source}`;
  return parts.join('; ');
}

/** The page with the tag before </body>; its CSP meta (if any) lets the script and report in. */
export function install(html, token) {
  if (html.includes('cloudflareinsights')) throw new Error('the page has the tag already');
  if (html.split('</body>').length !== 2) throw new Error('the page needs exactly one </body>');
  const attrs = `src="${BEACON}" data-cf-beacon='{"token": "${token}"}'`;
  const tag = `<script type="module" ${attrs}></script>`;
  return html.replace('</body>', () => `${tag}\n</body>`).replace(CSP_META, (_, pre, csp, post) =>
    pre + allow(allow(csp, 'script-src', BEACON), 'connect-src', REPORT) + post);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, config] = process.argv.slice(2);
  if (!dir || !config) throw new Error('usage: add-beacon.mjs SITE_DIR CONFIG');
  const { token = '' } = JSON.parse(readFileSync(config, 'utf8'));
  if (typeof token !== 'string' || (token && !/^[0-9a-z]{16,64}$/i.test(token))) {
    throw new Error(
      `${config}: token must be empty (off) or the snippet token, 16-64 letters and digits`);
  }
  if (!token) console.log('Web Analytics off (no token)');
  else {
    for (const page of PAGES) {
      const file = join(dir, page);
      writeFileSync(file, install(readFileSync(file, 'utf8'), token));
    }
    console.log(`Web Analytics tag in ${PAGES.join(', ')}`);
  }
}
