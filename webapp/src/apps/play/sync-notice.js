// The notices of the device sync: what the player is told, in words, for each event of
// platform/sync/health.js. Pure (`noticeOf`) apart from `showSyncNotice`.
import { t } from '../../ui/i18n.js';
import { showNotice } from '../../ui/notice.js';
import { failKey } from './sync-card.js';

const KEYS = {
  'cloud-failed': ['sync.noteCloudFailed', 'bad'],
  'cloud-refused': ['sync.noteCloudRefused', 'bad'],
  'cloud-toobig': ['sync.noteTooBig', 'bad'],
  'cloud-recovered': ['sync.noteRecovered', 'ok'],
  'meet-failed': ['sync.noteMeetFailed', 'bad'],
};

// event -> { key, kind, text } or null. `tr` is the app's translation.
export function noticeOf(event, tr) {
  if (event.kind === 'link-failed') {
    return { key: 'sync-link', kind: 'bad', text: tr(failKey(event.reason)) };
  }
  const entry = KEYS[event.kind];
  if (!entry) {
    return null;
  }
  const group = event.kind.startsWith('cloud') ? 'sync-cloud' : 'sync-meet';
  return { key: group, kind: entry[1], text: tr(entry[0]) };
}

export function showSyncNotice(event) {
  const notice = noticeOf(event, t);
  if (notice) {
    const ms = notice.kind === 'ok' ? 5000 : 12000;
    showNotice({ ...notice, dismiss: t('sync.noteClose'), ms });
  }
}
