import { PLAY_SIZES, generate } from '../core/gen/generate.js';
import { HINT_PENALTY_S, maxHints, penalizedTime } from '../features/hints.js';
import { runAsync } from '../platform/run.js';
import {
  sfxBack, sfxBlocked, sfxCheckpoint, sfxMove, sfxSolved,
} from '../platform/sound.js';
import { cellAtPoint } from '../view/geometry.js';
import { DEFAULT_SIZE } from './config.js';
import { edgeAt } from './cut.js';
import { createDrawing, unsupported } from './drawing.js';
import { coopHint } from './hint.js';
import { recordSolve } from './stats.js';
import { changed, startStroke, strokeStep, undoStroke } from './stroke.js';
import { tx } from './texts.js';
import { boardMarkup } from './view.js';

// The Free draw overlay: a full-screen layer on top of the app, with its own markup, its own state
// and its own pointer handling. It never reads or writes the app's state; it only draws on top.
// `env` = { stats, saveStats, onClose }: the trial's own statistics record, how to store it, and
// what to do when the player leaves.
const randomSeed = () => (Math.random() * 2 ** 31) >>> 0;
const HOLD_MS = 500; // press and hold this long on a line to cut it
const HOLD_SLOP_PX = 10; // moving the pointer farther than this is a drag, not a hold
const seconds = value => `${value.toFixed(1)}s`;
const el = (id) => document.getElementById(id);

export function openScreen(env) {
  const root = document.createElement('div');
  root.id = 'coopRoot';
  root.className = 'coop-root';
  document.body.append(root);

  const state = {
    phase: 'setup', // setup | generating | playing | solved
    size: DEFAULT_SIZE,
    progress: 0,
    token: 0, // changes when a running generation must be forgotten
    puzzle: null,
    drawing: null,
    confirming: false, // the "leave this game?" question is on screen
    cutAt: -Infinity, // when a line was last cut (a touch long press also fires a contextmenu)
    history: [],
    hint: null,
    hintsUsed: 0,
    startedAt: 0,
    elapsed: 0,
    timer: null,
  };
  const strokes = new Map(); // pointer id -> { stroke, refused }

  // ---------- markup ----------
  const shell = body => `<div class="coop-shell"><header class="coop-head">`
    + `<b>${tx('title')}</b><span class="coop-tag">${tx('trial')}</span>`
    + `<button type="button" class="coop-btn" data-act="exit">${tx('exit')}</button></header>`
    + `<main class="coop-main">${body}</main></div>`;

  function renderSetup() {
    const sizes = PLAY_SIZES.map(n => `<button type="button" class="coop-btn coop-size" `
      + `data-act="size" data-size="${n}" aria-pressed="${n === state.size}">`
      + `${tx('cells', n)}</button>`).join('');
    root.innerHTML = shell(`<p class="coop-help">${tx('help')}</p>`
      + `<p class="coop-label">${tx('size')}</p><div class="coop-row">${sizes}</div>`
      + `<div class="coop-row"><button type="button" class="coop-btn coop-primary" `
      + `data-act="start">${tx('start')}</button></div><p class="coop-msg" id="coopMsg" `
      + 'role="status" aria-live="polite"></p>');
  }

  function renderGenerating() {
    root.innerHTML = shell(`<p class="coop-help" id="coopGen">${tx('generating', state.progress)}`
      + '</p>');
  }

  function renderGame() {
    root.innerHTML = shell(`<p class="coop-help">${tx('help')}</p>`
      + `<div class="coop-hud"><span>${tx('time')} <b id="coopTime">0.0s</b></span></div>`
      + '<div id="coopDone"></div>'
      + '<div class="coop-frame"><div class="coop-board" id="coopBoard"></div></div>'
      + '<p class="coop-msg" id="coopMsg" role="status" aria-live="polite"></p>'
      + '<div class="coop-row" id="coopTools">'
      + `<button type="button" class="coop-btn" data-act="undo">${tx('undo')}</button>`
      + `<button type="button" class="coop-btn" data-act="clear">${tx('clear')}</button>`
      + '<button type="button" class="coop-btn" data-act="hint" id="coopHint"></button></div>');
    redrawBoard();
    updateHintButton();
    updateTime();
  }

  function redrawBoard() {
    const board = el('coopBoard');
    if (board) {
      board.innerHTML = boardMarkup(state.puzzle, state.drawing, state.hint);
    }
  }

  function updateHintButton() {
    const button = el('coopHint');
    if (!button) {
      return;
    }
    const left = maxHints(state.puzzle) - state.hintsUsed;
    button.textContent = tx('hintsLeft', left);
    button.disabled = state.phase !== 'playing';
  }

  const setMessage = text => {
    const message = el('coopMsg');
    if (message) {
      message.textContent = text;
    }
  };

  function updateTime() {
    const time = el('coopTime');
    if (time) {
      time.textContent = seconds(state.elapsed);
    }
  }

  // ---------- game ----------
  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
  }

  function startTimer() {
    stopTimer();
    state.startedAt = performance.now();
    state.timer = setInterval(() => {
      state.elapsed = (performance.now() - state.startedAt) / 1000;
      updateTime();
    }, 100);
  }

  async function startGame() {
    const token = ++state.token;
    state.phase = 'generating';
    state.progress = 0;
    renderGenerating();
    let puzzle = null;
    try {
      puzzle = await runAsync(generate(state.size, randomSeed()), {
        onEvent: event => {
          if (token === state.token && event.frac != null) {
            state.progress = Math.round(100 * event.frac);
            const label = el('coopGen');
            if (label) {
              label.textContent = tx('generating', state.progress);
            }
          }
        },
      });
    } catch (error) {
      console.warn('coop: generation failed', error);
    }
    if (token !== state.token) {
      return; // the player left meanwhile
    }
    if (!puzzle || unsupported(puzzle)) {
      state.phase = 'setup';
      renderSetup();
      setMessage(tx('failed'));
      return;
    }
    state.puzzle = puzzle;
    state.drawing = createDrawing(puzzle);
    state.history = [];
    state.hint = null;
    state.hintsUsed = 0;
    state.elapsed = 0;
    state.phase = 'playing';
    strokes.clear();
    renderGame();
    startTimer();
  }

  async function finish() {
    stopTimer();
    state.phase = 'solved';
    state.elapsed = (performance.now() - state.startedAt) / 1000;
    state.hint = null;
    sfxSolved();
    const total = penalizedTime(state.elapsed, state.hintsUsed);
    const summary = recordSolve(env.stats, state.puzzle.n, total);
    env.saveStats();
    redrawBoard();
    updateHintButton();
    updateTime();
    const penalty = state.hintsUsed > 0
      ? tx('penalty', seconds(total), HINT_PENALTY_S * state.hintsUsed, state.hintsUsed)
      : '';
    const done = el('coopDone');
    done.innerHTML = `<div class="coop-done"><b>${tx('solved', seconds(total))}</b>`
      + `${penalty ? `<span>${penalty}</span>` : ''}`
      + `<span>${tx('stats', seconds(summary.best), seconds(summary.mean), summary.n)}</span>`
      + `<button type="button" class="coop-btn coop-primary" data-act="again">${tx('again')}`
      + '</button></div>';
  }

  function afterEdit() {
    state.hint = null;
    redrawBoard();
    if (state.drawing.solved()) {
      finish();
    }
  }

  // ---------- pointer input ----------
  // The pointer is measured against the drawing itself: the wrapper around it can be wider.
  const drawingRect = board => board.firstElementChild.getBoundingClientRect();

  function cellAt(board, event) {
    const rect = drawingRect(board);
    return cellAtPoint(
      state.puzzle.n,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  function applyStep(entry, cell) {
    if (cell === entry.stroke.head) {
      entry.refused = null;
    }
    const result = strokeStep(state.drawing, entry.stroke, cell);
    if (result.kind === 'blocked') {
      if (entry.refused !== cell) {
        entry.refused = cell;
        sfxBlocked();
        setMessage(tx(result.reason));
      }
      return;
    }
    if (result.kind === 'none' || result.kind === 'slide') {
      return;
    }
    entry.refused = null;
    setMessage('');
    if (result.kind === 'add') {
      (state.puzzle.cp[cell] ? sfxCheckpoint : sfxMove)();
    } else {
      sfxBack();
    }
    afterEdit();
  }

  // Cuts the line under the point (client coordinates), if there is one: true when it did.
  function cutAt(clientX, clientY) {
    const rect = drawingRect(el('coopBoard'));
    const n = state.puzzle.n;
    const x = ((clientX - rect.left) / rect.width) * n;
    const y = ((clientY - rect.top) / rect.height) * n;
    const edge = edgeAt(state.drawing, x, y);
    if (!edge) {
      return false;
    }
    state.drawing.remove(...edge);
    state.history.push({ head: edge[0], added: [], removed: [edge] });
    state.cutAt = performance.now();
    sfxBack();
    setMessage(tx('cut'));
    afterEdit();
    return true;
  }

  function onHoldElapsed(entry) {
    entry.hold = null;
    if (state.phase === 'playing' && !changed(entry.stroke) && cutAt(entry.x0, entry.y0)) {
      entry.cut = true;
    }
  }

  function endHold(entry) {
    clearTimeout(entry.hold);
    entry.hold = null;
  }

  function onPointerDown(event) {
    if (state.phase !== 'playing') {
      return;
    }
    const board = el('coopBoard');
    const cell = cellAt(board, event);
    if (cell < 0) {
      return;
    }
    event.preventDefault();
    try {
      board.setPointerCapture(event.pointerId);
    } catch {
      // no capture (not supported here): the drag still works while the pointer stays on the board
    }
    const entry = {
      stroke: startStroke(cell),
      refused: null,
      cut: false,
      hold: null,
      x: event.clientX,
      y: event.clientY,
      x0: event.clientX,
      y0: event.clientY,
    };
    entry.hold = setTimeout(() => onHoldElapsed(entry), HOLD_MS);
    strokes.set(event.pointerId, entry);
    setMessage('');
  }

  // Pointer moves can skip cells: walk from the last point to the new one in small steps.
  function onPointerMove(event) {
    const entry = strokes.get(event.pointerId);
    if (!entry || entry.cut || state.phase !== 'playing') {
      return;
    }
    const moved = Math.hypot(event.clientX - entry.x0, event.clientY - entry.y0);
    if (entry.hold && moved > HOLD_SLOP_PX) {
      endHold(entry);
    }
    const board = el('coopBoard');
    const cellPx = drawingRect(board).width / state.puzzle.n;
    const dx = event.clientX - entry.x;
    const dy = event.clientY - entry.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cellPx / 3)));
    for (let i = 1; i <= steps && state.phase === 'playing'; i++) {
      const probe = { clientX: entry.x + (dx * i) / steps, clientY: entry.y + (dy * i) / steps };
      applyStep(entry, cellAt(board, probe));
    }
    entry.x = event.clientX;
    entry.y = event.clientY;
  }

  function onPointerEnd(event) {
    const entry = strokes.get(event.pointerId);
    if (!entry) {
      return;
    }
    endHold(entry);
    strokes.delete(event.pointerId);
    if (changed(entry.stroke) && state.phase === 'playing') {
      state.history.push(entry.stroke);
    }
  }

  // ---------- buttons ----------
  function showHint() {
    if (state.phase !== 'playing') {
      return;
    }
    if (state.hintsUsed >= maxHints(state.puzzle)) {
      setMessage(tx('noHints'));
      return;
    }
    const hint = coopHint(state.puzzle, state.drawing);
    if (hint.kind === 'none') {
      return;
    }
    state.hintsUsed++;
    state.hint = hint;
    setMessage(tx(hint.kind === 'wrong' ? 'hintWrong' : 'hintNext'));
    redrawBoard();
    updateHintButton();
  }

  function undo() {
    const stroke = state.history.pop();
    if (state.phase === 'playing' && stroke) {
      undoStroke(state.drawing, stroke);
      sfxBack();
      afterEdit();
    }
  }

  function clearAll() {
    if (state.phase === 'playing') {
      state.drawing.clear();
      state.history = [];
      afterEdit();
    }
  }

  // ---------- leaving ----------
  // Asked only when a game is running and there is something to lose: a line on the board.
  const needsConfirm = () => state.phase === 'playing' && state.drawing.count() > 0;

  function askLeave() {
    state.confirming = true;
    root.insertAdjacentHTML('beforeend', `<div class="coop-confirm" id="coopConfirm" `
      + 'role="alertdialog" aria-modal="true" aria-labelledby="coopConfirmTitle">'
      + `<div class="coop-dialog"><b id="coopConfirmTitle">${tx('leaveTitle')}</b>`
      + `<span>${tx('leaveBody')}</span><div class="coop-row">`
      + `<button type="button" class="coop-btn coop-primary" id="coopStay" data-act="stay">`
      + `${tx('stay')}</button>`
      + `<button type="button" class="coop-btn" data-act="leave">${tx('leave')}</button>`
      + '</div></div></div>');
    el('coopStay')?.focus();
  }

  function closeConfirm() {
    state.confirming = false;
    el('coopConfirm')?.remove();
  }

  function requestExit() {
    if (state.confirming) {
      return;
    }
    if (needsConfirm()) {
      askLeave();
    } else {
      close();
    }
  }

  function onClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button || !root.contains(button)) {
      return;
    }
    const actions = {
      exit: requestExit,
      stay: closeConfirm,
      leave: close,
      size: () => {
        state.size = Number(button.dataset.size);
        renderSetup();
      },
      start: startGame,
      again: startGame,
      undo,
      clear: clearAll,
      hint: showHint,
    };
    actions[button.dataset.act]?.();
  }

  // Esc asks before leaving a game with lines on the board; with the question open it answers
  // "keep playing".
  function onKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }
    if (state.confirming) {
      closeConfirm();
    } else {
      requestExit();
    }
  }

  function close() {
    state.token++;
    stopTimer();
    strokes.forEach(endHold);
    strokes.clear();
    document.removeEventListener('keydown', onKeyDown);
    root.remove();
    env.onClose();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', event => {
    if (!state.confirming && event.target.closest('#coopBoard')) {
      onPointerDown(event);
    }
  });
  root.addEventListener('contextmenu', event => {
    if (!event.target.closest('#coopBoard')) {
      return;
    }
    event.preventDefault();
    const justCut = performance.now() - state.cutAt < 1000;
    if (state.phase === 'playing' && !state.confirming && !justCut) {
      cutAt(event.clientX, event.clientY);
    }
  });
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('keydown', onKeyDown);
  renderSetup();
  return { close };
}
