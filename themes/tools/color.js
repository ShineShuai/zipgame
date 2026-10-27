// Colour maths for the theme generator and its tests: sRGB hex only, no dependencies.
export const rgb = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
export const toHex = ([r, g, b]) => '#' + [r, g, b]
  .map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const isHex = v => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

// t = 0 gives a, t = 1 gives b.
export const mix = (a, b, t) => {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

export const luminance = hex => {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

// `fg` moved toward black or white (whichever the backgrounds are farther from) in 2% steps until it
// reaches `min` against every colour in `bgs`. Returns `fg` itself when it already does.
export function ensure(fg, bgs, min) {
  const ok = c => bgs.every(bg => contrast(c, bg) >= min);
  if (ok(fg)) return fg;
  const light = bgs.reduce((sum, b) => sum + luminance(b), 0) / bgs.length > 0.179;   // above this black is the stronger text colour, below it white
  const target = light ? '#000000' : '#ffffff';
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = mix(fg, target, t);
    if (ok(c)) return c;
  }
  return target;
}

// The better of white and black as text on `bg`.
export const onColour = bg => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000');

export const rgba = (hex, alpha) => `rgba(${rgb(hex).join(', ')}, ${alpha})`;
