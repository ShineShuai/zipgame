// The token contract a theme is held to, at the moment it is built (themes/tools) and again when the app receives it:
// the template tokens (what a theme may vary besides colour), their defaults (the same as css/theme.css gives light and dark;
// themes/tools/test.mjs checks), their kinds and bounds. The bounds keep touch targets and layouts intact whoever made the bundle.
// `base: true` marks tokens theme.css already had before templates (a theme may restyle them).

export const SYSTEM_FONTS = '"PingFang SC", "Microsoft YaHei", "Noto Sans", sans-serif';
export const BASE_FONT = `"Segoe UI", system-ui, -apple-system, ${SYSTEM_FONTS}`;

// name -> { d: default, kind, min, max, group }. kinds: len (px), radius (px or 999px), num, int, enum, font,
// shadow, gradient, colour. min/max are the bounds a theme may not leave (they keep touch targets and layouts intact).
export const TOKENS = {
  '--font-body': { d: BASE_FONT, kind: 'font', group: 'type' },
  '--font-head': { d: 'var(--font-body)', kind: 'font', group: 'type' },
  '--font-num': { d: 'var(--font-body)', kind: 'font', group: 'type' },
  '--fw-head': { d: '700', kind: 'int', min: 500, max: 900, group: 'type' },
  '--tt-head': { d: 'none', kind: 'enum', values: ['none', 'uppercase'], group: 'type' },
  '--ls-head': { d: '0em', kind: 'len', unit: 'em', min: -0.05, max: 0.15, group: 'type' },

  '--r-1': { d: '12px', kind: 'radius', max: 28, group: 'shape' },   // selects, notes, tips
  '--r-2': { d: '14px', kind: 'radius', max: 28, group: 'shape' },   // buttons, popovers
  '--r-tile': { d: '16px', kind: 'radius', max: 28, group: 'shape' }, // variant tiles and small cards (follows --r-2 when a theme sets only that)
  '--r-3': { d: '20px', kind: 'radius', max: 40, group: 'shape' },   // cards, dialogs
  '--r-4': { d: '24px', kind: 'radius', max: 40, group: 'shape' },   // bottom sheets
  '--r-chip': { d: '999px', kind: 'radius', max: 28, group: 'shape' }, // badges, tabs, stat pills
  '--r-icon': { d: '999px', kind: 'radius', max: 28, group: 'shape' }, // round icon buttons
  '--bw': { d: '2px', kind: 'len', min: 0, max: 3, group: 'shape' },       // controls
  '--bw-card': { d: '1px', kind: 'len', min: 0, max: 3, group: 'shape' },  // cards and popovers
  '--shadow-btn': { d: 'none', kind: 'shadow', group: 'shape' },
  // elevation tokens that css/theme.css already defines; a theme may restyle them (still plain shadows)
  '--shadow': { d: 'none', kind: 'shadow', group: 'shape', base: true },
  '--pop-shadow': { d: 'none', kind: 'shadow', group: 'shape', base: true },
  '--sheet-shadow': { d: 'none', kind: 'shadow', group: 'shape', base: true },

  '--bar-h': { d: '58px', kind: 'len', min: 48, max: 72, group: 'size' },
  '--icon-btn': { d: '40px', kind: 'len', min: 36, max: 48, group: 'size' },
  '--glyph': { d: '20px', kind: 'len', min: 16, max: 26, group: 'size' },
  '--icon-stroke': { d: '2', kind: 'num', min: 1.5, max: 3, group: 'size' },
  '--logo': { d: '34px', kind: 'len', min: 28, max: 44, group: 'size' },
  '--ctl-h': { d: '46px', kind: 'len', min: 40, max: 56, group: 'size' },
  '--vi-scale': { d: '1', kind: 'num', min: 0.8, max: 1.3, group: 'size' },
  '--tile-min': { d: '140px', kind: 'len', min: 96, max: 180, group: 'size' },
  '--pad': { d: '20px', kind: 'len', min: 12, max: 28, group: 'size' },
  '--gap': { d: '12px', kind: 'len', min: 8, max: 18, group: 'size' },

  '--bg-image': { d: 'none', kind: 'gradient', group: 'decor' },

  // board numbers: idle disc, visited disc; path highlight and tile depth (a lower edge under each tile)
  '--b-num-ring': { d: 'var(--b-num)', kind: 'colour', group: 'board' },
  '--b-numv-fill': { d: 'var(--b-num)', kind: 'colour', group: 'board' },
  '--b-numv-ring': { d: 'var(--b-numv-fill)', kind: 'colour', group: 'board' },
  '--b-path-hi': { d: 'var(--b-path)', kind: 'colour', group: 'board' },
  '--b-depth': { d: 'transparent', kind: 'colour', group: 'board' },

  // icon set colours (the theme's art.js uses only these, currentColor and --ic-paper)
  '--ic-1': { d: 'var(--accent)', kind: 'colour', group: 'icons' },
  '--ic-2': { d: 'var(--orange)', kind: 'colour', group: 'icons' },
  '--ic-3': { d: 'var(--green)', kind: 'colour', group: 'icons' },
  '--ic-4': { d: 'var(--b-red)', kind: 'colour', group: 'icons' },
  '--ic-5': { d: 'var(--violet)', kind: 'colour', group: 'icons' },
  '--ic-ink': { d: 'var(--icon-ink)', kind: 'colour', group: 'icons' },
  '--ic-paper': { d: 'var(--icon-tile)', kind: 'colour', group: 'icons' },
  '--ic-shadow': { d: 'transparent', kind: 'colour', group: 'icons' },

  // the variant tiles of a coloured picker cycle through these four: fill, ink on it, and the counter-tone the
  // icon's second colour (--ic-2) takes on that tile
  ...Object.fromEntries([1, 2, 3, 4].flatMap(k => [
    [`--vt-${k}`, { d: 'var(--surface-2)', kind: 'colour', group: 'tiles' }],
    [`--vt-${k}-on`, { d: 'var(--heading)', kind: 'colour', group: 'tiles' }],
    [`--vt-${k}-counter`, { d: 'var(--surface)', kind: 'colour', group: 'tiles' }],
  ])),
};

const COLOUR = '(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\\([\\d\\s.,%]+\\)|transparent|var\\(--[\\w-]+\\)'
  + '|color-mix\\(in srgb, (?:var\\(--[\\w-]+\\)|#[0-9a-f]{3,8}) \\d+%, (?:var\\(--[\\w-]+\\)|#[0-9a-f]{3,8}|transparent)\\))';
const LEN = '-?[\\d.]+(?:px)?';
const SHADOW_LAYER = new RegExp(`^(?:inset\\s+)?(?:${LEN}\\s+){1,3}${LEN}\\s+${COLOUR}$`, 'i');
export const COLOUR_RE = new RegExp(`^${COLOUR}$`, 'i');
const splitTop = s => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return [...out, cur.trim()];
};

// Problems of one `value` for token `name` (empty array = fine). `fonts`: families the theme ships.
export function checkValue(name, value, spec = TOKENS[name], fonts = []) {
  if (!spec) return [`${name}: not a template token`];
  const bad = msg => [`${name}: ${msg} (${value})`];
  const num = v => parseFloat(v);
  switch (spec.kind) {
    case 'colour': return COLOUR_RE.test(value) ? [] : bad('not a colour');
    case 'len': case 'num': case 'int': {
      if (!/^-?[\d.]+(px|em)?$/.test(value)) return bad('not a number or length');
      const n = num(value);
      if (spec.min !== undefined && n < spec.min) return bad(`below ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) return bad(`above ${spec.max}`);
      return [];
    }
    case 'radius': {
      if (value === '999px') return [];
      return /^[\d.]+px$/.test(value) && num(value) <= spec.max ? [] : bad(`0..${spec.max}px or 999px`);
    }
    case 'enum': return spec.values.includes(value) ? [] : bad(`one of ${spec.values.join(', ')}`);
    case 'font': {
      if (!/^[\w\s,"'.()-]+$/.test(value) || /url|expression/i.test(value)) return bad('not a plain font stack');
      const families = [...value.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      const unknown = families.filter(f => !fonts.includes(f) && !SYSTEM_FONTS.includes(f)
        && !['Segoe UI', 'Trebuchet MS', 'Rockwell', 'Futura', 'Century Gothic', 'Nunito'].includes(f));
      return unknown.length ? bad(`family not shipped by the theme: ${unknown.join(', ')}`) : [];
    }
    case 'shadow': {
      if (value === 'none') return [];
      return splitTop(value).every(l => SHADOW_LAYER.test(l)) ? [] : bad('not a plain shadow');
    }
    case 'gradient': {
      if (value === 'none') return [];
      return /^(?:repeating-)?(?:linear|radial)-gradient\(/.test(value) && !/url\(/i.test(value)
        ? [] : bad('none or a CSS gradient (no url())');
    }
    default: return bad('unknown kind');
  }
}

// ---- the tokens of a bundle ----
export const NAME_RE = /^--[a-z][a-z0-9-]{0,30}$/;
const UNSAFE = /url\s*\(|@import|expression|javascript:|[{};<>\\]/i;

// The tokens of `raw` ({ '--name': 'value' }) that may be applied. `rejected`: names with a value that is not allowed
// (out of bounds, not a plain colour, a url() ...); `ignored`: names this app does not know (`known(name)`), which a newer
// theme may carry. A template token is held to TOKENS; every other (colour) token must be a colour. `fonts`: the families
// the bundle ships.
export function cleanTokens(raw, { fonts = [], known = () => true } = {}) {
  const tokens = {};
  const rejected = [];
  const ignored = [];
  if (!raw || typeof raw !== 'object') return { tokens, rejected, ignored };
  for (const [name, value] of Object.entries(raw)) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!NAME_RE.test(name)) { rejected.push(name); continue; }
    if (!(name in TOKENS) && !known(name)) { ignored.push(name); continue; }
    const spec = TOKENS[name];
    const bad = !v || v.length > 300 || UNSAFE.test(v) || (spec ? checkValue(name, v, spec, fonts).length > 0 : !COLOUR_RE.test(v));
    if (bad) rejected.push(name); else tokens[name] = v;
  }
  return { tokens, rejected, ignored };
}

// The one rule that makes a bundle's tokens apply: they win over css/theme.css by their selector (0,2,0 against 0,1,0).
export const buildCss = (id, mode, tokens) =>
  `:root[data-theme="${id}"]{color-scheme:${mode};${Object.entries(tokens).map(([n, v]) => `${n}:${v};`).join('')}}`;
