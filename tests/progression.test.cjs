'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const progression = require('../src/progression.js');
const copy = value => JSON.parse(JSON.stringify(value));
const record = { time: 10000, hints: 0 };

test('新档有三次提示和三次助手，默认资料与外观均可用', () => {
  const data = progression.hydrate();
  assert.equal(data.xp, 0); assert.equal(progression.levelInfo(data.xp).level, 1);
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
  assert.deepEqual(data.profile, { nickname: '喵友', avatar: 'cat', frame: 'basic' });
  assert.equal(data.animal, 'cat'); assert.equal(data.theme, 'cream');
  assert.deepEqual(data.checkin, { lastDate: '', streak: 0, best: 0, total: 0 });
});

test('旧版迁移按实际通关恢复经验并去重，不写入或推算任何旧分数', () => {
  const completed = { 1: record, '01': record, 13: record, 60: record, 100: record, bad: record, 2: { time: -1, hints: 0 } };
  const daily = { '2026-10-12': record, '2026-02-30': record, invalid: record };
  const before = copy({ completed, daily }), data = progression.hydrate(undefined, completed, daily);
  assert.equal(data.xp, 120 + 140 + 200 + 80);
  assert.deepEqual(data.cleared, [1, 13, 60]); assert.deepEqual(data.dailyCleared, ['2026-10-12']);
  assert.deepEqual({ completed, daily }, before); assert.equal(Object.hasOwn(data, 'scores'), false);
  const xp = data.xp;
  assert.equal(progression.rewardClear(data, { id: 1, size: 5 }).rewarded, false);
  assert.equal(progression.rewardClear(data, { daily: true, date: '2026-10-12', size: 5 }).rewarded, false);
  assert.equal(data.xp, xp);
});

test('存档往返保留零库存与已领取奖励，重读不会补回道具或重发经验', () => {
  const data = progression.hydrate(); data.inventory = { hints: 0, helpers: 0 };
  progression.rewardClear(data, { id: 1, size: 5 }); progression.dailyClaim(data, '2026-10-13');
  const saved = copy(data), restored = progression.hydrate(saved, { 1: record });
  assert.deepEqual(restored, saved);
  const before = copy(restored);
  assert.equal(progression.rewardClear(restored, { id: 1, size: 5 }).rewarded, false);
  assert.equal(progression.dailyClaim(restored, '2026-10-13').claimed, false);
  assert.deepEqual(restored, before);
});

test('损坏的数字、日期、昵称与未解锁外观不会流入运行状态', () => {
  const data = progression.hydrate({
    xp: NaN, inventory: { hints: -1, helpers: Infinity },
    checkin: { lastDate: '2026-02-30', streak: 10, best: -2, total: 1 },
    profile: { nickname: '\u0000', avatar: 'ghost', frame: 'cosmic' }, animal: 'lion', theme: 'royal',
    cleared: [1, 1, 2.5, 100, '2'], dailyCleared: ['2026-02-30', '2026-10-13']
  });
  assert.equal(data.xp, 0); assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
  assert.equal(data.animal, 'cat'); assert.equal(data.theme, 'cream');
  assert.deepEqual(data.profile, { nickname: '喵友', avatar: 'cat', frame: 'basic' });
  assert.equal(data.checkin.streak, 0); assert.deepEqual(data.cleared, [1]);
  assert.deepEqual(data.dailyCleared, ['2026-10-13']);
});

test('正确放置分数按阶数与难度递增，首个手动放置没有连击加成', () => {
  assert.deepEqual(progression.correctScore({ size: 5, difficulty: 'easy', combo: 0 }), { base: 1200, comboBonus: 0, points: 1200, combo: 1, assisted: false });
  assert.equal(progression.correctScore({ size: 5, difficulty: 'normal' }).base, 1380);
  assert.equal(progression.correctScore({ size: 5, difficulty: 'hard' }).base, 1560);
  assert.equal(progression.correctScore({ size: 9, difficulty: 'hard' }).base, 2180);
  assert.equal(progression.correctScore({ size: 4 }).base, 1080);
});

test('连对奖励递增至百分之六十封顶，助手得基础分并中断连对', () => {
  const points = Array.from({ length: 8 }, (_, combo) => progression.correctScore({ size: 5, combo }).points);
  for (let i = 1; i <= 5; i++) assert.ok(points[i] > points[i - 1]);
  assert.equal(points[5], 1920); assert.equal(points[6], points[5]); assert.equal(points[7], points[5]);
  const helper = progression.correctScore({ size: 5, combo: 5, assisted: true });
  assert.deepEqual(helper, { base: 1200, comboBonus: 0, points: 1200, combo: 0, assisted: true });
});

test('通关明细可加总，较短耗时奖励更多且不会超过基础总分百分之二十', () => {
  const options = { size: 5, difficulty: 'easy', manual: 5, assisted: 0, errors: 0, elapsed: 30000, score: 7440 };
  assert.deepEqual(progression.finishScore(options), { placement: 7440, perfectBonus: 900, speedBonus: 800, total: 9140, targetTimeMs: 45000 });
  const fastest = progression.finishScore({ ...options, elapsed: 0 });
  const slower = progression.finishScore({ ...options, elapsed: 60000 });
  const slowest = progression.finishScore({ ...options, elapsed: 90000 });
  assert.equal(fastest.speedBonus, 1200); assert.ok(fastest.total > slower.total);
  assert.ok(slower.total > slowest.total); assert.equal(slowest.speedBonus, 0);
  assert.equal(fastest.total, fastest.placement + fastest.perfectBonus + fastest.speedBonus);
});

test('错误或复活取消无误奖励，提示减少额外奖励但不扣既有放置分', () => {
  const options = { size: 5, manual: 5, assisted: 0, errors: 0, elapsed: 0, score: 7440 };
  assert.equal(progression.finishScore({ ...options, errors: 1 }).perfectBonus, 0);
  assert.equal(progression.finishScore({ ...options, revives: 1 }).perfectBonus, 0);
  const plain = progression.finishScore(options), hint = progression.finishScore({ ...options, hints: 1 });
  assert.equal(hint.placement, plain.placement); assert.ok(hint.total < plain.total);
  assert.equal(progression.finishScore({ ...options, hints: 100 }).perfectBonus, 450);
});

test('助手基础分保留，通关奖励按手动放置占比计算，给定猫不增分', () => {
  const allHelpers = progression.finishScore({ size: 5, manual: 0, assisted: 5, score: 6000, elapsed: 0, errors: 0 });
  assert.deepEqual(allHelpers, { placement: 6000, perfectBonus: 0, speedBonus: 0, total: 6000, targetTimeMs: 45000 });
  const mixed = progression.finishScore({ size: 5, manual: 3, assisted: 2, score: 6500, elapsed: 0, errors: 0 });
  assert.equal(mixed.perfectBonus, 540); assert.equal(mixed.speedBonus, 720);
  const givenTwo = progression.finishScore({ size: 5, manual: 3, assisted: 0, score: 4030, elapsed: 0, errors: 0 });
  assert.equal(givenTwo.perfectBonus, 540); assert.equal(givenTwo.speedBonus, 720);
  assert.equal(progression.finishScore({ size: 5, manual: 0, assisted: 0, score: 0, elapsed: 0 }).total, 0);
});

test('损坏耗时不能获得速度奖励，计分函数不修改参数', () => {
  const options = { size: 5, manual: 5, score: 6000, elapsed: -1 }, before = copy(options);
  assert.equal(progression.finishScore(options).speedBonus, 0); assert.deepEqual(options, before);
  assert.equal(progression.finishScore({ ...options, elapsed: Infinity }).speedBonus, 0);
  assert.equal(progression.finishScore({ ...options, elapsed: NaN }).speedBonus, 0);
});

test('有限道具耗尽后拒绝，无法通过未知库存键或小数库存消费', () => {
  const data = progression.hydrate();
  for (let i = 0; i < 3; i++) assert.equal(progression.consume(data, 'hints'), true);
  assert.equal(progression.consume(data, 'hints'), false); assert.equal(data.inventory.hints, 0);
  assert.equal(data.inventory.helpers, 3); assert.equal(progression.consume(data, 'helpers'), true);
  const before = copy(data);
  assert.equal(progression.consume(data, 'coins'), false); assert.equal(progression.consume(data, '__proto__'), false);
  assert.deepEqual(data, before);
  data.inventory.helpers = .5; assert.equal(progression.consume(data, 'helpers'), false);
});

test('等级阈值连续，升级只报告新的解锁项，不补充提示和助手', () => {
  assert.equal(progression.levelInfo(99).level, 1); assert.equal(progression.levelInfo(100).level, 2);
  assert.equal(progression.levelInfo(219).level, 2); assert.equal(progression.levelInfo(220).level, 3);
  assert.deepEqual(progression.levelInfo(100), { level: 2, xp: 100, currentXp: 0, neededXp: 120, nextXp: 220, progress: 0 });
  const data = progression.hydrate(), first = progression.rewardClear(data, { id: 1, size: 5 });
  assert.equal(first.rewarded, true); assert.deepEqual(first.reward, { xp: 120, hints: 0, helpers: 0 });
  const second = progression.rewardClear(data, { id: 2, size: 5 });
  assert.equal(second.levelAfter, 3); assert.deepEqual(second.unlocked, { animals: ['calico'], themes: ['forest'], frames: ['mint'] });
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
});

test('普通首次通关奖励不受重玩或领取顺序影响，非法关卡不领奖', () => {
  const data = progression.hydrate();
  assert.equal(progression.rewardClear(data, { id: 60, size: 9 }).reward.xp, 200);
  const before = copy(data);
  for (const id of [60, 0, 100, 2.5, '1', undefined]) assert.equal(progression.rewardClear(data, { id, size: 9 }).rewarded, false);
  assert.deepEqual(data, before);
  assert.equal(progression.rewardClear(data, { id: 1, size: 5 }).rewarded, true);
  assert.deepEqual(data.cleared, [1, 60]);
});

test('每日挑战仅当日首通奖励，时间回拨不能重领旧日期', () => {
  const data = progression.hydrate();
  const first = progression.rewardClear(data, { daily: true, date: '2026-10-13', size: 6 });
  assert.equal(first.rewarded, true); assert.deepEqual(first.reward, { xp: 80, hints: 0, helpers: 0 });
  const before = copy(data);
  assert.equal(progression.rewardClear(data, { daily: true, date: '2026-10-13' }).reason, 'already_claimed');
  assert.equal(progression.rewardClear(data, { daily: true, date: '2026-10-12' }).reason, 'clock_rollback');
  assert.equal(progression.rewardClear(data, { daily: true, date: '2026-02-30' }).reason, 'invalid_date');
  assert.deepEqual(data, before);
  assert.equal(progression.rewardClear(data, { daily: true, date: '2026-10-14' }).rewarded, true);
});

test('打卡七天奖励递增，第七天领礼盒，第八天继续连签并重开奖励周期', () => {
  const data = progression.hydrate();
  let seventh;
  for (let offset = 0; offset < 7; offset++) {
    const result = progression.dailyClaim(data, '2026-10-' + String(13 + offset).padStart(2, '0'));
    assert.equal(result.claimed, true); assert.equal(result.day, offset + 1); assert.equal(result.streak, offset + 1);
    if (offset === 6) seventh = result;
  }
  assert.equal(seventh.reward.xp, 200); assert.equal(seventh.reward.hints, 0); assert.equal(seventh.reward.helpers, 0);
  assert.deepEqual(data.checkin, { lastDate: '2026-10-19', streak: 7, best: 7, total: 7 });
  const eighth = progression.dailyClaim(data, '2026-10-20');
  assert.equal(eighth.day, 1); assert.equal(eighth.streak, 8); assert.equal(eighth.reward.xp, 50);
});

test('同日重复点击、非法日期和回拨拒绝，断签只重置当前连签并保留最佳记录', () => {
  const data = progression.hydrate(); progression.dailyClaim(data, '2026-10-12'); progression.dailyClaim(data, '2026-10-13');
  const before = copy(data);
  assert.equal(progression.dailyClaim(data, '2026-10-13').reason, 'already_claimed');
  assert.equal(progression.dailyClaim(data, '2026-10-11').reason, 'clock_rollback');
  for (const invalid of ['2026-02-30', '2026-13-01', '2026-1-01', '', null, 20261014]) assert.equal(progression.dailyClaim(data, invalid).claimed, false);
  assert.deepEqual(data, before);
  const result = progression.dailyClaim(data, '2026-10-15');
  assert.equal(result.streak, 1); assert.equal(result.day, 1); assert.equal(result.best, 2); assert.equal(data.checkin.total, 3);
});

test('自然日相邻判断跨月跨年与闰日正确，不依赖一天的实际时长', () => {
  for (const [beforeDate, afterDate] of [['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01']]) {
    const data = progression.hydrate(); progression.dailyClaim(data, beforeDate);
    assert.equal(progression.dailyClaim(data, afterDate).streak, 2);
  }
});

test('动物和主题达到相应等级才可选择，头像初始全开放，选择会持久化', () => {
  const data = progression.hydrate(), before = copy(data);
  assert.equal(progression.selectCosmetic(data, 'animal', 'calico'), false);
  assert.equal(progression.selectCosmetic(data, 'theme', 'forest'), false);
  assert.equal(progression.selectCosmetic(data, 'frame', 'mint'), false);
  assert.equal(progression.selectCosmetic(data, 'unknown', 'cat'), false);
  assert.equal(progression.selectCosmetic(data, '__proto__', 'cat'), false);
  assert.deepEqual(data, before);
  for (const avatar of progression.AVATARS) assert.equal(progression.selectCosmetic(data, 'avatar', avatar.id), true);
  data.xp = 220;
  assert.equal(progression.selectCosmetic(data, 'animal', 'calico'), true);
  assert.equal(progression.selectCosmetic(data, 'theme', 'forest'), true);
  assert.equal(progression.selectCosmetic(data, 'frame', 'mint'), true);
  assert.equal(progression.selectCosmetic(data, 'animal', 'panda'), false);
  assert.deepEqual(progression.hydrate(copy(data)), data);
});

test('高阶外观在跨多个等级后一起解锁，目录 ID 唯一且等级有序', () => {
  const data = progression.hydrate(); data.xp = 5700;
  const result = progression.rewardClear(data, { id: 60, size: 9 });
  assert.equal(result.levelBefore, 20); assert.equal(result.levelAfter, 21);
  assert.deepEqual(result.unlocked, { animals: ['lion'], themes: ['royal'], frames: ['cosmic'] });
  for (const catalog of [progression.ANIMALS, progression.THEMES, progression.AVATARS, progression.FRAMES]) {
    assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
    assert.ok(catalog.every((item, index) => index === 0 || item.level >= catalog[index - 1].level));
  }
});

test('昵称允许中文与表情，空白、控制字符及超过十二个字符的输入拒绝', () => {
  const data = progression.hydrate();
  assert.equal(progression.setNickname(data, '  喵 星人  '), true); assert.equal(data.profile.nickname, '喵 星人');
  assert.equal(progression.setNickname(data, '🐱🐼小队'), true); assert.equal(data.profile.nickname, '🐱🐼小队');
  const before = copy(data);
  for (const invalid of ['', '  ', '\u0000昵称', '昵称\n', '一二三四五六七八九十一二三', null, 123]) assert.equal(progression.setNickname(data, invalid), false);
  assert.deepEqual(data, before);
  assert.equal(progression.setNickname(data, '一二三四五六七八九十一二'), true);
});
