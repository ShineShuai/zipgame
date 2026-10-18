// What the Checkpoints field of the surface types shows after the board changes (a Generate, a
// Reset, another size). A number the player typed stays, cut to the cells of the board; with
// nothing typed, or an empty or wrong field, the field shows the default of the size.
export function keptK({ typed, value, cells, fallback }) {
  const number = Number.parseInt(value, 10);
  if (!typed || !Number.isFinite(number)) {
    return String(fallback);
  }
  return String(Math.min(number, cells));
}
