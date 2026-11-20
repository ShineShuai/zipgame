// What every puzzle variant of the play app has to satisfy, once for the whole registry (PLAY_VARIANTS in
// apps/play/variants.js): registration, sizes, the lucky game, detection, texts, an icon of its own, a puzzle at its smallest
// and largest size. A new variant is covered by its entry there; what belongs to one variant alone stays in its own test file.
// Registered by unit/variant-contract.test.js: variantContractTests(t, ok, eq).
import { runSync } from '../src/core/run.js';
import { isSolved, step } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { PLAY_SIZES } from '../src/core/gen/generate.js';
import { labelCount } from '../src/core/model.js';
import { MAX_LEGS, VARIANTS, encodeShare, decodeShare } from '../src/core/share-code.js';
import { playGradesFor } from '../src/core/grades.js';
import {
  ARROWS_MODEL,
  EXACT_MODEL,
  LOOP_MODEL,
  modelFor,
  TELEPORT_MODEL,
  TRAP_MODEL,
  TWOPATHS_MODEL,
  WRAP_MODEL,
} from '../src/core/trap.js';
import {
  makeShareRecord,
  parseShareLink,
  shareStatus,
  shareText,
  sizeArg,
} from '../src/features/share.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS,
  variantOf,
  variantById,
  sizesFor,
  luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { made } from './fixtures/made.js';

// One small puzzle of each variant, for the rows that only need a puzzle: made() thaws the frozen
// ones (test/fixtures/puzzles.json); the Cutout's is generated, its format cannot keep the shape.
// A new variant needs an entry here.
const FAST_OPTS = { candidates: 1, refineNodes: 0 };
const SAMPLE = {
  cutout: [6, 21, { boards: 1, effort: 0.1 }],
  arrows: [5, 3, FAST_OPTS],
  exact: [6, 3, FAST_OPTS],
  wrap: [5, 4],
  loop: [6, 4],
  teleport: [6, 3],
  twopaths: [6, 3],
  pentagon: [6, 4],
};
const sampleOf = id => made(id, ...SAMPLE[id]);
// The model that grades each type (trap.js modelFor); the Cutout's is made on the fly, the
// Pentagon's is the grid's.
const MODEL_OF = {
  arrows: ARROWS_MODEL,
  exact: EXACT_MODEL,
  wrap: WRAP_MODEL,
  loop: LOOP_MODEL,
  teleport: TELEPORT_MODEL,
  twopaths: TWOPATHS_MODEL,
};
// Their rules are not the ones of the grid (two colours, a surface): step() and isSolved() play
// the planted path of the others; these are tested with their own rules.
const OWN_RULES = ['twopaths', 'pentagon'];

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

  t(
    'variants: each entry is registered, offers ascending sizes, and its lucky game draws from them',
    () => {
      eq(new Set(PLAY_VARIANTS.map(v => v.id)).size, PLAY_VARIANTS.length, 'ids are unique');
      const lucky = luckyDefs(PLAY_SIZES);
      for (const v of PLAY_VARIANTS) {
        eq(variantById(v.id), v, `${v.id} is registered`);
        const sizes = sizesFor(v.id, PLAY_SIZES);
        ok(
          sizes.length > 0 && sizes.every((n, i) => i === 0 || n > sizes[i - 1]),
          `${v.id}: ascending sizes ${sizes}`,
        );
        eq(sizes, v.sizes(PLAY_SIZES), `${v.id}: sizesFor is the entry's list`);
        const def = lucky.find(d => d.id === v.id);
        ok(def, `${v.id}: has a lucky game`);
        eq(def.pool, sizes, `${v.id}: once unlocked, the lucky game takes the sizes of free play`);
        ok(
          def.locked.length > 0 && def.locked.every(n => sizes.includes(n)),
          `${v.id}: the locked lucky game stays inside them`,
        );
      }
    },
  );

  t.slow(
    'variants: a puzzle is claimed by its own variant and by no other; a standard puzzle by none',
    () => {
      eq(variantOf(made('std', 6, 11)), null, 'a standard puzzle');
      for (const v of PLAY_VARIANTS) {
        const p = puzzleOf(v, sizesFor(v.id, PLAY_SIZES)[0]);
        eq(variantOf(p), v.id, `${v.id}: variantOf`);
        eq(
          PLAY_VARIANTS.filter(other => other.detect(p)).map(other => other.id),
          [v.id],
          `${v.id}: no other variant claims it`,
        );
      }
    },
  );

  t('variants: the texts of every entry exist in both languages', () => {
    for (const v of PLAY_VARIANTS) {
      for (const key of Object.values(v.keys)) {
        ok(typeof EN[key] === 'string' || typeof EN[key] === 'function', `EN ${key}`);
        ok(typeof ZH[key] === 'string' || typeof ZH[key] === 'function', `ZH ${key}`);
      }
    }
  });

  t.slow(
    'variants: the smallest and the largest offered size (the smallest only for Arrows and Pentagon) each give a puzzle of that size with one solution',
    () => {
      for (const v of PLAY_VARIANTS) {
        const sizes = sizesFor(v.id, PLAY_SIZES);
        for (const n of new Set([
          sizes[0],
          SMALLEST_ONLY.includes(v.id) ? sizes[0] : sizes[sizes.length - 1],
        ])) {
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
    },
  );

  t('variants: every variant has an icon of its own, and no other icon carries its mark', () => {
    const ids = [...PLAY_VARIANTS.map(v => v.id), 'standard'];
    const icons = ids.map(id => variantIcon(id));
    ids.forEach((id, i) => {
      ok(/^\s*<svg[\s\S]*<\/svg>\s*$/.test(icons[i]), `${id}: an svg`);
      if (id !== 'standard') {
        ok(icons[i].includes(`variant-icon vi-${id}"`), `${id}: its class`);
        ids.forEach((other, j) =>
          ok(j === i || !icons[j].includes(`vi-${id}"`), `${other} does not carry the ${id} mark`),
        );
      }
    });
    eq(new Set(icons).size, icons.length, 'all icons differ');
  });

  t(
    'variants: the share ids of the built-in variants never change (links already sent depend on them)',
    () => {
      // compat pin: the type field of the links already shared
      eq(VARIANTS, [null, 'cutout', 'arrows', 'exact', 'wrap', 'loop']);
    },
  );

  t('variants: every entry has a sample puzzle of its own here', () => {
    eq(Object.keys(SAMPLE).sort(), PLAY_VARIANTS.map(v => v.id).sort(), 'one sample per variant');
    for (const v of PLAY_VARIANTS) {
      const p = sampleOf(v.id);
      ok(v.detect(p), `${v.id}: the sample is its own`);
      ok(sizesFor(v.id, PLAY_SIZES).includes(p.n), `${v.id}: of an offered size`);
    }
  });

  t(
    'variants: a share record copies the puzzle, has no grade, names the variant in both ' +
      'languages, and is playable at an offered size only',
    () => {
      const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
      for (const v of PLAY_VARIANTS) {
        const p = sampleOf(v.id);
        const rec = makeShareRecord({
          n: p.n,
          timeS: 83.4,
          legs: [0, 2, 3],
          K: labelCount(p),
          variant: v.id,
          grade: 2,
          puzzle: p,
        });
        eq([rec.kind, rec.variant], ['local', v.id], `${v.id}: a local game of the variant`);
        eq(rec.grade, null, `${v.id}: a variant has no grade`);
        ok(v.detect(rec.puzzle), `${v.id}: the record's puzzle is the variant's`);
        for (const [key, value] of Object.entries(p)) {
          if (ArrayBuffer.isView(value) && rec.puzzle[key]) {
            ok(rec.puzzle[key] !== value, `${v.id}: ${key} is a copy, not the same array`);
          }
        }
        for (const [lang, dict] of [
          ['EN', EN],
          ['ZH', ZH],
        ]) {
          const tr = (key, ...args) => dict[key].replace(/\{0\}/g, args[0]);
          const head = shareText(rec, 'https://x/?s=abc', tr).split('\n')[0];
          ok(head.includes(tr(v.keys.name)), `${v.id} ${lang}: the head line names the variant`);
          ok(head.includes(String(sizeArg(rec))), `${v.id} ${lang}: and its size`);
        }
        eq(shareStatus(rec, ctx).status, 'ok', `${v.id}: playable at once`);
        const odd = shareStatus({ ...rec, n: 99 }, ctx).status;
        eq(odd, 'invalid', `${v.id}: a size it does not offer`);
      }
    },
  );

  t(
    'variants: a variant game is graded by trap only, by the model of its type; ' +
      'the grid keeps its model and the old grades',
    () => {
      for (const v of PLAY_VARIANTS) {
        const p = sampleOf(v.id);
        const g = playGradesFor(p);
        ok(g.legacy === null && g.trap.ok, `${v.id}: trap only`);
        eq(g.trap.ladTrials, 0, `${v.id}: no ladder`);
        ok(Number.isInteger(g.trap.grade), `${v.id}: a whole grade`);
        ok(g.trap.grade >= 0 && g.trap.grade <= 5, `${v.id}: 0 to 5`);
        ok(Number.isFinite(g.trap.predicted), `${v.id}: a predicted score`);
        if (MODEL_OF[v.id]) {
          eq(modelFor(p), MODEL_OF[v.id], `${v.id}: its own model`);
          ok(MODEL_OF[v.id] !== TRAP_MODEL, `${v.id}: not the grid's`);
        }
      }
      const grid = made('std', 5, 1);
      eq(modelFor(grid), TRAP_MODEL, 'the grid keeps its model');
      ok(playGradesFor(grid).legacy !== null, 'the grid keeps the old grades');
    },
  );

  t('variants: the planted solution, played with step(), solves the puzzle', () => {
    for (const v of PLAY_VARIANTS.filter(({ id }) => !OWN_RULES.includes(id))) {
      const p = sampleOf(v.id);
      const path = [];
      for (const cell of p.path) {
        eq(step(p, path, cell, { strictOrder: true }), 'push', `${v.id}: cell ${cell}`);
      }
      ok(isSolved(p, path), `${v.id}: solved`);
    }
  });

  // What every variant's share code has to do, with the colour strip of the game (one level per
  // leg) and without it; what is special to one (its own version, the fields it adds, the records
  // it refuses) is tested with the variant.
  t.slow(
    'variants: a share code gives back the puzzle, the time and the strip, one puzzle has ' +
      'one code, a damaged code is refused',
    () => {
      const flat = q =>
        Object.fromEntries(
          Object.entries(q).map(([key, x]) => [key, ArrayBuffer.isView(x) ? [...x] : x]),
        );
      const cases = PLAY_VARIANTS.flatMap(v => {
        const sizes = sizesFor(v.id, PLAY_SIZES);
        return [
          ...new Set([sizes[0], SMALLEST_ONLY.includes(v.id) ? sizes[0] : sizes.at(-1)]),
        ].map(n => [v, puzzleOf(v, n), n === sizes[0]]);
      });
      for (const [v, p, smallest] of cases) {
        const K = labelCount(p);
        // the game's legs with the puzzle's own K (a strip of K - 1 levels), and a game of K = 1
        for (const [legs, legCount] of [
          [[0, 2, 3, 7, 1, 0, 5], K],
          [[], 1],
        ]) {
          const tag = `${v.id} ${p.n}${legCount === K ? ' with a strip' : ' without one'}`;
          const rec = makeShareRecord({
            n: p.n,
            timeS: 83.4,
            legs,
            K: legCount,
            variant: v.id,
            puzzle: p,
          });
          const strip = legCount - 1 >= 1 && legCount - 1 <= MAX_LEGS;
          eq(rec.levels.length, strip ? legCount - 1 : 0, `${tag}: one level per leg, or none`);
          const code = encodeShare(rec);
          ok(/^[A-Za-z0-9_-]+$/.test(code), `${tag}: only characters that are safe in a link`);
          ok(strip || !smallest || code.length <= 60, `${tag}: short (${code.length})`);
          const back = decodeShare(code);
          eq(
            [back.kind, back.variant, back.n, back.timeS, back.grade],
            ['local', v.id, p.n, 83.4, null],
            `${tag}: the record`,
          );
          eq(back.levels, rec.levels, `${tag}: the strip`);
          eq(flat(back.puzzle), flat(rec.puzzle), `${tag}: the same puzzle`);
          ok(v.detect(back.puzzle), `${tag}: the receiver plays it as the same variant`);
          eq(encodeShare(back), code, `${tag}: one puzzle, one code`);
          eq(parseShareLink(`?s=${code}`).rec.puzzle.n, p.n, `${tag}: the link`);
          const changed = at =>
            code.slice(0, at) + (code[at] === 'A' ? 'B' : 'A') + code.slice(at + 1);
          const damaged = [
            code.slice(0, -1),
            `${code}A`,
            ...Array.from(code, (_, at) => changed(at)),
          ];
          eq(
            damaged.map(decodeShare).filter(Boolean).length,
            0,
            `${tag}: a truncated, a longer and every mistyped code is refused`,
          );
        }
      }
    },
  );
}
