// What every puzzle variant of the play app has to satisfy, once for the whole registry (PLAY_VARIANTS in
// apps/play/variants.js): registration, sizes, the lucky game, detection, texts, an icon of its own, a puzzle at its smallest
// and largest size. A new variant is covered by its entry there; what belongs to one variant alone stays in its own test file.
// Registered by unit/variant-contract.test.js: variantContractTests(t, ok, eq).
import { runSync } from '../src/core/run.js';
import { solve } from '../src/core/solver/solve.js';
import { PLAY_SIZES } from '../src/core/gen/generate.js';
import { labelCount } from '../src/core/model.js';
import { VARIANTS, encodeShare, decodeShare } from '../src/core/share-code.js';
import { makeShareRecord, parseShareLink } from '../src/features/share.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS, variantOf, variantById, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { made } from './fixtures/made.js';

// Variants whose solutions the general solver counts; Arrows and Pentagon have a solver of their own, tested with them.
const COUNTED_BY_SOLVE = ['cutout', 'exact', 'wrap', 'loop', 'teleport', 'twopaths'];
// Their largest board takes seconds to make (arrows 2 s, pentagon 2 s); arrows-gen.js and pentagon-gen (pentagon.js) test those sizes.
const SMALLEST_ONLY = ['arrows', 'pentagon'];

export function variantContractTests(t, ok, eq) {
  const generated = new Map(); // id + size -> puzzle, so that each test below asks the generator once
  const puzzleOf = (variant, n) => {
    const key = `${variant.id}${n}`;
    if (!generated.has(key)) {
      generated.set(key, runSync(variant.generate(n, 11)));
    }
    return generated.get(key);
  };

  t('variants: each entry is registered, offers ascending sizes, and its lucky game draws from them', () => {
    eq(new Set(PLAY_VARIANTS.map(v => v.id)).size, PLAY_VARIANTS.length, 'ids are unique');
    const lucky = luckyDefs(PLAY_SIZES);
    for (const v of PLAY_VARIANTS) {
      eq(variantById(v.id), v, `${v.id} is registered`);
      const sizes = sizesFor(v.id, PLAY_SIZES);
      ok(sizes.length > 0 && sizes.every((n, i) => i === 0 || n > sizes[i - 1]), `${v.id}: ascending sizes ${sizes}`);
      eq(sizes, v.sizes(PLAY_SIZES), `${v.id}: sizesFor is the entry's list`);
      const def = lucky.find(d => d.id === v.id);
      ok(def, `${v.id}: has a lucky game`);
      eq(def.pool, sizes, `${v.id}: once unlocked, the lucky game takes the sizes of free play`);
      ok(def.locked.length > 0 && def.locked.every(n => sizes.includes(n)), `${v.id}: the locked lucky game stays inside them`);
    }
  });

  t.slow('variants: a puzzle is claimed by its own variant and by no other; a standard puzzle by none', () => {
    eq(variantOf(made('std', 6, 11)), null, 'a standard puzzle');
    for (const v of PLAY_VARIANTS) {
      const p = puzzleOf(v, sizesFor(v.id, PLAY_SIZES)[0]);
      eq(variantOf(p), v.id, `${v.id}: variantOf`);
      eq(PLAY_VARIANTS.filter(other => other.detect(p)).map(other => other.id), [v.id], `${v.id}: no other variant claims it`);
    }
  });

  t('variants: the texts of every entry exist in both languages', () => {
    for (const v of PLAY_VARIANTS) {
      for (const key of Object.values(v.keys)) {
        ok(typeof EN[key] === 'string' || typeof EN[key] === 'function', `EN ${key}`);
        ok(typeof ZH[key] === 'string' || typeof ZH[key] === 'function', `ZH ${key}`);
      }
    }
  });

  t.slow('variants: the smallest and the largest offered size (the smallest only for Arrows and Pentagon) each give a puzzle of that size with one solution', () => {
    for (const v of PLAY_VARIANTS) {
      const sizes = sizesFor(v.id, PLAY_SIZES);
      for (const n of new Set([sizes[0], SMALLEST_ONLY.includes(v.id) ? sizes[0] : sizes[sizes.length - 1]])) {
        const p = puzzleOf(v, n);
        ok(v.detect(p), `${v.id} ${n}: detected`);
        if (v.id !== 'pentagon') {
          eq(p.n, n, `${v.id}: size`);
        }
        if (COUNTED_BY_SOLVE.includes(v.id)) {
          const r = solve(p, { limit: 2, nodeCap: 2e7, prop: true });
          ok(r.count === 1 && !r.exceeded, `${v.id} ${n}: one solution`);
        }
      }
    }
  });

  t('variants: every variant has an icon of its own, and no other icon carries its mark', () => {
    const ids = [...PLAY_VARIANTS.map(v => v.id), 'standard'];
    const icons = ids.map(id => variantIcon(id));
    ids.forEach((id, i) => {
      ok(/^\s*<svg[\s\S]*<\/svg>\s*$/.test(icons[i]), `${id}: an svg`);
      if (id !== 'standard') {
        ok(icons[i].includes(`variant-icon vi-${id}"`), `${id}: its class`);
        ids.forEach((other, j) => ok(j === i || !icons[j].includes(`vi-${id}"`), `${other} does not carry the ${id} mark`));
      }
    });
    eq(new Set(icons).size, icons.length, 'all icons differ');
  });

  t('variants: the share ids of the built-in variants never change (links already sent depend on them)', () => {
    // compat pin: the type field of the links already shared
    eq(VARIANTS, [null, 'cutout', 'arrows', 'exact', 'wrap', 'loop']);
  });

  // What every variant's share code has to do; what is special to one (its own version, the fields
  // it adds, the records it refuses) is tested with the variant.
  t.slow('variants: a share code gives back the puzzle and the time, one puzzle has one code, '
    + 'a damaged code is refused', () => {
    const flat = q => Object.fromEntries(
      Object.entries(q).map(([key, x]) => [key, ArrayBuffer.isView(x) ? [...x] : x]));
    const cases = PLAY_VARIANTS.flatMap(v => {
      const sizes = sizesFor(v.id, PLAY_SIZES);
      return [...new Set([sizes[0], SMALLEST_ONLY.includes(v.id) ? sizes[0] : sizes.at(-1)])]
        .map(n => [v, puzzleOf(v, n), n === sizes[0]]);
    });
    for (const [v, p, smallest] of cases) {
      const K = labelCount(p);
      const rec = makeShareRecord({ n: p.n, timeS: 83.4, legs: [], K, variant: v.id, puzzle: p });
      const code = encodeShare(rec);
      ok(/^[A-Za-z0-9_-]+$/.test(code), `${v.id} ${p.n}: only characters that are safe in a link`);
      ok(!smallest || code.length <= 60, `${v.id} ${p.n}: short (${code.length} characters)`);
      const back = decodeShare(code);
      eq([back.kind, back.variant, back.n, back.timeS, back.grade],
        ['local', v.id, p.n, 83.4, null], `${v.id} ${p.n}: the record`);
      eq(flat(back.puzzle), flat(rec.puzzle), `${v.id} ${p.n}: the same puzzle`);
      ok(v.detect(back.puzzle), `${v.id} ${p.n}: the receiver plays it as the same variant`);
      eq(encodeShare(back), code, `${v.id} ${p.n}: one puzzle, one code`);
      eq(parseShareLink(`?s=${code}`).rec.puzzle.n, p.n, `${v.id} ${p.n}: the link`);
      const changed = at => code.slice(0, at) + (code[at] === 'A' ? 'B' : 'A') + code.slice(at + 1);
      const damaged = [code.slice(0, -1), `${code}A`, ...Array.from(code, (_, at) => changed(at))];
      eq(damaged.map(decodeShare).filter(Boolean).length, 0,
        `${v.id} ${p.n}: a truncated, a longer and every mistyped code is refused`);
    }
  });
}
