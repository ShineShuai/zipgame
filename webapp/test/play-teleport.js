// Tests of the Teleport variant in the play app and the shared code around it: the portals and the
// jump on the board, the
// icon, the registry entry, the share code and record, the grade, a whole game, the lucky game,
// and what the design app
// draws. The core and the generator are in teleport.js and teleport-gen.js. Registered by
// tests.js:
// teleportPlayTests(t, ta, ok, eq).
import { maxNumber } from '../src/core/model.js';
import { parse, serialize } from '../src/core/format.js';
import { step, isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { generate, PLAY_SIZES } from '../src/core/gen/generate.js';
import { generateTeleport, TELEPORT_SIZES } from '../src/core/gen/teleport.js';
import { isPortalPair } from '../src/core/geom.js';
import { playGradesFor } from '../src/core/grades.js';
import { modelFor, TELEPORT_MODEL, TRAP_MODEL, trapProfile } from '../src/core/trap.js';
import { boardSvg, routeD, jumpMarksSvg, portalIconsSvg } from '../src/apps/play/board.js';
import { createUnlock } from '../src/features/unlock.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS, variantOf, variantById, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import {
  encodeShare, decodeShare, VARIANTS, SHARE_VERSION_PORTAL, TELEPORT,
} from '../src/core/share-code.js';
import { makeShareRecord, shareStatus, shareText } from '../src/features/share.js';
import { portalD, miniPreviewSvg } from '../src/apps/design/board.js';
import {
  portalColor, portalShape, PORTAL_COLORS, PORTAL_SHAPES,
} from '../src/view/portal-icons.js';
import { ladder } from '../src/core/ladder.js';

const tele = (n, seed, o = {}) => runSync(generateTeleport(n, seed, o));
const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: maxNumber(p), variant: TELEPORT, puzzle: p, ...extra,
});
const pathOf = svg => svg.match(/data-role="path" d="([^"]*)"/)[1];
const jumpSteps = (p, path) => path.filter(
  (cell, i) => i > 0 && isPortalPair(p.portals, path[i - 1], cell),
).length;
const stateOf = (p, path, extra = {}) => ({
  puzzle: p, path, hintCell: null, hintWrongCell: null, finished: false, ...extra,
});

export function teleportPlayTests(t, ta, ok, eq) {
  t('teleport-play: routeD breaks the line at a jump; other puzzles keep pathD', () => {
    const p = tele(6, 2);
    const plain = routeD({ ...p, portals: undefined }, p.path.slice(0, 5));
    eq((plain.match(/M/g) || []).length, 1, 'one M without portals');
    const d = routeD(p, p.path);
    eq((d.match(/M/g) || []).length, jumpSteps(p, p.path) + 1, 'a new M after every jump');
    const first = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
    const upTo = routeD(p, p.path.slice(0, first));
    eq((upTo.match(/M/g) || []).length, 1, 'no jump yet: one piece');
    const standard = runSync(generate(5, 2));
    ok(!/M.*M/.test(routeD(standard, standard.path)), 'a standard line is one piece');
  });

  t('teleport-play: boardSvg shows both cells of each pair with the same '
    + 'icon, one icon style per pair', () => {
    const p = tele(8, 3, { pairs: 2 });
    const svg = boardSvg(stateOf(p, []));
    const found = svg.matchAll(/data-portal-cell="(\d+)" data-pair="(\d+)"/g);
    const cells = [...found].map(m => [+m[1], +m[2]]);
    eq(cells.length, 4, 'four portal cells');
    p.portals.forEach(([a, b], i) => {
      ok(cells.some(([c, k]) => c === a && k === i) && cells.some(([c, k]) => c === b && k === i),
        `pair ${i}`);
    });
    ok(/class="zip-svg teleport/.test(svg), 'teleport class');
    ok(/<polygon[^>]*stroke="var\(--portal-2\)"/.test(svg) && /<circle[^>]*stroke="var\(--portal-1\)"/.test(svg),
      'pair 0 a ring, pair 1 a diamond');
    ok(svg.includes('data-role="jump"'), 'the jump layer');
    // the portal icons are under the path, the numbers above it
    ok(svg.indexOf('data-portal-cell') < svg.indexOf('data-role="path"'), 'icons under the line');
    ok(svg.indexOf('data-role="path"') < svg.indexOf('data-num-cell'), 'numbers above the line');
    const plain = boardSvg(stateOf(runSync(generate(5, 2)), []));
    ok(!/portal|teleport|data-role="jump"/.test(plain), 'a standard board has none of it');
  });

  t('teleport-play: the palette: a colour and a shape per pair, shapes '
    + 'differ so colour is not needed', () => {
    eq(PORTAL_COLORS.length >= 4 && new Set(PORTAL_COLORS).size, PORTAL_COLORS.length,
      'distinct colours');
    eq(new Set(PORTAL_SHAPES.slice(0, 4)).size, 4, 'four shapes');
    eq(portalColor(0), portalColor(PORTAL_COLORS.length), 'wraps round');
    eq(portalShape(0), portalShape(PORTAL_SHAPES.length), 'wraps round');
    ok(portalIconsSvg({ n: 5, portals: [[0, 3]] }).includes('data-portal-cell="3"'));
    eq(portalIconsSvg({ n: 5 }), '', 'no portals, no markup');
  });

  t('teleport-play: jumpMarksSvg — an arc per jump taken; a ring on the '
    + 'partner while the head can jump; none when done', () => {
    const p = tele(6, 4);
    const first = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
    // head on the first portal cell, the partner free: the ring says "tap it"
    const before = jumpMarksSvg(p, p.path.slice(0, first));
    ok(before.includes('data-mark="jump-ready"') && !before.includes('data-mark="jump"'),
      'ring, no arc yet');
    const at = jumpMarksSvg(p, p.path.slice(0, first + 1));
    ok(at.includes('data-mark="jump"') && at.includes('data-mark="jump-end"'),
      'the arc and its arrowhead');
    ok(!at.includes('jump-ready'), 'the partner is visited: no ring');
    eq((jumpMarksSvg(p, p.path).match(/data-mark="jump"/g) || []).length, jumpSteps(p, p.path),
      'one arc per jump');
    eq(jumpMarksSvg(p, p.path.slice(0, first), true), '', 'finished: nothing to tap');
    eq(jumpMarksSvg(p, []), '');
    eq(jumpMarksSvg(runSync(generate(5, 2)), [0, 1]), '', 'standard');
    const svg = boardSvg(stateOf(p, p.path.slice(0, first + 2)));
    ok(svg.includes('data-mark="jump"'), 'the board carries the arcs');
    ok(/data-role="path" d="[^"]*M[^"]*M/.test(svg), 'and the line is in two pieces');
  });

  t('teleport-play: the icon: two portal rings and a dotted jump; the '
    + 'others are unchanged', () => {
    const icon = variantIcon('teleport');
    ok(/class="variant-icon vi-teleport"/.test(icon), 'class');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16, 'sixteen tiles');
    eq((icon.match(/class="vi-portal"/g) || []).length, 2, 'two portal rings');
    eq((icon.match(/class="vi-jump"/g) || []).length, 1, 'one jump');
    for (const name of ['cutout', 'arrows', 'exact', 'wrap', 'loop', 'standard']) {
      ok(!variantIcon(name).includes('vi-teleport'), `${name} has no teleport mark`);
      ok(!variantIcon(name).includes('vi-jump'), `${name} has no jump`);
    }
  });

  t('teleport-play: registry entry: sizes, detect, generator, lucky game, both languages', () => {
    const v = variantById('teleport');
    ok(v && PLAY_VARIANTS.includes(v), 'teleport is registered');
    eq(sizesFor('teleport', PLAY_SIZES), TELEPORT_SIZES);
    eq(sizesFor('teleport', PLAY_SIZES), [5, 6, 7, 8, 9]);
    const p = runSync(v.generate(6, 11));
    eq([Boolean(p.portals), variantOf(p), v.detect(p)], [true, 'teleport', true],
      'a Teleport puzzle is detected');
    eq(variantOf(runSync(generate(6, 11))), null, 'a standard puzzle is not');
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === 'teleport');
    eq(lucky.locked, [5, 6, 7], 'lucky game of a locked variant');
    eq(lucky.pool, [5, 6, 7, 8, 9], 'once unlocked: the sizes of free play');
    for (const key of Object.values(v.keys)) {
      ok(typeof EN[key] === 'string', `EN ${key}`);
      ok(typeof ZH[key] === 'string', `ZH ${key}`);
    }
    ok(typeof EN['game.teleportHint'] === 'string' && typeof ZH['game.teleportHint'] === 'string',
      'the note under the board');
    for (const other of PLAY_VARIANTS.filter(x => x.id !== 'teleport')) {
      ok(!other.detect(p), `${other.id} does not claim a Teleport puzzle`);
    }
  });

  t('teleport-play: share code — round trip, own version, old codes '
    + 'unchanged, damaged codes fail', () => {
    for (const n of [5, 6, 7, 8]) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = tele(n, seed);
        const rec = record(p);
        const code = encodeShare(rec);
        ok(typeof code === 'string' && code.length <= 60,
          `n=${n} seed ${seed}: short code (${code && code.length})`);
        const back = decodeShare(code);
        ok(back && back.variant === TELEPORT, 'decodes as teleport');
        eq(back.n, n);
        eq(back.puzzle.portals, p.portals, 'the pairs');
        eq(Array.from(back.puzzle.cp), Array.from(p.cp), 'numbers');
        eq(Array.from(back.puzzle.walls), Array.from(p.walls), 'walls');
        eq(back.levels, rec.levels, 'levels');
        eq(back.grade, null, 'no grade');
        eq(serialize(back.puzzle), serialize(p), 'the same puzzle text');
        eq(solve(back.puzzle, { limit: 2, nodeCap: 1e9, prop: true }).count, 1,
          'the decoded puzzle is unique');
        const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
        eq(decodeShare(bad), null, 'a mistyped code');
        eq(decodeShare(code.slice(0, -1)), null, 'a truncated code');
      }
    }
    // a Teleport link has its own version number; the type field of the older versions is
    // untouched, so every code made
    // before still reads (this code was made by the version before Teleport)
    eq(SHARE_VERSION_PORTAL, 4);
    ok(VARIANTS.length === 6 && !VARIANTS.includes(TELEPORT),
      'the type field keeps its six types');
    const std = parse('size 6\ncheckpoints 0,0=1 5,5=2 2,2=3\nwalls V,0,1');
    const old = { kind: 'local', variant: null, n: 6, grade: 2, timeS: 9, levels: [], puzzle: std };
    eq(encodeShare(old), 'bAAF8Cdq3yY', 'a standard code is what it was');
    eq(decodeShare('bAAF8Cdq3yY').variant, null);
  });

  t('teleport-play: an unsound Teleport record is not encodable', () => {
    const p = tele(6, 4);
    ok(encodeShare(record(p)) !== null, 'the sound one is');
    const broken = change => {
      const rec = record(p);
      change(rec);
      return encodeShare(rec) === null;
    };
    ok(broken(rec => { delete rec.puzzle.portals; }), 'no portals');
    ok(broken(rec => { rec.puzzle.portals = []; }), 'an empty list');
    ok(broken(rec => {
      const [a, b] = rec.puzzle.portals[0];
      rec.puzzle.portals = [[b, a]];
    }), 'not canonical: higher cell first');
    ok(broken(rec => { rec.puzzle.portals = [[rec.puzzle.cp.indexOf(1), 35]]; }),
      'a portal on a number');
    ok(broken(rec => { rec.puzzle.portals.push(rec.puzzle.portals[0].slice()); }),
      'a cell in two pairs');
    ok(broken(rec => { rec.puzzle.wrap = true; }), 'wrap');
    ok(broken(rec => { rec.puzzle.loop = true; }), 'loop');
    ok(broken(rec => { rec.grade = 2; }), 'a record with a grade');
    ok(broken(rec => { rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 99; }), 'a gap in the numbers');
    // the other types must not take a puzzle with portals, nor a Teleport one a standard puzzle
    const std = { ...record(p), variant: null };
    eq(encodeShare(std), null, 'a standard record with portals');
    const plain = { ...record(p), puzzle: { n: p.n, cp: p.cp.slice(), walls: p.walls.slice() } };
    eq(encodeShare(plain), null, 'a Teleport record without portals');
    for (const other of ['loop', 'wrap', 'exact', 'arrows', 'cutout']) {
      eq(encodeShare({ ...record(p), variant: other }), null, `a ${other} record with portals`);
    }
  });

  t('teleport-play: share record copies the puzzle; text, status, sizes', () => {
    const p = tele(6, 3);
    const rec = record(p);
    const copied = rec.puzzle.portals;
    ok(Array.isArray(copied) && copied !== p.portals && copied[0] !== p.portals[0],
      'the pairs are copied');
    ok(rec.puzzle.walls !== p.walls && rec.puzzle.cp !== p.cp, 'a copy, not the same arrays');
    eq(rec.grade, null, 'no grade');
    eq(rec.variant, TELEPORT);
    const tr = (key, ...args) => EN[key].replace(/\{0\}/g, args[0]);
    eq(shareText(rec, 'https://x/?s=abc', tr).split('\n')[0], 'zigzag Teleport · 6x6',
      'the head line');
    const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
    eq(shareStatus(rec, ctx).status, 'ok', 'playable at once');
    eq(shareStatus(record(tele(5, 3)), ctx).status, 'ok', 'size 5');
  });

  t('teleport-play: grade: trap only, reduced model, no ladder; grid grades as before', () => {
    const p = tele(6, 1);
    eq(modelFor(p), TELEPORT_MODEL, 'the teleport model');
    ok(TELEPORT_MODEL !== TRAP_MODEL, 'not the full model');
    ok(TELEPORT_MODEL.w.altFrac === 0 && TELEPORT_MODEL.w.lTr === 0, 'reduced');
    const g = playGradesFor(p);
    ok(g.legacy === null && g.trap.ok && g.trap.ladTrials === 0, 'trap only');
    ok(Number.isInteger(g.trap.grade) && g.trap.grade >= 0 && g.trap.grade <= 5, 'a grade 0..5');
    ok(ladder(p).error, 'the technique ladder says it does not know portals');
    const grid = runSync(generate(5, 1));
    eq(modelFor(grid), TRAP_MODEL, 'the grid keeps its model');
    ok(playGradesFor(grid).legacy !== null, 'the grid keeps the old grades');
  });

  t('teleport-play: the trap profile counts the portal as a move: '
    + 'walking past a portal cell has the jump as a wrong turn', () => {
    const p = tele(6, 6);
    const snake = [];
    for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) snake.push(r * 6 + (r % 2 ? 5 - k : k));
    const profile = trapProfile(p, snake);
    for (const [a, b] of p.portals) {
      const first = Math.min(snake.indexOf(a), snake.indexOf(b));
      const partner = snake[first] === a ? b : a;
      ok(profile.some(w => w.i === first && w.cell === partner),
        `the jump from step ${first} to ${partner} is a wrong turn`);
    }
    // on the planted path the jump is the right move, so it is never listed as a wrong one
    const planted = trapProfile(p, p.path);
    p.portals.forEach(([a, b]) => {
      const at = p.path.findIndex((c, i) => i && isPortalPair([[a, b]], p.path[i - 1], c));
      ok(!planted.some(w => w.i === at - 1 && w.cell === p.path[at]),
        'the right jump is no wrong turn');
    });
    ok(planted.every(w => Number.isInteger(w.sub)), 'each wrong turn has its refutation size');
  });

  t('teleport-play: a whole game: the planted path played with step() '
    + 'solves it, jump included; undo takes the jump back', () => {
    for (const seed of [1, 2, 3]) {
      const p = tele(6, seed);
      const path = [];
      for (const cell of p.path) {
        ok(step(p, path, cell, { strictOrder: true }) === 'push', `seed ${seed}`);
      }
      ok(isSolved(p, path), `seed ${seed}: solved`);
      ok(jumpSteps(p, path) >= 1, 'a jump was played');
    }
    const p = tele(6, 5);
    const at = p.path.findIndex((c, i) => i && isPortalPair(p.portals, p.path[i - 1], c));
    const path = p.path.slice(0, at + 1);
    eq(step(p, path, p.path[at - 1], { strictOrder: true }), 'pop',
      'stepping back over the jump undoes it');
    eq(path.length, at);
    // the jump needs the head on a portal: from a cell without one a far cell cannot be reached
    eq(step(p, [p.path[0]], p.portals[0][1], { strictOrder: true }), null,
      'a far cell cannot be reached');
  });

  t('teleport-play: design board — portalD breaks at jumps, the mini '
    + 'preview carries the portals', () => {
    const p = tele(6, 2);
    const d = portalD(p.n, p.path, p.portals);
    eq((d.match(/M/g) || []).length, jumpSteps(p, p.path) + 1);
    const svg = miniPreviewSvg(p, p.path, '#fff');
    ok(svg.includes('<path d="M') && (svg.match(/<polygon|<circle/g) || []).length > 4,
      'the path and the portal shapes');
    eq((svg.match(/stroke-dasharray/g) || []).length, 0, 'plain markup');
    const plain = miniPreviewSvg(runSync(generate(5, 2)), null, '#fff');
    ok(!plain.includes('fill-opacity="0.14"'), 'a standard preview has no portals');
  });

  ta('teleport-play: lucky game: 5 to 7 while teleport is locked, 5 to 9 '
    + 'once it is unlocked', async () => {
    const memory = () => {
      const map = new Map();
      return {
        map,
        async get(k) { return map.has(k) ? { value: map.get(k) } : null; },
        async set(k, v) { map.set(k, v); },
      };
    };
    const defs = luckyDefs(PLAY_SIZES);
    const index = defs.findIndex(d => d.id === 'teleport');
    const MON = 20731;
    const at = day => () => new Date(day * 86400000);
    const pick = (...values) => {
      const q = [...values];
      return () => q.shift();
    };
    const store = memory();
    let u = createUnlock(store, defs, at(MON));
    await u.init();
    await u.addChoice();
    await u.takeChoice();
    await u.addToken();
    const seen = [];
    for (let k = 0; k < defs[index].locked.length; k++) {
      const game = await u.begin(pick(index, k));
      seen.push(game.size);
      eq(game.isNew, true, 'a locked variant');
      await u.refund();
    }
    eq(seen, [5, 6, 7], 'locked: 5, 6 and 7');
    await u.begin(pick(index, 0));
    eq((await u.finish(true)).newly, true, 'solved: unlocked');
    u = createUnlock(store, defs, at(20743));
    await u.init();
    const sizes = [];
    for (let k = 0; k < defs[index].pool.length; k++) {
      const game = await u.begin(pick(index, k));
      sizes.push(game.size);
      eq(game.isNew, false, 'an unlocked variant');
      await u.refund();
    }
    eq(sizes, [5, 6, 7, 8, 9], 'unlocked: the sizes of free play');
  });
}
