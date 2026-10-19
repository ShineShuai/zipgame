// Generates the catalog of ball boards (src/core/surface/ball-catalog.js): convex polyhedra whose
// faces are triangles, squares and pentagons. A cell of the puzzle is a face; two cells are
// neighbours when the faces share a side (see src/core/surface/topology.js).
//   node tools/ball-catalog.mjs [--max-cells 100] [--depth 2] [--max-n 8] [--filter REGEX]
//                               [--write] [--check] [--force] [--prune]
// Candidates are the seed solids (Platonic, Archimedean, prisms, antiprisms, pyramids,
// bipyramids), and the operators dual, kis and snub applied to them (--depth times; snub only to
// a seed whose faces are all alike). Equal solids (same cell graph) are kept once.
// Every candidate is checked: it is a closed convex polyhedron; the cells of the same type
// (triangles, squares, pentagons) are congruent on the sphere (a ball with uneven cells, e.g. a
// pyramid on every face of a square pyramid, is not offered); and the board can be played (`ok`):
// a bipartite board needs colour classes that differ by at most 1, and a random search has to
// find a path through all cells. Without --write the table is only printed.
//   --write   add the new entries to the catalog file; entries already there are never changed
//             (cell numbers are in puzzles and share codes), a changed ring list is an error
//             unless --force
//   --prune   with --write: drop the entries of the catalog that are not generated any more
//   --check   regenerate and compare with the catalog file (exit 1 when it differs)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  meshOf,
  dual,
  kis,
  snub,
  isClosed,
  edgesOf,
  seeds,
  congruentByType,
  canonical,
  fnv,
} from './polyhedra.mjs';
import { BALL_CATALOG } from '../src/core/surface/ball-catalog.js';
import { buildBallTopology } from '../src/core/surface/topology.js';
import { GEN_CFG, randomHamiltonianPath } from '../src/core/surface/gen.js';
import { makeRng } from '../src/core/rng.js';

const FILE = fileURLToPath(new URL('../src/core/surface/ball-catalog.js', import.meta.url));
const args = process.argv.slice(2);
const has = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OPTS = {
  maxCells: Number(value('max-cells', 100)),
  depth: Number(value('depth', 2)),
  maxN: Number(value('max-n', 8)),
};

const NAMES = {
  'kis-tetra': 'triakis tetrahedron',
  'kis-cube': 'tetrakis hexahedron',
  'kis-octa': 'triakis octahedron',
  'kis-dodeca': 'pentakis dodecahedron',
  'kis-icosa': 'triakis icosahedron',
  'dual-cuboct': 'rhombic dodecahedron',
  'dual-icosidodeca': 'rhombic triacontahedron',
  'dual-rhombicuboct': 'deltoidal icositetrahedron',
  'dual-rhombicosidodeca': 'deltoidal hexecontahedron',
  'snub-cube': 'snub cube',
  'snub-dodeca': 'snub dodecahedron',
  'dual-snub-cube': 'pentagonal icositetrahedron',
  'dual-snub-dodeca': 'pentagonal hexecontahedron',
};

// ---------- candidates ----------

const faceCounts = rings => [3, 4, 5].map(k => rings.filter(ring => ring.length === k).length);
const cellsOf = (kind, mesh) => {
  const V = mesh.verts.length;
  const F = mesh.faces.length;
  const E = edgesOf(mesh.faces).length;
  return { dual: V, kis: 2 * E, snub: F + V + 2 * E }[kind];
};
const alike = mesh => mesh.faces.every(ring => ring.length === mesh.faces[0].length);

function usable(mesh) {
  return isClosed(mesh)
    && mesh.faces.length >= 4
    && mesh.faces.every(ring => ring.length >= 3 && ring.length <= 5)
    && mesh.planes.every(({ d }) => d > 0.05);
}

function* candidates() {
  const level = [];
  for (const [id, name, points] of seeds(OPTS.maxN)) {
    const mesh = meshOf(points);
    level.push({ id, name, mesh, seed: true });
    yield { id, name, mesh };
  }
  let frontier = level;
  for (let depth = 1; depth <= OPTS.depth; depth++) {
    const next = [];
    for (const parent of frontier) {
      const ops = {
        dual: () => dual(parent.mesh),
        kis: () => kis(parent.mesh),
        snub: () => (parent.seed && alike(parent.mesh) ? snub(parent.mesh) : null),
      };
      for (const [op, make] of Object.entries(ops)) {
        const cells = cellsOf(op, parent.mesh);
        if (op === 'snub' && !(parent.seed && alike(parent.mesh))) {
          continue;
        }
        if (cells > 2 * OPTS.maxCells || parent.id.startsWith(`${op}-`)) {
          continue;
        }
        const mesh = make();
        if (!mesh) {
          continue;
        }
        const id = `${op}-${parent.id}`;
        const item = { id, name: NAMES[id] ?? id.replace(/-/g, ' '), mesh };
        next.push(item);
        yield item;
      }
    }
    frontier = next;
  }
}

const round6 = x => Number(x.toFixed(6)) || 0;

// The corners of a mesh as unit vectors (the central projection onto the ball), 6 decimals.
function entryOf({ id, name, mesh }) {
  const v = mesh.verts.map(p => {
    const length = Math.hypot(...p);
    return p.map(x => round6(x / length));
  });
  const r = mesh.faces.map(ring => ring.slice());
  return { id, name, f: faceCounts(r), v, r };
}

// Whether the board can be played: { ok: true } or { ok: false, why }.
function playable(entry) {
  const top = buildBallTopology(entry);
  if (top.classes && Math.abs(top.classes[0] - top.classes[1]) > 1) {
    const [a, b] = top.classes;
    return { ok: false, why: `bipartite, ${a} and ${b} cells in the two classes` };
  }
  const cfg = { ...GEN_CFG, pathNodeCap: 50000, pathTries: 400 };
  if (!randomHamiltonianPath(top, makeRng(1), cfg)) {
    return { ok: false, why: 'no path through all cells found' };
  }
  return { ok: true };
}

function generate() {
  const entries = [];
  const seen = new Map();
  const filter = value('filter') && new RegExp(value('filter'));
  for (const candidate of candidates()) {
    if (!usable(candidate.mesh) || candidate.mesh.faces.length > OPTS.maxCells) {
      continue;
    }
    if (filter && !filter.test(candidate.id)) {
      continue;
    }
    const entry = entryOf(candidate);
    if (!congruentByType(entry.v, entry.r)) {
      continue;
    }
    const print = canonical(entry.r);
    if (seen.has(print)) {
      continue;
    }
    seen.set(print, entry.id);
    const t0 = Date.now();
    Object.assign(entry, playable(entry));
    entry.ms = Date.now() - t0;
    entries.push(entry);
  }
  return entries;
}

// ---------- the catalog file ----------

const quote = text => `'${text}'`;

function wrapped(items, indent) {
  const lines = [];
  let line = indent;
  for (const item of items) {
    if (line.length + item.length + 2 > 98 && line.trim()) {
      lines.push(line.trimEnd());
      line = indent;
    }
    line += `${item}, `;
  }
  lines.push(line.trimEnd());
  return lines.join('\n');
}

const HEADER = `// The ball boards: convex polyhedra with triangle, square or pentagon faces, the faces of a
// type congruent.
// GENERATED by tools/ball-catalog.mjs (node tools/ball-catalog.mjs --write adds entries); do not
// edit.
// A cell of the board is a face of the polyhedron, a side of a cell is an edge of it.
//   id    short name, used in puzzle files ('surface ball <id>') and share codes
//   name  the usual name of the solid
//   f     [triangles, squares, pentagons]: how many faces have 3, 4, 5 sides
//   ok    false when no puzzle can be played on the board, \`why\` says why: a path has to cover
//         every cell, and a bipartite board (every corner has an even number of cells) allows it
//         only when its two colour classes differ by at most 1 in size
//   h     hash of the ring list: a cell number is the index of its ring, and puzzles
//         refer to it, so the rings of an entry must never change
//   v     the corners as unit vectors: the central projection of the convex solid
//   r     the faces: corner indices, counter-clockwise seen from outside
`;

function render(entries) {
  const parts = entries.map(entry => {
    const lines = [
      '  {',
      `    id: ${quote(entry.id)},`,
      `    name: ${quote(entry.name)},`,
      `    f: [${entry.f.join(', ')}],`,
      `    ok: ${entry.ok},`,
    ];
    if (!entry.ok) {
      lines.push(`    why: ${quote(entry.why)},`);
    }
    lines.push(`    h: ${quote(fnv(JSON.stringify(entry.r)))},`);
    lines.push('    v: [');
    lines.push(wrapped(entry.v.map(p => `[${p.join(', ')}]`), '      '));
    lines.push('    ],');
    lines.push('    r: [');
    lines.push(wrapped(entry.r.map(ring => `[${ring.join(', ')}]`), '      '));
    lines.push('    ],');
    lines.push('  },');
    return lines.join('\n');
  });
  return `${HEADER}export const BALL_CATALOG = [\n${parts.join('\n')}\n];\n`;
}

// ---------- main ----------

const label = f => `${f[0]}t ${f[1]}q ${f[2]}p`;
const entries = generate();
const known = new Map(BALL_CATALOG.map(entry => [entry.id, entry]));
const sameRings = (a, b) => JSON.stringify(a.r) === JSON.stringify(b.r);
const codes = new Map(BALL_CATALOG.map(entry => [canonical(entry.r), entry.id]));

if (!has('write') && !has('check')) {
  console.log('id'.padEnd(24), 'cells', 'corners', 'composition'.padEnd(14), 'ok', 'note');
  for (const entry of entries) {
    const mark = known.has(entry.id) ? '' : 'new';
    const note = entry.ok ? mark : `${entry.why} ${mark}`;
    console.log(
      entry.id.padEnd(24),
      String(entry.r.length).padStart(5),
      String(entry.v.length).padStart(7),
      label(entry.f).padEnd(14),
      entry.ok ? 'yes' : 'NO ',
      note,
    );
  }
  const good = entries.filter(entry => entry.ok).length;
  console.log(`${entries.length} solids, ${good} playable, ${entries.length - good} not`);
}

let failed = false;
const added = [];
const generated = new Set(entries.map(entry => entry.id));
const stale = BALL_CATALOG.filter(entry => !generated.has(entry.id)).map(entry => entry.id);
for (const entry of entries) {
  const old = known.get(entry.id);
  if (old) {
    const drift = old.v.some((p, i) => p.some((x, k) => Math.abs(x - entry.v[i][k]) > 1e-5));
    if (!sameRings(old, entry) || old.v.length !== entry.v.length || drift) {
      console.error(`${entry.id}: differs from the catalog${has('force') ? ' (forced)' : ''}`);
      failed = failed || !has('force');
    }
  } else if (codes.has(canonical(entry.r))) {
    console.error(`${entry.id}: the same solid as '${codes.get(canonical(entry.r))}'`);
  } else {
    added.push(entry);
  }
}
if (has('check')) {
  const problems = [];
  if (added.length) {
    problems.push(`${added.length} entries missing in the catalog`);
  }
  if (stale.length) {
    problems.push(`${stale.length} entries not generated any more (--write --prune): ${stale}`);
  }
  console.log(problems.length ? problems.join('\n') : 'catalog is current');
  process.exit(failed || problems.length ? 1 : 0);
}
if (has('write')) {
  if (failed) {
    process.exit(1);
  }
  const kept = has('prune') ? BALL_CATALOG.filter(old => generated.has(old.id)) : BALL_CATALOG;
  const keep = has('force')
    ? kept.map(old => entries.find(entry => entry.id === old.id) ?? old)
    : kept;
  writeFileSync(FILE, render([...keep, ...added]));
  const pruned = BALL_CATALOG.length - kept.length;
  console.log(`catalog: ${keep.length} kept, ${added.length} added, ${pruned} pruned`);
}
