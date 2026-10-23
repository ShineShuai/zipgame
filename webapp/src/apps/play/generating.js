// The screen shown while a puzzle is made, and the note that stays after a run that failed or ran too long.
import { sizeArg } from '../../features/share.js';
import { variantIcon } from './icons.js';
import { isSolidKind } from './solid.js';
import { variantById } from './variants.js';
import { t } from '../../ui/i18n.js';
import { $, S } from './state.js';

// Players see only the percentage and the bar; the walls count and K appear while V is held.
function genDevInfo() {
  const gen = S.gen, genVariant = variantById(S.genMode);
  const walls = gen.walls == null ? t('gen.searching') : t(genVariant ? genVariant.countKey : 'gen.walls', gen.walls);
  return ` — ${walls}${gen.K == null ? '' : ` · K ${gen.K}`}`;
}

// The progress of a running generation, painted in place: a render() on every slice would rebuild the Cancel button under the
// finger, and a click on a button that is replaced between press and release never arrives.
export function paintGenerating() {
  const bar = $('genBar');
  if (S.screen !== 'generating' || !bar) return;
  const percent = Math.round(S.gen.frac * 100);
  bar.setAttribute('aria-valuenow', percent);
  bar.firstElementChild.style.width = `${percent}%`;
  $('genPercent').textContent = t('gen.progress', percent);
  $('genDev').textContent = genDevInfo();
}

// The note under the card head of the menu after a generation that failed or ran too long (a cancel leaves none).
export const genNoticeHtml = () => (S.genNotice ? `<p class="note error" role="alert">${t(S.genNotice)}</p>` : '');

export function renderGenerating() {
  const gen = S.gen;
  const percent = Math.round(gen.frac * 100);
  const genVariant = variantById(S.genMode);
  return `
    <div class="center-stage">
      <section class="card">
        <div class="gen-icon">${variantIcon(S.genMode)}</div>
        <h2 class="card-title">${t('gen.title')}</h2>
        <p class="small">${t(genVariant ? genVariant.keys.gen : isSolidKind(S.genMode) ? 'gen.subSolid' : 'gen.sub', sizeArg({ variant: S.genMode, n: S.size }))}</p>
        <div class="progress" id="genBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <div style="width:${percent}%"></div>
        </div>
        <p class="small"><span id="genPercent">${t('gen.progress', percent)}</span><span id="genDev" style="display:${S.showDev ? 'inline' : 'none'}">${genDevInfo()}</span></p>
        <div class="button-row"><button class="btn secondary" id="genCancel">${t('gen.cancel')}</button></div>
      </section>
    </div>`;
}
