// The unlockable variants: the lucky game's chance chip and tip, its box in the menu and its result line.
import { dateOfDay } from '../../features/daily.js';
import { dateLabel } from '../../features/share.js';
import { variantIcon } from './icons.js';
import { weekTable, weekOf } from '../../core/lucky.js';
import { getLang, t } from '../../ui/i18n.js';
import { S, solid, unlock } from './state.js';
import { ICON, weekday } from './menu-kit.js';

export const unlockView = () => (unlock ? unlock.view() : null);
const luckyDate = day => { const d = dateOfDay(day); return `${weekday(d)} ${dateLabel(d)}`; };
const peakText = n => new Intl.NumberFormat(getLang() === 'zh' ? 'zh-CN' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

// The (i) next to the lucky game: how the lucky day is chosen, with the seven days of the week of the open offer (else of
// the next lucky day) and their Collatz peaks (the winner is marked in the row, and named in the lucky box).
function luckyTipHtml(v) {
  const rows = weekTable(weekOf(v.open ? v.offer : v.nextLucky));
  const dayName = r => { const d = dateOfDay(r.day); return `${weekday(d)} ${+d.slice(6)}`; };
  const cells = rows.map(r => `<span class="${r.lucky ? 'win' : ''}"><b>${dayName(r)}</b><small>${peakText(r.peak)}</small></span>`);
  return `<button type="button" class="tip-btn" id="luckyTip" aria-expanded="false" aria-label="${t('lucky.how')}">i</button>
      <span class="tip-pop" id="luckyTipPop" role="tooltip"><b>${t('lucky.how')}</b><br>${t('lucky.howText')}<br>${t('lucky.week', luckyDate(rows[0].day), luckyDate(rows[6].day))}<span class="lucky-week">${cells.join('')}</span></span>`;
}

// The "1 unlock chance" chip of the lucky box. It has its own popover (hover or focus; a bottom sheet on touch): what an unlock
// chance is and how to get one; the (i) beside it is about the lucky day only.
const chanceChipHtml = v => `<button type="button" class="lucky-chances has-tip${v.tokens > 0 ? ' has' : ''}" id="luckyChance" aria-expanded="false">`
  + `${ICON.unlock}${t('lucky.chances', v.tokens)}`
  + `<span class="tip-pop" id="luckyChancePop" role="tooltip">${t('unlock.tip.chance')} ${t('unlock.tip.streak')}</span></button>`;

// A streak reward to claim: a replay chance or an unlock chance (only a replay once every variant is unlocked).
function rewardRowHtml(v) {
  const unlockButton = v.allUnlocked ? '' : `<button class="btn" id="rewardUnlock">${t('reward.unlock')}</button>`;
  return `
    <div class="lucky-row reward">
      <div class="lucky-text"><b>${t('reward.title')}</b><small>${t('reward.pick')}</small></div>
      <div class="reward-buttons"><button class="btn secondary" id="rewardReplay">${t('reward.replay')}</button>${unlockButton}</div>
    </div>`;
}

// Top of the free-play card, one block: a streak reward to claim (replay or unlock chance), and the lucky game with the
// unlock chances the player holds. The lucky game is open to everyone until the next lucky day; once played, the date of
// the next one.
export function luckyBoxHtml() {
  const v = unlockView();
  if (!v) return '';
  const rows = [];
  if (S.luckyNote) rows.push(`<p class="note error">${t(S.luckyNote)}</p>`);
  if (v.choices > 0) rows.push(rewardRowHtml(v));
  if (!v.allUnlocked) {
    const text = v.open ? t(v.tokens > 0 ? 'lucky.readyChance' : 'lucky.readyFun', luckyDate(v.offerLast))
      : t('lucky.used', v.daysToNext, luckyDate(v.nextLucky));
    const play = v.open ? `<button class="btn" id="playLucky">${t('lucky.play')}</button>` : '';
    rows.push(`
    <div class="lucky-row">
      <span class="lucky-icon">${variantIcon('lucky')}</span>
      <div class="lucky-text">
        <span class="lucky-head"><b>${t('lucky.title')}</b>${chanceChipHtml(v)}</span>
        <small>${text}</small>
      </div>
      ${luckyTipHtml(v)}${play}
    </div>`);
  }
  return rows.length ? `<div class="lucky-box${v.open && !v.allUnlocked ? ' ready' : ''}">${rows.join('')}</div>` : '';
}

// Under the game after a solve: what the lucky game unlocked (or why not), a streak reward to claim.
export function luckyGameHtml(done = S.finished) {
  if (!done) return '';
  const parts = [], r = S.luckyResult, v = unlockView();
  if (r && r.solved) {
    const newKey = solid.isKind(r.id) ? 'lucky.unlockedSolid' : 'lucky.unlocked';
    const key = r.newly ? newKey : unlock.unlocked(r.id) ? 'lucky.already' : 'lucky.noChance';
    parts.push(`<div class="lucky-result${r.newly ? '' : ' same'}">${variantIcon(r.id)}<span>${t(key, t('mode.' + r.id))}</span></div>`);
  }
  if (S.healed) parts.push(`<div class="lucky-result heal"><span>${t('streak.healed')}</span></div>`);
  if (v && v.choices > 0) parts.push(rewardRowHtml(v));
  return parts.join('');
}
