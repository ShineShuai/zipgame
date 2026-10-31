// The cloud way of the device sync (option C): the devices of a group meet through a server,
// without having to be open at the same time. The group's secret (the sync phrase) makes an
// id, an auth value and a key (core/sync/cloud-keys.js); each device keeps ONE sealed slice on
// the servers and reads the others'. A server holds ciphertext it cannot open.
//
// backends: [primary, second] (cloud/backends.js): a push goes to both, a pull asks both and
// merges what opens, so one that is down, full or lacks permission costs nothing while the
// other answers. Nothing that comes back is trusted: a row opens with this group's key and
// this device id of the row, or it is skipped (junk on a public table is expected).
//
// Nothing here runs by itself: the page calls sync() (on start, when it is shown again),
// push() (after a change, not more often than minPushMs) and erase().
import { toBase64Url } from '../../core/sync/base64.js';
import {
  DATA_MAX, deriveCloudKeys, KDF_ITERATIONS, openFromText, sealToText,
} from '../../core/sync/cloud-keys.js';
import { SHRINKS } from '../../core/sync/merge.js';
import { packSlice, unpackSlice } from '../../core/sync/slice.js';

export const PUSH_MIN_MS = 60000;

export function createCloud({
  sync, backends, now = () => Date.now(), iterations = KDF_ITERATIONS, minPushMs = PUSH_MIN_MS,
}) {
  let keys = null; // { text, id, auth, key } of the secret in use
  const seen = new Map(); // backend name -> { dev: seq } of the rows it already gave
  const held = new Map(); // backend name -> the seq of this device's slice that it holds
  const listeners = new Set();
  const state = { lastOk: 0, lastPush: 0, error: null, backends: {} };
  let running = null;

  const emit = event => listeners.forEach(fn => fn(event));
  const available = () => backends.length > 0;
  const on = () => available() && sync.enabled() && sync.cloudOn();
  const note = (backend, error) => {
    state.backends[backend.name] = error
      ? { ok: false, error: error.code || 'network', at: now() } : { ok: true, at: now() };
  };

  // The keys of the secret in use; PBKDF2 runs once per secret.
  async function keysNow() {
    const secret = sync.secret();
    if (!secret) {
      return null;
    }
    const text = toBase64Url(secret);
    if (!keys || keys.text !== text) {
      keys = { text, ...(await deriveCloudKeys(secret, iterations)) };
      seen.clear();
      held.clear();
    }
    return keys;
  }

  // What one backend has that is new: the slices that open, newest row of each device first.
  async function pullFrom(backend, k, self) {
    const known = seen.get(backend.name) || {};
    const rows = (await backend.get({ id: k.id, have: known })).sort((a, b) => b.seq - a.seq);
    const slices = [];
    const done = new Set();
    for (const row of rows) {
      if (done.has(row.dev)) {
        continue;
      }
      const bytes = await openFromText(k.key, k.id, row.dev, row.data);
      const slice = bytes && await unpackSlice(bytes);
      if (!slice || slice.dev !== row.dev) {
        continue; // not ours: junk, or sealed for another device
      }
      done.add(row.dev);
      known[row.dev] = row.seq;
      if (slice.dev === self) {
        held.set(backend.name, slice.seq);
      } else {
        slices.push(slice);
      }
    }
    seen.set(backend.name, known);
    return slices;
  }

  const api = {
    available,
    on,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status: () => ({
      on: on(),
      lastOk: state.lastOk,
      error: state.error,
      busy: running !== null,
      backends: Object.fromEntries(Object.entries(state.backends).map(([k, v]) => [k, { ...v }])),
    }),

    // Reads the servers and takes the other devices' slices. -> { accepted, ok, failed }
    async pull() {
      const k = on() && await keysNow();
      if (!k) {
        return { accepted: 0, ok: 0, failed: 0 };
      }
      const self = sync.status().dev;
      const results = await Promise.allSettled(backends.map(b => pullFrom(b, k, self)));
      const slices = [];
      results.forEach((result, i) => {
        note(backends[i], result.status === 'rejected' ? result.reason : null);
        if (result.status === 'fulfilled') {
          slices.push(...result.value);
        }
      });
      const { accepted } = await sync.receive(slices);
      const ok = results.filter(r => r.status === 'fulfilled').length;
      return { accepted, ok, failed: results.length - ok };
    },

    // Puts this device's slice on every server that lacks its newest version.
    // force: even soon after the last push (not more often than minPushMs otherwise).
    // keepalive: the page is closing; let the request finish. -> { ok, failed, skipped? }
    async push({ force = false, keepalive = false } = {}) {
      const k = on() && await keysNow();
      if (!k) {
        return { ok: 0, failed: 0, skipped: 'off' };
      }
      if (!force && now() - state.lastPush < minPushMs) {
        return { ok: 0, failed: 0, skipped: 'soon' };
      }
      const slice = await sync.refresh();
      if (!slice) {
        return { ok: 0, failed: 0, skipped: 'empty' };
      }
      const targets = backends.filter(b => (held.get(b.name) || 0) < slice.seq);
      if (!targets.length) {
        return { ok: 0, failed: 0, skipped: 'current' };
      }
      const bytes = await packSlice(slice, { shrink: SHRINKS });
      const data = bytes && await sealToText(k.key, k.id, slice.dev, bytes);
      if (!data || data.length > DATA_MAX) {
        state.error = 'toobig';
        return { ok: 0, failed: targets.length, skipped: 'toobig' };
      }
      state.lastPush = now();
      const results = await Promise.allSettled(targets.map(b => b.put({
        id: k.id, auth: k.auth, dev: slice.dev, seq: slice.seq, data, keepalive,
      })));
      let ok = 0;
      results.forEach((result, i) => {
        note(targets[i], result.status === 'rejected' ? result.reason : null);
        if (result.status === 'fulfilled') {
          held.set(targets[i].name, slice.seq);
          ok += 1;
        }
      });
      return { ok, failed: targets.length - ok };
    },

    // Pull, then push: one at a time (a second call while one runs gets the same answer).
    // -> { accepted, pushed, ok } where ok says that some server answered.
    sync(options) {
      if (!on()) {
        return Promise.resolve({ accepted: 0, pushed: 0, ok: false });
      }
      running ??= (async () => {
        emit({ type: 'cloud', state: 'syncing' });
        try {
          const pulled = await api.pull();
          const pushed = await api.push(options);
          const ok = pulled.ok > 0 || pushed.ok > 0;
          state.error = ok ? null : (Object.values(state.backends)[0] || {}).error || 'network';
          if (ok) {
            state.lastOk = now();
          }
          emit({ type: 'cloud', state: ok ? 'ok' : 'failed', error: state.error });
          return { accepted: pulled.accepted, pushed: pushed.ok, ok };
        } catch (error) {
          state.error = (error && error.code) || 'network';
          emit({ type: 'cloud', state: 'failed', error: state.error });
          return { accepted: 0, pushed: 0, ok: false };
        } finally {
          running = null;
        }
      })();
      return running;
    },

    // Deletes the cloud copy where the server lets a player do it (Supabase), then forgets the
    // secret and turns the cloud way off. A server that cannot delete (Turso: the public token
    // may only add) keeps ciphertext nobody can open any more, until tools/sync-prune.mjs
    // removes it. If a server that can delete cannot be reached, nothing is forgotten.
    // -> { forgotten, servers: [{ name, removed, reason? }] }
    async erase() {
      const k = await keysNow();
      const servers = [];
      for (const backend of k ? backends : []) {
        if (!backend.remove) {
          servers.push({ name: backend.name, removed: false, reason: 'expires' });
          continue;
        }
        try {
          servers.push({
            name: backend.name, removed: await backend.remove({ id: k.id, auth: k.auth }),
          });
        } catch (error) {
          servers.push({ name: backend.name, removed: false, reason: error.code || 'network' });
        }
      }
      // a server that held nothing (removed: false, no reason) or cannot delete is no obstacle
      const forgotten = servers.every(s => !s.reason || s.reason === 'expires');
      if (forgotten) {
        await sync.forgetSecret();
        keys = null;
        seen.clear();
        held.clear();
        state.lastOk = 0;
        state.error = null;
      }
      return { forgotten, servers };
    },
  };
  return api;
}
