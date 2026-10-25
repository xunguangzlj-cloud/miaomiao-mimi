'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const progress = require('../src/progression.js');
const KEY = 'miaoge-home-v1';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// 平台替身仅保存真实游戏状态；钟表可推进，画布渐变保留标准接口。
function setup(options) {
  options = options || {};
  let time = options.time || Date.UTC(2026, 9, 13, 8), nextFrame;
  const hooks = {}, store = options.store || new Map(), audioEvents = [], configurations = [];
  if (!store.has(KEY)) {
    const initial = Object.assign({ unlocked: 1, completed: {}, daily: {}, tutorialDone: true, settings: { autoMark: false, vibrate: true }, session: null }, clone(options.saved) || {});
    if (options.inventory) initial.progression = Object.assign(progress.hydrate(initial.progression, initial.completed, initial.daily), { inventory: clone(options.inventory) });
    store.set(KEY, initial);
  }
  const ctx = new Proxy({
    globalAlpha: 1,
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: Array.from(String(value)).length * 10 })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const audio = new Proxy({ event: kind => audioEvents.push(kind), configure: settings => configurations.push(clone(settings)) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 0, safeBottom: 0,
    storage: { get: key => clone(store.get(key)), set: (key, value) => { store.set(key, clone(value)); return true; } },
    now: () => time, requestFrame: fn => { nextFrame = fn; }, vibrate() {},
    onPointer: fn => { hooks.pointer = fn; }, onHide: fn => { hooks.hide = fn; }, onShow: fn => { hooks.show = fn; }
  };
  const game = startGame({ platform, audio, inputUI: { editNickname() {}, destroy() {} } });
  function click(label) {
    game.render();
    const button = game.getState().buttons.find(item => item.label === label);
    assert.ok(button, '存在按钮：' + label);
    const point = { x: button.x + button.width / 2, y: button.y + button.height / 2, time };
    hooks.pointer({ ...point, type: 'down' }); hooks.pointer({ ...point, type: 'up' });
  }
  return { game, store, hooks, audioEvents, configurations, click, saved: () => clone(store.get(KEY)), advance: ms => { time += ms; }, now: () => time, frame: () => nextFrame() };
}
function load(env, id) { env.game.startLevel(id || 9); return levels.find(item => item.id === (id || 9)); }
function answers(level) { return level.solution.map((col, row) => row * level.size + col); }
function finishManually(env) {
  const level = levels.find(item => item.id === env.game.getState().levelId);
  answers(level).forEach(cell => env.game.placeCat(cell));
  assert.equal(env.game.getState().screen, 'win');
}
function finishWithHelpers(env) {
  const level = levels.find(item => item.id === env.game.getState().levelId);
  for (let i = 0; i < 3 && env.game.getState().screen === 'play'; i++) env.game.locate();
  answers(level).forEach(cell => env.game.placeCat(cell));
  assert.equal(env.game.getState().screen, 'win');
}
function gameplay(state) {
  return { cats: state.cats, marks: state.marks, errors: state.errors, hearts: state.hearts, hints: state.hints, steps: state.steps, locates: state.locates, score: state.score, combo: state.combo, manual: state.manual, assisted: state.assisted };
}

test('手动正确放置即时得分，连续正确分值提高，给定猫与重复操作不能刷分', () => {
  const env = setup(), level = load(env), good = answers(level);
  let state = env.game.getState(); assert.equal(state.score, 0); assert.equal(state.combo, 0);
  env.game.placeCat(good[0]); state = env.game.getState();
  const first = state.score; assert.ok(first >= 1000); assert.equal(state.combo, 1); assert.equal(state.manual, 1); assert.equal(state.assisted, 0);
  assert.equal(env.game.placeCat(good[0]), false); env.game.toggleMark(good[0]); env.game.undo();
  assert.equal(env.game.getState().score, first);
  env.game.placeCat(good[1]); state = env.game.getState();
  assert.ok(state.score - first > first); assert.equal(state.combo, 2); assert.equal(state.manual, 2);
  load(env, 1); state = env.game.getState(); assert.ok(state.cats.length > 0); assert.equal(state.score, 0); assert.equal(state.manual, 0);
  state.cats.forEach(cell => assert.equal(env.game.placeCat(cell), false)); assert.equal(env.game.getState().score, 0);
  env.game.stop();
});

test('放置错误扣一条生命并中断连击，同格不会重复扣命或改变分数', () => {
  const env = setup(), level = load(env), good = answers(level), wrong = level.regions.findIndex((_, cell) => !good.includes(cell));
  env.game.placeCat(good[0]); const base = env.game.getState().score;
  env.game.placeCat(good[1]); const before = env.game.getState();
  env.game.placeCat(wrong); const state = env.game.getState();
  assert.equal(state.hearts, before.hearts - 1); assert.equal(state.combo, 0); assert.equal(state.score, before.score);
  assert.equal(state.manual, before.manual); assert.deepEqual(state.errors, [wrong]);
  assert.equal(env.game.placeCat(wrong), false); assert.equal(env.game.getState().hearts, state.hearts);
  env.game.placeCat(good[2]); assert.equal(env.game.getState().combo, 1);
  assert.equal(env.game.getState().score - state.score, base);
  env.game.stop();
});

test('猫咪助手消耗全局次数并获得基础分，不延续手动连击，耗尽时无游戏动作', () => {
  const env = setup({ inventory: { hints: 5, helpers: 1 } }), level = load(env), good = answers(level);
  env.game.placeCat(good[0]); const base = env.game.getState().score;
  env.game.placeCat(good[1]); const before = env.game.getState(); env.game.locate();
  const state = env.game.getState();
  assert.equal(state.cats.length, before.cats.length + 1); assert.equal(state.score - before.score, base);
  assert.equal(state.combo, 0); assert.equal(state.assisted, 1); assert.equal(state.manual, 2); assert.equal(state.locates, 1);
  assert.equal(state.progression.inventory.helpers, 0); assert.equal(env.saved().progression.inventory.helpers, 0);
  env.game.locate(); assert.deepEqual(gameplay(env.game.getState()), gameplay(state));
  assert.equal(env.audioEvents.filter(kind => kind === 'helper').length, 1);
  env.game.stop();
});

test('查看有效提示即扣次数，最后一次仍可应用，同条应用不重复扣次', () => {
  const env = setup({ inventory: { hints: 1, helpers: 5 } }); load(env);
  const before = env.game.getState(); env.game.hint(); const preview = env.game.getState();
  assert.ok(preview.pendingHint); assert.equal(preview.progression.inventory.hints, 0); assert.equal(preview.hints, 1);
  assert.deepEqual(gameplay(preview), { ...gameplay(before), hints: 1 });
  assert.equal(env.saved().progression.inventory.hints, 0); assert.equal(env.saved().session.hints, 1);
  env.game.hint(); const applied = env.game.getState();
  assert.equal(applied.pendingHint, null); assert.equal(applied.progression.inventory.hints, 0); assert.equal(applied.hints, 1);
  assert.equal(applied.steps, before.steps + 1); assert.equal(env.saved().progression.inventory.hints, 0);
  if (preview.pendingHint.kind === 'place') { assert.equal(applied.assisted, 1); assert.equal(applied.manual, 0); assert.ok(applied.score > 0); }
  env.game.hint(); assert.equal(env.game.getState().pendingHint, null);
  assert.deepEqual(gameplay(env.game.getState()), gameplay(applied));
  assert.equal(env.audioEvents.filter(kind => kind === 'hint').length, 1);
  env.game.stop();
});

test('取消提示不返次数，重新查看另计一次，重新开始不补回已消费道具', () => {
  const env = setup({ inventory: { hints: 3, helpers: 3 } }); load(env);
  env.game.hint(); env.game.openPage('settings');
  assert.equal(env.game.getState().pendingHint, null); assert.equal(env.game.getState().progression.inventory.hints, 2);
  env.game.switchScreen('play'); env.game.hint(); env.game.hint(); env.game.locate();
  const spent = clone(env.game.getState().progression.inventory); assert.deepEqual(spent, { hints: 1, helpers: 2 });
  env.game.openPage('restart'); env.click('重新开始这一关'); const state = env.game.getState();
  assert.equal(state.screen, 'play'); assert.equal(state.levelId, 9);
  assert.deepEqual(state.progression.inventory, spent); assert.equal(state.score, 0); assert.equal(state.combo, 0);
  assert.equal(state.manual, 0); assert.equal(state.assisted, 0); assert.equal(state.hints, 0); assert.equal(state.locates, 0);
  assert.deepEqual(env.saved().progression.inventory, spent); env.game.stop();
});

test('关闭最后一次提示后照目标手动落猫，仍保留提示记录且不能免费继续查看', () => {
  const env = setup({ inventory: { hints: 1, helpers: 5 } }); load(env);
  env.game.hint(); const preview = env.game.getState();
  assert.ok(preview.pendingHint); assert.equal(preview.pendingHint.kind, 'place');
  const target = preview.pendingHint.cell;
  env.game.openPage('settings'); env.game.switchScreen('play');
  assert.equal(env.game.getState().pendingHint, null); assert.equal(env.game.getState().progression.inventory.hints, 0);
  assert.equal(env.game.placeCat(target), true); const afterManual = env.game.getState();
  assert.equal(afterManual.hints, 1); assert.equal(afterManual.manual, 1); assert.equal(afterManual.assisted, 0); assert.ok(afterManual.score > 0);
  env.game.hint(); assert.equal(env.game.getState().pendingHint, null);
  assert.deepEqual(gameplay(env.game.getState()), gameplay(afterManual));
  assert.equal(env.game.getState().progression.inventory.hints, 0); assert.equal(env.saved().session.hints, 1);
  assert.equal(env.audioEvents.filter(kind => kind === 'hint').length, 1); env.game.stop();
});

test('重玩只改善该关最高分，最高分与最佳时间独立，经验仅首次成功领取', () => {
  const env = setup({ inventory: { hints: 3, helpers: 3 } }); load(env); env.advance(1000); finishWithHelpers(env);
  const first = env.game.getState(), firstRecord = env.saved().completed[9];
  assert.equal(first.clearReward.rewarded, true); assert.equal(firstRecord.time, 1000);
  assert.equal(first.ranking.score.points, first.score); assert.equal(first.ranking.score.completed, 1);
  const xp = first.progression.xp;
  load(env); env.advance(90000); finishManually(env); const second = env.game.getState(), secondRecord = env.saved().completed[9];
  assert.ok(second.score > first.score); assert.equal(secondRecord.score, second.score); assert.equal(secondRecord.time, firstRecord.time);
  assert.equal(second.ranking.score.points, second.score); assert.equal(second.ranking.score.completed, 1);
  assert.equal(second.progression.xp, xp); assert.equal(second.clearReward.rewarded, false);
  env.advance(86400000); load(env); env.advance(500); finishWithHelpers(env); const third = env.game.getState(), thirdRecord = env.saved().completed[9];
  assert.ok(third.score < second.score); assert.equal(thirdRecord.score, second.score); assert.equal(thirdRecord.time, 500);
  assert.deepEqual(third.ranking.score, { points: second.score, completed: 1, totalTimeMs: 500 });
  assert.equal(third.progression.xp, xp); assert.equal(third.clearReward.rewarded, false);
  assert.equal(third.resultScore.total, third.score);
  assert.equal(third.resultScore.placement + third.resultScore.perfectBonus + third.resultScore.speedBonus, third.score);
  env.game.stop();
});

test('续局完整恢复分数、连击、手动与助手计数和库存，后台时间不计入奖励耗时', () => {
  const env = setup(), level = load(env), good = answers(level);
  env.game.placeCat(good[0]); env.game.locate();
  const next = good.find(cell => !env.game.getState().cats.includes(cell)); env.game.placeCat(next); env.advance(2000);
  const before = env.game.getState(); env.hooks.hide(); env.advance(60000); env.hooks.show();
  assert.equal(env.game.getState().elapsed, before.elapsed); env.game.stop();
  const saved = env.saved();
  for (const key of ['score', 'combo', 'manual', 'assisted']) assert.equal(saved.session[key], before[key]);
  const resumed = setup({ store: env.store, time: env.now() }); resumed.game.resume(); const state = resumed.game.getState();
  assert.deepEqual(gameplay(state), gameplay(before)); assert.equal(state.elapsed, before.elapsed);
  assert.deepEqual(state.progression.inventory, before.progression.inventory);
  assert.equal(state.combo, 1); assert.equal(state.manual, 2); assert.equal(state.assisted, 1);
  resumed.game.stop();
});

test('旧版残局缺少计分字段可继续，已有正确猫不补发或虚构放置分', () => {
  const level = levels.find(item => item.id === 9), cell = answers(level)[0];
  const env = setup({ saved: { session: { levelId: 9, daily: false, date: '2026-10-13', cats: [cell], marks: [], errors: [], hearts: 3, hints: 0, locates: 0, steps: 1, revives: 0, elapsed: 2000, mode: 'mark' } } });
  env.game.resume(); const state = env.game.getState();
  assert.deepEqual(state.cats, [cell]); assert.equal(state.score, 0); assert.equal(state.combo, 0);
  assert.equal(state.manual, 0); assert.equal(state.assisted, 0);
  assert.equal(env.game.placeCat(cell), false); assert.equal(env.game.getState().score, 0);
  env.game.placeCat(answers(level)[1]); assert.ok(env.game.getState().score > 0); assert.equal(env.game.getState().manual, 1);
  env.game.stop();
});

test('旧版通关记录保留无分数状态，别名记录按各关最高分和最佳时间分别汇总', () => {
  const env = setup({ saved: { completed: {
    1: { time: 800, hints: 0, score: 1000 }, '01': { time: 300, hints: 0, score: 500 },
    2: { time: 400, hints: 0, score: 3000 }, 3: { time: 700, hints: 0 }
  } } });
  assert.deepEqual(env.game.getState().ranking.score, { points: 4000, completed: 3, totalTimeMs: 1400 });
  load(env, 4); const records = env.saved().completed;
  assert.equal(Object.hasOwn(records[3], 'score'), false); assert.equal(records[3].time, 700);
  assert.ok(env.game.getState().progression.xp > 0); env.game.stop();
});

test('每日打卡同日重复不增库存或经验，次日连签和回拨限制持久化', () => {
  const env = setup();
  const first = env.game.claimCheckin(); assert.equal(first.claimed, true); assert.equal(first.day, 1);
  const before = clone(env.game.getState().progression); assert.equal(before.checkin.streak, 1);
  assert.equal(env.game.claimCheckin().claimed, false); assert.deepEqual(env.game.getState().progression, before);
  env.advance(86400000); const next = env.game.claimCheckin();
  assert.equal(next.claimed, true); assert.equal(next.day, 2); assert.equal(next.streak, 2);
  assert.equal(env.game.getState().progression.xp, before.xp + next.reward.xp);
  assert.equal(env.saved().progression.checkin.lastDate, '2026-10-14');
  const latest = clone(env.game.getState().progression); env.advance(-86400000);
  assert.equal(env.game.claimCheckin().reason, 'clock_rollback'); assert.deepEqual(env.game.getState().progression, latest);
  assert.equal(env.audioEvents.filter(kind => kind === 'checkin').length, 2); env.game.stop();
});

test('达到等级后才能选动物、主题与头像框，初始头像可以自由选择并保存', () => {
  const env = setup(), initial = clone(env.game.getState().progression);
  for (const [kind, id] of [['animal', 'calico'], ['theme', 'forest'], ['frame', 'mint']]) assert.equal(env.game.selectCosmetic(kind, id), false);
  assert.deepEqual(env.game.getState().progression, initial);
  assert.equal(env.game.selectCosmetic('avatar', 'duck'), true); assert.equal(env.saved().progression.profile.avatar, 'duck');
  load(env, 1); finishManually(env); load(env, 2); finishManually(env);
  assert.ok(progress.levelInfo(env.game.getState().progression.xp).level >= 3);
  assert.equal(env.game.selectCosmetic('animal', 'calico'), true);
  assert.equal(env.game.selectCosmetic('theme', 'forest'), true);
  assert.equal(env.game.selectCosmetic('frame', 'mint'), true);
  assert.equal(env.game.selectCosmetic('animal', 'lion'), false);
  assert.equal(env.saved().progression.animal, 'calico'); assert.equal(env.saved().progression.theme, 'forest');
  assert.equal(env.saved().progression.profile.frame, 'mint'); env.game.stop();
});

test('音乐、音效、震动与图案开关独立保存，设置页面暂停后返回保留残局', () => {
  const env = setup({ saved: { settings: { autoMark: false, vibrate: true, music: false, sound: true, pattern: true, voice: true } } }), level = load(env);
  env.game.placeCat(answers(level)[0]); env.advance(1200);
  env.game.openPage('settings'); const before = gameplay(env.game.getState());
  const settings = clone(env.game.getState().settings);
  for (const key of ['music', 'sound', 'vibrate', 'pattern']) {
    env.game.setSetting(key); assert.equal(env.game.getState().settings[key], !settings[key]);
  }
  env.advance(50000); env.game.switchScreen('play'); const state = env.game.getState();
  assert.deepEqual(gameplay(state), before); assert.equal(state.elapsed, 1200);
  assert.equal(env.configurations.length, 4); assert.deepEqual(env.saved().settings, state.settings);
  assert.equal(Object.hasOwn(state.settings, 'voice'), false); assert.equal(Object.hasOwn(env.saved().settings, 'voice'), false);
  env.game.stop();
});
