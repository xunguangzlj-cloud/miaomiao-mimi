'use strict';

const ranking = require('./ranking');

function createScoreSync(api, onChange, onIdle) {
  let pending = null, busy = false, scheduled = false, cloud = null, state = 'idle';

  function changed(next) { state = next; onChange({ state, cloud }); }

  function finish() {
    busy = false;
    if (scheduled) pump();
    else onIdle({ state, cloud });
  }

  function fail(score) {
    // 读取失败时不能假定云端为零；保留待交成绩，等待下一次主动提交或打开。
    pending = ranking.bestScore(pending, score); scheduled = false;
    changed('failed'); finish();
  }

  function pump() {
    if (busy || !scheduled) return;
    busy = true; scheduled = false;
    const submitted = pending; pending = null; changed('loading');
    if (typeof api.getUserCloudStorage !== 'function') { fail(submitted); return; }
    try {
      api.getUserCloudStorage({ keyList: [ranking.STORAGE_KEY], success(res) {
        if (!res || !Array.isArray(res.KVDataList)) { fail(submitted); return; }
        const stored = ranking.parseScore(res.KVDataList);
        const target = ranking.bestScore(cloud, ranking.bestScore(stored, ranking.bestScore(submitted, pending)));
        cloud = stored;
        pending = null; scheduled = false;
        if (!target || target.completed === 0 || (cloud && ranking.compareScores(cloud, target) <= 0)) {
          changed('synced'); finish(); return;
        }
        if (typeof api.setUserCloudStorage !== 'function') { fail(target); return; }
        const value = JSON.stringify({ version: 2, points: target.points, completed: target.completed, totalTimeMs: target.totalTimeMs,
          wxgame: { score: Math.min(target.points, ranking.PLATFORM_MAX_SCORE), update_time: Math.floor(Date.now() / 1000) } });
        try {
          api.setUserCloudStorage({ KVDataList: [{ key: ranking.STORAGE_KEY, value }],
            success() { cloud = target; changed('synced'); finish(); }, fail() { fail(target); } });
        } catch (_) { fail(target); }
      }, fail() { fail(submitted); } });
    } catch (_) { fail(submitted); }
  }

  function submit(score) {
    if (!ranking.validScore(score)) return false;
    pending = ranking.bestScore(pending, score); scheduled = true; pump(); return true;
  }

  return { submit, getState: () => ({ busy, state, cloud, pending }) };
}

module.exports = { createScoreSync };
