// Who gets the fingers on a board that can be zoomed: the drawing pointer, a pinch, a pan.
// No DOM, no timers: the page feeds it the pointer events and does what the actions say.
//
//   mouse / pen, left button   draws at once
//   mouse / pen, other button  pans
//   touch                      a press does not draw yet: it waits until the finger has moved
//                              COMMIT_SLOP pixels, or has been down COMMIT_MS, or is lifted (a
//                              tap). A second finger that lands in that time makes a pinch (zoom
//                              and pan) and nothing was drawn, so there is nothing to undo.
//                              A second finger that lands while the first draws is ignored.
//
// An event is { id, type, button, x, y, cancel }. The methods return a list of actions:
//   { do: 'timer', ms } | { do: 'timer-clear' }   (the page calls timeout() when it runs out)
//   { do: 'draw-start', x, y } | { do: 'draw-move', x, y } | { do: 'draw-end' }
//   { do: 'gesture-start', a, b } | { do: 'gesture-move', a, b } | { do: 'gesture-end' }
//   { do: 'pan-start' } | { do: 'pan-move', dx, dy } | { do: 'pan-end' }

export const COMMIT_MS = 70;
export const COMMIT_SLOP = 4;

export function createRouter({ delay = COMMIT_MS, slop = COMMIT_SLOP } = {}) {
  const fingers = new Map(); // id -> [x, y], every pointer that is down
  let mode = 'idle'; // idle | pending | draw | pan | gesture | spent
  let owner = null; // the pointer that draws or pans, or may (pending)
  let pair = []; // the two pointers of a pinch
  let origin = [0, 0]; // where the owner went down (pending)
  let last = [0, 0]; // the last position of a pan

  const settle = () => {
    mode = fingers.size ? 'spent' : 'idle';
    owner = null;
    pair = [];
  };

  const commit = () => {
    mode = 'draw';
    return [{ do: 'timer-clear' }, { do: 'draw-start', x: origin[0], y: origin[1] }];
  };

  function down(e) {
    if (fingers.has(e.id)) {
      return [];
    }
    fingers.set(e.id, [e.x, e.y]);
    if (mode === 'idle') {
      owner = e.id;
      origin = [e.x, e.y];
      if (e.type === 'touch') {
        mode = 'pending';
        return [{ do: 'timer', ms: delay }];
      }
      if (e.button === 0 || e.button === undefined) {
        mode = 'draw';
        return [{ do: 'draw-start', x: e.x, y: e.y }];
      }
      mode = 'pan';
      last = [e.x, e.y];
      return [{ do: 'pan-start' }];
    }
    if (mode === 'pending' && e.type === 'touch') {
      mode = 'gesture';
      pair = [owner, e.id];
      return [
        { do: 'timer-clear' },
        { do: 'gesture-start', a: fingers.get(owner), b: fingers.get(e.id) },
      ];
    }
    return [];
  }

  function move(e) {
    if (!fingers.has(e.id)) {
      return [];
    }
    fingers.set(e.id, [e.x, e.y]);
    if (mode === 'pending' && e.id === owner) {
      if (Math.hypot(e.x - origin[0], e.y - origin[1]) <= slop) {
        return [];
      }
      return [...commit(), { do: 'draw-move', x: e.x, y: e.y }];
    }
    if (mode === 'draw' && e.id === owner) {
      return [{ do: 'draw-move', x: e.x, y: e.y }];
    }
    if (mode === 'pan' && e.id === owner) {
      const action = { do: 'pan-move', dx: e.x - last[0], dy: e.y - last[1] };
      last = [e.x, e.y];
      return [action];
    }
    if (mode === 'gesture' && pair.includes(e.id)) {
      return [{ do: 'gesture-move', a: fingers.get(pair[0]), b: fingers.get(pair[1]) }];
    }
    return [];
  }

  function up(e) {
    if (!fingers.has(e.id)) {
      return [];
    }
    fingers.delete(e.id);
    if (mode === 'pending' && e.id === owner) {
      // a tap draws its step when the finger is lifted; a cancelled touch draws nothing
      const actions = e.cancel ? [{ do: 'timer-clear' }] : [...commit(), { do: 'draw-end' }];
      settle();
      return actions;
    }
    if (mode === 'draw' && e.id === owner) {
      settle();
      return [{ do: 'draw-end' }];
    }
    if (mode === 'pan' && e.id === owner) {
      settle();
      return [{ do: 'pan-end' }];
    }
    if (mode === 'gesture' && pair.includes(e.id)) {
      settle();
      return [{ do: 'gesture-end' }];
    }
    if (!fingers.size) {
      mode = 'idle';
      owner = null;
    }
    return [];
  }

  // The commit timer ran out: a finger that has stayed put now draws.
  function timeout() {
    if (mode !== 'pending') {
      return [];
    }
    return commit();
  }

  return { down, move, up, timeout, mode: () => mode };
}
