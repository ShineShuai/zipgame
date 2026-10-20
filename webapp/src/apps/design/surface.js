// The design app's controller for the types that run on a cell graph (core/surface): the 3D types
// (Tetrahedron, Cube, Ball) and the flat Pentagon type. It owns the graph puzzle, draws a solid as
// the one you can turn (3D, the default) or as an assist: the flat net of a tetrahedron or cube,
// the two halves of a ball (surface-board.js), and runs the tools, Generate, Minimize walls,
// Solve, Play and the text export. The Pentagon type (core/pentagon.js) is a flat board with a
// border: nothing to turn, one picture (buildFlat in view/surface-net.js), the same tools.
// design.html shows its panels while the type is one of these (data-variants); main.js hands
// over the shared buttons (Solve, Play, Export, Reset) and the seed, status, timing and busy
// state, which come in through `ctx`.
import {
  BALL_KIND,
  SURFACE_SIZES,
  SLOTS,
  ballEntry,
  surfaceTopology,
} from '../../core/surface/topology.js';
import { ballsByComposition, compositionLabel } from '../../core/surface/balls.js';
import {
  makeSurfacePuzzle,
  cloneSurfacePuzzle,
  validateSurface,
  wallCount,
  canPush,
  isSolved,
  step,
  nextNumber,
  serializeSurface,
} from '../../core/surface/puzzle.js';
import { solveSurface } from '../../core/surface/solve.js';
import { defaultK, generateSurfaceWithin, minimizeSurfaceWalls } from '../../core/surface/gen.js';
import { buildFlat, buildNet, pickSide, slotBetween } from '../../view/surface-net.js';
import { IDENTITY, buildView, orbit, overview } from '../../view/proj.js';
import {
  ARROW_TURN,
  ORBIT_SLOP,
  ORBIT_SPEED,
  createTurner,
  crossedCut,
  headTurnedAway,
} from '../../view/solid-nav.js';
import { behind, buildBallView } from '../../view/ball.js';
import { runAsync, measured } from '../../platform/run.js';
import { setHintText } from '../../ui/hint-popover.js';
import { surfaceSvg } from './surface-board.js';
import { keptK } from './k-field.js';
import { PENTAGON_KIND, shapeHint } from '../../core/pentagon.js';
import { pentagonDefaultK } from '../../core/gen/pentagon.js';
import { TPL_C, SOL_C } from './board.js';

const NAME = { tetra: 'Tetrahedron', cube: 'Cube', ball: 'Ball', pentagon: 'Pentagon' };
const FACES = {
  tetra: '4 faces of n × n triangles',
  cube: '6 faces of n × n squares',
  pentagon: 'a flat board of pentagons',
};
const DEFAULT_SIZE = { tetra: 4, cube: 3, ball: 'snub-cube', pentagon: 6 };
// The starting value of the number of checkpoints: the Pentagon board has a rule of its own.
const startK = (kind, n) => (kind === PENTAGON_KIND ? pentagonDefaultK(n) : defaultK(kind, n));
// The two halves of a ball side by side (the Map view): the width of each, in pixels.
const MAP_WIDTH = 300;
// Puzzles Generate makes (new seeds in turn) while looking for one within Max walls.
const GEN_TRIES = 20;
const PLAY_STEP = { strictOrder: true };
const NUMBER_HINT = 'Click a cell then type a number (Enter to confirm · Esc to cancel). '
  + 'Delete or Backspace clears the cell. The numbers go 1, 2, 3... along the path.';
const WALL_HINT = 'Click a cell near one of its sides to add or remove a wall there. A side on '
  + 'the border of the net is glued to the side with the same letter: its wall shows on both.';
const WALL_HINT_BALL = 'Click a cell near one of its sides to add or remove a wall there.';
const ORBIT_HINT = ' Turn the solid: right-drag, two fingers, drag the background, or the arrow '
  + 'keys. The small net shows the whole board.';
const BALL_HINT = ' Turn the ball: right-drag, two fingers, drag the background, or the arrow '
  + 'keys. The small ball shows its far side.';
const MAP_HINT = ' The two halves of the ball side by side; a cell on the rim is on both. Turn '
  + 'it as in the Ball view.';
const PLAY_HINT = 'Drag from checkpoint 1 through every cell, or tap the next cell. A side with '
  + 'a letter on the border continues at the same letter. Move back over the path to undo.';
const WALL_HINT_FLAT = 'Click a cell near one of its sides to add or remove a wall there. A side '
  + 'on the border of the board has no neighbour: nothing to wall.';
const PLAY_HINT_FLAT = 'Drag from checkpoint 1 through every cell, or tap the next cell. Move back '
  + 'over the path to undo.';
const PLAY_HINT_BALL = 'Drag from checkpoint 1 through every cell, or tap the next cell. The ball '
  + 'turns to the head of the path (Follow head). Move back over the path to undo.';

// A stopwatch that can be paused: seconds() is the time run so far, onTick gets it every 100 ms.
function createClock(onTick) {
  let elapsed = 0;
  let startedAt = 0;
  let timerId = null;
  const seconds = () => (timerId === null ? elapsed : (performance.now() - startedAt) / 1000);
  const stop = () => {
    if (timerId !== null) {
      elapsed = seconds();
      clearInterval(timerId);
      timerId = null;
    }
    return elapsed;
  };
  const resume = () => {
    stop();
    startedAt = performance.now() - elapsed * 1000;
    timerId = setInterval(() => onTick(seconds()), 100);
  };
  return {
    seconds,
    stop,
    resume,
    start() {
      elapsed = 0;
      resume();
    },
  };
}

const secText = seconds => `${seconds.toFixed(1)}s`;

export function createSurfaceController(ctx) {
  const { $, plural } = ctx;
  const host = $('sfBoard');
  const stage = document.querySelector('.stage');
  const clock = createClock(seconds => {
    $('playTimer').textContent = secText(seconds);
  });

  let kind = null; // null: the board is not a surface
  // The player typed a number of checkpoints: it stays (Generate, Reset, another size), until the
  // type changes. Else the field shows the default of the size.
  let kTyped = false;
  let P = null;
  let frame = null;
  let tool = 'number';
  let selected = -1;
  let buffer = '';
  let template = null;
  let templateVisible = true;
  let solutions = [];
  let visible = [];
  let lastNodes = 0;
  let lastCapped = false;
  let playing = false;
  let path = [];
  let drawing = false;
  let paused = false;
  let finished = false;
  let seededSolved = false;
  let working = false;
  let over = -1; // the cell the pointer was over at the previous sample of a drag
  // '3d': the solid itself; 'net': the assist (the net, or the two halves of a ball)
  let viewMode = '3d';
  let rotation = IDENTITY; // the 3D view
  let layouts = []; // what is drawn now: the net, the solid seen from `rotation`, or both halves
  let layout = null; // layouts[0]
  let frames = []; // the frame of each layout
  const pointers = new Map(); // pointer id -> [clientX, clientY], the pointers that are down
  let orbiting = null; // { start, last, active } while a drag turns the solid
  let suppressClick = false;
  let lastPoint = null; // the pointer in net coordinates, while a drag crosses a net
  // the turn that follows the head of the path in play (view/solid-nav.js)
  const turner = createTurner({
    getRotation: () => rotation,
    setRotation: R => {
      rotation = R;
    },
    redraw: () => draw(),
  });

  const topology = () => surfaceTopology(P.surface, P.n);
  const isBall = () => kind === BALL_KIND;
  const isFlat = () => kind === PENTAGON_KIND;
  // Whether the solid can be turned: the 3D view, and both views of a ball (not a flat board)
  const turnable = () => kind !== null && !isFlat() && (viewMode === '3d' || isBall());

  // ---------- drawing ----------
  function renderLegend() {
    const legend = $('legend');
    legend.innerHTML = '';
    const chip = (color, text, off, onClick) => {
      const button = document.createElement('button');
      button.className = `legend-item${off ? ' off' : ''}`;
      button.innerHTML = `<span class="swatch" style="background:${color}"></span> ${text}`;
      button.addEventListener('click', onClick);
      legend.appendChild(button);
    };
    if (template) {
      chip(TPL_C, 'Template path', !templateVisible, () => {
        templateVisible = !templateVisible;
        renderLegend();
        draw();
      });
    }
    solutions.forEach((_, i) => {
      const capped = lastCapped ? ' (capped)' : '';
      const text = `Solution ${i + 1} — ${plural(lastNodes, 'node')}${capped}`;
      chip(SOL_C[i % SOL_C.length], text, !visible[i], () => {
        visible[i] = !visible[i];
        renderLegend();
        draw();
      });
    });
  }

  function paintValidity() {
    const result = validateSurface(P);
    const el = $('validity');
    el.className = `validity ${result.ok ? 'good' : 'bad'}`;
    el.textContent = result.ok
      ? `Checkpoints 1…${result.max} — valid ✓ · ${plural(wallCount(P), 'wall')}`
      : result.msg;
  }

  function paintInfo() {
    const info = $('playInfo');
    const total = topology().T;
    if (!path.length) {
      info.textContent = `Drag from checkpoint 1 to start. 0 / ${total} cells.`;
    } else if (path.length === total && isSolved(P, path)) {
      info.textContent = '🎉 Solved! Every cell visited exactly once.';
      if (!finished) {
        finished = true;
        const seconds = clock.stop();
        $('playTimer').textContent = `${secText(seconds)} — solved`;
        if (!seededSolved) {
          ctx.setTiming('play', seconds * 1000);
        }
        syncPlayUi();
      }
      return;
    } else {
      const next = nextNumber(P, path);
      const upNext = next ? `#${next}` : '—';
      info.textContent = `${path.length} / ${total} cells · next checkpoint: ${upNext}`;
    }
    if (finished) {
      // rewound off the finished cell: the clock runs again
      finished = false;
      ctx.clearTiming('play');
      clock.resume();
      syncPlayUi();
    }
  }

  // The layouts to draw: the main ones, and the one shown small in a corner (or null). A tetra
  // or cube is the solid with the net in the corner, or the net; a ball is the ball with its far
  // side in the corner, or both halves side by side.
  function layoutsFor(top) {
    if (isFlat()) {
      return { main: [buildFlat(top)], inset: null };
    }
    if (isBall()) {
      const options = viewMode === '3d' ? {} : { maxWidth: MAP_WIDTH };
      const back = buildBallView(top, behind(rotation), options);
      return viewMode === '3d'
        ? { main: [buildBallView(top, rotation)], inset: back }
        : { main: [buildBallView(top, rotation, options), back], inset: null };
    }
    return viewMode === '3d'
      ? { main: [buildView(top, rotation)], inset: buildNet(top) }
      : { main: [buildNet(top)], inset: null };
  }

  function draw() {
    const top = topology();
    const { main, inset } = layoutsFor(top);
    layouts = main;
    layout = main[0];
    const state = {
      P,
      selected,
      buffer,
      playing,
      path,
      template: templateVisible ? template : null,
      solutions,
      visible,
      continues: (from, to) => canPush(P, path, to, PLAY_STEP),
    };
    const pictures = main.map((net, i) => surfaceSvg(net, { ...state, idSuffix: String(i) }));
    frames = pictures.map(picture => picture.frame);
    frame = frames[0];
    const views = pictures
      .map((picture, i) => `<div class="sf-view" data-view="${i}">${picture.markup}</div>`)
      .join('');
    const small = inset
      ? surfaceSvg(inset, { ...state, selected: -1, idSuffix: 'm' }).markup
      : '';
    host.innerHTML = (pictures.length > 1 ? `<div class="sf-pair">${views}</div>` : views)
      + (inset ? `<div class="sf-mini">${small}</div>` : '');
    const gap = 12;
    const width = frames.reduce((total, each) => total + each.width, gap * (frames.length - 1));
    stage.style.setProperty('--board-size', `${width}px`);
    host.classList.toggle('wallmode', tool === 'wall' && !playing);
    host.classList.toggle('playmode', playing);
    host.classList.toggle('solid', turnable());
    host.classList.toggle('ball', isBall());
    $('sfWallTag').textContent = wallCount(P) ? `(${wallCount(P)})` : '';
    paintValidity();
    if (playing) {
      paintInfo();
    }
    ctx.renderTiming();
  }

  const stopAnimation = () => turner.stop();

  // The two view buttons: 3D (Ball) is the game's view, Net (Map) the assist.
  function syncViewButtons() {
    const ball = isBall();
    $('sfView3d').textContent = ball ? 'Ball' : '3D';
    $('sfView3d').title = ball
      ? 'The ball itself: turn it with a right-drag, two fingers, a drag on the background or '
        + 'the arrow keys'
      : 'The solid itself: turn it with a right-drag, two fingers, a drag on the background or '
        + 'the arrow keys';
    $('sfViewNet').textContent = ball ? 'Map' : 'Net';
    $('sfViewNet').title = ball
      ? 'The two halves of the ball side by side, to see every cell at once'
      : 'The solid cut open and laid flat';
    $('sfViewNet').classList.toggle('active', viewMode === 'net');
    $('sfView3d').classList.toggle('active', viewMode === '3d');
  }

  function setView(mode) {
    viewMode = mode;
    stopAnimation();
    syncViewButtons();
    updateHint();
    draw();
  }

  // 3D view in play: when the head of the path or one of the cells it can step to is turned away,
  // the solid turns (a few frames) to face the head, so the next cells are on the front.
  function followHead() {
    if (isFlat() || viewMode !== '3d' || !playing || !path.length || !$('sfFollow').checked) {
      return;
    }
    const top = topology();
    if (headTurnedAway(top, layout, path, isBall())) {
      turner.toward(top, path[path.length - 1]);
    }
  }

  // What a flat board is and what its shape gives away: the cells with only 2 neighbours fix both
  // their sides.
  function flatStatus(top) {
    const hint = shapeHint(top);
    return `Pentagon ${P.n}: ${plural(top.T, 'cell')} (${FACES[kind]}), ${plural(top.E, 'side')} `
      + `between two cells. ${plural(hint.twoNeighbour, 'cell')} with only 2 neighbours fix `
      + `${hint.fixed} of the ${hint.path} sides of the path before the first move. `
      + 'One path through every cell, the numbers in order.';
  }

  function updateHint() {
    if (isFlat()) {
      const wall = tool === 'wall' ? WALL_HINT_FLAT : NUMBER_HINT;
      setHintText($('hint'), playing ? PLAY_HINT_FLAT : wall);
      return;
    }
    const ball = isBall();
    const wall = ball ? WALL_HINT_BALL : WALL_HINT;
    const play = ball ? PLAY_HINT_BALL : PLAY_HINT;
    const base = playing ? play : tool === 'wall' ? wall : NUMBER_HINT;
    const solid = viewMode === '3d';
    const turning = ball ? (solid ? BALL_HINT : MAP_HINT) : solid ? ORBIT_HINT : '';
    setHintText($('hint'), base + turning);
  }

  function setTool(name) {
    tool = name;
    $('sfNumber').classList.toggle('active', name === 'number');
    $('sfWall').classList.toggle('active', name === 'wall');
    selected = -1;
    buffer = '';
    updateHint();
    draw();
  }

  // ---------- the board ----------
  // The choices of the shape/size select: the sizes of a tetra or cube, or the balls grouped by
  // composition (a ball that cannot be played is listed, disabled, with the reason).
  function fillShapes(n) {
    const select = $('sfSize');
    select.innerHTML = '';
    $('sfSizeLabel').textContent = isBall() ? 'Shape' : 'Size';
    if (isBall()) {
      for (const group of ballsByComposition()) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = `${group.label} · ${plural(group.balls[0].r.length, 'cell')}`;
        for (const ball of group.balls) {
          const option = document.createElement('option');
          option.value = ball.id;
          option.textContent = ball.ok ? ball.name : `${ball.name} (no solution)`;
          option.disabled = !ball.ok;
          option.title = ball.ok ? '' : ball.why;
          optgroup.appendChild(option);
        }
        select.appendChild(optgroup);
      }
    } else {
      const cellsOf = size => surfaceTopology(kind, size).T;
      const all = [...new Set([...SURFACE_SIZES[kind], n])];
      const sizes = all.sort((a, b) => cellsOf(a) - cellsOf(b));
      for (const size of sizes) {
        const option = document.createElement('option');
        option.value = String(size);
        option.textContent = `${size} (${surfaceTopology(kind, size).T} cells)`;
        select.appendChild(option);
      }
    }
    select.value = String(n);
    const cells = surfaceTopology(kind, n).T;
    $('sfK').max = String(cells);
    $('sfK').value = keptK({
      typed: kTyped, value: $('sfK').value, cells, fallback: startK(kind, n),
    });
  }

  // Shows puzzle q (kept as it is, without its path) with `tpl` as the template path.
  function adopt(q, tpl = null) {
    if (q.surface !== kind) {
      kTyped = false;
    }
    kind = q.surface;
    P = cloneSurfacePuzzle(q);
    template = tpl;
    templateVisible = true;
    solutions = [];
    visible = [];
    selected = -1;
    buffer = '';
    rotation = isFlat() ? IDENTITY : overview(topology());
    fillShapes(P.n);
    syncViewButtons();
    renderLegend();
  }

  // Edits drop what no longer fits the board: solutions, the template, their times.
  function touched() {
    solutions = [];
    visible = [];
    template = null;
    ctx.clearTiming('solve');
    renderLegend();
    ctx.setStatus('');
  }

  function enter(newKind, puzzle = null) {
    if (playing) {
      exitPlay();
    }
    const start = puzzle || makeSurfacePuzzle(newKind, DEFAULT_SIZE[newKind]);
    adopt(start, puzzle ? puzzle.path : null);
    tool = 'number';
    $('sfNumber').classList.add('active');
    $('sfWall').classList.remove('active');
    updateHint();
    draw();
    const top = topology();
    if (isBall()) {
      const ball = ballEntry(P.n);
      ctx.setStatus(
        `Ball, ${ball.name}: ${plural(top.T, 'cell')} (${compositionLabel(ball.f)}), `
          + `${plural(top.E, 'side')}. Turn it with the mouse; Map shows both halves. One path `
          + 'through every cell, the numbers in order.',
        'ok',
      );
      return;
    }
    if (isFlat()) {
      ctx.setStatus(flatStatus(top), 'ok');
      return;
    }
    ctx.setStatus(
      `${NAME[kind]} ${P.n}: ${plural(top.T, 'cell')} (${FACES[kind]}), ${plural(top.E, 'side')}. `
        + 'Turn the solid with the mouse; Net shows it cut open: a side with a letter on the '
        + 'border continues at the same letter elsewhere. One path through every cell, the '
        + 'numbers in order.',
      'ok',
    );
  }

  function leave() {
    stopAnimation();
    pointers.clear();
    orbiting = null;
    if (playing) {
      exitPlay();
    }
    kind = null;
    P = null;
    host.innerHTML = '';
    host.classList.remove('wallmode', 'playmode', 'solid', 'ball');
  }

  function reset() {
    if (playing) {
      exitPlay();
    }
    adopt(makeSurfacePuzzle(kind, P.n));
    draw();
    ctx.setStatus('');
  }

  // ---------- editing ----------
  // The picture (0: the only one, or the front half of a ball; 1: the far half) an event is in.
  function viewIndexOf(event) {
    const wrapper = event.target.closest?.('.sf-view');
    return wrapper ? Number(wrapper.dataset.view) : 0;
  }

  function netPoint(event, index) {
    const svg = host.querySelector(`.sf-view[data-view="${index}"] svg`);
    const rect = svg.getBoundingClientRect();
    const view = frames[index];
    const x = (event.clientX - rect.left) * (view.width / rect.width);
    const y = (event.clientY - rect.top) * (view.height / rect.height);
    return view.toNet(x, y);
  }

  function toggleWall(cell, event) {
    const index = viewIndexOf(event);
    const net = layouts[index];
    const point = netPoint(event, index);
    const slot = net.pickSide ? net.pickSide(cell, ...point) : pickSide(net, cell, ...point);
    const edge = topology().edgeAt[cell * SLOTS + slot];
    P.walls[edge] ^= 1;
    touched();
    draw();
  }

  host.addEventListener('click', event => {
    if (!kind || playing || working || suppressClick) {
      return;
    }
    const polygon = event.target.closest('[data-cell]');
    if (!polygon) {
      return;
    }
    const cell = Number(polygon.dataset.cell);
    if (tool === 'wall') {
      toggleWall(cell, event);
    } else {
      selected = cell;
      buffer = '';
      draw();
    }
  });

  function commitBuffer() {
    const number = parseInt(buffer, 10);
    if (buffer !== '' && number >= 1 && number <= topology().T) {
      for (let cell = 0; cell < P.cp.length; cell++) {
        if (P.cp[cell] === number) {
          P.cp[cell] = 0;
        }
      }
      P.cp[selected] = number;
      touched();
    }
    buffer = '';
    draw();
  }

  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '');
    if (ARROW_TURN[event.key] && turnable() && !ctx.modalOpen() && !typing) {
      event.preventDefault();
      stopAnimation();
      rotation = orbit(rotation, ...ARROW_TURN[event.key]);
      draw();
      return;
    }
    const blocked = !kind || ctx.modalOpen() || playing || working || tool !== 'number';
    if (blocked || selected < 0 || typing) {
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      buffer = (buffer + event.key).slice(0, 3);
    } else if (event.key === 'Backspace' && buffer) {
      event.preventDefault();
      buffer = buffer.slice(0, -1);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      buffer = '';
      P.cp[selected] = 0;
      touched();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitBuffer();
      return;
    } else if (event.key === 'Escape') {
      buffer = '';
    } else {
      return;
    }
    draw();
  });

  // ---------- play ----------
  const cellUnder = event => {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const polygon = hit?.closest('[data-cell]');
    return polygon && host.contains(polygon) ? Number(polygon.dataset.cell) : -1;
  };

  function syncPlayUi() {
    const button = $('pauseBtn');
    button.style.display = playing ? '' : 'none';
    button.disabled = finished;
    button.textContent = paused ? '▶ Resume' : '⏸ Pause';
  }

  function enterPlay(seed) {
    const result = validateSurface(P);
    if (!result.ok) {
      ctx.setStatus(`Fix the puzzle before playing: ${result.msg}`, 'error');
      return;
    }
    playing = true;
    path = seed ? seed.slice() : [];
    drawing = false;
    paused = false;
    finished = false;
    solutions = [];
    visible = [];
    selected = -1;
    buffer = '';
    seededSolved = Boolean(seed) && isSolved(P, path);
    ctx.clearTiming('play');
    $('playBtn').classList.add('on');
    $('playBtn').textContent = '■ Stop playing';
    $('playInfo').style.display = '';
    $('playTimer').style.display = '';
    clock.start();
    syncPlayUi();
    ctx.setStatus('');
    updateHint();
    renderLegend();
    draw();
  }

  function exitPlay() {
    stopAnimation();
    playing = false;
    drawing = false;
    paused = false;
    path = [];
    clock.stop();
    $('playBtn').classList.remove('on');
    $('playBtn').textContent = '▶ Play';
    $('playInfo').style.display = 'none';
    $('playTimer').style.display = 'none';
    syncPlayUi();
    updateHint();
    renderLegend();
    draw();
  }

  function togglePause() {
    if (!playing || finished) {
      return;
    }
    paused = !paused;
    drawing = false;
    if (paused) {
      $('playTimer').textContent = `${secText(clock.stop())} — paused`;
    } else {
      clock.resume();
      $('playTimer').textContent = secText(clock.seconds());
    }
    syncPlayUi();
  }

  // The press on `cell` in play: the first cell, a rewind to a cell of the path, or one step.
  function pressCell(cell) {
    stopAnimation(); // a turn towards the old head; followHead decides again on release
    if (!path.length) {
      if (P.cp[cell] !== 1) {
        $('playInfo').textContent = 'Start at checkpoint 1.';
        return false;
      }
      path = [cell];
    } else if (path.includes(cell)) {
      path = path.slice(0, path.indexOf(cell) + 1);
    } else if (!step(P, path, cell, PLAY_STEP)) {
      return false;
    }
    drawing = true;
    draw();
    return true;
  }

  const pointerCentre = () => {
    const all = [...pointers.values()];
    return [0, 1].map(axis => all.reduce((sum, point) => sum + point[axis], 0) / all.length);
  };

  host.addEventListener('pointerdown', event => {
    if (!kind || working) {
      return;
    }
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    const solid = turnable();
    if (solid && (pointers.size >= 2 || event.button === 2)) {
      // right button or two fingers: turn the solid at once
      stopAnimation();
      drawing = false;
      host.setPointerCapture(event.pointerId);
      orbiting = { start: pointerCentre(), last: pointerCentre(), active: true };
      return;
    }
    const cell = cellUnder(event);
    if (playing && !paused && cell >= 0) {
      event.preventDefault();
      host.setPointerCapture(event.pointerId);
      over = cell;
      lastPoint = crossing() ? netPoint(event, viewIndexOf(event)) : null;
      if (pressCell(cell)) {
        return;
      }
    }
    if (solid) {
      // anything else turns the solid once the pointer has moved a little, a click stays a click
      orbiting = { start: pointerCentre(), last: pointerCentre(), active: false };
    }
  });

  function turnSolid(event) {
    const [x, y] = pointerCentre();
    if (!orbiting.active) {
      if (Math.hypot(x - orbiting.start[0], y - orbiting.start[1]) < ORBIT_SLOP) {
        return;
      }
      orbiting.active = true;
      stopAnimation();
      host.setPointerCapture(event.pointerId);
    }
    rotation = orbit(
      rotation,
      (x - orbiting.last[0]) * ORBIT_SPEED,
      (y - orbiting.last[1]) * ORBIT_SPEED,
    );
    orbiting.last = [x, y];
    draw();
  }

  // The drag reached `cell`, coming from `from`: one step on the path, or one back. A cell drawn
  // right beside the head counts only when the pointer came from the head (so a drag over a
  // cell on its way to somewhere else changes nothing); a neighbour across a cut of the net is
  // somewhere else on the net and counts wherever the pointer lands.
  // Whether the board is a net with cuts: leaving the head over a cut is a step.
  const crossing = () => viewMode === 'net' && (layout.cuts?.length ?? 0) > 0;

  function dragTo(from, cell) {
    const head = path[path.length - 1];
    if (cell < 0 || cell === head) {
      return false;
    }
    const top = topology();
    const slot = slotBetween(top, head, cell);
    if (slot < 0 || (layout.glued[head * SLOTS + slot] && from !== head)) {
      return false;
    }
    return step(P, path, cell, PLAY_STEP) !== null;
  }

  host.addEventListener('pointermove', event => {
    if (!kind) {
      return;
    }
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
    }
    if (orbiting) {
      turnSolid(event);
      return;
    }
    if (!playing || !drawing) {
      return;
    }
    // a fast drag reaches the page as one event per frame: follow the positions in between too
    const moves = event.getCoalescedEvents?.() ?? [];
    let moved = false;
    for (const move of moves.length ? moves : [event]) {
      const cell = cellUnder(move);
      const at = crossing() ? netPoint(move, viewIndexOf(move)) : null;
      let next = cell;
      if (dragTo(over, cell)) {
        moved = true;
      } else if (at && lastPoint) {
        // the pointer left the head over a cut of the net: the path goes on where the cut leads
        const head = path[path.length - 1];
        const target = crossedCut(topology(), layout, head, lastPoint, at);
        if (target >= 0 && step(P, path, target, PLAY_STEP)) {
          moved = true;
          next = target;
        }
      }
      lastPoint = at;
      over = next;
    }
    if (moved) {
      draw();
    }
  });

  const release = event => {
    pointers.delete(event.pointerId);
    if (orbiting) {
      // the click that follows a turn is not a click
      suppressClick = orbiting.active;
      orbiting = null;
      setTimeout(() => {
        suppressClick = false;
      }, 50);
    }
    if (drawing) {
      drawing = false;
      followHead();
    }
  };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
  host.addEventListener('contextmenu', event => {
    if (turnable()) {
      event.preventDefault();
    }
  });

  // ---------- solve, generate, minimize ----------
  function solve() {
    if (playing) {
      exitPlay();
    }
    const result = validateSurface(P);
    if (!result.ok) {
      solutions = [];
      visible = [];
      renderLegend();
      ctx.setStatus(result.msg, 'error');
      return;
    }
    templateVisible = false;
    const t0 = performance.now();
    const found = solveSurface(P, { limit: 2, nodeCap: ctx.nodeLimit() });
    const ms = performance.now() - t0;
    solutions = [found.path, found.second].filter(Boolean);
    visible = solutions.map(() => true);
    lastNodes = found.nodes;
    lastCapped = found.capped;
    ctx.setTiming('solve', ms);
    draw();
    renderLegend();
    const info = ` (${found.nodes.toLocaleString()} nodes, ${ms.toFixed(0)}ms)`;
    if (found.count >= 2) {
      ctx.setStatus(
        'Multiple solutions — this puzzle is NOT unique. Showing 2 '
          + `(click the legend chips to toggle).${info}`,
        'warn',
      );
    } else if (found.count === 1) {
      const capped = 'Found 1 solution so far, but the search limit was reached — it may not be '
        + 'unique.';
      ctx.setStatus(
        found.capped ? `${capped}${info}` : `Unique solution found ✓${info}`,
        found.capped ? 'warn' : 'ok',
      );
    } else {
      const capped = 'Search limit reached without finding a solution — the puzzle may be '
        + 'unsolvable.';
      ctx.setStatus(
        found.capped ? `${capped}${info}` : `No solution exists for this puzzle.${info}`,
        found.capped ? 'warn' : 'error',
      );
    }
  }

  const wholeField = id => {
    const value = parseInt($(id).value, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  async function generate() {
    if (playing) {
      exitPlay();
    }
    const top = topology();
    const K = Math.min(Math.max(wholeField('sfK') ?? startK(kind, P.n), 2), top.T);
    const maxWalls = wholeField('sfWalls');
    const seed = ctx.currentSeed();
    const clockMs = { ms: 0 };
    working = true;
    ctx.setBusy(true);
    ctx.setStatus('Generating…', '');
    try {
      const run = generateSurfaceWithin(kind, P.n, seed, {
        K,
        maxWalls: maxWalls ?? Infinity,
        tries: maxWalls === null ? 1 : GEN_TRIES,
      });
      const made = await runAsync(measured(run, clockMs), {
        onEvent: event => {
          const tries = maxWalls === null ? '' : ` (puzzle ${event.attempt})`;
          const checked = event.phase === 'walls'
            ? ` · ${event.done} / ${event.total} walls checked`
            : '';
          ctx.setStatus(`Generating…${tries}${checked}`, '');
        },
      });
      adopt(made.puzzle, made.path);
      ctx.setTiming('gen', clockMs.ms);
      draw();
      const limited = maxWalls !== null && !made.hit;
      const unproven = made.undecided
        ? ` ${plural(made.undecided, 'wall')} kept without proof (search cap reached): `
          + 'fewer may do.'
        : '';
      const missed = limited
        ? ` None of ${made.attempts} puzzles needed at most ${plural(maxWalls, 'wall')}: `
          + 'this is the one with the fewest.'
        : '';
      const seeds = made.attempts > 1 ? ` + ${made.attempts - 1}` : '';
      ctx.setStatus(
        `Generated a ${NAME[kind]} puzzle: ${plural(made.K, 'checkpoint')}, `
          + `${plural(made.walls, 'wall')}, unique (proof ${plural(made.nodes, 'node')}). `
          + `Seed ${seed}${seeds}.${missed}${unproven} The template path is shown dashed.`,
        limited ? 'warn' : 'ok',
      );
    } catch (error) {
      ctx.setStatus(error.message, 'error');
    } finally {
      working = false;
      ctx.setBusy(false);
    }
  }

  async function minimize() {
    if (playing) {
      exitPlay();
    }
    const result = validateSurface(P);
    if (!result.ok) {
      ctx.setStatus(`Fix the puzzle before minimizing: ${result.msg}`, 'error');
      return;
    }
    if (!wallCount(P)) {
      ctx.setStatus('There are no walls to minimize.', 'warn');
      return;
    }
    const limit = ctx.nodeLimit();
    const first = solveSurface(P, { limit: 2, nodeCap: limit });
    if (first.capped || first.count !== 1) {
      const why = first.capped
        ? 'the search limit was reached before confirming it'
        : first.count === 0 ? 'it has no solution' : 'it has multiple solutions';
      ctx.setStatus(
        `Can't minimize — the puzzle isn't uniquely solvable as-is (${why}). `
          + 'Solve first to check, add walls to disambiguate, or raise the search limit.',
        'error',
      );
      return;
    }
    const before = wallCount(P);
    working = true;
    ctx.setBusy(true);
    try {
      const done = await runAsync(minimizeSurfaceWalls(P, Math.random, limit), {
        onEvent: event => {
          ctx.setStatus(`Minimizing… ${event.done} / ${event.total} walls checked`, '');
        },
      });
      touched();
      draw();
      const unproven = done.undecided
        ? ` ${plural(done.undecided, 'wall')} kept without proof: the search limit was reached. `
          + 'Raise it and minimize again.'
        : '';
      const result = done.removed === 0
        ? `All ${plural(before, 'wall')} are already necessary.`
        : `Removed ${plural(done.removed, 'unnecessary wall')}; ${done.kept} left.`;
      ctx.setStatus(`${result}${unproven}`, done.undecided ? 'warn' : 'ok');
    } finally {
      working = false;
      ctx.setBusy(false);
    }
  }

  // ---------- bindings ----------
  $('sfSize').onchange = () => {
    if (working) {
      return;
    }
    if (playing) {
      exitPlay();
    }
    adopt(makeSurfacePuzzle(kind, isBall() ? $('sfSize').value : Number($('sfSize').value)));
    draw();
    ctx.setStatus(isFlat() ? flatStatus(topology()) : '', isFlat() ? 'ok' : undefined);
  };
  $('sfK').addEventListener('input', () => {
    kTyped = true;
  });
  $('sfView3d').onclick = () => setView('3d');
  $('sfViewNet').onclick = () => setView('net');
  $('sfNumber').onclick = () => setTool('number');
  $('sfWall').onclick = () => setTool('wall');
  $('sfGenerate').onclick = generate;
  $('sfMinimize').onclick = minimize;
  $('sfClearWalls').onclick = () => {
    P.walls.fill(0);
    touched();
    draw();
  };

  return {
    get active() {
      return kind !== null;
    },
    get kind() {
      return kind;
    },
    get playing() {
      return playing;
    },
    get playPath() {
      return path;
    },
    enter,
    leave,
    reset,
    solve,
    togglePlay: seed => (playing ? exitPlay() : enterPlay(seed)),
    togglePause,
    text: () => serializeSurface(P),
    exportText: withPath => serializeSurface(P, {
      path: withPath ? path : null,
      times: ctx.exportTimes(),
    }),
  };
}
