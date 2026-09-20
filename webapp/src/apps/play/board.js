import { wallSegments, cellCenter, pathD } from '../../view/geometry.js';

export const CELL = 60; // logical units; on-screen size comes from viewBox scaling

// Full SVG markup for the play board (S = play state).
export function boardSvg(S) {
  const p = S.puzzle, n = p.n, s = CELL, size = n * s, inPath = new Set(S.path), ctr = i => cellCenter(n, i, s);
  let h = `<svg viewBox="0 0 ${size} ${size}" class="zip-svg" style="touch-action:none;cursor:pointer;background:#fafafa;border-radius:8px;width:100%;height:auto;max-width:${Math.min(480, size)}px;display:block;margin:0 auto">`;
  for (let i = 0; i <= n; i++) h += `<line x1="0" y1="${i * s}" x2="${size}" y2="${i * s}" stroke="#ddd"/><line x1="${i * s}" y1="0" x2="${i * s}" y2="${size}" stroke="#ddd"/>`;
  for (const [x1, y1, x2, y2] of wallSegments(p, s)) h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round"/>`;
  h += `<path data-role="path" d="${S.path.length > 1 ? pathD(n, S.path, s) : ''}" stroke="#1a1a1a" stroke-width="${s * 0.28}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  for (let i = 0; i < n * n; i++) {
    const v = p.cp[i]; if (!v) continue;
    const [x, y] = ctr(i), f = inPath.has(i);
    h += `<g data-num-cell="${i}"><circle cx="${x}" cy="${y}" r="${s * 0.32}" fill="${f ? '#1a1a1a' : '#fff'}" stroke="#1a1a1a" stroke-width="2"/>` +
      `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="${s * 0.32}" fill="${f ? '#fff' : '#1a1a1a'}" font-weight="600">${v}</text></g>`;
  }
  if (S.hintWrongCell != null) { // red X on the first wrong move
    const [x, y] = ctr(S.hintWrongCell), d = s * 0.22;
    h += `<g data-role="hint-wrong" stroke="#d1352b" stroke-width="5" stroke-linecap="round"><line x1="${x - d}" y1="${y - d}" x2="${x + d}" y2="${y + d}"/><line x1="${x - d}" y1="${y + d}" x2="${x + d}" y2="${y - d}"/></g>`;
  }
  if (S.hintCell != null) { // pulsing ring on the correct move
    const [x, y] = ctr(S.hintCell);
    h += `<circle data-role="hint" cx="${x}" cy="${y}" r="${s * 0.4}" fill="none" stroke="#e0a000" stroke-width="4" stroke-dasharray="6 4"><animate attributeName="r" values="${s * 0.36};${s * 0.44};${s * 0.36}" dur="1s" repeatCount="indefinite"/></circle>`;
  }
  return h + '</svg>';
}
