import { wallCount } from '../../core/edges.js';
import { flagsToHex } from '../../core/gen/flags.js';
import { miniPreviewSvg, SOL_C } from './board.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const row = (label, a, b, indent) => `<tr><th${indent ? ' class="compare-sub"' : ''}>${esc(label)}</th><td>${a}</td><td>${b}</td></tr>`;

// r: runCompare()'s return value. flagsA/flagsB: the raw integers, for the header. tries: for the
// failure caption. Returns an HTML string for the #compareResult panel.
export function renderCompareHtml(r, flagsA, flagsB, tries) {
  const { a, b, msA, msB, seed } = r;
  const outcome = x => x.unique ? `unique, ${x.walls} wall${x.walls === 1 ? '' : 's'}` : `<span class="bad">FAILED</span> (${tries} retries)`;
  const table = `<table class="compare-table">
    <thead><tr><th></th><th>A · ${flagsToHex(flagsA)}</th><th>B · ${flagsToHex(flagsB)}</th></tr></thead>
    <tbody>
      ${row('Time', msA.toFixed(0) + 'ms', msB.toFixed(0) + 'ms')}
      ${row('Result', outcome(a), outcome(b))}
      ${row('Checkpoints', a.puzzle ? maxNumberSafe(a.puzzle) : '—', b.puzzle ? maxNumberSafe(b.puzzle) : '—')}
      ${row('Walls', a.puzzle ? wallCount(a.puzzle) : '—', b.puzzle ? wallCount(b.puzzle) : '—')}
      ${row('solve() calls total', a.counts.total.toLocaleString(), b.counts.total.toLocaleString())}
      ${row('in makeUnique (build)', a.counts.makeUnique.toLocaleString(), b.counts.makeUnique.toLocaleString(), true)}
      ${row('in minimizeWalls', a.counts.minimizeWalls.toLocaleString(), b.counts.minimizeWalls.toLocaleString(), true)}
      ${row('other (scoring)', a.counts.other.toLocaleString(), b.counts.other.toLocaleString(), true)}
      ${a.nodes != null || b.nodes != null ? row('Uniqueness-proof nodes', a.nodes != null ? a.nodes.toLocaleString() : '—', b.nodes != null ? b.nodes.toLocaleString() : '—') : ''}
    </tbody>
  </table>`;
  const previews = `<div class="compare-previews">
    <div class="compare-preview-col"><div class="compare-preview-label">A</div>${a.unique ? miniPreviewSvg(a.puzzle, a.puzzle.path, SOL_C[0]) : '<div class="compare-preview-empty">no puzzle</div>'}</div>
    <div class="compare-preview-col"><div class="compare-preview-label">B</div>${b.unique ? miniPreviewSvg(b.puzzle, b.puzzle.path, SOL_C[1]) : '<div class="compare-preview-empty">no puzzle</div>'}</div>
  </div>`;
  return `<div class="compare-seed">Compared at seed ${seed}</div>${table}${previews}`;
}
function maxNumberSafe(p) { let m = 0; for (const v of p.cp) if (v > m) m = v; return m; }
