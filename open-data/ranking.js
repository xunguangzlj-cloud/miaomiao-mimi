'use strict';

const STORAGE_KEY = 'miaoge_progress_v1';
const PLATFORM_MAX_SCORE = 2147483647;

function normalizeScore(value) {
  if (!value) return null;
  const points = value.points === undefined ? 0 : value.points;
  if (!Number.isSafeInteger(points) || points < 0 ||
      !Number.isInteger(value.completed) || value.completed < 0 || value.completed > 99 ||
      !Number.isSafeInteger(value.totalTimeMs) || value.totalTimeMs < 0 ||
      (value.completed === 0 && (points !== 0 || value.totalTimeMs !== 0))) return null;
  return { points, completed: value.completed, totalTimeMs: value.totalTimeMs };
}

function validScore(value) {
  return normalizeScore(value) !== null;
}

function parseScore(list) {
  if (!Array.isArray(list)) return null;
  const field = list.find(item => item && item.key === STORAGE_KEY);
  if (!field || typeof field.value !== 'string' || field.value.length > 2048) return null;
  let value;
  try { value = JSON.parse(field.value); } catch (_) { return null; }
  if (!value || (value.version !== 1 && value.version !== 2)) return null;
  // 旧版只记录进度，不能凭空推算积分；平台系统榜的 score 必须是 Int32。
  const score = normalizeScore({ points: value.version === 1 ? 0 : value.points,
    completed: value.completed, totalTimeMs: value.totalTimeMs });
  if (!score || (value.version === 2 && value.points === undefined) || !value.wxgame ||
      value.wxgame.score !== (value.version === 1 ? score.completed : Math.min(score.points, PLATFORM_MAX_SCORE)) ||
      !Number.isSafeInteger(value.wxgame.update_time) || value.wxgame.update_time < 0) return null;
  return score;
}

function compareScores(a, b) {
  return (b.points || 0) - (a.points || 0) || b.completed - a.completed || a.totalTimeMs - b.totalTimeMs;
}

function bestScore(a, b) {
  const first = normalizeScore(a), second = normalizeScore(b);
  if (!first) return second;
  return !second || compareScores(first, second) <= 0 ? first : second;
}

function makeRanking(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set(), rows = [];
  data.forEach((user, index) => {
    if (!user || typeof user.openid !== 'string' || !user.openid || seen.has(user.openid)) return;
    const score = parseScore(user.KVDataList);
    if (!score) return;
    seen.add(user.openid);
    rows.push({ openid: user.openid, nickname: typeof user.nickname === 'string' ? user.nickname : '微信用户',
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : '',
      points: score.points, completed: score.completed, totalTimeMs: score.totalTimeMs, index });
  });
  // 同积分、通关数和用时维持微信返回顺序，不用姓名或随机数改变位置。
  rows.sort((a, b) => compareScores(a, b) || a.index - b.index);
  rows.forEach((row, index) => {
    row.rank = index > 0 && compareScores(row, rows[index - 1]) === 0 ? rows[index - 1].rank : index + 1;
  });
  return rows;
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + sec : minutes + ':' + sec;
}

function formatPoints(points) { return String(points).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

module.exports = { STORAGE_KEY, PLATFORM_MAX_SCORE, normalizeScore, validScore, parseScore, compareScores, bestScore, makeRanking, formatTime, formatPoints };
