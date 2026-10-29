// The info panel of the offer days: the public rule (src/themes/calendar.js) in a bottom sheet
// (src/ui/info.js). The offer sheet and the theme picker both open it. `text(key, ...args)` is the
// app's translation.
import { ruleExample } from '../themes/calendar.js';
import { ruleHtml } from '../themes/offer.js';
import { openSheet } from './info.js';

export const showThemeRule = text => openSheet({
  title: text('theme.rule.title'),
  html: ruleHtml(text, ruleExample()),
  closeText: text('sheet.close'),
});
