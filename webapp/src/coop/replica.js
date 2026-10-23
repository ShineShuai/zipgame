import { createDrawing } from './drawing.js';

// A drawing shared by two (or more) players, kept equal on every device without a server.
//
// Every change is an operation { kind: 'add' | 'remove', a, b, owner, clock, pid, seq }. Each
// device keeps the list of all operations it knows, sorted by (clock, pid, seq) (a Lamport clock,
// the player as tie-break), and the drawing is what you get by applying that list from an empty
// board, in that order. An operation the rules refuse at its turn (say, a third line into a cell
// that a line of the other player had just filled) is dropped, on every device alike. So the
// drawing is a function of the set of operations: any delivery order, and duplicates, give the
// same drawing. An operation that arrives with an older stamp than the newest one known makes
// the device apply the list again from the start; the list is short (hundreds), so that is cheap.
//
// The returned object has the interface of createDrawing() (strokes and hints use it as is);
// add() and remove() also send the operation to the other devices.
export function createReplica(puzzle, { pid = 0, send = () => {}, onRejected = () => {} } = {}) {
  const log = [];
  const known = new Set();
  let drawing = createDrawing(puzzle);
  let rejected = new Set();
  let clock = 0;
  let seq = 0;

  const idOf = op => `${op.pid}.${op.seq}`;
  const compare = (x, y) => x.clock - y.clock || x.pid - y.pid || x.seq - y.seq;

  // Applies one operation to `board`; true when the rules refused it.
  function apply(board, op) {
    if (op.kind === 'add') {
      return board.add(op.a, op.b, op.owner) !== null;
    }
    board.remove(op.a, op.b);
    return false;
  }

  function refold() {
    const fresh = createDrawing(puzzle);
    const refused = new Set();
    for (const op of log) {
      if (apply(fresh, op)) {
        refused.add(idOf(op));
      }
    }
    for (const op of log) {
      if (op.pid === pid && refused.has(idOf(op)) && !rejected.has(idOf(op))) {
        onRejected(op);
      }
    }
    drawing = fresh;
    rejected = refused;
  }

  // Adds `op` to the list: applied at once when it is the newest, else the list is applied again.
  function record(op) {
    known.add(idOf(op));
    clock = Math.max(clock, op.clock);
    const newest = log.length === 0 || compare(log[log.length - 1], op) < 0;
    log.push(op);
    if (newest) {
      if (apply(drawing, op)) {
        rejected.add(idOf(op));
      }
      return;
    }
    log.sort(compare);
    refold();
  }

  function mine(kind, a, b, owner) {
    const op = { kind, a, b, owner, clock: clock + 1, pid, seq: seq++ };
    record(op);
    send(op);
  }

  // Draws the edge a-b for `owner` (default: this player): null, or the reason it was refused.
  function add(a, b, owner = pid) {
    const reason = drawing.check(a, b);
    if (reason) {
      return reason;
    }
    mine('add', a, b, owner);
    return null;
  }

  function remove(a, b) {
    if (!drawing.has(a, b)) {
      return false;
    }
    mine('remove', a, b, 0);
    return true;
  }

  // An operation of another device. Anything that is not a well-formed operation is ignored.
  function receive(op) {
    const cells = puzzle.n * puzzle.n;
    const cell = value => Number.isInteger(value) && value >= 0 && value < cells;
    const count = value => Number.isInteger(value) && value >= 0 && value < 1e9;
    const sound = op && (op.kind === 'add' || op.kind === 'remove') && cell(op.a) && cell(op.b)
      && count(op.clock) && count(op.seq) && Number.isInteger(op.pid) && op.pid >= 0 && op.pid < 8
      && (op.owner === undefined || (Number.isInteger(op.owner) && op.owner >= 0 && op.owner < 8));
    if (!sound || known.has(idOf(op)) || op.pid === pid) {
      return false;
    }
    const { kind, a, b, clock: stamp, pid: from, seq: number } = op;
    record({ kind, a, b, owner: op.owner ?? 0, clock: stamp, pid: from, seq: number });
    return true;
  }

  // Erases every line this player drew (with one player: the whole drawing).
  function clearMine() {
    for (const [a, b] of drawing.edges()) {
      if (drawing.ownerOf(a, b) === pid) {
        remove(a, b);
      }
    }
  }

  return {
    puzzle,
    pid,
    receive,
    add,
    remove,
    clear: clearMine,
    key: (a, b) => drawing.key(a, b),
    has: (a, b) => drawing.has(a, b),
    linked: (a, b) => drawing.linked(a, b),
    check: (a, b) => drawing.check(a, b),
    edges: () => drawing.edges(),
    ownerOf: (a, b) => drawing.ownerOf(a, b),
    degree: cell => drawing.degree(cell),
    count: () => drawing.count(),
    fragmentOf: cell => drawing.fragmentOf(cell),
    path: () => drawing.path(),
    solved: () => drawing.solved(),
    // For the developer line: how many operations are known, and how many were refused.
    info: () => ({ ops: log.length, refused: rejected.size }),
  };
}
