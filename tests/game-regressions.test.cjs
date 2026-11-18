'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const KEY = 'miaoge-home-v1';
const clone = value => JSON.parse(JSON.stringify(value));

// 只复验最终审阅发现的五类问题，替身不启动真实动画或平台调用。
function mock(options) {
  options = options || {};
  let time = Date.UTC(2026, 9, 13, 8), saved = options.saved || { unlocked: 12, settings: { autoMark: false, vibrate: false } };
  const hooks = {}, ctx = new Proxy({}, {
    get(target, key) { return key === 'measureText' ? value => ({ width: String(value).length * 10 }) : target[key] || (() => {}); },
    set(target, key, value) { target[key] = value; return true; }
  });
  const platform = {
    ctx, width: options.width || 390, height: options.height || 844,
    safeTop: options.safeTop || 0, safeBottom: options.safeBottom || 0,
    now: () => time, storage: { get: () => clone(saved), set: (key, value) => { saved = clone(value); return true; } },
    requestFrame() {}, vibrate() {}, onPointer(fn) { hooks.pointer = fn; }, onHide(fn) { hooks.hide = fn; }, onShow(fn) { hooks.show = fn; }
  };
  return {
    game: startGame({ platform }), platform,
    advance: amount => { time += amount; }, saved: () => saved,
    pointer: (type, point) => hooks.pointer({ type, x: point.x, y: point.y, time }),
    hide: () => hooks.hide(), show: () => hooks.show()
  };
}
function load(env, id) { env.game.startLevel(id || 9); env.game.render(); return levels[(id || 9) - 1]; }
function solutions(level) { return level.solution.map((c, r) => r * level.size + c); }
function wrong(level) { return level.regions.findIndex((v, cell) => !solutions(level).includes(cell)); }
function point(game, cell) {
  const b = game.getState().board;
  return { x: b.x + (cell % b.n + .5) * b.cell, y: b.y + (Math.floor(cell / b.n) + .5) * b.cell };
}
function tap(env, target) { env.pointer('down', target); env.pointer('up', target); }
function click(env, label) {
  env.game.render();
  const b = env.game.getState().buttons.find(button => button.label === label);
  assert.ok(b, `存在按钮 ${label}`);
  tap(env, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  env.game.render();
}
function localDate(env) { const d = new Date(env.platform.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

test('按钮按下会打断双击序列，点击提示、撤销或取消按钮后不会误扣心', () => {
  for (const label of ['提示', '撤销']) {
    const env = mock(), level = load(env), cell = wrong(level), target = point(env.game, cell);
    tap(env, target); env.advance(100); click(env, label); env.advance(50); tap(env, target);
    assert.equal(env.game.getState().hearts, 3, label); assert.deepEqual(env.game.getState().errors, []);
    env.game.stop();
  }
  const env = mock(), level = load(env), target = point(env.game, wrong(level));
  tap(env, target); env.game.render();
  const b = env.game.getState().buttons.find(button => button.label === '提示'), button = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  env.advance(100); env.pointer('down', button); env.pointer('cancel', button); env.advance(50); tap(env, target);
  assert.equal(env.game.getState().hearts, 3); assert.deepEqual(env.game.getState().errors, []);
  env.game.stop();
});

test('离开提示页修改图案设置，返回后新预览计次但不应用过期提示', () => {
  for (const expected of [true, false]) {
    const env = mock({ saved: { settings: { pattern: !expected, vibrate: false } } }), level = load(env, 13);
    env.game.placeCat(solutions(level)[0]);
    env.game.hint(); env.game.render();
    assert.ok(env.game.getState().buttons.some(b => b.label === '应用'));
    const before = env.game.getState().hints;
    env.game.openPage('settings'); env.game.render();
    const toggle = env.game.getState().buttons.find(b => b.label === '图案模式');
    assert.ok(toggle, '设置提供图案模式开关');
    tap(env, { x: toggle.x + toggle.width / 2, y: toggle.y + toggle.height / 2 });
    assert.equal(env.saved().settings.pattern, expected);
    assert.equal(env.game.getState().hints, before, '切换设置不改变已经支付的次数');
    env.game.switchScreen('play'); env.game.render();
    assert.ok(env.game.getState().buttons.some(b => b.label === '提示'));
    const state = env.game.getState(); env.game.hint();
    assert.equal(env.game.getState().hints, before + 1);
    assert.equal(env.saved().progression.inventory.hints, 3 - before - 1);
    assert.deepEqual(env.game.getState().cats, state.cats); assert.deepEqual(env.game.getState().marks, state.marks);
    env.game.stop();
  }
});

test('成绩数组被拒绝，非法时间或提示次数不会阻止普通和每日成绩写入', () => {
  const arrays = mock({ saved: { completed: [], daily: [], settings: { autoMark: false, vibrate: false } } });
  const first = load(arrays, 1); arrays.advance(100); solutions(first).forEach(cell => arrays.game.placeCat(cell));
  assert.equal(Array.isArray(arrays.saved().completed), false); assert.equal(Array.isArray(arrays.saved().daily), false);
  assert.deepEqual(arrays.saved().completed[1], { time: 100, hints: 0, steps: first.size - (first.given || []).length, locates: 0, revives: 0, score: 5290 });
  arrays.game.dailyLevel(); const dailyLevel = levels[arrays.game.getState().levelId - 1], date = localDate(arrays);
  arrays.advance(50); solutions(dailyLevel).forEach(cell => arrays.game.placeCat(cell));
  assert.equal(dailyLevel.id, 34, '受控日期的每日题固定');
  assert.deepEqual(arrays.saved().daily[date], { time: 50, hints: 0, steps: dailyLevel.size - (dailyLevel.given || []).length, locates: 0, revives: 0, score: 17060 }); arrays.game.stop();
  for (const record of [{ time: '10', hints: 0 }, { time: -1, hints: 0 }, { time: null, hints: 0 }, { time: 10, hints: -1 }, { time: 10, hints: 1.5 }, { time: 10, hints: '0' }]) {
    const env = mock({ saved: { completed: { 1: record }, daily: { [date]: record }, settings: { autoMark: false, vibrate: false } } });
    const level = load(env, 1); env.advance(100); solutions(level).forEach(cell => env.game.placeCat(cell));
    assert.deepEqual(env.saved().completed[1], { time: 100, hints: 0, steps: level.size - (level.given || []).length, locates: 0, revives: 0, score: 5290 }, JSON.stringify(record));
    env.game.dailyLevel(); const day = levels[env.game.getState().levelId - 1]; env.advance(50); solutions(day).forEach(cell => env.game.placeCat(cell));
    assert.deepEqual(env.saved().daily[date], { time: 50, hints: 0, steps: day.size - (day.given || []).length, locates: 0, revives: 0, score: 17060 }, JSON.stringify(record)); env.game.stop();
  }
});

test('同关卡恢复残局，其他关卡和每日题先确认再替换，紧凑确认页按钮位于安全区', () => {
  const env = mock({ width: 320, height: 568, safeTop: 80, safeBottom: 34 }), level = load(env), cat = solutions(level)[0], mark = wrong(level);
  env.game.placeCat(cat); env.game.toggleMark(mark); env.advance(1250); env.game.switchScreen('home');
  click(env, '关卡'); click(env, '9');
  assert.equal(env.game.getState().screen, 'play'); assert.deepEqual(env.game.getState().cats, [cat]);
  assert.deepEqual(env.game.getState().marks, [mark]); assert.equal(env.game.getState().elapsed, 1250);
  env.game.switchScreen('home'); click(env, '关卡'); click(env, '10');
  assert.equal(env.game.getState().screen, 'newgame'); assert.equal(env.saved().session.levelId, 9);
  assert.deepEqual(env.saved().session.cats, [cat]);
  for (const b of env.game.getState().buttons) {
    assert.ok(b.x >= 0 && b.x + b.width <= 320);
    assert.ok(b.y >= 80 && b.y + b.height <= 534, b.label);
  }
  click(env, '继续未完成棋局'); assert.equal(env.game.getState().levelId, 9); assert.deepEqual(env.game.getState().cats, [cat]);
  env.game.switchScreen('home'); click(env, '关卡'); click(env, '10'); click(env, '开始新棋局');
  assert.equal(env.game.getState().levelId, 10); assert.equal(env.saved().session.levelId, 10); assert.equal(env.game.getState().elapsed, 0);
  env.game.switchScreen('home'); click(env, '每日挑战');
  assert.equal(env.game.getState().screen, 'newgame'); assert.equal(env.saved().session.daily, false);
  assert.equal(env.saved().session.levelId, 10); click(env, '继续未完成棋局'); assert.equal(env.game.getState().daily, false);
  env.game.switchScreen('home'); click(env, '每日挑战'); click(env, '开始新棋局');
  assert.equal(env.game.getState().daily, true); assert.equal(env.saved().session.daily, true);
  env.game.stop();
});

test('新增猫模式仅同格松手提交，取消、出界和隐藏不扣心；普通双击保持第二次按下生效', () => {
  const env = mock(), level = load(env), bad = point(env.game, wrong(level)), good = point(env.game, solutions(level)[0]);
  click(env, '猫  放置');
  env.pointer('down', bad); assert.equal(env.game.getState().hearts, 3);
  env.pointer('cancel', bad); assert.equal(env.game.getState().hearts, 3);
  env.pointer('down', bad); env.pointer('move', { x: 0, y: 0 }); env.pointer('up', { x: 0, y: 0 });
  assert.equal(env.game.getState().hearts, 3); assert.deepEqual(env.game.getState().errors, []);
  env.pointer('down', bad); env.hide(); env.show(); env.pointer('up', bad);
  assert.equal(env.game.getState().hearts, 3); assert.deepEqual(env.game.getState().errors, []);
  env.pointer('down', bad); env.pointer('up', good); assert.equal(env.game.getState().hearts, 3);
  env.pointer('down', good); assert.equal(env.game.getState().cats.length, 0); env.pointer('up', good);
  assert.equal(env.game.getState().cats.length, 1);
  env.pointer('down', bad); env.pointer('up', bad); assert.equal(env.game.getState().hearts, 2); env.game.stop();
  const original = mock(), originalLevel = load(original), target = point(original.game, wrong(originalLevel));
  tap(original, target); original.advance(100); original.pointer('down', target);
  assert.equal(original.game.getState().hearts, 2); original.pointer('cancel', target);
  assert.equal(original.game.getState().hearts, 2); assert.equal(original.game.getState().errors.length, 1); original.game.stop();
});
