// Unit tests of small UI pieces: hold reveal, hint popover, texts, icons.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { createHoldReveal } from '../../src/ui/hold-reveal.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { variantIcon, cardIcon } from '../../src/apps/play/icons.js';
import { PLAY_VARIANTS } from '../../src/apps/play/variants.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';

t('hold-reveal: shows while "v" is held; ignores key repeat, modifiers and text fields; hides on cancel', () => {
  const seen = [];
  const reveal = createHoldReveal(visible => seen.push(visible));
  const press = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });

  reveal.keydown(press('v'));
  reveal.keydown(press('v'));                               // key repeat reports once
  reveal.keyup(press('v'));
  reveal.keydown(press('V'));
  reveal.cancel();                                          // window blur / tab hidden while held
  reveal.cancel();                                          // repeated cancel reports once
  reveal.keydown(press('v', { ctrlKey: true }));            // paste shortcut is not a reveal
  reveal.keydown(press('v', { target: { tagName: 'INPUT' } }));
  reveal.keydown(press('v', { target: { tagName: 'DIV', isContentEditable: true } }));
  reveal.keydown(press('x'));
  eq(seen, [true, false, true, false]);
});

ta('hint-popover: attaches plain-text hints, preserves markup children, and setHintText updates in place without duplicating', async () => {
  class FakeClassList { constructor() { this.set = new Set(); } add(c) { this.set.add(c); } contains(c) { return this.set.has(c); } toggle(c, v) { if (v) this.set.add(c); else this.set.delete(c); } }
  class FakeEl {
    constructor() { this.dataset = {}; this._html = ''; this._children = []; this.classList = new FakeClassList(); this._attrs = {}; this._listeners = {}; }
    get children() { return this._children; }
    get textContent() { return this._html.replace(/<[^>]+>/g, ''); }
    set textContent(v) { this._html = v; this._children = []; }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = v; this._children = v ? [{ className: 'hint-popover' }] : []; }
    appendChild(child) { this._children.push(child); if (child.className === 'hint-popover') this._pop = child; }
    setAttribute(k, v) { this._attrs[k] = v; }
    addEventListener() { /* not exercised by these assertions */ }
    getBoundingClientRect() { return { bottom: 0 }; }
    querySelector(sel) { return sel.includes('hint-popover') ? (this._pop || null) : null; }
  }
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  globalThis.document = { createElement: () => new FakeEl() };
  globalThis.window = { innerHeight: 800 };
  try {
    const { attachHint, setHintText } = await import('../../src/ui/hint-popover.js');

    const plain = new FakeEl(); plain.textContent = 'Click the gaps between cells to add or remove blocking walls.';
    attachHint(plain);
    eq(plain.dataset.hint, 'Click the gaps between cells to add or remove blocking walls.');
    eq(plain.dataset.hintAttached, '1');

    const withCode = new FakeEl();
    withCode.innerHTML = 'generate() has no flags of its own... <code id="x">ab12</code> more text';
    attachHint(withCode);
    ok(withCode._pop, 'markup-bearing hint should still get a popover');
    eq(withCode._children.length > 0, true, 'the <code> child must survive attachment, not be flattened away');

    const before = JSON.stringify(plain.dataset);
    attachHint(plain);
    eq(JSON.stringify(plain.dataset), before, 'attaching an already-attached hint is a no-op (idempotent)');

    const dyn = new FakeEl();
    setHintText(dyn, 'Drag from checkpoint 1...');
    eq(dyn.dataset.hintAttached, '1', 'setHintText on a never-attached element attaches it');
    eq(dyn._pop.textContent, 'Drag from checkpoint 1...');

    setHintText(dyn, 'Click a cell then type a number...');
    eq(dyn._pop.textContent, 'Click a cell then type a number...', 'setHintText on an attached element updates the existing popover');
    eq(dyn._children.filter(c => c.className === 'hint-popover').length, 1, 'updating text must not create a second popover node');
  } finally {
    globalThis.document = prevDoc; globalThis.window = prevWin;
  }
});

t('i18n: EN and ZH have the same keys and the same {n} placeholders', () => {
  eq(Object.keys(EN).sort(), Object.keys(ZH).sort());
  const ph = v => typeof v === 'string' ? (v.match(/\{\d+\}/g) || []).sort() : 'fn';
  for (const k of Object.keys(EN)) eq(ph(ZH[k]), ph(EN[k]), k);
  for (const k of ['replay.locked', 'replay.progress']) eq([typeof EN[k], typeof ZH[k]], ['function', 'function']);
});

t('play icons: standard shows all 16 tiles, cutout a ring of 12; both variants differ; card icons are svg', () => {
  const standard = variantIcon('standard');
  const cutout = variantIcon('cutout');
  const tiles = svg => (svg.match(/rx="1\.6"/g) || []).length;
  eq([tiles(standard), tiles(cutout)], [16, 12]);
  ok(standard.includes('vi-standard') && cutout.includes('vi-cutout'));
  ok(standard !== cutout);
  eq(variantIcon(null), standard); // the app keeps S.variant = null for a standard puzzle
  eq(variantIcon(undefined), standard);
  for (const svg of [standard, cutout, cardIcon('gotd'), cardIcon('free')]) {
    ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), svg.slice(0, 40));
    ok(svg.includes('aria-hidden="true"'));
  }
  eq(variantIcon('lucky').includes('vi-lucky'), true, 'the mystery icon of the lucky game');
  ok(variantIcon('lucky') !== standard && variantIcon('lucky').endsWith('</svg>'));
});

t('play menu i18n: every variant has a name and a tagline, the Game-of-Day card has its texts, in both languages', () => {
  for (const dict of [EN, ZH]) {
    for (const mode of ['standard', ...PLAY_VARIANTS.map(v => v.id)]) {
      ok(dict['mode.' + mode], 'mode.' + mode);
      ok(dict['mode.' + mode + 'Tag'], 'mode.' + mode + 'Tag');
      ok(dict['mode.' + mode + 'Rules'], 'mode.' + mode + 'Rules');
    }
    for (const key of ['menu.mode', 'menu.sub', 'gotd.play', 'gotd.blurb']) ok(dict[key], key);
  }
  for (const v of PLAY_VARIANTS) eq(v.keys.rules, 'mode.' + v.id + 'Rules');
});

t('play texts: nothing a player can read mentions the hidden hold-V reveal', () => {
  for (const [lang, dict] of [['en', EN], ['zh', ZH]]) {
    for (const [key, value] of Object.entries(dict)) {
      const text = typeof value === 'function' ? [value(1), value(2)].join(' ') : value;
      ok(!/\bhold\b.*\bv\b|\bv\b key|按住|长按|developer|开发/i.test(text), lang + ' ' + key + ': ' + text);
    }
  }
});

registerAsyncTests();
