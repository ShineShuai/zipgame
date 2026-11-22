// Unit tests of small UI pieces: hold reveal, hint popover, texts, icons.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { HINT_PENALTY_S, penalizedTime } from '../../src/features/hints.js';
import { createHoldReveal } from '../../src/ui/hold-reveal.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { variantIcon, cardIcon } from '../../src/apps/play/icons.js';
import { PLAY_VARIANTS } from '../../src/apps/play/variants.js';

test('hold-reveal: shows while "v" is held; ignores key repeat, modifiers and text fields; hides on cancel', () => {
  const seen = [];
  const reveal = createHoldReveal(visible => seen.push(visible));
  const press = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });

  reveal.keydown(press('v'));
  reveal.keydown(press('v')); // key repeat reports once
  reveal.keyup(press('v'));
  reveal.keydown(press('V'));
  reveal.cancel(); // window blur / tab hidden while held
  reveal.cancel(); // repeated cancel reports once
  reveal.keydown(press('v', { ctrlKey: true })); // paste shortcut is not a reveal
  reveal.keydown(press('v', { target: { tagName: 'INPUT' } }));
  reveal.keydown(press('v', { target: { tagName: 'DIV', isContentEditable: true } }));
  reveal.keydown(press('x'));
  assert.deepStrictEqual(seen, [true, false, true, false]);
});

test('hint-popover: attaches plain-text hints, preserves markup children, and setHintText updates in place without duplicating', async () => {
  class FakeClassList {
    constructor() {
      this.set = new Set();
    }
    add(c) {
      this.set.add(c);
    }
    contains(c) {
      return this.set.has(c);
    }
    toggle(c, v) {
      if (v) this.set.add(c);
      else this.set.delete(c);
    }
  }
  class FakeEl {
    constructor() {
      this.dataset = {};
      this._html = '';
      this._children = [];
      this.classList = new FakeClassList();
      this._attrs = {};
      this._listeners = {};
    }
    get children() {
      return this._children;
    }
    get textContent() {
      return this._html.replace(/<[^>]+>/g, '');
    }
    set textContent(v) {
      this._html = v;
      this._children = [];
    }
    get innerHTML() {
      return this._html;
    }
    set innerHTML(v) {
      this._html = v;
      this._children = v ? [{ className: 'hint-popover' }] : [];
    }
    appendChild(child) {
      this._children.push(child);
      if (child.className === 'hint-popover') this._pop = child;
    }
    setAttribute(k, v) {
      this._attrs[k] = v;
    }
    addEventListener() {
      /* not exercised by these assertions */
    }
    getBoundingClientRect() {
      return { bottom: 0 };
    }
    querySelector(sel) {
      return sel.includes('hint-popover') ? this._pop || null : null;
    }
  }
  const prevDoc = globalThis.document,
    prevWin = globalThis.window;
  globalThis.document = { createElement: () => new FakeEl() };
  globalThis.window = { innerHeight: 800 };
  try {
    const { attachHint, setHintText } = await import('../../src/ui/hint-popover.js');

    const plain = new FakeEl();
    plain.textContent = 'Click the gaps between cells to add or remove blocking walls.';
    attachHint(plain);
    assert.deepStrictEqual(
      plain.dataset.hint,
      'Click the gaps between cells to add or remove blocking walls.',
    );
    assert.deepStrictEqual(plain.dataset.hintAttached, '1');

    const withCode = new FakeEl();
    withCode.innerHTML =
      'generate() has no flags of its own... <code id="x">ab12</code> more text';
    attachHint(withCode);
    assert.ok(withCode._pop, 'markup-bearing hint should still get a popover');
    assert.deepStrictEqual(
      withCode._children.length > 0,
      true,
      'the <code> child must survive attachment, not be flattened away',
    );

    const before = JSON.stringify(plain.dataset);
    attachHint(plain);
    assert.deepStrictEqual(
      JSON.stringify(plain.dataset),
      before,
      'attaching an already-attached hint is a no-op (idempotent)',
    );

    const dyn = new FakeEl();
    setHintText(dyn, 'Drag from checkpoint 1...');
    assert.deepStrictEqual(
      dyn.dataset.hintAttached,
      '1',
      'setHintText on a never-attached element attaches it',
    );
    assert.deepStrictEqual(dyn._pop.textContent, 'Drag from checkpoint 1...');

    setHintText(dyn, 'Click a cell then type a number...');
    assert.deepStrictEqual(
      dyn._pop.textContent,
      'Click a cell then type a number...',
      'setHintText on an attached element updates the existing popover',
    );
    assert.deepStrictEqual(
      dyn._children.filter(c => c.className === 'hint-popover').length,
      1,
      'updating text must not create a second popover node',
    );
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});

test('hints: every hint adds HINT_PENALTY_S to the time, no hint adds nothing', () => {
  assert.deepStrictEqual(penalizedTime(42.5, 0), 42.5);
  for (const hints of [1, 2, 3]) {
    assert.deepStrictEqual(
      penalizedTime(42.5, hints),
      42.5 + hints * HINT_PENALTY_S,
      `${hints} hint(s)`,
    );
  }
});

test('i18n: EN and ZH have the same keys and the same {n} placeholders', () => {
  assert.deepStrictEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  const ph = v => (typeof v === 'string' ? (v.match(/\{\d+\}/g) || []).sort() : 'fn');
  for (const k of Object.keys(EN)) assert.deepStrictEqual(ph(ZH[k]), ph(EN[k]), k);
  for (const k of ['replay.locked', 'replay.progress'])
    assert.deepStrictEqual([typeof EN[k], typeof ZH[k]], ['function', 'function']);
});

test('play icons: standard shows all 16 tiles, cutout a ring of 12; both variants differ; card icons are svg', () => {
  const standard = variantIcon('standard');
  const cutout = variantIcon('cutout');
  const tiles = svg => (svg.match(/rx="1\.6"/g) || []).length;
  assert.deepStrictEqual([tiles(standard), tiles(cutout)], [16, 12]);
  assert.ok(standard.includes('vi-standard') && cutout.includes('vi-cutout'));
  assert.ok(standard !== cutout);
  // the app keeps S.variant = null for a standard puzzle
  assert.deepStrictEqual(variantIcon(null), standard);
  assert.deepStrictEqual(variantIcon(undefined), standard);
  for (const svg of [standard, cutout, cardIcon('gotd'), cardIcon('free')]) {
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), svg.slice(0, 40));
    assert.ok(svg.includes('aria-hidden="true"'));
  }
  assert.deepStrictEqual(
    variantIcon('lucky').includes('vi-lucky'),
    true,
    'the mystery icon of the lucky game',
  );
  assert.ok(variantIcon('lucky') !== standard && variantIcon('lucky').endsWith('</svg>'));
});

test('play menu i18n: every variant has a name and a tagline, the Game-of-Day card has its texts, in both languages', () => {
  for (const dict of [EN, ZH]) {
    for (const mode of ['standard', ...PLAY_VARIANTS.map(v => v.id)]) {
      assert.ok(dict['mode.' + mode], 'mode.' + mode);
      assert.ok(dict['mode.' + mode + 'Tag'], 'mode.' + mode + 'Tag');
      assert.ok(dict['mode.' + mode + 'Rules'], 'mode.' + mode + 'Rules');
    }
    for (const key of ['menu.mode', 'menu.sub', 'gotd.play', 'gotd.blurb'])
      assert.ok(dict[key], key);
  }
  for (const v of PLAY_VARIANTS) assert.deepStrictEqual(v.keys.rules, 'mode.' + v.id + 'Rules');
});

test('play texts: nothing a player can read mentions the hidden hold-V reveal', () => {
  for (const [lang, dict] of [
    ['en', EN],
    ['zh', ZH],
  ]) {
    for (const [key, value] of Object.entries(dict)) {
      const text = typeof value === 'function' ? [value(1), value(2)].join(' ') : value;
      assert.ok(
        !/\bhold\b.*\bv\b|\bv\b key|按住|长按|developer|开发/i.test(text),
        lang + ' ' + key + ': ' + text,
      );
    }
  }
});
