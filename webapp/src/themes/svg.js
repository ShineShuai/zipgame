// Sanitizer for the SVG a theme brings (the symbol, the brand mark, the variant icons). Themes are data, but the data
// comes over the network and is stored in localStorage, so it is rebuilt from a whitelist rather than trusted:
// shapes, paint servers and a few text labels only; no style (but one blend mode), no links, no script, no image. Anything else rejects
// the whole piece (null), and the caller falls back to the classic art.
//   - gradients, clip paths, patterns and a few filters (blur, noise and displacement for a hand-drawn edge) may be defined (<defs>, ids) and used with url(#id): a reference to an
//     element of the same piece, never to a url; the page makes the ids of every piece it draws unique (scopeIds)
//   - <text> holds a short label (a number, a letter), nothing else; it takes the page's font
const TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'pattern', 'filter', 'feGaussianBlur', 'feTurbulence', 'feDisplacementMap', 'text',
]);
const ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'clip-rule',
  'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'viewBox', 'role', 'aria-label', 'aria-hidden', 'focusable',
  'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'fx', 'fy', 'patternUnits',
  'patternTransform', 'clip-path', 'filter', 'stdDeviation', 'type', 'baseFrequency', 'numOctaves', 'seed', 'result', 'in', 'in2', 'scale', 'font-size', 'font-weight', 'text-anchor', 'dy', 'dx', 'shape-rendering', 'style',
]);
const URL_ATTRS = new Set(['fill', 'stroke', 'clip-path', 'filter']);   // where url(#id) may stand
const ID = /^[A-Za-z][\w-]{0,31}$/;
const REF = /^url\(#[A-Za-z][\w-]{0,31}\)$/;
const STYLE = /^mix-blend-mode:(multiply|screen|overlay|darken|lighten|soft-light|hard-light|color-dodge|color-burn|difference|exclusion);?$/;
const LABEL = /^[\w.]{1,4}$/;
const NAME = /^[A-Za-z][\w-]{0,15}$/;                 // a filter result and its inputs (SourceGraphic, ...)
const NOISE = /^(fractalNoise|turbulence)$/;
const SAFE_VALUE = /^[\w\s.,#%()+*/:;-]*$/;
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/y;

function cleanValue(key, value) {
  if (!SAFE_VALUE.test(value) || /javascript|expression|@import/i.test(value)) return false;
  if (key === 'id') return ID.test(value);
  if (key === 'type') return NOISE.test(value);
  if (key === 'result' || key === 'in' || key === 'in2') return NAME.test(value);
  if (key === 'style') return STYLE.test(value);
  if (/url\(/i.test(value)) return URL_ATTRS.has(key) && REF.test(value);
  return true;
}

// The markup rebuilt from the whitelist, or null. `maxLength` bounds the input.
export function cleanSvg(markup, maxLength = 20000) {
  if (typeof markup !== 'string' || markup.length > maxLength) return null;
  const out = [];
  const stack = [];
  let i = 0;
  while (i < markup.length) {
    if (markup[i] !== '<') {
      const end = markup.indexOf('<', i);
      const text = markup.slice(i, end < 0 ? markup.length : end);
      if (/\S/.test(text)) {
        if (stack[stack.length - 1] !== 'text' || !LABEL.test(text)) return null;   // text is a short label inside <text>, nowhere else
        out.push(text);
      }
      i += text.length;
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(markup);
    if (!m) return null;
    const [whole, close, name, attrs, self] = m;
    if (!TAGS.has(name)) return null;
    if (close) {
      if (stack.pop() !== name) return null;
      out.push(`</${name}>`);
    } else {
      const kept = [];
      for (const a of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        const [, key, value] = a;
        if (!ATTRS.has(key) || !cleanValue(key, value)) return null;
        kept.push(`${key}="${value}"`);
      }
      out.push(`<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${self ? '/' : ''}>`);
      if (!self) stack.push(name);
    }
    i += whole.length;
  }
  return stack.length ? null : out.join('');
}

// Makes the ids of a clean piece unique to one drawing of it: the same icon may be on the page twice (a menu and a list, one of them
// hidden), and a gradient that lives in a hidden svg does not paint. `scope` is any short word or number.
export const scopeIds = (markup, scope) => markup.replace(/\bid="([^"]+)"/g, `id="$1-${scope}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${scope})`);

let scopes = 0;
// A new scope word for scopeIds, different on every call.
export const freshScope = () => (scopes += 1).toString(36);

// The inside of an svg (a symbol, an icon): the same rules.
export const cleanInner = (markup, maxLength = 6000) => cleanSvg(markup, maxLength);
