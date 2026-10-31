// The menu card of the device sync (platform/sync): what it says and which buttons it shows,
// from a plain model. Pure, so that it can be tested without a page.
//
//   model = { shown, phase, enabled, peers: [{ name, at }], link, status, note, reason, armed,
//             canShare, copied, now, linkable, cloud, phrase, phraseInput, phraseError,
//             phraseCopied }
//   phase: 'idle' | 'confirm' (a link was opened here: the player decides) | 'inviting' (a link
//          was made, waiting for the other device) | 'working' (connecting or syncing) |
//          'done' (just linked or joined) | 'failed' | 'phrase' (the sync phrase is shown) |
//          'enter' (the player types a sync phrase) | 'joining' (it is being used)
//   status: 'waiting' | 'connecting' | 'syncing' | 'looking', or ''
//   note: { kind: 'linked' | 'cloud-on' | 'joined' | 'erased', name } or null
//   reason: why it failed (p2p.js reasons)
//   linkable: this browser can link devices (WebRTC); false hides the link buttons
//   cloud: { available, on, busy, error, lastOk, armed } (platform/sync/cloud.js status)
//   phrase: the eight words while they are shown; phraseError: { reason, position } or null
import { esc } from '../../ui/esc.js';

// How long ago `at` was, as [text key, number]; `at` 0 = never.
export function agoKey(at, now) {
  if (!at) {
    return ['sync.never', 0];
  }
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) {
    return ['sync.justNow', 0];
  }
  if (minutes < 60) {
    return ['sync.minutesAgo', minutes];
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? ['sync.hoursAgo', hours] : ['sync.daysAgo', Math.floor(hours / 24)];
}

// The text key for a failed link (p2p.js reasons).
export function failKey(reason) {
  const keys = {
    down: 'sync.failDown', expired: 'sync.failExpired', declined: 'sync.failUsed',
    taken: 'sync.failUsed', timeout: 'sync.failTimeout', connect: 'sync.failConnect',
    closed: 'sync.failConnect', failed: 'sync.failConnect', erase: 'sync.eraseFail',
  };
  return keys[reason] || 'sync.failOther';
}

// The text key for a sync phrase that was refused (core/sync/words.js PhraseError reasons).
export const phraseKey = reason => (
  { count: 'sync.phraseCount', word: 'sync.phraseWord', checksum: 'sync.phraseCheck' }[reason]
  || 'sync.phraseCheck');

const STATUS_KEYS = {
  waiting: 'sync.waiting', connecting: 'sync.connecting', syncing: 'sync.syncing',
  looking: 'sync.looking',
};

const button = (id, text, cls = '') =>
  `<button type="button" class="btn${cls ? ' ' + cls : ''}" id="${id}">${text}</button>`;

export function syncCardHtml(model, t, icon) {
  if (!model.shown) {
    return '';
  }
  const { phase } = model;
  const cloud = model.cloud || { available: false, on: false };
  const note = (text, kind = '') =>
    (text ? `<p class="sync-note${kind ? ' ' + kind : ''}" role="status">${text}</p>` : '');
  const cloudLine = () => {
    if (cloud.busy) return note(t('sync.cloudBusy'));
    if (cloud.error) return note(t('sync.cloudFail'), 'bad');
    if (!cloud.lastOk) return note(t('sync.cloudNever'));
    const [key, n] = agoKey(cloud.lastOk, model.now);
    return note(t('sync.cloudSynced', t(key, n)));
  };
  const linkable = model.linkable !== false;
  const linkButton = (cls = '') => (linkable ? button('syncLink', t('sync.link'), cls) : '');
  let blurb = t('sync.blurb');
  let extra = '';
  let buttons = linkButton()
    + (cloud.available ? button('syncMakePhrase', t('sync.makePhrase'), 'secondary')
      + button('syncHavePhrase', t('sync.havePhrase'), 'secondary') : '');
  let second = '';
  let line = '';

  if (phase === 'confirm') {
    blurb = t('sync.confirm');
    buttons = button('syncConfirm', t('sync.confirmYes'))
      + button('syncDecline', t('sync.cancel'), 'secondary');
  } else if (phase === 'inviting') {
    blurb = t('sync.linkSteps');
    extra = `<input class="sync-link" id="syncLinkField" readonly value="${esc(model.link)}"
      aria-label="${t('sync.link')}">`;
    buttons = button('syncCopy', t(model.copied ? 'sync.copied' : 'sync.copy'))
      + (model.canShare ? button('syncShare', t('sync.share'), 'secondary') : '')
      + button('syncCancel', t('sync.cancel'), 'secondary');
    line = note(t('sync.waiting'));
  } else if (phase === 'working') {
    blurb = t('sync.linkSteps');
    buttons = button('syncCancel', t('sync.cancel'), 'secondary');
    line = note(t(STATUS_KEYS[model.status] || 'sync.connecting'));
  } else if (phase === 'phrase') {
    blurb = t('sync.phraseShow');
    const words = (model.phrase || []).map(esc).join(' ');
    extra = `<p class="sync-phrase" id="syncPhrase">${words}</p>`;
    const copy = model.phraseCopied ? 'sync.phraseCopied' : 'sync.copyPhrase';
    buttons = button('syncCopyPhrase', t(copy))
      + button('syncPhraseDone', t('sync.done'), 'secondary');
    line = cloudLine();
  } else if (phase === 'enter') {
    blurb = t('sync.phraseEnter');
    extra = `<textarea class="sync-link sync-phrase-field" id="syncPhraseField" rows="2"
      spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"
      aria-label="${t('sync.havePhrase')}">${esc(model.phraseInput || '')}</textarea>`;
    buttons = button('syncJoin', t('sync.phraseJoin'))
      + button('syncCancel', t('sync.cancel'), 'secondary');
    const error = model.phraseError;
    line = error ? note(t(phraseKey(error.reason), error.position + 1), 'bad') : '';
  } else if (phase === 'joining') {
    blurb = t('sync.phraseEnter');
    buttons = '';
    line = note(t('sync.joining'));
  } else if (phase === 'failed') {
    line = note(t(failKey(model.reason)), 'bad');
  } else if (phase === 'done' && model.note) {
    const { kind, name } = model.note;
    if (kind === 'linked') {
      line = note(name ? t('sync.linked', esc(name)) : t('sync.linkedNoName'), 'ok');
    } else if (kind === 'cloud-on') {
      line = note(t('sync.cloudOnNote', esc(name || t('sync.device'))), 'ok');
    } else if (kind === 'joined') {
      line = note(t('sync.joined'), 'ok');
    } else if (kind === 'erased') {
      line = note(t('sync.erased'), 'ok');
    }
  }

  const resting = phase === 'idle' || phase === 'done' || phase === 'failed';
  if (model.enabled && resting) {
    const rows = model.peers.map(peer => {
      const [key, n] = agoKey(peer.at, model.now);
      const name = esc(peer.name || t('sync.device'));
      return `<li><span>${name}</span><small>${t(key, n)}</small></li>`;
    });
    extra = rows.length ? `<ul class="sync-peers">${rows.join('')}</ul>` : '';
    blurb = model.peers.length ? t('sync.on', model.peers.length) : t('sync.onNone');
    buttons = (model.peers.length || cloud.on ? button('syncNow', t('sync.syncNow')) : '')
      + linkButton('secondary')
      + button('syncOff', t(model.armed ? 'sync.offConfirm' : 'sync.off'),
        `secondary sync-off${model.armed ? ' armed' : ''}`);
    if (model.status === 'looking') {
      line = note(t('sync.looking')) + line;
    }
    if (cloud.on) {
      line += cloudLine();
      second = button('syncShowPhrase', t('sync.cloudShow'), 'secondary')
        + button('syncCloudStop', t('sync.cloudStop'), 'secondary')
        + button('syncCloudDelete',
          t(cloud.armed ? 'sync.cloudDeleteConfirm' : 'sync.cloudDelete'),
          `secondary sync-off${cloud.armed ? ' armed' : ''}`);
    } else if (cloud.available) {
      second = button('syncCloudOn', t('sync.cloudOn'), 'secondary')
        + button('syncHavePhrase', t('sync.havePhrase'), 'secondary');
    }
  }

  return `<section class="card sync-card" id="syncCard">
        <header class="card-head">
          <span class="card-badge">${icon}</span>
          <div class="card-head-text">
            <h2 class="card-title">${t('sync.title')}</h2>
            <p class="card-sub">${t('sync.sub')}</p>
          </div>
        </header>
        <p class="blurb">${blurb}</p>
        ${extra}
        <div class="button-row">${buttons}</div>
        ${second ? `<div class="button-row">${second}</div>` : ''}
        ${line}
      </section>`;
}
