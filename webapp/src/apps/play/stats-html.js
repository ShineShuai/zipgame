// The stats tables under a play page.
import { statSummary } from '../../core/stats.js';
import { scopeKey } from '../../features/daily.js';
import { dateLabel } from '../../features/share.js';
import { touchUI } from '../../ui/info.js';
import { t } from '../../ui/i18n.js';
import { S, SIZES, dayNo, sec, store } from './state.js';
import { gameNo, scopeSizes } from './counters.js';
import { sizeLabel } from './puzzle-kit.js';

// "today / total" cells for one size (today = current UTC day).
function statCells(n, scope = '') {
  const total = store.total(n, scope);
  const today = store.today(n, dayNo(), scope);
  const t = statSummary(total);
  const d = statSummary(today);
  const value = (summary, x) => (summary.n ? x.toFixed(1) : '-');
  const best = stat => (stat.recent.length ? Math.min(...stat.recent).toFixed(1) : '-');
  return {
    solves: `${d.n} / ${t.n}`,
    avg: `${value(d, d.mean)} / ${value(t, t.mean)}`,
    sd: `${value(d, d.sd)} / ${value(t, t.sd)}`,
    best: `${best(today)} / ${best(total)}`,
  };
}

// Stats are shown under the game being played, for its kind of puzzle (the menu shows none):
//   a standard puzzle (random or shared local game): the local stats of every grid size;
//   a Game of Day (live or replay): the Game of Day time of every grid size;
//   a variant (Cutout, One way arrows, the lucky game): its own local stats, per grid size, with its own daily counter.
// On narrow screens each row becomes a small card, so the cells carry their column name in data-label.
// A <details>: open on a desktop, folded on a phone until the player opens it (the choice is kept while the page lives).
const statsTable = (title, sub, head, rows) => `
    <details class="card play-stats" id="playStats"${(S.statsOpen ?? !touchUI()) ? ' open' : ''}>
      <summary>${title}</summary>
      <div class="stats-body">
        <p class="small">${sub}</p>
        <div class="table-scroll">
          <table class="responsive"><tr class="head-row">${head.map(key => `<th>${t(key)}</th>`).join('')}</tr>${rows}</table>
        </div>
      </div>
    </details>`;
const statsRow = (cells, keys, current) => `<tr${current ? ' class="current"' : ''}>${cells.map((value, i) =>
  `<td data-label="${t(keys[i])}">${i === 0 ? value : `<b>${value}</b>`}</td>`).join('')}</tr>`;

const LOCAL_HEAD = ['stats.grid', 'stats.next', 'stats.solves', 'stats.avg', 'stats.sd', 'stats.best']; // i18n keys
function localStatsHtml(scope = '') {
  const rows = scopeSizes(scope).filter(n => store.total(n, scope).n || S.nextIdx[scopeKey(n, scope)] || n === S.puzzle.n).map(n => {
    const c = statCells(n, scope);
    return statsRow([sizeLabel(scope, n), gameNo(n, scope), c.solves, c.avg, c.sd, c.best], LOCAL_HEAD, n === S.puzzle.n);
  }).join('');
  return statsTable(scope ? t('stats.variantTitle', t('mode.' + scope)) : t('stats.title'), t('stats.sub'), LOCAL_HEAD, rows);
}

const GOTD_HEAD = ['stats.grid', 'stats.date', 'stats.time'];
function gotdStatsHtml() {
  const rows = SIZES.filter(n => store.gotdBest(n) || n === S.puzzle.n).map(n => {
    const best = store.gotdBest(n);
    return statsRow([`${n}x${n}`, best ? dateLabel(best.date) : '-', best ? sec(best.time) : '-'], GOTD_HEAD, n === S.puzzle.n);
  }).join('');
  return statsTable(t('stats.gotdTitle'), t('stats.gotdSub'), GOTD_HEAD, rows);
}

export const playStatsHtml = () => (S.isGotd ? gotdStatsHtml() : localStatsHtml(S.variant || ''));
