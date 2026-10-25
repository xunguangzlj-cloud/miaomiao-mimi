'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../src/boot.js');

// 人工推进时钟和资源回调，验证真正进入游戏的时机，不读取玩家存档。
function setup(options = {}) {
  let now = Date.UTC(2026, 9, 13, 8), stored = null, reads = 0, writes = 0, randomCalls = 0;
  const frames = [], loads = [], packageRequests = [], hides = [], shows = [], pointers = [], ready = [], states = [], sounds = [];
  const ctx = new Proxy({
    measureText: value => ({ width: Array.from(String(value)).length * 12 }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 80, safeBottom: 34,
    now: () => now, requestFrame: callback => frames.push(callback),
    loadImage: (path, done) => { const request = { path, done }; loads.push(request); return null; },
    onHide: callback => hides.push(callback), onShow: callback => shows.push(callback),
    onPointer: callback => pointers.push(callback), vibrate() {},
    storage: { get() { reads++; return stored; }, set(_, value) { writes++; stored = structuredClone(value); return true; } }
  };
  const audio = { event: name => sounds.push(name), configure() {}, unlock() {}, pause() {}, resume() {}, destroy() {}, setMusicPaused() {} };
  const wx = options.wechat ? { loadSubpackage: request => { packageRequests.push(request); } } : null;
  const app = startApp({ platform, wx, audio, inputUI: { editNickname() {}, destroy() {} },
    random: () => { randomCalls++; return .6; }, onReady: controller => ready.push(controller),
    onState: state => states.push(structuredClone(state)), ...options.app });
  function advance(ms) {
    now += ms;
    assert.ok(frames.length, '存在待执行的动画帧'); frames.shift()();
  }
  function complete(path, bitmap = { width: 100, height: 100 }) {
    const request = loads.find(item => item.path === path);
    assert.ok(request, '已请求图片：' + path); request.done(bitmap);
  }
  function completeAll() {
    for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png',
      'splash-assets/garden-logo.png', 'splash-assets/loading-cat.png']) complete(path);
  }
  return { app, ready, states, loads, sounds, packageRequests, pointers, complete, completeAll, advance,
    hide: () => hides.slice().forEach(callback => callback()), show: () => shows.slice().forEach(callback => callback()),
    counts: () => ({ reads, writes, randomCalls }), stepWallClock: ms => { now += ms; } };
}

test('启动首帧显示固定随机名言与六个真实任务，尚未初始化存档、音效或游戏触摸', t => {
  const env = setup(); t.after(() => env.app.stop());
  const before = env.app.getState();
  assert.equal(before.screen, 'loading'); assert.equal(before.total, 6);
  assert.equal(before.completed, 1, '网页无需下载分包，分包任务先就绪'); assert.equal(before.progress, 0);
  assert.ok(before.quote.text && before.quote.author); assert.equal(before.layout.screen, 'loading');
  assert.deepEqual(env.counts(), { reads: 0, writes: 0, randomCalls: 1 });
  assert.equal(env.pointers.length, 0); assert.deepEqual(env.sounds, []); assert.equal(env.ready.length, 0);
  env.advance(1000); env.app.render();
  assert.deepEqual(env.app.getState().quote, before.quote, '每帧重绘不会改换名言');
  assert.equal(env.counts().randomCalls, 1); assert.equal(env.counts().writes, 0);
});

test('资源立即完成仍保留可见三秒和100毫秒收尾，进入首页后不计解题时间', t => {
  const env = setup(); t.after(() => env.app.stop()); env.completeAll();
  assert.equal(env.app.getState().completed, 6);
  env.advance(2999); assert.equal(env.app.getState().screen, 'loading'); assert.equal(env.ready.length, 0);
  env.advance(1); assert.equal(env.app.getState().screen, 'loading');
  env.advance(99); assert.equal(env.ready.length, 0);
  env.advance(1); assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
  assert.equal(env.app.getState().elapsed, 0); assert.equal(env.counts().reads, 1);
  env.advance(5000); assert.equal(env.ready.length, 1); assert.equal(env.app.getState().elapsed, 0);
  for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png']) {
    assert.equal(env.loads.filter(item => item.path === path).length, 1, '进入游戏复用已加载图片：' + path);
  }
  const progress = env.states.filter(state => state.screen === 'loading').map(state => state.progress);
  assert.equal(progress.at(-1), 1); assert.ok(progress.every((value, i) => value >= 0 && value <= 1 && (!i || value >= progress[i - 1])));
});

test('等待最后一张图片完成才收尾，不以三秒定时器冒充资源加载完成', t => {
  const env = setup(); t.after(() => env.app.stop());
  for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png', 'splash-assets/garden-logo.png']) env.complete(path);
  env.advance(4000); assert.equal(env.app.getState().completed, 5);
  assert.equal(env.ready.length, 0); assert.ok(env.app.getState().progress < 1);
  env.complete('splash-assets/loading-cat.png'); env.advance(1);
  assert.equal(env.ready.length, 0); env.advance(100);
  assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
});

test('微信先成功载入splash分包，再请求原logo和猫，重复成功回调不重复请求', t => {
  const env = setup({ wechat: true }); t.after(() => env.app.stop());
  assert.equal(env.packageRequests.length, 1); assert.equal(env.packageRequests[0].name, 'splash');
  assert.equal(env.loads.length, 3); assert.equal(env.app.getState().completed, 0);
  env.packageRequests[0].success(); env.packageRequests[0].success();
  assert.equal(env.loads.length, 5); assert.equal(env.app.getState().completed, 1);
  env.completeAll(); env.advance(3000); env.advance(100);
  assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
});

test('分包失败用占位图继续，失败后迟到的成功回调不能启动新的品牌下载', t => {
  const env = setup({ wechat: true }); t.after(() => env.app.stop());
  env.packageRequests[0].fail(); env.packageRequests[0].success();
  assert.equal(env.loads.length, 3);
  assert.deepEqual(env.app.getState().failed, ['splash-package', 'splash-assets/garden-logo.png', 'splash-assets/loading-cat.png']);
  for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png']) env.complete(path);
  env.advance(3000); env.advance(100);
  assert.equal(env.app.getState().screen, 'home'); assert.equal(env.ready.length, 1);
});

test('图片返回空值按失败任务结算，完成后仍可进入基础游戏', t => {
  const env = setup(); t.after(() => env.app.stop());
  env.completeAll();
  // 已完成任务的重复回调不应把成功状态回退为失败。
  env.complete('assets/fish_dim.png', null);
  assert.deepEqual(env.app.getState().failed, []);
  env.advance(3000); env.advance(100); assert.equal(env.ready.length, 1);

  const failed = setup(); t.after(() => failed.app.stop());
  for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png',
    'splash-assets/garden-logo.png', 'splash-assets/loading-cat.png']) failed.complete(path, null);
  assert.equal(failed.app.getState().completed, 6); assert.equal(failed.app.getState().failed.length, 5);
  failed.advance(3000); failed.advance(100); assert.equal(failed.app.getState().screen, 'home');
});

test('八秒未完成资源时安全降级，迟到的分包和图片回调不会再创建游戏', t => {
  const env = setup({ wechat: true }); t.after(() => env.app.stop());
  env.advance(7999); assert.equal(env.app.getState().screen, 'loading'); assert.equal(env.ready.length, 0);
  env.advance(1); assert.equal(env.app.getState().completed, 6); assert.equal(env.app.getState().failed.length, 6);
  env.advance(100); assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
  const count = env.loads.length;
  env.packageRequests[0].success(); env.complete('assets/animal-faces.png'); env.advance(1000);
  assert.equal(env.loads.length, count, '超时后不启动品牌下载'); assert.equal(env.ready.length, 1);
});

test('启动途中stop后所有迟到回调失效，没有存档写入或游戏初始化', () => {
  const env = setup({ wechat: true }); env.app.stop();
  env.packageRequests[0].success(); env.packageRequests[0].fail();
  for (const path of ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png']) env.complete(path);
  env.advance(20000); env.show(); env.hide();
  assert.equal(env.loads.length, 3); assert.equal(env.ready.length, 0);
  assert.deepEqual(env.counts(), { reads: 0, writes: 0, randomCalls: 1 }); assert.equal(env.pointers.length, 0);
});

test('切后台的等待时间不算可见展示时间，后台即使资源完成也不进入游戏', t => {
  const env = setup(); t.after(() => env.app.stop());
  env.advance(1000); env.hide(); env.completeAll(); env.advance(10000);
  assert.equal(env.ready.length, 0); assert.equal(env.counts().reads, 0); assert.equal(env.counts().writes, 0);
  env.show(); env.advance(1999); assert.equal(env.ready.length, 0);
  env.advance(1); assert.equal(env.ready.length, 0); env.advance(100);
  assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
});

test('100毫秒收尾期间切后台，返回后补完剩余收尾再进入游戏', t => {
  const env = setup(); t.after(() => env.app.stop()); env.completeAll(); env.advance(3000); env.advance(40);
  env.hide(); env.advance(20000); assert.equal(env.ready.length, 0); env.show();
  env.advance(59); assert.equal(env.ready.length, 0); env.advance(1);
  assert.equal(env.ready.length, 1); assert.equal(env.app.getState().screen, 'home');
});
