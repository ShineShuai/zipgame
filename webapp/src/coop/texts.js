import { getLang } from '../ui/i18n.js';

// The texts of the trial, in both languages. Kept here (not in ui/i18n.js) so that the trial can
// be removed as one folder; the language is the app's (getLang). {0}, {1} ... are filled by tx().
export const EN = {
  pill: 'Free draw (trial)',
  title: 'Free draw',
  trial: 'trial',
  exit: 'Exit',
  help: 'Drag across cells to draw lines. Lift your finger and start anywhere. Drag back along a '
    + 'line from its end to erase it, or press and hold on a line to cut it. Join all the lines '
    + 'into one path from 1 to the last number, covering every cell.',
  cut: 'Line cut. Undo brings it back.',
  size: 'Board size',
  cells: '{0}×{0}',
  start: 'Start',
  generating: 'Making a puzzle… {0}%',
  undo: 'Undo',
  clear: 'Clear',
  hint: 'Hint',
  hintsLeft: 'Hint ({0} left)',
  noHints: 'No hints left.',
  time: 'Time',
  solved: 'Solved in {0}!',
  penalty: '{0} incl. +{1} for {2} hint(s)',
  stats: 'This size: best {0}, average {1}, {2} game(s).',
  again: 'New puzzle',
  blocked: 'A wall or the border is in the way.',
  degree: 'That cell already has all its lines.',
  cycle: 'That would close a loop.',
  order: 'The numbers would be out of order.',
  gap: 'That would skip a number in between.',
  hintWrong: 'This line is not part of the solution.',
  hintNext: 'Try this line.',
  failed: 'The puzzle could not be made. Try again.',
  leaveTitle: 'Leave this game?',
  leaveBody: 'The lines you have drawn will be lost.',
  stay: 'Keep playing',
  leave: 'Leave',
};

export const ZH = {
  pill: '自由画线（试验）',
  title: '自由画线',
  trial: '试验',
  exit: '退出',
  help: '拖动画线，可随时抬手并从任意位置重新开始。从线的末端沿线拖回去即可擦除，'
    + '或长按某条线将其剪断。把所有线连成一条从 1 到最大数字、覆盖每个格子的路径。',
  cut: '已剪断这条线，可撤销。',
  size: '棋盘大小',
  cells: '{0}×{0}',
  start: '开始',
  generating: '正在生成… {0}%',
  undo: '撤销',
  clear: '清空',
  hint: '提示',
  hintsLeft: '提示（剩 {0} 次）',
  noHints: '没有提示次数了。',
  time: '用时',
  solved: '完成，用时 {0}！',
  penalty: '{0}（含提示 {2} 次的 +{1}）',
  stats: '本尺寸：最佳 {0}，平均 {1}，共 {2} 局。',
  again: '新题',
  blocked: '有墙或边界挡住了。',
  degree: '该格的线已经满了。',
  cycle: '这样会形成环。',
  order: '数字顺序不对。',
  gap: '这样会跳过中间的数字。',
  hintWrong: '这条线不在答案中。',
  hintNext: '试试这条线。',
  failed: '生成失败，请重试。',
  leaveTitle: '离开这局？',
  leaveBody: '已画的线将会丢失。',
  stay: '继续游戏',
  leave: '离开',
};

const DICTS = { en: EN, zh: ZH };

export function tx(key, ...args) {
  const text = DICTS[getLang()]?.[key] ?? EN[key] ?? key;
  return text.replace(/\{(\d+)\}/g, (_, index) => args[index]);
}
