'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');

function setup(options) {
  options = options || {};
  let saved = options.saved || null, time = 1000, frame;
  const events = {}, calls = { submits: [], shows: [], scrolls: [], hides: 0, authorizes: [], settings: [], texts: [] };
  const ctx = new Proxy({ measureText: v => ({ width: [...String(v)].length * 10 }), fillText: value => calls.texts.push(String(value)) }, { get: (o, k) => o[k] || (() => {}) });
  const ranking = {
    available: options.available !== false,
    onPrivacyRequest(fn) { events.privacy = fn; },
    submit(score, done) { calls.submits.push({ ...score }); done({ success: true, queued: true }); },
    authorize(done) { calls.authorizes.push(done); if (!options.asyncAuth) done(options.denied ? { success: false, denied: true } : { success: true }); },
    openSettings(done) { calls.settings.push(done); },
    show(message) { calls.shows.push(message); return true; }, draw() {},
    scroll(delta) { calls.scrolls.push(delta); }, hide() { calls.hides++; }
  };
  const platform = {
    ctx, ranking, width: options.width || 390, height: options.height || 844, safeTop: options.safeTop || 0, safeBottom: options.safeBottom || 0,
    now: () => time, storage: { get: () => saved, set: (_, v) => { saved = JSON.parse(JSON.stringify(v)); } },
    vibrate() {}, requestFrame: fn => { frame = fn; }, onPointer: fn => { events.pointer = fn; }, onHide: fn => { events.hide = fn; }, onShow: fn => { events.show = fn; }
  };
  const game = startGame({ platform });
  function click(label) {
    game.render(); const b = game.getState().buttons.find(v => v.label === label); assert.ok(b, label);
    const point = { x: b.x + b.width / 2, y: b.y + b.height / 2, time };
    events.pointer({ ...point, type: 'down' }); events.pointer({ ...point, type: 'up' }); game.render();
  }
  return { game, calls, events, platform, click, advance: ms => { time += ms; }, frame: () => frame(), saved: () => saved };
}
function finish(env) {
  const level = levels.find(v => v.id === env.game.getState().levelId);
  level.solution.forEach((c, r) => env.game.placeCat(r * level.size + c));
  assert.equal(env.game.getState().screen, 'win');
}

test('入口与标题统一为排行榜，网页不伪造朋友、名次或云同步结果', () => {
  const m = setup({ available: false }); m.click('排行榜');
  assert.equal(m.game.getState().screen, 'ranking'); assert.equal(m.game.getState().ranking.status, 'local');
  assert.deepEqual(m.game.getState().ranking.score, { points: 0, completed: 0, totalTimeMs: 0 });
  assert.ok(m.calls.texts.includes('排行榜')); assert.ok(!m.calls.texts.includes('朋友排行榜'));
  assert.equal(m.calls.authorizes.length, 0); assert.equal(m.calls.shows.length, 0); assert.equal(m.calls.submits.length, 0); m.game.stop();
});

test('有效普通关卡计分，重玩不重复计数，更快成绩更新，教学及每日题不入榜', () => {
  const m = setup(); assert.equal(m.calls.submits.length, 0);
  m.game.startLevel(1); m.advance(1500); finish(m); assert.deepEqual(m.calls.submits.at(-1), { points: 5280, completed: 1, totalTimeMs: 1500 });
  m.game.startLevel(1); m.advance(2000); finish(m); assert.equal(m.calls.submits.length, 1);
  assert.deepEqual(m.game.getState().ranking.score, { points: 5280, completed: 1, totalTimeMs: 1500 });
  m.game.startLevel(1); m.advance(500); finish(m); assert.deepEqual(m.calls.submits.at(-1), { points: 5290, completed: 1, totalTimeMs: 500 });
  m.game.startLevel(2, true); m.advance(1000); finish(m); assert.equal(m.calls.submits.length, 2);
  m.game.startTutorial(); assert.equal(m.calls.submits.length, 2); m.game.stop();
});

test('旧有效成绩启动时提交，别名关卡只计一次并取最佳时间，非法记录不进榜', () => {
  const m = setup({ saved: { completed: { 1: { time: 800, hints: 0 }, '01': { time: 300, hints: 0 }, 2: { time: 1500, hints: 0 }, 0: { time: 20, hints: 0 }, 3: { time: -10, hints: 0 }, 4: { time: 20, hints: -1 } } } });
  assert.deepEqual(m.calls.submits, [{ points: 0, completed: 2, totalTimeMs: 1800 }]); m.game.stop();
});

test('别名关卡累计积分只取单关最高分，用时独立取最短，非法积分不加分', () => {
  const m = setup({ saved: { completed: { 1: { time: 800, hints: 0, score: 2400 }, '01': { time: 300, hints: 0, score: 1500 },
    2: { time: 1500, hints: 0, score: 3000 }, 3: { time: 700, hints: 0, score: -10 }, 4: { time: 200, hints: 0, score: '99999' } } } });
  assert.deepEqual(m.calls.submits, [{ points: 5400, completed: 4, totalTimeMs: 2700 }]); m.game.stop();
});

test('设置中看排行保存残局并暂停计时，两次返回仍回原棋盘', () => {
  const m = setup(); m.game.startLevel(13); m.game.toggleMark(0); m.advance(2000); m.game.openPage('settings');
  const before = m.saved().session; m.click('排行榜'); m.advance(12000);
  assert.equal(m.game.getState().elapsed, 2000); assert.deepEqual(m.saved().session, before);
  m.click('‹'); assert.equal(m.game.getState().screen, 'settings'); m.click('关闭');
  assert.equal(m.game.getState().screen, 'play'); assert.equal(m.game.getState().levelId, 13); assert.deepEqual(m.game.getState().marks, [0]);
  m.advance(1000); assert.equal(m.game.getState().elapsed, 3000); assert.equal(m.calls.hides, 1); m.game.stop();
});

test('授权拒绝不自动打开设置，用户点击微信设置后才重查并显示列表', () => {
  const m = setup({ denied: true }); m.click('排行榜');
  assert.equal(m.game.getState().ranking.status, 'denied'); assert.equal(m.calls.shows.length, 0); assert.equal(m.calls.settings.length, 0);
  m.frame(); assert.equal(m.calls.authorizes.length, 1);
  m.click('微信设置'); assert.equal(m.calls.settings.length, 1); m.calls.settings[0]({ success: true }); m.game.render();
  assert.equal(m.game.getState().ranking.status, 'ready'); assert.equal(m.calls.shows.length, 1); m.game.stop();
});

test('离开或后台后旧授权回调不打开列表，回前台需要显式重新查看', () => {
  const m = setup({ asyncAuth: true }); m.game.openRanking(); m.game.switchScreen('home'); m.calls.authorizes[0]({ success: true });
  assert.equal(m.calls.shows.length, 0); assert.equal(m.game.getState().screen, 'home');
  m.game.openRanking(); m.events.hide(); m.calls.authorizes[1]({ success: true }); assert.equal(m.calls.shows.length, 0);
  m.events.show(); assert.equal(m.game.getState().ranking.status, 'idle'); assert.equal(m.calls.authorizes.length, 2);
  m.click('刷新'); m.calls.authorizes[2]({ success: true }); assert.equal(m.calls.shows.length, 1); m.game.stop();
});

test('列表滑动转发滚动量，隐藏停止开放域，前台恢复后刷新列表', () => {
  const m = setup(); m.game.openRanking(); m.game.render(); const area = m.game.getState().ranking.area;
  const point = { x: area.x + 20, y: area.y + 80, time: 1000 };
  m.events.pointer({ ...point, type: 'down' }); m.events.pointer({ ...point, y: point.y - 35, type: 'move' }); m.events.pointer({ ...point, type: 'up' });
  assert.deepEqual(m.calls.scrolls, [35]); m.events.hide(); assert.equal(m.calls.hides, 1);
  m.events.show(); assert.equal(m.calls.shows.length, 2); assert.equal(m.calls.authorizes.length, 1); m.game.stop();
});

test('排行榜与三个首页入口在小屏和微信安全区内可用', () => {
  for (const dimensions of [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 375, height: 667 }, { width: 390, height: 844, safeTop: 80, safeBottom: 34 }]) {
    const m = setup({ ...dimensions, available: false });
    for (const label of ['新手教学', '排行榜', '小屋设置']) assert.ok(m.game.getState().buttons.some(v => v.label === label));
    m.click('排行榜'); const state = m.game.getState(), area = state.ranking.area;
    assert.ok(area.height >= 170); assert.ok(area.y + area.height <= dimensions.height - (dimensions.safeBottom || 0));
    for (const b of state.buttons) assert.ok(b.y >= (dimensions.safeTop || 0) && b.y + b.height <= dimensions.height - (dimensions.safeBottom || 0));
    m.game.stop();
  }
});

test('隐私弹层明确选择与链接，阅读或切后台不视为同意，返回后点击才继续', () => {
  const m = setup({ asyncAuth: true }); let agreed = 0, rejected = 0, opened = 0;
  m.game.openRanking(); m.events.privacy({
    contractName: '隐私保护指引', openContract() { opened++; },
    agree() { agreed++; m.calls.authorizes[0]({ success: true }); }, disagree() { rejected++; }
  });
  assert.equal(m.game.getState().ranking.privacyPending, true);
  m.click('查看隐私保护指引'); assert.equal(opened, 1); assert.equal(agreed, 0); assert.equal(rejected, 0);
  m.events.hide(); m.advance(20000); m.events.show(); assert.equal(m.game.getState().ranking.privacyPending, true); assert.equal(m.calls.shows.length, 0);
  m.click('同意并继续'); assert.equal(agreed, 1); assert.equal(m.game.getState().ranking.status, 'ready'); assert.equal(m.calls.shows.length, 1);
  m.game.stop(); assert.equal(rejected, 0);
});

test('暂不开启只拒绝隐私，不自动打开微信设置或读取朋友，可主动重试', () => {
  const m = setup({ asyncAuth: true }); m.game.openRanking(); let rejected = 0;
  m.events.privacy({ openContract() {}, agree() { assert.fail('未点击同意'); }, disagree() { rejected++; m.calls.authorizes[0]({ success: false, privacyDenied: true }); } });
  m.click('暂不开启'); assert.equal(rejected, 1); assert.equal(m.game.getState().ranking.status, 'privacyDenied'); assert.equal(m.game.getState().ranking.privacyPending, false);
  assert.equal(m.calls.settings.length, 0); assert.equal(m.calls.shows.length, 0);
  m.click('重新查看'); assert.equal(m.calls.authorizes.length, 2); m.game.stop();
});

test('离开排行榜或关闭游戏取消未决隐私，旧授权结果不会显示好友榜', () => {
  for (const close of ['leave', 'stop']) {
    const m = setup({ asyncAuth: true }); let rejected = 0; m.game.openRanking();
    m.events.privacy({ openContract() {}, agree() {}, disagree() { rejected++; m.calls.authorizes[0]({ success: false, privacyDenied: true }); } });
    if (close === 'leave') m.game.switchScreen('home'); else m.game.stop();
    assert.equal(rejected, 1); assert.equal(m.calls.shows.length, 0); assert.equal(m.game.getState().ranking.privacyPending, false);
    if (close === 'leave') { assert.equal(m.game.getState().screen, 'home'); m.game.stop(); }
  }
});

test('隐私说明三个选择按钮在最小微信安全区和普通屏幕可见', () => {
  for (const dimensions of [{ width: 320, height: 568, safeTop: 80, safeBottom: 34 }, { width: 390, height: 844 }]) {
    const m = setup({ ...dimensions, asyncAuth: true }); m.game.openRanking(); m.events.privacy({ openContract() {}, agree() {}, disagree() {} }); m.game.render();
    for (const label of ['查看隐私保护指引', '同意并继续', '暂不开启']) {
      const b = m.game.getState().buttons.find(v => v.label === label); assert.ok(b); assert.ok(b.y >= (dimensions.safeTop || 0)); assert.ok(b.y + b.height <= dimensions.height - (dimensions.safeBottom || 0));
    }
    m.game.stop();
  }
});
