// Mixed-radix packing: a record is a list of fields, each an integer in [0, radix). The first
// field is the least significant "digit" of one big number, so a field's radix may depend on the
// fields before it (the reader knows them by then). The number needs ceil(log2(product of the
// radices)) bits: no whole-bit padding per field, which is what a fixed-width layout wastes
// (6 bits for 49 cells, where 5.6 are enough).
//
// On top of the plain digit: count() for a small integer, subset() for a set of indices (the
// combinatorial number system: exactly ceil(log2 C(size, k)) bits), distinct() for an ordered
// pick of distinct indices.
// Pure: no DOM, no storage. Reader methods throw RangeError on anything that is not a valid
// encoding.

const big = BigInt;

// Binomial coefficient C(n, k) as a BigInt; 0 when k is out of range.
function choose(n, k) {
  if (k < 0 || k > n) {
    return 0n;
  }
  const m = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= m; i++) {
    result = (result * big(n - m + i)) / big(i);
  }
  return result;
}

// Number of bits of the integer v >= 0 (0 has 1).
export const bitLength = v => v.toString(2).length;

// floor(log2(v + 1)): the size class of count() for the value v.
const classOf = v => 31 - Math.clz32(v + 1);

export class RadixWriter {
  #value = 0n;
  #scale = 1n;

  // The product of all the radices so far: the number of different records of this shape.
  get capacity() {
    return this.#scale;
  }

  // The packed number: below capacity.
  get value() {
    return this.#value;
  }

  #push(x, radix) {
    if (x < 0n || x >= radix) {
      throw new RangeError(`field ${x} is outside 0..${radix - 1n}`);
    }
    this.#value += x * this.#scale;
    this.#scale *= radix;
  }

  // x in [0, radix)
  uint(x, radix) {
    if (!Number.isInteger(x) || !Number.isInteger(radix) || radix < 1) {
      throw new RangeError(`bad field ${x} / ${radix}`);
    }
    this.#push(big(x), big(radix));
  }

  // x in [0, max], cheap when small: the size class floor(log2(x + 1)), then the bits below its
  // leading one.
  count(x, max) {
    if (!Number.isInteger(x) || x < 0 || x > max) {
      throw new RangeError(`count ${x} is outside 0..${max}`);
    }
    const size = classOf(x);
    this.uint(size, classOf(max) + 1);
    this.uint(x + 1 - 2 ** size, 2 ** size);
  }

  // Strictly ascending items of [0, size), any number of them.
  subset(items, size) {
    this.count(items.length, size);
    this.fixedSubset(items, size, items.length);
  }

  // The same when the reader already knows how many items there are.
  fixedSubset(items, size, k) {
    if (items.length !== k) {
      throw new RangeError(`expected ${k} items, got ${items.length}`);
    }
    let rank = 0n;
    items.forEach((item, i) => {
      if (!Number.isInteger(item) || item < 0 || item >= size || (i > 0 && item <= items[i - 1])) {
        throw new RangeError(`subset item ${item} is not ascending inside 0..${size - 1}`);
      }
      rank += choose(item, i + 1);
    });
    this.#push(rank, choose(size, k));
  }

  // Distinct items of [0, size) in the given order: each one is its position among the items
  // not taken yet, so the i-th costs log2(size - i) bits.
  distinct(items, size) {
    const taken = [];
    items.forEach((item, i) => {
      if (!Number.isInteger(item) || item < 0 || item >= size || taken.includes(item)) {
        throw new RangeError(`pick ${item} is repeated or outside 0..${size - 1}`);
      }
      this.uint(item - taken.filter(t => t < item).length, size - i);
      taken.push(item);
    });
  }
}

export class RadixReader {
  #value;
  #scale = 1n;

  constructor(value) {
    this.#value = value;
  }

  // The radices read so far, multiplied: the capacity the writer ended with, once everything has
  // been read.
  get capacity() {
    return this.#scale;
  }

  // Everything was read (the number has no digits left).
  get done() {
    return this.#value === 0n;
  }

  #pop(radix) {
    if (radix < 1n) {
      throw new RangeError(`bad radix ${radix}`);
    }
    const x = this.#value % radix;
    this.#value /= radix;
    this.#scale *= radix;
    return x;
  }

  uint(radix) {
    return Number(this.#pop(big(radix)));
  }

  count(max) {
    const size = this.uint(classOf(max) + 1);
    const x = this.uint(2 ** size) + 2 ** size - 1;
    if (x > max) {
      throw new RangeError(`count ${x} is above ${max}`);
    }
    return x;
  }

  subset(size) {
    return this.fixedSubset(size, this.count(size));
  }

  fixedSubset(size, k) {
    let rank = this.#pop(choose(size, k));
    const items = [];
    for (let i = k; i >= 1; i--) {
      // the largest c with C(c, i) <= rank
      let low = i - 1;
      let high = size - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (choose(mid, i) <= rank) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      items.push(low);
      rank -= choose(low, i);
    }
    return items.reverse();
  }

  distinct(size, k) {
    const taken = [];
    for (let i = 0; i < k; i++) {
      let item = this.uint(size - i);
      for (const t of [...taken].sort((a, b) => a - b)) {
        if (t <= item) {
          item++;
        }
      }
      taken.push(item);
    }
    return taken;
  }
}
