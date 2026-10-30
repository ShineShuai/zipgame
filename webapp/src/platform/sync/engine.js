// The device sync of one device: its identity, the slices of the other devices (core/sync),
// and the group's view of every synced key. It talks to no network: the transports
// (a channel to another device, a server) call refresh(), have(), slicesFor() and receive().
//
// OFF BY DEFAULT. A device that never enabled sync has no identity (no `zip_sync` key), view()
// hands every read back unchanged, and wrap() adds nothing: the app behaves as if this file
// did not exist. Only enable() (the player's choice) creates an identity and a device id.
//
// Kept on the device, and never synced themselves:
//   zip_sync    { v, dev, seq, digest, p2p, cloud, secret }  who this device is and what is on
//   zip_sync_f  { v, slices: { dev: { seq, keys } } }        the other devices' latest slices
// `seq` counts the changes of this device's own copy; `digest` says which copy `seq` stands for,
// so that a page load without a change does not make a new slice.
import { fromBase64Url, toBase64Url } from '../../core/sync/base64.js';
import { MERGES, SYNCED_KEYS } from '../../core/sync/merge.js';
import { isDev, isSlice, newDevId } from '../../core/sync/slice.js';
import { newSecret, SECRET_BYTES } from '../../core/sync/words.js';

export const IDENTITY_KEY = 'zip_sync';
export const FOREIGN_KEY = 'zip_sync_f';
export const MAX_DEVICES = 4; // this device and the others
const FOREIGN_JSON_MAX = 600000; // characters of the others' slices that are written to storage

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const natural = value => Number.isInteger(value) && value >= 0;
const byDev = (a, b) => (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0);

// FNV-1a over the text, and its length: a change is told from no change by this.
function digestOf(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function validSecret(text) {
  try {
    return fromBase64Url(text).length === SECRET_BYTES;
  } catch {
    return false;
  }
}

const validIdentity = value => isObject(value) && value.v === 1 && isDev(value.dev)
  && natural(value.seq) && typeof value.digest === 'string'
  && typeof value.p2p === 'boolean' && typeof value.cloud === 'boolean'
  && (value.secret === null || validSecret(value.secret));

// The synced keys of a slice, each cleaned by its rule; what is not one of ours is dropped.
function cleanKeys(keys) {
  const clean = {};
  for (const key of SYNCED_KEYS) {
    const value = isObject(keys) && keys[key] !== undefined ? MERGES[key].clean(keys[key]) : null;
    if (value) {
      clean[key] = value;
    }
  }
  return clean;
}

// storage: the app's storage port (platform/storage.js). maxDevices: the group's size limit.
export function createSync({ storage, maxDevices = MAX_DEVICES }) {
  let id = null; // the identity record; null = sync was never enabled on this device
  let own = { seq: 0, keys: {} }; // this device's copy as of the last refresh()
  const foreign = new Map(); // dev -> { seq, keys }
  const changeListeners = new Set();
  const localListeners = new Set();
  let chain = Promise.resolve(); // one storage change at a time

  const read = async key => {
    try {
      const stored = await storage.get(key);
      return stored ? JSON.parse(stored.value) : null;
    } catch {
      return null;
    }
  };
  const write = async (key, value) => {
    try {
      return await storage.set(key, JSON.stringify(value));
    } catch {
      return false;
    }
  };
  const queued = fn => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  const enabled = () => id !== null && (id.p2p || id.cloud);
  const emit = () => changeListeners.forEach(fn => fn());
  const saveId = () => write(IDENTITY_KEY, id);
  const saveForeign = async () => {
    const value = { v: 1, slices: Object.fromEntries(foreign) };
    if (JSON.stringify(value).length <= FOREIGN_JSON_MAX) {
      await write(FOREIGN_KEY, value);
    }
  };
  const ownSlice = () => (id && own.seq > 0
    ? { v: 1, dev: id.dev, seq: own.seq, keys: own.keys } : null);

  return {
    // Loads the identity and the slices kept for the others (nothing for a device that never
    // enabled sync).
    async init() {
      id = null;
      own = { seq: 0, keys: {} };
      foreign.clear();
      const stored = await read(IDENTITY_KEY);
      if (!validIdentity(stored)) {
        return;
      }
      id = stored;
      const kept = await read(FOREIGN_KEY);
      if (!isObject(kept) || kept.v !== 1 || !isObject(kept.slices)) {
        return;
      }
      for (const [dev, slice] of Object.entries(kept.slices)) {
        if (isDev(dev) && dev !== id.dev && isObject(slice) && natural(slice.seq)
          && foreign.size + 1 < maxDevices) {
          foreign.set(dev, { seq: slice.seq, keys: cleanKeys(slice.keys) });
        }
      }
    },

    enabled,
    status: () => ({
      enabled: enabled(),
      p2p: Boolean(id && id.p2p),
      cloud: Boolean(id && id.cloud),
      dev: id ? id.dev : null,
      devices: id ? foreign.size + 1 : 0,
    }),

    // The player's choice. mode = { p2p?: true, cloud?: true }: turns that way on (the first
    // call makes the device id; cloud also makes the group's secret, when there is none).
    enable: mode => queued(async () => {
      id ??= { v: 1, dev: newDevId(), seq: 0, digest: '', p2p: false, cloud: false, secret: null };
      id.p2p ||= Boolean(mode && mode.p2p);
      if (mode && mode.cloud) {
        id.cloud = true;
        id.secret ??= toBase64Url(newSecret());
      }
      await saveId();
      emit();
    }),
    // Turns ways off (no argument: all of them). The others' slices stay on the device but
    // stop counting while sync is off; leave() removes them.
    disable: mode => queued(async () => {
      if (!id) {
        return;
      }
      id.p2p = mode ? id.p2p && !mode.p2p : false;
      id.cloud = mode ? id.cloud && !mode.cloud : false;
      await saveId();
      emit();
    }),
    // Back to never having enabled sync: identity and the others' slices are gone.
    leave: () => queued(async () => {
      id = null;
      own = { seq: 0, keys: {} };
      foreign.clear();
      try {
        await storage.remove(IDENTITY_KEY);
        await storage.remove(FOREIGN_KEY);
      } catch { /* nothing kept, nothing to remove */ }
      emit();
    }),

    // The group's secret (10 bytes) for the cloud, or null.
    secret: () => (id && id.secret ? fromBase64Url(id.secret) : null),
    // Joins the group of a secret typed in (core/sync/words.js). Another group's slices are
    // dropped: this device's own data stays and is offered to the new group.
    adoptSecret: bytes => queued(async () => {
      if (!id || !(bytes instanceof Uint8Array) || bytes.length !== SECRET_BYTES) {
        return false;
      }
      id.secret = toBase64Url(bytes);
      id.cloud = true;
      foreign.clear();
      await saveId();
      await saveForeign();
      emit();
      return true;
    }),

    // What the group says for `key`, given this device's own parsed copy (null = none). Without
    // sync, or without slices of other devices, `local` comes back as it is.
    view(key, local) {
      const rule = MERGES[key];
      if (!rule || !enabled() || foreign.size === 0) {
        return local;
      }
      const entries = [];
      const mine = local === null || local === undefined ? null : rule.clean(local);
      if (mine) {
        entries.push({ dev: id.dev, value: mine });
      }
      for (const [dev, slice] of foreign) {
        if (slice.keys[key]) {
          entries.push({ dev, value: slice.keys[key] });
        }
      }
      if (!entries.some(entry => entry.dev !== id.dev)) {
        return local;
      }
      return rule.view(entries.sort(byDev), id.dev);
    },

    // A storage port that tells onLocalChange when a synced key is written. Writes go to the
    // port as before, and nothing is told while sync is off.
    wrap: base => ({
      ...base,
      async set(key, value) {
        const stored = await base.set(key, value);
        if (stored && MERGES[key] && enabled()) {
          localListeners.forEach(fn => fn(key));
        }
        return stored;
      },
    }),
    onChange(fn) { // the group's view may have changed: slices came, or sync was turned on or off
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    onLocalChange(fn) { // a synced key of this device was written (after wrap())
      localListeners.add(fn);
      return () => localListeners.delete(fn);
    },

    // Reads this device's own copy; a change since the last time makes `seq` one higher.
    // -> the slice to offer, or null while there is nothing yet.
    refresh: () => queued(async () => {
      if (!id) {
        return null;
      }
      const keys = {};
      for (const key of SYNCED_KEYS) {
        const raw = await read(key);
        const value = raw === null ? null : MERGES[key].clean(raw);
        if (value) {
          keys[key] = value;
        }
      }
      const digest = digestOf(keys);
      if (digest !== id.digest) {
        if (id.seq > 0 || Object.keys(keys).length) {
          id.seq += 1; // an empty copy is not worth a slice until there is something in it
        }
        id.digest = digest;
        await saveId();
      }
      own = { seq: id.seq, keys };
      return ownSlice();
    }),

    // The newest slice of every device this one knows: { dev: seq }.
    have() {
      const have = Object.fromEntries([...foreign].map(([dev, slice]) => [dev, slice.seq]));
      return id ? { ...have, [id.dev]: own.seq } : have;
    },
    // The slices (this device's own and the others') that a device holding `have` lacks.
    slicesFor(have) {
      const known = dev => (isObject(have) && natural(have[dev]) ? have[dev] : 0);
      const list = [];
      const mine = ownSlice();
      if (mine && known(mine.dev) < mine.seq) {
        list.push(mine);
      }
      for (const [dev, slice] of foreign) {
        if (known(dev) < slice.seq) {
          list.push({ v: 1, dev, seq: slice.seq, keys: slice.keys });
        }
      }
      return list;
    },
    // Takes slices that came from another device: only newer ones, only while the group has room.
    // -> { accepted, ignored }
    receive: slices => queued(async () => {
      const list = Array.isArray(slices) ? slices : [];
      let accepted = 0;
      if (enabled()) {
        for (const slice of list) {
          const known = isSlice(slice) ? foreign.get(slice.dev) : null;
          const fits = known || foreign.size + 1 < maxDevices;
          const newer = !known || known.seq < slice.seq;
          if (isSlice(slice) && slice.dev !== id.dev && fits && newer) {
            foreign.set(slice.dev, { seq: slice.seq, keys: cleanKeys(slice.keys) });
            accepted++;
          }
        }
      }
      if (accepted) {
        await saveForeign();
        emit();
      }
      return { accepted, ignored: list.length - accepted };
    }),
  };
}
