'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const { createAudio } = require('../src/audio.js');
const levels = require('../src/levels.js');
const copy = value => value === undefined ? undefined : structuredClone(value);

// 使用真实控制器验证旧存档和用户可见行为，避免只检索源码来证明功能移除。
function setup(saved, options = {}) {
  let stored = copy(saved), now = options.now === undefined ? Date.UTC(2026, 9, 13, 8) : options.now, frame;
  const texts = [], events = [], hooks = {};
  const ctx = new Proxy({
    measureText: value => ({ width: Array.from(String(value)).length * 10 }),
    fillText: value => texts.push(String(value)),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 80, safeBottom: 34,
    now: () => now, requestFrame: fn => { frame = fn; }, vibrate() {},
    onPointer: fn => { hooks.pointer = fn; }, onHide: fn => { hooks.hide = fn; }, onShow: fn => { hooks.show = fn; },
    storage: { get: () => copy(stored), set: (_, value) => { stored = copy(value); return true; } }
  };
  const audio = new Proxy({ event: name => events.push(name) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const game = startGame({ platform, audio, inputUI: { destroy() {}, editNickname() {} } });
  function render() { texts.length = 0; game.render(); return game.getState(); }
  function click(label) {
    const button = render().buttons.find(item => item.label === label);
    assert.ok(button, '存在按钮：' + label);
    const point = { x: button.x + button.width / 2, y: button.y + button.height / 2, time: now };
    hooks.pointer({ type: 'down', ...point }); hooks.pointer({ type: 'up', ...point }); now += 400;
    return render();
  }
  return { game, texts, events, render, click, saved: () => copy(stored), advance: ms => { now += ms; },
    frame: () => frame(), hide: () => hooks.hide(), show: () => hooks.show() };
}

const cells = level => level.solution.map((column, row) => row * level.size + column);
const cleanText = values => values.join('|').replace(/\s/g, '');
const noDetails = text => {
  assert.doesNotMatch(text, /首次通[过关]和打卡获得经验/);
  assert.doesNotMatch(text, /提示与助手每(?:升一级|升级一次)各补充1次/);
  assert.doesNotMatch(text, /累计各关最高分[.·。]?同分比较通关数和用时/);
};

test('新档和旧自动排除设置均不自动产生标记，保存时不再携带该设置', t => {
  for (const value of [undefined, true, false, 'true', 1, null]) {
    const env = setup(value === undefined ? undefined : { settings: { autoMark: value } });
    t.after(() => env.game.stop());
    assert.equal(Object.hasOwn(env.saved().settings, 'autoMark'), false, '启动即持久化清理废弃设置');
    assert.equal(env.saved().progression.inventoryDate, '2026-10-13', '启动即保存道具刷新日期');
    env.game.startLevel(1); assert.deepEqual(env.game.getState().marks, [], '预置猫不自动排除');
    env.game.startLevel(13); env.game.placeCat(cells(levels[12])[0]);
    assert.deepEqual(env.game.getState().marks, [], '正确放置不自动排除');
    assert.equal(Object.hasOwn(env.game.getState().settings, 'autoMark'), false);
    assert.equal(Object.hasOwn(env.saved().settings, 'autoMark'), false);
    assert.equal(env.events.includes('autoMark'), false);
  }
});

test('旧存档恢复保留已有手工叉，正确放猫和废弃设置调用不会添加排除叉', t => {
  const level = levels[12], answer = cells(level), mark = level.regions.findIndex((_, cell) => !answer.includes(cell));
  const env = setup({ settings: { autoMark: true }, session: { levelId: 13, levelSource: 'legacy-60',
    cats: [answer[0]], marks: [mark], errors: [], hearts: 3, hints: 0, elapsed: 1200, mode: 'mark' } });
  t.after(() => env.game.stop()); env.game.resume();
  assert.deepEqual(env.game.getState().marks, [mark]);
  env.game.placeCat(answer[1]); assert.deepEqual(env.game.getState().marks, [mark]);
  const before = env.game.getState(); env.game.setSetting('autoMark');
  assert.deepEqual(env.game.getState().settings, before.settings);
  assert.deepEqual(env.game.getState().marks, before.marks);
  assert.equal(env.events.includes('autoMark'), false);
});

test('自动排除已移除但付费提示预览和应用排除仍正常', t => {
  const env = setup(); t.after(() => env.game.stop()); env.game.startLevel(1);
  const before = env.game.getState(); assert.deepEqual(before.marks, []);
  env.game.hint(); const preview = env.game.getState();
  assert.equal(preview.pendingHint.kind, 'mark'); assert.ok(preview.pendingHint.cells.length > 1);
  assert.deepEqual(preview.marks, before.marks);
  assert.equal(preview.progression.inventory.hints, before.progression.inventory.hints - 1);
  const expected = preview.pendingHint.cells.slice().sort((a, b) => a - b);
  env.game.hint(); const applied = env.game.getState();
  assert.deepEqual(applied.marks.slice().sort((a, b) => a - b), expected);
  assert.equal(applied.progression.inventory.hints, preview.progression.inventory.hints);
  assert.equal(applied.pendingHint, null); assert.equal(env.events.includes('autoMark'), false);
});

test('设置、动物小屋、排行榜不再呈现废弃开关和三段说明', t => {
  const env = setup({ settings: { autoMark: true } }); t.after(() => env.game.stop());
  for (const page of ['settings', 'wardrobe', 'ranking']) {
    env.game.switchScreen('home'); env.game.openPage(page); const state = env.render(), text = cleanText(env.texts);
    noDetails(text); assert.doesNotMatch(text, /自动排除/);
    assert.equal(state.buttons.some(button => button.label === '自动排除'), false);
  }
});

test('七日礼盒仅展示神秘礼盒说明，点击不发奖且领取前后都不透露具体内容', t => {
  const env = setup(); t.after(() => env.game.stop());
  function verify() {
    env.game.switchScreen('home'); env.game.openPage('checkin'); env.render();
    assert.doesNotMatch(cleanText(env.texts), /(?:提示|助手)[×+＋]\d|经验[+＋]\d/);
    const before = env.game.getState().progression; env.click('七日礼盒');
    assert.ok(env.texts.includes('神秘礼盒~'));
    assert.doesNotMatch(cleanText(env.texts), /(?:提示|助手)[×+＋]\d|经验[+＋]\d/);
    assert.deepEqual(env.game.getState().progression, before, '点击礼盒不直接领取');
  }
  verify();
  for (let day = 1; day <= 7; day++) { assert.equal(env.game.claimCheckin().claimed, true); if (day < 7) env.advance(86400000); }
  verify();
});

test('废弃自动排除音频事件不再创建或播放声道', () => {
  let nodes = 0;
  const audio = createAudio({ wx: { createInnerAudioContext: () => { nodes++; return {}; } } });
  audio.unlock(); assert.equal(audio.event('autoMark'), false); assert.equal(nodes, 0); audio.destroy();
});

test('提示和助手各有三次，当日耗尽点击只显示等待明天刷新且不再加分扣命', t => {
  const env = setup(); t.after(() => env.game.stop()); env.game.startLevel(13);
  assert.deepEqual(env.game.getState().progression.inventory, { hints: 3, helpers: 3 });
  for (let count = 0; count < 3; count++) {
    env.game.hint(); assert.ok(env.game.getState().pendingHint); env.click('关闭');
  }
  const beforeHint = env.game.getState(); env.game.hint(); env.render();
  const exhaustedHint = env.game.getState();
  assert.equal(exhaustedHint.pendingHint, null); assert.equal(exhaustedHint.progression.inventory.hints, 0);
  assert.equal(exhaustedHint.hearts, beforeHint.hearts); assert.equal(exhaustedHint.score, beforeHint.score);
  assert.equal(exhaustedHint.hints, beforeHint.hints); assert.ok(env.texts.some(value => /等待明天刷新/.test(value)));
  for (let count = 0; count < 3; count++) env.game.locate();
  const beforeHelper = env.game.getState(); assert.equal(beforeHelper.progression.inventory.helpers, 0);
  env.game.locate(); env.render(); const exhaustedHelper = env.game.getState();
  assert.deepEqual(exhaustedHelper.cats, beforeHelper.cats); assert.deepEqual(exhaustedHelper.marks, beforeHelper.marks);
  assert.equal(exhaustedHelper.hearts, beforeHelper.hearts); assert.equal(exhaustedHelper.score, beforeHelper.score);
  assert.equal(exhaustedHelper.locates, beforeHelper.locates); assert.ok(env.texts.some(value => /等待明天刷新/.test(value)));
  const reread = setup(env.saved()); t.after(() => reread.game.stop());
  assert.deepEqual(reread.game.getState().progression.inventory, { hints: 0, helpers: 0 }, '同日读档不补回');
});

test('北京自然日跨零点由前台帧和后台返回刷新各三次并写入存档', t => {
  for (const background of [false, true]) {
    const env = setup(undefined, { now: Date.UTC(2026, 9, 13, 15, 59, 59) }); t.after(() => env.game.stop());
    env.game.startLevel(13); env.game.hint(); env.click('关闭'); env.game.locate();
    assert.deepEqual(env.game.getState().progression.inventory, { hints: 2, helpers: 2 });
    const before = env.game.getState();
    if (background) env.hide();
    env.advance(2000);
    if (background) env.show(); else env.frame();
    const after = env.game.getState();
    assert.deepEqual(after.progression.inventory, { hints: 3, helpers: 3 });
    assert.equal(after.progression.inventoryDate, '2026-10-14');
    assert.deepEqual(env.saved().progression.inventory, { hints: 3, helpers: 3 });
    assert.equal(env.saved().progression.inventoryDate, '2026-10-14');
    assert.equal(after.hearts, before.hearts); assert.equal(after.score, before.score);
    assert.deepEqual(after.cats, before.cats); assert.deepEqual(after.marks, before.marks);
  }
});
