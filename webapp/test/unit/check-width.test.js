// The helper of the line-width ratchet that rewraps a comment (test/check-width.js, width:fix).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wrapComment } from '../check-width.js';

const columns = line => [...line].length;
const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');

test('wrapComment: a wide comment moves on to more lines, with its indent and marker', () => {
  const parts = wrapComment(`  // ${words}`);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.startsWith('  // ') && columns(part) <= 99));
  assert.equal(parts.map(part => part.slice(5)).join(' '), words); // no word lost or cut
});

test('wrapComment: code, trailing comments, directives, long words stay as they are', () => {
  const wide = `${words} ${words}`;
  for (const line of [
    `const text = '${wide}';`,
    `run(); // ${wide}`,
    `// biome-ignore lint/style/noNonNullAssertion: ${wide}`,
    `//   ${wide}`, // aligned text: the author laid it out
    `// ${'x'.repeat(120)}`, // one word that no break helps
    `// ${words}`.slice(0, 60), // not too wide
  ]) {
    assert.equal(wrapComment(line), null, line.slice(0, 40));
  }
});
