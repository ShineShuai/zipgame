import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  crc16, fromWords, newSecret, normalizePhrase, PhraseError, SECRET_BYTES, toWords, WORD_COUNT,
} from '../../src/core/sync/words.js';

const CONSONANTS = 'bdfghjklmnprstvz';
const VOWELS = 'aeio';
const allWords = [];
for (const c1 of CONSONANTS) for (const v1 of VOWELS) {
  for (const c2 of CONSONANTS) for (const v2 of VOWELS) allWords.push(c1 + v1 + c2 + v2);
}

test('there are 4096 different words, each of two syllables', () => {
  assert.equal(new Set(allWords).size, 4096);
});

test('crc16 is CRC-16/CCITT-FALSE', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29b1);
});

test('a secret and its words are the same thing, both ways', () => {
  for (let i = 0; i < 300; i++) {
    const secret = newSecret();
    assert.equal(secret.length, SECRET_BYTES);
    const words = toWords(secret);
    assert.equal(words.length, WORD_COUNT);
    assert.ok(words.every(word => allWords.includes(word)));
    assert.deepEqual(fromWords(words), secret);
    assert.deepEqual(fromWords(words.join(' ')), secret);
  }
});

test('the first six words of an all-zero secret are zero words', () => {
  const words = toWords(new Uint8Array(SECRET_BYTES));
  assert.deepEqual(words.slice(0, 6), Array(6).fill('baba'));
});

test('a phrase may be typed in any case, with blanks, commas or hyphens', () => {
  const secret = newSecret();
  const words = toWords(secret);
  assert.deepEqual(normalizePhrase(' Baba,Beba -  bibA\nbobo '), ['baba', 'beba', 'biba', 'bobo']);
  assert.deepEqual(fromWords(words.map(w => w.toUpperCase()).join(', ')), secret);
  assert.deepEqual(fromWords(words.join('-')), secret);
});

test('a phrase with the wrong number of words is refused', () => {
  const words = toWords(newSecret());
  for (const bad of [[], words.slice(1), [...words, 'baba'], 'baba']) {
    assert.throws(() => fromWords(bad), error => error instanceof PhraseError
      && error.reason === 'count');
  }
});

test('a word that is not one of ours is refused, and the position is told', () => {
  const words = toWords(newSecret());
  const cases = [[0, 'hello'], [3, 'baca'], [7, 'bab'], [5, 'ba1a'], [2, 'uuuu']];
  for (const [position, bad] of cases) {
    const copy = words.slice();
    copy[position] = bad;
    assert.throws(() => fromWords(copy), error => error.reason === 'word'
      && error.position === position);
  }
});

test('every single wrong word is caught by the checksum (all 8 places, all 4095 others)', () => {
  for (let round = 0; round < 3; round++) {
    const words = toWords(newSecret());
    for (let place = 0; place < WORD_COUNT; place++) {
      for (const other of allWords) {
        if (other === words[place]) continue;
        const copy = words.slice();
        copy[place] = other;
        assert.throws(() => fromWords(copy), error => error.reason === 'checksum');
      }
    }
  }
});

test('two swapped words are caught almost always', () => {
  let caught = 0;
  let tried = 0;
  for (let i = 0; i < 2000; i++) {
    const words = toWords(newSecret());
    const [x, y] = [Math.floor(Math.random() * 8), Math.floor(Math.random() * 8)];
    if (words[x] === words[y]) continue;
    [words[x], words[y]] = [words[y], words[x]];
    tried++;
    try { fromWords(words); } catch { caught++; }
  }
  assert.ok(caught / tried > 0.999, `${caught}/${tried}`);
});

test('toWords wants exactly 10 bytes', () => {
  assert.throws(() => toWords(new Uint8Array(9)), RangeError);
  assert.throws(() => toWords([1, 2, 3]), RangeError);
});
