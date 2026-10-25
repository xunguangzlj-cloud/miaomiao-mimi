'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');
const scope = 'scope.WxFriendInteraction';
const plain = value => JSON.parse(JSON.stringify(value));

function setup(options = {}) {
  const messages = [], privacyEvents = [], calls = { context: [], cloud: [], setting: 0, authorize: [], openSetting: 0, privacySetting: 0, requirePrivacy: 0, privacyListeners: 0, contracts: 0 };
  let privacyListener = null, privacyGranted = options.needAuthorization !== true;
  const shared = { width: 720, height: 1000 };
  const openData = { canvas: shared, postMessage: message => messages.push(plain(message)) };
  const canvas = { getContext: () => ({ scale() {} }), style: {}, clientWidth: 390, clientHeight: 844 };
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    getOpenDataContext: value => { calls.context.push(plain(value)); return openData; },
    getFriendCloudStorage: value => { calls.cloud.push('getFriendCloudStorage'); throw Error('主域不得访问朋友云数据'); },
    getUserCloudStorage: value => { calls.cloud.push('getUserCloudStorage'); throw Error('主域不得访问用户云数据'); },
    setUserCloudStorage: value => { calls.cloud.push('setUserCloudStorage'); throw Error('主域不得写用户云数据'); },
    getSetting: value => { calls.setting++; value.success({ authSetting: options.authSetting === undefined ? { [scope]: true } : options.authSetting }); },
    authorize: value => { calls.authorize.push(value.scope); options.deny ? value.fail({ errMsg: '用户拒绝' }) : value.success({}); },
    openSetting: value => { calls.openSetting++; value.success({ authSetting: options.openAuthSetting || {} }); },
    getPrivacySetting: value => { calls.privacySetting++; value.success({ needAuthorization: !privacyGranted, privacyContractName: options.contractName || '《喵格小屋隐私保护指引》' }); },
    onNeedPrivacyAuthorization: listener => { calls.privacyListeners++; privacyListener = listener; },
    requirePrivacyAuthorize(value) {
      calls.requirePrivacy++;
      if (options.privacyDenied) { value.fail({ errMsg: '隐私授权被拒绝' }); return; }
      if (privacyGranted) { value.success({}); return; }
      privacyListener(event => {
        privacyEvents.push(plain(event));
        if (event.event === 'agree') { privacyGranted = true; value.success({}); }
        if (event.event === 'disagree') value.fail({ errMsg: '隐私授权被拒绝' });
      });
    },
    openPrivacyContract: value => { calls.contracts++; value.success({}); }
  };
  Object.assign(wx, options.wx);
  const sandbox = { wx, module: { exports: {} }, Date, setTimeout };
  vm.runInNewContext(source, sandbox);
  return { ranking: sandbox.module.exports.createPlatform().ranking, wx, calls, shared, openData, messages, privacyEvents };
}

function browserSetup() {
  const canvas = { style: {}, clientWidth: 390, clientHeight: 844, getContext: () => ({ scale() {} }) };
  const window = { devicePixelRatio: 2 };
  const document = { getElementById: () => canvas };
  vm.runInNewContext(source, { window, document, Date, setTimeout });
  return window.MeowPlatform.createPlatform().ranking;
}

test('主域缓存离屏开放域上下文，不在每帧重复获取', () => {
  const m = setup();
  assert.equal(m.ranking.available, true);
  m.ranking.show({ width: 360, height: 500, requestId: 1, ownScore: { points: 0, completed: 5, totalTimeMs: 8900 } });
  m.ranking.draw({ drawImage() {} }, 0, 0, 360, 500);
  m.ranking.scroll(48); m.ranking.hide();
  assert.deepEqual(m.calls.context, [{ sharedCanvasMode: 'offscreenCanvas' }]);
});

test('主域只发送本人成绩，不读取或写入任何云数据', () => {
  const m = setup(), results = [];
  m.ranking.submit({ points: 0, completed: 5, totalTimeMs: 8900 }, value => results.push(plain(value)));
  m.ranking.submit({ points: 0, completed: 6, totalTimeMs: 11000 }, value => results.push(plain(value)));
  assert.deepEqual(m.messages, [
    { type: 'rank:submit', score: { points: 0, completed: 5, totalTimeMs: 8900 } },
    { type: 'rank:submit', score: { points: 0, completed: 6, totalTimeMs: 11000 } }
  ]);
  assert.deepEqual(results, [
    { success: true, queued: true, local: false, score: { points: 0, completed: 5, totalTimeMs: 8900 } },
    { success: true, queued: true, local: false, score: { points: 0, completed: 6, totalTimeMs: 11000 } }
  ]);
  assert.deepEqual(m.calls.cloud, []);
  assert.equal(m.calls.setting, 1);
  assert.equal(m.calls.requirePrivacy, 0);
  assert.equal(m.calls.openSetting, 0);
});

test('成绩消息规范化关卡上限和非负整数时间', () => {
  for (const [completed, expected] of [[61, 61], [63.9, 63], [99, 99], [102.9, 99]]) {
    const m = setup();
    m.ranking.submit({ points: 0, completed, totalTimeMs: 100.8 });
    assert.deepEqual(m.messages[0].score, { points: 0, completed: expected, totalTimeMs: 100 });
  }
  const negative = setup(); negative.ranking.submit({ points: 0, completed: -1, totalTimeMs: -8 });
  const invalid = setup(); invalid.ranking.submit({ points: 0, completed: Infinity, totalTimeMs: NaN });
  assert.deepEqual(negative.messages[0].score, { points: 0, completed: 0, totalTimeMs: 0 });
  assert.deepEqual(invalid.messages[0].score, { points: 0, completed: 0, totalTimeMs: 0 });
});

test('同分时第99关进度胜过第61关，并完整传给排行榜展示', () => {
  const m = setup(), score = { points: 10000, completed: 99, totalTimeMs: 200000 };
  m.ranking.submit({ points: 10000, completed: 61, totalTimeMs: 100000 });
  m.ranking.submit(score);
  assert.deepEqual(m.messages[1].score, score);
  assert.equal(m.ranking.show({ width: 360, height: 500 }), true);
  assert.deepEqual(m.messages[2].ownScore, score);
});

test('主域保留完整非负安全整数积分，旧消息补零积分且零关不能有得分用时', () => {
  const old = setup(); old.ranking.submit({ completed: 5, totalTimeMs: 10000 });
  assert.deepEqual(old.messages[0].score, { points: 0, completed: 5, totalTimeMs: 10000 });
  const large = setup(); large.ranking.submit({ points: Number.MAX_SAFE_INTEGER, completed: 60, totalTimeMs: 10000 });
  assert.equal(large.messages[0].score.points, Number.MAX_SAFE_INTEGER);
  const clamped = setup(); clamped.ranking.submit({ points: 12345.6, completed: 5, totalTimeMs: 100.8 });
  assert.deepEqual(clamped.messages[0].score, { points: 12345, completed: 5, totalTimeMs: 100 });
  const invalid = setup(); invalid.ranking.submit({ points: Infinity, completed: 5, totalTimeMs: 10000 });
  assert.equal(invalid.messages[0].score.points, 0);
  const zero = setup(); zero.ranking.submit({ points: 5000, completed: 0, totalTimeMs: 90000 });
  assert.deepEqual(zero.messages[0].score, { points: 0, completed: 0, totalTimeMs: 0 });
});

test('未授权本机暂存按积分、通关数、用时择优，旧版本进度不降积分', () => {
  const m = setup({ needAuthorization: true }), results = [];
  for (const score of [{ points: 5000, completed: 2, totalTimeMs: 60000 },
    { completed: 60, totalTimeMs: 1000 }, { points: 7000, completed: 1, totalTimeMs: 90000 },
    { points: 7000, completed: 2, totalTimeMs: 120000 }, { points: 7000, completed: 2, totalTimeMs: 100000 },
    { points: 6000, completed: 5, totalTimeMs: 1000 }]) m.ranking.submit(score, value => results.push(plain(value)));
  assert.deepEqual(results[1].score, { points: 5000, completed: 2, totalTimeMs: 60000 });
  assert.deepEqual(results[5].score, { points: 7000, completed: 2, totalTimeMs: 100000 });
  assert.deepEqual(m.messages, []); assert.deepEqual(m.calls.cloud, []); assert.equal(m.calls.requirePrivacy, 0);
});

test('排行榜消息带逻辑宽高、像素比、请求编号和本人成绩', () => {
  const m = setup();
  assert.equal(m.ranking.show({ width: 360, height: 500, requestId: 8, ownScore: { points: 0, completed: 5, totalTimeMs: 8900 } }), true);
  assert.deepEqual(m.messages[0], { type: 'rank:show', width: 360, height: 500, pixelRatio: 2, requestId: 8, ownScore: { points: 0, completed: 5, totalTimeMs: 8900 } });
  assert.equal(m.ranking.scroll(-40), true);
  assert.equal(m.ranking.scroll(NaN), false);
  assert.equal(m.ranking.hide(), true);
  assert.deepEqual(m.messages.slice(1), [{ type: 'rank:scroll', delta: -40 }, { type: 'rank:hide' }]);
});

test('主域按指定矩形绘制共享画布并兼容未就绪画布', () => {
  const m = setup(), draws = [];
  assert.equal(m.ranking.draw({ drawImage: (...args) => draws.push(args) }, 12, 100, 360, 500), true);
  assert.equal(draws[0][0], m.shared);
  assert.deepEqual(draws[0].slice(1), [12, 100, 360, 500]);
  m.shared.width = 0;
  assert.equal(m.ranking.draw({ drawImage() { throw Error('不应绘制空画布'); } }, 0, 0, 360, 500), false);
});

test('消息提交异常不会假报云同步成功，也不阻断离线游戏', () => {
  const m = setup(); let result;
  m.openData.postMessage = () => { throw Error('开放域尚未就绪'); };
  m.ranking.submit({ points: 0, completed: 3, totalTimeMs: 7000 }, value => { result = plain(value); });
  assert.equal(result.success, false); assert.equal(result.queued, false);
  assert.match(result.error, /消息提交失败/);
  assert.equal(m.ranking.show({ width: 360, height: 500 }), false);
});

test('浏览器预览不制造朋友数据或打开微信授权', () => {
  const ranking = browserSetup(); let submitted, authorized, settings;
  assert.equal(ranking.available, false);
  ranking.submit({ points: 0, completed: 3, totalTimeMs: 7000 }, value => { submitted = value; });
  ranking.authorize(value => { authorized = value; });
  ranking.openSettings(value => { settings = value; });
  assert.equal(submitted.success, false); assert.equal(authorized.success, false); assert.equal(settings.success, false);
  assert.equal(ranking.show({ width: 360, height: 500 }), false);
  assert.equal(ranking.draw({ drawImage() { throw Error('浏览器不应绘制朋友画布'); } }, 0, 0, 360, 500), false);
});

test('旧基础库或上下文异常时排行榜可用性回退', () => {
  assert.equal(setup({ wx: { getOpenDataContext: undefined } }).ranking.available, false);
  assert.equal(setup({ wx: { getOpenDataContext() { throw Error('未配置开放域'); } } }).ranking.available, false);
  assert.equal(setup({ wx: { getOpenDataContext: () => ({ canvas: {}, postMessage: null }) } }).ranking.available, false);
});

test('已授权用户直接成功，首次请求明确限定朋友权限', () => {
  const allowed = setup({ authSetting: { [scope]: true } }); let result;
  allowed.ranking.authorize(value => { result = value; });
  assert.equal(result.success, true); assert.deepEqual(allowed.calls.authorize, []);
  const first = setup({ authSetting: {} }); first.ranking.authorize(value => { result = value; });
  assert.equal(result.success, true); assert.deepEqual(first.calls.authorize, [scope]);
  assert.equal(first.calls.openSetting, 0); assert.deepEqual(first.calls.cloud, []);
});

test('朋友权限拒绝后不自动打开设置或反复请求授权', () => {
  const denied = setup({ deny: true, authSetting: {} }); let result;
  denied.ranking.authorize(value => { result = value; });
  assert.equal(result.success, false); assert.equal(result.denied, true); assert.equal(denied.calls.openSetting, 0);
  const knownDenied = setup({ authSetting: { [scope]: false } });
  knownDenied.ranking.authorize(value => { result = value; });
  assert.equal(result.denied, true); assert.deepEqual(knownDenied.calls.authorize, []);
});

test('微信设置只在显式调用后打开，并复查朋友权限', () => {
  const m = setup({ openAuthSetting: { [scope]: true } }); let result;
  assert.equal(m.calls.openSetting, 0);
  m.ranking.openSettings(value => { result = value; });
  assert.equal(result.success, true); assert.equal(m.calls.openSetting, 1);
  const denied = setup(); denied.ranking.openSettings(value => { result = value; });
  assert.equal(result.success, false); assert.equal(result.denied, true);
});

test('缺失授权接口或读取授权失败都有明确状态', () => {
  const missing = setup({ wx: { getSetting: undefined } }); let result;
  assert.equal(missing.ranking.available, true);
  missing.ranking.authorize(value => { result = value; }); assert.equal(result.success, false);
  const failing = setup({ wx: { getSetting(value) { value.fail({ errMsg: '网络暂不可用' }); } } });
  failing.ranking.authorize(value => { result = value; }); assert.equal(result.success, false); assert.equal(result.error, '网络暂不可用');
  assert.deepEqual(failing.calls.authorize, []); assert.equal(failing.calls.openSetting, 0);
});

test('未同意隐私时启动和通关只暂存本机最佳成绩，不弹窗或触发开放域', () => {
  const m = setup({ needAuthorization: true }), results = [];
  m.ranking.submit({ points: 0, completed: 5, totalTimeMs: 8900 }, value => results.push(plain(value)));
  m.ranking.submit({ points: 0, completed: 4, totalTimeMs: 1000 }, value => results.push(plain(value)));
  m.ranking.submit({ points: 0, completed: 5, totalTimeMs: 8500 }, value => results.push(plain(value)));
  assert.deepEqual(results[2], { success: true, queued: true, local: true, score: { points: 0, completed: 5, totalTimeMs: 8500 } });
  assert.deepEqual(results[1].score, { points: 0, completed: 5, totalTimeMs: 8900 });
  assert.equal(m.calls.privacyListeners, 1); assert.equal(m.calls.requirePrivacy, 0); assert.equal(m.calls.setting, 0);
  assert.deepEqual(m.messages, []); assert.deepEqual(m.calls.cloud, []);
  assert.equal(m.ranking.show({ width: 360, height: 500 }), false);
  assert.equal(m.ranking.draw({ drawImage() { throw Error('未授权不可绘制朋友'); } }, 0, 0, 360, 500), false);
});

test('隐私弹窗使用官方名称、链接和小游戏事件，双同意后才提交暂存成绩', () => {
  const m = setup({ needAuthorization: true, authSetting: {} }); let popup, authorization;
  m.ranking.onPrivacyRequest(value => { popup = value; });
  m.ranking.submit({ points: 0, completed: 6, totalTimeMs: 12000 });
  m.ranking.authorize(value => { authorization = value; });
  assert.equal(popup.contractName, '《喵格小屋隐私保护指引》');
  assert.deepEqual(m.privacyEvents, [{ event: 'exposureAuthorization' }]);
  assert.deepEqual(m.calls.authorize, []); assert.deepEqual(m.messages, []);
  let contract;
  assert.equal(popup.openContract(value => { contract = value; }), true);
  assert.equal(contract.success, true); assert.equal(m.calls.contracts, 1);
  assert.equal(popup.agree(), true); assert.equal(popup.agree(), false); assert.equal(popup.disagree(), false);
  assert.deepEqual(m.privacyEvents, [{ event: 'exposureAuthorization' }, { event: 'agree' }]);
  assert.equal(authorization.success, true); assert.deepEqual(m.calls.authorize, [scope]);
  assert.deepEqual(m.messages, [{ type: 'rank:submit', score: { points: 0, completed: 6, totalTimeMs: 12000 } }]);
  assert.deepEqual(m.calls.cloud, []);
});

test('用户拒绝隐私后不请求朋友授权或打开设置，仍保留离线成绩', () => {
  const m = setup({ needAuthorization: true, authSetting: {} }); let popup, result;
  m.ranking.onPrivacyRequest(value => { popup = value; });
  m.ranking.submit({ points: 0, completed: 5, totalTimeMs: 8900 });
  m.ranking.authorize(value => { result = value; });
  assert.equal(popup.disagree(), true); assert.equal(popup.agree(), false);
  assert.equal(result.success, false); assert.equal(result.privacyDenied, true); assert.equal(result.denied, undefined);
  assert.deepEqual(m.privacyEvents, [{ event: 'exposureAuthorization' }, { event: 'disagree' }]);
  assert.equal(m.calls.setting, 0); assert.deepEqual(m.calls.authorize, []); assert.equal(m.calls.openSetting, 0);
  assert.deepEqual(m.messages, []);
  m.ranking.submit({ points: 0, completed: 6, totalTimeMs: 10000 }, value => { result = value; });
  assert.equal(result.local, true); assert.deepEqual(m.messages, []);
});

test('隐私说明暂未注册时请求保持待决，注册后只曝光一次', () => {
  const m = setup({ needAuthorization: true }); let popup, result;
  m.ranking.authorize(value => { result = value; });
  assert.equal(result, undefined); assert.deepEqual(m.privacyEvents, []);
  m.ranking.onPrivacyRequest(value => { popup = value; });
  m.ranking.onPrivacyRequest(() => { throw Error('同一请求不得重复展示'); });
  assert.equal(popup.contractName, '《喵格小屋隐私保护指引》');
  assert.deepEqual(m.privacyEvents, [{ event: 'exposureAuthorization' }]);
  popup.agree(); assert.equal(result.success, true);
});

test('读取隐私名称失败使用通用指引名，仍须用户决定', () => {
  const m = setup({ needAuthorization: true, wx: { getPrivacySetting(value) { value.fail({ errMsg: '暂未读取指引名' }); } } });
  let popup, result;
  m.ranking.onPrivacyRequest(value => { popup = value; });
  m.ranking.authorize(value => { result = value; });
  assert.equal(popup.contractName, '隐私保护指引'); assert.equal(result, undefined);
  popup.disagree(); assert.equal(result.privacyDenied, true); assert.deepEqual(m.messages, []);
});

test('异步取得指引名称前不提前展示或上报曝光', () => {
  const delayed = [];
  const m = setup({ needAuthorization: true, wx: { getPrivacySetting(value) { delayed.push(value); } } }); let popup;
  m.ranking.onPrivacyRequest(value => { popup = value; });
  m.ranking.authorize(() => {});
  assert.equal(delayed.length, 2); assert.equal(popup, undefined); assert.deepEqual(m.privacyEvents, []);
  m.ranking.onPrivacyRequest(value => { popup = value; });
  assert.equal(popup, undefined);
  delayed[1].success({ needAuthorization: true, privacyContractName: '《新版本指引》' });
  assert.equal(popup.contractName, '《新版本指引》');
  assert.deepEqual(m.privacyEvents, [{ event: 'exposureAuthorization' }]);
  popup.disagree();
});

test('缺少旧基础库隐私接口时不盲目视作已授权，不触发朋友或云接口', () => {
  const m = setup({ wx: { getPrivacySetting: undefined, requirePrivacyAuthorize: undefined, onNeedPrivacyAuthorization: undefined, openPrivacyContract: undefined } }); let result;
  assert.equal(m.ranking.available, true);
  m.ranking.submit({ points: 0, completed: 3, totalTimeMs: 7000 }, value => { result = value; });
  assert.equal(result.local, true); assert.deepEqual(m.messages, []);
  m.ranking.authorize(value => { result = value; });
  assert.equal(result.success, false); assert.match(result.error, /更新微信/);
  assert.deepEqual(m.calls.authorize, []); assert.deepEqual(m.calls.cloud, []); assert.equal(m.calls.openSetting, 0);
});

test('仅同意隐私仍不会提交，微信设置开启朋友权限后才提交', () => {
  const m = setup({ authSetting: { [scope]: false }, openAuthSetting: { [scope]: true } }); let result;
  m.ranking.submit({ points: 0, completed: 3, totalTimeMs: 7000 });
  m.ranking.authorize(value => { result = value; });
  assert.equal(result.denied, true); assert.equal(result.privacyDenied, undefined); assert.deepEqual(m.messages, []);
  m.ranking.openSettings(value => { result = value; });
  assert.equal(result.success, true); assert.equal(m.calls.openSetting, 1);
  assert.deepEqual(m.messages, [{ type: 'rank:submit', score: { points: 0, completed: 3, totalTimeMs: 7000 } }]);
});

test('晚到的启动只读回调不会覆盖用户刚拒绝的隐私状态', () => {
  const delayed = [];
  const m = setup({ privacyDenied: true, wx: { getPrivacySetting(value) { delayed.push(value); } } }); let result;
  m.ranking.submit({ points: 0, completed: 4, totalTimeMs: 10000 });
  m.ranking.authorize(value => { result = value; });
  assert.equal(result.privacyDenied, true);
  delayed[0].success({ needAuthorization: false, privacyContractName: '《旧指引》' });
  assert.deepEqual(m.messages, []); assert.equal(m.calls.setting, 0);
  assert.equal(m.ranking.show({ width: 360, height: 500 }), false);
});

test('已授权状态重新检查隐私失败后立即停止新的排行榜消息和绘制', () => {
  const m = setup({ privacyDenied: true }); let result;
  m.ranking.submit({ points: 0, completed: 4, totalTimeMs: 10000 }); assert.equal(m.messages.length, 1);
  m.ranking.authorize(value => { result = value; }); assert.equal(result.privacyDenied, true);
  m.ranking.submit({ points: 0, completed: 5, totalTimeMs: 12000 }, value => { result = value; });
  assert.equal(result.local, true); assert.equal(m.messages.length, 1);
  assert.equal(m.ranking.show({ width: 360, height: 500 }), false);
  assert.equal(m.ranking.draw({ drawImage() {} }, 0, 0, 360, 500), false);
});
