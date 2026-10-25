'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');

function harness(initial) {
  let saved = initial || null, time = Date.UTC(2026, 9, 13, 10);
  const events = {}, ctx = new Proxy({ measureText: value => ({ width: String(value).length * 10 }) }, {
    get: (target, key) => target[key] || (() => {}), set: (target, key, value) => (target[key] = value, true)
  });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 80, safeBottom: 34, now: () => time,
    storage: { get: () => saved, set: (key, value) => { saved = JSON.parse(JSON.stringify(value)); } },
    requestFrame() {}, vibrate() {}, onPointer(fn) { events.pointer = fn; }, onHide(fn) { events.hide = fn; }, onShow(fn) { events.show = fn; }
  };
  const game = startGame({ platform });
  const send = (type, point) => events.pointer({ type, ...point, time });
  function cellPoint(cell) {
    const b = game.getState().board;
    return { x: b.x + (cell % b.n + .5) * b.cell, y: b.y + (Math.floor(cell / b.n) + .5) * b.cell };
  }
  function tapCell(cell) { send('down', cellPoint(cell)); send('up', cellPoint(cell)); game.render(); }
  function double(cell) { tapCell(cell); time += 100; tapCell(cell); }
  function click(label) {
    game.render(); const b = game.getState().buttons.find(item => item.label === label); assert.ok(b, label);
    const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 }; send('down', point); send('up', point); game.render();
  }
  return { game, events, send, cellPoint, tapCell, double, click, advance: value => { time += value; }, saved: () => saved };
}

test('首访主页开始进入零预置4×4教学，跳过后进入普通第1关并持久化教学完成', () => {
  const m = harness(); m.click('开始找猫');
  const state = m.game.getState(); assert.equal(state.screen, 'tutorial'); assert.equal(state.levelId, 0); assert.equal(state.size, 4);
  assert.equal(state.phase, 1); assert.deepEqual(state.cats, []); assert.equal(m.saved().session, null);
  m.click('跳过教学'); assert.equal(m.game.getState().screen, 'play'); assert.equal(m.game.getState().levelId, 1);
  assert.equal(m.saved().tutorialDone, true); assert.equal(m.saved().session.levelId, 1);
  m.game.stop();
});

test('已有普通残局在教学、标记中隐藏与返回期间保持不变，跳过教学恢复原局', () => {
  const m = harness(); m.game.startLevel(9); const level = levels[8], good = level.solution[0];
  const wrong = level.regions.findIndex((v, c) => level.solution[Math.floor(c / level.size)] !== c % level.size);
  m.game.placeCat(good); m.game.toggleMark(wrong); m.advance(1250); m.game.switchScreen('home');
  const session = JSON.parse(JSON.stringify(m.saved().session));
  m.click('新手教学'); assert.equal(m.game.getState().screen, 'tutorial');
  m.double(2); m.click('明白了');
  m.send('down', m.cellPoint(0)); m.send('move', m.cellPoint(3));
  assert.deepEqual(m.game.getState().marks, [0, 1, 3]);
  m.events.hide(); assert.deepEqual(m.game.getState().marks, []); assert.deepEqual(m.saved().session, session);
  m.advance(60000); m.events.show(); m.game.render();
  assert.deepEqual(m.saved().session, session); m.click('跳过教学');
  const restored = m.game.getState(); assert.equal(restored.screen, 'play'); assert.equal(restored.levelId, 9);
  assert.deepEqual(restored.cats, session.cats); assert.deepEqual(restored.marks, session.marks); assert.equal(restored.elapsed, 1250);
  assert.equal(m.saved().tutorialDone, true); m.game.stop();
});

test('教学四猫按七步完成后回普通第1关，不记录教学为普通通关，完成flag跨重启保留', () => {
  const m = harness(); m.click('开始找猫'); m.double(2); m.click('明白了');
  [0, 1, 3, 6, 10, 14].forEach(cell => m.tapCell(cell)); assert.equal(m.game.getState().phase, 4);
  m.double(13); [8, 9, 12].forEach(cell => m.tapCell(cell)); assert.equal(m.game.getState().phase, 6);
  m.double(4); assert.equal(m.game.getState().phase, 7); m.double(11);
  assert.equal(m.game.getState().screen, 'play'); assert.equal(m.game.getState().levelId, 1);
  assert.equal(m.saved().tutorialDone, true); assert.deepEqual(m.saved().completed, {}); assert.equal(m.saved().session.levelId, 1);
  assert.deepEqual(m.game.getState().cats, levels[0].given);
  m.game.stop(); const next = harness(m.saved());
  assert.ok(next.game.getState().buttons.some(b => b.label === '继续第 1 关'));
  assert.ok(!next.game.getState().buttons.some(b => b.label === '开始找猫'));
  next.click('继续第 1 关'); assert.equal(next.game.getState().levelId, 1); assert.equal(next.game.getState().screen, 'play'); next.game.stop();
});
