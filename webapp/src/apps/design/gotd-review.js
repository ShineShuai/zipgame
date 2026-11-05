// The design app's "GOTD review" panel: plays the pending candidates of the automatic Game of Day (tools/gotd-gen.mjs, demo/GameOfDay-queue/) blind, one after the
// other, and records what the reviewer rates them. The rating decides (Hard or more approves, see core/gotd-verdict.js); what the trap model said is never shown.
//
// Data: <queue>/index.json and <queue>/verdicts.json are read from the site the page is served from (the repository root: `python3 -m http.server` there, then open
// webapp/design.html); the reviewer's verdicts are kept in this browser (zip_gotd_verdicts). "Export verdicts.json" downloads the repository's verdicts merged with the
// local ones: put it at demo/GameOfDay-queue/verdicts.json, commit it, run `node tools/gotd-gen.mjs promote`. (A later step will write them back by itself.)
//
// main.js gives the panel what it cannot do alone (host): show(text) puts a puzzle on the board, play() starts Play mode, state() = { elapsed, length, total }, stopPlay().
// main.js tells the panel what happens on the board: onEnter() when Play starts, onPlay({ length, finished }) after every change of the path.
import { genStamp } from '../../core/gotd-gen.js';
import { parseIndex } from '../../core/gotd-queue.js';
import {
  APPROVE_MIN, GRADE_NAMES, parseVerdicts, formatVerdicts, mergeVerdicts, reviewQueue, makeVerdict, nextSelection, nextLean, toggleUnsure, createTakebacks, decide,
} from '../../core/gotd-verdict.js';
import { ratingFromSelection, describeRating } from '../../core/ratings-io.js';
import { pickStorage } from '../../platform/storage.js';

export const VERDICTS_KEY = 'zip_gotd_verdicts';
export const QUEUE_URL = '../demo/GameOfDay-queue/';

function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const isoNow = d => d.toISOString().slice(0, 19) + 'Z';

export function mountGotdReview(root, host, { fetchFn = (...a) => fetch(...a), now = () => new Date(), storage = pickStorage, base = QUEUE_URL, download = downloadText } = {}) {
  let index = null, repo = [], local = [], phase = 'idle', current = null, solved = false, playS = 0, sel = null, loaded = false;
  const skipped = new Set(), takebacks = createTakebacks();
  root.innerHTML = `
    <div class="gr-line" data-el="counts">Not loaded.</div>
    <div class="gr-row">
      <button type="button" class="diff-log-btn" data-act="load" title="Read demo/GameOfDay-queue/index.json and verdicts.json from the site this page is served from">Load queue</button>
      <button type="button" class="diff-log-btn" data-act="next" title="Put the next candidate on the board and start Play mode; its grade is not shown">Review next ▶</button>
    </div>
    <label class="gr-check"><input type="checkbox" data-el="reserve"> also candidates of days that already have an approved one</label>
    <div class="gr-now" data-el="now"></div>
    <div class="gr-row" data-el="playBtns" style="display:none">
      <button type="button" class="diff-log-btn" data-act="giveup" title="Stop here: rate how hard it was, it counts as not solved">I give up</button>
      <button type="button" class="diff-log-btn" data-act="skip" title="Leave this candidate for later">Skip</button>
    </div>
    <div class="gr-rate" data-el="rate" style="display:none">
      <div class="diff-rate" data-el="grades">${GRADE_NAMES.map((n, g) => `<button type="button" class="diff-rate-btn" data-grade="${g}" title="${g} ${n}">${g}</button>`).join('')}
        <span class="diff-rate-lean" data-el="lean" style="display:none">closer to <button type="button" class="diff-lean-btn" data-lean="-1"></button><button type="button" class="diff-lean-btn" data-lean="1"></button></span>
        <button type="button" class="diff-unsure-btn" data-act="unsure" title="Mark the rating as unsure">unsure</button></div>
      <div class="diff-rate-text" data-el="rateText"></div>
      <div class="gr-row"><button type="button" class="diff-log-btn" data-act="save" disabled>Save verdict &amp; next</button></div>
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
  const queue = () => (index ? reviewQueue(index, merged(), genStamp(), { reserve: el('reserve').checked }).filter(c => !skipped.has(c.id)) : []);

  function paint() {
    const q = queue(), approved = merged().filter(v => v.verdict === 'approve').length;
    el('counts').textContent = !loaded ? 'Not loaded.' : `${q.length} to review · ${merged().length} verdicts (${approved} approved) · ${unsent()} not in the repository's verdicts.json yet`;
    act('next').disabled = !loaded || phase === 'playing' || phase === 'rating';
    el('playBtns').style.display = phase === 'playing' ? '' : 'none';
    el('rate').style.display = phase === 'rating' ? '' : 'none';
    root.querySelectorAll('.diff-rate-btn').forEach(b => b.classList.toggle('sel', !!sel && +b.dataset.grade >= sel.lo && +b.dataset.grade <= sel.hi));
    const pair = !!sel && sel.hi - sel.lo === 1;
    el('lean').style.display = pair ? '' : 'none';
    if (pair) root.querySelectorAll('.diff-lean-btn').forEach(b => { const d = +b.dataset.lean; b.textContent = d < 0 ? sel.lo : sel.hi; b.classList.toggle('sel', sel.lean === d); });
    act('unsure').classList.toggle('sel', !!sel && !!sel.unsure);
    act('save').disabled = !sel;
    if (sel) { const r = ratingFromSelection(sel); el('rateText').textContent = `Rated ${describeRating(r)}${sel.unsure ? ' · unsure' : ''} → ${decide(r) === 'approve' ? 'approve' : 'reject'} (Hard = ${APPROVE_MIN} or more approves)`; } else el('rateText').textContent = `How hard was it? ${solved ? 'You solved it' : 'You gave up'} in ${playS.toFixed(1)} s.`;
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

  async function load() {
    say('Loading…');
    try {
      const it = await getText('index.json'), vt = await getText('verdicts.json', true);
      index = parseIndex(it); repo = vt ? parseVerdicts(vt) : [];
      await loadLocal();
      loaded = true; phase = 'idle'; current = null;
      say(`Queue loaded (generator stamp ${genStamp()}).`);
    } catch (e) {
      loaded = false; index = null;
      say(`No queue found: ${e.message}. Serve the repository root (python3 -m http.server there), open webapp/design.html from it, and run node tools/gotd-gen.mjs fill first.`);
    }
    el('now').textContent = '';
    paint();
  }

  async function next(saved = '') { // `saved`: what to say first (the verdict that was just saved)
    const c = queue()[0], tell = text => say(`${saved} ${text}`.trim());
    if (!c) { phase = 'idle'; current = null; el('now').textContent = ''; tell(loaded ? 'Nothing left to review.' : 'Load the queue first.'); paint(); return; }
    tell('');
    try {
      const text = await getText(c.file);
      host.show(text);
      current = c; solved = false; playS = 0; sel = null; phase = 'playing';
      takebacks.reset();
      host.play();
      el('now').textContent = `Reviewing day ${c.slot} · ${c.size}×${c.size} (${queue().length} to review). Solve it, then rate it.`;
    } catch (e) { tell(`Cannot load ${c.file}: ${e.message}`); phase = 'idle'; current = null; }
    paint();
  }

  function finish(wasSolved) {
    solved = wasSolved; playS = host.state().elapsed; sel = null; phase = 'rating'; paint();
  }

  async function save() {
    if (!current || !sel) return;
    const v = makeVerdict({ candidate: current, sel, solved, playS, takebacks: takebacks.total, now: isoNow(now()) });
    local = mergeVerdicts(local, [v]);
    await saveLocal();
    sel = null; phase = 'idle'; current = null;
    await next(`Saved: ${v.verdict} (rated ${v.human}).`);
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.grade !== undefined && phase === 'rating') { sel = nextSelection(sel, +b.dataset.grade); paint(); return; }
    if (b.dataset.lean !== undefined && phase === 'rating') { sel = nextLean(sel, +b.dataset.lean); paint(); return; }
    switch (b.dataset.act) {
      case 'load': await load(); break;
      case 'next': await next(); break;
      case 'skip': if (current) { skipped.add(current.id); host.stopPlay(); phase = 'idle'; current = null; el('now').textContent = ''; await next(); } break;
      case 'giveup': if (phase === 'playing') { const t = host.state().elapsed; host.stopPlay(); finish(false); playS = t; paint(); } break;
      case 'unsure': if (phase === 'rating') { sel = toggleUnsure(sel); paint(); } break;
      case 'save': await save(); break;
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
