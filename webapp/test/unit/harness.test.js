// The assertions of the unit tests: eq is strict, so that a test cannot pass for the wrong reason.
import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from '../harness.js';

test('eq tells apart what JSON.stringify did not: NaN and null, other sets, undefined fields, -0, other types', () => {
  const different = [
    [NaN, null], [new Set([1]), new Set([2])], [new Map([[1, 2]]), new Map([[1, 3]])],
    [{ a: undefined }, {}], [-0, 0], [Uint8Array.of(1), [1]], [new Date(0), new Date(1)],
  ];
  for (const [actual, expected] of different) {
    assert.throws(() => eq(actual, expected), `${String(actual)} is not ${String(expected)}`);
  }
  eq({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
  eq(new Set([1, 2]), new Set([1, 2]));
});
