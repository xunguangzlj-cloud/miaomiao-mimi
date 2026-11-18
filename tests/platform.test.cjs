'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');

function wechatMock(options) {
  options = options || {};
  const events = {}, stored = new Map();
  const info = Object.assign({ windowWidth: 390, windowHeight: 844, pixelRatio: 4, safeArea: { top: 47, bottom: 810 } }, options.info);
  const canvas = { getContext() { return { scale(x, y) { canvas.scale = [x, y]; } }; } };
  const wx = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => info,
    getMenuButtonBoundingClientRect: () => ({ bottom: options.menuBottom === undefined ? 79 : options.menuBottom }),
    getStorageSync: key => stored.has(key) ? stored.get(key) : '',
    setStorageSync: (key, value) => stored.set(key, value),
    onTouchStart: fn => { events.down = fn; }, onTouchMove: fn => { events.move = fn; },
    onTouchEnd: fn => { events.up = fn; }, onTouchCancel: fn => { events.cancel = fn; },
    onHide: fn => { events.hide = fn; }, onShow: fn => { events.show = fn; },
    vibrateShort: value => { events.vibration = value; }
  };
  if (options.modern !== false) wx.getWindowInfo = () => info;
  const sandbox = { wx, module: { exports: {} }, Date, setTimeout, requestAnimationFrame: fn => { events.frame = fn; return 7; } };
  vm.runInNewContext(source, sandbox);
  return { platform: sandbox.module.exports.createPlatform(), events, canvas, stored, wx };
}

function browserMock() {
  const events = {}, stored = new Map();
  const canvas = {
    style: {}, clientWidth: 390, clientHeight: 844, getContext: () => ({ scale() {} }),
    addEventListener: (event, fn) => { events[event] = fn; }, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 20, top: 10, width: 195, height: 422 })
  };
  const window = {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    navigator: { vibrate: value => { events.vibration = value; } },
    localStorage: { getItem: key => stored.has(key) ? stored.get(key) : null, setItem: (key, value) => stored.set(key, value) }
  };
  const document = { getElementById: () => canvas, hidden: false, addEventListener: (event, fn) => { (events[event] ||= []).push(fn); } };
  vm.runInNewContext(source, { window, document, Date, setTimeout });
  return { platform: window.MeowPlatform.createPlatform(), canvas, events, stored, window, document };
}

const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
function touchHarness() {
  const mock = wechatMock(), pointers = [];
  mock.platform.onPointer(event => pointers.push(event));
  return Object.assign(mock, { pointers });
}

test('微信新窗口 API 返回逻辑宽高', () => {
  const { platform } = wechatMock(); assert.equal(platform.width, 390); assert.equal(platform.height, 844);
});
test('旧基础库回退系统信息 API', () => {
  const { platform } = wechatMock({ modern: false }); assert.equal(platform.width, 390); assert.equal(platform.height, 844);
});
test('像素比最多为 3，画布与上下文同步缩放', () => {
  const { platform, canvas } = wechatMock(); assert.equal(platform.pixelRatio, 3); assert.equal(canvas.width, 1170); assert.equal(canvas.height, 2532); assert.equal(canvas.scale[0], 3);
});
test('缺少安全区时兼容状态栏', () => {
  const { platform } = wechatMock({ info: { safeArea: undefined, statusBarHeight: 24 }, menuBottom: 0 }); assert.equal(platform.safeTop, 24); assert.equal(platform.safeBottom, 0);
});
test('安全区按窗口相对屏幕的偏移换算', () => {
  const { platform } = wechatMock({ info: { screenTop: 20, windowHeight: 824 }, menuBottom: 0 }); assert.equal(platform.safeTop, 27); assert.equal(platform.safeBottom, 34);
});
test('顶部内容避开微信胶囊', () => {
  const { platform } = wechatMock(); assert.equal(platform.safeTop, 87); assert.equal(platform.safeBottom, 34);
});
test('只跟踪第一根手指', () => {
  const m = touchHarness(); m.events.down({ changedTouches: [touch(1, 10, 20)] }); m.events.down({ changedTouches: [touch(2, 40, 50)] }); assert.equal(m.pointers.length, 1); assert.equal(m.pointers[0].x, 10);
});
test('忽略其他手指移动', () => {
  const m = touchHarness(); m.events.down({ changedTouches: [touch(1, 10, 20)] }); m.events.move({ changedTouches: [touch(2, 60, 70)] }); m.events.move({ changedTouches: [touch(1, 15, 25)] }); assert.equal(m.pointers.length, 2); assert.equal(m.pointers[1].x, 15);
});
test('抬起后允许新手指', () => {
  const m = touchHarness(); m.events.down({ changedTouches: [touch(1, 10, 20)] }); m.events.up({ changedTouches: [touch(1, 10, 20)] }); m.events.down({ changedTouches: [touch(2, 30, 40)] }); assert.equal(m.pointers.length, 3); assert.equal(m.pointers[2].x, 30);
});
test('取消其他手指不会中断当前手势', () => {
  const m = touchHarness(); m.events.down({ changedTouches: [touch(1, 10, 20)] }); m.events.cancel({ changedTouches: [touch(2, 30, 40)] }); m.events.move({ changedTouches: [touch(1, 15, 25)] }); assert.equal(m.pointers.length, 2); assert.equal(m.pointers[1].type, 'move');
});
test('无坐标取消事件使用最后触点并释放手势', () => {
  const m = touchHarness(); m.events.down({ changedTouches: [touch(1, 10, 20)] }); m.events.cancel({ changedTouches: [] }); m.events.down({ changedTouches: [touch(2, 30, 40)] }); assert.equal(m.pointers[1].type, 'cancel'); assert.equal(m.pointers[1].x, 10); assert.equal(m.pointers.length, 3);
});
test('无活动触点时移动不会产生事件', () => {
  const m = touchHarness(); m.events.move({ changedTouches: [touch(1, 10, 20)] }); m.events.cancel({ changedTouches: [] }); assert.equal(m.pointers.length, 0);
});
test('微信本地存储区分缺失值与有效值', () => {
  const m = wechatMock(); assert.equal(m.platform.storage.get('missing'), null); m.platform.storage.set('save', { level: 3 }); assert.equal(m.platform.storage.get('save').level, 3); m.platform.storage.set('zero', 0); assert.equal(m.platform.storage.get('zero'), 0);
});
test('存储异常不会阻止继续游戏', () => {
  const m = wechatMock(); m.wx.getStorageSync = () => { throw Error('读取失败'); }; m.wx.setStorageSync = () => { throw Error('写入失败'); }; assert.equal(m.platform.storage.get('save'), null); assert.equal(m.platform.storage.set('save', 1), false);
});
test('错误反馈使用较强振动', () => {
  const m = wechatMock(); m.platform.vibrate('error'); assert.equal(m.events.vibration.type, 'heavy');
});
test('帧回调与触摸使用日期时间基准', () => {
  const m = wechatMock(); let time; assert.equal(m.platform.requestFrame(value => { time = value; }), 7); m.events.frame(); assert.ok(Math.abs(time - Date.now()) < 1000);
});
test('微信隐藏与显示监听传递给游戏', () => {
  const m = wechatMock(); let hidden = false, shown = false; m.platform.onHide(() => { hidden = true; }); m.platform.onShow(() => { shown = true; }); m.events.hide(); m.events.show(); assert.equal(hidden, true); assert.equal(shown, true);
});
test('浏览器画布适配像素比并禁止滚动手势', () => {
  const m = browserMock(); assert.equal(m.canvas.width, 780); assert.equal(m.canvas.height, 1688); assert.equal(m.canvas.style.touchAction, 'none');
});
test('浏览器存储解析与损坏数据兼容', () => {
  const m = browserMock(); m.platform.storage.set('save', { level: 9 }); assert.equal(m.platform.storage.get('save').level, 9); m.stored.set('bad', '{'); assert.equal(m.platform.storage.get('bad'), null);
});
test('浏览器缩放后的触点映射为逻辑像素', () => {
  const m = browserMock(), pointers = []; m.platform.onPointer(event => pointers.push(event)); const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 30, clientY: 20, preventDefault() {} }; m.events.pointerdown(event); m.events.pointerup(event); assert.equal(pointers.length, 2); assert.equal(pointers[0].x, 20); assert.equal(pointers[0].y, 20);
});
test('浏览器可见性变化通知游戏并提供轻振动', () => {
  const m = browserMock(); let hidden = false, shown = false; m.platform.onHide(() => { hidden = true; }); m.platform.onShow(() => { shown = true; }); m.document.hidden = true; m.events.visibilitychange.forEach(fn => fn()); m.document.hidden = false; m.events.visibilitychange.forEach(fn => fn()); assert.equal(hidden, true); assert.equal(shown, true); m.platform.vibrate('light'); assert.equal(m.events.vibration, 15);
});
