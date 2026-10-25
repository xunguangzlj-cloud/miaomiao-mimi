'use strict';

// 本地成长与计分规则只处理状态；存储、声音和界面由主流程负责。
const MAX_XP = 10000000, MAX_INVENTORY = 9999, TOOL_LIMIT = 3;
const DIFFICULTY = { easy: 1, normal: 1.15, hard: 1.3 };
const { THEMES, FRAMES } = require('./cosmetics.js');
const ANIMALS = [
  { id: 'cat', name: '奶油猫', level: 1 },
  { id: 'calico', name: '三花猫', level: 3 },
  { id: 'panda', name: '竹叶熊猫', level: 5 },
  { id: 'rabbit', name: '月光兔', level: 8 },
  { id: 'corgi', name: '小柯基', level: 12 },
  { id: 'lion', name: '小狮子', level: 21 },
  { id: 'crocodile', name: '开心鳄鱼', level: 25 },
  { id: 'duck', name: '活力小鸭', level: 30 }
];
const AVATARS = [
  { id: 'cat', name: '奶油猫', level: 1 },
  { id: 'corgi', name: '小柯基', level: 1 },
  { id: 'rabbit', name: '月光兔', level: 1 },
  { id: 'panda', name: '竹叶熊猫', level: 1 },
  { id: 'lion', name: '小狮子', level: 1 },
  { id: 'crocodile', name: '开心鳄鱼', level: 1 },
  { id: 'duck', name: '活力小鸭', level: 1 },
  { id: 'calico', name: '三花猫', level: 1 }
];
const CHECKIN_REWARDS = [
  { xp: 50, hints: 0, helpers: 0 },
  { xp: 60, hints: 0, helpers: 0 },
  { xp: 70, hints: 0, helpers: 0 },
  { xp: 80, hints: 0, helpers: 0 },
  { xp: 90, hints: 0, helpers: 0 },
  { xp: 100, hints: 0, helpers: 0 },
  { xp: 200, hints: 0, helpers: 0 }
];

function integer(value, fallback, max) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}
function sizeOf(value) { return Number.isInteger(value) && value >= 4 && value <= 9 ? value : 5; }
function multiplier(value) { return Object.prototype.hasOwnProperty.call(DIFFICULTY, value) ? DIFFICULTY[value] : 1; }
function roundPoints(value) { return Math.round(value / 10) * 10; }
function dateOrdinal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86400000 : null;
}
function validRecord(record) {
  return record && typeof record === 'object' && Number.isFinite(record.time) && record.time >= 0 && Number.isInteger(record.hints) && record.hints >= 0;
}
function recordIds(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  return Array.from(new Set(Object.keys(records).filter(key => Number.isInteger(Number(key)) && Number(key) >= 1 && Number(key) <= 99 && validRecord(records[key])).map(Number))).sort((a, b) => a - b);
}
function recordDates(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  return Object.keys(records).filter(key => dateOrdinal(key) !== null && validRecord(records[key])).sort();
}
function firstClearXp(size) { return 100 + 20 * (sizeOf(size) - 4); }

function levelInfo(value) {
  const xp = integer(value, 0, MAX_XP);
  const level = Math.floor((Math.sqrt(81 + .4 * xp) - 9) / 2) + 1;
  const currentThreshold = 10 * (level - 1) * (level + 8), nextXp = 10 * level * (level + 9);
  return { level, xp, currentXp: xp - currentThreshold, neededXp: nextXp - currentThreshold, nextXp, progress: (xp - currentThreshold) / (nextXp - currentThreshold) };
}

function nickname(value) {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F]/.test(value)) return null;
  const result = value.trim().replace(/\s+/g, ' ');
  return result && Array.from(result).length <= 12 ? result : null;
}
function selected(catalog, id, level) {
  return catalog.some(item => item.id === id && item.level <= level) ? id : catalog[0].id;
}

function hydrate(input, completed, daily, date) {
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const ids = recordIds(completed), dates = recordDates(daily);
  // 旧版已确认的通关可以恢复成长经验，不从旧耗时推算分数。
  const legacyXp = ids.reduce((sum, id) => sum + firstClearXp(Math.min(9, 5 + Math.floor((id - 1) / 12))), 0) + dates.length * 80;
  const xp = integer(stored.xp, Math.min(MAX_XP, legacyXp), MAX_XP), level = levelInfo(xp).level;
  const inventory = stored.inventory && typeof stored.inventory === 'object' ? stored.inventory : {};
  const oldCheckin = stored.checkin && typeof stored.checkin === 'object' ? stored.checkin : {};
  const lastDate = dateOrdinal(oldCheckin.lastDate) !== null ? oldCheckin.lastDate : '';
  const streak = lastDate ? Math.max(1, integer(oldCheckin.streak, 1, MAX_INVENTORY)) : 0;
  const best = Math.max(streak, integer(oldCheckin.best, 0, MAX_INVENTORY));
  const oldProfile = stored.profile && typeof stored.profile === 'object' ? stored.profile : {};
  const storedIds = Array.isArray(stored.cleared) ? stored.cleared.filter(id => Number.isInteger(id) && id >= 1 && id <= 99) : [];
  const storedDates = Array.isArray(stored.dailyCleared) ? stored.dailyCleared.filter(date => dateOrdinal(date) !== null) : [];
  const data = {
    version: 1, xp,
    inventory: { hints: integer(inventory.hints, TOOL_LIMIT, TOOL_LIMIT), helpers: integer(inventory.helpers, TOOL_LIMIT, TOOL_LIMIT) },
    inventoryDate: dateOrdinal(stored.inventoryDate) !== null ? stored.inventoryDate : '',
    checkin: { lastDate, streak, best, total: Math.max(streak, best, integer(oldCheckin.total, 0, MAX_INVENTORY)) },
    profile: { nickname: nickname(oldProfile.nickname) || '喵友', avatar: selected(AVATARS, oldProfile.avatar, level), frame: selected(FRAMES, oldProfile.frame, level) },
    animal: selected(ANIMALS, stored.animal, level), theme: selected(THEMES, stored.theme, level),
    cleared: Array.from(new Set(ids.concat(storedIds))).sort((a, b) => a - b),
    dailyCleared: Array.from(new Set(dates.concat(storedDates))).sort().slice(-90)
  };
  refreshTools(data, date);
  return data;
}

function refreshTools(data, date) {
  const day = dateOrdinal(date);
  if (day === null || !data || !data.inventory) return false;
  const previousDay = dateOrdinal(data.inventoryDate);
  if (previousDay !== null && day <= previousDay) return false;
  // 旧档首次建立刷新日期时保留剩余次数，避免重读存档补回已经用掉的道具。
  if (previousDay !== null) data.inventory = { hints: TOOL_LIMIT, helpers: TOOL_LIMIT };
  data.inventoryDate = date;
  return true;
}

function correctScore(options) {
  options = options || {};
  const size = sizeOf(options.size), base = roundPoints((600 + 120 * size) * multiplier(options.difficulty));
  const assisted = options.assisted === true, previousCombo = integer(options.combo, 0, MAX_INVENTORY);
  const comboBonus = assisted ? 0 : roundPoints(base * .12 * Math.min(previousCombo, 5));
  return { base, comboBonus, points: base + comboBonus, combo: assisted ? 0 : previousCombo + 1, assisted };
}

function finishScore(options) {
  options = options || {};
  const size = sizeOf(options.size), manual = integer(options.manual, 0, size), assisted = integer(options.assisted, 0, size - manual);
  const placement = integer(options.score, 0, MAX_XP), base = correctScore({ size, difficulty: options.difficulty }).base;
  const totalCats = manual + assisted, manualShare = totalCats ? manual / totalCats : 0;
  const hints = integer(options.hints, 0, MAX_INVENTORY), supportFactor = Math.max(.5, 1 - hints * .1);
  const targetTimeMs = Math.round(size * size * 1800 * multiplier(options.difficulty));
  const timeFactor = Number.isFinite(options.elapsed) && options.elapsed >= 0 ? Math.max(0, 1 - options.elapsed / (2 * targetTimeMs)) : 0;
  const errors = integer(options.errors, 0, MAX_INVENTORY), revives = integer(options.revives, 0, MAX_INVENTORY);
  const perfectBonus = !errors && !revives ? roundPoints(base * totalCats * .15 * manualShare * supportFactor) : 0;
  const speedBonus = roundPoints(base * totalCats * .2 * timeFactor * manualShare * supportFactor);
  return { placement, perfectBonus, speedBonus, total: placement + perfectBonus + speedBonus, targetTimeMs };
}

function consume(data, key) {
  if ((key !== 'hints' && key !== 'helpers') || !data || !data.inventory || !Number.isInteger(data.inventory[key]) || data.inventory[key] <= 0) return false;
  data.inventory[key]--; return true;
}

function unlocks(before, after) {
  const newlyAvailable = catalog => catalog.filter(item => item.level > before && item.level <= after).map(item => item.id);
  return { animals: newlyAvailable(ANIMALS), themes: newlyAvailable(THEMES), frames: newlyAvailable(FRAMES) };
}
function applyReward(data, reward) {
  const before = levelInfo(data.xp).level, previousXp = data.xp;
  data.xp = Math.min(MAX_XP, data.xp + reward.xp);
  const after = levelInfo(data.xp).level;
  const applied = { xp: data.xp - previousXp, hints: 0, helpers: 0 };
  return { reward: applied, levelBefore: before, levelAfter: after, unlocked: unlocks(before, after) };
}
function noReward(data, reason) {
  const level = levelInfo(data.xp).level;
  return { reason, reward: { xp: 0, hints: 0, helpers: 0 }, levelBefore: level, levelAfter: level, unlocked: unlocks(level, level) };
}

function dailyClaim(data, date) {
  const day = dateOrdinal(date), previousDay = dateOrdinal(data.checkin.lastDate);
  if (day === null) return Object.assign({ claimed: false }, noReward(data, 'invalid_date'));
  if (previousDay !== null && day <= previousDay) return Object.assign({ claimed: false }, noReward(data, day === previousDay ? 'already_claimed' : 'clock_rollback'));
  data.checkin.streak = previousDay !== null && day === previousDay + 1 ? Math.min(MAX_INVENTORY, data.checkin.streak + 1) : 1;
  data.checkin.lastDate = date; data.checkin.best = Math.max(data.checkin.best, data.checkin.streak);
  data.checkin.total = Math.min(MAX_INVENTORY, data.checkin.total + 1);
  const cycleDay = (data.checkin.streak - 1) % 7 + 1;
  return Object.assign({ claimed: true, day: cycleDay, streak: data.checkin.streak, best: data.checkin.best }, applyReward(data, CHECKIN_REWARDS[cycleDay - 1]));
}

function rewardClear(data, options) {
  options = options || {};
  if (options.daily === true) {
    const day = dateOrdinal(options.date), latest = data.dailyCleared.length ? dateOrdinal(data.dailyCleared[data.dailyCleared.length - 1]) : null;
    if (day === null) return Object.assign({ rewarded: false }, noReward(data, 'invalid_date'));
    if (latest !== null && day <= latest) return Object.assign({ rewarded: false }, noReward(data, day === latest ? 'already_claimed' : 'clock_rollback'));
    data.dailyCleared.push(options.date); data.dailyCleared = data.dailyCleared.slice(-90);
    return Object.assign({ rewarded: true }, applyReward(data, { xp: 80, hints: 0, helpers: 0 }));
  }
  if (!Number.isInteger(options.id) || options.id < 1 || options.id > 99) return Object.assign({ rewarded: false }, noReward(data, 'invalid_level'));
  if (data.cleared.includes(options.id)) return Object.assign({ rewarded: false }, noReward(data, 'already_claimed'));
  data.cleared.push(options.id); data.cleared.sort((a, b) => a - b);
  return Object.assign({ rewarded: true }, applyReward(data, { xp: firstClearXp(options.size), hints: 0, helpers: 0 }));
}

function selectCosmetic(data, kind, id) {
  const catalogs = { animal: ANIMALS, theme: THEMES, avatar: AVATARS, frame: FRAMES };
  if (!Object.prototype.hasOwnProperty.call(catalogs, kind) || !catalogs[kind].some(item => item.id === id && item.level <= levelInfo(data.xp).level)) return false;
  if (kind === 'avatar' || kind === 'frame') data.profile[kind] = id; else data[kind] = id;
  return true;
}
function setNickname(data, value) {
  const result = nickname(value);
  if (!result) return false;
  data.profile.nickname = result; return true;
}

module.exports = { ANIMALS, THEMES, AVATARS, FRAMES, CHECKIN_REWARDS, hydrate, refreshTools, levelInfo, correctScore, finishScore, consume, dailyClaim, rewardClear, selectCosmetic, setNickname };
