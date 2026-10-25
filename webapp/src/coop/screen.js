import { playGradesFor } from '../core/grades.js';
import { actionIcon } from '../apps/play/icons.js';
import { HINT_PENALTY_S, maxHints, penalizedTime } from '../features/hints.js';
import { runAsync } from '../platform/run.js';
import {
  sfxBack, sfxBlocked, sfxCheckpoint, sfxMove, sfxSolved,
} from '../platform/sound.js';
import { t } from '../ui/i18n.js';
import { DEFAULT_SIZE, SIGNAL_BROKERS } from './config.js';
import { edgeAt } from './cut.js';
import { unsupported } from './drawing.js';
import { coopHint } from './hint.js';
import { fromBase64Url, toBase64Url } from './invite.js';
import { hostRoom, joinRoom } from './join.js';
import { clearGame, loadGame, makeRecord, saveGame } from './keep.js';
import {
  confirmDialog, exportDialog, gamePage, generatingPage, invitePage, joinPage, lobbyPage,
  menuPage, resultCard, roomInvitePage, roomJoinPage, STAGE_TEXT,
} from './pages.js';
import { createReplica } from './replica.js';
import {
  acceptReply, createInvite, joinInvite, probeServers, probeText, rtcSupported,
} from './rtc.js';
import { resumeRoom } from './resume.js';
import { signalSupported } from './secret.js';
import { createSession } from './session.js';
import { createHub } from './signal.js';
import { recordSolve } from './stats.js';
import {
  changed, startStroke, strokeStep, undoStroke,
} from './stroke.js';
import { tx } from './texts.js';
import {
  nearestSize, sizeName, sizesFor, statKey, variantById, variantOf,
} from './variants.js';
import { portalPartner } from '../core/geom.js';
import { topologyOf } from '../core/surface/puzzle.js';
import { cellAtClient, cellPxOf, pressPoint } from './layout.js';
import { serializePuzzle } from './model.js';
import {
  ARROW_TURN, FOLLOW_EDGE, ORBIT_SLOP, cellUnder, createTurner, crossedCut, edgeNear, isSolid,
  netPoint, solidBoard, startRotation, turnBy, turnByKey, turnable,
} from './solid.js';
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
const GUEST_WAIT_MS = 180000; // the guest's: the host first has to copy the reply and paste it
const KEEP_DELAY_MS = 1000; // a game in progress is saved this long after the last change
const pageUrl = () => location.href.split('#')[0].split('?')[0];
const linkFor = code => `${pageUrl()}#c=${code}`;
const roomLinkFor = token => `${pageUrl()}#j=${token}`;


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
    jumpFrom: null, // Teleport: the portal where this player's last stroke ended
    view: '3d', // a solid: '3d' or 'net', kept from game to game until the page is reloaded
    rotation: null, // a solid: how it is turned (view/proj.js), this device only
    solidLayouts: [], // a solid: the pictures on the screen, for hit-testing
    solidFrames: [],
    connectTimer: null,
    mode: 'code', // inviting / joining: 'room' (by link, via brokers: join.js) or 'code' (by hand)
    secret: '', // the secret the two devices share (base64url): lets them find each other again
    kept: null, // a game kept on this device (keep.js), offered in the menu
    keepTimer: null,
    attempts: [], // connections made while looking for the other device, not open yet
    peerLeft: false, // the other device said bye: no reconnecting
    startedWall: 0, // when the game started (Date.now()): the time goes on over a reload
    hub: null, // room mode: the brokers (signal.js)
    room: null, // room mode: the host's or the guest's side of the room (join.js)
    requests: [], // host, room mode: the guests who wait for a decision [{ id, greeting }]
    needGreeting: false, // host: asks guests for a greeting; guest: the host does
    signalDown: false, // host, room mode: no broker could be reached
    stage: '', // guest, room mode: where the join is (join.js)
    greeting: '', // guest, room mode: what is typed
    signalText: '', // dev line: how the brokers did (signal.js report)
    route: '', // dev line: how the connection runs (rtc.js describeRoute)
    probe: null, // dev line: promise of the per-server STUN check (asked once per connection)
  };
  const strokes = new Map(); // pointer id -> { stroke, refused, cut, hold, x, y, x0, y0 }
  const pointers = new Map(); // pointer id -> [clientX, clientY], the pointers that are down
  let orbiting = null; // a solid: { start, last, active } while a drag turns it
  const turner = createTurner({
    getRotation: () => state.rotation,
    setRotation: rotation => {
      state.rotation = rotation;
    },
    redraw: () => redrawBoard(),
  });
  const solid = () => Boolean(state.puzzle) && isSolid(state.puzzle);
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
    const typed = el('coopGreeting'); // what the guest has typed survives a redraw
    if (typed) {
      state.greeting = typed.value;
    }
    const room = state.mode === 'room';
    const pages = {
      menu: () => menuPage({
        size: state.size,
        rtc,
        variant: state.variant,
        status: state.status,
        error: state.error,
        saved: Boolean(state.kept) && rtc && signalSupported(),
      }),
      inviting: () => (room ? roomInvitePage({
        link: state.link,
        status: state.status,
        error: state.error,
        canShare,
        requests: state.requests,
        needGreeting: state.needGreeting,
        down: state.signalDown,
      }) : invitePage({
        link: state.link, status: state.status, error: state.error, canShare,
      })),
      joining: () => (room ? roomJoinPage({
        stage: state.stage,
        greeting: state.greeting,
        needGreeting: state.needGreeting,
        status: state.status,
        error: state.error,
      }) : joinPage({
        code: state.code, status: state.status, error: state.error, canShare,
      })),
      lobby: () => lobbyPage({
        role: state.role, size: state.size, status: state.status, error: state.error,
        variant: state.variant,
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
      sizeName: sizeName(state.puzzle),
      viewLabel: solid() ? viewLabel() : '',
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

  // Teleport: the cell whose ring says "tap me to jump" (-1: none). It is the partner of the portal
  // where this player's last stroke ended, as long as the two can be linked.
  function ringCell() {
    const from = state.jumpFrom;
    if (from === null || !state.puzzle.portals) {
      return -1;
    }
    const partner = portalPartner(state.puzzle.portals, from);
    return partner >= 0 && state.drawing.check(from, partner) === null ? partner : -1;
  }

  function redrawBoard() {
    const board = el('coopBoard');
    if (board && solid()) {
      const picture = solidBoard(state.puzzle, state.drawing, {
        view: state.view, rotation: state.rotation, hint: state.hint,
      });
      board.classList.add('solid-wrap');
      board.classList.toggle('turnable', turnable(state.puzzle, state.view));
      board.classList.toggle('ball', state.puzzle.kind === 'ball');
      board.innerHTML = picture.html;
      Object.assign(state, { solidLayouts: picture.layouts, solidFrames: picture.frames });
    } else if (board) {
      const cell = ringCell();
      const ring = cell < 0 ? null : { cell, player: pid() };
      board.innerHTML = boardMarkup(state.puzzle, state.drawing, state.hint, ring);
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
  // The room (join.js) clears its messages from the brokers and closes the connections to them.
  function closeSignal() {
    state.room?.close();
    state.hub?.close();
    Object.assign(state, { room: null, hub: null });
  }

  function teardown() {
    state.token++;
    clearTimeout(state.connectTimer);
    state.connectTimer = null;
    closeSignal();
    clearTimeout(state.keepTimer);
    stopTimer();
    turner.stop();
    strokes.forEach(endHold);
    strokes.clear();
    pointers.clear();
    orbiting = null;
    if (state.session) {
      state.session.leave();
    }
    state.connection?.close();
    closeAttempts();
    Object.assign(state, {
      session: null, connection: null, role: 'solo', peerHere: false, waiting: false,
      secret: '', keepTimer: null, attempts: [], peerLeft: false, startedWall: 0,
      link: '', code: '', status: '', error: false, route: '', probe: null, mode: 'code',
      requests: [], needGreeting: false, signalDown: false, stage: '', greeting: '', signalText: '',
    });
  }

  // Asks the connection how it runs and, while revealed, which STUN servers answer; shows it in
  // the game's dev tag (hold-V only).
  async function readRoute(connection) {
    const show = text => {
      if (connection !== state.connection) {
        return;
      }
      state.route = state.signalText ? `${text} · ${state.signalText}` : text;
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
    if (state.session && (state.phase === 'playing' || state.phase === 'solved')) {
      forgetGame(); // left on purpose: nothing to take up again
    }
    teardown();
    state.phase = 'menu';
    render();
  }

  function armConnectTimer(ms = CONNECT_MS) {
    clearTimeout(state.connectTimer);
    state.connectTimer = setTimeout(async () => {
      if (state.phase === 'inviting' || state.phase === 'joining') {
        const why = state.revealed && state.connection ? await readRoute(state.connection) : '';
        setStatus(`${tx('noConnection')}${why ? ` (${why})` : ''}`, true);
      }
    }, ms);
  }

  // Wires a new connection to a session; when the channel opens, both sides say hello.
  function adopt(connection, role, secret) {
    state.connection = connection;
    state.role = role;
    state.secret = secret ? toBase64Url(secret) : '';
    state.peerLeft = false;
    state.session = createSession({
      role, channel: connection.channel, onEvent: onSessionEvent, heartbeat: true,
    });
    connection.channel.onopen = () => {
      if (state.phase !== 'inviting' && state.phase !== 'joining') {
        return; // the browser can announce an open channel twice; the first one counts
      }
      clearTimeout(state.connectTimer);
      state.signalText = state.hub?.report() ?? '';
      closeSignal();
      readRoute(connection);
      state.session.hello();
      state.phase = 'lobby';
      state.status = role === 'host' ? tx('connected') : tx('waitStart');
      state.error = false;
      render();
    };
  }

  // Host, by link: opens a room on the brokers and shows the link at once; guests ask to join
  // and the host decides (join.js). Without the means for it (an insecure page), by code.
  async function hostInvite() {
    if (!signalSupported()) {
      await hostCode();
      return;
    }
    teardown();
    const token = state.token;
    const hub = createHub({ brokers: SIGNAL_BROKERS });
    Object.assign(state, {
      phase: 'inviting', role: 'host', mode: 'room', hub, status: tx('making'),
    });
    render();
    const current = () => token === state.token;
    try {
      const room = await hostRoom({
        hub,
        onRequest: list => {
          if (current()) {
            state.requests = list;
            render();
          }
        },
        onConnection: (connection, secret) => current() && adopt(connection, 'host', secret),
        onDown: () => {
          if (current() && state.phase === 'inviting') {
            Object.assign(state, { signalDown: true, status: tx('noSignalHost'), error: true });
            render();
          }
        },
        onExpired: () => {
          if (current() && state.phase === 'inviting') {
            Object.assign(state, {
              room: null, hub: null, link: '', requests: [], status: tx('expired'), error: true,
            });
            render();
          }
        },
        onError: error => {
          console.warn('coop: offer failed', error);
          if (current()) {
            setStatus(tx('noRtc'), true);
          }
        },
      });
      if (!current()) {
        room.close();
        return;
      }
      Object.assign(state, { room, link: roomLinkFor(room.token), status: tx('waitFriend') });
      render();
    } catch (error) {
      console.warn('coop: room failed', error);
      hub.close();
      if (current()) {
        setStatus(tx('noRtc'), true);
      }
    }
  }

  async function acceptRequest(id) {
    if (!state.room) {
      return;
    }
    Object.assign(state, { requests: [], status: tx('connecting'), error: false });
    render();
    armConnectTimer();
    await state.room.accept(id);
  }

  // Host, by code: the older way, still there when the brokers cannot be reached.
  async function hostCode() {
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
      armConnectTimer(GUEST_WAIT_MS);
    } catch (error) {
      state.error = true;
      state.status = error.message === 'bad code' ? tx('badCode') : tx('noRtc');
      render();
    }
  }

  // Guest, by link: finds the host's room, asks to join with a greeting, waits for the decision.
  async function guestRoom(link) {
    teardown();
    const token = state.token;
    const current = () => token === state.token && state.phase === 'joining';
    Object.assign(state, {
      phase: 'joining', role: 'guest', mode: 'room', stage: 'looking', status: tx('lookingHost'),
    });
    render();
    if (!signalSupported()) {
      setStatus(tx('noCrypto'), true);
      return;
    }
    const hub = createHub({ brokers: SIGNAL_BROKERS });
    state.hub = hub;
    try {
      const room = await joinRoom({
        hub,
        token: link,
        onState: (stage, info) => {
          if (!current()) {
            return;
          }
          const [key, problem] = STAGE_TEXT[stage];
          const missing = info.error === 'greeting';
          Object.assign(state, {
            stage,
            needGreeting: info.needGreeting,
            status: tx(missing ? 'greetNeeded' : key),
            error: missing || problem,
          });
          if (stage === 'connecting') {
            armConnectTimer();
          }
          render();
        },
        onConnection: (connection, secret) => current() && adopt(connection, 'guest', secret),
      });
      if (token !== state.token) {
        room.close();
        return;
      }
      state.room = room;
    } catch (error) {
      hub.close();
      if (token === state.token) {
        setStatus(error.message === 'bad code' ? tx('badCode') : tx('noRtc'), true);
      }
    }
  }

  function askToJoin() {
    const field = el('coopGreeting');
    state.greeting = field ? field.value : state.greeting;
    state.room?.ask(state.greeting);
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
      case 'resume': // the other device is back: the host's clock is the one, the hints add up
        if (state.phase === 'playing') {
          if (state.role === 'guest' && Number.isFinite(event.elapsed)) {
            state.startedAt = performance.now() - event.elapsed * 1000;
          }
          state.hintsUsed = Math.max(state.hintsUsed, event.hints);
          updateHintButton();
          keepSoon();
        }
        break;
      case 'alive': // the channel was only silent: no new one is needed
        closeSignal();
        closeAttempts();
        markPeer(true);
        setMessage('');
        break;
      case 'rejected':
        setMessage(tx('rejected'));
        redrawBoard();
        break;
      case 'hint':
        applyHint(event.hint);
        break;
      case 'stalled': // host: the other device never took the puzzle
        if (state.phase === 'generating' && state.waiting) {
          Object.assign(state, {
            phase: 'lobby', waiting: false, status: tx('noAnswer'), error: true,
          });
          render();
        }
        break;
      default: // left, closed
        state.peerLeft = state.peerLeft || event.type === 'left';
        markPeer(false);
        if (event.type === 'closed' && state.phase === 'playing' && state.secret
          && !state.peerLeft) {
          startResume(); // not said goodbye: a break, which the two can mend
          break;
        }
        setMessage(tx('peerLeft'));
        if (state.phase === 'lobby') {
          setStatus(tx('peerLeft'), true);
        }
        break;
    }
  }

  // ---------- a game that goes on after a break or a reload ----------
  const storage = env.storage ?? null;

  function markPeer(here) {
    state.peerHere = here;
    el('coopPeer')?.classList.toggle('gone', !here);
  }

  // The game as it stands goes into the storage (keep.js), when the connection is one the two
  // devices can mend (they share a secret).
  function keepNow() {
    clearTimeout(state.keepTimer);
    state.keepTimer = null;
    const game = state.session?.current;
    if (!storage || !game || !state.secret || !state.drawing || state.phase !== 'playing') {
      return;
    }
    saveGame(storage, makeRecord({
      role: state.role,
      seed: game.seed,
      text: game.text,
      ops: state.drawing.ops(),
      hints: state.hintsUsed,
      startedWall: state.startedWall,
      secret: state.secret,
    }));
  }

  function keepSoon() {
    if (storage && !state.keepTimer) {
      state.keepTimer = setTimeout(keepNow, KEEP_DELAY_MS);
    }
  }

  function forgetGame() {
    clearTimeout(state.keepTimer);
    state.keepTimer = null;
    state.kept = null;
    if (storage) {
      clearGame(storage);
    }
  }

  function closeAttempts(except = null) {
    state.attempts.forEach(connection => connection !== except && connection.close());
    state.attempts = except ? [except] : [];
  }

  // A new connection (resume.js) takes the place of the broken one when it opens, and not before:
  // the old channel is used until then, in case it was only silent. The two then exchange their
  // lines and the time.
  function reattach(connection) {
    state.attempts.push(connection);
    connection.channel.onopen = () => {
      if (state.phase !== 'playing' || state.connection === connection
        || !state.attempts.includes(connection)) {
        return;
      }
      const old = state.connection;
      state.connection = connection;
      state.session.attach(connection.channel);
      old?.close();
      closeAttempts(connection);
      closeSignal();
      markPeer(true);
      state.session.hello();
      state.session.resume({ elapsed: state.elapsed, hints: state.hintsUsed });
      setMessage(tx('reconnected'));
      readRoute(connection);
    };
  }

  // Looks for the other device where only the two can meet (resume.js), until it is found.
  async function startResume() {
    if (state.hub || !state.secret || !state.session) {
      return;
    }
    const token = state.token;
    const hub = createHub({ brokers: SIGNAL_BROKERS });
    state.hub = hub;
    setMessage(tx('reconnecting'));
    try {
      const room = await resumeRoom({
        hub,
        secret: fromBase64Url(state.secret),
        pid: pid(),
        onConnection: reattach,
        onExpired: () => {
          if (token === state.token) {
            Object.assign(state, { room: null, hub: null });
            closeAttempts();
            setMessage(tx('reconnectFailed'));
          }
        },
        onError: error => console.warn('coop: a reconnection failed', error),
      });
      if (token !== state.token || state.hub !== hub) {
        room.close();
        return;
      }
      state.room = room;
    } catch (error) {
      console.warn('coop: could not look for the other device', error);
      hub.close();
      if (state.hub === hub) {
        state.hub = null;
      }
    }
  }

  // The menu's "Rejoin": the game kept on this device is set up again, and the other device is
  // looked for. Alone it can be played on (the lines are kept), or left with the menu.
  async function rejoinGame() {
    const record = state.kept;
    if (!record || !signalSupported() || !rtcSupported()) {
      return;
    }
    teardown();
    const token = state.token;
    const session = createSession({ role: record.role, onEvent: onSessionEvent, heartbeat: true });
    let drawing = null;
    try {
      drawing = await session.restore(record);
    } catch (error) {
      console.warn('coop: a kept game could not be set up', error);
    }
    if (token !== state.token) {
      return;
    }
    if (!drawing) {
      forgetGame();
      setStatus(tx('noConnection'), true);
      render();
      return;
    }
    Object.assign(state, {
      role: record.role,
      session,
      drawing,
      puzzle: drawing.puzzle,
      seed: record.seed,
      secret: record.secret,
      peerHere: false,
    });
    const elapsed = Math.max(0, (Date.now() - record.startedWall) / 1000);
    beginPlaying({ elapsed, hints: record.hints });
    startResume();
  }

  // ---------- game ----------
  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
  }

  function startTimer(elapsed = 0) {
    stopTimer();
    state.startedAt = performance.now() - elapsed * 1000;
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
    let reason = '';
    try {
      await variantById(state.variant).ready?.();
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
      reason = String(error?.message ?? error);
    }
    if (token !== state.token) {
      return; // the player left meanwhile
    }
    const refused = puzzle ? unsupported(puzzle) : null;
    if (!puzzle || refused) {
      // The reason is shown too: it tells a refused type from a generator that ran out of time.
      state.phase = state.session ? 'lobby' : 'menu';
      state.status = `${tx('failed')} (${refused ?? (reason || 'no puzzle')})`;
      state.error = true;
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

  // A game starts, or (after a reload) goes on: `elapsed` seconds in, `hints` already used.
  function beginPlaying({ elapsed = 0, hints = 0 } = {}) {
    state.grade = gradeOf(state.puzzle);
    Object.assign(state, {
      phase: 'playing', history: [], hint: null, hintsUsed: hints, elapsed, waiting: false,
      jumpFrom: null, startedWall: Date.now() - elapsed * 1000,
    });
    strokes.clear();
    pointers.clear();
    orbiting = null;
    turner.stop();
    state.rotation = solid() ? startRotation(state.puzzle) : null;
    renderGame();
    if (solid()) {
      setMessage(solidNote());
    }
    startTimer(elapsed);
    keepNow();
  }

  function finish() {
    stopTimer();
    if (state.session) {
      forgetGame();
      closeSignal();
      closeAttempts();
    }
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
    } else {
      keepSoon();
    }
  }

  // ---------- pointer input ----------
  const drawingRect = board => board.firstElementChild.getBoundingClientRect();

  // A Wrap-around board has a margin: a drag that leaves the board comes in on the other side.
  const cellAt = (board, event) => (solid()
    ? cellUnder(board, event.clientX, event.clientY)
    : cellAtClient(state.puzzle, drawingRect(board), event.clientX, event.clientY));

  // Cuts the line under the point (client coordinates), if there is one: true when it did.
  function cutAt(clientX, clientY, player) {
    const board = el('coopBoard');
    let edge;
    if (solid()) {
      edge = edgeNear(
        board, state.drawing, state.solidLayouts, state.solidFrames, clientX, clientY,
      );
    } else {
      const [x, y, unit] = pressPoint(state.puzzle, drawingRect(board), clientX, clientY);
      edge = edgeAt(state.drawing, x, y, 0.3 * unit, unit);
    }
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
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    const turns = solid() && turnable(state.puzzle, state.view);
    if (turns && pointers.size >= 2) {
      // two fingers turn the solid at once, and a line that was begun is let go
      strokes.forEach(endHold);
      strokes.clear();
      capture(board, event);
      orbiting = { start: pointerCentre(), last: pointerCentre(), active: true };
      return;
    }
    const cell = cellAt(board, event);
    if (cell < 0) {
      if (turns) {
        // anything but a cell turns the solid, once the pointer has moved a little
        orbiting = { start: pointerCentre(), last: pointerCentre(), active: false };
      }
      return;
    }
    event.preventDefault();
    capture(board, event);
    // Teleport: a press on the ringed partner of the portal the last stroke ended on links the two,
    // and the stroke goes on from there.
    const jump = cell === ringCell();
    const entry = {
      stroke: startStroke(jump ? state.jumpFrom : cell, pid()),
      refused: null,
      cut: false,
      hold: null,
      x: event.clientX,
      y: event.clientY,
      x0: event.clientX,
      y0: event.clientY,
      lastPoint: crossing()
        ? netPoint(board, state.solidFrames, event.clientX, event.clientY) : null,
    };
    entry.hold = setTimeout(() => onHoldElapsed(entry), HOLD_MS);
    strokes.set(event.pointerId, entry);
    setMessage('');
    state.jumpFrom = null;
    if (jump) {
      applyStep(entry, cell);
    } else {
      redrawBoard();
    }
  }

  function capture(board, event) {
    try {
      board.setPointerCapture(event.pointerId);
    } catch {
      // no capture (not supported here): the drag still works while the pointer stays on the board
    }
  }

  const pointerCentre = () => {
    const all = [...pointers.values()];
    return [0, 1].map(axis => all.reduce((sum, point) => sum + point[axis], 0) / all.length);
  };

  // A drag that began off the cells, or two fingers, turns the solid (the play app's rule).
  function turnSolid(event) {
    const [x, y] = pointerCentre();
    if (!orbiting.active) {
      if (Math.hypot(x - orbiting.start[0], y - orbiting.start[1]) < ORBIT_SLOP) {
        return;
      }
      orbiting.active = true;
      turner.stop();
      capture(el('coopBoard'), event);
    }
    state.rotation = turnBy(state.rotation, x - orbiting.last[0], y - orbiting.last[1]);
    orbiting.last = [x, y];
    redrawBoard();
  }

  // About one cell of a solid, in pixels: the size of a step of a fast drag.
  const solidCellPx = board => (
    board.querySelector('svg').getBoundingClientRect().width / Math.sqrt(topologyOf(state.puzzle).T)
  );

  // Whether the board is a net with cuts: leaving the head over a cut is a step.
  const crossing = () => solid() && state.view === 'net'
    && (state.solidLayouts[0]?.cuts?.length ?? 0) > 0;

  // The pointer left the head of the stroke over a cut of the net: the line goes on where the cut
  // leads.
  function crossCut(entry, board, probe) {
    const at = netPoint(board, state.solidFrames, probe.clientX, probe.clientY);
    if (at && entry.lastPoint) {
      const target = crossedCut(
        topologyOf(state.puzzle), state.solidLayouts[0], entry.stroke.head, entry.lastPoint, at,
      );
      if (target >= 0) {
        applyStep(entry, target);
      }
    }
    entry.lastPoint = at;
  }

  // Pointer moves can skip cells: walk from the last point to the new one in small steps.
  function onPointerMove(event) {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
    }
    if (orbiting) {
      turnSolid(event);
      return;
    }
    const entry = strokes.get(event.pointerId);
    if (!entry || entry.cut || state.phase !== 'playing') {
      return;
    }
    const moved = Math.hypot(event.clientX - entry.x0, event.clientY - entry.y0);
    if (entry.hold && moved > HOLD_SLOP_PX) {
      endHold(entry);
    }
    const board = el('coopBoard');
    const cellPx = solid() ? solidCellPx(board) : cellPxOf(state.puzzle, drawingRect(board));
    const dx = event.clientX - entry.x;
    const dy = event.clientY - entry.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cellPx / 3)));
    for (let i = 1; i <= steps && state.phase === 'playing'; i++) {
      const probe = { clientX: entry.x + (dx * i) / steps, clientY: entry.y + (dy * i) / steps };
      applyStep(entry, cellAt(board, probe));
      if (crossing()) {
        crossCut(entry, board, probe);
      }
    }
    entry.x = event.clientX;
    entry.y = event.clientY;
  }

  function onPointerEnd(event) {
    pointers.delete(event.pointerId);
    orbiting = null;
    const entry = strokes.get(event.pointerId);
    if (!entry) {
      return;
    }
    endHold(entry);
    strokes.delete(event.pointerId);
    if (changed(entry.stroke) && state.phase === 'playing') {
      state.history.push(entry.stroke);
    }
    if (state.phase === 'playing' && state.puzzle.portals) {
      state.jumpFrom = entry.cut ? null : entry.stroke.head;
      redrawBoard();
      if (ringCell() >= 0) {
        setMessage(tx('jump'));
      }
    }
  }

  // ---------- buttons ----------
  function applyHint(hint) {
    if (!hint || !Array.isArray(hint.edge) || state.phase !== 'playing') {
      return;
    }
    state.hint = { kind: hint.kind === 'wrong' ? 'wrong' : 'next', edge: hint.edge };
    state.hintsUsed = Math.max(state.hintsUsed, Number(hint.used) || 0);
    keepSoon();
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
    turnToHint(hint.edge);
  }

  // A solid: the hint is on the side that is turned away, so the solid turns to face it.
  function turnToHint(edge) {
    const net = state.solidLayouts[0];
    if (!solid() || state.view !== '3d' || !net) {
      return;
    }
    const ball = state.puzzle.kind === 'ball';
    const away = cell => (ball ? net.depth[cell] < FOLLOW_EDGE : net.hidden[cell]);
    if (edge.every(away)) {
      turner.toward(topologyOf(state.puzzle), edge[0]);
    }
  }

  // The button of a solid game: what the view would change to (the play app's labels).
  function viewLabel() {
    const net = state.view === 'net';
    if (state.puzzle.kind === 'ball') {
      return t(net ? 'solid.ball' : 'solid.map');
    }
    return t(net ? 'solid.solid' : 'solid.net');
  }

  // The line under the board of a solid game: how to turn it, or how to read the net.
  function solidNote() {
    if (state.view === '3d') {
      return tx('solidTurn');
    }
    return tx(state.puzzle.kind === 'ball' ? 'solidMap' : 'solidNet');
  }

  function toggleView() {
    if (!solid()) {
      return;
    }
    turner.stop();
    state.view = state.view === '3d' ? 'net' : '3d';
    el('coopView').textContent = viewLabel();
    redrawBoard();
    setMessage(solidNote());
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
    root.insertAdjacentHTML('beforeend', exportDialog(serializePuzzle(state.puzzle)));
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
    if (state.session && state.phase === 'playing') {
      forgetGame();
    }
    teardown();
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('pagehide', keepNow);
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
      manual: hostCode,
      accept: () => acceptRequest(button.dataset.id),
      decline: () => state.room?.decline(button.dataset.id),
      'need-greeting': () => {
        state.needGreeting = el('coopNeedGreeting')?.checked === true;
        state.room?.setNeedGreeting(state.needGreeting);
      },
      join: askToJoin,
      rejoin: rejoinGame,
      discard: () => {
        forgetGame();
        render();
      },
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
      view: toggleView,
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
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '');
    if (ARROW_TURN[event.key] && !typing && solid() && turnable(state.puzzle, state.view)
      && (state.phase === 'playing' || state.phase === 'solved')) {
      event.preventDefault();
      turner.stop();
      state.rotation = turnByKey(state.rotation, event.key);
      redrawBoard();
      return;
    }
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
  // A page that was asleep (a phone while the invite was sent in another app) or offline: the
  // brokers are asked again at once.
  function wake() {
    if (document.hidden) {
      keepNow(); // may be the last chance: the page can be dropped from memory in the background
    } else {
      state.hub?.wake();
    }
  }
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('pagehide', keepNow);
  render();
  if (storage) {
    loadGame(storage).then(record => {
      state.kept = record;
      if (record && state.phase === 'menu') {
        render();
      }
    });
  }
  const joinFrom = (code, room) => (room ? guestRoom(code) : guestJoin(code));
  return { close, setRevealed, joinFrom };
}
