// The solid puzzles of the play app: a tetrahedron, a cube or a ball, drawn as a solid you
// turn. Three parts: the card of the menu (a dedicated card, shown from the release day in
// config.js SOLID_RELEASE, features/solid-release.js, and for a player who unlocked a kind
// in the lucky game; while V is held it shows everything, and a tile picked then stays
// until the page is reloaded), the game screen, and the game itself (a path through every
// cell, the numbers in order, as on the flat board). The lucky game can draw a solid kind
// (game-flow.js startLucky): the same game screen, one try.
//
// The board is a puzzle of the cell-graph engine (core/surface/), the picture is view/surface-board.js in the
// light palette, and the turning is view/solid-nav.js. A solid game has hints (with the time penalty
// of the flat game) and, while V is held, an export; it has no stats, no streak and no share link:
// it is played for fun. main.js owns the page (render, timer, dev reveal, export window); it hands
// what this module needs in `app`:
//   S, $, t, render, startTimer, stopTimer, randomSeed, openExport
import {
  BALL_KIND,
  SLOTS,
  ballEntry,
  surfaceTopology,
} from '../../core/surface/topology.js';
import {
  ballsByComposition,
  ballsLoaded,
  loadBalls,
  pickBall,
} from '../../core/solid/balls.js';
import { canPush, isSolved, serializeSurface, step } from '../../core/surface/puzzle.js';
import { solidIsDark } from '../../themes/art-state.js';
import { HINT_PENALTY_S, computeHint, penalizedTime } from '../../features/hints.js';
import { IDENTITY, buildView, cellDirection, orbit, turnToward } from '../../view/proj.js';
import { buildNet, slotBetween } from '../../view/surface-net.js';
import { behind, buildBallView } from '../../view/ball.js';
import { LIGHT_PALETTE, PLAY_DARK_PALETTE, surfaceSvg } from '../../view/surface-board.js';
import {
  ARROW_TURN,
  ORBIT_SLOP,
  ORBIT_SPEED,
  FOLLOW_EDGE,
  createTurner,
  crossedCut,
  headTurnedAway,
} from '../../view/solid-nav.js';
import { cancellable, isAbort, isTimeout } from '../../platform/run.js';
import { runGeneration } from './gen-runner.js';
import {
  sfxBack,
  sfxBlocked,
  sfxCheckpoint,
  sfxMove,
  sfxMoveAfterCheckpoint,
  sfxSolved,
} from '../../platform/sound.js';
import { SOLID_KINDS, SOLID_SIZES, openSizes, stageOf } from '../../features/solid-release.js';
import { actionIcon, cardIcon, variantIcon } from './icons.js';
import {
  edgeVelocity, fitCamera, isZoomed, viewBoxAttr, viewOf,
} from '../../view/camera.js';
import { classifyPair, createRouter } from './gesture.js';
import { createZoom } from './zoom.js';
import { setupZoomTools, zoomToolsHtml } from './zoom-ui.js';

export { SOLID_KINDS };

// Dragging at the edge of a zoomed net scrolls it, after the pointer has stayed there this long.
const EDGE_DWELL_MS = 250;
// A cell this close to the edge of the zoomed view (a share of its size) counts as out of it.
const VIEW_MARGIN = 0.15;
export const isSolidKind = kind => SOLID_KINDS.includes(kind);

// Numbers have to be met in order, and nothing follows the highest number.
const PLAY_STEP = { strictOrder: true };
// The two halves of a ball side by side (the Map view): the width of each, in pixels.
const MAP_WIDTH = 300;
const DEFAULT_SIZE = { tetra: 4, cube: 3 };

const sec = seconds => `${seconds.toFixed(1)}s`;

// What main.js hands over besides the page (all optional, so the card works on its own):
//   release   releaseDays(SOLID_RELEASE): what is open to everyone, and from when
//             (null: nothing)
//   today     () -> the UTC day number
//   unlocked  kind -> whether the player has unlocked it (the lucky game)
//   luckyHtml done -> the markup under a lucky game (what it unlocked, a streak reward)
//   luckySolved, luckyFailed, leaveLucky: the lucky game was solved, could not start
//             (the chance comes back), was left
// The cell tints of the play app's 3D views follow the theme (css/theme.css); a theme switch redraws the screen.
const playPalette = () => (typeof document !== 'undefined' && solidIsDark(document)
  ? PLAY_DARK_PALETTE : LIGHT_PALETTE);

export function createSolidPlay(app) {
  const { S, $, t } = app;
  const release = app.release ?? null;
  const today = app.today ?? (() => 0);
  const isUnlocked = app.unlocked ?? (() => false);
  // what the menu card has chosen: the kind, the size of a tetra and of a cube, the ball ('random'
  // or the id of a catalog entry)
  const choice = { kind: 'ball', size: { ...DEFAULT_SIZE }, shape: 'random' };
  // once the player has used the card it stays until the page is reloaded
  let picked = false;
  // the view the player chose last ('3d' or 'net'): a new puzzle opens in it, until the page is
  // reloaded
  let view = '3d';
  // the game on the screen: { kind, n, P, top, path, rotation, view, follow, finished, seed }
  let game = null;
  let layouts = [];
  let frames = [];
  const pointers = new Map(); // pointer id -> [clientX, clientY], the pointers that are down
  let orbiting = null; // { start, last, active } while a drag turns the solid
  let drawing = false;
  let over = -1;
  let segment = 0;
  let lastPoint = null; // the pointer in net coordinates, while a drag crosses a net
  let zoom = null; // the zoom of the board on the screen (apps/play/zoom.js)
  const turner = createTurner({
    getRotation: () => game.rotation,
    setRotation: R => {
      game.rotation = R;
    },
    redraw: () => draw(),
  });

  const isBall = () => game.kind === BALL_KIND;
  // Whether the solid can be turned: the 3D view, and both views of a ball
  const turnable = () => game.view === '3d' || isBall();

  // ---------- the card of the menu ----------

  // What the player may play of a kind: 'all' (unlocked, or open to everyone), 'part'
  // (the first sizes of a tetra, open to everyone from the first day) or 'none'.
  // Holding V shows everything.
  const realAccess = kind => (isUnlocked(kind) ? 'all' : stageOf(kind, today(), release));
  const accessOf = kind => (S.showDev ? 'all' : realAccess(kind));
  const sizesOf = kind => (
    accessOf(kind) === 'part' ? openSizes(kind, today(), release) : SOLID_SIZES[kind]
  );
  // A tile the player picked (while V was held) stays until the page is reloaded, like
  // the flat variants.
  const kept = new Set();
  const tileShown = kind => S.showDev || realAccess(kind) !== 'none' || kept.has(kind);
  const cardShown = () => (
    S.showDev || picked || SOLID_KINDS.some(kind => realAccess(kind) !== 'none')
  );

  // The choice must be something on offer: a shown kind, one of its sizes.
  function fitChoice() {
    if (!tileShown(choice.kind)) {
      choice.kind = SOLID_KINDS.find(tileShown) ?? choice.kind;
    }
    if (choice.kind !== BALL_KIND && !sizesOf(choice.kind).includes(choice.size[choice.kind])) {
      choice.size[choice.kind] = sizesOf(choice.kind)[0];
    }
  }

  function shapeOptionsHtml() {
    if (choice.kind === BALL_KIND) {
      // the catalog of the balls is loaded when the card is first wanted (ensureBalls)
      const known = ballsLoaded() ? ballsByComposition() : [];
      const groups = known.map(group => {
        const balls = group.balls
          .filter(ball => ball.ok)
          .map(ball => {
            const selected = ball.id === choice.shape ? ' selected' : '';
            return `<option value="${ball.id}"${selected}>${ball.name}</option>`;
          });
        const cells = t('solid.cells', group.balls[0].r.length);
        return balls.length
          ? `<optgroup label="${group.label} · ${cells}">${balls.join('')}</optgroup>`
          : '';
      });
      const random = choice.shape === 'random' ? ' selected' : '';
      return `<option value="random"${random}>${t('solid.random')}</option>${groups.join('')}`;
    }
    return sizesOf(choice.kind)
      .map(n => {
        const selected = n === choice.size[choice.kind] ? ' selected' : '';
        const cells = t('solid.cells', surfaceTopology(choice.kind, n).T);
        return `<option value="${n}"${selected}>${n} (${cells})</option>`;
      })
      .join('');
  }

  const choiceLabel = () => t(choice.kind === BALL_KIND ? 'solid.shape' : 'solid.size');

  function tileHtml(kind) {
    const checked = kind === choice.kind ? ' checked' : '';
    const locked = realAccess(kind) === 'none' ? ' variant-locked' : '';
    const style = tileShown(kind) ? '' : ' style="display:none"';
    return `
        <label class="variant-opt${locked}" id="solidOpt-${kind}"${style}>
          <input type="radio" name="solid" value="${kind}"
            aria-describedby="solidRules-${kind}"${checked}>
          <span class="variant-card">
            ${variantIcon(kind)}
            <span class="variant-name">${t(`mode.${kind}`)}</span>
            <span class="variant-tag">${t(`mode.${kind}Tag`)}</span>
          </span>
          <span class="variant-rules" id="solidRules-${kind}" role="tooltip">
            ${t(`mode.${kind}Rules`)}
          </span>
        </label>`;
  }

  // The line under the tiles: the type picked, its tagline and (on a touch screen) the link to its rules sheet.
  const captionHtml = kind => `<b>${t(`mode.${kind}`)}</b> — ${t(`mode.${kind}Tag`)}`
    + ` <button type="button" class="link-btn rules-link" data-rules="solidRules-${kind}">${t('menu.rulesLink')}</button>`;

  function cardHtml() {
    fitChoice();
    return `
      <section class="card solid-card" id="solidCard" style="${cardShown() ? '' : 'display:none'}">
        <header class="card-head">
          <span class="card-badge">${cardIcon('free')}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('menu.title')}</h2>
            <p class="card-sub">${t('solid.sub')}</p>
          </div>
        </header>
        ${app.genNoticeHtml()}
        <fieldset class="variant-picker">
          <legend class="field-label">${t('menu.mode')}</legend>
          <div class="variant-options">${SOLID_KINDS.map(tileHtml).join('')}
          </div>
        </fieldset>
        <p class="menu-caption" id="solidCaption" aria-live="polite">${captionHtml(choice.kind)}</p>
        <div class="play-bar">
          <div class="field size-field">
            <label class="field-label" for="solidSel" id="solidSelLabel">${choiceLabel()}</label>
            <select id="solidSel">${shapeOptionsHtml()}</select>
          </div>
          <div class="button-row">
            <button class="btn" id="playSolid">${t('menu.playLocal')}</button>
          </div>
        </div>
      </section>`;
  }

  // Loads the catalog of the balls (once, a module of its own) and then lists them in the card.
  function ensureBalls() {
    if (ballsLoaded()) {
      return Promise.resolve();
    }
    return loadBalls().then(() => {
      const select = $('solidSel');
      if (select && choice.kind === BALL_KIND) {
        select.innerHTML = shapeOptionsHtml();
      }
    });
  }

  function attachCard() {
    const card = $('solidCard');
    if (!card) {
      return;
    }
    if (cardShown()) {
      ensureBalls();
    }
    // a press, a key or a choice in the card: from now on it stays (V is held only to find it)
    for (const type of ['pointerdown', 'focusin', 'change']) {
      card.addEventListener(type, () => {
        picked = true;
        ensureBalls();
      });
    }
    document.querySelectorAll('input[name="solid"]').forEach(input => {
      input.onchange = () => {
        choice.kind = input.value;
        kept.add(input.value);
        $('solidSel').innerHTML = shapeOptionsHtml();
        $('solidSelLabel').textContent = choiceLabel();
        $('solidCaption').innerHTML = captionHtml(input.value);
      };
    });
    $('solidSel').onchange = event => {
      const value = event.target.value;
      if (choice.kind === BALL_KIND) {
        choice.shape = value;
      } else {
        choice.size[choice.kind] = Number(value);
      }
    };
    $('playSolid').onclick = () => {
      picked = true;
      start();
    };
  }

  // Shows or hides the card as V goes down and up (the page is not drawn again).
  function reveal() {
    const card = $('solidCard');
    if (card) {
      card.style.display = cardShown() ? '' : 'none';
      fitChoice();
      for (const kind of SOLID_KINDS) {
        const tile = $(`solidOpt-${kind}`);
        if (tile) {
          tile.style.display = tileShown(kind) ? '' : 'none';
        }
      }
      const select = $('solidSel');
      if (select && choice.kind !== BALL_KIND) {
        select.innerHTML = shapeOptionsHtml();
      }
    }
    const exportButton = $('solidExport');
    if (exportButton) {
      exportButton.style.display = S.showDev ? '' : 'none';
    }
    const hintButton = $('solidHint');
    if (hintButton && game) {
      hintButton.style.display = hintShown() ? '' : 'none';
    }
    if (cardShown()) {
      ensureBalls();
    }
  }

  // ---------- starting a game ----------

  // Starts a game of what the card has chosen. The lucky game (game-flow.js startLucky) gives
  // the kind and the size instead: the size of a tetra or cube, for a ball the range of
  // cells it may have, { min, max }.
  async function start({ kind = choice.kind, size, lucky = false } = {}) {
    let n = size ?? choice.size[kind];
    S.screen = 'generating';
    S.genMode = kind;
    S.gen = { frac: 0, walls: null, K: null };
    S.genNotice = null;
    app.render();
    const job = S.genJob = cancellable();
    try {
      if (kind === BALL_KIND) {
        await loadBalls();
        const rnd = () => app.randomSeed() / 4294967296;
        let entry;
        if (lucky) {
          entry = pickBall(rnd, size.min, size.max);
        } else {
          entry = choice.shape === 'random' ? pickBall(rnd) : ballEntry(choice.shape);
        }
        n = entry.id;
      }
      const seed = app.randomSeed();
      const made = await runGeneration({ task: 'solid', kind, n, seed }, {
        signal: job.signal,
        onEvent: event => {
          const frac = event.phase === 'walls' ? 0.05 + (0.95 * event.done) / event.total : 0.05;
          S.gen = { frac, walls: null, K: null };
          app.paintGenerating();
        },
      });
      begin(kind, n, made.puzzle, seed, made.path, lucky);
    } catch (error) { // cancelled by the player (silent), too slow, or failed: the menu comes back, the chance of a lucky game with it
      if (!isAbort(error)) {
        console.error('Solid puzzle failed:', error);
        S.genNotice = isTimeout(error) ? 'err.generateSlow' : 'err.generate';
      }
      if (lucky && app.luckyFailed) {
        await app.luckyFailed();
      }
      S.screen = 'menu';
      app.render();
    } finally {
      job.end();
      if (S.genJob === job) {
        S.genJob = null;
      }
    }
  }

  function begin(kind, n, puzzle, seed, solution, lucky = false) {
    const top = surfaceTopology(kind, n);
    game = {
      kind,
      n,
      P: puzzle,
      top,
      path: [],
      // the solid starts turned to checkpoint 1, so the first cell is in view
      rotation: turnToward(IDENTITY, cellDirection(top, puzzle.cp.indexOf(1))),
      view,
      follow: true,
      finished: false,
      seed,
      solution, // the one solution, for the hint and the export
      hints: 0,
      hintCell: null,
      hintWrongCell: null,
      penalized: false,
      noteKey: null, // the line under the board, when not the usual one
      lucky, // the lucky game: one try, no hint, no new puzzle
      zoom: null, // the camera of the zoom (view/camera.js), null = the whole picture
      pan: false, // a drag moves the board instead of drawing (a net, when zoomed)
    };
    drawing = false;
    orbiting = null;
    pointers.clear();
    segment = 0;
    lastPoint = null;
    S.finished = false;
    S.elapsed = 0;
    Object.assign(S, { lucky, luckyResult: null, luckyNote: null, healed: false });
    S.screen = 'solid';
    app.startTimer();
    app.render();
  }

  // Back to the menu.
  function leave() {
    turner.stop();
    app.stopTimer();
    if (app.leaveLucky) {
      app.leaveLucky(); // an unsolved lucky game forfeits its unlock chance
    }
    game = null;
    zoom = null;
    S.screen = 'menu';
    app.render();
  }

  // ---------- the game screen ----------

  const titleOf = () => (isBall()
    ? t('game.ballTitle', ballEntry(game.n).name)
    : t(`game.${game.kind}Title`, game.n));

  function viewLabel() {
    const net = game.view === 'net';
    if (isBall()) {
      return t(net ? 'solid.ball' : 'solid.map');
    }
    return t(net ? 'solid.solid' : 'solid.net');
  }

  // The hint button: in free play always, in the lucky game only while V is held.
  const hintShown = () => S.showDev || !game.lucky;

  // The hints a game has: one for every checkpoint.
  const hintCap = () => game.P.cp.reduce((count, number) => count + (number ? 1 : 0), 0);

  // The line under the board: what Follow does when it was just switched, else how to turn the
  // solid, or how to read the assist view.
  function noteKey() {
    if (game.noteKey) {
      return game.noteKey;
    }
    if (game.view === '3d') {
      return 'solid.turn';
    }
    return isBall() ? 'solid.mapNote' : 'solid.netNote';
  }

  function screenHtml() {
    const time = sec(S.elapsed);
    const penalty = game.hints
      ? t('game.penalty', sec(HINT_PENALTY_S * game.hints), game.hints)
      : '';
    const solved = game.finished ? `<p class="solved">${t('game.solved', time, penalty)}</p>` : '';
    const hintOff = game.finished || game.hints >= hintCap() ? ' disabled' : '';
    const exportShown = S.showDev ? '' : 'display:none';
    const dev = S.showDev ? 'inline' : 'none';
    const tag = `<span id="seedTag" class="seed-tag" style="display:${dev}">`
      + `${game.kind} · ${game.n} · seed ${game.seed}</span>`;
    const follow = game.follow ? ' active' : '';
    const hintStyle = hintShown() ? '' : 'display:none';
    const newStyle = game.lucky ? 'display:none' : '';
    const luckyChip = game.lucky ? `<span class="lucky-chip">${t('lucky.tag')}</span>` : '';
    const luckyOnce = game.lucky && !game.finished
      ? `<p class="note lucky-once">${t(S.luckyHolder ? 'lucky.onceChance' : 'lucky.onceFun')}</p>`
      : '';
    const luckyResult = app.luckyHtml ? app.luckyHtml(game.finished) : '';
    const results = solved || luckyResult ? `<section class="card result-card">${solved}${luckyResult}</section>` : '';
    return `
    <div class="game-layout">
      <section class="card board-card">
        <div class="hud">
          <div class="hud-title">
            <span class="hud-icon">${variantIcon(game.kind)}</span>
            <span>${titleOf()}</span>${luckyChip}${tag}
          </div>
          <div class="hud-time">${t('game.time', `<b id="hudTime">${time}</b>`)}</div>
        </div>
        <div class="view-tools">
          <button class="btn secondary" id="solidView">${viewLabel()}</button>
          <button class="btn secondary${follow}" id="solidFollow" aria-pressed="${game.follow}"
            title="${t('solid.followTip')}" aria-label="${t('solid.followTip')}">
            ${t('solid.follow')}</button>
          ${zoomToolsHtml({ hint: false, inline: true })}
        </div>
        <p class="small view-hint">${t('solid.followTip')}</p>
        <div class="grid-wrap solid-wrap" id="solidWrap"></div>
        <p class="note" id="solidNote">${t(noteKey())}</p>
        ${luckyOnce}
      </section>
      <div class="side">
        <section class="card actions">
          <div class="button-row">
            <button class="btn secondary" id="solidMenu">${actionIcon('menu')}${t('game.menu')}</button>
            <button class="btn secondary" id="solidNew" style="${newStyle}">
              ${actionIcon('new')}${t('game.new')}</button>
            <button class="btn secondary" id="solidReset">${actionIcon('reset')}${t('game.reset')}</button>
            <button class="btn secondary" id="solidHint"${hintOff} style="${hintStyle}">
              ${actionIcon('hint')}${t('game.hint', game.hints, hintCap())}</button>
            <button class="btn secondary" id="solidExport" style="${exportShown}">Export</button>
          </div>
        </section>
        ${results}
      </div>
    </div>`;
  }

  // The layouts to draw: the main ones, and the one shown small in a corner (or null): a tetra or
  // cube is the solid with its net in the corner, or the net; a ball is the ball with its far side
  // in the corner, or both halves side by side.
  function layoutsFor() {
    const { top, rotation } = game;
    const solid = game.view === '3d';
    if (isBall()) {
      const options = solid ? {} : { maxWidth: MAP_WIDTH };
      const back = buildBallView(top, behind(rotation), options);
      return solid
        ? { main: [buildBallView(top, rotation)], inset: back }
        : { main: [buildBallView(top, rotation, options), back], inset: null };
    }
    return solid
      ? { main: [buildView(top, rotation)], inset: buildNet(top) }
      : { main: [buildNet(top)], inset: null };
  }

  function draw() {
    const wrap = $('solidWrap');
    if (!wrap || !game) {
      return;
    }
    const { main, inset } = layoutsFor();
    layouts = main;
    const state = {
      P: game.P,
      selected: -1,
      buffer: '',
      playing: true,
      path: game.path,
      template: null,
      solutions: [],
      visible: [],
      palette: playPalette(),
      continues: (from, to) => canPush(game.P, game.path, to, PLAY_STEP),
      hintCell: game.hintCell,
      hintWrongCell: game.hintWrongCell,
    };
    const pictures = main.map((net, i) => surfaceSvg(net, { ...state, idSuffix: String(i) }));
    frames = pictures.map(picture => picture.frame);
    const views = pictures
      .map((picture, i) => `<div class="sf-view" data-view="${i}">${picture.markup}</div>`)
      .join('');
    const small = inset
      ? surfaceSvg(inset, { ...state, idSuffix: 'm' }).markup
      : '';
    wrap.innerHTML = (pictures.length > 1 ? `<div class="sf-pair">${views}</div>` : views)
      + (inset ? `<div class="sf-mini">${small}</div>` : '');
    wrap.classList.toggle('ball', isBall());
    wrap.classList.toggle('turnable', turnable());
    showZoom();
  }

  // ---------- zoom ----------

  // The whole picture of view `i` as a view box (the frame of the svg).
  const fullOf = i => ({ x: 0, y: 0, w: frames[i].width, h: frames[i].height });

  // The camera of view `i`: a turnable solid is zoomed about its middle (turning is its pan), a
  // net as the camera says.
  function cameraOf(i) {
    const full = fullOf(i);
    const cam = game.zoom ?? fitCamera(full);
    return turnable() ? { s: cam.s, cx: full.w / 2, cy: full.h / 2 } : cam;
  }

  // Writes the camera into the viewBox of the svg of every view on the screen.
  function showZoom() {
    const wrap = $('solidWrap');
    if (!wrap) {
      return;
    }
    wrap.querySelectorAll('.sf-view svg').forEach((svg, i) => {
      svg.setAttribute('viewBox', viewBoxAttr(viewOf(fullOf(i), cameraOf(i))));
    });
  }

  const zoomOn = () => Boolean(zoom) && isZoomed(game.zoom);

  // The picture (frame pixels) of the centre of a cell in the first view.
  const pixelOf = cell => frames[0].toPixels(layouts[0].centers[cell]);

  // Whether a cell is out of the middle of the zoomed view (never when the view is not zoomed).
  function outsideView(cell) {
    if (!zoomOn()) {
      return false;
    }
    const [x, y] = pixelOf(cell);
    const view = viewOf(fullOf(0), cameraOf(0));
    return x < view.x + VIEW_MARGIN * view.w
      || x > view.x + (1 - VIEW_MARGIN) * view.w
      || y < view.y + VIEW_MARGIN * view.h
      || y > view.y + (1 - VIEW_MARGIN) * view.h;
  }

  // The head of the path in the first view (frame pixels), or null.
  function headPixel() {
    const head = game.path[game.path.length - 1];
    return head === undefined || !layouts.length ? null : pixelOf(head);
  }

  // ---------- playing ----------

  const cellUnder = event => {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const polygon = hit && hit.closest ? hit.closest('[data-cell]') : null;
    return polygon && $('solidWrap').contains(polygon) ? Number(polygon.dataset.cell) : -1;
  };

  const highest = () => game.path.reduce((best, cell) => Math.max(best, game.P.cp[cell]), 0);

  // The sound of a move, and the end of the game.
  function moved(kind, cell) {
    game.hintCell = null;
    game.hintWrongCell = null;
    if (kind === 'push') {
      const number = game.P.cp[cell];
      if (number) {
        sfxCheckpoint();
        segment = number;
      } else if (segment > 0) {
        sfxMoveAfterCheckpoint(segment);
      } else {
        sfxMove();
      }
      if (isSolved(game.P, game.path)) {
        game.finished = true;
        app.stopTimer();
        sfxSolved();
        if (!game.penalized) {
          // each hint adds a penalty to the time, once, even if the path is reset and solved again
          S.elapsed = penalizedTime(S.elapsed, game.hints);
          game.penalized = true;
        }
        if (game.lucky && app.luckySolved) {
          app.luckySolved();
        }
      }
    } else {
      sfxBack();
      segment = highest();
    }
  }

  // The press on `cell`: the first cell, a rewind to a cell of the path, the head again (the drag
  // goes on from it), or one step. False when it starts nothing: the press turns the solid.
  function pressCell(cell) {
    turner.stop(); // a turn towards the old head; followHead decides again on release
    const { P, path } = game;
    let kind = null;
    if (!path.length) {
      if (P.cp[cell] !== 1) {
        return false;
      }
      path.push(cell);
      kind = 'push';
    } else if (path.includes(cell)) {
      const at = path.indexOf(cell);
      kind = at < path.length - 1 ? 'trunc' : 'head';
      path.length = at + 1;
    } else {
      kind = step(P, path, cell, PLAY_STEP);
    }
    if (!kind) {
      return false;
    }
    if (kind !== 'head') {
      moved(kind, cell);
    }
    drawing = true;
    draw();
    return true;
  }

  // The drag reached `cell`, coming from `from`: one step on the path, or one back. A cell drawn
  // right beside the head counts only when the pointer came from the head (so a drag over a cell
  // on its way to somewhere else changes nothing); a neighbour across a cut of the net is
  // somewhere else on the net and counts wherever the pointer lands.
  function dragTo(from, cell) {
    const { P, path, top } = game;
    const head = path[path.length - 1];
    if (cell < 0 || cell === head) {
      return false;
    }
    const slot = slotBetween(top, head, cell);
    if (slot < 0 || (layouts[0].glued[head * SLOTS + slot] && from !== head)) {
      return false;
    }
    const kind = step(P, path, cell, PLAY_STEP);
    if (!kind) {
      sfxBlocked();
      return false;
    }
    moved(kind, cell);
    return true;
  }

  // Whether the board is a net with cuts: leaving the head over a cut is a step.
  const crossing = () => game.view === 'net' && (layouts[0].cuts?.length ?? 0) > 0;

  // The pointer of `event` in the net coordinates of the board.
  function netPointOf(event) {
    const svg = $('solidWrap').querySelector('.sf-view[data-view="0"] svg');
    const rect = svg.getBoundingClientRect();
    const view = svg.viewBox.baseVal; // the part of the picture on screen (the zoom)
    return frames[0].toNet(
      view.x + ((event.clientX - rect.left) / rect.width) * view.width,
      view.y + ((event.clientY - rect.top) / rect.height) * view.height,
    );
  }

  // One step to `cell`, a neighbour of the head across a cut.
  function stepTo(cell) {
    const kind = step(game.P, game.path, cell, PLAY_STEP);
    if (!kind) {
      sfxBlocked();
      return false;
    }
    moved(kind, cell);
    return true;
  }

  // After a hint: a hinted cell that is turned away is turned into view.
  function showHint() {
    if (game.hintCell === null) {
      return;
    }
    const { top } = game;
    const cell = game.hintCell;
    if (game.view !== '3d') {
      if (!turnable() && zoomOn() && outsideView(cell)) {
        zoom.keepInView(pixelOf(cell)); // a net: the view moves to the hint
      }
      return;
    }
    const away = isBall() ? layouts[0].depth[cell] < FOLLOW_EDGE : Boolean(layouts[0].hidden[cell]);
    if (away || outsideView(cell)) {
      turner.toward(top, cell);
    }
  }

  // When the head of the path, or a cell it can step to, is turned away, the solid turns to
  // face it.
  function followHead() {
    const { path, top } = game;
    if (!path.length || game.finished) {
      return;
    }
    if (!turnable() && zoomOn()) {
      zoom.keepInView(pixelOf(path[path.length - 1])); // a zoomed net: the view follows the head
      return;
    }
    if (!game.follow || game.view !== '3d') {
      return;
    }
    if (headTurnedAway(top, layouts[0], path, isBall(), outsideView)) {
      turner.toward(top, path[path.length - 1]);
    }
  }

  const pointerCentre = () => {
    const all = [...pointers.values()];
    return [0, 1].map(axis => all.reduce((sum, point) => sum + point[axis], 0) / all.length);
  };

  function turnSolid(wrap, event) {
    const [x, y] = pointerCentre();
    if (!orbiting.active) {
      if (Math.hypot(x - orbiting.start[0], y - orbiting.start[1]) < ORBIT_SLOP) {
        return;
      }
      orbiting.active = true;
      turner.stop();
      wrap.setPointerCapture(event.pointerId);
    }
    // zoomed in, the same drag turns the solid less: the surface keeps up with the finger
    const speed = ORBIT_SPEED / (game.zoom ? game.zoom.s : 1);
    game.rotation = orbit(
      game.rotation,
      (x - orbiting.last[0]) * speed,
      (y - orbiting.last[1]) * speed,
    );
    orbiting.last = [x, y];
    draw();
  }

  function attachGame() {
    const wrap = $('solidWrap');
    if (!wrap) {
      return;
    }
    draw();
    $('solidMenu').onclick = leave;
    $('solidNew').onclick = () => {
      turner.stop();
      app.stopTimer();
      start();
    };
    $('solidReset').onclick = () => {
      turner.stop();
      game.path = [];
      game.finished = false;
      game.hintCell = null;
      game.hintWrongCell = null;
      segment = 0;
      app.render();
    };
    $('solidHint').onclick = () => {
      if (game.finished || game.hints >= hintCap()) {
        return;
      }
      const { correctCell, wrongCell } = computeHint(game.solution, game.path);
      if (correctCell == null) {
        return;
      }
      game.hints++;
      game.hintCell = correctCell;
      game.hintWrongCell = wrongCell;
      app.render();
      showHint();
    };
    $('solidExport').onclick = () => {
      app.openExport(serializeSurface(game.P, { path: game.solution }));
    };
    $('solidView').onclick = () => {
      turner.stop();
      game.view = view = game.view === '3d' ? 'net' : '3d';
      game.zoom = null; // the two views are not the same picture
      game.pan = false;
      app.render();
    };
    $('solidFollow').onclick = () => {
      game.follow = !game.follow;
      game.noteKey = game.follow ? 'solid.followOn' : 'solid.followOff';
      app.render();
    };

    // The zoom of this board (apps/play/zoom.js), on the wrap: the svgs are drawn again at every
    // turn.
    const full = fullOf(0);
    const router = createRouter({ pan: () => zoom.panning() });
    zoom = createZoom({
      target: wrap,
      measure: () => wrap.querySelector('.sf-view svg').getBoundingClientRect(),
      show: showZoom,
      centred: turnable,
      full,
      across: full.w / (layouts[0].side * frames[0].scale),
      get: () => game.zoom,
      set: cam => {
        game.zoom = cam;
      },
      getPan: () => game.pan,
      setPan: on => {
        game.pan = on;
      },
      touchBusy: () => router.mode() !== 'idle',
    });
    setupZoomTools(zoom, headPixel, { always: true, byId: $ });

    // Who gets the fingers (apps/play/gesture.js): the drawing pointer, a pinch of two fingers (a
    // zoom, or on a solid a turn: classifyPair says), a pan (the right button turns a solid), and
    // the short wait before a touch draws, so that a pinch draws nothing.
    let current = null; // the pointer event being handled
    let timer = 0;
    let pair = null; // two fingers: { start, mode: null | 'zoom' | 'turn' }

    function pressAt(point) {
      const cell = cellUnder(point);
      if (!game.finished && cell >= 0) {
        over = cell;
        lastPoint = crossing() ? netPointOf(point) : null;
        if (pressCell(cell)) {
          return;
        }
      }
      if (turnable()) {
        // anything else turns the solid once the pointer has moved a little
        orbiting = { start: pointerCentre(), last: pointerCentre(), active: false };
      }
    }

    function dragMove() {
      if (orbiting) {
        turnSolid(wrap, current);
        return;
      }
      if (!drawing || game.finished) {
        return;
      }
      // a fast drag reaches the page as one event per frame: follow the positions in between too
      const moves = current.getCoalescedEvents ? current.getCoalescedEvents() : [];
      let changed = false;
      for (const move of moves.length ? moves : [current]) {
        const cell = cellUnder(move);
        const at = crossing() ? netPointOf(move) : null;
        let next = cell;
        if (dragTo(over, cell)) {
          changed = true;
        } else if (at && lastPoint) {
          // the pointer left the head over a cut of the net: the path goes on where the cut leads
          const head = game.path[game.path.length - 1];
          const target = crossedCut(game.top, layouts[0], head, lastPoint, at);
          if (target >= 0 && stepTo(target)) {
            changed = true;
            next = target;
          }
        }
        lastPoint = at;
        over = next;
      }
      if (changed) {
        draw();
      }
    }

    // Drawing at the edge of a zoomed net scrolls it: a frame loop while the pointer is in the edge
    // band (a solid is not scrolled: it turns, and Follow turns it to the head).
    let pointer = null;
    let scrollFrame = 0;
    let edgeSince = 0;
    let scrollAt = 0;
    function stopScroll() {
      if (scrollFrame) {
        cancelAnimationFrame(scrollFrame);
      }
      scrollFrame = 0;
      edgeSince = 0;
      scrollAt = 0;
    }
    function scrollTick(now) {
      scrollFrame = 0;
      if (!drawing || !pointer || turnable() || !zoomOn()) {
        return;
      }
      const velocity = edgeVelocity(pointer.x, pointer.y, zoom.box());
      if (!velocity[0] && !velocity[1]) {
        edgeSince = 0;
        scrollAt = 0;
        return;
      }
      if (!edgeSince) {
        edgeSince = now;
      }
      const seconds = scrollAt ? Math.min(0.05, (now - scrollAt) / 1000) : 0;
      scrollAt = now;
      if (now - edgeSince >= EDGE_DWELL_MS) {
        if (!zoom.driftBy(velocity, seconds)) {
          return; // at the edge of the net: nothing more until the pointer moves
        }
        dragMove(); // the cell under the pointer has changed
      }
      scrollFrame = requestAnimationFrame(scrollTick);
    }
    function watchEdge(x, y) {
      pointer = { x, y };
      if (!scrollFrame && drawing && !turnable() && zoomOn()) {
        scrollFrame = requestAnimationFrame(scrollTick);
      }
    }

    function endDraw() {
      stopScroll();
      orbiting = null;
      if (drawing) {
        drawing = false;
        if (game.finished) {
          app.render();
          return;
        }
        followHead();
      }
    }

    function startPair(a, b) {
      stopScroll();
      turner.stop();
      drawing = false;
      orbiting = null;
      zoom.pinchBegin(a, b);
      // a net has nothing to turn: its two fingers are a pinch and a pan at once
      pair = { start: [a, b], mode: turnable() ? null : 'zoom' };
    }

    function movePair(a, b) {
      if (!pair) {
        return;
      }
      if (!pair.mode) {
        pair.mode = classifyPair(pair.start, [a, b]);
        if (pair.mode === 'turn') {
          orbiting = { start: pointerCentre(), last: pointerCentre(), active: true };
        }
      }
      if (pair.mode === 'zoom') {
        zoom.pinchMove(a, b);
      } else if (pair.mode === 'turn') {
        turnSolid(wrap, current);
      }
    }

    function endPair() {
      zoom.pinchEnd();
      pair = null;
      orbiting = null;
    }

    const actions = {
      timer: a => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (wrap.isConnected) {
            perform(router.timeout());
          }
        }, a.ms);
      },
      'timer-clear': () => clearTimeout(timer),
      'draw-start': a => {
        pressAt({ clientX: a.x, clientY: a.y });
        watchEdge(a.x, a.y);
      },
      'draw-move': a => {
        dragMove();
        watchEdge(a.x, a.y);
      },
      'draw-end': endDraw,
      'gesture-start': a => startPair(a.a, a.b),
      'gesture-move': a => movePair(a.a, a.b),
      'gesture-end': endPair,
      'pan-start': () => {
        turner.stop();
        zoom.refresh();
        if (turnable()) {
          orbiting = { start: pointerCentre(), last: pointerCentre(), active: true };
        }
      },
      'pan-move': a => {
        if (turnable()) {
          turnSolid(wrap, current);
        } else {
          zoom.panBy(a.dx, a.dy);
        }
      },
      'pan-end': () => {
        orbiting = null;
      },
    };
    const perform = list => list.forEach(a => actions[a.do]?.(a));
    const eventOf = e => ({
      id: e.pointerId,
      type: e.pointerType,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      cancel: e.type === 'pointercancel',
    });

    wrap.addEventListener('pointerdown', event => {
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (game.noteKey) {
        game.noteKey = null;
        $('solidNote').textContent = t(noteKey());
      }
      event.preventDefault();
      zoom.refresh();
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer is gone already */
      }
      current = event;
      perform(router.down(eventOf(event)));
    });
    wrap.addEventListener('pointermove', event => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, [event.clientX, event.clientY]);
      }
      current = event;
      perform(router.move(eventOf(event)));
    });
    const release = event => {
      pointers.delete(event.pointerId);
      current = event;
      perform(router.up(eventOf(event)));
    };
    wrap.addEventListener('pointerup', release);
    wrap.addEventListener('pointercancel', release);
    // a right-drag turns a solid and pans a zoomed net: no menu then
    wrap.addEventListener('contextmenu', event => {
      if (turnable() || zoomOn()) {
        event.preventDefault();
      }
    });
  }

  // + - 0 zoom, and the arrow keys turn the solid or pan a zoomed net (one listener for the page,
  // see main.js boot).
  function onKey(event) {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '');
    if (S.screen !== 'solid' || !game || typing) {
      return;
    }
    if (zoom && zoom.target.isConnected && zoom.onKey(event, headPixel())) {
      event.preventDefault();
      return;
    }
    if (!ARROW_TURN[event.key] || !turnable()) {
      return;
    }
    event.preventDefault();
    turner.stop();
    game.rotation = orbit(game.rotation, ...ARROW_TURN[event.key]);
    draw();
  }

  return {
    cardHtml,
    // whether the menu offers the 3D puzzles at all (a kind unlocked or released, or V held): then it has a Flat | 3D tab
    available: cardShown,
    // what a player may play of a kind, V not counted: 'all' | 'part' | 'none', and the sizes of it (Patchwork, src/coop, has the
    // same locks as this card)
    access: realAccess,
    openSizes: kind => (realAccess(kind) === 'part' ? openSizes(kind, today(), release) : SOLID_SIZES[kind]),
    screenHtml: () => screenHtml(),
    // wires the page after every render: the card in the menu, the board in a game
    attach: () => (S.screen === 'solid' && game ? attachGame() : attachCard()),
    reveal,
    start,
    // the kind the card has chosen (the one just unlocked)
    pick: kind => {
      choice.kind = kind;
    },
    onKey,
    isKind: isSolidKind,
  };
}
