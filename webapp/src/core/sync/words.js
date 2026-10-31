// A sync secret as eight words that can be read aloud and typed (the "sync phrase").
//
// The secret is 80 random bits. A 16-bit checksum (CRC-16) follows it, and the 96 bits are
// cut into eight groups of 12 bits, one word each. A word is two syllables, consonant +
// vowel, from 16 consonants and 4 vowels: 16 * 4 * 16 * 4 = 4096 words. The words are made
// by rule, so there is no word list to ship or license, and they are not words of any
// language. The checksum catches every mistyped or swapped-in single word, and most others.
// Pure: no DOM, no storage.

const CONSONANTS = 'bdfghjklmnprstvz';
const VOWELS = 'aeio';
const WORD = /^[bdfghjklmnprstvz][aeio][bdfghjklmnprstvz][aeio]$/;

export const SECRET_BYTES = 10;
export const WORD_COUNT = 8;
const WORD_BITS = 12n;
const CHECK_BITS = 16n;

// CRC-16/CCITT-FALSE (polynomial 0x1021, start value 0xffff).
export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
  }
  return crc;
}

// Why a phrase was refused: 'count' (not eight words), 'word' (a word that is not one of
// ours; `position` says which, from 0) or 'checksum' (all words fine, but not together).
export class PhraseError extends Error {
  constructor(reason, position = -1) {
    super(`bad phrase: ${reason}`);
    this.reason = reason;
    this.position = position;
  }
}

const wordOf = index => CONSONANTS[index >> 8] + VOWELS[(index >> 6) & 3]
  + CONSONANTS[(index >> 2) & 15] + VOWELS[index & 3];

const indexOf = word =>
  WORD.test(word)
    ? (CONSONANTS.indexOf(word[0]) << 8) | (VOWELS.indexOf(word[1]) << 6)
      | (CONSONANTS.indexOf(word[2]) << 2) | VOWELS.indexOf(word[3])
    : -1;

export const newSecret = () => globalThis.crypto.getRandomValues(new Uint8Array(SECRET_BYTES));

// 10 secret bytes -> eight words.
export function toWords(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== SECRET_BYTES) {
    throw new RangeError(`a sync secret is ${SECRET_BYTES} bytes`);
  }
  let value = 0n;
  for (const byte of secret) {
    value = (value << 8n) | BigInt(byte);
  }
  value = (value << CHECK_BITS) | BigInt(crc16(secret));
  const words = [];
  for (let group = WORD_COUNT - 1; group >= 0; group--) {
    words.push(wordOf(Number((value >> (BigInt(group) * WORD_BITS)) & 0xfffn)));
  }
  return words;
}

// Text as typed or dictated -> words: any case, separated by blanks, commas or hyphens.
export const normalizePhrase = text => String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);

// Eight words (an array, or text as typed) -> the 10 secret bytes. Throws a PhraseError.
export function fromWords(input) {
  const words = Array.isArray(input)
    ? input.map(word => String(word).toLowerCase())
    : normalizePhrase(input);
  if (words.length !== WORD_COUNT) {
    throw new PhraseError('count');
  }
  let value = 0n;
  words.forEach((word, position) => {
    const index = indexOf(word);
    if (index < 0) {
      throw new PhraseError('word', position);
    }
    value = (value << WORD_BITS) | BigInt(index);
  });
  const secret = new Uint8Array(SECRET_BYTES);
  let rest = value >> CHECK_BITS;
  for (let i = SECRET_BYTES - 1; i >= 0; i--) {
    secret[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (crc16(secret) !== Number(value & 0xffffn)) {
    throw new PhraseError('checksum');
  }
  return secret;
}
