// Switches of the hidden "Free draw" trial (everything in src/coop). The trial is revealed like
// the other hidden things of the play app: hold V, five taps on the bare app bar, or a pinned
// dev link.
// ENABLED = false: boot.js registers nothing and nothing else of src/coop is loaded.
export const ENABLED = true;

// The board size that is preselected (the setup screen offers every size of the play app). This
// file is loaded at page start by boot.js, so it imports nothing.
export const DEFAULT_SIZE = 7;
