'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');

// 使用独立存档和真实控制器，记录玩家操作触发的音频事件。
function setup(settings = {}) {
  let now = Date.UTC(2026, 9, 13, 8);
  let stored = { unlocked: 9, completed: {}, daily: {}, tutorialDone: true, settings };
  const events = [], musicPauses = [], hooks = {};
  const ctx = new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: Array.from(String(value)).length * 10 })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 0, safeBottom: 0,
    now: () => now, requestFrame() {}, vibrate() {},
    onPointer: callback => { hooks.pointer = callback; }, onHide() {}, onShow() {},
    storage: { get: () => structuredClone(stored), set: (_, value) => { stored = structuredClone(value); return true; } }
  };
  const audio = { event: name => { events.push(name); }, setMusicPaused: value => { musicPauses.push(value); },
    configure() {}, unlock() {}, pause() {}, resume() {}, destroy() {} };
  const game = startGame({ platform, audio, inputUI: { editNickname() {}, destroy() {} } });
  function point(cell) {
    game.render(); const b = game.getState().board;
    return { x: b.x + (cell % b.n + .5) * b.cell, y: b.y + (Math.floor(cell / b.n) + .5) * b.cell };
  }
  function send(type, target) {
    hooks.pointer({ type, ...(typeof target === 'number' ? point(target) : target), time: now });
  }
  function tap(target) { send('down', target); send('up', target); }
  function click(label) {
    game.render(); const b = game.getState().buttons.find(item => item.label === label);
    assert.ok(b, '存在按钮：' + label); tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    now += 400;
  }
  return { game, events, musicPauses, send, tap, click,
    advance: ms => { now += ms; }, reset: () => { events.length = 0; musicPauses.length = 0; } };
}

const solutions = level => level.solution.map((column, row) => row * level.size + column);
const count = (env, name) => env.events.filter(event => event === name).length;

test('标叉与撤叉只在格子实际改变时发声，滑动回经过同格不重复发声', () => {
  const env = setup(); env.game.startLevel(9); env.reset();
  env.send('down', 0); env.send('move', 4); env.send('move', 0); env.send('move', 4); env.send('up', 4);
  assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.equal(count(env, 'mark'), 5); assert.equal(count(env, 'unmark'), 0);
  env.advance(400); env.reset();
  env.send('down', 0); env.send('move', 4); env.send('move', 0); env.send('up', 0);
  assert.deepEqual(env.game.getState().marks, []); assert.equal(count(env, 'unmark'), 5);
  env.reset(); env.game.toggleMark(0); env.game.undo();
  assert.deepEqual(env.events, ['mark', 'unmark']);
  const answer = solutions(levels.find(level => level.id === 9))[0];
  env.game.placeCat(answer); env.reset(); env.game.toggleMark(answer);
  assert.deepEqual(env.events, [], '已经安家的格子不能再次打叉发声'); env.game.stop();
});

test('正确、助手、提示、打卡和通关使用实际事件，重复无效操作不重复发声', () => {
  const env = setup(); env.game.startLevel(9); env.reset();
  const level = levels.find(item => item.id === 9), answer = solutions(level)[0];
  env.game.placeCat(answer); env.game.placeCat(answer);
  assert.equal(count(env, 'correct'), 1);
  env.game.locate(); assert.equal(count(env, 'helper'), 1, '助手通过运行层复用原放猫声');
  env.game.hint(); assert.equal(count(env, 'hint'), 1);
  env.game.switchScreen('home'); env.game.claimCheckin(); env.game.claimCheckin();
  assert.equal(count(env, 'checkin'), 1, '重复领取当天奖励不发声');
  env.game.startLevel(9); env.reset(); solutions(level).forEach(cell => env.game.placeCat(cell));
  assert.equal(env.game.getState().screen, 'win'); assert.equal(count(env, 'win'), 1);
  env.game.placeCat(answer); assert.equal(count(env, 'win'), 1);
  assert.ok(!env.events.some(event => /voice|meow|combo/i.test(event)), '未引入人声或默认关闭的猫叫'); env.game.stop();
});

test('进入和恢复棋盘发原入场声，只有设置开窗发声，失败页持续暂停音乐', () => {
  const env = setup(); env.game.startLevel(9); assert.equal(count(env, 'board'), 1);
  env.game.switchScreen('home'); env.reset(); env.game.resume(); assert.equal(count(env, 'board'), 1);
  env.game.switchScreen('home'); env.reset(); env.click('小屋设置');
  assert.deepEqual(env.events, ['click', 'dialog']);
  for (const page of ['profile', 'checkin']) {
    env.game.switchScreen('home'); env.reset(); env.game.openPage(page);
    assert.equal(count(env, 'dialog'), 0, page + ' 沿用原开窗静音配置');
  }
  env.game.startLevel(9); env.reset();
  const level = levels.find(item => item.id === 9), answers = new Set(solutions(level));
  const wrong = level.regions.map((_, cell) => cell).filter(cell => !answers.has(cell)).slice(0, 3);
  wrong.forEach(cell => env.game.placeCat(cell));
  assert.equal(count(env, 'error'), 3); assert.equal(count(env, 'fail'), 1);
  assert.equal(env.game.getState().screen, 'fail'); assert.equal(env.musicPauses.at(-1), true);
  env.advance(8000); env.game.render();
  assert.equal(env.game.getState().screen, 'fail'); assert.equal(env.musicPauses.at(-1), true, '失败声结束后仍暂停音乐');
  env.game.switchScreen('home'); assert.equal(env.musicPauses.at(-1), false); env.game.stop();
});

test('废弃自动排除设置在初始化、恢复和正确落猫时不打叉或发排除声', () => {
  const env = setup({ autoMark: true }); env.game.startLevel(1);
  assert.equal(Object.hasOwn(env.game.getState().settings, 'autoMark'), false);
  assert.deepEqual(env.game.getState().marks, []); assert.equal(count(env, 'autoMark'), 0, '给定猫的初始化不发排除声');
  env.game.toggleMark(0); const manual = env.game.getState().marks;
  env.game.switchScreen('home'); env.reset(); env.game.resume();
  assert.deepEqual(env.game.getState().marks, manual, '恢复保留玩家已有标记，不新增排除叉');
  assert.equal(count(env, 'autoMark'), 0, '恢复不发排除声');
  env.game.startLevel(9); env.reset();
  const answer = solutions(levels.find(level => level.id === 9))[0]; env.game.placeCat(answer);
  assert.deepEqual(env.game.getState().marks, []); assert.equal(count(env, 'autoMark'), 0);
  assert.equal(count(env, 'correct'), 1, '正常放猫声保留'); assert.equal(count(env, 'mark'), 0);
  env.reset(); env.game.setSetting('autoMark'); env.game.setSetting('autoMark');
  assert.equal(Object.hasOwn(env.game.getState().settings, 'autoMark'), false);
  assert.deepEqual(env.game.getState().marks, []); assert.deepEqual(env.events, [], '废弃设置调用不发声');
  env.game.startLevel(1); env.reset(); env.game.setSetting('autoMark');
  assert.deepEqual(env.game.getState().marks, []); assert.deepEqual(env.events, []); env.game.stop();
});

test('教学正常找猫、确认和滑动标叉发声，重复经过已标记格不重复发声', () => {
  const env = setup(); env.game.startTutorial(); env.game.render(); env.reset();
  env.tap(2); env.advance(100); env.tap(2);
  assert.equal(env.game.getState().phase, 2); assert.equal(count(env, 'correct'), 1);
  assert.equal(count(env, 'mark'), 0, '教学第一下等待双击不打叉');
  env.reset(); env.click('明白了'); assert.equal(count(env, 'click'), 1);
  env.reset(); env.send('down', 0); env.send('move', 3); env.send('move', 0); env.send('move', 3); env.send('up', 3);
  assert.equal(count(env, 'mark'), 3, '0、1、3 三个允许格各发声一次');
  assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), [0, 1, 3]); env.game.stop();
});
