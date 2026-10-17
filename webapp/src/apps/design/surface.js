// The design app's controller for the closed-surface types (Tetrahedron, Cube): it owns the
// surface puzzle, draws it as a flat net (surface-board.js) and runs the tools, Generate, Minimize
// walls, Solve, Play and the text export. design.html shows its panels while the type is a
// surface (data-variants); main.js hands over the shared buttons (Solve, Play, Export, Reset) and
// the seed, status, timing and busy state, which come in through `ctx`.
import { SURFACE_SIZES, SLOTS, surfaceTopology } from '../../core/surface/topology.js';
import {
  makeSurfacePuzzle,
  cloneSurfacePuzzle,
  validateSurface,
  wallCount,
  isSolved,
  step,
  nextNumber,
  serializeSurface,
} from '../../core/surface/puzzle.js';
import { solveSurface } from '../../core/surface/solve.js';
import { defaultK, generateSurfaceWithin, minimizeSurfaceWalls } from '../../core/surface/gen.js';
import { buildNet, pickSide, slotBetween } from '../../view/surface-net.js';
import { runAsync, measured } from '../../platform/run.js';
import { setHintText } from '../../ui/hint-popover.js';
import { surfaceSvg } from './surface-board.js';
import { TPL_C, SOL_C } from './board.js';

const NAME = { tetra: 'Tetrahedron', cube: 'Cube' };
const FACES = { tetra: '4 faces of n × n triangles', cube: '6 faces of n × n squares' };
const DEFAULT_SIZE = { tetra: 4, cube: 3 };
// Puzzles Generate makes (new seeds in turn) while looking for one within Max walls.
const GEN_TRIES = 20;
const PLAY_STEP = { strictOrder: true };

const NUMBER_HINT = 'Click a cell then type a number (Enter to confirm · Esc to cancel). '
  + 'Delete or Backspace clears the cell. The numbers go 1, 2, 3... along the path.';
const WALL_HINT = 'Click a cell near one of its sides to add or remove a wall there. A side on '
  + 'the border of the net is glued to the side with the same letter: its wall shows on both.';
const PLAY_HINT = 'Drag from checkpoint 1 through every cell, or tap the next cell. A side with '
  + 'a letter on the border continues at the same letter. Move back over the path to undo.';

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

  const topology = () => surfaceTopology(P.surface, P.n);

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

  function draw() {
    const net = buildNet(topology());
    const picture = surfaceSvg(net, {
      P,
      selected,
      buffer,
      playing,
      path,
      template: templateVisible ? template : null,
      solutions,
      visible,
    });
    frame = picture.frame;
    host.innerHTML = picture.markup;
    stage.style.setProperty('--board-size', `${frame.width}px`);
    host.classList.toggle('wallmode', tool === 'wall' && !playing);
    host.classList.toggle('playmode', playing);
    $('sfWallTag').textContent = wallCount(P) ? `(${wallCount(P)})` : '';
    paintValidity();
    if (playing) {
      paintInfo();
    }
    ctx.renderTiming();
  }

  function updateHint() {
    setHintText($('hint'), playing ? PLAY_HINT : tool === 'wall' ? WALL_HINT : NUMBER_HINT);
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
  function fillSizes(n) {
    const sizes = [...new Set([...SURFACE_SIZES[kind], n])].sort((a, b) => a - b);
    const select = $('sfSize');
    select.innerHTML = '';
    for (const size of sizes) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = `${size} (${surfaceTopology(kind, size).T} cells)`;
      select.appendChild(option);
    }
    select.value = String(n);
    $('sfK').value = String(defaultK(kind, n));
    $('sfK').max = String(surfaceTopology(kind, n).T);
  }

  // Shows puzzle q (kept as it is, without its path) with `tpl` as the template path.
  function adopt(q, tpl = null) {
    kind = q.surface;
    P = cloneSurfacePuzzle(q);
    template = tpl;
    templateVisible = true;
    solutions = [];
    visible = [];
    selected = -1;
    buffer = '';
    fillSizes(P.n);
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
    ctx.setStatus(
      `${NAME[kind]} ${P.n}: ${plural(top.T, 'cell')} (${FACES[kind]}), ${plural(top.E, 'side')}. `
        + 'The net is the solid cut open: a side with a letter on the border continues at the '
        + 'same letter elsewhere. One path through every cell, the numbers in order.',
      'ok',
    );
  }

  function leave() {
    if (playing) {
      exitPlay();
    }
    kind = null;
    P = null;
    host.innerHTML = '';
    host.classList.remove('wallmode', 'playmode');
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
  function netPoint(event) {
    const rect = host.querySelector('svg').getBoundingClientRect();
    const x = (event.clientX - rect.left) * (frame.width / rect.width);
    const y = (event.clientY - rect.top) * (frame.height / rect.height);
    return frame.toNet(x, y);
  }

  function toggleWall(cell, event) {
    const net = buildNet(topology());
    const slot = pickSide(net, cell, ...netPoint(event));
    const edge = topology().edgeAt[cell * SLOTS + slot];
    P.walls[edge] ^= 1;
    touched();
    draw();
  }

  host.addEventListener('click', event => {
    if (!kind || playing || working) {
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
    const blocked = !kind || ctx.modalOpen() || playing || working || tool !== 'number';
    if (blocked || selected < 0 || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '')) {
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

  host.addEventListener('pointerdown', event => {
    if (!kind || !playing || paused || working) {
      return;
    }
    const cell = cellUnder(event);
    if (cell < 0) {
      return;
    }
    event.preventDefault();
    host.setPointerCapture(event.pointerId);
    over = cell;
    if (!path.length) {
      if (P.cp[cell] !== 1) {
        $('playInfo').textContent = 'Start at checkpoint 1.';
        return;
      }
      path = [cell];
    } else if (path.includes(cell)) {
      path = path.slice(0, path.indexOf(cell) + 1);
    } else if (!step(P, path, cell, PLAY_STEP)) {
      return;
    }
    drawing = true;
    draw();
  });

  // The drag reached `cell`, coming from `from`: one step on the path, or one back. A cell drawn
  // right beside the head counts only when the pointer came from the head (so a drag over a
  // cell on its way to somewhere else changes nothing); a neighbour across a cut of the net is
  // somewhere else on the net and counts wherever the pointer lands.
  function dragTo(from, cell) {
    const head = path[path.length - 1];
    if (cell < 0 || cell === head) {
      return false;
    }
    const top = topology();
    const slot = slotBetween(top, head, cell);
    if (slot < 0 || (buildNet(top).glued[head * SLOTS + slot] && from !== head)) {
      return false;
    }
    return step(P, path, cell, PLAY_STEP) !== null;
  }

  host.addEventListener('pointermove', event => {
    if (!kind || !playing || !drawing) {
      return;
    }
    // a fast drag reaches the page as one event per frame: follow the positions in between too
    const moves = event.getCoalescedEvents?.() ?? [];
    let moved = false;
    for (const move of moves.length ? moves : [event]) {
      const cell = cellUnder(move);
      moved = dragTo(over, cell) || moved;
      over = cell;
    }
    if (moved) {
      draw();
    }
  });

  const stopDrawing = () => {
    drawing = false;
  };
  host.addEventListener('pointerup', stopDrawing);
  host.addEventListener('pointercancel', stopDrawing);

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
    const K = Math.min(Math.max(wholeField('sfK') ?? defaultK(kind, P.n), 2), top.T);
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
    adopt(makeSurfacePuzzle(kind, Number($('sfSize').value)));
    draw();
    ctx.setStatus('');
  };
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
