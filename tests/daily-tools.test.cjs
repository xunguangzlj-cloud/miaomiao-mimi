'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../src/progression.js');
const copy = value => JSON.parse(JSON.stringify(value));

test('新档初始各三次，指定日期建立每日刷新记录', () => {
  const data = progress.hydrate(undefined, undefined, undefined, '2026-10-13');
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
  assert.equal(data.inventoryDate, '2026-10-13');
  assert.equal(progress.refreshTools(data, '2026-10-13'), false);
});

test('未传日期不推算系统时间，旧档已有合法刷新日期仍保留', () => {
  assert.equal(progress.hydrate().inventoryDate, '');
  assert.equal(progress.hydrate(undefined, undefined, undefined, null).inventoryDate, '');
  const data = progress.hydrate({ inventory: { hints: 0, helpers: 1 }, inventoryDate: '2026-10-12' });
  assert.equal(data.inventoryDate, '2026-10-12');
  assert.deepEqual(data.inventory, { hints: 0, helpers: 1 });
});

test('无刷新日期的旧零库存迁移后仍为零，首次建立日期不补充次数', () => {
  const stored = { xp: 1500, inventory: { hints: 0, helpers: 0 } }, before = copy(stored);
  const data = progress.hydrate(stored, undefined, undefined, '2026-10-13');
  assert.deepEqual(data.inventory, { hints: 0, helpers: 0 });
  assert.equal(data.inventoryDate, '2026-10-13');
  assert.deepEqual(stored, before);
  assert.deepEqual(progress.hydrate(copy(data), undefined, undefined, '2026-10-13'), data);
  assert.equal(progress.refreshTools(data, '2026-10-14'), true);
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
});

test('旧存档库存上限夹到三，已使用的有效剩余次数保留', () => {
  const data = progress.hydrate({ inventory: { hints: 7, helpers: 9999 } }, undefined, undefined, '2026-10-13');
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
  const partlyUsed = progress.hydrate({ inventory: { hints: 1, helpers: 2 } }, undefined, undefined, '2026-10-13');
  assert.deepEqual(partlyUsed.inventory, { hints: 1, helpers: 2 });
});

test('同日耗尽后重读或重复刷新不会补充，跨日库存恢复满三', () => {
  const data = progress.hydrate(undefined, undefined, undefined, '2026-10-13');
  for (const key of ['hints', 'helpers']) {
    for (let i = 0; i < 3; i++) assert.equal(progress.consume(data, key), true);
    assert.equal(progress.consume(data, key), false);
  }
  assert.equal(progress.refreshTools(data, '2026-10-13'), false);
  assert.deepEqual(progress.hydrate(copy(data), undefined, undefined, '2026-10-13').inventory, { hints: 0, helpers: 0 });
  const nextDay = progress.hydrate(copy(data), undefined, undefined, '2026-10-14');
  assert.deepEqual(nextDay.inventory, { hints: 3, helpers: 3 });
  assert.equal(nextDay.inventoryDate, '2026-10-14');
  assert.equal(progress.refreshTools(nextDay, '2026-10-14'), false);
});

test('每日刷新跨月跨年和闰日，跳过多日也只补到三次', () => {
  for (const [before, after] of [['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2026-10-13', '2026-11-13']]) {
    const data = progress.hydrate({ inventory: { hints: 1, helpers: 0 }, inventoryDate: before });
    assert.equal(progress.refreshTools(data, after), true);
    assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
    assert.equal(data.inventoryDate, after);
  }
});

test('时间回拨不补充、不降低已记录日期，回到同日也不能重复刷新', () => {
  const data = progress.hydrate({ inventory: { hints: 0, helpers: 1 }, inventoryDate: '2026-10-14' });
  const before = copy(data);
  assert.equal(progress.refreshTools(data, '2026-10-13'), false);
  assert.equal(progress.refreshTools(data, '2026-10-14'), false);
  assert.deepEqual(data, before);
  assert.deepEqual(progress.hydrate(copy(data), undefined, undefined, '2026-10-13'), before);
  assert.equal(progress.refreshTools(data, '2026-10-15'), true);
  assert.deepEqual(data.inventory, { hints: 3, helpers: 3 });
});

test('错误日期刷新完全拒绝，无效旧日期迁移只建立今天日期', () => {
  const data = progress.hydrate({ inventory: { hints: 0, helpers: 0 }, inventoryDate: '2026-10-13' }), before = copy(data);
  for (const invalid of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-01', '2026-10-13T00:00:00', '', undefined, null, 20261014]) {
    assert.equal(progress.refreshTools(data, invalid), false);
    assert.deepEqual(data, before);
  }
  const migrated = progress.hydrate({ inventory: { hints: 0, helpers: 2 }, inventoryDate: '2026-02-30' }, undefined, undefined, '2026-10-13');
  assert.equal(migrated.inventoryDate, '2026-10-13');
  assert.deepEqual(migrated.inventory, { hints: 0, helpers: 2 });
});

test('升级、七日签到礼盒及每日挑战只奖励经验，不恢复已用完次数', () => {
  const data = progress.hydrate({ inventory: { hints: 0, helpers: 0 } }, undefined, undefined, '2026-10-13');
  const first = progress.rewardClear(data, { id: 1, size: 9 });
  assert.ok(first.levelAfter > first.levelBefore);
  assert.deepEqual(first.reward, { xp: 200, hints: 0, helpers: 0 });
  for (let offset = 0; offset < 7; offset++) {
    const result = progress.dailyClaim(data, '2026-10-' + String(13 + offset));
    assert.deepEqual(result.reward, progress.CHECKIN_REWARDS[offset]);
    assert.deepEqual(data.inventory, { hints: 0, helpers: 0 });
  }
  const daily = progress.rewardClear(data, { daily: true, date: '2026-10-19' });
  assert.deepEqual(daily.reward, { xp: 80, hints: 0, helpers: 0 });
  assert.deepEqual(data.inventory, { hints: 0, helpers: 0 });
  assert.equal(data.inventoryDate, '2026-10-13');
});

test('九十九关首次奖励去重，任意领取顺序均不补工具且复读不重发经验', () => {
  const data = progress.hydrate({ inventory: { hints: 0, helpers: 0 } }, undefined, undefined, '2026-10-13');
  for (let id = 99; id >= 1; id--) {
    const result = progress.rewardClear(data, { id, size: 9 });
    assert.equal(result.rewarded, true);
    assert.deepEqual(result.reward, { xp: 200, hints: 0, helpers: 0 });
  }
  assert.equal(data.xp, 99 * 200);
  assert.deepEqual(data.cleared, Array.from({ length: 99 }, (_, i) => i + 1));
  assert.deepEqual(data.inventory, { hints: 0, helpers: 0 });
  const restored = progress.hydrate(copy(data), undefined, undefined, '2026-10-13'), before = copy(restored);
  for (let id = 1; id <= 99; id++) assert.equal(progress.rewardClear(restored, { id, size: 9 }).rewarded, false);
  assert.deepEqual(restored, before);
});
