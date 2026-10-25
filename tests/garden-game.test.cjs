'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const { startApp } = require('../src/boot.js');
const original = require('../src/level-data.js'), legacy = require('../src/levels.js');
const progress = require('../src/progression.js');
const KEY = 'miaoge-home-v1', DAY = 86400000;
const copy = value => structuredClone(value);
const COLORS = ['#E8BC45', '#AED68F', '#69BBDD', '#F7B7CF', '#5D78AF', '#F8A569', '#4AB2B1', '#92CBB3', '#C0B7DD', '#E4C56C', '#8FAFD1', '#BC987F'];
const DIMENSIONS = [
  { width: 320, height: 520, safeTop: 80, safeBottom: 34 },
  { width: 320, height: 568, safeTop: 80, safeBottom: 34 },
  { width: 363, height: 607, safeTop: 0, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 80, safeBottom: 34 },
  { width: 390, height: 844, safeTop: 0, safeBottom: 0 },
  { width: 430, height: 932, safeTop: 54, safeBottom: 34 }
];

// 使用真实控制器、人工时钟和独立存档，禁止数字被当作Canvas颜色。
function setup(options = {}) {
  let now = Date.UTC(2026, 9, 13, 8), stored = options.saved === undefined ? null : copy(options.saved), game;
  const frames = [], text = [], colors = [], drawnImages = [], hooks = {}, context = {};
  const fontSize = () => Number(String(context.font || '').match(/([\d.]+)px/)?.[1] || 13);
  context.measureText = value => ({ width: Array.from(String(value)).reduce((sum, char) => sum + fontSize() * (/^[\x00-\x7F]$/.test(char) ? .55 : 1), 0) });
  context.fillText = value => text.push(String(value));
  context.drawImage = (bitmap, ...args) => drawnImages.push({ file: bitmap.file, args });
  context.createLinearGradient = context.createRadialGradient = () => ({ addColorStop() {} });
  const ctx = new Proxy(context, {
    get: (target, name) => name in target ? target[name] : () => {},
    set(target, name, value) {
      if (name === 'fillStyle') { assert.notEqual(typeof value, 'number', 'Canvas不能把colorMap数字直接当颜色'); colors.push(value); }
      target[name] = value; return true;
    }
  });
  const platform = Object.assign({
    ctx, width: 390, height: 844, safeTop: 80, safeBottom: 34,
    now: () => now, requestFrame: callback => frames.push(callback), vibrate() {},
    onPointer: callback => { hooks.pointer = callback; }, onHide: callback => { hooks.hide = callback; }, onShow: callback => { hooks.show = callback; },
    loadImage: (file, done) => { const bitmap = { file, width: 1180, height: 752 }; done(bitmap); return bitmap; },
    storage: { get: key => { assert.equal(key, KEY); return copy(stored); }, set: (key, value) => { assert.equal(key, KEY); stored = copy(value); return true; } }
  }, options.dimensions || {});
  const audio = new Proxy({}, { get: () => () => {} });
  const settings = { platform, levels: original, audio, inputUI: { editNickname() {}, destroy() {} } };
  const controller = options.boot ? startApp({ ...settings, minDurationMs: 0, onReady: result => { game = result; } }) : (game = startGame(settings));
  function render() { text.length = 0; colors.length = 0; drawnImages.length = 0; game.render(); return game.getState(); }
  function click(label) {
    const state = render(), button = state.buttons.find(item => item.label === label);
    assert.ok(button, '存在按钮：' + label);
    const point = { x: button.x + button.width / 2, y: button.y + button.height / 2, time: now };
    hooks.pointer({ type: 'down', ...point }); hooks.pointer({ type: 'up', ...point }); now += 400;
  }
  function step(ms) { now += ms; assert.ok(frames.length); frames.shift()(); }
  return { get game() { return game; }, controller, platform, text, colors, drawnImages, render, click, step,
    advance: ms => { now += ms; }, saved: () => copy(stored), stop: () => controller.stop() };
}

const solutionCells = level => level.solution.map((column, row) => row * level.size + column);
const record = (score, time = 12000) => ({ score, time, hints: 0, steps: 1, locates: 0, revives: 0 });

test('正式启动器使用99关卡，新局存储original-99，重新进入保持同棋盘和操作状态', t => {
  const boot = setup({ boot: true }); t.after(boot.stop);
  assert.equal(boot.controller.getState().screen, 'loading'); boot.step(0); boot.step(100);
  assert.ok(boot.game); boot.game.startLevel(1); const first = boot.render();
  assert.equal(first.board.n, 4); assert.deepEqual(first.cats, [7]); assert.equal(boot.saved().session.levelSource, 'original-99');
  assert.ok(boot.text.includes('1'), '原首关已经绘制');
  boot.game.startLevel(2); boot.game.placeCat(solutionCells(original[1])[1]); boot.game.toggleMark(0); boot.advance(1350);
  boot.game.switchScreen('home'); const saved = boot.saved();
  assert.equal(saved.session.levelSource, 'original-99'); assert.equal(saved.session.levelId, 2);
  const reread = setup({ saved }); t.after(reread.stop); reread.game.resume(); const after = reread.render();
  assert.equal(after.board.n, 5); assert.deepEqual(after.cats, saved.session.cats); assert.deepEqual(after.marks, saved.session.marks);
  assert.equal(after.elapsed, saved.session.elapsed); assert.equal(after.score, saved.session.score);
  assert.deepEqual(after.progression.inventory, saved.progression.inventory);
});

test('缺失levelSource和明确legacy-60的旧残局都继续旧题，猫、标记、时间及资料不被重置', t => {
  for (const marker of [undefined, 'legacy-60']) {
    const progression = progress.hydrate(); progression.xp = 1500; progression.inventory = { hints: 2, helpers: 3 };
    progression.profile.nickname = '老喵友';
    const session = { levelId: 1, daily: false, date: '2026-10-13', cats: [...legacy[0].given, 0], marks: [1, 2, 3],
      errors: [5], hearts: 2, hints: 1, steps: 4, locates: 0, revives: 0, elapsed: 24680, mode: 'mark', score: 1200, combo: 1, manual: 1, assisted: 0 };
    if (marker) session.levelSource = marker;
    const env = setup({ saved: { unlocked: 9, completed: { 8: record(5000) }, daily: {}, tutorialDone: true, settings: { autoMark: false }, progression, session } });
    t.after(env.stop); env.game.resume(); const before = env.render();
    assert.equal(before.board.n, legacy[0].size); assert.notEqual(before.board.n, original[0].size);
    assert.deepEqual(before.cats, session.cats); assert.deepEqual(before.marks, session.marks); assert.deepEqual(before.errors, session.errors);
    assert.equal(before.elapsed, session.elapsed); assert.equal(before.score, 1200); assert.equal(before.hearts, 2);
    assert.equal(before.progression.xp, 1500); assert.deepEqual(before.progression.inventory, { hints: 2, helpers: 3 });
    assert.equal(before.progression.profile.nickname, '老喵友'); assert.equal(before.ranking.score.points, 5000);
    env.game.switchScreen('home'); const saved = env.saved(); assert.equal(saved.session.levelSource, 'legacy-60');
    assert.deepEqual(saved.session.cats, session.cats); assert.deepEqual(saved.session.marks, session.marks); assert.equal(saved.session.elapsed, session.elapsed);
    env.game.startLevel(1); const fresh = env.render(); assert.equal(fresh.board.n, 4); assert.equal(env.saved().session.levelSource, 'original-99');
  }
});

test('99关边界保留已解锁、99号成绩和成长数据，100号非法记录不进入榜单', t => {
  const progression = progress.hydrate(); progression.xp = 5000; progression.inventory = { hints: 7, helpers: 9 };
  progression.cleared = [1, 60, 98, 99]; progression.profile.nickname = '九九喵友';
  const saved = { unlocked: 150, completed: { 1: record(1000), 60: record(2000), 98: record(3000), 99: record(4000), 100: record(999999) },
    daily: { '2026-10-12': record(3500) }, tutorialDone: true, progression };
  const env = setup({ saved }); t.after(env.stop); const state = env.render();
  assert.equal(state.unlocked, 99); assert.equal(state.progression.xp, 5000); assert.deepEqual(state.progression.cleared, [1, 60, 98, 99]);
  assert.deepEqual(state.progression.inventory, { hints: 3, helpers: 3 }); assert.equal(state.progression.profile.nickname, '九九喵友');
  assert.equal(state.ranking.score.completed, 4); assert.equal(state.ranking.score.points, 10000);
  env.game.switchScreen('home'); assert.ok(env.saved().completed[99]); assert.equal(env.saved().completed[100], undefined);
  assert.deepEqual(env.saved().daily, saved.daily); env.click('关卡');
  const page = env.render(); assert.ok(env.text.includes('9 / 9'));
  assert.ok(page.buttons.some(button => button.label.startsWith('99'))); assert.equal(page.buttons.some(button => button.label.startsWith('100')), false);
});

test('99关通关只解锁到99、首次经验只发一次，重新读档和重玩不补库存', t => {
  const progression = progress.hydrate(); progression.xp = 1500; progression.inventory = { hints: 2, helpers: 4 };
  const env = setup({ saved: { unlocked: 99, completed: {}, daily: {}, tutorialDone: true, progression } }); t.after(env.stop);
  env.game.startLevel(99); solutionCells(original[98]).forEach(cell => env.game.placeCat(cell)); const clear = env.render();
  assert.equal(clear.screen, 'win'); assert.equal(clear.unlocked, 99); assert.equal(clear.clearReward.rewarded, true);
  assert.equal(clear.clearReward.reward.xp, 200); assert.ok(clear.progression.cleared.includes(99));
  assert.equal(clear.clearReward.reward.hints, 0); assert.equal(clear.clearReward.reward.helpers, 0);
  assert.deepEqual(clear.progression.inventory, { hints: 2, helpers: 3 });
  const saved = env.saved(), reread = setup({ saved }); t.after(reread.stop);
  assert.deepEqual(reread.game.getState().progression.inventory, clear.progression.inventory); assert.equal(reread.game.getState().progression.xp, clear.progression.xp);
  reread.game.startLevel(99); solutionCells(original[98]).forEach(cell => reread.game.placeCat(cell)); const repeated = reread.render();
  assert.equal(repeated.clearReward.rewarded, false); assert.equal(repeated.clearReward.reason, 'already_claimed');
  assert.equal(repeated.progression.xp, clear.progression.xp); assert.deepEqual(repeated.progression.inventory, clear.progression.inventory); assert.equal(repeated.unlocked, 99);
});

test('七天打卡保留经验与盆栽成长，不额外补次数，断签不倒退累计进度', t => {
  const env = setup(); t.after(env.stop); let seventh;
  for (let day = 1; day <= 7; day++) {
    const before = env.game.getState().progression;
    const reward = env.game.claimCheckin(); assert.equal(reward.claimed, true); assert.equal(reward.day, day);
    const after = env.game.getState().progression; assert.equal(after.checkin.total, day);
    if (day === 7) {
      seventh = reward;
      assert.equal(reward.reward.xp, 200); assert.equal(after.xp - before.xp, 200);
      assert.equal(reward.reward.hints, 0); assert.equal(reward.reward.helpers, 0);
      assert.deepEqual(after.inventory, before.inventory);
    }
    if (day < 7) env.advance(DAY);
  }
  assert.equal(seventh.streak, 7); assert.equal(seventh.best, 7);
  const signed = env.game.getState().progression; assert.equal(env.game.claimCheckin().claimed, false);
  assert.deepEqual(env.game.getState().progression, signed, '同日礼盒不能重复领取');
  env.advance(DAY * 2); const resumed = env.game.claimCheckin();
  assert.equal(resumed.streak, 1); assert.equal(resumed.best, 7); assert.equal(env.game.getState().progression.checkin.total, 8);
  const reread = setup({ saved: env.saved() }); t.after(reread.stop);
  assert.equal(reread.game.getState().progression.checkin.total, 8); assert.equal(reread.game.getState().progression.checkin.best, 7);
});

test('原首两题数字colorMap实际转为颜色字符串，棋盘与动物进度色都可正确绘制', t => {
  const env = setup(); t.after(env.stop);
  for (const level of original.slice(0, 2)) {
    env.game.startLevel(level.id); env.render();
    assert.ok(level.colorMap.every(index => Number.isInteger(index) && index >= 0 && index <= 11));
    for (const index of level.colorMap) assert.ok(env.colors.includes(COLORS[index]), '原色块实际绘制：' + level.id + '/' + index);
    assert.equal(env.colors.some(color => typeof color === 'number'), false);
  }
});

test('六种视口下打卡排版与礼盒命中区保留安全区，礼盒提示正确且点击不发奖', t => {
  for (const dimensions of DIMENSIONS) {
    const env = setup({ dimensions }); t.after(env.stop); env.game.openPage('checkin');
    let state = env.render(); assert.equal(state.layout.screen, 'checkin');
    let previous = null;
    for (const name of ['title', 'yarn', 'number', 'label', 'best', 'week', 'reward', 'primary']) {
      const block = state.layout[name]; assert.ok(Number.isFinite(block.top) && Number.isFinite(block.bottom));
      assert.ok(block.top >= dimensions.safeTop && block.bottom <= dimensions.height - dimensions.safeBottom, '打卡块保留安全区：' + name);
      assert.ok(block.bottom >= block.top, '打卡块高度非负：' + name);
      if (previous) assert.ok(previous.bottom <= block.top + .001, '打卡块不重叠：' + name); previous = block;
    }
    for (const button of state.buttons) {
      assert.ok(button.x >= 0 && button.x + button.width <= dimensions.width);
      assert.ok(button.y >= dimensions.safeTop && button.y + button.height <= dimensions.height - dimensions.safeBottom, '命中区安全：' + button.label);
    }
    assert.ok(env.drawnImages.some(image => image.file === 'garden-assets/plant-growth.png'), '打卡页绘制真正盆栽图集');
    assert.equal(env.text.some(value => /提示×|助手×|经验\+/.test(value)), false);
    const before = state.progression; env.click('七日礼盒'); state = env.render();
    assert.ok(env.text.includes('神秘礼盒~'));
    assert.equal(env.text.some(value => /提示×|助手×|经验\+/.test(value)), false);
    assert.deepEqual(state.progression, before, '礼盒说明点击不直接领取奖励');
  }
});
