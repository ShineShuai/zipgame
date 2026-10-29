// Tests of the offer days (src/themes/calendar.js): the rule, the draw of 1-2 days a month, the
// spread over the month, the offer day of a local date, and what a player can learn from the
// days. Registered by tests.js.
import {
  MIN_GAP, candidates, dateValue, daysInMonth, eventAt, monthPlan, ruleExample, validDigits,
} from '../src/themes/calendar.js';
import { EVENT_RE } from '../src/themes/event.js';
import { offerHtml, ruleHtml } from '../src/themes/offer.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { THEMES } from '../src/config.js';

const DIGITS = [2, 1, 9, 0];
const SYMBOL = '<circle cx="12" cy="12" r="5"/>';
const RULE_KEYS = ['offer.rule', 'rule.open', 'rule.title', 'rule.lead', 'rule.step1',
  'rule.step2', 'rule.step3', 'rule.step4', 'rule.example', 'rule.last']
  .map(key => `theme.${key}`);
const keyText = (key, ...args) => (args.length ? `${key}(${args})` : key);
const fill = dict => (key, ...args) => String(dict[key]).replace(/\{(\d+)\}/g, (_, i) => args[i]);
const YEARS = Array.from({ length: 100 }, (_, i) => 2026 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// every month of 100 years: [{ year, month, plan }]
const calendar = () => YEARS.flatMap(year => MONTHS.map(month => ({
  year, month, plan: monthPlan(year, month, DIGITS),
})));

// the candidates of every month of 2027, as the rule gives them (a regression table)
const CANDIDATES_2027 = [
  [4, 6, 7, 15, 20, 22, 23, 31],
  [4, 5, 7, 12, 20, 21, 23, 28],
  [4, 5, 6, 13, 20, 21, 22, 29],
  [1, 2, 3, 10, 17, 18, 19, 26],
  [2, 3, 11, 16, 18, 19, 27],
  [1, 3, 8, 16, 17, 19, 24],
  [1, 2, 9, 16, 17, 18, 25],
  [6, 13, 14, 15, 22, 29, 30, 31],
  [7, 12, 14, 15, 23, 28, 30],
  [4, 12, 13, 15, 20, 28, 29, 31],
  [5, 12, 13, 14, 21, 28, 29, 30],
  [2, 9, 10, 11, 18, 25, 26, 27],
];

export function themeCalendarTests(t, ok, eq) {
  t('offer days: the value of a date is day ^ month ^ the year\'s last digit, mod 16', () => {
    eq(dateValue(2027, 11, 29), 1, '29 ^ 11 ^ 7 = 17, mod 16 = 1');
    eq(dateValue(2027, 3, 6), 2);
    eq(dateValue(2027, 3, 29), 9);
    eq(dateValue(2027, 11, 28), 0, '28 ^ 11 ^ 7 = 16, mod 16 = 0');
    eq(dateValue(2027, 11, 5), 9);
    eq(dateValue(2027, 11, 29), dateValue(2037, 11, 29), 'the year counts by its last digit');
  });

  t('offer days: the candidates of a month are the days whose value is a secret digit', () => {
    eq(MONTHS.map(month => candidates(2027, month, DIGITS)), CANDIDATES_2027);
    for (const { year, month } of calendar()) {
      const days = candidates(year, month, DIGITS);
      for (let day = 1; day <= daysInMonth(year, month); day++) {
        const wanted = DIGITS.includes(dateValue(year, month, day));
        ok(days.includes(day) === wanted, `${year}-${month}-${day}`);
      }
    }
    eq(candidates(2027, 11, [0, 1, 2, 9]), candidates(2027, 11, [9, 2, 1, 0]), 'order is free');
  });

  t('offer days: every month has 7-8 candidates, and a candidate for every digit', () => {
    for (const { year, month } of calendar()) {
      const days = candidates(year, month, DIGITS);
      ok(days.length >= 7 && days.length <= 8, `${year}-${month}: ${days.length}`);
      const seen = new Set(days.map(day => dateValue(year, month, day)));
      eq([...seen].sort(), [0, 1, 2, 9], `${year}-${month}: every digit can be shown`);
    }
  });

  t('offer days: the candidates change with the month and with the year', () => {
    eq(new Set(CANDIDATES_2027.map(days => days.join())).size, 12, 'twelve different months');
    const nov = year => candidates(year, 11, DIGITS).join();
    eq(new Set([2026, 2027, 2028, 2029, 2030].map(nov)).size, 5, 'five different years');
    eq(nov(2027), nov(2037), 'ten years later the year digit comes round');
  });

  t('offer days: the draw of a month: one day, or two at least MIN_GAP days apart', () => {
    eq(monthPlan(2027, 3, DIGITS), [6, 29], 'a month with two');
    eq(monthPlan(2027, 11, DIGITS), [29], 'a month with one');
    eq(monthPlan(2027, 3, DIGITS), monthPlan(2027, 3, DIGITS), 'the same every time');
    let events = 0;
    let months = 0;
    let twice = 0;
    for (const { year, month, plan } of calendar()) {
      const days = candidates(year, month, DIGITS);
      ok(plan.length === 1 || plan.length === 2, `${year}-${month}`);
      ok(plan.every(day => days.includes(day)), `${year}-${month}: only candidates`);
      if (plan.length === 2) {
        ok(plan[1] - plan[0] >= MIN_GAP, `${year}-${month}: ${plan}`);
        twice++;
      }
      events += plan.length;
      months++;
    }
    ok(events / months > 1.15 && events / months < 1.35, `mean ${events / months}`);
    ok(twice / months > 0.15 && twice / months < 0.35, `twice ${twice / months}`);
  });

  t('offer days: the days are spread over the whole month', () => {
    const thirds = [0, 0, 0];
    let events = 0;
    for (const { plan } of calendar()) {
      for (const day of plan) {
        thirds[day <= 10 ? 0 : day <= 20 ? 1 : 2]++;
        events++;
      }
    }
    for (const count of thirds) {
      ok(count / events > 0.25 && count / events < 0.4, `${thirds}`);
    }
  });

  t('offer days: the offer day of a local date; the id names the event', () => {
    const early = eventAt(new Date(2027, 10, 29, 0, 0, 0), DIGITS);
    const late = eventAt(new Date(2027, 10, 29, 23, 59, 59), DIGITS);
    eq(early, { id: 'd20271129', year: 2027, month: 11, day: 29 });
    eq(late, early, 'the whole local day');
    eq(eventAt(new Date(2027, 10, 28, 12), DIGITS), null);
    eq(eventAt(new Date(2027, 10, 30, 12), DIGITS), null);
    eq(eventAt(new Date(2027, 2, 6, 12), DIGITS).id, 'd20270306');
    eq(eventAt(new Date(2027, 2, 29, 12), DIGITS).id, 'd20270329');
    const ids = new Set();
    for (const { year, month, plan } of calendar()) {
      for (const day of plan) {
        const event = eventAt(new Date(year, month - 1, day, 12), DIGITS);
        ok(event && EVENT_RE.test(event.id), `${year}-${month}-${day}`);
        ids.add(event.id);
      }
    }
    eq(ids.size, calendar().reduce((sum, c) => sum + c.plan.length, 0), 'one id for each day');
  });

  t('offer days: without four different digits nothing is offered', () => {
    ok(validDigits(DIGITS) && validDigits([0, 1, 2, 9]));
    for (const bad of [[2, 1, 9], [2, 1, 9, 9], [2, 1, 9, 10], [2, 1, 9, -1], [2, 1, 9, 0.5],
      null, undefined, 'x']) {
      ok(!validDigits(bad), `${bad}`);
      eq(eventAt(new Date(2027, 10, 29, 12), bad), null);
    }
    ok(validDigits(THEMES.digits), 'the config has four different digits');
  });

  t('offer days: a player who sees every offer day learns all four digits, in time', () => {
    const months = calendar();
    let worst = 0;
    for (let start = 0; start + 60 < months.length; start++) {
      const seen = new Set();
      let used = 0;
      while (seen.size < 4) {
        const { year, month, plan } = months[start + used];
        for (const day of plan) seen.add(dateValue(year, month, day));
        used++;
      }
      eq([...seen].sort(), [0, 1, 2, 9]);
      worst = Math.max(worst, used);
    }
    ok(worst <= 30, `worst ${worst} months`);
  });

  t('offer days: the rule text has a worked example that is computed, and is no offer day', () => {
    const example = ruleExample();
    eq(example, {
      date: '2031-06-27', day: 27, month: 6, last: 1, first: 29, xor: 28, value: 12,
    });
    eq(example.value, dateValue(2031, 6, 27));
    ok(example.value > 9, 'a value of 10 or more is no digit');
    ok(!monthPlan(2031, 6, DIGITS).includes(27));
  });

  t('offer days: the offer sheet states the public rule and opens the info panel', () => {
    const theme = { name: 'Candy', symbol: SYMBOL, swatches: [] };
    const sheet = offerHtml({ theme, left: '1:00' }, keyText);
    ok(sheet.includes('theme.offer.rule') && sheet.includes('data-offer="rule"'), 'in the trial');
    ok(offerHtml({ theme, phase: 'final' }, keyText).includes('data-offer="rule"'), 'when over');
    const replacing = offerHtml({ theme, replace: [] }, keyText);
    ok(!replacing.includes('data-offer="rule"'), 'not when replacing');
    ok(sheet.includes('data-offer="keep"') && sheet.includes('data-offer="leave"'), 'still there');
  });

  t('offer days: the info panel tells the rule, in both languages, and never the digits', () => {
    const example = ruleExample();
    for (const dict of [EN, ZH]) {
      for (const key of RULE_KEYS) ok(typeof dict[key] === 'string' && dict[key], key);
      const html = ruleHtml(fill(dict), example);
      eq((html.match(/<li>/g) || []).length, 4, 'four steps');
      ok(html.includes('2031-06-27') && html.includes('27 ⊕ 6 = 29'), 'the worked example');
      ok(html.includes('29 ⊕ 1 = 28') && html.includes('12'), 'and its steps');
      ok(html.includes('110 ⊕ 011 = 101 = 5'), 'the XOR example');
      ok(dict['theme.offer.rule'].includes('16') && dict['theme.rule.step3'].includes('16'));
    }
    const bits = n => n.toString(2).padStart(3, '0');
    eq([bits(6), bits(3), bits(6 ^ 3)], ['110', '011', '101']);
    const hostile = ruleHtml(() => '<b>x</b>', example);
    ok(!hostile.includes('<b>x'), 'the texts are escaped');
  });
}
