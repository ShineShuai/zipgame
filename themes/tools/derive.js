// theme.json (seeds + vars) -> the complete token map of one theme. Pure functions: gen.mjs writes the CSS,
// test.mjs checks it. A theme states ~25 seed colours and the shape/size/type values it varies;
// everything else (tonal fills, hover states, status colours, 3D tints, ...) is derived, then every foreground the
// contrast pairs (schema.js PAIRS) constrain is nudged until it passes, and each nudge is reported.
import {
  contrast, ensure, isHex, mix, onColour, rgba,
} from './color.js';
import { PAIRS, TOKENS, checkValue } from './schema.js';

// The tokens of css/theme.css: { light: {...}, dark: {...} } (dark is complete: the light values it does not override).
export function parseBase(css) {
  const block = selector => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  };
  const light = block(':root');
  return { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };
}

// Resolves var(--x) chains inside one token map.
export function resolve(map, name) {
  let v = map[name];
  for (let i = 0; i < 6 && typeof v === 'string' && v.startsWith('var('); i++) v = map[v.slice(4, -1)] ?? map[v.slice(4).split(/[,)]/)[0]];
  return v;
}

export function derive(theme, base) {
  const { mode, seeds: S, vars = {} } = theme;
  const dark = mode === 'dark';
  const out = { ...base[mode] };
  const notes = [];
  const fix = (name, fg, bgs, min) => {
    const v = ensure(fg, bgs, min);
    if (v !== fg) notes.push(`${name}: ${fg} -> ${v} (${min}:1 on ${bgs.join(', ')})`);
    return v;
  };

  const { bg, surface, ink } = S;
  const surface2 = S.surface2 ?? mix(surface, ink, dark ? 0.07 : 0.04);
  const line = S.line ?? mix(surface, ink, dark ? 0.16 : 0.10);
  const lineStrong = S.lineStrong ?? mix(surface, ink, dark ? 0.30 : 0.22);
  const accentSoft = S.accentSoft ?? mix(surface, S.accent, dark ? 0.26 : 0.14);
  const grounds = [surface, surface2, bg];

  Object.assign(out, {
    '--bg': bg,
    '--bg-top': S.bgTop ?? mix(bg, dark ? '#ffffff' : S.accent, dark ? 0.05 : 0.08),
    '--surface': surface,
    '--surface-2': surface2,
    '--line': line,
    '--line-strong': lineStrong,
    '--text': fix('--text', ink, grounds, 4.5),
    '--heading': fix('--heading', S.heading ?? ink, grounds, 4.5),
    '--muted': fix('--muted', S.muted, grounds, 4.5),
    '--accent': S.accent,
    '--accent-hover': mix(S.accent, dark ? '#ffffff' : '#000000', 0.12),
    '--accent-soft': accentSoft,
    '--accent-text': fix('--accent-text', S.accentText ?? S.accent, [surface, surface2, accentSoft], 4.5),
    '--on-accent': fix('--on-accent', S.onAccent ?? onColour(S.accent), [S.accent], 4.5),
    '--danger': fix('--danger', out['--danger'], [surface], 4.5),
    '--orange': S.orange,
    '--on-orange': fix('--on-orange', S.onOrange ?? ink, [S.orange], 4.5),
    '--glass': rgba(surface, 0.86),
    '--pop-bg': S.popBg ?? (dark ? surface2 : surface),
    '--radius': 'var(--r-3)',
  });

  // board
  const tile = S.tile;
  Object.assign(out, {
    '--b-bg': tile,
    '--b-stage': S.stage ?? bg,
    '--b-frame': S.frame ?? lineStrong,
    '--b-grid': S.tileEdge,
    '--b-outline': S.outline ?? lineStrong,
    '--b-wall': fix('--b-wall', S.wall, [tile], 3),
    '--b-path': fix('--b-path', S.path, [tile], 3),
    '--b-path-hi': fix('--b-path-hi', S.pathHi ?? S.path, [tile], 3),
    '--b-halo': tile,
    '--b-num-fill': S.numFill,
    '--b-num': fix('--b-num', S.numText, [S.numFill], 4.5),
    '--b-num-ring': S.numRing ?? S.numText,
    '--b-numv-fill': S.numvFill,
    '--b-numv-ring': S.numvRing ?? S.numvFill,
    '--b-num-on': fix('--b-num-on', S.numvText, [S.numvFill], 4.5),
    '--b-wrong': fix('--b-wrong', out['--b-wrong'], [tile], 3),
    '--b-hint': S.orange,
    '--b-red': fix('--b-red', S.red ?? out['--b-red'], [tile], 3),
    '--b-blue': fix('--b-blue', S.blue ?? out['--b-blue'], [tile], 3),
    '--b-depth': S.depth ?? 'transparent',
  });

  // the classic icon set (art/base) and the 3D views follow the theme's colours
  Object.assign(out, {
    '--icon-plate': mix(surface, S.accent, dark ? 0.22 : 0.12),
    '--icon-tile': tile,
    '--icon-line': S.tileEdge,
    '--icon-path': S.orange,
    '--icon-dot': S.accent,
    '--icon-ink': ink,
    '--logo-plate': 'var(--icon-plate)',
    '--logo-tile': 'var(--icon-tile)',
    '--logo-line': 'var(--icon-line)',
    '--logo-path': 'var(--icon-path)',
    '--logo-dot': 'var(--icon-dot)',
    '--sf-line': lineStrong,
    '--sf-disc': surface2,
    '--sf-disc-line': lineStrong,
    '--sf-mark': fix('--sf-mark', S.orange, [surface], 3),
    '--sf-tag-bg': out['--warn-bg'],
    '--sf-cut': S.orange,
    '--sf-mini-bg': rgba(surface, 0.9),
    '--sf-mini-line': line,
  });

  // the icon set of the theme's art.js, and the variant-tile palette of a bento picker
  const ic = S.icons ?? [];
  ic.forEach((c, i) => { out[`--ic-${i + 1}`] = c; });
  if (S.iconInk) out['--ic-ink'] = S.iconInk;
  if (S.iconPaper) out['--ic-paper'] = S.iconPaper;
  if (S.iconShadow) out['--ic-shadow'] = S.iconShadow;
  (S.vt ?? []).forEach(([fill, on, counter], i) => {
    out[`--vt-${i + 1}`] = fill;
    out[`--vt-${i + 1}-on`] = fix(`--vt-${i + 1}-on`, on, [fill], 4.5);
    if (counter) out[`--vt-${i + 1}-counter`] = counter;
  });

  // new tokens: schema default, then the theme's own value
  for (const [name, spec] of Object.entries(TOKENS)) if (!(name in out)) out[name] = spec.d;
  if (vars['--r-2'] && !vars['--r-tile']) out['--r-tile'] = vars['--r-2'];
  Object.assign(out, vars);
  return { tokens: out, notes };
}

// Contrast failures of the pairs (after derive's own nudging these are the ones it could not fix).
export function audit(tokens) {
  const fails = [];
  const rows = [];
  for (const [fg, bg, min] of PAIRS) {
    const [a, b] = [resolve(tokens, fg), resolve(tokens, bg)];
    if (!isHex(a ?? '') || !isHex(b ?? '')) { fails.push(`${fg} on ${bg}: not a plain hex (${a}, ${b})`); continue; }
    const ratio = contrast(a, b);
    rows.push({ fg, bg, min, ratio });
    if (ratio < min) fails.push(`${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}`);
  }
  return { fails, rows };
}

// Every token the theme sets that is a template token must be in bounds; colour tokens of css/theme.css must exist.
export function validate(theme, tokens, base, fonts = []) {
  const problems = [];
  for (const name of Object.keys(base.light)) if (!(name in tokens)) problems.push(`${name}: missing`);
  for (const [name, value] of Object.entries(theme.vars ?? {})) problems.push(...checkValue(name, value, undefined, fonts));
  for (const name of Object.keys(TOKENS)) {
    if (name in tokens) problems.push(...checkValue(name, tokens[name], undefined, fonts));
  }
  return problems;
}
