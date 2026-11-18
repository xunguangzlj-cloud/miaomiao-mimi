'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTutorial } = require('../src/tutorial.js');
const { validateLevel, isComplete } = require('../src/logic.js');
const normalLevels = require('../src/levels.js');

function setup(dimensions) {
  dimensions = dimensions || {};
  let time = 1000, board, renderedLevel, buttons = [], done = 0, exits = 0;
  const w = dimensions.w || 390, h = dimensions.h || 844, top = (dimensions.safeTop || 0) + 14, bottom = h - (dimensions.safeBottom || 0) - 16;
  const ctx = new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => (target[key] = value, true) });
  const p = { now: () => time, storage: { get() { assert.fail('教学不能读正式存档'); }, set() { assert.fail('教学不能写正式存档'); } } };
  const helpers = {
    box() {}, text() {}, wrap() {}, cat() {}, cross() {},
    button(label, x, y, width, height, action) { buttons.push({ label, x, y, width, height, action }); },
    drawBoard(level, cats, marks, errors, x, y, size) {
      renderedLevel = level;
      const padding = size * 15 / (level.size * 108 + 30), grid = size - padding * 2;
      board = { x: x + padding, y: y + padding, size: grid, cell: grid / level.size, n: level.size };
    },
    getBoard: () => board
  };
  const tutorial = createTutorial({ p, ctx, w, h, top, bottom, helpers, onDone: () => { done++; }, onExit: () => { exits++; } });
  const render = () => { buttons = []; tutorial.render(); };
  const point = cell => ({ x: board.x + (cell % 4 + .5) * board.cell, y: board.y + (Math.floor(cell / 4) + .5) * board.cell });
  const send = (type, target) => tutorial.pointer({ type, ...(typeof target === 'number' ? point(target) : target), time }, buttons);
  const tap = cell => { send('down', cell); send('up', cell); };
  const double = cell => { tap(cell); time += 100; tap(cell); render(); };
  const click = label => {
    const b = buttons.find(button => button.label === label); assert.ok(b, label);
    const target = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    send('down', target); send('up', target); render();
  };
  tutorial.start(); render();
  return { tutorial, render, point, send, tap, double, click, advance: ms => { time += ms; }, buttons: () => buttons, level: () => renderedLevel, counts: () => ({ done, exits }), top, bottom, w };
}

function toMarks(env) { env.double(2); assert.equal(env.tutorial.getState().phase, 2); env.click('明白了'); }
function markFirstGroup(env) {
  env.send('down', 0); env.send('move', 3); env.send('up', 3);
  env.send('down', 6); env.send('move', 14); env.send('up', 14); env.render();
}
function toFree(env) {
  toMarks(env); markFirstGroup(env); env.double(13);
  env.send('down', 8); env.send('move', 12); env.send('up', 12); env.tap(9); env.render();
  env.double(4); assert.equal(env.tutorial.getState().phase, 7);
}

test('4×4七步完整流程、固定颜色与区域有效，完成只回调一次且正式60题保持不变', () => {
  const baseline = JSON.stringify(normalLevels), env = setup();
  assert.equal(validateLevel(env.level()), true); assert.equal(env.level().size, 4);
  assert.deepEqual(env.level().colorMap, ['#38A9C0', '#FA9D5C', '#8BD57D', '#D36F8F']);
  assert.deepEqual(env.tutorial.getState().cats, []); assert.deepEqual(env.tutorial.getState().marks, []);
  toMarks(env); assert.equal(env.tutorial.getState().phase, 3);
  markFirstGroup(env); assert.equal(env.tutorial.getState().phase, 4);
  assert.deepEqual(env.tutorial.getState().marks.slice().sort((a, b) => a - b), [0, 1, 3, 6, 10, 14]);
  env.double(13); assert.equal(env.tutorial.getState().phase, 5);
  env.tap(8); env.tap(9); env.tap(12); assert.equal(env.tutorial.getState().phase, 6);
  env.double(4); assert.equal(env.tutorial.getState().phase, 7);
  env.double(11); const state = env.tutorial.getState();
  assert.deepEqual(state.cats, [2, 13, 4, 11]); assert.equal(state.completed, true); assert.equal(state.hearts, 3);
  assert.equal(isComplete(env.level(), state.cats), true); assert.deepEqual(env.counts(), { done: 1, exits: 0 });
  env.double(11); assert.equal(env.counts().done, 1); assert.equal(JSON.stringify(normalLevels), baseline);
});

test('教学双击首次不画叉，第二次松手才放猫，窗口从首次松手起算', () => {
  const env = setup(); env.send('down', 2); env.advance(1000); env.send('up', 2);
  assert.deepEqual(env.tutorial.getState().marks, []); assert.deepEqual(env.tutorial.getState().cats, []);
  env.advance(350); env.send('down', 2); assert.equal(env.tutorial.getState().phase, 1);
  env.send('up', 2); assert.equal(env.tutorial.getState().phase, 2);
  const expired = setup(); expired.tap(2); expired.advance(350); expired.send('down', 2); expired.advance(1); expired.send('up', 2);
  assert.equal(expired.tutorial.getState().phase, 1); assert.deepEqual(expired.tutorial.getState().cats, []);
});

test('各限制阶段拒绝其他格，确认按钮才进入第三步，已标叉不允许擦除', () => {
  const env = setup(); env.double(1); assert.equal(env.tutorial.getState().phase, 1); assert.equal(env.tutorial.getState().hearts, 3);
  env.double(2); env.double(4); assert.equal(env.tutorial.getState().phase, 2);
  env.click('明白了'); env.send('down', 0); assert.deepEqual(env.tutorial.getState().marks, []);
  env.send('up', 0); env.tap(0); assert.deepEqual(env.tutorial.getState().marks, [0]);
  env.tap(5); assert.deepEqual(env.tutorial.getState().marks, [0]);
  env.send('down', 1); env.send('move', 3); env.send('up', 3); env.tap(6); env.tap(10); env.tap(14);
  assert.equal(env.tutorial.getState().phase, 4); env.double(4); assert.equal(env.tutorial.getState().phase, 4);
  env.double(13); env.tap(15); assert.equal(env.tutorial.getState().phase, 5); assert.ok(!env.tutorial.getState().marks.includes(15));
});

test('滑动只在移动时画允许格，取消回滚未提交标记及刚推进的阶段', () => {
  const env = setup(); toMarks(env);
  env.send('down', 0); assert.deepEqual(env.tutorial.getState().marks, []);
  env.send('move', 3); assert.deepEqual(env.tutorial.getState().marks, [0, 1, 3]);
  env.send('cancel', 3); assert.deepEqual(env.tutorial.getState().marks, []); assert.equal(env.tutorial.getState().phase, 3);
  env.send('down', 0); env.send('move', 3); env.send('up', 3);
  env.send('down', 6); env.send('move', 14); assert.equal(env.tutorial.getState().phase, 4);
  env.tutorial.cancel(); assert.equal(env.tutorial.getState().phase, 3); assert.deepEqual(env.tutorial.getState().marks, [0, 1, 3]);
  env.send('up', 14); assert.equal(env.tutorial.getState().phase, 3);
});

test('自由阶段允许画擦但误触不扣机会，只有最后答案格双击能完成', () => {
  const env = setup(); toFree(env);
  env.tap(5); assert.ok(env.tutorial.getState().marks.includes(5)); env.tap(5); assert.ok(!env.tutorial.getState().marks.includes(5));
  env.double(7); assert.equal(env.tutorial.getState().hearts, 3); assert.equal(env.tutorial.getState().completed, false);
  env.send('down', 5); env.send('move', 7); env.send('up', 7);
  assert.ok([5, 6, 7].every(cell => env.tutorial.getState().marks.includes(cell)));
  env.send('down', 5); env.send('move', 7); env.send('up', 7);
  assert.ok([5, 6, 7].every(cell => !env.tutorial.getState().marks.includes(cell)));
  env.double(11); assert.equal(env.tutorial.getState().completed, true); assert.equal(env.counts().done, 1);
});

test('取消或移出目标后松手不能放猫，取消也清双击窗口；跳过不标完成', () => {
  const env = setup(); env.tap(2); env.advance(100); env.send('down', 2); env.send('cancel', 2);
  assert.deepEqual(env.tutorial.getState().cats, []); env.tap(2); assert.equal(env.tutorial.getState().phase, 1);
  env.send('down', 2); env.send('move', 3); env.send('up', 2); assert.equal(env.tutorial.getState().phase, 1);
  env.tutorial.cancel(); env.send('down', 2); env.send('up', { x: 0, y: 0 }); assert.equal(env.tutorial.getState().phase, 1);
  env.click('跳过教学'); assert.deepEqual(env.counts(), { done: 0, exits: 1 }); assert.equal(env.tutorial.getState().completed, false);
  env.double(2); assert.equal(env.tutorial.getState().phase, 1);
  env.tutorial.start(); env.render(); env.double(2); assert.equal(env.tutorial.getState().phase, 2);
});

test('320×568与大屏的教学棋盘和确认/跳过按钮保持在安全区', () => {
  for (const dimensions of [{ w: 320, h: 568, safeTop: 80, safeBottom: 34 }, { w: 375, h: 667 }, { w: 390, h: 844, safeTop: 80, safeBottom: 34 }]) {
    const env = setup(dimensions); env.double(2);
    for (const b of env.buttons()) assert.ok(b.x >= 0 && b.x + b.width <= env.w && b.y >= env.top && b.y + b.height <= env.bottom, b.label);
    const board = env.tutorial.getState().board;
    assert.ok(board.x >= 0 && board.x + board.size <= env.w && board.y >= env.top && board.y + board.size <= env.bottom);
  }
});
