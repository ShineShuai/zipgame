// node --test bench/results.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore, mergeStores, cellCompare, classify, geomean, orderedVersions, serializeStore, hash, verId, isOwn, pickResult, referenceSpec, specHashOf, diffSpec, trendSeries } from './results.js';

const SHA = n => String(n).repeat(40).slice(0, 40);
const specOf = (cases = ['a'], variantOpts = {}) => ({ common: { cap: 1 }, cases: Object.fromEntries(cases.map(c => [c, { n: 1 }])), variants: { v: variantOpts } });
function result({ sha = SHA(1), env = 'e1', rev = 1, seeds = [1, 2, 3], nodes = 100, ts = '2026-01-01T00:00:00Z', spec = specOf(), cap = [] }) {
  const rows = seeds.map(s => ({ c: 'a', s, v: 'v', m: { nodes: nodes * s, ms: s }, ...(cap.includes(s) ? { cap: 1 } : {}) }));
  return { sha, envId: env, suite: 'solver', rev, ts, spec, rows, checks: { failed: 0 } };
}
const fragment = (...results) => ({ ...emptyStore(), results });

test('merge is idempotent and newer result wins', () => {
  const a = mergeStores(emptyStore(), fragment(result({})));
  assert.deepEqual(mergeStores(a, fragment(result({}))), a);
  const b = mergeStores(a, fragment(result({ nodes: 50, ts: '2026-02-01T00:00:00Z' })));
  assert.equal(b.results.length, 1);
  assert.equal(b.results[0].rows[0].m.nodes, 50);
  assert.equal(mergeStores(b, fragment(result({ nodes: 7 }))).results[0].rows[0].m.nodes, 50);
});

test('dirty, sha-less and incomplete results are rejected', () => {
  const rejected = [];
  const out = mergeStores(emptyStore(), fragment({ ...result({}), dirty: true }, { ...result({}), sha: 'abc' }, { suite: 'x' }), (r, why) => rejected.push(why));
  assert.equal(out.results.length, 0);
  assert.deepEqual(rejected, ['uncommitted changes', 'missing git sha', 'missing git sha']);
});

test('dirty results need allowDirty and form their own version slot', () => {
  const dirty = { ...result({ ts: '2026-05-01T00:00:00Z' }), dirty: [' M src/x.js'], bench: SHA(1) + '+' };
  const rejected = [];
  assert.equal(mergeStores(emptyStore(), fragment(dirty), (r, why) => rejected.push(why)).results.length, 0);
  assert.deepEqual(rejected, ['uncommitted changes']);
  const out = mergeStores(emptyStore(), fragment(result({}), dirty, { ...dirty, ts: '2026-06-01T00:00:00Z' }), () => {}, true);
  assert.equal(out.results.length, 2);
  assert.deepEqual(orderedVersions(out), [SHA(1), SHA(1) + '+']);
  assert.equal(verId(dirty), SHA(1) + '+');
  assert.equal(isOwn(dirty), true);
  assert.equal(isOwn({ ...result({}), bench: SHA(2) }), false);
});

test('same version in several environments: separate results', () => {
  const out = mergeStores(emptyStore(), fragment(result({ env: 'e1' }), result({ env: 'e2' })));
  assert.equal(out.results.length, 2);
  assert.equal(orderedVersions(out).length, 1);
});

test('compare uses the instances both versions ran', () => {
  const old = result({ seeds: [1, 2, 3], nodes: 100 });
  const next = result({ sha: SHA(2), seeds: [2, 3, 4], nodes: 50 });
  const cmp = cellCompare(next, old, 'a', 'v', 'nodes');
  assert.equal(cmp.n, 2);
  assert.equal(cmp.ratio, 0.5);
  assert.equal(cmp.specDiff, false);
});

test('spec or rev change flags the cell, other cells stay comparable', () => {
  const old = result({});
  const sameSpecNewCase = result({ sha: SHA(2), spec: specOf(['a', 'b']) });
  assert.equal(cellCompare(sameSpecNewCase, old, 'a', 'v', 'nodes').specDiff, false);
  assert.equal(cellCompare(result({ sha: SHA(2), spec: specOf(['a'], { prop: true }) }), old, 'a', 'v', 'nodes').specDiff, true);
  assert.equal(cellCompare(result({ sha: SHA(2), rev: 2 }), old, 'a', 'v', 'nodes').specDiff, true);
});

test('classify: exact metrics flag any change, ms uses the noise band', () => {
  assert.equal(classify(1, 'nodes', 5), 'same');
  assert.equal(classify(1.001, 'nodes', 5), 'worse');
  assert.equal(classify(0.5, 'nodes', 5), 'better');
  assert.equal(classify(1.04, 'ms', 5), 'same');
  assert.equal(classify(1.2, 'ms', 5), 'worse');
  assert.equal(classify(1.2, 'K', 5), 'neutral');
});

test('geomean, hash key order, serialization escapes </script', () => {
  assert.ok(Math.abs(geomean([0.5, 2]) - 1) < 1e-12);
  assert.equal(hash({ a: 1, b: [2] }), hash({ b: [2], a: 1 }));
  assert.ok(!serializeStore({ ...emptyStore(), versions: { x: { subject: '</script>' } } }).includes('</script'));
});

test('native and backfilled results of one version coexist; pick prefers the reference spec', () => {
  const native = result({ sha: SHA(1), ts: '2026-01-01T00:00:00Z' });
  const backfill = { ...result({ sha: SHA(1), ts: '2026-02-01T00:00:00Z', spec: specOf(['a', 'b']) }), bench: SHA(2) };
  const newest = result({ sha: SHA(2), ts: '2026-03-01T00:00:00Z', spec: specOf(['a', 'b']) });
  const store = mergeStores(emptyStore(), { ...emptyStore(), versions: { [SHA(1)]: { date: '1' }, [SHA(2)]: { date: '2' } }, results: [native, backfill, newest] });
  assert.equal(store.results.length, 3);
  const ref = referenceSpec(store, 'solver', 'e1', 'nodes');
  assert.equal(ref, specHashOf(newest));
  assert.equal(pickResult(store, 'solver', SHA(1), 'e1', 'nodes', ref).bench, SHA(2));
  assert.equal(pickResult(store, 'solver', SHA(1), 'e1', 'nodes', specHashOf(native)).bench, undefined);
});

test('diffSpec lists rev, params, cases, variants and instance changes', () => {
  const a = result({});
  const b = { ...result({ rev: 2, spec: { common: { cap: 2 }, cases: { a: { n: 1, inputs: 'x', seeds: [1, 2] }, c: { n: 3 } }, variants: { v: { prop: true } } } }) };
  a.spec = { common: { cap: 1 }, cases: { a: { n: 1, inputs: 'y', seeds: [1, 3] }, d: {} }, variants: { v: {}, w: {} } };
  assert.deepEqual(diffSpec(a, b), ['rev 1 → 2', 'common.cap: 1 → 2', 'case a: instances changed', 'case a.seeds: +2 −3', 'case d removed', 'case c added', 'variant v.prop added', 'variant w removed']);
  assert.deepEqual(diffSpec(a, a), []);
});

test('trend chains versions, breaks (carries the level) at a spec change', () => {
  const r1 = result({ nodes: 100 });
  const r2 = result({ sha: SHA(2), nodes: 50 });
  const r3 = result({ sha: SHA(3), nodes: 5, spec: specOf(['a'], { x: 1 }) });
  const r4 = result({ sha: SHA(4), nodes: 2.5, spec: specOf(['a'], { x: 1 }) });
  const [series] = [...trendSeries([r1, r2, r3, r4], [['a', 'v']], 'nodes').values()];
  assert.deepEqual(series.map(p => [p.i, Math.round(p.idx), p.broken]), [[0, 100, false], [1, 50, false], [2, 50, true], [3, 25, false]]);
});
