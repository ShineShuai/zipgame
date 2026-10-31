// The menu card of the device sync (platform/sync): what it says and which buttons it shows,
// from a plain model. Pure, so that it can be tested without a page.
//
//   model = { shown, phase, enabled, peers: [{ name, at }], link, status, note, reason, armed,
//             canShare, copied, now }
//   phase: 'idle' | 'confirm' (a link was opened here: the player decides) | 'inviting' (a link
//          was made, waiting for the other device) | 'working' (connecting or syncing) |
//          'done' (just linked) | 'failed'
//   status: 'waiting' | 'connecting' | 'syncing' | 'looking', or ''
//   note: { name } after a link was made, else null; reason: why it failed (p2p.js)
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
    closed: 'sync.failConnect', failed: 'sync.failConnect',
  };
  return keys[reason] || 'sync.failOther';
}

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
  const note = (text, kind = '') =>
    (text ? `<p class="sync-note${kind ? ' ' + kind : ''}" role="status">${text}</p>` : '');
  let blurb = t('sync.blurb');
  let extra = '';
  let buttons = button('syncLink', t('sync.link'));
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
  } else if (phase === 'failed') {
    line = note(t(failKey(model.reason)), 'bad');
  } else if (phase === 'done' && model.note) {
    const { name } = model.note;
    line = note(name ? t('sync.linked', esc(name)) : t('sync.linkedNoName'), 'ok');
  }

  if (model.enabled && (phase === 'idle' || phase === 'done' || phase === 'failed')) {
    const rows = model.peers.map(peer => {
      const [key, n] = agoKey(peer.at, model.now);
      const name = esc(peer.name || t('sync.device'));
      return `<li><span>${name}</span><small>${t(key, n)}</small></li>`;
    });
    extra = rows.length ? `<ul class="sync-peers">${rows.join('')}</ul>` : '';
    blurb = model.peers.length ? t('sync.on', model.peers.length) : t('sync.onNone');
    buttons = (model.peers.length ? button('syncNow', t('sync.syncNow')) : '')
      + button('syncLink', t('sync.link'), 'secondary')
      + button('syncOff', t(model.armed ? 'sync.offConfirm' : 'sync.off'),
        `secondary sync-off${model.armed ? ' armed' : ''}`);
    if (model.status === 'looking') {
      line = note(t('sync.looking'));
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
        ${line}
      </section>`;
}
