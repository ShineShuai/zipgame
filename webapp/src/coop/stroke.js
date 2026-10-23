// One pointer's drag across the board, as rules (no DOM). The head moves from cell to cell like
// the pen of the single-player game, and drawing and erasing are the same gesture: going forward
// draws, going back erases.

const sameEdge = ([a, b], x, y) => (a === x && b === y) || (a === y && b === x);

// `player`: who is drawing (0 or 1); it colours the lines of the stroke. `removed` holds
// [a, b, owner] of every line the stroke erased, so that Undo gives each back to its owner.
export const startStroke = (cell, player = 0) => ({ head: cell, added: [], removed: [], player });

// Moves the head of `stroke` onto `cell`. Returns { kind, reason? }:
//   none     nothing happened (same cell, or not a neighbour, a seam or portal partner: a fast
//            drag skipped a cell)
//   add      a line was drawn
//   pop      the last line of this stroke was taken back (the head went back over it)
//   retract  the head stood on the end of a piece and moved along its only line: the line was
//            erased (backtracking, as in the single-player game)
//   slide    the head moved along any other existing line; nothing changes
//   blocked  the rules refused the line; reason is one of REASONS (drawing.js). The head stays.
export function strokeStep(drawing, stroke, cell) {
  const from = stroke.head;
  if (cell < 0 || !drawing.linked(from, cell)) {
    return { kind: 'none' };
  }
  const last = stroke.added[stroke.added.length - 1];
  if (last && sameEdge(last, from, cell)) {
    drawing.remove(from, cell);
    stroke.added.pop();
    stroke.head = cell;
    return { kind: 'pop' };
  }
  if (drawing.has(from, cell)) {
    stroke.head = cell;
    if (drawing.degree(from) > 1) {
      return { kind: 'slide' };
    }
    stroke.removed.push([from, cell, drawing.ownerOf(from, cell)]);
    drawing.remove(from, cell);
    return { kind: 'retract' };
  }
  const reason = drawing.add(from, cell, stroke.player);
  if (reason) {
    return { kind: 'blocked', reason };
  }
  stroke.added.push([from, cell]);
  stroke.head = cell;
  return { kind: 'add' };
}

export const changed = stroke => stroke.added.length > 0 || stroke.removed.length > 0;

// Takes a whole stroke back: its lines go, what it erased returns (when the rules still allow it).
export function undoStroke(drawing, stroke) {
  for (let i = stroke.added.length - 1; i >= 0; i--) {
    drawing.remove(...stroke.added[i]);
  }
  for (let i = stroke.removed.length - 1; i >= 0; i--) {
    drawing.add(...stroke.removed[i]);
  }
}
