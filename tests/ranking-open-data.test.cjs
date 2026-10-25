'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ranking = require('../open-data/ranking');
const { createRankingView } = require('../open-data/view');
const { createScoreSync } = require('../open-data/sync');

function fields(completed, totalTimeMs, changes) {
  return [{ key: ranking.STORAGE_KEY, value: JSON.stringify(Object.assign({ version: 1, completed, totalTimeMs,
    wxgame: { score: completed, update_time: 1791849600 } }, changes)) }];
}

function pointFields(points, completed, totalTimeMs, changes) {
  return [{ key: ranking.STORAGE_KEY, value: JSON.stringify(Object.assign({ version: 2, points, completed, totalTimeMs,
    wxgame: { score: Math.min(points, ranking.PLATFORM_MAX_SCORE), update_time: 1791849600 } }, changes)) }];
}

function user(id, completed, time, nickname, points) {
  return { openid: id, nickname: nickname || id, avatarUrl: 'https://example.test/' + id + '.png',
    KVDataList: points === undefined ? fields(completed, time) : pointFields(points, completed, time) };
}

function harness() {
  const draws = [], callbacks = { friends: [], own: [], writes: [], images: [] };
  const ctx = {
    setTransform(...args) { draws.push(['transform', ...args]); }, clearRect(...args) { draws.push(['clear', ...args]); },
    fillRect(...args) { draws.push(['rect', ...args]); }, fillText(...args) { draws.push(['text', ...args]); },
    measureText: value => ({ width: Array.from(value).length * 8 }),
    beginPath() {}, arc() {}, fill() {}, save() {}, restore() {}, clip() {}, rect() {},
    drawImage(...args) { draws.push(['image', ...args]); }
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const api = {
    getSharedCanvas: () => canvas, onMessage: fn => { callbacks.message = fn; },
    getFriendCloudStorage: opts => { callbacks.friends.push(opts); },
    getUserCloudStorage: opts => { callbacks.own.push(opts); },
    setUserCloudStorage: opts => { callbacks.writes.push(opts); },
    createImage() { const image = {}; callbacks.images.push(image); return image; }
  };
  const view = createRankingView(api);
  const show = (changes) => callbacks.message(Object.assign({ type: 'rank:show', width: 360, height: 400,
    pixelRatio: 2, ownScore: { points: 0, completed: 2, totalTimeMs: 90000 }, requestId: 1 }, changes));
  const finishOwn = (index, values) => callbacks.own[index || 0].success({ KVDataList: values || fields(2, 90000) });
  return { view, api, canvas, callbacks, draws, show, finishOwn };
}

test('开放域只解析完整自有版本成绩，不把 wxgame 单一分数当游戏进度', () => {
  assert.deepEqual(ranking.parseScore(fields(8, 91000)), { points: 0, completed: 8, totalTimeMs: 91000 });
  for (const item of [fields(100, 1000), fields(-1, 0), fields(1.2, 3), fields(1, -1), fields(1, 2.5), fields(0, 50),
    fields(1, 100, { version: 2 }), fields(1, 100, { wxgame: { score: 9, update_time: 100 } }),
    fields(1, 100, { wxgame: { score: 1, update_time: -1 } }),
    [{ key: ranking.STORAGE_KEY, value: '{坏数据' }],
    [{ key: ranking.STORAGE_KEY, value: 'null' }],
    [{ key: ranking.STORAGE_KEY, value: 'false' }],
    [{ key: ranking.STORAGE_KEY, value: JSON.stringify({ wxgame: { score: 9, update_time: 100 } }) }],
    [{ key: 'other_game', value: fields(8, 91000)[0].value }], null]) {
    assert.equal(ranking.parseScore(item), null);
  }
});

test('旧成绩仍按通关数和累计最佳用时排序，相同成绩并列并保持源顺序', () => {
  const rows = ranking.makeRanking([user('b', 4, 25000), user('c', 5, 40000), user('a', 4, 25000), user('d', 4, 30000)]);
  assert.deepEqual(rows.map(row => [row.openid, row.rank]), [['c', 1], ['b', 2], ['a', 2], ['d', 4]]);
});

test('畸形朋友、无openid、无分数和重复openid跳过，绝不补造玩家', () => {
  const rows = ranking.makeRanking([null, {}, Object.assign(user('', 1, 100), { openid: '' }),
    user('a', 1, 100), user('a', 60, 1), Object.assign(user('bad', 5, 20), { KVDataList: [] })]);
  assert.equal(rows.length, 1); assert.equal(rows[0].openid, 'a'); assert.equal(rows[0].completed, 1);
  assert.deepEqual(ranking.makeRanking([]), []);
});

test('累计用时可以超过一小时，显示不截断', () => {
  assert.equal(ranking.formatTime(0), '0:00'); assert.equal(ranking.formatTime(59999), '0:59');
  assert.equal(ranking.formatTime(3661000), '1:01:01');
});

test('show设置高分辨率sharedCanvas并使用正式KVDataList请求', () => {
  const h = harness(); h.show();
  assert.deepEqual([h.canvas.width, h.canvas.height], [720, 800]);
  assert.equal(h.callbacks.friends.length, 0);
  assert.deepEqual(h.callbacks.own[0].keyList, [ranking.STORAGE_KEY]);
  assert.equal(h.view.getState().status, 'loading');
  assert.equal(h.draws.some(item => item[0] === 'text' && item[1] === '正在读取朋友成绩…'), true);
  h.finishOwn(); assert.deepEqual(h.callbacks.friends[0].keyList, [ranking.STORAGE_KEY]);
});

test('空朋友列表保留我的真实本机统计且不显示伪造名次', () => {
  const h = harness(); h.show(); h.finishOwn(); h.callbacks.friends[0].success({ data: [] });
  const state = h.view.getState(); assert.equal(state.status, 'empty'); assert.deepEqual(state.rows, []);
  assert.deepEqual(state.ownScore, { points: 0, completed: 2, totalTimeMs: 90000 });
  assert.equal(h.draws.some(item => item[0] === 'text' && item[1] === '还没有朋友成绩'), true);
});

test('接口失败和返回格式错误有明确失败内容', () => {
  const h = harness(); h.show(); h.finishOwn(); h.callbacks.friends[0].fail({ errMsg: '拒绝' });
  assert.equal(h.view.getState().status, 'failed');
  assert.equal(h.draws.some(item => item[0] === 'text' && item[1] === '暂时无法读取朋友成绩'), true);
  h.show(); h.finishOwn(1); h.callbacks.friends[1].success({ data: '不合法' });
  assert.equal(h.view.getState().status, 'failed');
});

test('关闭后朋友、本人和头像旧回调不重画，scroll无效', () => {
  const h = harness(); h.show(); h.finishOwn(); h.callbacks.friends[0].success({ data: [user('a', 5, 6000)] });
  const image = h.callbacks.images[0];
  h.callbacks.message({ type: 'rank:submit', score: { points: 0, completed: 5, totalTimeMs: 100000 } });
  h.callbacks.message({ type: 'rank:hide' });
  const count = h.draws.length;
  h.callbacks.friends[0].success({ data: [user('b', 60, 10)] });
  h.callbacks.own[1].success({ KVDataList: fields(60, 10) });
  image.onload(); h.callbacks.message({ type: 'rank:scroll', delta: 100 });
  assert.equal(h.draws.length, count); assert.equal(h.view.getState().visible, false);
});

test('每次show刷新，旧请求不能覆盖新请求，requestId可核查', () => {
  const h = harness(); h.show(); h.finishOwn(); h.show({ requestId: 2 }); h.finishOwn(1);
  assert.equal(h.callbacks.friends.length, 2);
  h.callbacks.friends[1].success({ data: [user('new', 8, 50)] });
  h.callbacks.friends[0].success({ data: [user('old', 60, 10)] });
  assert.equal(h.view.getState().requestId, 2);
  assert.deepEqual(h.view.getState().rows.map(row => row.openid), ['new']);
  assert.equal(h.view.getState().ownScore.completed, 2);
});

test('我的底栏采用已同步与本机较好分数，但不冒认好友榜openid', () => {
  const h = harness(); h.show(); h.callbacks.own[0].success({ KVDataList: fields(3, 120000) });
  assert.deepEqual(h.view.getState().ownScore, { points: 0, completed: 3, totalTimeMs: 120000 });
  assert.equal(h.view.getState().ownSource, '微信已同步');
  h.show(); h.callbacks.own[1].success({ KVDataList: fields(1, 10) });
  assert.equal(h.callbacks.writes.length, 1); h.callbacks.writes[0].success();
  assert.equal(h.view.getState().ownSource, '微信已同步'); assert.equal(h.view.getState().ownScore.completed, 3);
  assert.equal(ranking.parseScore(h.callbacks.writes[0].KVDataList).completed, 3);
});

test('长列表可上下滚动并限制边界，不一次绘制所有好友头像', () => {
  const h = harness(); h.show(); h.finishOwn(); h.callbacks.friends[0].success({ data: Array.from({ length: 70 }, (_, index) => user('u' + index, 5, index)) });
  assert.equal(h.view.getState().rows.length, 70); assert.ok(h.callbacks.images.length < 10);
  h.callbacks.message({ type: 'rank:scroll', delta: 999999 });
  assert.equal(h.view.getState().offset, 70 * 74 - (400 - 40 - 68));
  h.callbacks.message({ type: 'rank:scroll', delta: -999999 }); assert.equal(h.view.getState().offset, 0);
  h.callbacks.message({ type: 'rank:scroll', delta: NaN }); assert.equal(h.view.getState().offset, 0);
});

test('头像从缓存复用；再次show订阅正在加载的头像且仅当前代次重画', () => {
  const h = harness(); h.show(); h.finishOwn(); h.callbacks.friends[0].success({ data: [user('a', 5, 50)] });
  const image = h.callbacks.images[0]; h.callbacks.message({ type: 'rank:hide' });
  h.show(); h.finishOwn(1); h.callbacks.friends[1].success({ data: [user('a', 5, 50)] });
  assert.equal(h.callbacks.images.length, 1); const count = h.draws.length;
  image.onload(); assert.ok(h.draws.length > count); assert.equal(h.draws.some(item => item[0] === 'image'), true);
});

test('过长昵称按像素截断且不拆开emoji代理对，非HTTPS头像不加载', () => {
  const h = harness(); h.show(); h.finishOwn();
  const row = user('a', 5, 50, '猫🐱'.repeat(50)); row.avatarUrl = 'javascript:alert(1)';
  h.callbacks.friends[0].success({ data: [row] }); assert.equal(h.callbacks.images.length, 0);
  const label = h.draws.find(item => item[0] === 'text' && item[1].endsWith('…') && item[1].startsWith('猫'));
  assert.ok(label); assert.ok(label[1].length < row.nickname.length);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label[1]), false);
});

test('读取云端较高分后不会用新装设备低分覆盖', () => {
  const h = harness(); h.show({ ownScore: { points: 0, completed: 1, totalTimeMs: 30000 } });
  h.finishOwn(0, fields(40, 3000000));
  assert.equal(h.callbacks.writes.length, 0); assert.equal(h.view.getState().ownScore.completed, 40);
});

test('show先写入较优成绩，成功后才读取好友榜，云值符合官方wxgame格式', () => {
  const h = harness(); h.show({ ownScore: { points: 0, completed: 5, totalTimeMs: 55000 } }); h.finishOwn(0, fields(2, 30000));
  assert.equal(h.callbacks.friends.length, 0); assert.equal(h.callbacks.writes.length, 1);
  const field = h.callbacks.writes[0].KVDataList[0], value = JSON.parse(field.value);
  assert.equal(field.key, ranking.STORAGE_KEY); assert.equal(value.version, 2); assert.equal(value.completed, 5);
  assert.equal(value.points, 0); assert.equal(value.totalTimeMs, 55000); assert.equal(value.wxgame.score, 0);
  assert.ok(Number.isInteger(value.wxgame.update_time)); assert.deepEqual(Object.keys(value.wxgame), ['score', 'update_time']);
  h.callbacks.writes[0].success(); assert.equal(h.callbacks.friends.length, 1);
});

test('本人云读写串行；期间合并最高进度，相同通关数取更少用时', () => {
  const h = harness(); const states = [], idle = [];
  const sync = createScoreSync(h.api, value => states.push(value.state), value => idle.push(value.state));
  sync.submit({ points: 0, completed: 3, totalTimeMs: 90000 }); sync.submit({ points: 0, completed: 6, totalTimeMs: 200000 });
  sync.submit({ points: 0, completed: 6, totalTimeMs: 180000 }); sync.submit({ points: 0, completed: 4, totalTimeMs: 20000 });
  assert.equal(h.callbacks.own.length, 1);
  h.finishOwn(0, fields(2, 30000));
  assert.deepEqual(ranking.parseScore(h.callbacks.writes[0].KVDataList), { points: 0, completed: 6, totalTimeMs: 180000 });
  sync.submit({ points: 0, completed: 7, totalTimeMs: 210000 });
  assert.equal(h.callbacks.own.length, 1); h.callbacks.writes[0].success();
  assert.equal(h.callbacks.own.length, 2);
  h.finishOwn(1, fields(6, 180000)); h.callbacks.writes[1].success();
  assert.equal(sync.getState().busy, false); assert.equal(sync.getState().cloud.completed, 7);
  assert.deepEqual(idle, ['synced']);
});

test('读取失败不盲目写入、不无限重试；下次提交再次验证云端', () => {
  const h = harness(); const sync = createScoreSync(h.api, () => {}, () => {});
  sync.submit({ points: 0, completed: 9, totalTimeMs: 200000 }); h.callbacks.own[0].fail();
  assert.equal(h.callbacks.writes.length, 0); assert.equal(h.callbacks.own.length, 1);
  assert.equal(sync.getState().state, 'failed'); assert.equal(sync.getState().pending.completed, 9);
  sync.submit({ points: 0, completed: 4, totalTimeMs: 50000 }); h.finishOwn(1, fields(20, 1000000));
  assert.equal(h.callbacks.writes.length, 0); assert.equal(sync.getState().cloud.completed, 20);
});

test('写入失败保留较优待提交成绩，排行榜明确标注更新失败', () => {
  const h = harness(); h.show({ ownScore: { points: 0, completed: 8, totalTimeMs: 110000 } }); h.finishOwn(0, fields(2, 40000));
  h.callbacks.writes[0].fail(); assert.equal(h.view.getState().ownSource, '同步失败 · 稍后重试');
  assert.equal(h.callbacks.friends.length, 1); assert.equal(h.callbacks.own.length, 1);
  h.callbacks.friends[0].success({ data: [user('a', 10, 200000)] });
  assert.equal(h.view.getState().status, 'ready'); assert.equal(h.view.getState().sync.pending.completed, 8);
});

test('关闭后本人写入允许完成且不重画，再打开不会被旧好友结果覆盖', () => {
  const h = harness(); h.show({ ownScore: { points: 0, completed: 8, totalTimeMs: 110000 } }); h.finishOwn(0, fields(2, 40000));
  h.callbacks.message({ type: 'rank:hide' }); const count = h.draws.length;
  h.callbacks.writes[0].success(); assert.equal(h.draws.length, count); assert.equal(h.callbacks.friends.length, 0);
  h.show({ requestId: 2, ownScore: { points: 0, completed: 8, totalTimeMs: 110000 } }); h.finishOwn(1, fields(8, 110000));
  assert.equal(h.callbacks.friends.length, 1); assert.equal(h.view.getState().requestId, 2);
});

test('零分初装不写入，非法提交不启动网络请求', () => {
  const h = harness(); const sync = createScoreSync(h.api, () => {}, () => {});
  assert.equal(sync.submit({ points: 0, completed: 100, totalTimeMs: 1 }), false); assert.equal(h.callbacks.own.length, 0);
  sync.submit({ points: 0, completed: 0, totalTimeMs: 0 }); h.finishOwn(0, []);
  assert.equal(h.callbacks.writes.length, 0); assert.equal(sync.getState().state, 'synced');
});

test('version 1 云进度和缺积分的本机成绩迁为零积分，不能伪造历史得分', () => {
  assert.deepEqual(ranking.parseScore(fields(8, 91000)), { points: 0, completed: 8, totalTimeMs: 91000 });
  assert.deepEqual(ranking.normalizeScore({ completed: 3, totalTimeMs: 20000 }), { points: 0, completed: 3, totalTimeMs: 20000 });
  assert.deepEqual(ranking.parseScore(pointFields(12000, 3, 20000)), { points: 12000, completed: 3, totalTimeMs: 20000 });
});

test('新榜先比较积分，再比较通关数和用时，三项全同才并列', () => {
  const rows = ranking.makeRanking([user('old', 60, 1000), user('b', 4, 25000, null, 8000),
    user('c', 5, 40000, null, 8000), user('a', 4, 25000, null, 8000), user('d', 4, 30000, null, 8000),
    user('high', 1, 99999, null, 9000)]);
  assert.deepEqual(rows.map(row => [row.openid, row.rank]), [['high', 1], ['c', 2], ['b', 3], ['a', 3], ['d', 5], ['old', 6]]);
});

test('version 2 拒绝非法积分、缺失积分与不一致平台分数', () => {
  for (const item of [pointFields(-1, 1, 100), pointFields(1.5, 1, 100),
    pointFields(Number.MAX_SAFE_INTEGER + 1, 1, 100), pointFields(1, 0, 0),
    fields(1, 100, { version: 2 }), pointFields(5000, 1, 100, { wxgame: { score: 1, update_time: 100 } }),
    pointFields(5000, 1, 100, { version: 3 })]) assert.equal(ranking.parseScore(item), null);
  assert.equal(ranking.validScore({ points: NaN, completed: 1, totalTimeMs: 100 }), false);
  assert.equal(ranking.validScore({ points: -1, completed: 1, totalTimeMs: 100 }), false);
});

test('积分升级写入 version 2，旧设备零积分不能覆盖已确认的较高积分', () => {
  const h = harness(); const sync = createScoreSync(h.api, () => {}, () => {});
  sync.submit({ points: 50000, completed: 3, totalTimeMs: 90000 }); h.finishOwn(0, fields(60, 3000000));
  const value = JSON.parse(h.callbacks.writes[0].KVDataList[0].value);
  assert.equal(value.version, 2); assert.equal(value.points, 50000); assert.equal(value.wxgame.score, 50000);
  h.callbacks.writes[0].success();
  sync.submit({ completed: 60, totalTimeMs: 3000000 }); h.finishOwn(1, pointFields(50000, 3, 90000));
  assert.equal(h.callbacks.writes.length, 1); assert.equal(sync.getState().cloud.points, 50000);
});

test('串行合并按积分择优，同积分才选更多关和更快时间', () => {
  const h = harness(); const sync = createScoreSync(h.api, () => {}, () => {});
  sync.submit({ points: 12000, completed: 4, totalTimeMs: 90000 });
  sync.submit({ points: 15000, completed: 3, totalTimeMs: 120000 });
  sync.submit({ points: 15000, completed: 4, totalTimeMs: 130000 });
  sync.submit({ points: 15000, completed: 4, totalTimeMs: 100000 });
  h.finishOwn(0, []);
  assert.deepEqual(ranking.parseScore(h.callbacks.writes[0].KVDataList), { points: 15000, completed: 4, totalTimeMs: 100000 });
});

test('完整积分保留安全整数，微信系统榜映射到 Int32 上限', () => {
  const h = harness(); const sync = createScoreSync(h.api, () => {}, () => {});
  const score = { points: Number.MAX_SAFE_INTEGER, completed: 60, totalTimeMs: 90000 };
  sync.submit(score); h.finishOwn(0, []);
  const field = h.callbacks.writes[0].KVDataList[0], value = JSON.parse(field.value);
  assert.equal(value.wxgame.score, 2147483647); assert.equal(value.points, score.points);
  assert.deepEqual(ranking.parseScore([field]), score);
  assert.ok(Buffer.byteLength(field.key + field.value, 'utf8') < 1024);
});

test('开放域同时显示积分、关卡和累计最佳用时', () => {
  const h = harness(); h.show({ ownScore: { points: 12345, completed: 3, totalTimeMs: 60000 } });
  h.finishOwn(0, pointFields(12345, 3, 60000));
  h.callbacks.friends[0].success({ data: [user('a', 4, 95000, '朋友甲', 15000)] });
  const labels = h.draws.filter(item => item[0] === 'text').map(item => item[1]);
  assert.ok(labels.includes('15,000 分')); assert.ok(labels.includes('4 关 · 1:35'));
  assert.ok(labels.includes('12,345 分')); assert.ok(labels.includes('3 关 · 1:00'));
});
