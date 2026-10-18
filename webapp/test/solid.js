// Tests of the 3D puzzles of the play app and what the design app shares with it: the navigation
// helpers (view/solid-nav.js), the palettes of the picture (view/surface-board.js), the icons and
// texts, and the card of the menu (apps/play/solid.js; its DOM parts run in a browser).
// Registered by tests.js: solidTests(t, ok, eq).
import { BALL_KIND, surfaceTopology } from '../src/core/surface/topology.js';
import { BALL_CATALOG } from '../src/core/surface/ball-catalog.js';
import { makeSurfacePuzzle } from '../src/core/surface/puzzle.js';
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
  headTurnedAway,
} from '../src/view/solid-nav.js';
import { SOLID_KINDS, createSolidPlay, isSolidKind } from '../src/apps/play/solid.js';
import { variantIcon, cardIcon } from '../src/apps/play/icons.js';
import { EN, ZH, t as translate } from '../src/ui/i18n.js';

// the channels of every fill="rgb(r,g,b)" in a markup
const fills = markup => [...markup.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)]
  .map(match => match.slice(1).map(Number));

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
      'solid.title', 'solid.turn', 'solid.netNote', 'solid.mapNote', 'solid.follow']) {
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
}
