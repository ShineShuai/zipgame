// The notice over the page (ui/notice.js) and the words of the sync notices
// (apps/play/sync-notice.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noticeOf } from '../../src/apps/play/sync-notice.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { showNotice } from '../../src/ui/notice.js';

// just enough of a page for showNotice
function fakeDoc() {
  const body = { children: [], append(...els) { this.children.push(...els); } };
  const make = tag => ({
    tag, className: '', attrs: {}, children: [], listeners: {}, textContent: '', removed: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...els) { this.children.push(...els); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    remove() { this.removed = true; body.children = body.children.filter(c => c !== this); },
  });
  return {
    body,
    createElement: make,
    querySelectorAll: selector => {
      const key = /\[data-notice="(.*)"\]/.exec(selector)[1];
      return body.children.filter(el => el.attrs['data-notice'] === key);
    },
  };
}
const timers = () => {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => { pending.set(next, { fn, ms }); return next++; },
    clearTimer: id => pending.delete(id),
    pending,
    fire: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
  };
};

test('a notice is a status message with its text and a close button', () => {
  const doc = fakeDoc();
  const clock = timers();
  const notice = { key: 'k', text: 'Sync failed', kind: 'bad', dismiss: 'Close it' };
  showNotice(notice, { doc, ...clock });
  const [el] = doc.body.children;
  assert.equal(el.className, 'notice notice-bad');
  assert.equal(el.attrs.role, 'status');
  const [message, button] = el.children;
  assert.equal(message.textContent, 'Sync failed', 'text, never markup');
  assert.equal(button.attrs['aria-label'], 'Close it');
});

test('it goes by itself, or when it is closed; a new one with the same key replaces it', () => {
  const doc = fakeDoc();
  const clock = timers();
  showNotice({ key: 'k', text: 'one', ms: 5000 }, { doc, ...clock });
  assert.deepEqual([...clock.pending.values()].map(t => t.ms), [5000]);
  clock.fire();
  assert.equal(doc.body.children.length, 0);
  showNotice({ key: 'k', text: 'two' }, { doc, ...clock });
  showNotice({ key: 'k', text: 'three' }, { doc, ...clock });
  showNotice({ key: 'other', text: 'four' }, { doc, ...clock });
  assert.deepEqual(doc.body.children.map(el => el.children[0].textContent), ['three', 'four']);
  doc.body.children[0].children[1].listeners.click();
  assert.deepEqual(doc.body.children.map(el => el.children[0].textContent), ['four']);
});

test('text with markup is shown as text', () => {
  const doc = fakeDoc();
  showNotice({ text: '<img src=x onerror=alert(1)>' }, { doc, ...timers() });
  assert.equal(doc.body.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
});

test('each event of health.js has its words, in both languages', () => {
  const events = ['cloud-failed', 'cloud-refused', 'cloud-toobig', 'cloud-recovered',
    'meet-failed'].map(kind => ({ kind }));
  const used = new Set();
  const tr = key => { used.add(key); return key; };
  const notices = events.map(event => noticeOf(event, tr));
  assert.deepEqual(notices.map(n => n.key),
    ['sync-cloud', 'sync-cloud', 'sync-cloud', 'sync-cloud', 'sync-meet']);
  assert.deepEqual(notices.map(n => n.kind), ['bad', 'bad', 'bad', 'ok', 'bad']);
  const link = noticeOf({ kind: 'link-failed', reason: 'expired' }, tr);
  assert.deepEqual([link.key, link.kind, link.text], ['sync-link', 'bad', 'sync.failExpired']);
  assert.equal(noticeOf({ kind: 'something-else' }, tr), null);
  for (const key of [...used, 'sync.noteClose']) {
    assert.ok(key in EN && key in ZH, `${key} in both languages`);
  }
});

test('the notices say that the data is safe where it is true', () => {
  for (const key of ['sync.noteCloudFailed', 'sync.noteCloudRefused', 'sync.noteTooBig']) {
    assert.match(EN[key], /safe on this device/);
  }
  assert.ok(ZH['sync.noteCloudFailed'].includes('安全'));
});
