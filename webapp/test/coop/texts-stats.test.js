import test from 'node:test';
import assert from 'node:assert/strict';
import { EN, ZH, tx } from '../../src/coop/texts.js';
import { setLang } from '../../src/ui/i18n.js';
import { recordSolve, parseStats, summaryOf } from '../../src/coop/stats.js';
import { REASONS } from '../../src/coop/drawing.js';

test('both languages have the same keys and the same {n} placeholders', () => {
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort());
  const holes = text => (text.match(/\{\d+\}/g) || []).sort().join();
  for (const key of Object.keys(EN)) {
    assert.equal(holes(ZH[key]), holes(EN[key]), key);
  }
});

test('every refusal reason that is shown to the player has a text', () => {
  for (const reason of REASONS.filter(r => r !== 'present')) {
    assert.ok(EN[reason] && ZH[reason], reason);
  }
});

test('tx follows the app language and fills the placeholders', () => {
  setLang('en');
  assert.equal(tx('hintsLeft', 2), 'Hint (2 left)');
  setLang('zh');
  assert.equal(tx('hintsLeft', 2), '提示（剩 2 次）');
  setLang('en');
  assert.equal(tx('no such key'), 'no such key');
});

test('stats: per size count, mean and best; a damaged record starts afresh', () => {
  const data = parseStats(null);
  assert.deepEqual(summaryOf(data, 7), { n: 0, mean: 0, best: null });
  recordSolve(data, 7, 30);
  const second = recordSolve(data, 7, 20);
  assert.deepEqual(second, { n: 2, mean: 25, best: 20 });
  assert.equal(summaryOf(data, 8).n, 0);
  assert.deepEqual(parseStats('{oops'), { v: 1, sizes: {} });
  assert.deepEqual(parseStats(JSON.stringify({ v: 2 })), { v: 1, sizes: {} });
  assert.equal(parseStats(JSON.stringify(data)).sizes[7].best, 20);
});
