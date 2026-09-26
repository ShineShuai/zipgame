import { encodeFlags, decodeFlags, flagsToHex, hexToFlags, DEFAULT_FLAGS_INT, PHASES } from '../../core/gen/flags.js';

// One phase row's checkboxes: prop/legCollide/pocket/parity/prune2 as checkboxes, seg as a 3-way
// select (off/next/all). Each checkbox/select carries data-phase + data-flag so the panel can read
// the whole row generically.
const PHASE_LABEL = { build: 'Build (makeUnique)', minimize: 'Minimize (per-wall check)', score: 'Score / Solve' };
const FLAG_LABEL = {
  prop: ['Propagation', 'Forced-edge deduction (prop) — same solutions, far fewer nodes.'],
  legCollide: ['Leg collision', 'Cross-leg collision check (legCollide) — catches some dead branches connectivity/dead-ends/forced-edges miss; pricier per node.'],
  pocket: ['Pocket', 'Single-entrance pocket check (pocket).'],
  parity: ['Parity', 'Bipartite slack check (parity).'],
  prune2: ['Distance bound', 'Static wall-aware distance bound to the remaining checkpoints (prune2).'],
};

function phaseRowHtml(side, phase) {
  const p = side ? `${side}-${phase}` : phase;
  const cb = f => `<label class="flag-cb" title="${FLAG_LABEL[f][1]}"><input class="flags-input" type="checkbox" data-phase="${p}" data-flag="${f}">${FLAG_LABEL[f][0]}</label>`;
  return `<div class="flags-phase-row">
    <div class="flags-phase-label">${PHASE_LABEL[phase]}</div>
    <div class="flags-phase-cbs">
      ${['prop', 'legCollide', 'pocket', 'parity', 'prune2'].map(cb).join('')}
      <label class="flag-cb" title="Per-segment must-pass-through blocker cells (seg): off, next segment only, or every remaining segment.">Seg
        <select class="flags-input" data-phase="${p}" data-flag="seg">
          <option value="off">off</option><option value="next">next</option><option value="all">all</option>
        </select>
      </label>
    </div>
  </div>`;
}

// Mounts a flags panel into `el`. side: '' for single mode, 'A'/'B' for compare mode (only affects
// element data-phase keys, so A and B don't collide when both are in the DOM at once).
// By default only the hex field is shown; the path/cps + 3 phase checkbox rows are collapsed
// behind one "Details" toggle shared by all of them (per panel — A and B each expand independently).
// Returns { get(): int, set(int), onChange(fn) }.
export function mountFlagsPanel(el, side, initial = DEFAULT_FLAGS_INT) {
  const s = side || '';
  el.innerHTML = `
    <div class="field field-row flags-hex-row">
      <label title="Packed algorithm-flags integer — paste one to reproduce a run exactly (with the same seed). Expand for the individual checkboxes.">Flags (hex)</label>
      <input type="text" class="flags-hex-input" spellcheck="false">
    </div>
    <button type="button" class="flags-expand-btn">▸ Details</button>
    <div class="flags-details" style="display:none">
      <div class="flags-pathcps">
        <label class="flag-cb" title="Hamiltonian-path search algorithm.">Path
          <select class="flags-input" data-phase="${s}" data-flag="path"><option value="warnsdorff">warnsdorff</option><option value="backbite">backbite</option></select>
        </label>
        <label class="flag-cb" title="Checkpoint placement algorithm.">Checkpoints
          <select class="flags-input" data-phase="${s}" data-flag="cps"><option value="gap">gap</option><option value="random">random</option></select>
        </label>
      </div>
      ${PHASES.map(ph => phaseRowHtml(s, ph)).join('')}
    </div>`;

  const q = sel => el.querySelector(sel);
  const inputs = [...el.querySelectorAll('.flags-input')];
  const hexInput = q('.flags-hex-input');
  const expandBtn = q('.flags-expand-btn');
  const details = q('.flags-details');
  expandBtn.onclick = () => {
    const open = details.style.display !== 'none';
    details.style.display = open ? 'none' : '';
    expandBtn.textContent = open ? '▸ Details' : '▾ Details';
  };
  let listeners = [];

  function read() {
    const byPhase = {};
    for (const ph of PHASES) byPhase[ph] = {};
    let path = 'warnsdorff', cps = 'gap';
    for (const inp of inputs) {
      const flag = inp.dataset.flag;
      if (flag === 'path') { path = inp.value; continue; }
      if (flag === 'cps') { cps = inp.value; continue; }
      const phase = inp.dataset.phase.replace(new RegExp(`^${s}-?`), '');
      byPhase[phase][flag] = flag === 'seg' ? (inp.value === 'off' ? false : inp.value) : inp.checked;
    }
    return encodeFlags({ ...byPhase, path, cps });
  }
  function write(v) {
    const d = decodeFlags(v);
    for (const inp of inputs) {
      const flag = inp.dataset.flag;
      if (flag === 'path') { inp.value = d.path; continue; }
      if (flag === 'cps') { inp.value = d.cps; continue; }
      const phase = inp.dataset.phase.replace(new RegExp(`^${s}-?`), '');
      const val = d[phase][flag];
      if (flag === 'seg') inp.value = val === 'all' ? 'all' : val ? 'next' : 'off';
      else inp.checked = !!val;
    }
    hexInput.value = flagsToHex(v);
  }

  write(initial);
  for (const inp of inputs) inp.addEventListener('change', () => { hexInput.value = flagsToHex(read()); listeners.forEach(fn => fn(read())); });
  hexInput.addEventListener('change', () => {
    const v = hexToFlags(hexInput.value);
    if (v == null) { hexInput.value = flagsToHex(read()); return; } // invalid text: revert, don't clobber the checkboxes
    write(v); listeners.forEach(fn => fn(v));
  });

  return { get: read, set: write, onChange: fn => listeners.push(fn) };
}
