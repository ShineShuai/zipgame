// The menu card of the device sync (apps/play/sync-card.js): pure text and buttons from a model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agoKey, failKey, syncCardHtml } from '../../src/apps/play/sync-card.js';
import { EN, ZH } from '../../src/ui/i18n.js';

const base = {
  shown: true, phase: 'idle', enabled: false, peers: [], link: '', status: '', note: null,
  reason: '', armed: false, canShare: false, copied: false, now: 10_000_000,
};
const keyed = (key, ...args) => `[${key}${args.length ? ' ' + args.join(',') : ''}]`;
const html = (over = {}) => syncCardHtml({ ...base, ...over }, keyed, '<svg></svg>');
const ids = text => [...text.matchAll(/id="(sync\w+)"/g)].map(match => match[1]);

test('hidden where the browser cannot link devices', () => {
  assert.equal(html({ shown: false }), '');
});

test('OFF: the card explains and offers one button, nothing else', () => {
  const card = html();
  assert.match(card, /\[sync\.blurb\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncLink']);
  assert.ok(!card.includes('sync-peers'));
});

test('a link opened on this page only asks: confirm or decline', () => {
  const card = html({ phase: 'confirm' });
  assert.match(card, /\[sync\.confirm\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncConfirm', 'syncDecline']);
});

test('while the link waits: the link, copy, share (where there is one), cancel', () => {
  const link = 'https://a.b/play#y=abc"><script>';
  const card = html({ phase: 'inviting', link });
  assert.ok(!card.includes('<script>'), 'the link is escaped');
  assert.match(card,
    /value="https:\/\/a\.b\/play#y=abc&quot;&gt;&lt;script&gt;"/);
  assert.deepEqual(ids(card), ['syncCard', 'syncLinkField', 'syncCopy', 'syncCancel']);
  assert.match(card, /\[sync\.copy\]/);
  const shared = html({ phase: 'inviting', link, canShare: true, copied: true });
  assert.deepEqual(ids(shared),
    ['syncCard', 'syncLinkField', 'syncCopy', 'syncShare', 'syncCancel']);
  assert.match(shared, /\[sync\.copied\]/);
});

test('connecting and syncing show the status and a cancel button', () => {
  for (const [status, key] of [['waiting', 'sync.waiting'], ['connecting', 'sync.connecting'],
    ['syncing', 'sync.syncing']]) {
    const card = html({ phase: 'working', status });
    assert.match(card, new RegExp(`\\[${key.replace('.', '\\.')}\\]`));
    assert.deepEqual(ids(card), ['syncCard', 'syncCancel']);
  }
});

test('ON: the linked devices with their names (escaped) and when they last synced', () => {
  const card = html({
    enabled: true,
    peers: [{ name: '<b>Phone</b>', at: 10_000_000 - 5 * 60000 }, { name: '', at: 0 }],
  });
  assert.ok(!card.includes('<b>Phone</b>'));
  assert.match(card, /&lt;b&gt;Phone&lt;\/b&gt;/);
  assert.match(card, /\[sync\.minutesAgo 5\]/);
  assert.match(card, /\[sync\.never 0\]/);
  assert.match(card, /\[sync\.device\]/, 'a device without a name');
  assert.match(card, /\[sync\.on 2\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncNow', 'syncLink', 'syncOff']);
});

test('ON without a linked device yet: nothing to sync now, only linking and turning off', () => {
  const card = html({ enabled: true });
  assert.match(card, /\[sync\.onNone\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncLink', 'syncOff']);
});

test('turning off needs a second tap', () => {
  const armed = html({ enabled: true, armed: true });
  assert.match(armed, /sync-off armed/);
  assert.match(armed, /\[sync\.offConfirm\]/);
  assert.ok(!html({ enabled: true }).includes('armed'));
});

test('a link that just worked says so, with the name when there is one', () => {
  assert.match(html({ phase: 'done', enabled: true, note: { kind: 'linked', name: 'Phone' } }),
    /\[sync\.linked Phone\]/);
  assert.match(html({ phase: 'done', enabled: true, note: { kind: 'linked', name: '' } }),
    /\[sync\.linkedNoName\]/);
});

test('a failed link says why, and offers to try again', () => {
  const card = html({ phase: 'failed', reason: 'expired' });
  assert.match(card, /\[sync\.failExpired\]/);
  assert.match(card, /sync-note bad/);
  assert.deepEqual(ids(card), ['syncCard', 'syncLink']);
  assert.deepEqual(['down', 'expired', 'declined', 'taken', 'timeout', 'connect', 'closed', 'x']
    .map(failKey), ['sync.failDown', 'sync.failExpired', 'sync.failUsed', 'sync.failUsed',
    'sync.failTimeout', 'sync.failConnect', 'sync.failConnect', 'sync.failOther']);
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
});

test('every text the card can show exists in English and Chinese', () => {
  const used = new Set();
  const record = key => { used.add(key); return key; };
  const models = [
    {}, { phase: 'confirm' }, { phase: 'inviting', link: 'x', canShare: true },
    { phase: 'working', status: 'looking' }, { phase: 'working', status: 'syncing' },
    { phase: 'done', enabled: true, note: { kind: 'linked', name: 'a' },
      peers: [{ name: 'a', at: 1 }] },
    { enabled: true, peers: [{ name: '', at: 0 }, { name: 'x', at: 9_990_000 },
      { name: 'y', at: 1_000_000 }, { name: 'z', at: 9_000_000 }], armed: true,
    status: 'looking' },
    { enabled: true }, ...['down', 'expired', 'declined', 'timeout', 'connect', 'x']
      .map(reason => ({ phase: 'failed', reason })),
  ];
  for (const model of models) syncCardHtml({ ...base, ...model }, record, '');
  assert.ok(used.size > 25);
  for (const key of used) {
    assert.ok(key in EN, `${key} in EN`);
    assert.ok(key in ZH, `${key} in ZH`);
  }
});

const cloud = (over = {}) => ({ available: true, on: false, busy: false, error: null, lastOk: 0,
  armed: false, ...over });

test('OFF with the cloud available: link, make a phrase, or enter one', () => {
  const card = html({ cloud: cloud() });
  assert.deepEqual(ids(card), ['syncCard', 'syncLink', 'syncMakePhrase', 'syncHavePhrase']);
  const noLink = html({ cloud: cloud(), linkable: false });
  assert.deepEqual(ids(noLink), ['syncCard', 'syncMakePhrase', 'syncHavePhrase']);
});

test('the sync phrase is shown as eight words (escaped), with copy and '
  + 'done, and the cloud line', () => {
  const words = ['baba', 'beba', 'biba', 'bobo', 'daba', 'deba', 'diba', '<b>x</b>'];
  const card = html({ phase: 'phrase', phrase: words, cloud: cloud({ on: true }), enabled: true });
  assert.match(card, /baba beba biba bobo daba deba diba &lt;b&gt;x&lt;\/b&gt;/);
  assert.deepEqual(ids(card), ['syncCard', 'syncPhrase', 'syncCopyPhrase', 'syncPhraseDone']);
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
  assert.deepEqual(ids(card), ['syncCard', 'syncPhraseField', 'syncJoin', 'syncCancel']);
  assert.ok(!card.includes('sync-note'));
  const wrong = html({ phase: 'enter', phraseError: { reason: 'word', position: 2 } });
  assert.match(wrong, /\[sync\.phraseWord 3\]/, 'the position is told from 1');
  assert.match(html({ phase: 'enter', phraseError: { reason: 'count', position: -1 } }),
    /\[sync\.phraseCount 0\]/);
  assert.match(html({ phase: 'enter', phraseError: { reason: 'checksum', position: -1 } }),
    /\[sync\.phraseCheck 0\]/);
  const joining = html({ phase: 'joining' });
  assert.match(joining, /\[sync\.joining\]/);
  assert.deepEqual(ids(joining), ['syncCard']);
});

test('ON with the cloud: its line, show phrase, stop, delete (two taps)', () => {
  const now = 10_000_000;
  const card = html({ enabled: true, peers: [{ name: 'Phone', at: now }],
    cloud: cloud({ on: true, lastOk: now - 3 * 60000 }) });
  assert.match(card, /\[sync\.cloudSynced \[sync\.minutesAgo 3\]\]/);
  assert.deepEqual(ids(card), ['syncCard', 'syncNow', 'syncLink', 'syncOff', 'syncShowPhrase',
    'syncCloudStop', 'syncCloudDelete']);
  const armed = html({ enabled: true, cloud: cloud({ on: true, armed: true }) });
  assert.match(armed, /\[sync\.cloudDeleteConfirm\]/);
  assert.match(armed, /sync-off armed/);
  assert.match(html({ enabled: true, cloud: cloud({ on: true, error: 'network' }) }),
    /sync-note bad[^>]*>\[sync\.cloudFail\]/);
});

test('ON by links only, with the cloud available: turn it on, or enter a phrase', () => {
  const card = html({ enabled: true, peers: [{ name: 'P', at: 1 }], cloud: cloud() });
  assert.deepEqual(ids(card), ['syncCard', 'syncNow', 'syncLink', 'syncOff', 'syncCloudOn',
    'syncHavePhrase']);
});

test('ON by the cloud alone: sync now works, and there is no link button where it cannot', () => {
  const card = html({ enabled: true, cloud: cloud({ on: true }), linkable: false });
  assert.deepEqual(ids(card), ['syncCard', 'syncNow', 'syncOff', 'syncShowPhrase',
    'syncCloudStop', 'syncCloudDelete']);
});

test('notes after a link, a phrase joined, a cloud copy deleted, cloud '
  + 'turned on from a device', () => {
  const done = note => html({ phase: 'done', enabled: true, note, cloud: cloud() });
  assert.match(done({ kind: 'joined' }), /\[sync\.joined\]/);
  assert.match(done({ kind: 'erased' }), /\[sync\.erased\]/);
  assert.match(done({ kind: 'cloud-on', name: 'Phone' }), /\[sync\.cloudOnNote Phone\]/);
  assert.match(done({ kind: 'cloud-on', name: '' }), /\[sync\.cloudOnNote \[sync\.device\]\]/);
  assert.match(html({ phase: 'failed', reason: 'erase' }), /\[sync\.eraseFail\]/);
});

test('every text of the phrase and cloud screens exists in English and Chinese', () => {
  const used = new Set();
  const record = key => { used.add(key); return key; };
  const words = Array(8).fill('baba');
  const models = [
    { cloud: cloud() }, { phase: 'phrase', phrase: words, phraseCopied: true, cloud: cloud() },
    { phase: 'enter', phraseError: { reason: 'word', position: 0 } },
    { phase: 'enter', phraseError: { reason: 'count', position: -1 } },
    { phase: 'enter', phraseError: { reason: 'checksum', position: -1 } }, { phase: 'joining' },
    { enabled: true, cloud: cloud({ on: true, lastOk: 1, armed: true }) },
    { enabled: true, cloud: cloud({ on: true, busy: true }) },
    { enabled: true, cloud: cloud({ on: true, error: 'x' }) },
    { enabled: true, cloud: cloud() }, { phase: 'failed', reason: 'erase' },
    ...['joined', 'erased', 'cloud-on'].map(kind => (
      { phase: 'done', enabled: true, note: { kind, name: 'a' } })),
  ];
  for (const model of models) syncCardHtml({ ...base, ...model }, record, '');
  for (const key of used) {
    assert.ok(key in EN, `${key} in EN`);
    assert.ok(key in ZH, `${key} in ZH`);
  }
  assert.ok([...used].some(key => key.startsWith('sync.cloud')));
});

test('the privacy line is on the card in every state, and says what the servers can see', () => {
  const models = [{}, { phase: 'confirm' }, { phase: 'inviting', link: 'x' }, { phase: 'enter' },
    { phase: 'phrase', phrase: ['a'] }, { enabled: true }, { phase: 'failed', reason: 'down' }];
  for (const model of models) {
    assert.match(html(model), /\[sync\.privacy\]/, JSON.stringify(model));
  }
  assert.ok(!html({ shown: false }).includes('sync.privacy'));
  for (const text of [EN['sync.privacy'], ZH['sync.privacy']]) {
    assert.ok(text.length < 330, 'short');
  }
  for (const word of ['encrypted', 'IP', 'no account']) {
    assert.ok(EN['sync.privacy'].toLowerCase().includes(word.toLowerCase()), word);
  }
  assert.ok(ZH['sync.privacy'].includes('IP'));
});

test('the cloud line says what went wrong: unreachable, refused, too big', () => {
  const line = error => html({ enabled: true, cloud: { available: true, on: true, error } });
  assert.match(line('network'), /sync-note bad[^>]*>\[sync\.cloudFail\]/);
  assert.match(line('closed'), /\[sync\.cloudFail\]/);
  for (const code of ['denied', 'rejected', 'unauthorized']) {
    assert.match(line(code), /\[sync\.cloudRefused\]/, code);
  }
  assert.match(line('toobig'), /\[sync\.cloudTooBig\]/);
  for (const key of ['sync.cloudFail', 'sync.cloudRefused', 'sync.cloudTooBig']) {
    assert.ok(key in EN && key in ZH, key);
  }
});
