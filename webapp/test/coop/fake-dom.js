// Just enough of a page for src/coop/screen.js to run in Node: one root element that keeps the
// markup the screen writes, lookups by id into that markup, and clicks sent to the screen's own
// click handler. What the player "types" is set with dom.typed.set(id, value).
const unescape = text => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

export function installFakeDom() {
  const typed = new Map();
  const handlers = new Map();
  let markup = '';
  let live = {}; // the status note as changed without a redraw (setStatus)
  const root = {
    get innerHTML() {
      return markup;
    },
    set innerHTML(value) {
      markup = value;
      live = {};
    },
    insertAdjacentHTML(_where, html) {
      markup += html; // always 'beforeend' here
    },
    scrollTop: 0,
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener: (type, handler) => handlers.set(type, handler),
    contains: () => true,
    querySelectorAll: () => [],
    querySelector: () => null,
    remove() {},
  };
  const find = id => {
    if (!root.innerHTML.includes(`id="${id}"`)) {
      return null;
    }
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(root.innerHTML)[0];
    const fromMarkup = /value="([^"]*)"/.exec(tag)?.[1];
    return {
      get value() {
        return typed.has(id) ? typed.get(id) : unescape(fromMarkup ?? '');
      },
      get checked() {
        return typed.has(id) ? typed.get(id) : /\schecked/.test(tag);
      },
      set textContent(text) {
        live[id] = text;
      },
      style: {},
      focus() {},
      remove() {},
      classList: {
        toggle(name, on) {
          if (name === 'error') {
            live.error = Boolean(on);
          }
        },
        add() {},
        remove() {},
      },
    };
  };
  globalThis.document = {
    hidden: false,
    body: { append() {} },
    createElement: () => root,
    getElementById: find,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {},
  };
  if (typeof globalThis.navigator === 'undefined') {
    // Node 20 has none (it came with Node 21); the screen asks it whether the page can share
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  }
  globalThis.location = { href: 'https://x.test/zip/index.html?x=1#old', hash: '' };
  return {
    typed,
    html: () => root.innerHTML,
    // the text of the status note
    status: () => live.coopStatus
      ?? unescape(/id="coopStatus"[^>]*>([^<]*)</.exec(markup)?.[1] ?? ''),
    // the text of the message line under the board
    message: () => live.coopMsg ?? '',
    failed: () => live.error ?? /class="note error" id="coopStatus"/.test(markup),
    click(act, dataset = {}) {
      const button = { dataset: { act, ...dataset } };
      handlers.get('click')({ target: { closest: () => button } });
    },
  };
}
