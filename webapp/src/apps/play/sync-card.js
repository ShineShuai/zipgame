// The menu card of the device sync (platform/sync): what it says and which buttons it shows,
// from a plain model. Pure, so that it can be tested without a page.
//
// The card is ONE LINE until the player opens it (a header that is a button: icon, title, a
// summary of the state, a pill, a chevron). Opened, it shows what the state allows. While a
// flow is under way (a link opened here or made, a phrase shown or typed) it is open by itself.
//
//   model = { shown, open, more, phase, enabled, peers: [{ name, at }], link, status, note,
//             reason, armed, canShare, copied, now, linkable, cloud, phrase, phraseInput,
//             phraseError, phraseCopied }
//   phase: 'idle' | 'confirm' (a link was opened here: the player decides) | 'inviting' (a link
//          was made, waiting for the other device) | 'working' (connecting or syncing) |
//          'done' (just linked or joined) | 'failed' | 'phrase' (the sync phrase is shown) |
//          'enter' (the player types a sync phrase) | 'joining' (it is being used)
//   open / more: the player opened the card / its further options
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

// The text key for a cloud error code (platform/sync/cloud/http.js, cloud.js).
export function cloudErrorKey(code) {
  if (code === 'toobig') return 'sync.cloudTooBig';
  const refused = ['denied', 'rejected', 'unauthorized'].includes(code);
  return refused ? 'sync.cloudRefused' : 'sync.cloudFail';
}

const STATUS_KEYS = {
  waiting: 'sync.waiting', connecting: 'sync.connecting', syncing: 'sync.syncing',
  looking: 'sync.looking',
};
// Phases in which a flow is under way: the card is open and cannot be closed
const FLOW = ['confirm', 'inviting', 'working', 'phrase', 'enter', 'joining'];
export const isFlow = phase => FLOW.includes(phase);

// What the closed card says: { text, pill, tone }; tone: off | on | busy | problem | ask.
export function summaryOf(model, t) {
  const cloud = model.cloud || {};
  const flows = {
    confirm: ['sync.sumConfirm', 'sync.pillReview', 'ask'],
    inviting: ['sync.sumLinking', '', 'busy'],
    working: ['sync.sumLinking', '', 'busy'],
    joining: ['sync.sumLinking', '', 'busy'],
    phrase: ['sync.sumPhrase', '', 'busy'],
    enter: ['sync.sumEnter', '', 'busy'],
  };
  const flow = flows[model.phase];
  if (flow) {
    return { text: t(flow[0]), pill: flow[1] ? t(flow[1]) : '', tone: flow[2] };
  }
  if (model.phase === 'failed' || (cloud.on && cloud.error)) {
    return { text: t('sync.sumProblem'), pill: t('sync.pillCheck'), tone: 'problem' };
  }
  if (model.enabled) {
    const last = Math.max(0, cloud.on ? cloud.lastOk || 0 : 0, ...model.peers.map(p => p.at || 0));
    const what = model.peers.length ? t('sync.on', model.peers.length)
      : cloud.on ? t('sync.sumCloud') : t('sync.onNone');
    const [key, n] = agoKey(last, model.now);
    return {
      text: last ? `${what} · ${t(key, n)}` : what, pill: t('sync.pillManage'), tone: 'on',
    };
  }
  return { text: t('sync.sumOff'), pill: t('sync.pillSetUp'), tone: 'off' };
}

const button = (id, text, cls = '') =>
  `<button type="button" class="btn${cls ? ' ' + cls : ''}" id="${id}">${text}</button>`;
const option = (id, title, hint) => `<button type="button" class="sync-option" id="${id}">
          <span class="sync-option-title">${title}</span>
          <span class="sync-option-hint">${hint}</span></button>`;
const actions = html => (html ? `<div class="sync-actions">${html}</div>` : '');

export function syncCardHtml(model, t, icon) {
  if (!model.shown) {
    return '';
  }
  const { phase } = model;
  const flow = isFlow(phase);
  const open = flow || Boolean(model.open);
  const summary = summaryOf(model, t);
  const cloud = model.cloud || { available: false, on: false };
  const linkable = model.linkable !== false;
  const note = (text, kind = '') =>
    (text ? `<p class="sync-note${kind ? ' ' + kind : ''}" role="status">${text}</p>` : '');
  const cloudLine = () => {
    if (cloud.busy) return note(t('sync.cloudBusy'));
    if (cloud.error) return note(t(cloudErrorKey(cloud.error)), 'bad');
    if (!cloud.lastOk) return note(t('sync.cloudNever'));
    const [key, n] = agoKey(cloud.lastOk, model.now);
    return note(t('sync.cloudSynced', t(key, n)));
  };
  let blurb = '';
  let extra = '';
  let buttons = '';
  let folded = ''; // the further options, below the buttons
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
    line = note(t('sync.joining'));
  } else {
    // idle, done, failed: what the player can do now
    if (phase === 'failed') {
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
    if (!model.enabled) {
      blurb = t('sync.blurb');
      extra = `<div class="sync-options">${
        (linkable ? option('syncLink', t('sync.link'), t('sync.linkHint')) : '')
        + (cloud.available ? option('syncMakePhrase', t('sync.makePhrase'), t('sync.makeHint'))
          + option('syncHavePhrase', t('sync.havePhrase'), t('sync.haveHint')) : '')}</div>`;
    } else {
      const rows = model.peers.map(peer => {
        const [key, n] = agoKey(peer.at, model.now);
        const name = esc(peer.name || t('sync.device'));
        return `<li><span>${name}</span><small>${t(key, n)}</small></li>`;
      });
      extra = rows.length ? `<ul class="sync-peers">${rows.join('')}</ul>` : '';
      if (model.status === 'looking') {
        line = note(t('sync.looking')) + line;
      }
      if (cloud.on) {
        line += cloudLine();
      }
      const armedOff = model.armed;
      const armedDelete = cloud.on && cloud.armed;
      if (armedOff) line += note(t('sync.offConfirm'), 'bad');
      if (armedDelete) line += note(t('sync.cloudDeleteConfirm'), 'bad');
      buttons = (model.peers.length || cloud.on ? button('syncNow', t('sync.syncNow')) : '')
        + (linkable ? button('syncLink', t('sync.link'), 'secondary') : '')
        + (cloud.on ? button('syncShowPhrase', t('sync.cloudShow'), 'secondary')
          : cloud.available ? button('syncCloudOn', t('sync.cloudOn'), 'secondary') : '')
        + button('syncMore', t(model.more ? 'sync.less' : 'sync.more'), 'secondary');
      if (model.more) {
        const more = (cloud.available && !cloud.on
          ? button('syncHavePhrase', t('sync.havePhrase'), 'secondary') : '')
          + (cloud.on ? button('syncCloudStop', t('sync.cloudStop'), 'secondary')
            + button('syncCloudDelete', t(armedDelete ? 'sync.tapAgain' : 'sync.cloudDelete'),
              `secondary sync-off${armedDelete ? ' armed' : ''}`) : '')
          + button('syncOff', t(armedOff ? 'sync.tapAgain' : 'sync.off'),
            `secondary sync-off${armedOff ? ' armed' : ''}`);
        folded = `<div class="sync-more"><p class="sync-more-title">${t('sync.more')}</p>${
          actions(more)}</div>`;
      }
    }
  }

  const pill = summary.pill
    ? `<span class="sync-pill sync-pill-${summary.tone}">${summary.pill}</span>` : '';
  const head = `<span class="card-badge">${icon}</span>
          <span class="sync-head-text">
            <span class="card-title">${t('sync.title')}</span>
            <span class="card-sub">${esc(summary.text)}</span>
          </span>
          ${pill}`;
  const header = flow
    ? `<div class="sync-head sync-head-static">${head}</div>`
    : `<button type="button" class="sync-head" id="syncToggle" aria-expanded="${open}"
          aria-controls="syncBody">${head}
          <span class="sync-chevron" aria-hidden="true">›</span></button>`;
  const body = open ? `<div class="sync-body" id="syncBody">
        ${blurb ? `<p class="blurb">${blurb}</p>` : ''}
        ${extra}
        ${actions(buttons)}
        ${folded}
        ${line}
        <p class="sync-privacy">${t('sync.privacy')}</p>
      </div>` : '';

  return `<section class="card sync-card sync-${summary.tone}${open ? ' open' : ''}" id="syncCard">
        ${header}
        ${body}
      </section>`;
}
