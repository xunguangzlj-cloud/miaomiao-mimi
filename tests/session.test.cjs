'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');

// 用受控时间模拟前后台与跨午夜；不需要微信账号或浏览器。
function harness(options) {
  options = options || {};
  let time = options.time || new Date(2026, 9, 12, 23, 59, 50).getTime();
  let saved = options.saved ? JSON.parse(JSON.stringify(options.saved)) : null;
  const events = {}, texts = [];
  const base = {
    measureText(value) { return { width: [...value].length * Number((base.font || '12px').match(/(\d+)px/)[1]) }; },
    fillText(value, x, y) { texts.push({ value, x, y, font: base.font }); }
  };
  const ctx = new Proxy(base, { get(obj, key) { return key in obj ? obj[key] : (() => {}); } });
  const platform = {
    canvas: {}, ctx, width: options.width || 390, height: options.height || 844,
    safeTop: options.safeTop === undefined ? 80 : options.safeTop, safeBottom: options.safeBottom === undefined ? 34 : options.safeBottom,
    storage: { get() { return saved; }, set(key, value) { saved = JSON.parse(JSON.stringify(value)); } },
    vibrate() {}, now: () => time, requestFrame() {},
    onPointer(fn) { events.pointer = fn; }, onHide(fn) { events.hide = fn; }, onShow(fn) { events.show = fn; }
  };
  const game = startGame({ platform });
  return { game, events, texts, saved: () => saved, time: () => time, advance: delta => { time += delta; } };
}

function finish(game) {
  const level = levels.find(item => item.id === game.getState().levelId);
  for (let row = 0; row < level.size; row++) game.placeCat(row * level.size + level.solution[row], false);
  assert.equal(game.getState().screen, 'win');
}

function clickButton(game, label, time) {
  game.render();
  const button = game.getState().buttons.find(item => item.label === label);
  assert.ok(button, '找不到按钮：' + label);
  const point = { x: button.x + button.width / 2, y: button.y + button.height / 2, time };
  game.pointer(Object.assign({ type: 'down' }, point));
  game.pointer(Object.assign({ type: 'up' }, point));
}

test('后台停留不计入游戏用时', () => {
  const m = harness(); m.game.startLevel(1, false); m.advance(5000); m.events.hide(); m.advance(30000); assert.equal(m.game.getState().elapsed, 5000); m.events.show(); m.advance(2000); assert.equal(m.game.getState().elapsed, 7000);
});
test('离开棋盘后的存档可恢复猫与累计时间', () => {
  const m = harness(); m.game.startLevel(1, false); const l = levels[0], current = m.game.getState(); const cell = l.solution.map((c, r) => r * l.size + c).find(i => !current.cats.includes(i)); m.game.placeCat(cell, false); m.advance(3000); const before = m.game.getState(); m.game.switchScreen('home'); const next = harness({ saved: m.saved(), time: m.time() }); next.game.resume(); assert.deepEqual(next.game.getState().cats, before.cats); assert.deepEqual(next.game.getState().marks, before.marks); assert.equal(next.game.getState().elapsed, 3000);
});
test('设置页暂停计时，返回棋盘后继续累计', () => {
  const m = harness(); m.game.startLevel(1, false); m.advance(2000); m.game.openPage('settings'); m.advance(12000); assert.equal(m.game.getState().elapsed, 2000); m.game.switchScreen('play'); m.advance(1000); assert.equal(m.game.getState().elapsed, 3000);
});
test('跨午夜保存中的每日关卡仍使用开局日期', () => {
  const m = harness(); m.game.dailyLevel(); assert.equal(m.saved().session.date, '2026-10-12'); m.advance(20000); m.events.hide(); assert.equal(m.saved().session.date, '2026-10-12');
});
test('跨午夜完成的每日关卡不占用次日成绩', () => {
  const m = harness(); m.game.dailyLevel(); m.advance(20000); finish(m.game); assert.ok(m.saved().daily['2026-10-12']); assert.equal(m.saved().daily['2026-10-13'], undefined);
});
test('每日胜利页跨午夜恢复后不会读取空记录而崩溃', () => {
  const m = harness(); m.game.dailyLevel(); finish(m.game); m.events.hide(); m.advance(20000); m.events.show(); assert.doesNotThrow(() => m.game.render()); assert.ok(m.saved().daily['2026-10-12']);
});
test('次日重新启动不会恢复昨日未完成的每日关卡', () => {
  const m = harness(); m.game.dailyLevel(); m.events.hide(); const next = harness({ saved: m.saved(), time: m.time() + 20000 }); next.game.resume(); assert.equal(next.game.getState().daily, false); assert.equal(next.game.getState().screen, 'play');
});
test('320×568 的按钮留在安全区内，重开说明不覆盖按钮', () => {
  const m = harness({ width: 320, height: 568 });
  for (const screen of ['home', 'levels', 'rules', 'settings']) {
    m.game.switchScreen(screen); m.game.render(); for (const button of m.game.getState().buttons) assert.ok(button.y + button.height <= 518, screen + '按钮越界：' + button.label);
  }
  m.game.startLevel(60, false); m.game.render(); assert.ok(m.game.getState().board.cell >= 25);
  m.game.openPage('restart'); m.texts.length = 0; m.game.render(); const primary = m.game.getState().buttons.find(b => b.label === '重新开始这一关'); const lines = m.texts.filter(t => t.value.includes('清空') || t.value.includes('已完成')); assert.ok(lines.length); assert.ok(lines.every(t => t.y + 7 < primary.y));
});

test('跨日从每日胜利页重试会选择今日题', () => {
  const m = harness(); m.game.dailyLevel(); finish(m.game); m.advance(20000); const today = harness({ time: m.time() }); today.game.dailyLevel(); clickButton(m.game, '再玩一次', m.time()); assert.equal(m.game.getState().levelId, today.game.getState().levelId); assert.equal(m.saved().session.date, '2026-10-13');
});
test('跨日从每日失败页重试会选择今日题', () => {
  const m = harness(); m.game.dailyLevel(); const l = levels.find(item => item.id === m.game.getState().levelId); const wrong = l.regions.map((_, cell) => cell).filter(cell => l.solution[Math.floor(cell / l.size)] !== cell % l.size); wrong.slice(0, 3).forEach(cell => m.game.placeCat(cell, false)); assert.equal(m.game.getState().screen, 'fail'); m.advance(20000); const today = harness({ time: m.time() }); today.game.dailyLevel(); clickButton(m.game, '重新找猫', m.time()); assert.equal(m.game.getState().levelId, today.game.getState().levelId); assert.equal(m.saved().session.date, '2026-10-13');
});
test('紧凑与普通每日重开页跨日均选择今日题', () => {
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const m = harness(size); m.game.dailyLevel(); m.game.openPage('restart'); m.advance(20000); const today = harness({ time: m.time() }); today.game.dailyLevel(); clickButton(m.game, '重新开始这一关', m.time()); assert.equal(m.game.getState().levelId, today.game.getState().levelId); assert.equal(m.saved().session.date, '2026-10-13');
  }
});
test('同日重开保持同题并清空当前进度', () => {
  const m = harness(); m.game.dailyLevel(); const original = m.game.getState().levelId; m.advance(1000); m.game.openPage('restart'); clickButton(m.game, '重新开始这一关', m.time()); assert.equal(m.game.getState().levelId, original); assert.equal(m.game.getState().elapsed, 0); assert.equal(m.saved().session.date, '2026-10-12');
});

test('原生 game.js 入口在 wx mock 下执行启动、双击放猫、存档与前后台恢复', () => {
  const api = require('../src/game.js');
  const originalStart = api.startGame, originalWx = global.wx, originalFrame = global.requestAnimationFrame, originalNow = Date.now;
  let time = new Date(2026, 9, 13, 10, 0, 0).getTime(), game, saved;
  const events = {};
  const ctx = new Proxy({ measureText: value => ({ width: [...value].length * 12 }) }, { get(obj, key) { return key in obj ? obj[key] : (() => {}); } });
  const canvas = { getContext: () => ctx };
  global.wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, safeArea: { top: 47, bottom: 810 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 79 }),
    getStorageSync: () => saved || '', setStorageSync: (key, value) => { assert.equal(key, 'miaoge-home-v1'); saved = JSON.parse(JSON.stringify(value)); },
    onTouchStart: fn => { events.down = fn; }, onTouchMove: fn => { events.move = fn; }, onTouchEnd: fn => { events.up = fn; }, onTouchCancel: fn => { events.cancel = fn; },
    onHide: fn => { events.hide = fn; }, onShow: fn => { events.show = fn; }, vibrateShort() {}
  };
  global.requestAnimationFrame = fn => { events.frame = fn; return 1; };
  Date.now = () => time;
  api.startGame = (...args) => { game = originalStart(...args); return game; };
  function tap(x, y) {
    const event = { changedTouches: [{ identifier: 1, clientX: x, clientY: y }] };
    events.down(event); events.up(event); events.frame();
  }
  try {
    const entry = require.resolve('../game.js'); delete require.cache[entry]; require(entry);
    assert.equal(game, undefined); assert.equal(saved, undefined); assert.equal(events.down, undefined);
    time += 3000; events.frame(); assert.equal(game, undefined);
    time += 100; events.frame();
    assert.equal(game.getState().screen, 'home'); assert.equal(canvas.width, 780); assert.equal(canvas.height, 1688);
    const begin = game.getState().buttons.find(button => button.label.startsWith('开始找猫'));
    tap(begin.x + begin.width / 2, begin.y + begin.height / 2);
    assert.equal(game.getState().screen, 'tutorial'); assert.equal(game.getState().size, 4); assert.equal(game.getState().levelId, 0);
    assert.deepEqual(game.getState().cats, []);
    const skip = game.getState().buttons.find(button => button.label === '跳过教学'); assert.ok(skip);
    tap(skip.x + skip.width / 2, skip.y + skip.height / 2);
    assert.equal(game.getState().screen, 'play'); assert.equal(game.getState().board.n, 4); assert.equal(saved.tutorialDone, true);
    const l = require('../src/level-data.js')[0], state = game.getState(), cell = l.solution.map((c, r) => r * l.size + c).find(i => !state.cats.includes(i));
    const board = state.board, x = board.x + (cell % l.size + .5) * board.cell, y = board.y + (Math.floor(cell / l.size) + .5) * board.cell;
    tap(x, y); assert.ok(game.getState().marks.includes(cell));
    time += 100; tap(x, y); assert.ok(game.getState().cats.includes(cell)); assert.ok(!game.getState().marks.includes(cell)); assert.ok(saved.session.cats.includes(cell));
    time += 5000; events.hide(); const paused = game.getState().elapsed; time += 30000; assert.equal(game.getState().elapsed, paused); events.show(); time += 2000; events.frame(); assert.equal(game.getState().elapsed, paused + 2000);
  } finally {
    if (game) game.stop();
    api.startGame = originalStart; Date.now = originalNow;
    if (originalWx === undefined) delete global.wx; else global.wx = originalWx;
    if (originalFrame === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = originalFrame;
    delete require.cache[require.resolve('../game.js')];
    delete require.cache[require.resolve('../src/boot.js')];
  }
});
