// The design app's "GOTD review" panel: plays the pending candidates of the automatic Game of Day (tools/gotd-gen.mjs, demo/GameOfDay-queue/) blind, one after the
// other, in the order of the open days they would fill (planReview of core/gotd-queue.js), and records what the reviewer decides: Approve or Reject by the button, with a
// rating (optional; Hard or more only suggests approve, see core/gotd-verdict.js) or Skip. What the trap model said is never shown.
//
// Data: <queue>/index.json and <queue>/verdicts.json are read from the site the page is served from (the repository root: `python3 -m http.server` there, then open
// webapp/design.html), and so is which days already have a file (HEAD requests on ../demo/GameOfDay/YYYYMMDD.txt, today up to the horizon: a published day is never
// offered again); the reviewer's verdicts are kept in this browser (zip_gotd_verdicts). "Export verdicts.json" downloads the repository's verdicts merged with the
// local ones: put it at demo/GameOfDay-queue/verdicts.json, commit it, run `node tools/gotd-gen.mjs promote`. (A later step will write them back by itself.)
//
// main.js gives the panel what it cannot do alone (host): show(text) puts a puzzle on the board, play() starts Play mode, state() = { elapsed, length, total }, stopPlay().
// main.js tells the panel what happens on the board: onEnter() when Play starts, onPlay({ length, finished }) after every change of the path.
import { genStamp, GOTD_CFG } from '../../core/gotd-gen.js';
import { parseIndex, planReview } from '../../core/gotd-queue.js';
import { dateOfDay } from '../../core/gotd-schedule.js';
import {
  APPROVE_MIN, GRADE_NAMES, parseVerdicts, formatVerdicts, mergeVerdicts, makeVerdict, nextSelection, nextLean, toggleUnsure, createTakebacks, decide,
} from '../../core/gotd-verdict.js';
import { ratingFromSelection, describeRating } from '../../core/ratings-io.js';
import { pickStorage } from '../../platform/storage.js';

export const VERDICTS_KEY = 'zip_gotd_verdicts';
export const QUEUE_URL = '../demo/GameOfDay-queue/';
export const PUZZLES_URL = '../demo/GameOfDay/';
const utcDay = d => Math.floor(d.getTime() / 86400000);

function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const isoNow = d => d.toISOString().slice(0, 19) + 'Z';

export function mountGotdReview(root, host, { fetchFn = (...a) => fetch(...a), now = () => new Date(), storage = pickStorage, base = QUEUE_URL, puzzles = PUZZLES_URL, download = downloadText } = {}) {
  let index = null, repo = [], local = [], published = new Set(), phase = 'idle', current = null, solved = false, playS = 0, sel = null, loaded = false;
  const skipped = new Set(), takebacks = createTakebacks();
  root.innerHTML = `
    <div class="gr-line" data-el="counts">Not loaded.</div>
    <div class="gr-row">
      <button type="button" class="diff-log-btn" data-act="load" title="Read demo/GameOfDay-queue/index.json and verdicts.json from the site this page is served from">Load queue</button>
      <button type="button" class="diff-log-btn" data-act="next" title="Put the next candidate (for the earliest open day) on the board and start Play mode; its grade is not shown">Review next ▶</button>
    </div>
    <label class="gr-check"><input type="checkbox" data-el="reserve"> also candidates that no open day needs (last)</label>
    <div class="gr-now" data-el="now"></div>
    <div class="gr-row" data-el="playBtns" style="display:none">
      <button type="button" class="diff-log-btn" data-act="giveup" title="Stop here: rate how hard it was, it counts as not solved">I give up</button>
      <button type="button" class="diff-log-btn" data-act="skip" title="Leave this candidate for later (no verdict; it is offered again after a reload)">Skip</button>
    </div>
    <div class="gr-rate" data-el="rate" style="display:none">
      <div class="diff-rate" data-el="grades">${GRADE_NAMES.map((n, g) => `<button type="button" class="diff-rate-btn" data-grade="${g}" title="${g} ${n}">${g}</button>`).join('')}
        <span class="diff-rate-lean" data-el="lean" style="display:none">closer to <button type="button" class="diff-lean-btn" data-lean="-1"></button><button type="button" class="diff-lean-btn" data-lean="1"></button></span>
        <button type="button" class="diff-unsure-btn" data-act="unsure" title="Mark the rating as unsure">unsure</button></div>
      <div class="diff-rate-text" data-el="rateText"></div>
      <div class="gr-row">
        <button type="button" class="diff-log-btn" data-act="approve" title="Approve this candidate for the earliest open day of its size, whatever the rating">Approve ▶</button>
        <button type="button" class="diff-log-btn" data-act="reject" title="Reject this candidate (it moves to rejected/ at the next promote), whatever the rating">Reject ▶</button>
        <button type="button" class="diff-log-btn" data-act="skip" title="No verdict: leave this candidate for later (it is offered again after a reload)">Skip ▶</button></div>
    </div>
    <div class="gr-row">
      <button type="button" class="diff-log-btn" data-act="export" title="Download the repository's verdicts merged with yours as verdicts.json (put it at demo/GameOfDay-queue/verdicts.json)">Export verdicts.json</button>
      <button type="button" class="diff-log-btn" data-act="import" title="Merge a verdicts.json (e.g. from another browser) into the verdicts kept here">Import…</button>
      <input type="file" accept=".json,application/json" data-el="file" style="display:none">
    </div>
    <div class="diff-panel-time" data-el="msg"></div>`;
  const el = name => root.querySelector(`[data-el="${name}"]`), act = name => root.querySelector(`[data-act="${name}"]`);
  const say = text => { el('msg').textContent = text || ''; };

  const merged = () => mergeVerdicts(repo, local);
  const unsent = () => { const r = new Map(repo.map(v => [v.id, v])); return local.filter(v => { const o = r.get(v.id); return !o || o.at < v.at; }).length; };
  const today = () => utcDay(now());
  // the plan of the review: the candidates in the order of the open days they fill, the days still without an approved one, and which day an approved one gets
  const plan = () => (index ? planReview({ today: today(), published, index, verdicts: merged(), stamp: genStamp(), reserve: el('reserve').checked }) : { queue: [], open: [], plan: [] });
  const queue = () => plan().queue.filter(c => !skipped.has(c.id));

  function paint() {
    const q = queue(), approved = merged().filter(v => v.verdict === 'approve').length;
    el('counts').textContent = !loaded ? 'Not loaded.' : `${q.length} to review · ${plan().open.length} open day(s) without an approved one · ${merged().length} verdicts (${approved} approved) · ${unsent()} not in the repository's verdicts.json yet`;
    act('next').disabled = !loaded || phase === 'playing' || phase === 'rating';
    el('playBtns').style.display = phase === 'playing' ? '' : 'none';
    el('rate').style.display = phase === 'rating' ? '' : 'none';
    root.querySelectorAll('.diff-rate-btn').forEach(b => b.classList.toggle('sel', !!sel && +b.dataset.grade >= sel.lo && +b.dataset.grade <= sel.hi));
    const pair = !!sel && sel.hi - sel.lo === 1;
    el('lean').style.display = pair ? '' : 'none';
    if (pair) root.querySelectorAll('.diff-lean-btn').forEach(b => { const d = +b.dataset.lean; b.textContent = d < 0 ? sel.lo : sel.hi; b.classList.toggle('sel', sel.lean === d); });
    act('unsure').classList.toggle('sel', !!sel && !!sel.unsure);
    const took = `${solved ? 'You solved it' : 'You gave up'} in ${playS.toFixed(1)} s.`;
    if (sel) { const r = ratingFromSelection(sel); el('rateText').textContent = `Rated ${describeRating(r)}${sel.unsure ? ' · unsure' : ''}: suggests ${decide(r)} (Hard = ${APPROVE_MIN} or more). You decide.`; } else el('rateText').textContent = `${took} Rate how hard it was (optional), then Approve, Reject or Skip.`;
  }

  async function saveLocal() { try { const s = await storage(); await s.set(VERDICTS_KEY, formatVerdicts(local)); } catch { /* best effort, like every store here */ } }
  async function loadLocal() {
    try {
      const s = await storage(), r = await s.get(VERDICTS_KEY);
      local = r ? parseVerdicts(r.value) : [];
    } catch { local = []; }
  }
  async function getText(name, optional) {
    const r = await fetchFn(base + name, { cache: 'no-store' });
    if (!r.ok) { if (optional && r.status === 404) return null; throw new Error(`${base}${name}: HTTP ${r.status}`); }
    return r.text();
  }

  // The days from today up to the horizon that already have a file (a HEAD request each): a day that has one is never offered again.
  async function publishedDays() {
    const first = today(), found = new Set();
    await Promise.all(Array.from({ length: GOTD_CFG.horizon }, async (_, i) => {
      const date = dateOfDay(first + i), r = await fetchFn(`${puzzles}${date}.txt`, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) found.add(date); else if (r.status !== 404) throw new Error(`${puzzles}${date}.txt: HTTP ${r.status}`);
    }));
    return found;
  }

  async function load() {
    say('Loading…');
    try {
      const it = await getText('index.json'), vt = await getText('verdicts.json', true);
      index = parseIndex(it); repo = vt ? parseVerdicts(vt) : [];
      published = await publishedDays();
      await loadLocal();
      skipped.clear();
      loaded = true; phase = 'idle'; current = null;
      say(`Queue loaded (generator stamp ${genStamp()}).`);
    } catch (e) {
      loaded = false; index = null; published = new Set();
      say(`No queue found: ${e.message}. Serve the repository root (python3 -m http.server there), open webapp/design.html from it, and run node tools/gotd-gen.mjs fill first.`);
    }
    el('now').textContent = '';
    paint();
  }

  async function next(saved = '') { // `saved`: what to say first (the verdict that was just saved)
    const c = queue()[0], tell = text => say(`${saved} ${text}`.trim());
    if (!c) { phase = 'idle'; current = null; el('now').textContent = ''; tell(!loaded ? 'Load the queue first.' : `Nothing left to review.${plan().open.length ? ' Days without an approved candidate are left: run node tools/gotd-gen.mjs fill.' : ''}`); paint(); return; }
    tell('');
    try {
      const text = await getText(c.file);
      host.show(text);
      current = c; solved = false; playS = 0; sel = null; phase = 'playing';
      takebacks.reset();
      host.play();
      el('now').textContent = `Reviewing for day ${c.date || '(no open day needs it)'} · ${c.size}×${c.size} (${queue().length} to review). Solve it, then decide.`;
    } catch (e) { tell(`Cannot load ${c.file}: ${e.message}`); phase = 'idle'; current = null; }
    paint();
  }

  function finish(wasSolved) {
    solved = wasSolved; playS = host.state().elapsed; sel = null; phase = 'rating'; paint();
  }

  // The reviewer's decision: the rating (if any) is recorded with it, but only the button decides.
  async function decideNow(verdict) {
    if (!current || phase !== 'rating') return;
    const v = makeVerdict({ candidate: current, sel, verdict, solved, playS, takebacks: takebacks.total, now: isoNow(now()) });
    local = mergeVerdicts(local, [v]);
    await saveLocal();
    const day = v.verdict === 'approve' ? plan().plan.find(p => p.id === v.id)?.date : null;
    sel = null; phase = 'idle'; current = null;
    await next(`Saved: ${v.verdict}${v.human !== undefined ? ` (rated ${v.human})` : ' (unrated)'}${v.verdict === 'approve' ? ` for day ${day || '(no open day of its size yet)'}` : ''}.`);
  }

  function skip() {
    if (!current) return Promise.resolve();
    skipped.add(current.id); host.stopPlay(); phase = 'idle'; current = null; sel = null; el('now').textContent = '';
    return next('Skipped.');
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.grade !== undefined && phase === 'rating') { sel = nextSelection(sel, +b.dataset.grade); paint(); return; }
    if (b.dataset.lean !== undefined && phase === 'rating') { sel = nextLean(sel, +b.dataset.lean); paint(); return; }
    switch (b.dataset.act) {
      case 'load': await load(); break;
      case 'next': await next(); break;
      case 'skip': await skip(); break;
      case 'giveup': if (phase === 'playing') { const t = host.state().elapsed; host.stopPlay(); finish(false); playS = t; paint(); } break;
      case 'unsure': if (phase === 'rating') { sel = toggleUnsure(sel); paint(); } break;
      case 'approve': await decideNow('approve'); break;
      case 'reject': await decideNow('reject'); break;
      case 'export': {
        const all = merged();
        if (!all.length) { say('No verdicts yet.'); break; }
        download(formatVerdicts(all), 'verdicts.json');
        say(`Exported ${all.length} verdicts. Put the file at demo/GameOfDay-queue/verdicts.json, commit it, then run: node tools/gotd-gen.mjs promote`);
        break;
      }
      case 'import': el('file').click(); break;
      default: break;
    }
  });
  el('reserve').addEventListener('change', paint);
  el('file').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const list = parseVerdicts(await f.text());
      const before = local.length;
      local = mergeVerdicts(local, list);
      await saveLocal();
      say(`Imported ${list.length} verdicts (${local.length - before} new).`);
    } catch (err) { say(err.message); }
    e.target.value = '';
    paint();
  });

  paint();
  return {
    load,
    onEnter() { takebacks.reset(); },
    // After every change of the play path: count the cells taken back; a solved board ends the play and opens the rating; a rewind off it goes back to playing.
    onPlay({ length, finished }) {
      if (phase === 'playing' || phase === 'rating') takebacks.note(length);
      if (phase === 'playing' && finished) finish(true);
      else if (phase === 'rating' && solved && !finished) { phase = 'playing'; paint(); }
    },
    get phase() { return phase; },
  };
}
