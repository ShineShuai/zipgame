// The menu card of the device sync (apps/play/sync-card.js): pure text and buttons from a model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agoKey, cloudErrorKey, failKey, isFlow, phraseKey, summaryOf, syncCardHtml,
} from '../../src/apps/play/sync-card.js';
import { EN, ZH } from '../../src/ui/i18n.js';

const NOW = 10_000_000;
const base = {
  shown: true, open: true, more: false, phase: 'idle', enabled: false, peers: [], link: '',
  status: '', note: null, reason: '', armed: false, canShare: false, copied: false, now: NOW,
};
const keyed = (key, ...args) => `[${key}${args.length ? ' ' + args.join(',') : ''}]`;
const html = (over = {}) => syncCardHtml({ ...base, ...over }, keyed, '<svg></svg>');
const ids = text => [...text.matchAll(/id="(sync\w+)"/g)].map(match => match[1]);
const cloud = (over = {}) => ({
  available: true, on: false, busy: false, error: null, lastOk: 0, armed: false, ...over,
});
const summary = (over = {}) => summaryOf({ ...base, ...over }, keyed);

test('hidden where the browser can do neither a link nor the cloud', () => {
  assert.equal(html({ shown: false }), '');
});

// ---- closed: one line --------------------------------------------------------------------------

test('CLOSED by default: a one-line header that is a button, and nothing else', () => {
  const card = html({ open: false });
  assert.deepEqual(ids(card), ['syncCard', 'syncToggle']);
  assert.match(card, /aria-expanded="false"/);
  assert.match(card, /aria-controls="syncBody"/);
  assert.ok(!card.includes('id="syncBody"'), 'no body is drawn');
  assert.ok(!card.includes('sync.privacy'), 'the privacy line is in the body');
  assert.match(card, /\[sync\.title\]/);
  assert.match(card, /\[sync\.sumOff\]/);
  assert.match(card, /\[sync\.pillSetUp\]/);
});

test('OPEN: the toggle says so, and the body follows', () => {
  const card = html({ open: true });
  assert.match(card, /aria-expanded="true"/);
  assert.match(card, /id="syncBody"/);
  assert.match(card, /sync-card sync-off open/);
});

test('the summary line says the state in a few words, with a pill for what a tap does', () => {
  assert.deepEqual(summary(), { text: '[sync.sumOff]', pill: '[sync.pillSetUp]', tone: 'off' });
  const on = summary({
    enabled: true, peers: [{ name: 'P', at: NOW - 5 * 60000 }, { name: 'Q', at: NOW - 30000 }],
  });
  assert.deepEqual(on, {
    text: '[sync.on 2] · [sync.justNow 0]', pill: '[sync.pillManage]', tone: 'on' });
  assert.equal(summary({ enabled: true, peers: [{ name: 'P', at: NOW - 3 * 60000 }] }).text,
    '[sync.on 1] · [sync.minutesAgo 3]', 'the latest of the devices');
  assert.equal(summary({ enabled: true }).text, '[sync.onNone]');
  const only = summary({ enabled: true, cloud: cloud({ on: true, lastOk: NOW - 2 * 3600000 }) });
  assert.equal(only.text, '[sync.sumCloud] · [sync.hoursAgo 2]');
  assert.equal(summary({ enabled: true, cloud: cloud({ on: true }) }).text, '[sync.sumCloud]');
});

test('a problem is visible on the closed card, in the summary and the pill', () => {
  const failed = summary({ phase: 'failed', reason: 'down' });
  assert.deepEqual(failed, {
    text: '[sync.sumProblem]', pill: '[sync.pillCheck]', tone: 'problem' });
  const cloudProblem = summary({ enabled: true, cloud: cloud({ on: true, error: 'network' }) });
  assert.equal(cloudProblem.tone, 'problem');
  const card = html({ open: false, enabled: true, cloud: cloud({ on: true, error: 'network' }) });
  assert.match(card, /sync-card sync-problem/);
  assert.match(card, /sync-pill sync-pill-problem/);
  const noCloud = summary({ enabled: true, cloud: cloud({ on: false, error: 'network' }) });
  assert.equal(noCloud.tone, 'on', 'an old error of a cloud that is off is not a problem');
});

test('a flow opens the card by itself, and then it cannot be closed', () => {
  for (const phase of ['confirm', 'inviting', 'working', 'phrase', 'enter', 'joining']) {
    assert.ok(isFlow(phase), phase);
    const card = html({ open: false, phase, link: 'x', phrase: ['a'] });
    assert.match(card, /id="syncBody"/, `${phase}: open by itself`);
    assert.ok(!card.includes('id="syncToggle"'), `${phase}: no toggle`);
    assert.match(card, /sync-head sync-head-static/);
  }
  for (const phase of ['idle', 'done', 'failed']) assert.ok(!isFlow(phase), phase);
  assert.equal(summary({ phase: 'confirm' }).tone, 'ask');
  assert.equal(summary({ phase: 'confirm' }).pill, '[sync.pillReview]');
  assert.equal(summary({ phase: 'inviting' }).text, '[sync.sumLinking]');
  assert.equal(summary({ phase: 'phrase' }).text, '[sync.sumPhrase]');
  assert.equal(summary({ phase: 'enter' }).text, '[sync.sumEnter]');
});

test('summary text from another device is escaped', () => {
  const card = html({ open: false, enabled: true, peers: [{ name: '<b>x</b>', at: 1 }] });
  assert.ok(!card.includes('<b>x</b>'));
});

// ---- open: off ---------------------------------------------------------------------------------

test('OFF, open: what it is, and the ways in as stacked options, each with a hint', () => {
  const card = html({ cloud: cloud() });
  assert.deepEqual(ids(card),
    ['syncCard', 'syncToggle', 'syncBody', 'syncLink', 'syncMakePhrase', 'syncHavePhrase']);
  assert.match(card, /\[sync\.blurb\]/);
  for (const key of ['linkHint', 'makeHint', 'haveHint']) {
    assert.match(card, new RegExp(`\\[sync\\.${key}\\]`));
  }
  assert.match(card, /sync-option/);
  assert.ok(!card.includes('class="btn'), 'options, not buttons, so that nothing crowds');
});

test('OFF without the cloud, or without links, offers only what works', () => {
  assert.deepEqual(ids(html()), ['syncCard', 'syncToggle', 'syncBody', 'syncLink']);
  const cloudOnly = html({ cloud: cloud(), linkable: false });
  assert.deepEqual(ids(cloudOnly),
    ['syncCard', 'syncToggle', 'syncBody', 'syncMakePhrase', 'syncHavePhrase']);
});

test('the privacy line closes the body, in every state', () => {
  const models = [{}, { phase: 'confirm' }, { phase: 'inviting', link: 'x' }, { phase: 'enter' },
    { phase: 'phrase', phrase: ['a'] }, { enabled: true }, { phase: 'failed', reason: 'down' },
    { phase: 'joining' }, { phase: 'working' }, { phase: 'done', enabled: true }];
  for (const model of models) {
    const card = html(model);
    assert.match(card, /\[sync\.privacy\]<\/p>\s*<\/div>\s*<\/section>/, JSON.stringify(model));
  }
  assert.ok(!html({ shown: false }).includes('sync.privacy'));
  for (const text of [EN['sync.privacy'], ZH['sync.privacy']]) assert.ok(text.length < 330);
  for (const word of ['encrypted', 'IP', 'no account']) {
    assert.ok(EN['sync.privacy'].toLowerCase().includes(word.toLowerCase()), word);
  }
  assert.ok(ZH['sync.privacy'].includes('IP'));
});

// ---- the flows ---------------------------------------------------------------------------------

test('a link opened on this page only asks: confirm or decline', () => {
  const card = html({ phase: 'confirm' });
  assert.match(card, /\[sync\.confirm\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncBody', 'syncConfirm', 'syncDecline']);
});

test('while the link waits: the link (escaped), copy, share where there is one, cancel', () => {
  const link = 'https://a.b/play#y=abc"><script>';
  const card = html({ phase: 'inviting', link });
  assert.ok(!card.includes('<script>'), 'the link is escaped');
  assert.match(card,
    /value="https:\/\/a\.b\/play#y=abc&quot;&gt;&lt;script&gt;"/);
  assert.deepEqual(ids(card),
    ['syncCard', 'syncBody', 'syncLinkField', 'syncCopy', 'syncCancel']);
  const shared = html({ phase: 'inviting', link, canShare: true, copied: true });
  assert.deepEqual(ids(shared),
    ['syncCard', 'syncBody', 'syncLinkField', 'syncCopy', 'syncShare', 'syncCancel']);
  assert.match(shared, /\[sync\.copied\]/);
  assert.match(card, /\[sync\.waiting\]/);
});

test('connecting and syncing show the status and a cancel button', () => {
  for (const [status, key] of [['waiting', 'sync.waiting'], ['connecting', 'sync.connecting'],
    ['syncing', 'sync.syncing']]) {
    const card = html({ phase: 'working', status });
    assert.match(card, new RegExp(`\\[${key.replace('.', '\\.')}\\]`));
    assert.deepEqual(ids(card), ['syncCard', 'syncBody', 'syncCancel']);
  }
});

test('the sync phrase: eight words (escaped), copy and done, and the cloud line', () => {
  const words = ['baba', 'beba', 'biba', 'bobo', 'daba', 'deba', 'diba', '<b>x</b>'];
  const card = html({ phase: 'phrase', phrase: words, cloud: cloud({ on: true }), enabled: true });
  assert.match(card, /baba beba biba bobo daba deba diba &lt;b&gt;x&lt;\/b&gt;/);
  assert.deepEqual(ids(card),
    ['syncCard', 'syncBody', 'syncPhrase', 'syncCopyPhrase', 'syncPhraseDone']);
  assert.match(card, /\[sync\.cloudNever\]/);
  assert.match(html({ phase: 'phrase', phrase: words, phraseCopied: true }),
    /\[sync\.phraseCopied\]/);
  assert.match(html({ phase: 'phrase', phrase: words, cloud: cloud({ busy: true }) }),
    /\[sync\.cloudBusy\]/);
});

test('entering a phrase: a field that keeps what was typed, errors by kind, a join button', () => {
  const card = html({ phase: 'enter', phraseInput: 'baba "x" <b>', cloud: cloud() });
  assert.match(card,
    /<textarea[^>]*id="syncPhraseField"[^>]*>baba &quot;x&quot; &lt;b&gt;<\/textarea>/);
  assert.deepEqual(ids(card),
    ['syncCard', 'syncBody', 'syncPhraseField', 'syncJoin', 'syncCancel']);
  assert.ok(!card.includes('sync-note'));
  assert.match(html({ phase: 'enter', phraseError: { reason: 'word', position: 2 } }),
    /\[sync\.phraseWord 3\]/, 'the position is told from 1');
  assert.match(html({ phase: 'enter', phraseError: { reason: 'count', position: -1 } }),
    /\[sync\.phraseCount 0\]/);
  assert.match(html({ phase: 'enter', phraseError: { reason: 'checksum', position: -1 } }),
    /\[sync\.phraseCheck 0\]/);
  const joining = html({ phase: 'joining' });
  assert.match(joining, /\[sync\.joining\]/);
  assert.deepEqual(ids(joining), ['syncCard', 'syncBody']);
});

// ---- open: on ----------------------------------------------------------------------------------

test('ON: the devices with names (escaped) and when they synced; a few actions, the rest '
  + 'folded', () => {
  const card = html({
    enabled: true, peers: [{ name: '<b>Phone</b>', at: NOW - 5 * 60000 }, { name: '', at: 0 }],
  });
  assert.ok(!card.includes('<b>Phone</b>'));
  assert.match(card, /&lt;b&gt;Phone&lt;\/b&gt;/);
  assert.match(card, /\[sync\.minutesAgo 5\]/);
  assert.match(card, /\[sync\.never 0\]/);
  assert.match(card, /\[sync\.device\]/, 'a device without a name');
  assert.match(card, /\[sync\.on 2\]/);
  assert.deepEqual(ids(card),
    ['syncCard', 'syncToggle', 'syncBody', 'syncNow', 'syncLink', 'syncMore']);
});

test('ON without a linked device yet: nothing to sync now', () => {
  const card = html({ enabled: true });
  assert.match(card, /\[sync\.onNone\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncToggle', 'syncBody', 'syncLink', 'syncMore']);
});

test('ON, more options: the further ones in a block of their own', () => {
  const card = html({ enabled: true, peers: [{ name: 'P', at: 1 }], more: true, cloud: cloud() });
  assert.deepEqual(ids(card), ['syncCard', 'syncToggle', 'syncBody', 'syncNow', 'syncLink',
    'syncCloudOn', 'syncMore', 'syncHavePhrase', 'syncOff']);
  assert.match(card, /sync-more/);
  assert.match(card, /\[sync\.less\]/);
  assert.match(html({ enabled: true, cloud: cloud() }), /\[sync\.more\]/);
});

test('ON with the cloud: its line, show phrase; stop and delete are in more options', () => {
  const card = html({ enabled: true, peers: [{ name: 'Phone', at: NOW }],
    cloud: cloud({ on: true, lastOk: NOW - 3 * 60000 }) });
  assert.match(card, /\[sync\.cloudSynced \[sync\.minutesAgo 3\]\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncToggle', 'syncBody', 'syncNow', 'syncLink',
    'syncShowPhrase', 'syncMore']);
  const more = html({ enabled: true, more: true, cloud: cloud({ on: true }) });
  assert.deepEqual(ids(more), ['syncCard', 'syncToggle', 'syncBody', 'syncNow', 'syncLink',
    'syncShowPhrase', 'syncMore', 'syncCloudStop', 'syncCloudDelete', 'syncOff']);
  assert.ok(!more.includes('id="syncHavePhrase"'), 'a device that has the cloud has a phrase');
});

test('ON by the cloud alone: sync now works, and there is no link button where it cannot', () => {
  const card = html({ enabled: true, cloud: cloud({ on: true }), linkable: false });
  assert.deepEqual(ids(card),
    ['syncCard', 'syncToggle', 'syncBody', 'syncNow', 'syncShowPhrase', 'syncMore']);
});

test('turning off, and deleting the cloud copy, need a second tap that says what it does', () => {
  const off = html({ enabled: true, more: true, armed: true, cloud: cloud() });
  assert.match(off, /\[sync\.tapAgain\]/);
  assert.match(off, /\[sync\.offConfirm\]/, 'the consequence, in a line of its own');
  assert.match(off, /sync-off armed/);
  const del = html({ enabled: true, more: true, cloud: cloud({ on: true, armed: true }) });
  assert.match(del, /\[sync\.tapAgain\]/);
  assert.match(del, /\[sync\.cloudDeleteConfirm\]/);
  assert.ok(!html({ enabled: true, more: true }).includes('armed'));
});

test('buttons never carry a long sentence: the explanations are lines of their own', () => {
  const states = [
    { enabled: true, more: true, armed: true, cloud: cloud({ on: true, armed: true }) },
    { enabled: true, more: true, cloud: cloud() }, { phase: 'confirm' },
    { phase: 'inviting', link: 'x', canShare: true }, { phase: 'phrase', phrase: ['a'] },
    { cloud: cloud() },
  ];
  for (const model of states) {
    const card = html(model);
    for (const [, text] of card.matchAll(/<button[^>]*class="btn[^"]*"[^>]*>([^<]*)<\/button>/g)) {
      assert.ok(text.length < 40, `a short label: ${text}`);
    }
  }
  for (const key of ['sync.link', 'sync.syncNow', 'sync.more', 'sync.tapAgain', 'sync.off',
    'sync.cloudOn', 'sync.cloudShow', 'sync.cloudStop', 'sync.cloudDelete', 'sync.copy',
    'sync.share', 'sync.cancel', 'sync.done', 'sync.phraseJoin', 'sync.confirmYes']) {
    assert.ok(EN[key].length <= 24, `${key}: ${EN[key]}`);
  }
});

test('a link that just worked says so, with the name when there is one', () => {
  assert.match(html({ phase: 'done', enabled: true, note: { kind: 'linked', name: 'Phone' } }),
    /\[sync\.linked Phone\]/);
  assert.match(html({ phase: 'done', enabled: true, note: { kind: 'linked', name: '' } }),
    /\[sync\.linkedNoName\]/);
});

test('notes after a phrase joined, a cloud copy deleted, cloud turned on from a device', () => {
  const done = note => html({ phase: 'done', enabled: true, note, cloud: cloud() });
  assert.match(done({ kind: 'joined' }), /\[sync\.joined\]/);
  assert.match(done({ kind: 'erased' }), /\[sync\.erased\]/);
  assert.match(done({ kind: 'cloud-on', name: 'Phone' }), /\[sync\.cloudOnNote Phone\]/);
  assert.match(done({ kind: 'cloud-on', name: '' }), /\[sync\.cloudOnNote \[sync\.device\]\]/);
});

test('a failed link says why, and the ways in are there to try again', () => {
  const card = html({ phase: 'failed', reason: 'expired' });
  assert.match(card, /\[sync\.failExpired\]/);
  assert.match(card, /sync-note bad/);
  assert.deepEqual(ids(card), ['syncCard', 'syncToggle', 'syncBody', 'syncLink']);
  assert.deepEqual(['down', 'expired', 'declined', 'taken', 'timeout', 'connect', 'closed', 'x']
    .map(failKey), ['sync.failDown', 'sync.failExpired', 'sync.failUsed', 'sync.failUsed',
    'sync.failTimeout', 'sync.failConnect', 'sync.failConnect', 'sync.failOther']);
  assert.match(html({ phase: 'failed', reason: 'erase' }), /\[sync\.eraseFail\]/);
});

test('the cloud line says what went wrong: unreachable, refused, too big', () => {
  const line = error => html({ enabled: true, cloud: cloud({ on: true, error }) });
  assert.match(line('network'), /sync-note bad[^>]*>\[sync\.cloudFail\]/);
  assert.match(line('closed'), /\[sync\.cloudFail\]/);
  for (const code of ['denied', 'rejected', 'unauthorized']) {
    assert.match(line(code), /\[sync\.cloudRefused\]/, code);
    assert.equal(cloudErrorKey(code), 'sync.cloudRefused');
  }
  assert.match(line('toobig'), /\[sync\.cloudTooBig\]/);
  assert.match(html({ enabled: true, cloud: cloud({ on: true, busy: true }) }),
    /\[sync\.cloudBusy\]/);
});

test('how long ago: never, just now, minutes, hours, days', () => {
  const now = 100 * 86400000;
  assert.deepEqual(agoKey(0, now), ['sync.never', 0]);
  assert.deepEqual(agoKey(now - 20000, now), ['sync.justNow', 0]);
  assert.deepEqual(agoKey(now + 5000, now), ['sync.justNow', 0], 'a clock a little ahead');
  assert.deepEqual(agoKey(now - 59 * 60000, now), ['sync.minutesAgo', 59]);
  assert.deepEqual(agoKey(now - 3 * 3600000, now), ['sync.hoursAgo', 3]);
  assert.deepEqual(agoKey(now - 47 * 3600000, now), ['sync.hoursAgo', 47]);
  assert.deepEqual(agoKey(now - 5 * 86400000, now), ['sync.daysAgo', 5]);
  assert.equal(phraseKey('x'), 'sync.phraseCheck');
});

test('every text the card can show exists in English and Chinese', () => {
  const used = new Set();
  const record = key => { used.add(key); return key; };
  const words = Array(8).fill('baba');
  const models = [
    { open: false }, { open: false, enabled: true, peers: [{ name: 'a', at: 1 }] },
    { open: false, phase: 'failed', reason: 'x' }, {}, { cloud: cloud() },
    { cloud: cloud(), linkable: false }, { phase: 'confirm' },
    { phase: 'inviting', link: 'x', canShare: true, copied: true },
    { phase: 'working', status: 'looking' }, { phase: 'working', status: 'syncing' },
    { phase: 'working', status: 'waiting' }, { phase: 'working' },
    { phase: 'phrase', phrase: words, phraseCopied: true, cloud: cloud() },
    { phase: 'enter', phraseError: { reason: 'word', position: 0 } },
    { phase: 'enter', phraseError: { reason: 'count', position: -1 } },
    { phase: 'enter', phraseError: { reason: 'checksum', position: -1 } }, { phase: 'joining' },
    { enabled: true, more: true, armed: true,
      cloud: cloud({ on: true, lastOk: 1, armed: true, busy: true }) },
    { enabled: true, cloud: cloud({ on: true, error: 'x', lastOk: 1 }) },
    { enabled: true, more: true, cloud: cloud() }, { enabled: true, status: 'looking' },
    { enabled: true, peers: [{ name: '', at: 0 }, { name: 'x', at: NOW - 600000 },
      { name: 'y', at: NOW - 86400000 }, { name: 'z', at: NOW - 4 * 86400000 }] },
    ...['down', 'expired', 'declined', 'timeout', 'connect', 'x', 'erase']
      .map(reason => ({ phase: 'failed', reason })),
    ...['network', 'denied', 'toobig'].map(error => (
      { enabled: true, cloud: cloud({ on: true, error }) })),
    ...['linked', 'joined', 'erased', 'cloud-on'].map(kind => (
      { phase: 'done', enabled: true, note: { kind, name: 'a' } })),
  ];
  for (const model of models) {
    syncCardHtml({ ...base, ...model }, record, '');
    summaryOf({ ...base, ...model }, record);
  }
  assert.ok(used.size > 50, `${used.size} texts`);
  for (const key of used) {
    assert.ok(key in EN, `${key} in EN`);
    assert.ok(key in ZH, `${key} in ZH`);
  }
});
