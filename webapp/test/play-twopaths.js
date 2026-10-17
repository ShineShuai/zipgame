// Tests of the Two paths variant in the play app: the rules of the two drawn paths
// (features/twopaths-play.js), the board (apps/play/board.js), the icon, the registry entry, the
// texts in both languages (the hint button too), the share code and record, the grade. The core and
// the generator are in twopaths.js and twopaths-gen.js. Registered by tests.js:
// twoPathsPlayTests(t, ok, eq).
import { maxNumber } from '../src/core/model.js';
import { canStep } from '../src/core/rules.js';
import { runSync } from '../src/core/run.js';
import { generate, PLAY_SIZES } from '../src/core/gen/generate.js';
import { generateTwoPaths } from '../src/core/gen/twopaths.js';
import { splitPath, colourOfCell, colourNumber } from '../src/core/twopaths.js';
import { playGradesFor } from '../src/core/grades.js';
import { modelFor, TWOPATHS_MODEL, TRAP_MODEL } from '../src/core/trap.js';
import { boardSvg, badgeColorsTwo, COLORS } from '../src/apps/play/board.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS, variantOf, variantById, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { encodeShare, decodeShare, TWO_PATHS } from '../src/core/share-code.js';
import { makeShareRecord, shareStatus, shareText, legLevels } from '../src/features/share.js';
import {
  RED, BLUE, newPaths, pickColour, walkColour, solvedPaths, reached, legsUndoTwo, hintTwo,
} from '../src/features/twopaths-play.js';

const game = (n, seed) => runSync(generateTwoPaths(n, seed));
const stateOf = (p, paths, extra = {}) => ({
  puzzle: p, paths, path: paths[RED], colour: RED, hintCell: null, hintWrongCell: null,
  finished: false, ...extra,
});
// Draws `cells` as one drag of the colour a press on the first one picks, the way the app does.
const draw = (p, paths, cells, current = RED) => {
  const colour = pickColour(p, paths, cells[0], current);
  const kinds = cells.map(cell => walkColour(p, paths, colour, cell));
  return { colour, kinds };
};
const placeholders = text => (text.match(/\{\d\}/g) || []).sort().join('');
const CJK = /[\u4e00-\u9fff]/;

export function twoPathsPlayTests(t, ok, eq) {
  t('twopaths-play: texts — every key in both languages, the hint button too', () => {
    const v = variantById('twopaths');
    const keys = [
      ...Object.values(v.keys), 'game.twopathsHint', 'game.twopathsRed', 'game.twopathsBlue',
      'game.hint',
    ];
    for (const key of keys) {
      ok(typeof EN[key] === 'string' && EN[key], `EN ${key}`);
      ok(typeof ZH[key] === 'string' && ZH[key], `ZH ${key}`);
      eq(placeholders(ZH[key]), placeholders(EN[key]), `${key}: the same placeholders`);
    }
    eq(placeholders(EN['game.hint']), '{0}{1}', 'the hint button shows used and allowed');
    for (const key of ['game.hint', 'mode.twopaths', 'mode.twopathsRules']) {
      ok(CJK.test(ZH[key]), `${key} is Chinese`);
    }
    eq(Object.keys(EN).sort(), Object.keys(ZH).sort(), 'both dictionaries have the same keys');
    const label = EN['game.hint'].replace('{0}', 2).replace('{1}', 7);
    eq(label, 'Hint (2/7)', 'the English label as before');
  });

  t('twopaths-play: registry entry: sizes, detect, generator, lucky game', () => {
    const v = variantById('twopaths');
    ok(v && PLAY_VARIANTS.includes(v), 'twopaths is registered');
    eq(sizesFor('twopaths', PLAY_SIZES), [5, 6, 7, 8]);
    const p = runSync(v.generate(6, 11));
    eq([Boolean(p.split), variantOf(p), v.detect(p)], [true, 'twopaths', true]);
    eq(variantOf(runSync(generate(6, 11))), null, 'a standard puzzle is not');
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === 'twopaths');
    eq(lucky.locked, [5, 6, 7], 'lucky game of a locked variant');
    eq(lucky.pool, [5, 6, 7, 8], 'once unlocked: the sizes of free play');
    for (const other of PLAY_VARIANTS.filter(x => x.id !== 'twopaths')) {
      ok(!other.detect(p), `${other.id} does not claim a Two paths puzzle`);
    }
  });

  t('twopaths-play: the icon: a red and a blue path, the others unchanged', () => {
    const icon = variantIcon('twopaths');
    ok(/class="variant-icon vi-twopaths"/.test(icon), 'class');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16, 'sixteen tiles');
    eq((icon.match(/vi-path-red/g) || []).length, 1);
    eq((icon.match(/vi-path-blue/g) || []).length, 1);
    eq((icon.match(/vi-dot-red/g) || []).length, 2, 'two ends');
    eq((icon.match(/vi-dot-blue/g) || []).length, 2, 'two ends');
    for (const name of ['cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'standard']) {
      ok(!variantIcon(name).includes('vi-twopaths'), `${name} has no Two paths mark`);
      ok(!variantIcon(name).includes('vi-path-red'), `${name} has no red path`);
    }
  });

  t('twopaths-play: boardSvg — a line and a badge shape per colour, blue numbers from 1', () => {
    const p = game(6, 3);
    const [red, blue] = splitPath(p, p.path);
    const K = maxNumber(p);
    const svg = boardSvg(stateOf(p, newPaths()));
    ok(/class="zip-svg[^"]*twopaths/.test(svg), 'twopaths class');
    eq((svg.match(/<path data-role="path" data-colour="\d"/g) || []).length, 2, 'two lines');
    for (const ink of COLORS.twoPath) ok(svg.includes(`stroke="${ink}"`), `a line in ${ink}`);
    eq((svg.match(/<circle class="num-shape"/g) || []).length, p.split, 'a circle per red number');
    const squares = (svg.match(/<rect class="num-shape"/g) || []).length;
    eq(squares, K - p.split, 'a square per blue number');
    const blueNumbers = [...svg.matchAll(/data-colour="1">[^]*?<text[^>]*>(\d+)<\/text>/g)]
      .map(m => +m[1]).sort((a, b) => a - b);
    eq(blueNumbers, Array.from({ length: K - p.split }, (_, i) => i + 1), 'blue counts from 1');
    const redNumbers = [...svg.matchAll(/data-colour="0">[^]*?<text[^>]*>(\d+)<\/text>/g)]
      .map(m => +m[1]).sort((a, b) => a - b);
    eq(redNumbers, Array.from({ length: p.split }, (_, i) => i + 1), 'red counts from 1');
    eq((svg.match(/data-role="path" data-colour="\d" d=""/g) || []).length, 2, 'nothing drawn yet');
    // a drawn red line, a reached red number is filled with red, a blue one stays an idle ring
    const drawn = stateOf(p, [red.slice(0, 3), []]);
    const withLine = boardSvg(drawn);
    ok(/data-colour="0" d="M[^"]+L/.test(withLine), 'the red line is drawn');
    ok(/data-colour="1" d=""/.test(withLine), 'the blue one is not');
    const cell0 = `data-num-cell="${red[0]}" data-colour="0"`;
    const start = new RegExp(`${cell0}><circle[^>]*fill="#e5484d"`);
    ok(start.test(withLine), 'red 1 is filled red');
    const idle = new RegExp(`data-num-cell="${blue[0]}" data-colour="1"><rect[^>]*fill="#ffffff"`);
    ok(idle.test(withLine), 'blue 1 is still a white square');
    eq(badgeColorsTwo(BLUE, true).fill, COLORS.twoPath[BLUE]);
    eq(badgeColorsTwo(RED, false).stroke, COLORS.twoPath[RED]);
    // a standard board is what it was
    const std = runSync(generate(5, 2));
    const bare = { puzzle: std, path: [], hintCell: null, hintWrongCell: null, finished: false };
    const plain = boardSvg(bare);
    ok(!/num-shape|data-colour|twopaths/.test(plain), 'a standard board has none of it');
    eq((plain.match(/data-role="path"/g) || []).length, 1, 'one line');
  });

  t('twopaths-play: a whole game — red, then blue, interleaved; every move accepted', () => {
    for (const seed of [1, 2, 3]) {
      const p = game(6, seed);
      const [red, blue] = splitPath(p, p.path);
      const paths = newPaths();
      const a = draw(p, paths, red);
      eq([a.colour, a.kinds.every(k => k === 'push')], [RED, true], `seed ${seed}: red`);
      ok(!solvedPaths(p, paths), 'half is not solved');
      const b = draw(p, paths, blue, a.colour);
      eq([b.colour, b.kinds.every(k => k === 'push')], [BLUE, true], `seed ${seed}: blue`);
      ok(solvedPaths(p, paths), `seed ${seed}: solved`);
      eq(paths, [red, blue]);
    }
    // interleaved: a bit of red, a bit of blue, red goes on from its head, blue from its head
    const p = game(7, 4);
    const [red, blue] = splitPath(p, p.path);
    const paths = newPaths();
    let colour = RED;
    const turns = [[RED, 0, 4], [BLUE, 0, 3], [RED, 4, red.length], [BLUE, 3, blue.length]];
    for (const [c, from, to] of turns) {
      const part = (c === RED ? red : blue).slice(from, to);
      // a press on the head cell goes on with that path (pickColour: a path's own cell)
      const press = from === 0 ? part[0] : (c === RED ? red : blue)[from - 1];
      eq(pickColour(p, paths, press, colour), c, 'the press picks its colour');
      colour = c;
      for (const cell of part) eq(walkColour(p, paths, c, cell), 'push', `cell ${cell}`);
    }
    ok(solvedPaths(p, paths), 'interleaved: solved');
  });

  t('twopaths-play: walkColour refuses what the rules refuse', () => {
    let touching = 0;
    let numbers = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const p = game(6, seed);
      const [red, blue] = splitPath(p, p.path);
      // a path starts on its own 1 only
      eq(walkColour(p, newPaths(), RED, blue[0]), null, 'red cannot start on blue 1');
      eq(walkColour(p, newPaths(), BLUE, red[0]), null, 'blue cannot start on red 1');
      eq(walkColour(p, newPaths(), RED, red[1]), null, 'a path starts on a 1');
      // one step back is an undo
      const paths = [red.slice(0, 3), []];
      eq(walkColour(p, paths, RED, red[1]), 'pop');
      eq(paths[RED], red.slice(0, 2));
      // a cell of the other path
      for (let i = 0; i < red.length; i++) {
        for (let j = 0; j < blue.length; j++) {
          if (!canStep(p, red[i], blue[j])) continue;
          const both = [red.slice(0, i + 1), blue.slice(0, j + 1)];
          if (colourOfCell(p, blue[j]) < 0 && i > 0) {
            eq(walkColour(p, both, RED, blue[j]), null, `seed ${seed}: red onto blue's cell`);
            eq(both[RED], red.slice(0, i + 1), 'nothing moved');
            touching++;
          }
          if (colourOfCell(p, blue[j]) === BLUE && !both[BLUE].includes(blue[j])) numbers++;
        }
      }
      // a number of the other colour, though no path is on it yet
      for (let i = 1; i < red.length; i++) {
        for (const cell of blue) {
          if (colourOfCell(p, cell) !== BLUE || !canStep(p, red[i], cell)) continue;
          const paths2 = [red.slice(0, i + 1), []];
          eq(walkColour(p, paths2, RED, cell), null, `seed ${seed}: red onto a blue number`);
          numbers++;
        }
      }
    }
    ok(touching > 5 && numbers > 0, `${touching} touching cells, ${numbers} blue numbers checked`);
  });

  t('twopaths-play: pickColour — a path\'s cell, a number, the head that can step there', () => {
    const p = game(7, 5);
    const [red, blue] = splitPath(p, p.path);
    const none = newPaths();
    eq(pickColour(p, none, red[0], BLUE), RED, 'a press on red 1 draws red');
    eq(pickColour(p, none, blue[0], RED), BLUE, 'a press on blue 1 draws blue');
    const free = p.cp.findIndex((v, cell) => !v && cell !== red[1]);
    eq(pickColour(p, none, free, BLUE), BLUE, 'a free cell: the colour drawn now');
    eq(pickColour(p, none, free), RED, 'the default is red');
    const paths = [red.slice(0, 3), blue.slice(0, 3)];
    eq(pickColour(p, paths, red[1], BLUE), RED, 'a cell of the red path');
    eq(pickColour(p, paths, blue[2], RED), BLUE, 'a cell of the blue path');
    // a free cell next to the red head only: red, whatever was drawn last
    const next = red[3];
    if (colourOfCell(p, next) < 0 && !canStep(p, blue[2], next)) {
      eq(pickColour(p, paths, next, BLUE), RED, 'the head that can step there');
    }
    const blueNumber = blue.find((cell, i) => i > 0 && colourOfCell(p, cell) === BLUE);
    eq(pickColour(p, [red.slice(0, 1), []], blueNumber, RED), BLUE, 'a blue number is blue');
  });

  t('twopaths-play: reached, solvedPaths refuse a half or a swapped solution', () => {
    const p = game(6, 2);
    const [red, blue] = splitPath(p, p.path);
    eq(reached(p, newPaths()), [0, 0]);
    eq(reached(p, [red, blue]), [p.split, maxNumber(p) - p.split]);
    eq(reached(p, [red.slice(0, 1), []]), [1, 0]);
    ok(solvedPaths(p, [red, blue]));
    ok(!solvedPaths(p, [blue, red]), 'swapped');
    ok(!solvedPaths(p, [red, blue.slice(0, -1)]), 'a cell short');
    ok(!solvedPaths(p, newPaths()));
  });

  t('twopaths-play: legsUndoTwo — the legs of the blue path come after the red ones', () => {
    const found = { [RED]: 0, [BLUE]: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const p = game(7, seed);
      const parts = splitPath(p, p.path);
      for (const colour of [RED, BLUE]) {
        const part = parts[colour];
        const second = part.findIndex((cell, i) => i > 0 && colourOfCell(p, cell) === colour);
        if (second < 0 || second >= part.length - 1) continue;
        // the head one cell past the colour's 2nd number, and takes that cell back
        const prev = part.slice(0, second + 2);
        const legs = [];
        legsUndoTwo(legs, p, colour, prev, second + 1);
        const offset = colour === RED ? 0 : p.split;
        const filled = legs.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
        eq(filled, [offset + 1], `seed ${seed} colour ${colour}: leg after the 2nd number`);
        eq(legs[offset + 1], 1);
        found[colour]++;
      }
    }
    ok(found[RED] > 0 && found[BLUE] > 0, `checked ${found[RED]} red, ${found[BLUE]} blue`);
    // nothing taken back, nothing counted
    const p = game(6, 1);
    const legs = [];
    legsUndoTwo(legs, p, RED, splitPath(p, p.path)[0], splitPath(p, p.path)[0].length);
    eq(legs, []);
  });

  t('twopaths-play: hintTwo — next cell, wrong cell, the other colour once one is done', () => {
    const p = game(6, 4);
    const [red, blue] = splitPath(p, p.path);
    eq(hintTwo(p, newPaths(), RED), { colour: RED, correctCell: red[0], wrongCell: null });
    eq(hintTwo(p, newPaths(), BLUE), { colour: BLUE, correctCell: blue[0], wrongCell: null });
    eq(hintTwo(p, [red.slice(0, 3), []], RED).correctCell, red[3], 'on track: the next cell');
    // red is finished: the hint is for blue
    eq(hintTwo(p, [red, blue.slice(0, 2)], RED),
      { colour: BLUE, correctCell: blue[2], wrongCell: null });
    // red went wrong at its 2nd cell
    const stray = p.cp.findIndex((v, cell) => cell !== red[0] && cell !== red[1]);
    eq(hintTwo(p, [[red[0], stray], []], RED),
      { colour: RED, correctCell: red[1], wrongCell: stray });
    eq(hintTwo(p, [red, blue], RED), { colour: RED, correctCell: null, wrongCell: null }, 'done');
    // a solution that is not stored is found by the solver
    const bare = { ...p };
    delete bare.path;
    eq(hintTwo(bare, newPaths(), RED).correctCell, red[0], 'the solver finds it');
  });

  t('twopaths-play: share code and record — round trip, K-1 legs, both languages', () => {
    for (const n of [5, 6, 7, 8]) {
      const p = game(n, 2);
      const K = maxNumber(p);
      const legs = [];
      legs[1] = 2;
      legs[p.split + 1] = 4;
      const rec = makeShareRecord({ n, timeS: 51.2, legs, K, variant: TWO_PATHS, puzzle: p });
      eq(rec.variant, TWO_PATHS);
      eq(rec.grade, null, 'no grade');
      eq(rec.puzzle.split, p.split, 'the split is copied');
      ok(rec.puzzle.walls !== p.walls && rec.puzzle.cp !== p.cp, 'a copy, not the same arrays');
      eq(rec.levels, legLevels(legs, K));
      eq(rec.levels.length, K - 1, 'one square per leg');
      const code = encodeShare(rec);
      ok(typeof code === 'string' && code.length <= 60, `n=${n}: short code (${code?.length})`);
      const back = decodeShare(code);
      ok(back && back.variant === TWO_PATHS, 'decodes as twopaths');
      eq([back.n, back.puzzle.split, back.levels], [n, p.split, rec.levels]);
      eq(variantOf(back.puzzle), 'twopaths', 'the receiver plays it as Two paths');
      const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
      eq(shareStatus(rec, ctx).status, 'ok', 'playable at once');
      const tr = dict => (key, ...args) => dict[key].replace(/\{0\}/g, args[0]);
      eq(shareText(rec, 'https://x/?s=abc', tr(EN)).split('\n')[0], `Zip Two paths · ${n}x${n}`);
      eq(shareText(rec, 'https://x/?s=abc', tr(ZH)).split('\n')[0], `Zip 双路径 · ${n}x${n}`);
    }
  });

  t('twopaths-play: grade — trap only, the reduced model, no ladder', () => {
    const p = game(6, 1);
    eq(modelFor(p), TWOPATHS_MODEL);
    ok(TWOPATHS_MODEL !== TRAP_MODEL, 'not the full model');
    ok(TWOPATHS_MODEL.w.altFrac === 0 && TWOPATHS_MODEL.w.lTr === 0, 'reduced');
    const g = playGradesFor(p);
    ok(g.legacy === null && g.trap.ok && g.trap.ladTrials === 0, 'trap only');
    ok(Number.isInteger(g.trap.grade) && g.trap.grade >= 0 && g.trap.grade <= 5, 'a grade 0..5');
    eq(colourNumber(p, p.split + 1), 1, 'colourNumber');
  });
}
