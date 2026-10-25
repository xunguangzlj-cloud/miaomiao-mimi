'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const progress = require('../src/progression.js');
const levels = require('../src/levels.js');
const KEY = 'miaoge-home-v1';
const copy = value => JSON.parse(JSON.stringify(value));

// 使用真实控制器和触摸入口，测试弹窗命中；不读取或修改真实玩家存档。
function setup(options = {}) {
  let now = Date.UTC(2026, 9, 13, 8);
  const hooks = {}, progression = progress.hydrate();
  if (options.xp) progression.xp = options.xp;
  if (options.inventory) progression.inventory = copy(options.inventory);
  let stored = Object.assign({ unlocked: 1, completed: {}, daily: {}, tutorialDone: true, progression }, copy(options.saved || {}));
  const ctx = new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: Array.from(String(value)).length * 10 })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const platform = Object.assign({
    ctx, width: 390, height: 844, safeTop: 0, safeBottom: 0,
    storage: { get: key => key === KEY ? copy(stored) : null, set: (key, value) => { assert.equal(key, KEY); stored = copy(value); return true; } },
    now: () => now, requestFrame() {}, vibrate() {},
    onPointer: callback => { hooks.pointer = callback; }, onHide() {}, onShow() {}
  }, options);
  const silent = new Proxy({}, { get: () => () => {} });
  const game = startGame({ platform, audio: silent, inputUI: { editNickname() {}, destroy() {} } });
  function tap(point) {
    hooks.pointer({ type: 'down', x: point.x, y: point.y, time: now });
    hooks.pointer({ type: 'up', x: point.x, y: point.y, time: now });
    now += 400;
  }
  function button(label) {
    game.render(); const result = game.getState().buttons.find(item => item.label === label);
    assert.ok(result, '存在按钮：' + label); return result;
  }
  function click(label) { const b = button(label); tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); }
  return { game, platform, tap, button, click, saved: () => copy(stored) };
}

function gameplay(state) {
  return { cats: state.cats, marks: state.marks, errors: state.errors, hearts: state.hearts,
    hints: state.hints, steps: state.steps, score: state.score, combo: state.combo, manual: state.manual, assisted: state.assisted };
}
function cellPoint(board, cell) { return { x: board.x + (cell % board.n + .5) * board.cell, y: board.y + (Math.floor(cell / board.n) + .5) * board.cell }; }
function assertButtonsSeparate(env, name) {
  env.game.render(); const buttons = env.game.getState().buttons, p = env.platform;
  for (let i = 0; i < buttons.length; i++) {
    const a = buttons[i];
    assert.ok(a.width > 0 && a.height > 0, name + ' ' + a.label + ' 命中区域为正');
    assert.ok(a.x >= 0 && a.x + a.width <= p.width, name + ' ' + a.label + ' 水平不越界');
    assert.ok(a.y >= p.safeTop && a.y + a.height <= p.height - p.safeBottom, name + ' ' + a.label + ' 保留安全区');
    for (let j = i + 1; j < buttons.length; j++) {
      const b = buttons[j], overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlap, false, name + ' ' + a.label + ' 与 ' + b.label + ' 按钮不重叠');
    }
  }
}

test('提示蒙层点击棋盘仅关闭提示，两种操作模式均不打叉、不放猫、不扣命', () => {
  for (const mode of ['×  标记', '猫  放置']) {
    const env = setup(); env.game.startLevel(9); env.click(mode); env.game.hint(); env.game.render();
    const before = env.game.getState(); assert.ok(before.pendingHint);
    const level = levels.find(item => item.id === 9), wrong = level.regions.findIndex((_, cell) => level.solution[Math.floor(cell / level.size)] !== cell % level.size);
    env.tap(cellPoint(before.board, wrong));
    const after = env.game.getState(); assert.equal(after.pendingHint, null);
    assert.deepEqual(gameplay(after), gameplay(before)); assert.deepEqual(after.progression.inventory, before.progression.inventory);
    env.game.stop();
  }
});

test('提示应用按钮仍执行确定的一步并且全流程仅消耗一次提示', () => {
  const env = setup(); env.game.startLevel(9); const initial = env.game.getState();
  env.game.hint(); const preview = env.game.getState(); assert.equal(preview.pendingHint.kind, 'place');
  env.click('应用'); const applied = env.game.getState();
  assert.equal(applied.pendingHint, null); assert.ok(applied.cats.includes(preview.pendingHint.cell));
  assert.equal(applied.steps, initial.steps + 1); assert.equal(applied.hints, initial.hints + 1);
  assert.equal(applied.progression.inventory.hints, initial.progression.inventory.hints - 1);
  assert.equal(applied.assisted, 1); assert.ok(applied.score > initial.score); env.game.stop();
});

test('查看有效提示即记次数并持久化，关闭后不能用一次库存无限预览答案', () => {
  const env = setup({ inventory: { hints: 1, helpers: 5 } }); env.game.startLevel(9);
  env.game.hint(); const preview = env.game.getState(); assert.ok(preview.pendingHint);
  assert.equal(preview.progression.inventory.hints, 0); assert.equal(preview.hints, 1);
  assert.equal(env.saved().progression.inventory.hints, 0); assert.equal(env.saved().session.hints, 1);
  env.click('关闭'); const closed = env.game.getState(); assert.equal(closed.pendingHint, null);
  assert.equal(closed.progression.inventory.hints, 0); assert.equal(closed.hints, 1);
  env.game.hint(); const exhausted = env.game.getState(); assert.equal(exhausted.pendingHint, null);
  assert.deepEqual(gameplay(exhausted), gameplay(closed)); assert.equal(exhausted.progression.inventory.hints, 0);
  env.game.stop();
});

test('320×568、320×520 安全区及常见竖屏下弹窗按钮不越界、不相互重叠', () => {
  for (const size of [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 320, height: 520, safeTop: 80, safeBottom: 34 },
    { width: 375, height: 667 }, { width: 390, height: 844, safeTop: 80, safeBottom: 34 }]) {
    const env = setup(size), name = size.width + '×' + size.height;
    for (const page of ['settings', 'profile', 'wardrobe']) {
      env.game.switchScreen('home'); env.game.openPage(page); assertButtonsSeparate(env, name + ' ' + page);
      if (page === 'profile') { env.click('头像框'); assertButtonsSeparate(env, name + ' 头像框'); }
      if (page === 'wardrobe') { env.click('小屋主题'); assertButtonsSeparate(env, name + ' 小屋主题'); }
    }
    env.game.stop();
  }
});

test('设置只保留音乐、音效和震动三个开关，旧人声设置不会恢复或出现入口', () => {
  const env = setup({ saved: { settings: { voice: true, music: false, sound: true, vibrate: true } } });
  env.game.openPage('settings'); env.game.render(); const state = env.game.getState();
  assert.deepEqual(state.buttons.filter(item => ['音乐', '音效', '震动', '人声'].includes(item.label)).map(item => item.label), ['音乐', '音效', '震动']);
  assert.equal(Object.hasOwn(state.settings, 'voice'), false);
  for (const [label, key] of [['音乐', 'music'], ['音效', 'sound'], ['震动', 'vibrate']]) {
    const before = env.game.getState().settings[key]; env.click(label);
    assert.equal(env.game.getState().settings[key], !before); assert.equal(env.saved().settings[key], !before);
  }
  assert.equal(Object.hasOwn(env.saved().settings, 'voice'), false); env.game.stop();
});

test('小屏反馈按钮左右上半部均进入反馈，不能误打开玩法或排行榜', () => {
  for (const size of [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 320, height: 520, safeTop: 80, safeBottom: 34 }]) {
    const env = setup(size);
    for (const ratio of [.2, .8]) {
      env.game.switchScreen('home'); env.game.openPage('settings'); const b = env.button('反馈');
      env.tap({ x: b.x + b.width * ratio, y: b.y + 5 }); assert.equal(env.game.getState().screen, 'feedback');
    }
    env.game.stop();
  }
});

test('本机反馈在重启后的开始关卡和后续保存中保留', () => {
  const env = setup(); env.game.openPage('settings'); env.click('反馈'); env.click('操作不顺手');
  const feedback = env.saved().feedback;
  assert.deepEqual(feedback, { kind: '操作不顺手', levelId: 1, date: '2026-10-13' });
  assert.equal(env.game.getState().screen, 'settings'); env.game.stop();
  const resumed = setup({ saved: env.saved() }); resumed.game.startLevel(9);
  assert.deepEqual(resumed.saved().feedback, feedback);
  resumed.game.openPage('settings'); resumed.click('图案模式');
  assert.deepEqual(resumed.saved().feedback, feedback); resumed.game.stop();
});

test('两排头像全部可实际点击选中，资料确认不会误选第二排头像', () => {
  for (const size of [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 320, height: 520, safeTop: 80, safeBottom: 34 }]) {
    const env = setup(size); env.game.openPage('profile');
    for (const item of progress.AVATARS) {
      env.click(item.name); assert.equal(env.game.getState().progression.profile.avatar, item.id);
      assert.equal(env.saved().progression.profile.avatar, item.id); assert.equal(env.game.getState().screen, 'profile');
    }
    const chosen = env.game.getState().progression.profile.avatar;
    env.click('确认'); assert.equal(env.game.getState().screen, 'home'); assert.equal(env.saved().progression.profile.avatar, chosen);
    env.game.stop();
  }
});

test('达到等级后头像框和界面主题可从对应页签实际选中并保存', () => {
  const env = setup({ xp: 15000, width: 320, height: 520, safeTop: 80, safeBottom: 34 });
  const playerLevel = progress.levelInfo(env.game.getState().progression.xp).level;
  assert.ok(progress.FRAMES.concat(progress.THEMES).every(item => item.level <= playerLevel));
  env.game.openPage('profile'); env.click('头像框');
  for (const item of progress.FRAMES) {
    env.click(item.name); assert.equal(env.game.getState().progression.profile.frame, item.id);
    assert.equal(env.saved().progression.profile.frame, item.id); assert.equal(env.game.getState().screen, 'profile');
  }
  env.click('确认'); env.game.openPage('wardrobe'); env.click('小屋主题');
  for (let page = 0; page < Math.ceil(progress.THEMES.length / 6); page++) {
    if (page) env.click('下一页');
    for (const item of progress.THEMES.slice(page * 6, page * 6 + 6)) {
      env.click(item.name); assert.equal(env.game.getState().progression.theme, item.id);
      assert.equal(env.saved().progression.theme, item.id); assert.equal(env.game.getState().screen, 'wardrobe');
    }
  }
  const chosen = env.saved().progression;
  env.click('确认'); assert.equal(env.game.getState().screen, 'home'); env.game.stop();
  const resumed = setup({ saved: env.saved(), width: 320, height: 520, safeTop: 80, safeBottom: 34 });
  assert.equal(resumed.game.getState().progression.profile.frame, chosen.profile.frame);
  assert.equal(resumed.game.getState().progression.theme, chosen.theme);
  resumed.game.openPage('wardrobe'); resumed.click('小屋主题');
  resumed.button(progress.THEMES.at(-1).name);
  resumed.click('上一页'); resumed.button(progress.THEMES[0].name); resumed.game.stop();
});

test('设置、资料和动物小屋的暗层不能透过弹窗操作下方棋盘', () => {
  for (const page of ['settings', 'profile', 'wardrobe']) {
    const env = setup(); env.game.startLevel(9); env.click('猫  放置'); env.game.openPage(page); env.game.render();
    const before = env.game.getState(), b = before.board;
    assert.ok(b); env.tap({ x: b.x + b.size - 1, y: b.y + b.size - 1 });
    assert.deepEqual(gameplay(env.game.getState()), gameplay(before)); env.game.stop();
  }
});
