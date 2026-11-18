'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const logic = require('../src/logic.js');
const KEY = 'miaoge-home-v1';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// 平台替身隔离真实文件、浏览器和微信接口，时间由测试显式推进。
function createMock(options) {
  options = options || {};
  let time = options.time || Date.UTC(2026, 9, 13, 8, 0);
  const store = options.store || new Map(), hooks = {}, frames = [], calls = [], vibration = [];
  if (!store.has(KEY)) store.set(KEY, { unlocked: 1, completed: {}, daily: {}, settings: { autoMark: false, vibrate: true }, session: null });
  if (options.inventory) {
    const stored = clone(store.get(KEY));
    stored.progression = Object.assign({}, stored.progression, { inventory: options.inventory });
    store.set(KEY, stored);
  }
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return value => {
        const size = Number.parseFloat((target.font || '14px').match(/[\d.]+px/)[0]);
        return { width: Array.from(String(value)).reduce((sum, char) => sum + size * (char.charCodeAt(0) > 255 ? 1 : .6), 0) };
      };
      return (...args) => { calls.push({ method: key, args }); };
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  const platform = {
    ctx, width: options.width || 390, height: options.height || 844,
    safeTop: options.safeTop || 0, safeBottom: options.safeBottom || 0,
    storage: { get: key => clone(store.get(key)), set: (key, value) => { store.set(key, clone(value)); return true; } },
    now: () => time,
    requestFrame: fn => { frames.push(fn); },
    onPointer: fn => { hooks.pointer = fn; },
    onHide: fn => { hooks.hide = fn; },
    onShow: fn => { hooks.show = fn; },
    vibrate: kind => { vibration.push(kind); }
  };
  const game = startGame({ platform });
  return {
    game, platform, store, calls, vibration,
    advance: ms => { time += ms; },
    hide: () => hooks.hide(), show: () => hooks.show(),
    pointer: (type, point) => hooks.pointer({ type, x: point.x, y: point.y, time }),
    frame: () => { const fn = frames.shift(); if (fn) fn(); }
  };
}

function load(env, id) { env.game.startLevel(id || 9); env.game.render(); return levels.find(l => l.id === (id || 9)); }
function solutionCells(level) { return level.solution.map((c, r) => r * level.size + c); }
function wrongCells(level) { const correct = solutionCells(level); return level.regions.map((v, c) => c).filter(c => !correct.includes(c)); }
function cellPoint(game, cell) {
  const board = game.getState().board;
  return { x: board.x + (cell % board.n + .5) * board.cell, y: board.y + (Math.floor(cell / board.n) + .5) * board.cell };
}
function tap(env, point) { env.pointer('down', point); env.pointer('up', point); }
function buttonPoint(game, label) {
  const button = game.getState().buttons.find(b => b.label === label);
  assert.ok(button, `存在按钮 ${label}`);
  return { x: button.x + button.width / 2, y: button.y + button.height / 2 };
}

test('答案格落猫并锁定，单击、再次落猫、撤销都不能删除正确猫', () => {
  const env = createMock(), level = load(env), good = solutionCells(level)[0], wrong = wrongCells(level)[0];
  assert.equal(env.game.placeCat(good), true);
  assert.equal(env.game.placeCat(good), false);
  env.game.toggleMark(good); env.game.undo();
  assert.deepEqual(env.game.getState().cats, [good]);
  env.game.render(); tap(env, cellPoint(env.game, good));
  assert.deepEqual(env.game.getState().cats, [good]);
  assert.equal(env.game.getState().hearts, 3);
  env.game.toggleMark(wrong); env.game.placeCat(solutionCells(level)[1]); env.game.undo();
  assert.equal(env.game.getState().cats.length, 2);
  assert.ok(env.game.getState().marks.includes(wrong));
  env.game.stop();
});

test('错误格扣一心并保留永久红叉，同格不重复扣心，三错失败且计时冻结', () => {
  const env = createMock(), level = load(env), wrong = wrongCells(level);
  env.game.toggleMark(wrong[0]); env.advance(1000); env.game.placeCat(wrong[0]);
  let state = env.game.getState();
  assert.equal(state.hearts, 2); assert.deepEqual(state.errors, [wrong[0]]); assert.ok(!state.marks.includes(wrong[0]));
  assert.equal(env.game.placeCat(wrong[0]), false);
  env.game.toggleMark(wrong[0]); env.game.undo();
  assert.deepEqual(env.game.getState().errors, [wrong[0]]);
  assert.equal(env.game.getState().hearts, 2);
  env.game.placeCat(wrong[1]); env.advance(750); env.game.placeCat(wrong[2]);
  state = env.game.getState();
  assert.equal(state.screen, 'fail'); assert.equal(state.hearts, 0); assert.equal(state.elapsed, 1750);
  assert.deepEqual(state.errors, wrong.slice(0, 3));
  env.advance(60000); env.game.hint(); env.game.undo(); env.game.toggleMark(wrong[3]);
  assert.equal(env.game.placeCat(solutionCells(level)[0]), false);
  assert.equal(env.game.getState().elapsed, 1750);
  assert.equal(env.store.get(KEY).session.hearts, 0);
  assert.deepEqual(env.store.get(KEY).session.errors, wrong.slice(0, 3));
  assert.equal(env.store.get(KEY).session.elapsed, 1750); assert.equal(env.store.get(KEY).unlocked, 1);
  env.game.stop();
});

test('普通叉支持逐步撤销，正确猫与错误红叉不进入撤销历史', () => {
  const env = createMock(), level = load(env), cell = wrongCells(level)[0];
  env.game.toggleMark(cell); assert.deepEqual(env.game.getState().marks, [cell]);
  env.game.toggleMark(cell); assert.deepEqual(env.game.getState().marks, []);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, [cell]);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, []);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, []);
  env.game.stop();
});

test('提示修复错误普通叉，并且全部 60 关可以通过提示完成而不损失心', () => {
  const env = createMock({ inventory: { hints: 3, helpers: 3 } }), level = load(env), good = solutionCells(level)[0];
  env.game.toggleMark(good); env.game.hint();
  assert.ok(env.game.getState().marks.includes(good)); assert.equal(env.game.getState().hints, 1);
  assert.equal(env.store.get(KEY).progression.inventory.hints, 2, '有效预览消耗一次库存');
  env.game.render(); assert.ok(env.game.getState().buttons.some(b => b.label === '应用'));
  env.game.hint();
  assert.ok(!env.game.getState().marks.includes(good));
  assert.equal(env.game.getState().cats.length, 0); assert.equal(env.game.getState().hints, 1);
  assert.equal(env.store.get(KEY).progression.inventory.hints, 2, '应用已付费的预览不重复消耗');
  for (const item of levels) {
    load(env, item.id);
    let steps = 0;
    while (env.game.getState().screen === 'play' && steps++ < item.size * item.size * 2) {
      if (env.game.getState().progression.inventory.hints === 0) env.advance(86400000);
      env.game.hint(); env.game.hint();
    }
    const state = env.game.getState();
    assert.equal(state.screen, 'win', `关卡 ${item.id} 可通过提示完成`);
    assert.equal(state.hearts, 3); assert.ok(logic.isComplete(item, state.cats));
    assert.equal(state.hints, steps); assert.equal(state.errors.length, 0);
  }
  assert.equal(env.store.get(KEY).unlocked, 60);
  env.game.stop();
});

test('预览提示不改变棋盘，手动标记和撤销取消旧提示；旧自动排除设置不影响手动通关', () => {
  const env = createMock(), level = load(env), good = solutionCells(level)[0], wrong = wrongCells(level)[0];
  env.game.toggleMark(good); env.game.hint(); env.game.render();
  assert.ok(env.game.getState().buttons.some(b => b.label === '应用'));
  assert.equal(env.game.getState().hints, 1); assert.equal(env.store.get(KEY).progression.inventory.hints, 2);
  env.game.toggleMark(wrong); env.game.hint();
  assert.ok(env.game.getState().marks.includes(good)); assert.equal(env.game.getState().hints, 2);
  assert.equal(env.store.get(KEY).progression.inventory.hints, 1, '关闭旧预览后再次查看继续扣次');
  env.game.undo(); env.game.hint();
  assert.ok(env.game.getState().marks.includes(good)); assert.equal(env.game.getState().hints, 3);
  assert.equal(env.store.get(KEY).progression.inventory.hints, 0);
  env.game.hint(); assert.ok(!env.game.getState().marks.includes(good));
  assert.equal(env.game.getState().hints, 3); assert.equal(env.store.get(KEY).progression.inventory.hints, 0);
  env.game.stop();
  const store = new Map([[KEY, { unlocked: 1, settings: { autoMark: true, vibrate: false } }]]), auto = createMock({ store });
  for (const item of levels) {
    load(auto, item.id);
    assert.deepEqual(auto.game.getState().marks, []);
    solutionCells(item).forEach(cell => auto.game.placeCat(cell));
    assert.equal(auto.game.getState().screen, 'win', `无自动排除时关卡 ${item.id} 可手动完成`);
    assert.deepEqual(auto.game.getState().marks, []);
    assert.equal(auto.game.getState().hearts, 3);
  }
  auto.game.stop();
});

test('通关保存成绩与解锁，重建控制器恢复档案，最佳时间不会被慢成绩覆盖', () => {
  const env = createMock(), level = load(env, 1);
  env.advance(1250); solutionCells(level).forEach(c => env.game.placeCat(c));
  assert.equal(env.game.getState().screen, 'win'); assert.equal(env.game.getState().elapsed, 1250);
  assert.equal(env.game.getState().unlocked, 2);
  assert.deepEqual(env.store.get(KEY).completed[1], { time: 1250, hints: 0, steps: level.size - (level.given || []).length, locates: 0, revives: 0, score: 5280 });
  assert.equal(env.store.get(KEY).session, null);
  env.advance(50000); assert.equal(env.game.getState().elapsed, 1250);
  const restored = createMock({ store: env.store });
  restored.game.resume(); assert.equal(restored.game.getState().levelId, 2); assert.equal(restored.game.getState().unlocked, 2);
  load(restored, 1); restored.advance(2000); solutionCells(level).forEach(c => restored.game.placeCat(c));
  assert.equal(restored.store.get(KEY).completed[1].time, 1250);
  assert.equal(restored.store.get(KEY).completed[1].score, 5280);
  env.game.stop(); restored.game.stop();
});

test('中途保存恢复猫、叉、红叉与心，后台和说明页时间不计入成绩', () => {
  const env = createMock(), level = load(env, 13), correct = solutionCells(level), wrong = wrongCells(level);
  env.game.placeCat(correct[0]); env.game.toggleMark(wrong[0]); env.advance(2345); env.game.placeCat(wrong[1]); env.game.stop();
  const restored = createMock({ store: env.store }); restored.game.resume();
  let state = restored.game.getState();
  assert.deepEqual(state.cats, [correct[0]]); assert.deepEqual(state.marks, [wrong[0]]);
  assert.deepEqual(state.errors, [wrong[1]]); assert.equal(state.hearts, 2); assert.equal(state.elapsed, 2345);
  restored.advance(1000); restored.hide(); restored.advance(10000);
  assert.equal(restored.game.getState().elapsed, 3345);
  restored.show(); restored.advance(2000); assert.equal(restored.game.getState().elapsed, 5345);
  restored.game.openPage('rules'); restored.advance(15000); assert.equal(restored.game.getState().elapsed, 5345);
  restored.game.switchScreen('play'); restored.advance(500); assert.equal(restored.game.getState().elapsed, 5845);
  restored.game.stop();
});

test('每日题同一天稳定，完成只记录每日成绩，跨日继续会放弃过期每日棋局', () => {
  const env = createMock(); env.game.dailyLevel();
  const id = env.game.getState().levelId, level = levels.find(l => l.id === id);
  env.game.dailyLevel(); assert.equal(env.game.getState().levelId, id); assert.equal(env.game.getState().daily, true);
  solutionCells(level).forEach(c => env.game.placeCat(c));
  assert.equal(env.game.getState().screen, 'win'); assert.equal(env.game.getState().unlocked, 1);
  assert.equal(Object.keys(env.store.get(KEY).daily).length, 1); assert.equal(Object.keys(env.store.get(KEY).completed).length, 0);
  env.game.dailyLevel(); env.game.stop();
  const restored = createMock({ store: env.store, time: env.platform.now() + 86400000 }); restored.game.resume();
  assert.equal(restored.game.getState().daily, false); assert.equal(restored.game.getState().levelId, 1);
  restored.game.stop();
});

test('单击打叉，350 毫秒内同格第二击落猫，351 毫秒不会误当双击', () => {
  const env = createMock(), level = load(env), good = solutionCells(level)[0], point = cellPoint(env.game, good);
  tap(env, point); assert.ok(env.game.getState().marks.includes(good)); assert.equal(env.game.getState().cats.length, 0);
  env.advance(350); tap(env, point); assert.ok(env.game.getState().cats.includes(good)); assert.ok(!env.game.getState().marks.includes(good));
  load(env); tap(env, point); env.advance(351); tap(env, point);
  assert.equal(env.game.getState().cats.length, 0); assert.ok(!env.game.getState().marks.includes(good));
  const wrong = wrongCells(level)[0], badPoint = cellPoint(env.game, wrong);
  env.advance(400); tap(env, badPoint); env.advance(50); tap(env, badPoint);
  assert.equal(env.game.getState().hearts, 2); assert.ok(env.game.getState().errors.includes(wrong));
  env.game.stop();
});

test('放猫模式单击有效，按钮取消或松开在按钮外不会切换模式', () => {
  const env = createMock(), level = load(env), catButton = buttonPoint(env.game, '猫  放置');
  env.pointer('down', catButton); env.pointer('cancel', catButton); assert.equal(env.game.getState().mode, 'mark');
  env.pointer('down', catButton); env.pointer('up', { x: 0, y: 0 }); assert.equal(env.game.getState().mode, 'mark');
  tap(env, catButton); assert.equal(env.game.getState().mode, 'cat');
  tap(env, cellPoint(env.game, solutionCells(level)[0])); assert.equal(env.game.getState().cats.length, 1);
  env.game.stop();
});

test('快速滑动插值填充所有经过格，一次撤销整笔；取消和隐藏都会回滚未完成笔画', () => {
  const env = createMock(); load(env);
  const from = cellPoint(env.game, 0), to = cellPoint(env.game, 4);
  env.pointer('down', from); env.pointer('move', to); env.pointer('up', to);
  assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, []);
  env.pointer('down', from); env.pointer('move', to); env.pointer('cancel', to);
  assert.deepEqual(env.game.getState().marks, []);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, []);
  [0, 1, 2, 3, 4].forEach(c => env.game.toggleMark(c));
  env.pointer('down', from); env.pointer('move', to); env.pointer('up', to);
  assert.deepEqual(env.game.getState().marks, []);
  env.game.undo(); assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  env.pointer('down', from); env.pointer('move', to); env.hide();
  assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  env.show(); env.pointer('up', to); env.pointer('down', from); env.pointer('cancel', from);
  assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  env.game.stop();
});

function assertLayout(env, description) {
  const state = env.game.getState(), p = env.platform;
  for (const button of state.buttons) {
    assert.ok(button.x >= 0 && button.x + button.width <= p.width, `${description} ${button.label} 横向可见`);
    assert.ok(button.y >= p.safeTop && button.y + button.height <= p.height - p.safeBottom, `${description} ${button.label} 处于安全区：${JSON.stringify(button)}`);
  }
  if (state.board) {
    const b = state.board;
    assert.ok(b.x >= 0 && b.x + b.size <= p.width && b.y >= p.safeTop && b.y + b.size <= p.height - p.safeBottom, `${description} 棋盘处于安全区`);
    assert.ok(b.cell >= 20, `${description} 格子至少 20 px，实际 ${b.cell}`);
    // 获胜和失败弹层覆盖原棋盘；正常棋盘页面仍严格检查按钮不遮挡棋格。
    if (!['win', 'fail'].includes(state.screen)) for (const button of state.buttons) {
      const overlap = button.x < b.x + b.size && button.x + button.width > b.x && button.y < b.y + b.size && button.y + button.height > b.y;
      assert.equal(overlap, false, `${description} 棋盘不与 ${button.label} 重叠`);
    }
  }
}

test('320×568 安全区、375×667、390×844 各页面按钮可见且棋盘有可点尺寸', () => {
  const sizes = [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 375, height: 667 }, { width: 390, height: 844, safeTop: 80, safeBottom: 34 }];
  for (const dimensions of sizes) {
    const env = createMock(dimensions), prefix = `${dimensions.width}×${dimensions.height}`;
    assertLayout(env, prefix + ' home');
    for (const id of [1, 49]) { load(env, id); assertLayout(env, prefix + ' play ' + id); }
    for (const page of ['levels', 'rules', 'settings', 'restart', 'win', 'fail']) {
      env.game.switchScreen(page); env.game.render(); assertLayout(env, prefix + ' ' + page);
    }
    env.game.stop();
  }
});

module.exports = { createMock };
