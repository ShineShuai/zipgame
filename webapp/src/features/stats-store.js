import { newStat, updateStat } from '../core/stats.js';
import { scopeKey } from './daily.js';

// Persistent per-size stats (all-time "total" and per-UTC-day "today"), Game-of-Day best time and once-per-day attempt flag.
// Stats live in ONE key, zip_stats_v2 = { v: 2, t: { <scopeKey>: [n, mean, M2, recent] }, d: { <scopeKey>: [day, n, mean, M2, recent] },
// b: { <size>: [date, time] } } (t = totals, d = today's stats, b = Game-of-Day best). The old app kept three kinds of keys per size and variant
// (zip_local_stats_<k>, zip_today_stats_<k>, zip_gotd_best_<n>); they are converted on the first load and removed.
// A puzzle variant keeps its own stats (`scopes` = { id: [sizes] }, scopeKey = <id>_<n>); `scope` is that id, '' = standard.
// One attempt record per Game-of-Day date: { solved, time, sent?, stats? }. A date with no record is a date the player never played, i.e. one a replay may offer.
// The records live in ONE key, zip_gotd_v2 = { v: 2, a: { <date YYYYMMDD>: record } }, and only the last ATTEMPT_KEEP_DAYS days before the newest
// date in it are kept: a replay offers the last REPLAY_DAYS (90) days and a submit is retried only for those, so older records can never be read again.
// The old app kept one key per date forever (zip_gotd_attempt_<date>); they are converted on the first read (a record already in the blob wins).
export const attemptKey = date => 'zip_gotd_attempt_' + date;
export const GOTD_KEY = 'zip_gotd_v2', ATTEMPT_KEEP_DAYS = 120;
const dayOf = date => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 86400000;
const isRecord = r => r && typeof r === 'object' && typeof r.solved === 'boolean';
const parseGotd = text => { try { const b = JSON.parse(text); return b && b.v === 2 && b.a && typeof b.a === 'object' ? b : { v: 2, a: {} }; } catch { return { v: 2, a: {} }; } };
// Drops malformed date keys and every date more than ATTEMPT_KEEP_DAYS before `anchor` (a day number): the date just saved, or, for the
// conversion, the newest stored date capped at today (a record dated in the future, e.g. from a wrong clock, must not wipe the window).
function pruneAttempts(blob, anchor) {
  const horizon = anchor - ATTEMPT_KEEP_DAYS;
  for (const d of Object.keys(blob.a)) if (!/^\d{8}$/.test(d) || dayOf(d) < horizon) delete blob.a[d];
}
export const STATS_KEY = 'zip_stats_v2', LEGACY = { total: 'zip_local_stats_', today: 'zip_today_stats_', best: 'zip_gotd_best_' };
// `recent` (seconds, shown with one decimal) is kept to the millisecond; mean and M2 stay exact so the running statistics do not drift.
const ms3 = x => Math.round(x * 1000) / 1000;
const packStat = st => [st.n, st.mean, st.M2, st.recent.map(ms3)];
const unpackStat = a => (Array.isArray(a) && a.length === 4 && [a[0], a[1], a[2]].every(Number.isFinite) && Array.isArray(a[3]) ? { n: a[0], mean: a[1], M2: a[2], recent: a[3] } : null);
const unpackToday = a => { const st = Array.isArray(a) && Number.isFinite(a[0]) ? unpackStat(a.slice(1)) : null; return st && { day: a[0], stat: st }; };
const isStat = o => o && [o.n, o.mean, o.M2].every(Number.isFinite) && (o.recent === undefined || Array.isArray(o.recent)); // an old app's stat may lack `recent`
const fromLegacy = o => ({ n: o.n, mean: o.mean, M2: o.M2, recent: o.recent || [] });
const emptyBlob = () => ({ v: 2, t: {}, d: {}, b: {} });
const parseBlob = text => { try { const b = JSON.parse(text); return b && b.v === 2 && b.t && b.d && b.b ? b : emptyBlob(); } catch { return emptyBlob(); } };

// Every legacy key (known sizes and variants, plus any other left under the three prefixes) -> the v2 blob, or null when none exists.
// The same function backs the read-back check in migrate: it never throws on a damaged legacy value (that one is skipped).
async function convertLegacy(storage, known) {
  const blob = emptyBlob(), read = async k => { try { const r = await storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const names = new Set(storage.keys ? [] : known); // a port that can list its keys needs no probing of every size and variant
  if (storage.keys) for (const [kind, prefix] of Object.entries(LEGACY)) for (const k of await storage.keys(prefix)) names.add(kind + ':' + k.slice(prefix.length));
  let any = false;
  for (const name of names) {
    const [kind, id] = [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)], v = await read(LEGACY[kind] + id);
    if (v == null) continue;
    any = true;
    if (kind === 'total' && isStat(v)) blob.t[id] = packStat(fromLegacy(v));
    else if (kind === 'today' && v && Number.isFinite(v.day) && isStat(v.stat)) blob.d[id] = [v.day, ...packStat(fromLegacy(v.stat))];
    else if (kind === 'best' && v && v.date != null && Number.isFinite(v.time)) blob.b[id] = [v.date, v.time];
  }
  return { blob, any, names };
}

export function createStore(storage, sizes, scopes = {}) {
  const total = {}, today = {}, best = {}, attempts = {}; let attemptDate = null; // attempts: date -> record|null, every date loaded so far (today and replays)
  const get = async k => { try { const r = await storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } };
  // One read-modify-write at a time: the app calls recordSolve without awaiting it and recordGotd right after, and two overlapping
  // patches would each write a blob that lacks the other's change.
  let chain = Promise.resolve();
  const queued = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  // Read-modify-write of the blob, so a second tab's other scopes are not overwritten.
  const patch = fn => queued(async () => { try { const r = await storage.get(STATS_KEY), b = r ? parseBlob(r.value) : emptyBlob(); fn(b); await storage.set(STATS_KEY, JSON.stringify(b)); } catch { /* ignore */ } });
  const patchGotd = fn => queued(async () => { try { const r = await storage.get(GOTD_KEY), b = r ? parseGotd(r.value) : { v: 2, a: {} }; fn(b); await storage.set(GOTD_KEY, JSON.stringify(b)); } catch { /* ignore */ } });
  const allKeys = () => [...sizes.map(n => scopeKey(n, '')), ...Object.entries(scopes).flatMap(([id, ns]) => ns.map(n => scopeKey(n, id)))];
  // The conversion window (until 2026-10-29 or later): legacy keys -> blob, merged under what the blob already holds; the legacy keys go once it is read back.
  async function migrate() {
    const known = allKeys().flatMap(k => ['total:' + k, 'today:' + k]).concat(sizes.map(n => 'best:' + n));
    const { blob, any, names } = await convertLegacy(storage, known);
    if (!any) return;
    const r = await storage.get(STATS_KEY), cur = r ? parseBlob(r.value) : emptyBlob();
    for (const f of ['t', 'd', 'b']) blob[f] = { ...blob[f], ...cur[f] };
    const text = JSON.stringify(blob);
    if (!(await storage.set(STATS_KEY, text))) return;
    const back = await storage.get(STATS_KEY);
    if (!back || back.value !== text || !storage.remove) return;
    for (const name of names) await storage.remove(LEGACY[name.slice(0, name.indexOf(':'))] + name.slice(name.indexOf(':') + 1));
  }
  // The conversion window (until 2026-10-29 or later): zip_gotd_attempt_<date> keys -> the blob. `converted` stays false when the write was refused:
  // reads then fall back to the old keys, so a played date never looks missed, and the next page load tries again.
  let converting = null, converted = false;
  const convertAttempts = () => converting || (converting = (async () => {
    try {
      if (!storage.keys) return;
      const names = await storage.keys('zip_gotd_attempt_');
      if (!names.length) { converted = true; return; }
      const r = await storage.get(GOTD_KEY), blob = r ? parseGotd(r.value) : { v: 2, a: {} };
      for (const name of names) {
        const date = name.slice('zip_gotd_attempt_'.length), rec = await get(name);
        if (isRecord(rec) && !(date in blob.a)) blob.a[date] = rec;
      }
      const newest = Math.max(...Object.keys(blob.a).filter(d => /^\d{8}$/.test(d)).map(dayOf), -Infinity);
      pruneAttempts(blob, Math.min(newest, Date.now() / 86400000));
      const text = JSON.stringify(blob);
      if (!(await storage.set(GOTD_KEY, text))) return;
      const back = await storage.get(GOTD_KEY);
      if (!back || back.value !== text || !storage.remove) return;
      for (const name of names) await storage.remove(name);
      converted = true;
    } catch { /* the old keys stay and are read as before */ }
  })());
  const store = {
    async hydrate(dateStr) {
      try { await migrate(); } catch { /* the old keys stay; hydrate reads what the blob has */ }
      const r = await storage.get(STATS_KEY), b = r ? parseBlob(r.value) : emptyBlob();
      for (const k of allKeys()) { total[k] = unpackStat(b.t[k]) || newStat(); today[k] = unpackToday(b.d[k]); }
      for (const n of sizes) best[n] = b.b[n] ? { date: b.b[n][0], time: b.b[n][1] } : null;
      await store.hydrateAttempt(dateStr);
    },
    total: (n, scope) => total[scopeKey(n, scope)] || newStat(),
    today: (n, day, scope) => { const r = today[scopeKey(n, scope)]; return r && r.day === day ? r.stat : newStat(); },
    async recordSolve(n, day, time, scope) {
      const k = scopeKey(n, scope);
      total[k] = updateStat(total[k] || newStat(), time);
      today[k] = { day, stat: updateStat(store.today(n, day, scope), time) };
      // today's entries of earlier days can never be shown again: they go with this write
      await patch(b => { for (const id of Object.keys(b.d)) if (!Array.isArray(b.d[id]) || b.d[id][0] < day) delete b.d[id]; b.t[k] = packStat(total[k]); b.d[k] = [day, ...packStat(today[k].stat)]; });
    },
    gotdBest: n => best[n] || null,
    // pending: also submit to the averages backend (sent:false until it answers).
    // replay: the date is a past one; the per-size Game-of-Day time (b in the stats blob, shown in the menu table) belongs to the live game and stays as it is.
    async recordGotd(n, date, time, pending = false, replay = false) {
      if (!replay) { const prev = best[n]; if (!prev || prev.date !== date || prev.time > time) { best[n] = { date, time }; await patch(b => { b.b[n] = [date, time]; }); } }
      await store.saveAttempt(date, pending ? { solved: true, time, sent: false } : { solved: true, time });
    },
    attempt: () => attempts[attemptDate] || null, attemptDate: () => attemptDate, // today's record (as of the last hydrateAttempt)
    attemptOn: date => attempts[date] || null,                                     // any loaded date's record
    async loadAttempt(date) {
      await convertAttempts();
      const r = await storage.get(GOTD_KEY), rec = r ? parseGotd(r.value).a[date] : null;
      attempts[date] = isRecord(rec) ? rec : converted ? null : await get(attemptKey(date));
      return attempts[date];
    },
    async hydrateAttempt(date) { await store.loadAttempt(date); attemptDate = date; },
    async saveAttempt(date, a) {
      attempts[date] = a; await convertAttempts();
      await patchGotd(b => { b.a[date] = a; pruneAttempts(b, dayOf(date)); }); // read-modify-write: another tab's dates stay
    },
  };
  return store;
}
