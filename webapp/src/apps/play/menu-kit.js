// Small pieces the menu, lucky, gift and replay screens share: the weekday label and the icons of the status panel.
import { getLang } from '../../ui/i18n.js';
import { gift, replay, unlock } from './state.js';

export const weekday = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short', timeZone: 'UTC' });

// The icons of the status panel and the gift and lucky rows (one inline SVG each).
export const ICON = {
  replay: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg>',
  flame: '<svg class="stat-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 2 2 1 0-2-.5-4 1-6z"/></svg>',
  unlock: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.5-1.5"/></svg>',
  gift: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M12 9v11M3.5 13.5h17M12 9C9 9 7.5 7.5 8 6s3-1 4 3zM12 9c3 0 4.5-1.5 4-3s-3-1-4 3z"/></svg>',
  snow: '<svg class="freeze-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>',
};
