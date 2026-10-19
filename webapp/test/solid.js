// Tests of the 3D puzzles of the play app and what the design app shares with it: the navigation
// helpers (view/solid-nav.js), the palettes of the picture (view/surface-board.js), the icons and
// texts, and the card of the menu (apps/play/solid.js; its DOM parts run in a browser).
// Registered by tests.js: solidTests(t, ok, eq).
import { BALL_KIND, SLOTS, surfaceTopology } from '../src/core/surface/topology.js';
import { BALL_CATALOG } from '../src/core/surface/ball-catalog.js';
import { registerBalls } from '../src/core/surface/ball-registry.js';
import { loadBalls } from '../src/core/surface/balls.js';
import { buildNet } from '../src/view/surface-net.js';
import { computeHint } from '../src/features/hints.js';
import { canPush, makeSurfacePuzzle } from '../src/core/surface/puzzle.js';
import { generateSurface } from '../src/core/surface/gen.js';
import { IDENTITY, buildView, cellDirection, orbit, overview, turn } from '../src/view/proj.js';
import { behind, buildBallView } from '../src/view/ball.js';
import { DARK_PALETTE, LIGHT_PALETTE, surfaceSvg } from '../src/view/surface-board.js';
import * as designBoard from '../src/apps/design/surface-board.js';
import {
  ARROW_TURN,
  FOLLOW_DONE,
  FOLLOW_EDGE,
  createTurner,
  crossedCut,
  headTurnedAway,
} from '../src/view/solid-nav.js';
import { SOLID_KINDS, createSolidPlay, isSolidKind } from '../src/apps/play/solid.js';
import { variantIcon, cardIcon } from '../src/apps/play/icons.js';
import { releaseDays } from '../src/features/solid-release.js';
import { EN, ZH, t as translate } from '../src/ui/i18n.js';

// the channels of every fill="rgb(r,g,b)" in a markup
const fills = markup => [...markup.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)]
  .map(match => match.slice(1).map(Number));

registerBalls(BALL_CATALOG);

export function solidTests(t, ok, eq) {
  t('solid nav: the turn that follows the head', () => {
    const ball = surfaceTopology(BALL_KIND, 'snub-cube');
    const R = overview(ball);
    const facing = buildBallView(ball, R);
    const head = facing.depth.indexOf(Math.max(...facing.depth));
    ok(!headTurnedAway(ball, facing, [head], true), 'the head faces the viewer');
    ok(headTurnedAway(ball, buildBallView(ball, behind(R)), [head], true), 'the head is behind');
    // near the rim counts as turned away for a ball
    const rim = facing.depth.findIndex(z => z > 0 && z < FOLLOW_EDGE - 0.02);
    if (rim >= 0) {
      ok(headTurnedAway(ball, facing, [rim], true), 'a cell near the rim');
    }
    const cube = surfaceTopology('cube', 3);
    const view = buildView(cube, overview(cube));
    const away = view.hidden.findIndex(hidden => hidden === 1);
    ok(headTurnedAway(cube, view, [away], false), 'a cell on the far side of a cube');

    // the turner runs frames until the cell faces the viewer, and stops when told to
    const frames = [];
    const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    globalThis.requestAnimationFrame = callback => frames.push(callback);
    globalThis.cancelAnimationFrame = id => {
      frames[id - 1] = null;
    };
    try {
      let rotation = IDENTITY;
      let drawn = 0;
      const turner = createTurner({
        getRotation: () => rotation,
        setRotation: next => {
          rotation = next;
        },
        redraw: () => {
          drawn++;
        },
      });
      turner.toward(ball, head);
      let guard = 0;
      while (frames.length && guard++ < 200) {
        const frame = frames.shift();
        if (frame) {
          frame();
        }
      }
      ok(turn(rotation, cellDirection(ball, head))[2] >= FOLLOW_DONE, 'the head faces the viewer');
      ok(drawn > 1 || turn(IDENTITY, cellDirection(ball, head))[2] >= FOLLOW_DONE);
      // stop() ends a turn in progress
      rotation = IDENTITY;
      turner.toward(ball, head);
      const before = frames.length;
      turner.stop();
      ok(before === 1 && frames.every(frame => frame === null), 'stopped');
    } finally {
      [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
    }
    eq(Object.keys(ARROW_TURN).sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);
    const R2 = orbit(IDENTITY, ...ARROW_TURN.ArrowRight);
    ok(Math.abs(turn(R2, [0, 0, 1])[0]) > 0.1, 'an arrow key turns');
  });

  t('surface board: the palette of the picture, and the design app shares the drawing', () => {
    eq(designBoard.surfaceSvg === surfaceSvg, true, 'one drawing for both apps');
    const made = generateSurface(BALL_KIND, 'snub-cube', 3, { K: 6 });
    const top = surfaceTopology(BALL_KIND, 'snub-cube');
    const view = buildBallView(top, orbit(overview(top), 0.3, 0.2));
    const state = {
      P: made.puzzle,
      selected: -1,
      buffer: '',
      playing: true,
      path: made.path.slice(0, 12),
      template: null,
      solutions: [],
      visible: [],
    };
    const dark = surfaceSvg(view, state).markup;
    const light = surfaceSvg(view, { ...state, palette: LIGHT_PALETTE }).markup;
    ok(fills(dark).every(rgb => Math.max(...rgb) < 140), 'the default palette is dark');
    ok(fills(light).every(rgb => Math.min(...rgb) > 120), 'the light palette is light');
    ok(dark.includes(DARK_PALETTE.play) && !light.includes(DARK_PALETTE.play), 'path colour');
    ok(light.includes(LIGHT_PALETTE.play), 'the orange path of the flat game');
    ok(!light.includes('NaN') && !dark.includes('NaN'));
    // the gloss of the ball takes its light and dark from the palette
    ok(light.includes(`stop-opacity="${LIGHT_PALETTE.gloss.light}"`));
    ok(dark.includes(`stop-opacity="${DARK_PALETTE.gloss.dark}"`));
    // tetra and cube take the palette too (a tint for each face)
    const cube = surfaceTopology('cube', 3);
    const solid = surfaceSvg(buildView(cube, overview(cube)), {
      ...state,
      P: makeSurfacePuzzle('cube', 3),
      path: [],
      palette: LIGHT_PALETTE,
    }).markup;
    ok(fills(solid).length > 5 && fills(solid).every(rgb => Math.min(...rgb) > 120));
  });

  t('play app: icons and texts of the 3D puzzles', () => {
    eq(SOLID_KINDS, ['tetra', 'cube', 'ball']);
    ok(isSolidKind('ball') && !isSolidKind('cutout') && !isSolidKind(undefined));
    const icons = SOLID_KINDS.map(kind => variantIcon(kind));
    SOLID_KINDS.forEach((kind, i) => {
      ok(icons[i].startsWith('<svg') && icons[i].includes(`vi-${kind}`), `${kind}: an icon`);
      ok(!icons[i].includes('undefined'));
    });
    eq(new Set(icons).size, 3, 'three different icons');
    ok(cardIcon('solid').includes('<path'), 'the icon of the card');
    for (const kind of SOLID_KINDS) {
      for (const key of [`mode.${kind}`, `mode.${kind}Tag`, `mode.${kind}Rules`]) {
        ok(EN[key] && ZH[key], `${key} in both languages`);
      }
    }
    for (const key of ['gen.subSolid', 'game.tetraTitle', 'game.cubeTitle', 'game.ballTitle',
      'solid.title', 'solid.turn', 'solid.netNote', 'solid.mapNote', 'solid.follow',
      'solid.followTip', 'solid.followOn', 'solid.followOff']) {
      ok(EN[key] && ZH[key], `${key} in both languages`);
    }
    eq(translate('solid.cells', 1), '1 cell');
    eq(translate('solid.cells', 36), '36 cells');
  });

  t('play app: the card of the 3D puzzles in the menu', () => {
    const make = showDev => createSolidPlay({
      S: { showDev, screen: 'menu' },
      $: () => null,
      t: translate,
      render: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => 1,
    });
    const hidden = make(false).cardHtml();
    ok(/id="solidCard" style="display:none"/.test(hidden), 'hidden unless V is held');
    const shown = make(true).cardHtml();
    ok(/id="solidCard" style=""/.test(shown), 'shown while V is held');
    eq((shown.match(/name="solid"/g) || []).length, 3, 'a tile for each of the three');
    ok(shown.includes('id="playSolid"') && shown.includes('id="solidSel"'));
    // the default is the ball: Random, then every playable shape (never one with no solution)
    const options = [...shown.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
    eq(options[0], 'random');
    const playable = BALL_CATALOG.filter(entry => entry.ok).map(entry => entry.id);
    eq(options.slice(1).sort(), playable.slice().sort(), 'the playable balls');
    ok(!options.includes('cuboct') && !options.includes('icosidodeca'));
    ok(shown.includes('<optgroup label="80 triangles + 12 pentagons · 92 cells">'));
  });

  t('solid nav: leaving the head over a cut of a net steps to the cell across it', () => {
    const top = surfaceTopology('tetra', 3);
    const net = buildNet(top);
    let cut = null;
    let glued = null;
    for (let cell = 0; cell < top.T && !(cut && glued); cell++) {
      for (let slot = 0; slot < top.deg[cell]; slot++) {
        if (!net.glued[cell * SLOTS + slot]) {
          cut = cut || [cell, slot];
        } else {
          glued = glued || [cell, slot];
        }
      }
    }
    const through = ([cell, slot]) => {
      const poly = net.polys[cell];
      const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const [cx, cy] = net.centers[cell];
      return { from: [cx, cy], past: [mid[0] + (mid[0] - cx) * 0.5, mid[1] + (mid[1] - cy) * 0.5], mid };
    };
    const out = through(cut);
    const across = top.nb[cut[0] * SLOTS + cut[1]];
    eq(crossedCut(top, net, cut[0], out.from, out.past), across, 'out over a cut: the cell across');
    const [cx, cy] = net.centers[cut[0]];
    const inside = [(cx + out.mid[0]) / 2, (cy + out.mid[1]) / 2];
    eq(crossedCut(top, net, cut[0], [cx, cy], inside), -1, 'inside the cell');
    const inner = through(glued);
    eq(crossedCut(top, net, glued[0], inner.from, inner.past), -1, 'over a side that is not cut');
  });

  t('surface board: the way on over a cut, and the hint rings', () => {
    const made = generateSurface('tetra', 3, 2);
    const top = surfaceTopology('tetra', 3);
    const net = buildNet(top);
    // the first cell of the path with a cut side that the path can go on over
    let at = -1;
    for (let i = 0; i < made.path.length - 1 && at < 0; i++) {
      for (let slot = 0; slot < top.deg[made.path[i]]; slot++) {
        const cell = made.path[i];
        const next = top.nb[cell * SLOTS + slot];
        if (!net.glued[cell * SLOTS + slot] && next === made.path[i + 1]) {
          at = i;
        }
      }
    }
    ok(at >= 0, 'the path crosses a cut');
    const path = made.path.slice(0, at + 1);
    const state = {
      P: made.puzzle,
      selected: -1,
      buffer: '',
      playing: true,
      path,
      template: null,
      solutions: [],
      visible: [],
      palette: LIGHT_PALETTE,
      continues: (from, to) => canPush(made.puzzle, path, to, { strictOrder: true }),
    };
    const count = (markup, name) =>
      (markup.match(new RegExp(`class="${name}"`, 'g')) || []).length;
    const shown = surfaceSvg(net, state).markup;
    ok(count(shown, 'sf-land') >= 1 && count(shown, 'sf-arrow') >= 2, 'arrows and a pulse');
    const none = surfaceSvg(net, { ...state, continues: () => false }).markup;
    eq(count(none, 'sf-land'), 0, 'nothing to show when the path may not go on');
    // a path that has just come in over a cut: the cell it came in by pulses
    const came = made.path.slice(0, at + 2);
    const arrived = surfaceSvg(net, { ...state, path: came, continues: () => false });
    ok(count(arrived.markup, 'sf-land') === 1, 'the cell the path came in by');
    const ringed = surfaceSvg(net, { ...state, hintCell: made.path[at + 1], hintWrongCell: 0 }).markup;
    eq(count(ringed, 'sf-hint'), 1, 'the hinted cell');
    eq(count(ringed, 'sf-wrong'), 1, 'the wrong cell');
    eq(count(surfaceSvg(net, state).markup, 'sf-hint'), 0, 'no hint, no ring');
    // the hint of the flat game works on a path of a surface puzzle: the next cell, or the wrong one
    eq(computeHint(made.path, []).correctCell, made.path[0]);
    const wrong = made.path.slice(0, 3).concat([made.path[5]]);
    const hint = computeHint(made.path, wrong);
    eq([hint.correctCell, hint.wrongCell], [made.path[3], made.path[5]]);
  });

  t('play app: the card lists only Random until the ball catalog is loaded', () => {
    const make = () => createSolidPlay({
      S: { showDev: true, screen: 'menu' },
      $: () => null,
      t: translate,
      render: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => 1,
      openExport: () => {},
    });
    registerBalls([]);
    try {
      const options = [...make().cardHtml().matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
      eq(options, ['random'], 'no catalog, no balls yet');
    } finally {
      registerBalls(BALL_CATALOG);
    }
    ok(loadBalls() instanceof Promise, 'loading is a promise');
  });

  t('play app: the card of the 3D puzzles follows the release dates', () => {
    const rel = releaseDays({ first: 20261201, tetra: 7, cube: 21, ball: 35 });
    const make = (day, { unlocked = () => false, showDev = false, release = rel } = {}) => (
      createSolidPlay({
        S: { showDev, screen: 'menu' },
        $: () => null,
        t: translate,
        render: () => {},
        startTimer: () => {},
        stopTimer: () => {},
        randomSeed: () => 1,
        release,
        today: () => day,
        unlocked,
      }).cardHtml()
    );
    const tiles = html => [...html.matchAll(/id="solidOpt-(\w+)"( style="display:none")?/g)]
      .filter(match => !match[2])
      .map(match => match[1]);
    const sizes = html => [...html.matchAll(/<option value="(\d+)"/g)]
      .map(match => Number(match[1]));
    const locked = html => (html.match(/variant-locked/g) || []).length;
    const hiddenCard = /id="solidCard" style="display:none"/;
    const first = rel.first;

    ok(hiddenCard.test(make(first - 1)), 'hidden before the first day');
    ok(hiddenCard.test(make(first, { release: null })), 'hidden when nothing is released');
    let html = make(first);
    ok(/id="solidCard" style=""/.test(html), 'shown from the first day');
    eq([tiles(html), sizes(html)], [['tetra'], [2]], 'the first day: tetra of size 2 only');
    ok(/value="tetra"[^>]*checked/.test(html), 'and it is the picked tile');
    ok(html.includes('2 (16 cells)'));
    html = make(first + 7);
    eq([tiles(html), sizes(html)], [['tetra'], [2, 3, 4, 5]], 'a week later: every size');
    eq(tiles(make(first + 21)), ['tetra', 'cube'], 'three weeks later: the cube');
    eq(tiles(make(first + 35)), ['tetra', 'cube', 'ball'], 'five weeks later: the ball');

    html = make(first, { unlocked: kind => kind === 'cube' });
    eq([tiles(html), sizes(html)], [['tetra', 'cube'], [2]], 'a kind won in the lucky game');

    html = make(first - 30, { showDev: true });
    eq(tiles(html), ['tetra', 'cube', 'ball'], 'V shows everything, before the release too');
    eq(locked(html), 3, 'the kinds nobody can play yet are marked');
    eq(locked(make(first)), 2, 'cube and ball are marked, the tetra is not');
  });
}
