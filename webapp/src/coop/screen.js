import { serialize } from '../core/format.js';
import { playGradesFor } from '../core/grades.js';
import { actionIcon } from '../apps/play/icons.js';
import { HINT_PENALTY_S, maxHints, penalizedTime } from '../features/hints.js';
import { runAsync } from '../platform/run.js';
import {
  sfxBack, sfxBlocked, sfxCheckpoint, sfxMove, sfxSolved,
} from '../platform/sound.js';
import { t } from '../ui/i18n.js';
import { cellAtPoint } from '../view/geometry.js';
import { DEFAULT_SIZE } from './config.js';
import { edgeAt } from './cut.js';
import { unsupported } from './drawing.js';
import { coopHint } from './hint.js';
import {
  confirmDialog, exportDialog, gamePage, generatingPage, invitePage, joinPage, lobbyPage,
  menuPage, resultCard,
} from './pages.js';
import { createReplica } from './replica.js';
import {
  acceptReply, createInvite, joinInvite, probeServers, probeText, rtcSupported,
} from './rtc.js';
import { createSession } from './session.js';
import { recordSolve } from './stats.js';
import {
  changed, startStroke, strokeStep, undoStroke,
} from './stroke.js';
import { tx } from './texts.js';
import {
  nearestSize, sizesFor, statKey, variantById, variantOf,
} from './variants.js';
import { boardMarkup } from './view.js';

// The Free draw screens: a full-screen layer on top of the app's page, below its app bar, with its
// own markup, state and pointer handling. It never reads or writes the app's state. Phases:
//   menu -> (solo) generating -> playing -> solved
//   menu -> inviting (host) | joining (guest) -> lobby -> generating -> playing -> solved
// `env` = { stats, saveStats, onClose, isRevealed }: the trial's own statistics record, how to
// store it, what to do when the player leaves, and whether the app's hidden things are revealed.
const randomSeed = () => (Math.random() * 2 ** 31) >>> 0;
const seconds = value => `${value.toFixed(1)}s`;
const el = id => document.getElementById(id);
const HOLD_MS = 500; // press and hold this long on a line to cut it
const HOLD_SLOP_PX = 10; // moving the pointer farther than this is a drag, not a hold
const CONNECT_MS = 30000; // a connection that has not opened by then is given up
const linkFor = code => `${location.href.split('#')[0].split('?')[0]}#coop=${code}`;

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      input.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

function gradeOf(puzzle) {
  try {
    const { trap } = playGradesFor(puzzle);
    return trap.ok ? trap : null;
  } catch (error) {
    console.warn('coop: grading failed', error);
    return null;
  }
}

export function openScreen(env) {
  const root = document.createElement('div');
  root.id = 'coopRoot';
  root.className = 'coop-root';
  document.body.append(root);

  const state = {
    phase: 'menu',
    role: 'solo', // solo | host | guest
    size: DEFAULT_SIZE,
    token: 0, // changes when work in progress (a generation, a handshake) must be forgotten
    progress: 0,
    puzzle: null,
    seed: null,
    grade: null,
    drawing: null, // a replica (replica.js), also when playing alone
    history: [],
    hint: null,
    hintsUsed: 0,
    startedAt: 0,
    elapsed: 0,
    timer: null,
    confirming: false,
    exporting: false,
    revealed: env.isRevealed(),
    cutAt: -Infinity, // when a line was last cut (a touch long press also fires a contextmenu)
    session: null,
    connection: null,
    link: '',
    code: '',
    status: '',
    error: false,
    peerHere: false,
    waiting: false, // the host waits for the other device to take the new puzzle
    variant: 'standard', // the type of the next puzzle (variants.js)
    connectTimer: null,
    route: '', // dev line: how the connection runs (rtc.js describeRoute)
    probe: null, // dev line: promise of the per-server STUN check (asked once per connection)
  };
  const strokes = new Map(); // pointer id -> { stroke, refused, cut, hold, x, y, x0, y0 }
  const pid = () => (state.session ? state.session.pid : 0);
  const canShare = typeof navigator.share === 'function';

  // ---------- layer ----------
  function placeRoot() {
    const bar = document.querySelector('.app-bar');
    root.style.top = `${bar ? Math.round(bar.getBoundingClientRect().bottom) : 0}px`;
  }

  // ---------- screens ----------
  function render() {
    const rtc = rtcSupported();
    const pages = {
      menu: () => menuPage({ size: state.size, rtc, variant: state.variant }),
      inviting: () => invitePage({
        link: state.link, status: state.status, error: state.error, canShare,
      }),
      joining: () => joinPage({
        code: state.code, status: state.status, error: state.error, canShare,
      }),
      lobby: () => lobbyPage({
        role: state.role, size: state.size, status: state.status, variant: state.variant,
      }),
      generating: () => generatingPage({
        percent: state.progress, waiting: state.waiting, online: Boolean(state.session),
      }),
    };
    if (pages[state.phase]) {
      root.innerHTML = pages[state.phase]();
    } else {
      renderGame();
    }
    root.scrollTop = 0;
  }

  const setStatus = (text, error = false) => {
    state.status = text;
    state.error = error;
    const note = el('coopStatus');
    if (note) {
      note.textContent = text;
      note.classList.toggle('error', error);
    }
  };

  const setMessage = text => {
    const message = el('coopMsg');
    if (message) {
      message.textContent = text;
    }
  };

  // The name of the puzzle's type, for the title; nothing for a standard one.
  function kindName(puzzle) {
    const kind = variantOf(puzzle);
    return kind === 'standard' ? '' : t(`mode.${kind}`);
  }

  function gameView() {
    const trap = state.grade;
    const online = Boolean(state.session);
    const role = online ? state.role : 'solo';
    return {
      n: state.puzzle.n,
      online,
      pid: pid(),
      peerHere: state.peerHere,
      revealed: state.revealed,
      grade: trap ? trap.grade : null,
      seedText: `seed ${state.seed} · ${role}${state.route ? ` · ${state.route}` : ''}`,
      variantName: kindName(state.puzzle),
      devText: trap ? `trap ${trap.predicted.toFixed(2)}` : 'ungraded',
      time: state.elapsed,
      hintsLeft: { used: state.hintsUsed, cap: maxHints(state.puzzle) },
      canNew: state.role !== 'guest',
    };
  }

  function renderGame() {
    root.innerHTML = gamePage(gameView());
    redrawBoard();
    if (state.phase === 'solved') {
      renderDone();
    }
  }

  function redrawBoard() {
    const board = el('coopBoard');
    if (board) {
      board.innerHTML = boardMarkup(state.puzzle, state.drawing, state.hint);
    }
  }

  function updateHintButton() {
    const button = el('coopHint');
    if (button) {
      const cap = maxHints(state.puzzle);
      button.innerHTML = `${actionIcon('hint')}${t('game.hint', state.hintsUsed, cap)}`;
      button.disabled = state.phase !== 'playing';
    }
  }

  function updateTime() {
    const time = el('coopTime');
    if (time) {
      time.textContent = seconds(state.elapsed);
    }
  }

  // ---------- connection ----------
  function teardown() {
    state.token++;
    clearTimeout(state.connectTimer);
    state.connectTimer = null;
    stopTimer();
    strokes.forEach(endHold);
    strokes.clear();
    if (state.session) {
      state.session.leave();
    }
    state.connection?.close();
    Object.assign(state, {
      session: null, connection: null, role: 'solo', peerHere: false, waiting: false,
      link: '', code: '', status: '', error: false, route: '', probe: null,
    });
  }

  // Asks the connection how it runs and, while revealed, which STUN servers answer; shows it in
  // the game's dev tag (hold-V only).
  async function readRoute(connection) {
    const show = text => {
      if (connection !== state.connection) {
        return;
      }
      state.route = text;
      const tag = el('coopSeed');
      if (tag && state.puzzle) {
        tag.textContent = gameView().seedText;
      }
    };
    const route = (await connection.report?.().catch(() => '')) ?? '';
    show(route);
    if (state.revealed) {
      state.probe ??= probeServers().then(probeText);
      show(`${route} · ${await state.probe}`);
    }
    return state.route;
  }

  function showMenu() {
    teardown();
    state.phase = 'menu';
    render();
  }

  function armConnectTimer() {
    clearTimeout(state.connectTimer);
    state.connectTimer = setTimeout(async () => {
      if (state.phase === 'inviting' || state.phase === 'joining') {
        const why = state.revealed && state.connection ? await readRoute(state.connection) : '';
        setStatus(`${tx('noConnection')}${why ? ` (${why})` : ''}`, true);
      }
    }, CONNECT_MS);
  }

  // Wires a new connection to a session; when the channel opens, both sides say hello.
  function adopt(connection, role) {
    state.connection = connection;
    state.role = role;
    state.session = createSession({
      role, channel: connection.channel, onEvent: onSessionEvent,
    });
    connection.channel.onopen = () => {
      clearTimeout(state.connectTimer);
      readRoute(connection);
      state.session.hello();
      state.phase = 'lobby';
      state.status = role === 'host' ? tx('connected') : tx('waitStart');
      state.error = false;
      render();
    };
  }

  async function hostInvite() {
    teardown();
    const token = state.token;
    Object.assign(state, { phase: 'inviting', role: 'host', status: tx('making') });
    render();
    try {
      const { code, connection } = await createInvite();
      if (token !== state.token) {
        connection.close();
        return;
      }
      adopt(connection, 'host');
      state.link = linkFor(code);
      state.status = tx('waitFriend');
      render();
      armConnectTimer();
    } catch (error) {
      console.warn('coop: invite failed', error);
      setStatus(tx('noRtc'), true);
    }
  }

  async function connectReply() {
    const field = el('coopReply');
    if (!field || !state.connection) {
      return;
    }
    try {
      await acceptReply(state.connection, field.value);
      setStatus(tx('connecting'));
      armConnectTimer();
    } catch {
      setStatus(tx('badCode'), true);
    }
  }

  async function guestJoin(text) {
    teardown();
    const token = state.token;
    Object.assign(state, { phase: 'joining', role: 'guest', status: tx('joining') });
    render();
    try {
      const { code, connection } = await joinInvite(text);
      if (token !== state.token) {
        connection.close();
        return;
      }
      adopt(connection, 'guest');
      state.code = code;
      state.status = tx('connecting');
      render();
      armConnectTimer();
    } catch (error) {
      state.error = true;
      state.status = error.message === 'bad code' ? tx('badCode') : tx('noRtc');
      render();
    }
  }

  function onSessionEvent(event) {
    switch (event.type) {
      case 'peer':
        state.peerHere = true;
        if (!event.compatible) {
          setStatus(tx('incompatible'), true);
        }
        break;
      case 'puzzle': // guest: the host's new puzzle; the game starts on 'start'
        Object.assign(state, { puzzle: event.puzzle, seed: event.seed, drawing: event.replica });
        break;
      case 'start':
        beginPlaying();
        break;
      case 'op':
        if (state.phase === 'playing') {
          afterEdit();
        }
        break;
      case 'rejected':
        setMessage(tx('rejected'));
        redrawBoard();
        break;
      case 'hint':
        applyHint(event.hint);
        break;
      default: // left, closed
        state.peerHere = false;
        el('coopPeer')?.classList.add('gone');
        setMessage(tx('peerLeft'));
        if (state.phase === 'lobby') {
          setStatus(tx('peerLeft'), true);
        }
        break;
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
    if (state.role === 'guest') {
      setMessage(tx('onlyHost'));
      return;
    }
    const token = ++state.token;
    const seed = randomSeed();
    Object.assign(state, { phase: 'generating', progress: 0, waiting: false });
    stopTimer();
    render();
    let puzzle = null;
    try {
      puzzle = await runAsync(variantById(state.variant).generate(state.size, seed), {
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
      state.phase = state.session ? 'lobby' : 'menu';
      state.status = tx('failed');
      render();
      return;
    }
    state.puzzle = puzzle;
    state.seed = seed;
    if (state.session) {
      state.drawing = state.session.newGame(puzzle, seed);
      state.waiting = true;
      render(); // the game begins when the other device has the puzzle ('start')
    } else {
      state.drawing = createReplica(puzzle, { pid: 0 });
      beginPlaying();
    }
  }

  function beginPlaying() {
    state.grade = gradeOf(state.puzzle);
    Object.assign(state, {
      phase: 'playing', history: [], hint: null, hintsUsed: 0, elapsed: 0, waiting: false,
    });
    strokes.clear();
    renderGame();
    startTimer();
  }

  function finish() {
    stopTimer();
    state.phase = 'solved';
    state.elapsed = (performance.now() - state.startedAt) / 1000;
    state.hint = null;
    sfxSolved();
    redrawBoard();
    updateHintButton();
    updateTime();
    renderDone();
  }

  function renderDone() {
    const total = penalizedTime(state.elapsed, state.hintsUsed);
    const online = Boolean(state.session);
    const summary = recordOnce(online, total);
    const penalty = state.hintsUsed > 0
      ? t('game.penalty', seconds(HINT_PENALTY_S * state.hintsUsed), state.hintsUsed)
      : '';
    const lines = [];
    if (online) {
      const counts = [0, 0];
      for (const [a, b] of state.drawing.edges()) {
        counts[state.drawing.ownerOf(a, b) === pid() ? 0 : 1]++;
      }
      lines.push(tx('split', counts[0], counts[1]));
    }
    lines.push(tx(online ? 'stats2' : 'stats', seconds(summary.best), seconds(summary.mean),
      summary.n));
    const done = el('coopDone');
    if (done) {
      done.innerHTML = resultCard({ solved: t('game.solved', seconds(total), penalty), lines });
    }
  }

  // Records the solved game in the local statistics once, however often the screen is drawn.
  let recorded = null;
  function recordOnce(online, total) {
    if (recorded?.token !== state.startedAt) {
      const key = statKey(state.puzzle, online);
      recorded = { token: state.startedAt, summary: recordSolve(env.stats, key, total) };
      env.saveStats();
    }
    return recorded.summary;
  }

  function afterEdit() {
    state.hint = null;
    redrawBoard();
    if (state.phase === 'playing' && state.drawing.solved()) {
      finish();
    }
  }

  // ---------- pointer input ----------
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

  // Cuts the line under the point (client coordinates), if there is one: true when it did.
  function cutAt(clientX, clientY, player) {
    const rect = drawingRect(el('coopBoard'));
    const n = state.puzzle.n;
    const x = ((clientX - rect.left) / rect.width) * n;
    const y = ((clientY - rect.top) / rect.height) * n;
    const edge = edgeAt(state.drawing, x, y);
    if (!edge) {
      return false;
    }
    const owner = state.drawing.ownerOf(...edge);
    state.drawing.remove(...edge);
    state.history.push({ head: edge[0], added: [], removed: [[...edge, owner]], player });
    state.cutAt = performance.now();
    sfxBack();
    setMessage(tx('cut'));
    afterEdit();
    return true;
  }

  function onHoldElapsed(entry) {
    entry.hold = null;
    const player = entry.stroke.player;
    if (state.phase === 'playing' && !changed(entry.stroke) && cutAt(entry.x0, entry.y0, player)) {
      entry.cut = true;
    }
  }

  function endHold(entry) {
    clearTimeout(entry.hold);
    entry.hold = null;
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

  function onPointerDown(event) {
    if (state.phase !== 'playing' || state.confirming || state.exporting) {
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
      stroke: startStroke(cell, pid()),
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
  function applyHint(hint) {
    if (!hint || !Array.isArray(hint.edge) || state.phase !== 'playing') {
      return;
    }
    state.hint = { kind: hint.kind === 'wrong' ? 'wrong' : 'next', edge: hint.edge };
    state.hintsUsed = Math.max(state.hintsUsed, Number(hint.used) || 0);
    setMessage(tx(state.hint.kind === 'wrong' ? 'hintWrong' : 'hintNext'));
    redrawBoard();
    updateHintButton();
  }

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
    applyHint({ ...hint, used: state.hintsUsed + 1 });
    state.session?.sendHint({ kind: hint.kind, edge: hint.edge, used: state.hintsUsed });
  }

  // Takes back this player's last stroke.
  function undo() {
    const stroke = state.history.pop();
    if (state.phase === 'playing' && stroke) {
      undoStroke(state.drawing, stroke);
      sfxBack();
      afterEdit();
    }
  }

  // Erases this player's lines (alone: all of them).
  function clearAll() {
    if (state.phase === 'playing') {
      state.drawing.clear();
      state.history = [];
      afterEdit();
    }
  }

  // ---------- dialogs ----------
  // Asked only when a game is running and there is something to lose: a line on the board.
  const needsConfirm = () => state.phase === 'playing' && state.drawing.count() > 0;

  function requestLeave() {
    if (state.confirming) {
      return;
    }
    if (needsConfirm()) {
      state.confirming = true;
      root.insertAdjacentHTML('beforeend', confirmDialog());
      el('coopStay')?.focus();
    } else {
      showMenu();
    }
  }

  function closeConfirm() {
    state.confirming = false;
    el('coopConfirm')?.remove();
  }

  function openExport() {
    if (!state.puzzle || state.exporting) {
      return;
    }
    state.exporting = true;
    root.insertAdjacentHTML('beforeend', exportDialog(serialize(state.puzzle)));
    setTimeout(() => el('coopExportText')?.focus(), 30);
  }

  function closeExport() {
    state.exporting = false;
    el('coopExport')?.remove();
  }

  async function copyFrom(button) {
    const input = el(button.dataset.from);
    if (input && (await copyText(input.value, input))) {
      const old = button.textContent;
      button.textContent = tx('copied');
      setTimeout(() => {
        button.textContent = old;
      }, 1500);
    }
  }

  async function shareFrom(button) {
    const input = el(button.dataset.from);
    try {
      await navigator.share({ title: tx('title'), url: input.value });
    } catch {
      // the share sheet was closed
    }
  }

  async function copyExport() {
    const text = el('coopExportText');
    const done = text && (await copyText(text.value, text));
    const message = el('coopExportMsg');
    if (message) {
      message.textContent = done ? tx('copied') : '';
    }
  }

  function leaveGame() {
    closeConfirm();
    showMenu();
  }

  function close() {
    teardown();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', placeRoot);
    languageWatch?.disconnect();
    root.remove();
    env.onClose();
  }

  function onClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button || !root.contains(button)) {
      return;
    }
    const actions = {
      exit: close,
      solo: () => {
        state.role = 'solo';
        startGame();
      },
      host: hostInvite,
      connect: connectReply,
      cancel: showMenu,
      start: startGame,
      menu: requestLeave,
      new: startGame,
      leave: leaveGame,
      stay: closeConfirm,
      undo,
      clear: clearAll,
      hint: showHint,
      export: openExport,
      'export-close': closeExport,
      'export-copy': copyExport,
      copy: () => copyFrom(button),
      share: () => shareFrom(button),
    };
    actions[button.dataset.act]?.();
  }

  // Esc: closes what is open, else asks before leaving a game, else leaves the trial.
  function onKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }
    if (state.exporting) {
      closeExport();
    } else if (state.confirming) {
      closeConfirm();
    } else if (state.phase === 'playing' || state.phase === 'solved') {
      requestLeave();
    } else if (state.phase === 'menu') {
      close();
    } else {
      showMenu();
    }
  }

  // The app's language button redraws the screen in the new language.
  const toggle = document.getElementById('langToggle');
  const languageWatch = toggle ? new MutationObserver(() => {
    if (!state.confirming && !state.exporting) {
      render();
    }
  }) : null;
  languageWatch?.observe(toggle, { attributes: true, attributeFilter: ['data-on'] });

  // Shows or hides what the app keeps for hold-V: the seed, the grade's numbers, Export.
  function setRevealed(on) {
    state.revealed = on;
    if (on && state.connection) {
      readRoute(state.connection);
    }
    root.querySelectorAll('[data-dev]').forEach(node => {
      node.style.display = on ? '' : 'none';
    });
  }

  placeRoot();
  window.addEventListener('resize', placeRoot);
  root.addEventListener('click', onClick);
  root.addEventListener('change', event => {
    if (event.target.id === 'coopSize') {
      state.size = Number(event.target.value);
    }
    if (event.target.id === 'coopVariant') {
      state.variant = event.target.value;
      state.size = nearestSize(state.size, sizesFor(state.variant));
      render();
    }
  });
  root.addEventListener('pointerdown', event => {
    if (event.target.closest('#coopBoard')) {
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
      cutAt(event.clientX, event.clientY, pid());
    }
  });
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('keydown', onKeyDown);
  render();
  return { close, setRevealed, joinFrom: guestJoin };
}
