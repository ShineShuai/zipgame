// Formats with Biome the JavaScript files that are new or changed since HEAD, and nothing else
// (npm run format:changed; npm run fix also wraps the comments, see test/check-width.js). After a
// patch from somebody else, the commit that formats then touches what the patch touched, not the
// files around it. Run by hand: no hook calls it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = args => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

// Paths relative to the current directory (webapp/), which is also where biome.json is.
const files = [
  ...new Set([
    ...git(['diff', '--relative', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]),
].filter(file => /\.m?js$/.test(file) && existsSync(file));

if (!files.length) {
  console.log('format:changed: no JavaScript file is new or changed since HEAD');
} else {
  console.log(`format:changed: ${files.length} files\n  ${files.join('\n  ')}`);
  const run = spawnSync(
    'biome',
    ['format', '--write', '--no-errors-on-unmatched', '--files-ignore-unknown=true', ...files],
    { stdio: 'inherit' },
  );
  process.exit(run.status ?? 1);
}
