// Sanitizer for the SVG a theme brings (the symbol, the brand mark, the variant icons). Themes are data, but the data
// comes over the network and is stored in localStorage, so it is rebuilt from a whitelist rather than trusted:
// shapes only, no ids, no style, no links, no script, no url(). Anything else rejects the whole piece (null), and
// the caller falls back to the classic art.
const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'clip-rule',
  'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'viewBox', 'role', 'aria-label', 'aria-hidden', 'focusable',
]);
const SAFE_VALUE = /^[\w\s.,#%()+*/:-]*$/;
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/y;

// The markup rebuilt from the whitelist, or null. `maxLength` bounds the input.
export function cleanSvg(markup, maxLength = 20000) {
  if (typeof markup !== 'string' || markup.length > maxLength) return null;
  const out = [];
  const stack = [];
  let i = 0;
  while (i < markup.length) {
    if (markup[i] !== '<') {
      if (/\S/.test(markup[i])) return null; // text nodes are not allowed
      i++;
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
        if (!ATTRS.has(key) || !SAFE_VALUE.test(value) || /url\(|javascript|expression/i.test(value)) return null;
        kept.push(`${key}="${value}"`);
      }
      out.push(`<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${self ? '/' : ''}>`);
      if (!self) stack.push(name);
    }
    i += whole.length;
  }
  return stack.length ? null : out.join('');
}

// The inside of an svg (a symbol, an icon): the same rules.
export const cleanInner = (markup, maxLength = 6000) => cleanSvg(markup, maxLength);
