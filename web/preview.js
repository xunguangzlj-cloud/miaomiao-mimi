(function(){
'use strict';
const factories={"platform":function(module,exports,require){
(function () {
  'use strict';

  function createPlatform(options) {
    options = options || {};
    const isWechat = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';
    const browser = typeof window !== 'undefined' ? window : null;
    const info = isWechat
      ? (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync())
      : {};
    const canvas = isWechat ? wx.createCanvas() : (options.canvas || document.getElementById('game'));
    const width = isWechat ? info.windowWidth : (options.width || canvas.clientWidth || browser.innerWidth);
    const height = isWechat ? info.windowHeight : (options.height || canvas.clientHeight || browser.innerHeight);
    const pixelRatio = Math.max(1, Math.min(isWechat ? (info.pixelRatio || 1) : (browser.devicePixelRatio || 1), 3));
    const screenTop = info.screenTop || 0;
    const safe = info.safeArea;
    let safeTop = isWechat ? Math.max(0, (safe ? safe.top : (info.statusBarHeight || 0)) - screenTop) : 0;
    const safeBottom = safe ? Math.max(0, height - (safe.bottom - screenTop)) : 0;

    // 游戏内容留在微信胶囊按钮下方，所有坐标统一使用逻辑像素。
    if (isWechat && typeof wx.getMenuButtonBoundingClientRect === 'function') {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.bottom > 0) safeTop = Math.max(safeTop, menu.bottom - screenTop + 8);
    }
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    if (!isWechat) {
      canvas.style.touchAction = 'none';
      canvas.style.userSelect = 'none';
    }
    const ctx = canvas.getContext('2d');
    ctx.scale(pixelRatio, pixelRatio);
    const now = () => Date.now();

    function onPointer(handler) {
      if (isWechat) {
        let activeId = null;
        let lastPoint = { x: 0, y: 0 };
        function dispatch(type, event) {
          const changed = event.changedTouches || [];
          if (type === 'down') {
            if (activeId !== null || !changed.length) return;
            activeId = changed[0].identifier;
          } else if (activeId === null) return;
          const touch = changed.find(point => point.identifier === activeId);
          if (!touch && !(type === 'cancel' && changed.length === 0)) return;
          if (touch) lastPoint = { x: touch.clientX, y: touch.clientY };
          handler({ type, x: lastPoint.x, y: lastPoint.y, time: now() });
          if (type === 'up' || type === 'cancel') activeId = null;
        }
        wx.onTouchStart(event => dispatch('down', event));
        wx.onTouchMove(event => dispatch('move', event));
        wx.onTouchEnd(event => dispatch('up', event));
        wx.onTouchCancel(event => dispatch('cancel', event));
      } else {
        let activeId = null;
        ['down', 'move', 'up', 'cancel'].forEach(type => {
          canvas.addEventListener('pointer' + type, event => {
            if (type === 'down') {
              if (activeId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
              activeId = event.pointerId;
              canvas.setPointerCapture(event.pointerId);
            }
            if (event.pointerId !== activeId) return;
            event.preventDefault();
            const rect = canvas.getBoundingClientRect();
            handler({
              type,
              x: (event.clientX - rect.left) * width / rect.width,
              y: (event.clientY - rect.top) * height / rect.height,
              time: now()
            });
            if (type === 'up' || type === 'cancel') activeId = null;
          });
        });
      }
    }

    // 存储不可用或旧存档损坏时返回空值，棋局仍可以正常运行。
    const storage = {
      get(key) {
        try {
          if (isWechat) {
            const value = wx.getStorageSync(key);
            return value === '' ? null : value;
          }
          const value = browser.localStorage.getItem(key);
          return value === null ? null : JSON.parse(value);
        } catch (error) { return null; }
      },
      set(key, value) {
        try {
          if (isWechat) wx.setStorageSync(key, value);
          else browser.localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (error) { return false; }
      }
    };

    function vibrate(kind) {
      if (isWechat && typeof wx.vibrateShort === 'function') {
        const strength = ['light', 'medium', 'heavy'].includes(kind) ? kind : (kind === 'error' ? 'heavy' : 'light');
        wx.vibrateShort({ type: strength, fail() {} });
      } else if (browser && browser.navigator.vibrate) {
        browser.navigator.vibrate(kind === 'error' || kind === 'heavy' ? 35 : 15);
      }
    }

    function requestFrame(fn) {
      // 帧、触摸和计时器共用同一个时间基准，避免混用相对时间和日期时间。
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => fn(now()));
      return setTimeout(() => fn(now()), 16);
    }

    function onHide(fn) {
      if (isWechat) wx.onHide(fn);
      else document.addEventListener('visibilitychange', () => { if (document.hidden) fn(); });
    }

    function onShow(fn) {
      if (isWechat) wx.onShow(fn);
      else document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
    }

    function loadImage(filename, done) {
      if (isWechat && typeof wx.createImage !== 'function') { done(null); return null; }
      const bitmap = isWechat ? wx.createImage() : new browser.Image();
      bitmap.onload = () => done(bitmap);
      bitmap.onerror = () => done(null);
      bitmap.src = isWechat ? filename : (options.assetBase || '../') + filename;
      return bitmap;
    }

    let openData = null;
    if (isWechat && typeof wx.getOpenDataContext === 'function') {
      try { openData = wx.getOpenDataContext({ sharedCanvasMode: 'offscreenCanvas' }); } catch (error) {}
    }
    const rankingAvailable = !!(openData && openData.canvas && typeof openData.postMessage === 'function');
    const friendScope = 'scope.WxFriendInteraction';
    let latestScore = null;
    let privacyReady = false, friendReady = false, authorizationRevision = 0;
    let privacyHandler = null, privacyRequest = null;

    function normalizeScore(score) {
      score = score || {};
      const completed = Number.isFinite(score.completed) ? Math.max(0, Math.min(99, Math.floor(score.completed))) : 0;
      return {
        points: completed && Number.isFinite(score.points) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(score.points))) : 0,
        completed,
        totalTimeMs: completed && Number.isFinite(score.totalTimeMs) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(score.totalTimeMs))) : 0
      };
    }

    function rankingResult(done, success, error, denied) {
      if (typeof done === 'function') done({ success, ...(error ? { error } : {}), ...(denied ? { denied: true } : {}) });
    }

    function postRanking(message) {
      if (!rankingAvailable) return false;
      try { openData.postMessage(message); return true; } catch (error) { return false; }
    }

    function keepScore(score) {
      const next = normalizeScore(score);
      if (!latestScore || next.points > latestScore.points || (next.points === latestScore.points &&
          (next.completed > latestScore.completed || (next.completed === latestScore.completed && next.totalTimeMs < latestScore.totalTimeMs)))) latestScore = next;
      return latestScore;
    }

    function flushScore() {
      return !!(privacyReady && friendReady && latestScore && postRanking({ type: 'rank:submit', score: { ...latestScore } }));
    }

    function presentPrivacy(request) {
      if (!privacyHandler || !request.ready || request.delivered || request.finished) return;
      request.delivered = true;
      function expose() {
        if (!request.exposed) { request.exposed = true; request.resolve({ event: 'exposureAuthorization' }); }
      }
      function decide(event) {
        if (request.finished) return false;
        expose(); request.finished = true;
        if (privacyRequest === request) privacyRequest = null;
        request.resolve({ event });
        return true;
      }
      privacyHandler({
        contractName: request.contractName,
        agree: () => decide('agree'),
        disagree: () => decide('disagree'),
        openContract(done) {
          if (typeof wx.openPrivacyContract !== 'function') { rankingResult(done, false, '请更新微信以查看隐私保护指引'); return false; }
          try {
            wx.openPrivacyContract({ success: () => rankingResult(done, true), fail: error => rankingResult(done, false, (error && error.errMsg) || '打开隐私保护指引失败') });
            return true;
          } catch (error) { rankingResult(done, false, error.message || '打开隐私保护指引失败'); return false; }
        }
      });
      expose();
    }

    if (isWechat && typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization(resolve => {
        privacyReady = false; friendReady = false; authorizationRevision++;
        const request = { resolve, contractName: '隐私保护指引', ready: false, exposed: false, delivered: false, finished: false };
        privacyRequest = request;
        if (typeof wx.getPrivacySetting !== 'function') { request.ready = true; presentPrivacy(request); return; }
        try {
          wx.getPrivacySetting({
            success(result) { request.contractName = result.privacyContractName || request.contractName; request.ready = true; presentPrivacy(request); },
            fail() { request.ready = true; presentPrivacy(request); }
          });
        } catch (error) { request.ready = true; presentPrivacy(request); }
      });
    }

    function requireRankingPrivacy(continueAuthorization, done) {
      authorizationRevision++; privacyReady = false; friendReady = false;
      if (typeof wx.requirePrivacyAuthorize !== 'function') { rankingResult(done, false, '请更新微信以使用排行榜隐私授权'); return; }
      try {
        wx.requirePrivacyAuthorize({
          success() { privacyReady = true; continueAuthorization(); },
          fail(error) {
            privacyReady = false;
            if (typeof done === 'function') done({ success: false, privacyDenied: true, error: (error && error.errMsg) || '尚未同意隐私保护指引' });
          }
        });
      } catch (error) { rankingResult(done, false, error.message || '隐私授权失败'); }
    }

    function finishFriendAuthorization(done, allowed) {
      friendReady = allowed;
      if (allowed) flushScore();
      rankingResult(done, allowed, allowed ? null : '好友权限尚未开启', !allowed);
    }

    // 启动时只读检查；未同时获得两项同意时，成绩留在本机，不主动弹窗。
    if (rankingAvailable && typeof wx.getPrivacySetting === 'function' && typeof wx.getSetting === 'function') {
      const revision = authorizationRevision;
      try {
        wx.getPrivacySetting({
          success(result) {
            if (revision !== authorizationRevision || result.needAuthorization !== false) return;
            try {
              wx.getSetting({
                success(setting) {
                  if (revision !== authorizationRevision) return;
                  privacyReady = true; friendReady = (setting.authSetting || {})[friendScope] === true;
                  if (friendReady) flushScore();
                },
                fail() {}
              });
            } catch (error) {}
          },
          fail() {}
        });
      } catch (error) {}
    }

    const ranking = {
      available: rankingAvailable,
      onPrivacyRequest(handler) {
        privacyHandler = typeof handler === 'function' ? handler : null;
        if (privacyRequest) presentPrivacy(privacyRequest);
      },
      submit(score, done) {
        if (!rankingAvailable) { rankingResult(done, false, '当前环境不支持微信排行榜'); return; }
        keepScore(score);
        const local = !privacyReady || !friendReady;
        const queued = local || flushScore();
        // 消息成功只代表交给开放域；云成绩读取、择优及写入仍由开放域完成。
        if (typeof done === 'function') done({ success: queued, queued, local, score: { ...latestScore }, ...(!queued ? { error: '排行榜消息提交失败' } : {}) });
      },
      authorize(done) {
        if (!rankingAvailable || typeof wx.getSetting !== 'function' || typeof wx.authorize !== 'function') {
          rankingResult(done, false, '当前环境不支持好友授权'); return;
        }
        requireRankingPrivacy(() => {
          try {
            wx.getSetting({
              success(result) {
                const allowed = (result.authSetting || {})[friendScope];
                if (allowed !== undefined) { finishFriendAuthorization(done, allowed === true); return; }
                try {
                  wx.authorize({ scope: friendScope, success: () => finishFriendAuthorization(done, true), fail: () => finishFriendAuthorization(done, false) });
                } catch (error) { rankingResult(done, false, error.message || '好友授权失败'); }
              },
              fail: error => rankingResult(done, false, (error && error.errMsg) || '读取授权状态失败')
            });
          } catch (error) { rankingResult(done, false, error.message || '读取授权状态失败'); }
        }, done);
      },
      openSettings(done) {
        if (!rankingAvailable || typeof wx.openSetting !== 'function') { rankingResult(done, false, '当前环境不支持微信设置'); return; }
        requireRankingPrivacy(() => {
          try {
            wx.openSetting({
              success: result => finishFriendAuthorization(done, (result.authSetting || {})[friendScope] === true),
              fail: error => rankingResult(done, false, (error && error.errMsg) || '打开微信设置失败')
            });
          } catch (error) { rankingResult(done, false, error.message || '打开微信设置失败'); }
        }, done);
      },
      show(options) {
        options = options || {};
        if (options.ownScore) keepScore(options.ownScore);
        return privacyReady && friendReady && postRanking({ type: 'rank:show', width: options.width, height: options.height, pixelRatio, requestId: options.requestId, ownScore: normalizeScore(latestScore) });
      },
      draw(target, x, y, targetWidth, targetHeight) {
        if (!rankingAvailable || !privacyReady || !friendReady || openData.canvas.width === 0 || openData.canvas.height === 0) return false;
        try { target.drawImage(openData.canvas, x, y, targetWidth, targetHeight); return true; } catch (error) { return false; }
      },
      scroll(delta) { return privacyReady && friendReady && Number.isFinite(delta) && postRanking({ type: 'rank:scroll', delta }); },
      hide() { return postRanking({ type: 'rank:hide' }); }
    };

    const createCanvas = (width, height) => {
      const surface = isWechat ? wx.createCanvas() : document.createElement('canvas');
      surface.width = width; surface.height = height; return surface;
    };
    return { canvas, ctx, width, height, pixelRatio, safeTop, safeBottom, onPointer, storage, vibrate, now, requestFrame, onHide, onShow, loadImage, ranking, createCanvas };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createPlatform };
  else window.MeowPlatform = { createPlatform };
}());

},
"logic":function(module,exports,require){
'use strict';

// 独立实现：每行、每列、每个区域各一只猫，任意两只猫不得八邻接。
function layoutValid(level) {
  if (!level || !Number.isInteger(level.size) || level.size < 3 || level.size > 12) return false;
  const n = level.size;
  return Array.isArray(level.regions) && level.regions.length === n * n &&
    level.regions.every(x => Number.isInteger(x) && x >= 0 && x < n);
}

function indicesValid(level, cells) {
  return Array.isArray(cells) && cells.every(x => Number.isInteger(x) && x >= 0 && x < level.size * level.size);
}

function pairRule(level, a, b) {
  const n = level.size, ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
  if (ar === br) return 'row';
  if (ac === bc) return 'column';
  if (level.regions[a] === level.regions[b]) return 'region';
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1 ? 'adjacent' : '';
}

function conflicts(level, cats) {
  if (!layoutValid(level) || !indicesValid(level, cats)) return [];
  const bad = new Set();
  for (let a = 0; a < cats.length; a++) {
    for (let b = a + 1; b < cats.length; b++) {
      if (pairRule(level, cats[a], cats[b])) { bad.add(cats[a]); bad.add(cats[b]); }
    }
  }
  return Array.from(bad).sort((a, b) => a - b);
}

function isComplete(level, cats) {
  return layoutValid(level) && indicesValid(level, cats) && cats.length === level.size &&
    new Set(cats).size === cats.length && conflicts(level, cats).length === 0;
}

function validateLevel(level) {
  if (!layoutValid(level) || !Array.isArray(level.solution) || level.solution.length !== level.size) return false;
  const n = level.size;
  if (!level.solution.every(c => Number.isInteger(c) && c >= 0 && c < n)) return false;
  const solutionCells = level.solution.map((c, r) => r * n + c);
  if (!isComplete(level, solutionCells)) return false;
  const given = level.given || [];
  if (!indicesValid(level, given) || new Set(given).size !== given.length || given.some(c => !solutionCells.includes(c))) return false;
  for (let region = 0; region < n; region++) {
    const first = level.regions.indexOf(region);
    if (first < 0) return false;
    const seen = new Set([first]), queue = [first];
    for (let p = 0; p < queue.length; p++) {
      const cell = queue[p], r = Math.floor(cell / n), c = cell % n;
      const near = [r > 0 ? cell - n : -1, r < n - 1 ? cell + n : -1, c > 0 ? cell - 1 : -1, c < n - 1 ? cell + 1 : -1];
      near.forEach(next => {
        if (next >= 0 && level.regions[next] === region && !seen.has(next)) { seen.add(next); queue.push(next); }
      });
    }
    if (seen.size !== level.regions.filter(x => x === region).length) return false;
  }
  return true;
}

function excludedByCat(level, index) {
  if (!layoutValid(level) || !indicesValid(level, [index])) return [];
  const out = [];
  for (let cell = 0; cell < level.size * level.size; cell++) {
    if (cell !== index && pairRule(level, cell, index)) out.push(cell);
  }
  return out;
}

// 求解只读取区域和约束，不借用交付数据中的 solution 字段。
function solve(level, options) {
  options = options || {};
  if (!layoutValid(level)) return [];
  const n = level.size, input = options.cats || [], given = level.given || [], marks = options.marks || [];
  if (!indicesValid(level, input) || !indicesValid(level, given) || !indicesValid(level, marks)) return [];
  if (new Set(input).size !== input.length) return [];
  const cats = Array.from(new Set(given.concat(input)));
  if (conflicts(level, cats).length || cats.some(c => marks.includes(c))) return [];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 2;
  const blocked = new Set(marks), chosen = Array(n).fill(-1), solutions = [];
  let columns = 0, regions = 0;
  for (const cell of cats) {
    const r = Math.floor(cell / n), c = cell % n, region = level.regions[cell];
    chosen[r] = c; columns |= 1 << c; regions |= 1 << region;
  }
  function candidates(row, cols, regs) {
    const result = [];
    for (let c = 0; c < n; c++) {
      const cell = row * n + c, region = level.regions[cell];
      if ((cols & (1 << c)) || (regs & (1 << region)) || blocked.has(cell)) continue;
      if (row > 0 && chosen[row - 1] >= 0 && Math.abs(c - chosen[row - 1]) <= 1) continue;
      if (row < n - 1 && chosen[row + 1] >= 0 && Math.abs(c - chosen[row + 1]) <= 1) continue;
      result.push(c);
    }
    return result;
  }
  function visit(cols, regs, remaining) {
    if (!remaining) { solutions.push(chosen.slice()); return; }
    let row = -1, values;
    for (let r = 0; r < n; r++) {
      if (chosen[r] >= 0) continue;
      const current = candidates(r, cols, regs);
      if (!current.length) return;
      if (row < 0 || current.length < values.length) { row = r; values = current; }
    }
    for (const c of values) {
      chosen[row] = c;
      visit(cols | (1 << c), regs | (1 << level.regions[row * n + c]), remaining - 1);
      chosen[row] = -1;
      if (solutions.length >= limit) return;
    }
  }
  visit(columns, regions, n - cats.length);
  return solutions;
}

const noHint = reason => ({ kind: 'none', cell: -1, reason, rule: 'none' });
const advice = (kind, cell, reason, rule) => ({ kind, cell, reason, rule });

function hintState(level, inputCats, inputMarks) {
  if (!layoutValid(level) || !indicesValid(level, inputCats || []) || !indicesValid(level, inputMarks || []) || !indicesValid(level, level.given || [])) return null;
  return { cats: Array.from(new Set((level.given || []).concat(inputCats || []))), marks: Array.from(new Set(inputMarks || [])) };
}

function candidatesFor(level, cats, marks) {
  const blocked = new Set(cats.concat(marks)), result = [];
  for (let cell = 0; cell < level.size * level.size; cell++) {
    if (!blocked.has(cell) && !cats.some(cat => pairRule(level, cat, cell))) result.push(cell);
  }
  return result;
}

function unitsFor(level, cats, candidates) {
  const out = [], n = level.size;
  for (const axis of ['row', 'column', 'region']) {
    const coord = cell => axis === 'row' ? Math.floor(cell / n) : axis === 'column' ? cell % n : level.regions[cell];
    for (let index = 0; index < n; index++) {
      if (!cats.some(cell => coord(cell) === index)) out.push({ axis, index, cells: candidates.filter(cell => coord(cell) === index) });
    }
  }
  return out;
}

// 有限反证只连锁使用单候选，最多推进六只猫；完整求解器另行核实结论。
function singleChainFails(level, initialCats, marks) {
  const cats = initialCats.slice();
  for (let step = 0; step <= 6; step++) {
    if (conflicts(level, cats).length || cats.some(cell => marks.includes(cell))) return true;
    const units = unitsFor(level, cats, candidatesFor(level, cats, marks));
    if (units.some(unit => !unit.cells.length)) return true;
    if (step === 6) return false;
    const single = units.find(unit => unit.cells.length === 1);
    if (!single) return false;
    cats.push(single.cells[0]);
  }
  return false;
}

function getHint(level, inputCats, inputMarks) {
  const state = hintState(level, inputCats, inputMarks);
  if (!state) return noHint('棋盘数据无效。');
  const { cats, marks } = state, n = level.size;
  const available = solve(level, { cats, limit: 2 });
  if (!available.length) {
    const base = solve(level, { limit: 2 });
    let cell;
    if (base.length === 1) cell = cats.find(c => !(level.given || []).includes(c) && base[0][Math.floor(c / n)] !== c % n);
    if (cell === undefined) cell = cats.find(c => !(level.given || []).includes(c) && solve(level, { cats: cats.filter(x => x !== c), limit: 1 }).length);
    if (cell !== undefined) return advice('repair', cell, '当前猫的位置无法一起满足规则，请先移除这一只再分析。', 'conflict');
    return noHint('当前关卡或预置猫没有可行解。');
  }
  if (isComplete(level, cats)) {
    const overlap = marks.find(cell => cats.includes(cell));
    return overlap === undefined ? noHint('已满足全部规则。') : advice('repair', overlap, '猫所在的位置不能同时打叉，请取消这个叉。', 'marked-cat');
  }
  // 第一层只标同行、同列和八邻接；远处同区域格留给后续推理。
  for (const cat of cats) {
    const row = Math.floor(cat / n), column = cat % n;
    for (let cell = 0; cell < n * n; cell++) {
      if (cats.includes(cell) || marks.includes(cell)) continue;
      const r = Math.floor(cell / n), c = cell % n;
      const rule = r === row ? 'row' : c === column ? 'column' : Math.abs(r - row) <= 1 && Math.abs(c - column) <= 1 ? 'adjacent' : '';
      if (!rule || solve(level, { cats: cats.concat(cell), limit: 1 }).length) continue;
      const reason = { row: '同一行已有猫', column: '同一列已有猫', adjacent: '这一格与猫相邻' }[rule];
      return advice('mark', cell, `${reason}，这一格可以打叉。`, rule);
    }
  }
  const overlap = marks.find(cell => cats.includes(cell));
  if (overlap !== undefined) return advice('repair', overlap, '猫所在的位置不能同时打叉，请取消这个叉。', 'marked-cat');
  if (!solve(level, { cats, marks, limit: 1 }).length) {
    const wrong = marks.find(cell => !solve(level, { cats, marks: [cell], limit: 1 }).length);
    if (wrong !== undefined) return advice('repair', wrong, '排除此格会让整盘无解，请取消这个叉，再按规则推理。', 'contradiction-mark');
    const repair = marks.find(cell => solve(level, { cats, marks: marks.filter(c => c !== cell), limit: 1 }).length);
    if (repair !== undefined) return advice('repair', repair, '这些叉同时排除了所有解，取消这个叉可恢复可行布局。', 'marks-inconsistent');
    return noHint('多个标记互相矛盾，请逐步取消标记再分析。');
  }
  // 所有后续落猫/排除返回前都检查相反假设无解，防止错误推理泄露到界面。
  function proven(kind, cell, reason, rule) {
    const opposite = kind === 'mark' ? { cats: cats.concat(cell), marks, limit: 1 } : { cats, marks: marks.concat(cell), limit: 1 };
    return solve(level, opposite).length ? null : advice(kind, cell, reason, rule);
  }
  const candidates = candidatesFor(level, cats, marks), units = unitsFor(level, cats, candidates);
  for (const unit of units) {
    if (unit.cells.length !== 1) continue;
    const name = { row: '行', column: '列', region: '个颜色区域' }[unit.axis];
    const result = proven('place', unit.cells[0], `第 ${unit.index + 1} ${name}只剩这一格可放猫。`, `${unit.axis}-single`);
    if (result) return result;
  }
  // 区域锁定到一条轴，以及一条轴锁定到一个区域，都能排除交集外的候选。
  for (const region of units.filter(unit => unit.axis === 'region')) {
    for (const axis of ['row', 'column']) {
      const coord = cell => axis === 'row' ? Math.floor(cell / n) : cell % n;
      if (!region.cells.length || !region.cells.every(cell => coord(cell) === coord(region.cells[0]))) continue;
      const cell = candidates.find(c => level.regions[c] !== region.index && coord(c) === coord(region.cells[0]));
      if (cell !== undefined) {
        const result = proven('mark', cell, `一个颜色区域的猫必须在这一${axis === 'row' ? '行' : '列'}，其他区域不能占用。`, `region-${axis}`);
        if (result) return result;
      }
    }
  }
  for (const unit of units.filter(unit => unit.axis !== 'region')) {
    if (!unit.cells.length || !unit.cells.every(c => level.regions[c] === level.regions[unit.cells[0]])) continue;
    const coord = cell => unit.axis === 'row' ? Math.floor(cell / n) : cell % n;
    const cell = candidates.find(c => level.regions[c] === level.regions[unit.cells[0]] && coord(c) !== unit.index);
    if (cell !== undefined) {
      const result = proven('mark', cell, `这一${unit.axis === 'row' ? '行' : '列'}的猫必须在同一颜色区域，所以该区域在这条线外的格子可排除。`, `${unit.axis}-region`);
      if (result) return result;
    }
  }
  const regions = units.filter(unit => unit.axis === 'region');
  for (let count = 2; count <= Math.min(6, regions.length - 1); count++) {
    function subset(start, selected) {
      if (selected.length < count) {
        for (let index = start; index <= regions.length - count + selected.length; index++) {
          const found = subset(index + 1, selected.concat(regions[index]));
          if (found) return found;
        }
        return null;
      }
      const ids = new Set(selected.map(unit => unit.index));
      for (const axis of ['row', 'column']) {
        const coord = cell => axis === 'row' ? Math.floor(cell / n) : cell % n;
        const lines = new Set(); selected.forEach(unit => unit.cells.forEach(cell => lines.add(coord(cell))));
        if (lines.size !== count) continue;
        const cell = candidates.find(c => !ids.has(level.regions[c]) && lines.has(coord(c)));
        if (cell !== undefined) {
          const result = proven('mark', cell, `${count} 个区域的猫只能占用 ${count} ${axis === 'row' ? '行' : '列'}，这些线上的其他区域不能放猫。`, `region-subset-${axis}-${count}`);
          if (result) return result;
        }
      }
      return null;
    }
    const result = subset(0, []);
    if (result) return result;
  }
  for (const cell of candidates) {
    if (singleChainFails(level, cats.concat(cell), marks)) {
      const result = proven('mark', cell, '假设这里放猫，连续检查唯一候选后会出现无处放猫的行、列或区域，因此可以排除。', 'single-chain');
      if (result) return result;
    }
  }
  for (const cell of candidates) {
    if (singleChainFails(level, cats, marks.concat(cell))) {
      const result = proven('place', cell, '假设排除此格，连续检查唯一候选后会产生矛盾，因此这里必须有猫。', 'single-chain');
      if (result) return result;
    }
  }
  for (const cell of candidates) {
    const result = proven('mark', cell, '假设此格放猫会使剩余棋盘无解，因此可以排除。', 'contradiction');
    if (result) return result;
  }
  for (const cell of candidates) {
    const result = proven('place', cell, '排除此格会使剩余棋盘无解，因此猫必须放在这里。', 'contradiction');
    if (result) return result;
  }
  return noHint('暂未找到必然成立的提示，可以继续分析。');
}

function locateCat(level, inputCats, inputMarks) {
  const state = hintState(level, inputCats, inputMarks);
  if (!state) return noHint('棋盘数据无效。');
  const { cats, marks } = state, answers = solve(level, { cats, limit: 2 });
  if (answers.length !== 1) return noHint('当前布局没有唯一可验证的答案，先检查棋盘。');
  const choices = answers[0].map((c, r) => r * level.size + c).filter(cell => !cats.includes(cell));
  const unmarked = region => level.regions.reduce((count, value, cell) => count + (value === region && !marks.includes(cell) ? 1 : 0), 0);
  choices.sort((a, b) => unmarked(level.regions[a]) - unmarked(level.regions[b]) || a - b);
  if (!choices.length) return noHint('已找到全部猫。');
  const cell = choices[0];
  // 定位忽略可能出错的叉，仍用相反假设求解核查猫的位置。
  if (solve(level, { cats, marks: [cell], limit: 1 }).length) return noHint('暂不能确认这个猫的位置。');
  return advice('place', cell, '先帮助剩余空格最少的颜色区域，这里是可验证的猫的位置。', 'locate');
}

module.exports = { validateLevel, solve, conflicts, isComplete, excludedByCat, getHint, locateCat };

},
"levels":function(module,exports,require){
'use strict';
// 固定种子生成的 60 个原创关卡；运行时不执行生成过程。
module.exports = [{"id":1,"size":5,"regions":[0,1,1,1,3,0,0,1,1,3,0,2,1,1,3,0,2,2,1,3,0,2,4,3,3],"solution":[0,3,1,4,2],"difficulty":"easy","given":[19,22]},{"id":2,"size":5,"regions":[2,2,2,0,0,1,2,2,0,0,4,4,2,2,3,4,4,4,3,3,4,4,3,3,3],"solution":[3,0,2,4,1],"difficulty":"easy","given":[3,5]},{"id":3,"size":5,"regions":[1,4,4,2,0,1,1,4,2,0,1,1,4,2,2,3,1,4,2,2,4,4,4,4,4],"solution":[4,1,3,0,2],"difficulty":"easy","given":[15,4]},{"id":4,"size":5,"regions":[3,0,0,0,0,3,1,1,0,2,3,3,0,0,2,3,3,2,2,2,3,3,4,2,2],"solution":[3,1,4,0,2],"difficulty":"easy","given":[6]},{"id":5,"size":5,"regions":[0,1,1,1,1,2,2,1,1,1,2,2,4,4,3,2,4,4,3,3,4,4,4,4,3],"solution":[0,3,1,4,2],"difficulty":"easy","given":[19]},{"id":6,"size":5,"regions":[0,0,1,1,1,0,0,0,0,1,3,3,2,0,0,3,2,2,0,0,3,3,2,4,0],"solution":[1,4,2,0,3],"difficulty":"easy","given":[9]},{"id":7,"size":5,"regions":[0,0,0,0,0,0,2,1,1,1,3,2,2,2,1,3,3,2,2,1,3,2,2,4,1],"solution":[1,4,2,0,3],"difficulty":"easy","given":[12]},{"id":8,"size":5,"regions":[0,1,1,1,2,1,1,1,1,2,1,1,1,4,2,3,3,4,4,4,3,3,4,4,4],"solution":[0,2,4,1,3],"difficulty":"easy","given":[14]},{"id":9,"size":5,"regions":[0,0,0,1,1,0,0,1,1,1,2,1,1,1,1,3,3,3,3,3,3,3,4,3,3],"solution":[1,3,0,4,2],"difficulty":"easy"},{"id":10,"size":5,"regions":[1,0,0,0,0,1,1,0,0,0,1,3,0,2,4,3,3,3,4,4,3,3,3,4,4],"solution":[2,0,3,1,4],"difficulty":"easy"},{"id":11,"size":5,"regions":[3,0,2,1,1,3,2,2,2,1,3,2,2,2,2,3,3,2,2,2,3,3,4,4,4],"solution":[1,4,2,0,3],"difficulty":"normal"},{"id":12,"size":5,"regions":[0,0,0,0,0,1,0,0,0,0,1,0,2,2,2,1,3,4,4,2,4,4,4,4,2],"solution":[2,0,4,1,3],"difficulty":"easy"},{"id":13,"size":6,"regions":[0,0,0,0,0,2,4,0,1,2,2,2,4,0,0,3,3,2,4,4,3,3,3,2,4,4,5,3,5,5,4,4,5,5,5,5],"solution":[0,2,5,3,1,4],"difficulty":"normal"},{"id":14,"size":6,"regions":[1,1,1,1,0,3,1,1,1,1,1,3,2,1,1,1,1,3,4,1,4,3,3,3,4,4,4,3,3,3,4,4,5,5,3,3],"solution":[4,2,0,5,1,3],"difficulty":"easy"},{"id":15,"size":6,"regions":[0,0,2,1,1,1,0,0,2,1,1,1,3,2,2,1,1,1,3,2,2,1,5,1,2,2,2,4,5,1,2,2,2,5,5,5],"solution":[1,4,2,0,3,5],"difficulty":"normal"},{"id":16,"size":6,"regions":[1,1,1,0,2,2,1,1,2,0,2,2,1,1,2,2,2,3,2,2,2,3,3,3,4,4,2,3,3,3,4,4,4,3,3,5],"solution":[3,0,2,4,1,5],"difficulty":"normal"},{"id":17,"size":6,"regions":[0,0,0,0,0,0,1,3,0,0,2,2,1,3,2,2,2,2,1,3,3,2,2,2,1,1,3,4,4,2,1,4,4,4,5,5],"solution":[2,0,4,1,3,5],"difficulty":"hard"},{"id":18,"size":6,"regions":[0,0,0,0,0,0,2,1,2,0,0,3,2,2,2,2,3,3,5,5,2,2,2,3,5,4,4,5,3,3,5,5,5,5,5,5],"solution":[4,1,3,5,2,0],"difficulty":"normal"},{"id":19,"size":6,"regions":[0,2,2,3,1,1,2,2,2,3,1,1,4,2,2,3,3,1,4,4,4,3,3,1,4,4,5,5,3,3,4,4,5,5,3,3],"solution":[0,5,2,4,1,3],"difficulty":"hard"},{"id":20,"size":6,"regions":[0,0,0,1,1,1,2,0,1,1,1,1,2,2,3,1,3,1,2,2,3,3,3,3,2,2,3,3,3,4,5,2,3,3,3,4],"solution":[2,4,1,3,5,0],"difficulty":"normal"},{"id":21,"size":6,"regions":[2,2,2,0,0,0,2,2,2,1,0,0,2,2,2,1,0,0,2,2,2,1,3,0,4,4,4,1,3,3,4,5,5,3,3,3],"solution":[5,3,1,4,0,2],"difficulty":"normal"},{"id":22,"size":6,"regions":[0,1,1,2,2,2,1,1,1,2,2,2,3,3,2,2,2,2,3,3,3,3,2,2,3,3,5,4,4,4,5,5,5,5,4,4],"solution":[0,2,4,1,5,3],"difficulty":"normal"},{"id":23,"size":6,"regions":[2,2,0,0,0,0,2,2,0,1,3,0,4,2,2,3,3,3,4,3,3,3,3,3,4,4,4,5,3,3,4,5,5,5,3,3],"solution":[5,3,1,4,0,2],"difficulty":"easy"},{"id":24,"size":6,"regions":[2,2,0,2,1,1,2,2,2,2,1,1,2,2,2,2,2,2,3,5,4,4,4,4,5,5,4,4,4,4,5,5,5,5,5,4],"solution":[2,5,3,0,4,1],"difficulty":"normal"},{"id":25,"size":7,"regions":[3,0,0,0,0,0,0,3,3,1,0,0,0,2,3,3,3,0,0,0,2,5,3,3,6,2,2,2,5,3,3,6,4,6,6,5,6,3,6,6,6,6,5,6,6,6,6,6,6],"solution":[5,2,6,1,4,0,3],"difficulty":"easy"},{"id":26,"size":7,"regions":[2,2,0,0,1,1,1,2,2,0,0,1,1,1,2,2,2,3,1,1,3,2,2,2,3,3,1,3,4,4,2,3,3,3,3,4,4,2,3,3,5,3,4,6,2,3,3,3,3],"solution":[3,6,2,4,0,5,1],"difficulty":"normal"},{"id":27,"size":7,"regions":[1,0,1,1,1,2,2,1,1,1,1,2,2,2,1,1,1,1,3,2,2,1,1,4,1,3,2,2,4,4,4,4,4,2,2,5,4,4,6,6,2,2,5,5,6,6,6,6,6],"solution":[1,3,6,4,2,0,5],"difficulty":"hard"},{"id":28,"size":7,"regions":[2,2,2,0,0,0,0,2,2,2,2,1,0,0,2,2,2,2,2,3,3,4,4,2,2,3,3,3,4,4,4,5,5,3,3,4,4,5,5,3,3,3,6,5,5,5,5,3,3],"solution":[6,4,2,5,1,3,0],"difficulty":"normal"},{"id":29,"size":7,"regions":[1,1,1,1,2,2,0,1,1,1,2,2,2,0,1,1,1,1,3,2,2,1,1,3,3,3,2,2,1,3,3,3,4,2,2,5,3,4,4,4,2,2,4,4,4,6,4,4,2],"solution":[6,1,5,2,4,0,3],"difficulty":"normal"},{"id":30,"size":7,"regions":[1,1,1,2,0,0,0,1,1,2,2,2,0,0,4,4,2,4,4,4,3,4,4,4,4,4,4,3,4,4,4,4,4,3,3,4,4,4,4,4,5,5,4,6,4,4,4,4,4],"solution":[4,0,2,6,3,5,1],"difficulty":"normal"},{"id":31,"size":7,"regions":[1,1,0,0,0,0,2,1,1,1,0,0,2,2,1,1,1,2,2,2,2,1,2,2,2,4,4,3,1,1,2,5,4,4,3,5,5,5,5,5,6,6,5,5,5,5,5,6,6],"solution":[2,0,3,6,4,1,5],"difficulty":"normal"},{"id":32,"size":7,"regions":[3,3,0,1,1,1,1,3,3,0,4,4,4,1,3,3,3,2,4,4,4,3,3,3,6,6,4,4,5,6,6,6,4,4,4,5,6,6,6,6,4,4,5,5,6,6,6,4,4],"solution":[2,6,3,1,5,0,4],"difficulty":"normal"},{"id":33,"size":7,"regions":[1,1,0,2,2,2,2,1,1,0,2,2,2,6,2,2,2,2,2,2,6,2,4,2,5,2,3,6,4,4,2,5,5,6,6,4,4,4,5,5,5,6,5,5,5,5,6,6,6],"solution":[2,0,3,5,1,4,6],"difficulty":"normal"},{"id":34,"size":7,"regions":[2,2,1,1,1,1,0,2,2,1,1,1,1,1,2,2,2,1,3,3,5,2,2,1,1,3,3,5,2,2,4,1,3,5,5,2,2,2,3,3,5,5,6,2,2,2,3,5,5],"solution":[6,3,1,4,2,5,0],"difficulty":"easy"},{"id":35,"size":7,"regions":[1,1,1,2,2,2,0,1,1,1,2,2,2,2,1,1,2,2,2,2,2,1,3,2,5,2,2,4,3,3,5,5,4,4,4,3,3,5,5,4,4,4,3,3,5,4,4,6,4],"solution":[6,0,3,1,4,2,5],"difficulty":"easy"},{"id":36,"size":7,"regions":[1,1,1,1,0,2,4,1,1,1,1,2,2,4,1,1,3,3,2,2,4,1,1,1,3,3,2,4,1,1,3,3,3,4,4,6,1,5,3,3,4,3,6,6,6,6,3,3,3],"solution":[4,1,5,3,6,2,0],"difficulty":"normal"},{"id":37,"size":8,"regions":[0,0,0,3,3,3,3,3,0,0,0,3,3,3,1,3,0,0,2,3,3,3,3,3,0,0,3,3,3,3,4,4,0,3,3,3,3,5,5,4,6,3,6,6,6,5,5,4,6,6,6,6,6,4,4,4,7,6,6,6,4,4,4,4],"solution":[1,6,2,4,7,5,3,0],"difficulty":"normal"},{"id":38,"size":8,"regions":[0,0,1,3,3,3,3,3,1,1,1,1,3,3,3,3,1,1,1,3,3,2,3,3,1,1,1,3,3,3,3,3,1,1,5,3,3,3,3,4,1,1,5,5,5,5,3,6,5,5,5,5,5,5,6,6,5,7,5,5,5,6,6,6],"solution":[0,2,5,3,7,4,6,1],"difficulty":"easy"},{"id":39,"size":8,"regions":[1,1,1,1,0,0,0,0,1,1,0,0,0,0,2,2,1,1,0,0,0,0,2,2,1,3,3,4,4,4,2,2,1,4,4,4,4,2,2,2,7,7,7,7,6,2,2,5,7,7,7,7,6,2,2,2,7,7,7,7,7,7,2,2],"solution":[5,0,6,1,3,7,4,2],"difficulty":"hard"},{"id":40,"size":8,"regions":[1,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,1,2,0,3,0,0,0,1,5,3,3,3,6,0,0,5,5,3,3,3,6,4,4,5,5,3,3,6,6,6,6,5,5,5,5,5,6,6,6,5,5,6,6,6,6,6,7],"solution":[3,0,2,4,6,1,5,7],"difficulty":"normal"},{"id":41,"size":8,"regions":[1,1,1,1,1,0,3,3,1,4,1,1,1,3,3,3,1,4,2,1,3,3,3,3,4,4,4,1,4,5,5,3,4,4,4,4,4,5,5,3,4,4,4,4,5,5,6,3,4,4,4,5,5,6,6,6,4,4,4,7,7,6,6,6],"solution":[5,0,2,7,1,4,6,3],"difficulty":"normal"},{"id":42,"size":8,"regions":[3,3,3,3,3,0,0,0,3,3,3,3,3,1,0,0,2,3,3,3,3,3,4,0,3,3,3,3,4,4,4,4,3,5,3,3,4,4,4,4,5,5,5,5,5,4,4,4,7,7,5,5,6,4,4,4,7,7,5,5,5,4,4,4],"solution":[7,5,0,3,6,2,4,1],"difficulty":"easy"},{"id":43,"size":8,"regions":[1,0,0,0,0,0,0,0,1,1,0,3,0,0,3,3,1,1,1,3,2,3,3,3,1,1,4,3,3,3,3,3,4,4,4,4,3,3,3,3,4,4,5,3,3,3,3,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7],"solution":[3,1,4,6,0,2,5,7],"difficulty":"easy"},{"id":44,"size":8,"regions":[0,0,0,1,1,1,2,2,0,0,1,1,1,1,2,2,3,0,0,1,2,2,2,2,3,3,3,3,5,2,2,5,3,3,3,4,5,2,5,5,3,3,5,5,5,5,5,5,3,3,5,5,5,5,5,6,3,3,3,5,7,5,5,5],"solution":[0,2,6,1,3,5,7,4],"difficulty":"easy"},{"id":45,"size":8,"regions":[0,0,0,0,0,2,2,2,0,0,4,1,0,0,2,2,0,0,4,4,7,2,2,2,3,4,4,4,7,6,2,6,4,4,4,4,7,6,6,6,4,4,4,7,7,5,6,6,7,7,7,7,7,7,6,6,7,7,7,7,7,7,7,6],"solution":[1,3,6,0,2,5,7,4],"difficulty":"easy"},{"id":46,"size":8,"regions":[0,4,2,2,3,3,3,3,4,4,2,2,3,3,1,3,4,4,4,2,2,3,3,3,4,4,4,4,3,3,3,3,6,6,4,4,5,5,3,3,6,6,6,5,5,5,3,3,6,6,6,6,5,5,5,3,6,6,6,5,5,5,5,7],"solution":[0,6,3,5,2,4,1,7],"difficulty":"normal"},{"id":47,"size":8,"regions":[2,2,2,0,2,2,2,2,2,2,2,2,2,5,1,2,2,2,2,2,2,5,1,5,3,6,2,2,2,5,5,5,3,6,2,7,5,5,5,4,6,6,2,7,7,5,5,5,6,6,7,7,7,7,7,5,6,6,6,6,7,7,7,5],"solution":[3,6,2,0,7,5,1,4],"difficulty":"hard"},{"id":48,"size":8,"regions":[4,4,0,2,2,2,2,1,4,4,2,2,2,2,2,1,4,4,4,4,2,2,2,2,4,4,4,3,2,5,5,2,6,4,5,5,2,5,5,5,6,4,4,5,5,5,5,7,6,6,6,6,5,5,5,7,6,6,6,5,5,5,7,7],"solution":[2,7,5,3,1,4,0,6],"difficulty":"normal"},{"id":49,"size":9,"regions":[1,1,1,3,2,2,2,0,4,1,3,3,3,2,2,2,4,4,3,3,3,3,2,2,3,4,4,3,3,3,3,3,3,3,4,4,3,3,3,3,3,6,6,6,4,3,3,3,5,3,6,6,6,4,3,3,3,3,6,6,6,6,6,3,7,3,6,6,6,6,6,6,3,7,3,6,8,6,6,6,6],"solution":[7,0,5,2,8,3,6,1,4],"difficulty":"easy"},{"id":50,"size":9,"regions":[4,0,1,1,1,1,1,1,2,4,1,1,1,1,1,2,2,2,4,4,1,3,3,2,2,2,2,4,4,4,3,3,3,2,2,2,4,4,4,4,4,6,2,2,2,5,4,6,4,6,6,2,6,7,6,6,6,6,6,6,6,6,7,6,6,6,6,6,6,6,6,7,6,6,6,6,6,8,7,7,7],"solution":[1,3,7,4,2,0,6,8,5],"difficulty":"hard"},{"id":51,"size":9,"regions":[1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,6,2,1,1,1,3,6,6,6,6,2,1,1,6,6,6,6,6,5,5,5,4,6,6,6,6,5,5,5,5,5,6,6,6,6,5,5,5,5,7,6,6,6,5,5,7,7,7,7,6,6,6,7,7,7,8,8,8],"solution":[3,0,6,1,8,4,2,5,7],"difficulty":"easy"},{"id":52,"size":9,"regions":[0,0,0,0,3,3,3,3,3,0,0,0,0,0,3,3,3,1,0,2,3,3,3,3,3,3,5,0,0,0,3,3,3,3,3,5,0,7,7,4,3,3,5,3,5,0,7,7,7,3,3,5,5,5,7,7,6,7,7,3,3,3,3,7,7,7,7,7,7,7,7,8,7,7,7,7,7,7,7,8,8],"solution":[0,8,1,5,3,6,2,4,7],"difficulty":"easy"},{"id":53,"size":9,"regions":[0,0,0,0,0,0,0,0,0,1,3,0,0,0,2,0,0,2,1,3,0,3,2,2,0,0,2,3,3,3,3,4,2,2,0,2,7,3,3,4,4,2,2,2,2,7,3,3,4,4,4,4,4,5,7,7,7,6,4,4,4,4,5,7,7,7,7,4,4,4,4,4,7,7,7,7,4,4,4,8,4],"solution":[6,0,5,2,4,8,3,1,7],"difficulty":"normal"},{"id":54,"size":9,"regions":[5,5,0,0,0,0,0,0,2,5,5,5,1,2,0,0,2,2,5,5,5,5,2,2,2,2,2,5,5,5,2,2,2,2,2,3,5,5,4,5,2,2,2,2,3,5,5,5,5,5,7,7,7,7,5,5,8,7,7,7,6,7,7,8,5,8,7,7,7,7,7,7,8,8,8,7,7,7,7,7,7],"solution":[7,3,5,8,2,0,6,4,1],"difficulty":"normal"},{"id":55,"size":9,"regions":[2,2,2,0,0,0,0,0,0,2,2,3,0,0,0,0,1,0,2,2,3,0,0,0,0,0,0,2,2,3,3,3,3,5,5,0,2,2,2,3,3,4,5,5,5,2,2,2,3,3,5,5,5,5,6,2,5,5,5,5,8,5,8,2,2,7,5,5,8,8,8,8,2,2,5,5,5,8,8,8,8],"solution":[4,7,1,3,5,8,0,2,6],"difficulty":"easy"},{"id":56,"size":9,"regions":[0,0,0,0,1,1,1,2,2,0,1,1,1,1,1,4,2,2,7,7,1,1,1,1,4,4,2,7,4,4,1,1,3,4,4,2,7,7,4,1,4,4,4,4,4,7,5,4,4,4,4,4,4,4,7,7,7,6,4,4,4,4,4,7,7,7,7,4,4,4,4,4,7,7,7,7,4,4,8,8,4],"solution":[2,4,8,5,7,1,3,0,6],"difficulty":"normal"},{"id":57,"size":9,"regions":[4,4,1,1,1,2,0,2,2,4,4,4,1,1,2,2,2,2,4,4,4,4,4,2,2,2,2,3,4,4,5,5,5,2,2,2,4,4,4,5,5,5,5,5,5,6,6,4,6,5,5,5,5,5,6,6,6,6,6,6,5,5,5,6,6,6,6,6,7,7,5,5,6,6,6,6,6,6,6,8,5],"solution":[6,3,8,0,2,4,1,5,7],"difficulty":"normal"},{"id":58,"size":9,"regions":[0,0,0,1,1,1,1,5,5,0,1,1,1,1,1,1,5,5,2,2,1,1,1,5,5,5,5,2,2,2,2,1,5,5,3,5,2,2,2,4,5,5,5,5,5,2,2,2,2,5,5,5,5,6,2,2,2,6,6,6,6,6,6,8,2,6,6,6,7,6,6,6,8,6,6,6,6,6,6,6,6],"solution":[2,4,1,7,3,6,8,5,0],"difficulty":"normal"},{"id":59,"size":9,"regions":[1,1,1,1,1,1,1,1,0,4,4,1,1,1,5,5,5,5,4,4,1,1,2,2,5,5,5,4,1,1,3,7,5,5,5,5,4,4,1,1,7,7,5,5,5,4,4,4,4,4,7,5,5,5,4,6,7,7,7,7,7,7,5,4,4,7,8,8,7,7,5,5,4,4,8,8,8,8,5,5,5],"solution":[8,2,5,3,0,7,1,6,4],"difficulty":"easy"},{"id":60,"size":9,"regions":[1,1,1,1,1,4,4,0,0,1,1,1,1,4,4,0,0,0,1,1,1,1,1,4,4,2,0,3,3,1,1,4,4,6,6,0,4,4,4,4,4,4,6,6,6,7,5,4,4,4,6,6,6,6,7,5,7,7,6,6,6,6,6,7,7,7,7,7,6,6,6,6,7,8,8,7,7,7,7,6,6],"solution":[8,3,7,0,5,1,6,4,2],"difficulty":"normal"}];

},
"cosmetics":function(module,exports,require){
'use strict';

// 保留已有外观标识，旧存档仍能选中原来的小屋和头像框。
const THEMES = [
  { id: 'cream', name: '奶油小屋', level: 1, paper: '#F7F2EF', ink: '#935A5A', accent: '#F49419', style: 'none' },
  { id: 'forest', name: '薄荷花园', level: 3, paper: '#F0F5EC', ink: '#59745D', accent: '#87B68E', style: 'leaf' },
  { id: 'sky', name: '云朵书房', level: 5, paper: '#EFF5FA', ink: '#557188', accent: '#8FBDDB', style: 'cloud' },
  { id: 'rose', name: '樱花茶室', level: 8, paper: '#FCF0F1', ink: '#915D72', accent: '#DDA0B1', style: 'flower' },
  { id: 'night', name: '星月露台', level: 12, paper: '#F0EDF7', ink: '#6D658A', accent: '#A49BCB', style: 'moon' },
  { id: 'royal', name: '金色庆典', level: 21, paper: '#FAF1DE', ink: '#896136', accent: '#DFAD51', style: 'sun' },
  { id: 'ocean', name: '海盐小院', level: 10, paper: '#EDF6F4', ink: '#4C7475', accent: '#83BDBB', style: 'wave' },
  { id: 'tea', name: '雨声茶舍', level: 14, paper: '#F1F2EC', ink: '#607363', accent: '#98ADA1', style: 'rain' },
  { id: 'candy', name: '糖果工坊', level: 18, paper: '#FBF0F6', ink: '#88627D', accent: '#C9A1C6', style: 'candy' },
  { id: 'wood', name: '暖木森林', level: 23, paper: '#F6EFE5', ink: '#7F6249', accent: '#B99877', style: 'wood' },
  { id: 'snow', name: '初雪暖阁', level: 26, paper: '#F0F5F7', ink: '#5B7082', accent: '#A7C4D2', style: 'snow' },
  { id: 'lotus', name: '荷风水庭', level: 30, paper: '#F3F4E9', ink: '#62734F', accent: '#A3B982', style: 'lotus' }
].sort((a, b) => a.level - b.level);
const FRAMES = [
  { id: 'basic', name: '奶油圆角', level: 1, color: '#FDF9F0', detail: '#CDBCA6', style: 'basic' },
  { id: 'mint', name: '薄荷叶环', level: 3, color: '#93C5AB', detail: '#5F9677', style: 'leaf' },
  { id: 'gold', name: '暖阳日冕', level: 8, color: '#EDC46B', detail: '#CF963B', style: 'sun' },
  { id: 'cosmic', name: '星月之约', level: 21, color: '#B8ADD8', detail: '#8279B0', style: 'moon' },
  { id: 'blossom', name: '樱花花环', level: 5, color: '#E9B0BC', detail: '#C68699', style: 'flower' },
  { id: 'ocean', name: '海浪贝壳', level: 12, color: '#98C8CB', detail: '#699DA4', style: 'wave' },
  { id: 'wood', name: '暖木相框', level: 16, color: '#C3A487', detail: '#937457', style: 'wood' },
  { id: 'bow', name: '蜜桃蝴蝶结', level: 30, color: '#E6B8B0', detail: '#BF8C89', style: 'bow' }
].sort((a, b) => a.level - b.level);

module.exports = { THEMES, FRAMES };

},
"cosmetic-art":function(module,exports,require){
'use strict';

function createCosmeticArt({ ctx, box, silhouette }) {
  const TAU = Math.PI * 2;
  function line(points, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    ctx.moveTo(...points[0]); points.slice(1).forEach(point => ctx.lineTo(...point)); ctx.stroke();
  }
  function dot(x, y, radius, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  }
  function star(x, y, size, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, radius = i % 2 ? size * .3 : size;
      const px = x + Math.sin(angle) * radius, py = y - Math.cos(angle) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    } ctx.closePath(); ctx.fill();
  }
  function motif(style, x, y, size, color, detail) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40);
    ctx.fillStyle = color; ctx.strokeStyle = detail || color; ctx.lineWidth = 2; ctx.lineCap = 'round';
    if (style === 'leaf') {
      line([[-13, 15], [13, -15]], detail || color, 2);
      [[-6, 5], [4, -5]].forEach(([a, b]) => { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(a, b, 9, 4, -.7, 0, TAU); ctx.fill(); });
    } else if (style === 'cloud' || style === 'rain') {
      [[-9, 0, 6], [0, -5, 8], [10, -1, 6]].forEach(v => dot(...v, color));
      if (style === 'rain') [-10, 0, 10].forEach(a => line([[a, 10], [a - 3, 16]], detail || color, 2));
      else line([[-11, 12], [8, 12]], detail || color, 2);
    } else if (style === 'flower') {
      for (let i = 0; i < 5; i++) dot(Math.sin(i * TAU / 5) * 8, Math.cos(i * TAU / 5) * 8, 5.5, color);
      dot(0, 0, 4, '#F2D18A');
    } else if (style === 'moon') {
      ctx.beginPath(); ctx.moveTo(6, -14); ctx.bezierCurveTo(-18, -16, -20, 14, 3, 15);
      ctx.bezierCurveTo(-5, 4, -4, -6, 6, -14); ctx.fill(); star(12, -5, 5, detail || color); star(13, 12, 3, detail || color);
    } else if (style === 'sun') {
      dot(0, 0, 10, color);
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; line([[Math.cos(a) * 14, Math.sin(a) * 14], [Math.cos(a) * 18, Math.sin(a) * 18]], detail || color, 2); }
    } else if (style === 'wave') {
      [-5, 7].forEach(b => { ctx.beginPath(); ctx.moveTo(-18, b); ctx.bezierCurveTo(-6, b - 10, -3, b + 10, 9, b); ctx.quadraticCurveTo(14, b - 5, 18, b); ctx.stroke(); });
      dot(12, -14, 2, color);
    } else if (style === 'candy') {
      dot(0, 0, 11, color); ctx.strokeStyle = detail || color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 6, -.6, Math.PI * 1.4); ctx.stroke();
      [[-1, -1], [1, 1]].forEach(([sign, v]) => { ctx.beginPath(); ctx.moveTo(sign * 10, 0); ctx.lineTo(sign * 18, -8 * v); ctx.lineTo(sign * 18, 8 * v); ctx.closePath(); ctx.fill(); });
    } else if (style === 'wood') {
      [-11, 0, 11].forEach(b => { ctx.beginPath(); ctx.moveTo(-18, b); ctx.bezierCurveTo(-8, b - 5, 6, b + 5, 18, b); ctx.stroke(); });
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, TAU); ctx.stroke();
    } else if (style === 'snow') {
      for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate(i * TAU / 6); line([[0, 0], [0, -18]], color, 2); line([[-5, -11], [0, -7], [5, -11]], color, 2); ctx.restore(); }
    } else if (style === 'lotus') {
      [-.65, 0, .65].forEach(a => { ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, 14); ctx.quadraticCurveTo(-12, -2, 0, -16); ctx.quadraticCurveTo(12, -2, 0, 14); ctx.fill(); ctx.restore(); });
      line([[-17, 16], [17, 16]], detail || color, 2);
    } else if (style === 'bow') {
      [-1, 1].forEach(sign => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(sign * 14, -16, sign * 23, -8, sign * 17, 4); ctx.quadraticCurveTo(sign * 9, 7, 0, 0); ctx.fill(); });
      dot(0, 0, 4, detail || color); line([[-4, 4], [-7, 14]], color, 5); line([[4, 4], [7, 14]], color, 5);
    } ctx.restore();
  }
  function rim(radius, color, width) {
    const a = 44, r = radius; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(-a + r, -a); ctx.lineTo(a - r, -a); ctx.quadraticCurveTo(a, -a, a, -a + r);
    ctx.lineTo(a, a - r); ctx.quadraticCurveTo(a, a, a - r, a); ctx.lineTo(-a + r, a);
    ctx.quadraticCurveTo(-a, a, -a, a - r); ctx.lineTo(-a, -a + r); ctx.quadraticCurveTo(-a, -a, -a + r, -a); ctx.closePath(); ctx.stroke();
  }
  function frame(cx, cy, size, info) {
    const { style, color, detail } = info;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (style === 'sun') {
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 41, 0, TAU); ctx.stroke();
      for (let i = 0; i < 16; i++) { const a = i * TAU / 16; line([[Math.cos(a) * 45, Math.sin(a) * 45], [Math.cos(a) * 48, Math.sin(a) * 48]], detail, 2); }
    } else {
      rim(style === 'wood' ? 4 : style === 'wave' ? 24 : 14, color, style === 'basic' ? 5 : 7);
      rim(style === 'wood' ? 4 : style === 'wave' ? 24 : 14, detail, 1);
      if (style === 'leaf') [[-35, -34], [35, 34]].forEach(v => motif('leaf', ...v, 21, color, detail));
      if (style === 'flower') [[-35, -35], [35, -35], [35, 35], [-35, 35]].forEach(v => motif('flower', ...v, 20, color, detail));
      if (style === 'moon') { motif('moon', -32, -34, 23, color, detail); star(35, 33, 8, '#F1D8A0'); star(35, -35, 5, detail); }
      if (style === 'wave') { motif('wave', 0, -37, 26, color, detail); motif('wave', 0, 37, 26, color, detail); [-1, 1].forEach(sign => dot(sign * 42, 0, 3, '#FFF3E2')); }
      if (style === 'wood') { [-1, 1].forEach(sign => { motif('wood', 0, sign * 38, 22, color, detail); dot(sign * 38, sign * 38, 2, '#EBD9BF'); }); }
      if (style === 'bow') { motif('bow', 0, -35, 30, color, detail); star(-36, 33, 4, '#F8E6D2'); star(36, 33, 4, '#F8E6D2'); }
    } ctx.restore();
    return { left: cx - size / 2, top: cy - size / 2, width: size, height: size };
  }
  function themePreview(x, y, width, height, theme) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    box(x, y, width, height, theme.paper, 12);
    const decor = Math.min(width * .25, height * .42);
    if (theme.style === 'none') {
      if (silhouette) silhouette(x + width * .2, y + height * .29, decor * .65, '#E4C9AD');
      star(x + width * .8, y + height * .24, decor * .16, '#E4C9AD');
    } else {
      motif(theme.style, x + width * .18, y + height * .3, decor, theme.accent, theme.ink);
      ctx.globalAlpha *= .5; motif(theme.style, x + width * .83, y + height * .75, decor * .6, theme.accent, theme.ink); ctx.globalAlpha *= 2;
    }
    const tile = Math.min(width * .12, height * .2), left = x + width / 2 - tile * 1.5, top = y + height / 2 - tile * 1.5;
    box(left - 3, top - 3, tile * 3 + 6, tile * 3 + 6, '#FFFCF7', 6);
    for (let i = 0; i < 9; i++) box(left + i % 3 * tile, top + Math.floor(i / 3) * tile, tile - 2, tile - 2, i % 3 === 0 ? theme.accent : i % 2 ? '#EDD5B0' : '#D6E0D0', 2);
    dot(left + tile * 1.5 - 1, top + tile * 1.5 - 1, tile * .21, '#FFFAEF');
    ctx.restore(); return { x, y, width, height };
  }
  function background(width, height, theme, time) {
    if (theme.style === 'none') return false;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip(); ctx.globalAlpha *= .1;
    const size = Math.min(width * .21, 78), float = Math.sin((Number(time) || 0) / 2600) * size * .025;
    [[size * .6, size * .65 + float], [width - size * .6, size * .65 - float], [size * .6, height - size * .65 - float], [width - size * .6, height - size * .65 + float]].forEach(v => motif(theme.style, ...v, size, theme.accent, theme.ink));
    ctx.restore(); return true;
  }
  return { frame, themePreview, background };
}

module.exports = { createCosmeticArt };

},
"progression":function(module,exports,require){
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

},
"audio":function(module,exports,require){
(function () {
  'use strict';

  const EFFECTS = {
    correct: ['mark_cat', 3], helper: ['mark_cat', 3],
    error: ['mark_wrong_1', 2], hint: ['use_hint', 1], checkin: ['use_hint', 1],
    win: ['level_win', 1, true], click: ['btn_click_2', 4],
    board: ['board_enter_1', 1, true], mark: ['mark_x_2', 4], unmark: ['unmark_x_2', 4],
    fail: ['level_fail', 1], dialog: ['dlg_open_1', 1], clear: ['all_cleared', 1]
  };

  function createAudio(options) {
    options = options || {};
    const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
    const browser = options.window || (typeof window !== 'undefined' ? window : null);
    const isWechat = !!(wechat && typeof wechat.createInnerAudioContext === 'function');
    const basePath = options.basePath || (isWechat ? 'assets/audio/' : '../assets/audio/');
    const musicPath = options.musicPath || (isWechat ? 'audio-assets/' : '../audio-assets/');
    const initial = options.settings || {};
    const settings = { music: typeof initial.music === 'boolean' ? initial.music : false,
      sound: typeof initial.sound === 'boolean' ? initial.sound : true };
    const pools = {};
    let musicLane = null, serial = 0;
    let unlocked = false, hidden = false, destroyed = false, musicPaused = false;
    let musicPackage = isWechat && typeof wechat.loadSubpackage === 'function' ? 'unloaded' : 'ready';

    function stop(lane, rewind) {
      if (!lane) return;
      lane.epoch++;
      try {
        if (isWechat && rewind) lane.node.stop();
        else {
          lane.node.pause();
          if (rewind) lane.node.currentTime = 0;
        }
      } catch (_) { /* 未加载完毕时允许停止失败，下次播放会重新定位。 */ }
      lane.playing = false;
    }

    function effectLanes() { return Object.keys(pools).flatMap(name => pools[name]); }

    function createLane(category, file, pausesMusic) {
      let node;
      try {
        if (isWechat) node = wechat.createInnerAudioContext();
        else if (browser && typeof browser.Audio === 'function') node = new browser.Audio();
        else return null;
      } catch (_) { return null; }
      const lane = { node, playing: false, pausesMusic: !!pausesMusic, epoch: 0, serial: 0 };
      node.loop = category === 'music';
      node.autoplay = false;
      node.volume = 1;
      node.src = (category === 'music' ? musicPath : basePath) + file + '.mp3';
      function finish() {
        const blockedMusic = lane.playing && lane.pausesMusic;
        lane.playing = false;
        lane.epoch++;
        if (blockedMusic) music();
      }
      if (isWechat) {
        node.obeyMuteSwitch = true;
        if (typeof node.onError === 'function') node.onError(finish);
        if (typeof node.onEnded === 'function') node.onEnded(finish);
      } else {
        node.preload = 'auto';
        if (typeof node.addEventListener === 'function') {
          node.addEventListener('error', finish);
          node.addEventListener('ended', finish);
        }
      }
      return lane;
    }

    function playLane(lane, restart) {
      if (!lane) return false;
      if (restart) stop(lane, true);
      const epoch = ++lane.epoch;
      lane.playing = true;
      lane.serial = ++serial;
      try {
        const promise = lane.node.play();
        // 只处理本次播放的拒绝；旧 Promise 不会截断同一声道的新播放。
        if (promise && typeof promise.catch === 'function') promise.catch(() => {
          if (lane.epoch !== epoch) return;
          lane.playing = false;
          if (lane.pausesMusic) music();
        });
        return true;
      } catch (_) {
        lane.playing = false;
        return false;
      }
    }

    function music() {
      if (!unlocked || hidden || destroyed || musicPaused || !settings.music || (musicLane && musicLane.playing)) return;
      if (effectLanes().some(lane => lane.playing && lane.pausesMusic)) return;
      if (musicPackage === 'loading') return;
      if (musicPackage === 'unloaded') {
        musicPackage = 'loading';
        try {
          wechat.loadSubpackage({ name: 'audio', success() {
            musicPackage = 'ready';
            // 加载期间的关闭、切后台及销毁状态以此刻为准，不补播短音效。
            music();
          }, fail() { musicPackage = 'unloaded'; } });
        } catch (_) { musicPackage = 'unloaded'; }
        return;
      }
      if (!musicLane) musicLane = createLane('music', 'bgm_rain_piano', false);
      playLane(musicLane, false);
    }

    function configure(next) {
      if (destroyed) return;
      for (const key of ['music', 'sound']) {
        if (!next || typeof next[key] !== 'boolean') continue;
        settings[key] = next[key];
        if (!settings[key]) {
          if (key === 'music') stop(musicLane, true);
          else effectLanes().forEach(lane => stop(lane, true));
        }
      }
      music();
    }

    function unlock() {
      if (destroyed) return;
      unlocked = true;
      music();
    }

    function event(name) {
      const effect = EFFECTS[name];
      if (destroyed || hidden || !unlocked || !settings.sound || !effect) return false;
      const [file, limit, pausesMusic] = effect;
      const pool = pools[file] || (pools[file] = []);
      let lane = pool.find(item => !item.playing);
      if (!lane && pool.length < limit) {
        lane = createLane('sound', file, pausesMusic);
        if (lane) pool.push(lane);
      }
      // 达到并发上限后复用最早的声道，连续划叉不会无限堆积。
      if (!lane && pool.length) lane = pool.reduce((oldest, item) => item.serial < oldest.serial ? item : oldest);
      if (!playLane(lane, true)) { music(); return false; }
      if (pausesMusic) stop(musicLane, false);
      return true;
    }

    function pause() {
      if (destroyed) return;
      hidden = true;
      stop(musicLane, false);
      effectLanes().forEach(lane => stop(lane, true));
    }

    function setMusicPaused(value) {
      if (destroyed) return;
      const next = !!value;
      if (musicPaused === next) return;
      musicPaused = next;
      if (musicPaused) stop(musicLane, false);
      else music();
    }

    function resume() {
      if (destroyed) return;
      hidden = false;
      music();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      const lanes = effectLanes();
      if (musicLane) lanes.push(musicLane);
      lanes.forEach(lane => {
        stop(lane, true);
        if (isWechat && typeof lane.node.destroy === 'function') lane.node.destroy();
        else { lane.node.src = ''; if (typeof lane.node.load === 'function') lane.node.load(); }
      });
    }

    return {
      configure, unlock, event, pause, resume, destroy, setMusicPaused,
      getState() {
        const playing = [];
        if (musicLane && musicLane.playing) playing.push('music');
        if (effectLanes().some(lane => lane.playing)) playing.push('sound');
        return { available: isWechat || !!(browser && typeof browser.Audio === 'function'), unlocked, hidden, destroyed,
          settings: Object.assign({}, settings), playing };
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createAudio };
  else if (typeof window !== 'undefined') window.MeowAudio = { createAudio };
})();

},
"input-ui":function(module,exports,require){
(function () {
  'use strict';

  function createInputUI(options) {
    options = options || {};
    const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
    const browser = options.window || (typeof window !== 'undefined' ? window : null);
    const document = browser && browser.document;
    let active = null, destroyed = false;

    function editNickname(current, done) {
      if (active) active.finish(false);
      const initial = typeof current === 'string' ? current : '';
      const callback = typeof done === 'function' ? done : function () {};
      if (destroyed) { callback({ confirmed: false, value: initial }); return; }
      const request = { finished: false, cleanup: function () {} };
      active = request;
      request.finish = function (confirmed, value) {
        if (request.finished) return;
        request.finished = true;
        if (active === request) active = null;
        request.cleanup();
        callback({ confirmed: !!confirmed, value: confirmed && typeof value === 'string' ? value : initial });
      };

      if (wechat && typeof wechat.showKeyboard === 'function') {
        // 完整的监听清理 API 是此编辑器的前提，避免旧键盘事件保存另一次输入。
        const methods = ['onKeyboardConfirm', 'offKeyboardConfirm', 'onKeyboardComplete', 'offKeyboardComplete'];
        if (methods.some(name => typeof wechat[name] !== 'function')) { request.finish(false); return; }
        const confirm = event => request.finish(true, event && event.value);
        const complete = () => request.finish(false);
        let confirmAttached = false, completeAttached = false;
        request.cleanup = function () {
          if (confirmAttached) {
            try { wechat.offKeyboardConfirm(confirm); } catch (_) { /* 旧事件也受一次性完成状态保护。 */ }
            confirmAttached = false;
          }
          if (completeAttached) {
            try { wechat.offKeyboardComplete(complete); } catch (_) { /* 继续清理另一监听和键盘。 */ }
            completeAttached = false;
          }
          if (typeof wechat.hideKeyboard === 'function') {
            try { wechat.hideKeyboard({}); } catch (_) { /* 失败或已经收起时无需再次处理。 */ }
          }
        };
        try {
          wechat.onKeyboardConfirm(confirm); confirmAttached = true;
          wechat.onKeyboardComplete(complete); completeAttached = true;
          wechat.showKeyboard({ defaultValue: initial, maxLength: 12, multiple: false,
            confirmHold: false, confirmType: 'done', fail: () => request.finish(false) });
        } catch (_) { request.finish(false); }
        return;
      }

      if (!document || !document.body || typeof document.createElement !== 'function') {
        request.finish(false); return;
      }
      const previousFocus = document.activeElement;
      const element = (tag, text, css) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (css) node.style.cssText = css;
        return node;
      };
      const overlay = element('div', undefined, 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#211a18b8;padding:20px;padding-top:max(20px,env(safe-area-inset-top));padding-bottom:max(20px,env(safe-area-inset-bottom));box-sizing:border-box;');
      const panel = element('div', undefined, 'width:min(100%,360px);max-height:100%;overflow:auto;border-radius:26px;background:#fffaf4;padding:26px 22px 22px;box-sizing:border-box;box-shadow:0 16px 48px #24131044;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#935a5a;');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'meow-nickname-title');
      const title = element('h2', '修改昵称', 'font-size:25px;font-weight:500;margin:0 0 22px;text-align:center;');
      title.id = 'meow-nickname-title';
      const input = element('input', undefined, 'width:100%;height:54px;box-sizing:border-box;padding:12px 14px;border:1px solid #ddc9b9;border-radius:14px;background:#f9ede0;color:#935a5a;font:20px system-ui,"Microsoft YaHei",sans-serif;outline-color:#f7931b;');
      // 原生长度按 UTF-16 计算，留出十二个表情符号的空间，提交时再按码点验证。
      input.type = 'text'; input.maxLength = 24; input.value = initial; input.autocomplete = 'off';
      input.spellcheck = false; input.setAttribute('aria-label', '昵称，输入一至十二个字符');
      const detail = element('p', '请输入 1～12 个字符的昵称', 'font-size:13px;color:#af9081;margin:10px 0 24px;');
      detail.setAttribute('aria-live', 'polite');
      const buttons = element('div', undefined, 'display:flex;gap:12px;');
      const cancel = element('button', '取消', 'flex:1;height:48px;border:1px solid #c99160;border-radius:24px;background:#fffaf4;color:#a8704b;font:18px system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;');
      const confirm = element('button', '确定', 'flex:1;height:48px;border:0;border-radius:24px;background:#f7931b;color:white;font:18px system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 5px 12px #f7931b33;cursor:pointer;');
      cancel.type = confirm.type = 'button';
      buttons.appendChild(cancel); buttons.appendChild(confirm);
      panel.appendChild(title); panel.appendChild(input); panel.appendChild(detail); panel.appendChild(buttons);
      overlay.appendChild(panel);
      const submit = () => {
        const value = input.value.trim().replace(/\s+/g, ' ');
        if (!value || Array.from(value).length > 12 || /[\u0000-\u001F\u007F]/.test(input.value)) {
          detail.textContent = '请输入 1～12 个字符的昵称'; detail.style.color = '#B8634E';
          input.setAttribute('aria-invalid', 'true'); input.focus(); return;
        }
        request.finish(true, value);
      };
      const keydown = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); request.finish(false); }
        else if (event.key === 'Enter') {
          event.preventDefault(); if (event.target === cancel) request.finish(false); else submit();
        } else if (event.key === 'Tab') {
          const controls = [input, cancel, confirm];
          const index = controls.indexOf(document.activeElement);
          const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
            : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          event.preventDefault(); controls[next].focus();
        }
      };
      const visibility = () => { if (document.hidden) request.finish(false); };
      const viewport = browser.visualViewport;
      const fitKeyboard = () => {
        if (!viewport || !(viewport.height > 0)) return;
        overlay.style.top = (viewport.offsetTop || 0) + 'px';
        overlay.style.bottom = 'auto';
        overlay.style.height = viewport.height + 'px';
      };
      cancel.addEventListener('click', () => request.finish(false));
      confirm.addEventListener('click', submit);
      overlay.addEventListener('pointerdown', event => { if (event.target === overlay) request.finish(false); });
      request.cleanup = function () {
        document.removeEventListener('keydown', keydown);
        document.removeEventListener('visibilitychange', visibility);
        if (viewport && typeof viewport.removeEventListener === 'function') {
          viewport.removeEventListener('resize', fitKeyboard);
          viewport.removeEventListener('scroll', fitKeyboard);
        }
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && typeof previousFocus.focus === 'function' && !document.hidden) {
          try { previousFocus.focus(); } catch (_) { /* 原元素可能已随页面关闭。 */ }
        }
      };
      document.addEventListener('keydown', keydown);
      document.addEventListener('visibilitychange', visibility);
      if (viewport && typeof viewport.addEventListener === 'function') {
        viewport.addEventListener('resize', fitKeyboard);
        viewport.addEventListener('scroll', fitKeyboard);
      }
      document.body.appendChild(overlay);
      fitKeyboard();
      input.focus();
      if (typeof input.select === 'function') input.select();
    }

    function destroy() {
      destroyed = true;
      if (active) active.finish(false);
    }

    return { editNickname, destroy };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createInputUI };
  else if (typeof window !== 'undefined') window.MeowInputUI = { createInputUI };
})();

},
"sprite-frames":function(module,exports,require){
'use strict';

// 依据透明图集实际主体轮廓定位，保留原图，不按名义格子裁断耳朵。
const primary = {"width":1254,"height":1254,"nominalSize":313.5,"frames":[[22,34,288,269,166.0,168.5],[332,32,288,267,476.0,165.5],[638,31,287,267,781.5,164.5],[959,39,283,261,1100.5,169.5],[15,327,289,275,159.5,464.5],[324,324,287,279,467.5,463.5],[642,329,283,272,783.5,465.0],[955,329,286,277,1098.0,467.5],[21,621,292,276,167.0,759.0],[327,616,303,291,478.5,761.5],[644,605,269,312,778.5,761.0],[940,644,302,262,1091.0,775.0],[7,909,327,326,170.5,1072.0],[341,950,280,254,481.0,1077.0],[632,927,290,281,777.0,1067.5],[936,932,305,281,1088.5,1072.5]],"holes":{}};
const expanded = {"width":1422,"height":1106,"nominalSize":158,"frames":[[23,19,154,138,100.0,88.0],[191,18,151,138,266.5,87.0],[353,20,149,137,427.5,88.5],[507,20,137,135,575.5,87.5],[643,20,149,136,717.5,88.0],[798,19,144,136,870.0,87.0],[951,17,147,139,1024.5,86.5],[1103,21,145,136,1175.5,89.0],[1256,18,148,139,1330.0,87.5],[22,167,155,135,99.5,234.5],[190,169,151,132,265.5,235.0],[351,171,150,131,426.0,236.5],[503,163,140,136,573.0,231.0],[647,158,148,144,721.0,230.0],[799,170,147,131,872.5,235.5],[953,170,146,131,1026.0,235.5],[1103,174,144,128,1175.0,238.0],[1255,171,147,131,1328.5,236.5],[29,305,141,177,99.5,393.5],[195,306,138,175,264.0,393.5],[357,307,140,171,427.0,392.5],[518,307,127,173,581.5,393.5],[657,308,134,172,724.0,394.0],[809,310,133,171,875.5,395.5],[960,309,133,170,1026.5,394.0],[1112,312,131,170,1177.5,397.0],[1262,309,137,172,1330.5,395.0],[22,479,158,150,101.0,554.0],[188,482,160,147,268.0,555.5],[354,485,148,146,428.0,558.0],[506,484,138,146,575.0,557.0],[648,487,151,146,723.5,560.0],[801,490,149,142,875.5,561.0],[955,482,145,149,1027.5,556.5],[1107,490,143,143,1178.5,561.5],[1256,487,150,147,1331.0,560.5],[19,631,161,145,99.5,703.5],[186,631,156,147,264.0,704.5],[349,634,156,144,427.0,706.0],[506,635,136,138,574.0,704.0],[643,635,157,145,721.5,707.5],[800,637,152,143,876.0,708.5],[952,634,152,145,1028.0,706.5],[1106,638,148,141,1180.0,708.5],[1253,637,152,142,1329.0,708.0],[22,788,153,125,98.5,850.5],[186,786,156,128,264.0,850.0],[351,790,150,129,426.0,854.5],[506,787,140,121,576.0,847.5],[647,793,150,120,722.0,853.0],[802,796,147,114,875.5,853.0],[955,790,143,123,1026.5,851.5],[1102,794,149,120,1176.5,854.0],[1258,791,148,125,1332.0,853.5],[24,921,153,147,100.5,994.5],[187,918,154,149,264.0,992.5],[350,922,152,147,426.0,995.5],[509,919,141,149,579.5,993.5],[651,922,147,147,724.5,995.5],[802,921,147,145,875.5,993.5],[953,918,146,149,1026.0,992.5],[1104,921,148,147,1178.0,994.5],[1259,920,148,148,1333.0,994.0]],"holes":{"18":[[161,480,6,1],[34,481,4,1],[159,481,11,1]],"27":[[79,479,33,1],[93,480,7,1]]}};

module.exports = { primary, expanded };

},
"ui-frames":function(module,exports,require){
'use strict';
// 界面纹理图集坐标，保留透明留白。
module.exports = {"frames":{"treasure_box":[674,0,600,656],"wool_1":[1548,1690,244,248],"wool_2":[1692,2392,104,16],"wool_3":[1110,2392,156,208],"wool_4":[1815,0,188,316],"wool_unchecked":[0,0,672,1072],"icon_hint_lamp":[1613,0,200,320],"icon_mark_white":[1488,2392,100,100],"icon_prompt_frame":[1290,1690,256,256],"icon_tool":[1268,2392,108,108],"pattern_bell":[1794,1690,220,220],"pattern_claw":[0,1948,220,220],"pattern_dot":[222,1948,220,220],"pattern_ear":[444,1948,220,220],"pattern_fishbone":[666,1948,220,220],"pattern_heart":[888,1948,220,220],"pattern_paw":[1110,1948,220,220],"pattern_sparkle":[1332,1948,220,220],"pattern_sprout":[1554,1948,220,220],"pattern_triangle":[444,2392,220,220],"pattern_whisker":[666,2392,220,220],"pattern_yarn":[888,2392,220,220],"tool_cat_item":[1378,2392,108,108],"tool_cat_item_prompt":[1590,2392,100,100],"head_0000":[924,1382,256,256],"head_0001":[1182,1382,256,256],"head_0002":[1440,1382,256,256],"head_0003":[1698,1382,256,256],"head_0004":[0,1690,256,256],"head_0005":[258,1690,256,256],"head_0006":[516,1690,256,256],"head_0007":[774,1690,256,256],"head_0008":[1032,1690,256,256],"frame_0001":[0,1074,306,306],"frame_0002":[308,1074,306,306],"frame_0003":[616,1074,306,306],"frame_0004":[924,1074,306,306],"frame_0005":[1232,1074,306,306],"frame_0006":[1540,1074,306,306],"frame_0007":[0,1382,306,306],"frame_0008":[308,1382,306,306],"frame_0100":[616,1382,306,306],"pattern_tint_0":[1776,1948,220,220],"pattern_tint_1":[0,2170,220,220],"pattern_tint_2":[666,2170,220,220],"pattern_tint_3":[888,2170,220,220],"pattern_tint_4":[1110,2170,220,220],"pattern_tint_5":[1332,2170,220,220],"pattern_tint_6":[1554,2170,220,220],"pattern_tint_7":[1776,2170,220,220],"pattern_tint_8":[0,2392,220,220],"pattern_tint_9":[222,2392,220,220],"pattern_tint_10":[222,2170,220,220],"pattern_tint_11":[444,2170,220,220],"wool_checked":[1276,0,335,540]},"patterns":["pattern_tint_0","pattern_tint_1","pattern_tint_2","pattern_tint_3","pattern_tint_4","pattern_tint_5","pattern_tint_6","pattern_tint_7","pattern_tint_8","pattern_tint_9","pattern_tint_10","pattern_tint_11"],"avatars":{"cat":"head_0001","panda":"head_0002","corgi":"head_0003","crocodile":"head_0004","chicken":"head_0005","duck":"head_0006","lion":"head_0007","calico":"head_0008"}};

},
"cat-frames":function(module,exports,require){
'use strict';
// 原包代表帧，仅静态表情；每帧可见像素包围框中心用于方格居中。
module.exports = {"frames":[[59,59,140,127,129.0,122.5],[307,56,146,131,380.0,121.5],[573,63,142,124,644.0,125.0],[64,313,139,130,133.5,378.0],[320,313,139,130,389.5,378.0],[553,288,206,167,656.0,371.5],[20,591,213,109,126.5,645.5],[260,591,244,109,382.0,645.5],[562,595,141,111,632.5,650.5]],"height":768,"holes":{},"nominalSize":170,"width":768};

},
"garden-frames":function(module,exports,require){
'use strict';
// 八阶段保留透明阴影；盆宽统一150像素，盆底统一294像素。
module.exports = {"width":1024,"height":688,"frameWidth":256,"frameHeight":344,"potWidth":150,"potBaseline":[128,294],"alphaBoundsThreshold":9,"frames":[{"stage":0,"rect":[0,0,256,344],"potBaseline":[128,294],"foregroundBounds":[52,161,203,294],"foregroundCenter":[127.5,227.5],"sourceRect":[0,0,384,512],"sourcePotBounds":[70,221,320,433],"sourcePotBaseline":[195.0,435],"scale":0.6,"scaledSourceSize":[230,307],"sourceOffset":[11,33],"pixelSha256":"6b9b48e60f7703c410cfd5cea8ac031a5910d1ba1dd90f4431eb207bcb869005"},{"stage":1,"rect":[256,0,256,344],"potBaseline":[128,294],"foregroundBounds":[51,130,204,294],"foregroundCenter":[127.5,212.0],"sourceRect":[384,0,768,512],"sourcePotBounds":[71,221,320,433],"sourcePotBaseline":[195.5,435],"scale":0.6024096385542169,"scaledSourceSize":[231,308],"sourceOffset":[10,32],"pixelSha256":"de251acce936c4bf6a6d2aec36ccbadb2db52d11d5dd607ee783602dac17b827"},{"stage":2,"rect":[512,0,256,344],"potBaseline":[128,294],"foregroundBounds":[51,113,203,294],"foregroundCenter":[127.0,203.5],"sourceRect":[768,0,1152,512],"sourcePotBounds":[66,221,316,433],"sourcePotBaseline":[191.0,435],"scale":0.6,"scaledSourceSize":[230,307],"sourceOffset":[13,33],"pixelSha256":"067f954d19a8c926ad344cb377f9b4535b798c4b06f0f793d40a8f344b3cbb83"},{"stage":3,"rect":[768,0,256,344],"potBaseline":[128,294],"foregroundBounds":[52,76,204,294],"foregroundCenter":[128.0,185.0],"sourceRect":[1152,0,1536,500],"sourcePotBounds":[64,221,314,433],"sourcePotBaseline":[189.0,435],"scale":0.6,"scaledSourceSize":[230,300],"sourceOffset":[15,33],"pixelSha256":"b6632bd21579fb835f95392f6dc48773a8c24362cee88519397454277cafa1da"},{"stage":4,"rect":[0,344,256,344],"potBaseline":[128,294],"foregroundBounds":[53,40,207,294],"foregroundCenter":[130.0,167.0],"sourceRect":[0,512,384,1024],"sourcePotBounds":[69,266,320,465],"sourcePotBaseline":[194.5,467],"scale":0.5976095617529881,"scaledSourceSize":[229,306],"sourceOffset":[12,15],"pixelSha256":"d9aa5494a1500a00c0c894ca1c8340af601c9645f3afc249d1646ee75aadaa54"},{"stage":5,"rect":[256,344,256,344],"potBaseline":[128,294],"foregroundBounds":[51,22,207,294],"foregroundCenter":[129.0,158.0],"sourceRect":[384,512,768,1024],"sourcePotBounds":[71,266,320,465],"sourcePotBaseline":[195.5,467],"scale":0.6024096385542169,"scaledSourceSize":[231,308],"sourceOffset":[10,13],"pixelSha256":"cd0d590e63ea5651a98cbb2e5c506f90eceee3eb41b92ca42c088910da71af25"},{"stage":6,"rect":[512,344,256,344],"potBaseline":[128,294],"foregroundBounds":[46,23,207,294],"foregroundCenter":[126.5,158.5],"sourceRect":[768,512,1152,1024],"sourcePotBounds":[66,266,316,465],"sourcePotBaseline":[191.0,467],"scale":0.6,"scaledSourceSize":[230,307],"sourceOffset":[13,14],"pixelSha256":"403ddf465e09bf1aa840fe5302019362a61adee20d080f62f6df723a36786d5e"},{"stage":7,"rect":[768,344,256,344],"potBaseline":[128,294],"foregroundBounds":[40,12,220,294],"foregroundCenter":[130.0,153.0],"sourceRect":[1152,500,1536,1024],"sourcePotBounds":[64,278,314,477],"sourcePotBaseline":[189.0,479],"scale":0.6,"scaledSourceSize":[230,314],"sourceOffset":[15,7],"pixelSha256":"5d6af88392368182f0be353e3041c3709b92a183578816fa7e363746dc2ecf13"}]};

},
"garden-art":function(module,exports,require){
'use strict';
const gardenFrames = require('./garden-frames.js');

function stageForTotal(total) {
  return Math.max(0, Math.min(7, Math.floor(Number(total) || 0)));
}

function createGardenArt(ctx, getPlantAtlas) {
  function plant(cx, cy, width, height, total, now) {
    const stage = stageForTotal(total), frame = gardenFrames.frames[stage];
    const bitmap = getPlantAtlas && getPlantAtlas();
    const scale = Math.min(width / gardenFrames.frameWidth, height / gardenFrames.frameHeight) * .96;
    const drawWidth = gardenFrames.frameWidth * scale, drawHeight = gardenFrames.frameHeight * scale;
    const left = cx - drawWidth / 2, top = cy - drawHeight / 2;
    const baselineX = left + frame.potBaseline[0] * scale;
    const baselineY = top + frame.potBaseline[1] * scale;
    const angle = stage > 0 ? Math.sin((Number(now) || 0) / 2300) * .008 : 0;
    if (bitmap) {
      // 从盆底固定锚点轻摆，统一画布始终等比缩放，保留各阶段叶花及透明边缘。
      ctx.save(); ctx.translate(baselineX, baselineY); ctx.rotate(angle);
      ctx.drawImage(bitmap, ...frame.rect, -frame.potBaseline[0] * scale,
        -frame.potBaseline[1] * scale, drawWidth, drawHeight);
      ctx.restore();
    }
    return { stage, drawn: !!bitmap, left, top, width: drawWidth, height: drawHeight,
      baselineX, baselineY, angle };
  }
  return { plant };
}

module.exports = { createGardenArt, stageForTotal };

},
"level-data":function(module,exports,require){
'use strict';
// 99关数据，按棋盘尺寸和推理难度排列。
module.exports = [{"id":1,"size":4,"regions":[0,1,2,2,0,2,2,3,0,0,2,3,0,2,2,2],"solution":[1,3,0,2],"difficulty":"easy","source":"curated-99","given":[7],"colorMap":[0,3,2,1]},{"id":2,"size":5,"regions":[0,0,0,1,2,0,0,3,1,2,0,0,1,1,1,0,1,1,1,1,4,4,4,4,4],"solution":[4,2,0,3,1],"difficulty":"easy","source":"curated-99","given":[4],"colorMap":[6,4,1,3,0]},{"id":3,"size":5,"regions":[0,0,0,0,0,1,2,0,3,0,3,2,0,3,4,3,2,0,3,4,3,3,3,3,3],"solution":[2,0,4,1,3],"difficulty":"easy","source":"curated-99","given":[2]},{"id":4,"size":5,"regions":[0,0,0,0,0,1,0,2,3,0,0,0,2,3,0,0,3,3,3,3,0,4,4,3,3],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99","given":[3]},{"id":5,"size":5,"regions":[0,0,0,1,1,2,0,2,2,2,2,2,2,3,4,2,4,4,4,4,2,2,4,4,4],"solution":[4,1,3,0,2],"difficulty":"easy","source":"curated-99","given":[4]},{"id":6,"size":5,"regions":[0,1,1,2,1,0,3,1,1,1,0,3,4,4,1,0,3,3,3,1,3,3,3,1,1],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99","given":[5]},{"id":7,"size":5,"regions":[0,0,0,1,1,0,0,2,2,1,0,3,2,3,3,0,3,2,3,4,3,3,3,3,3],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99","given":[19]},{"id":8,"size":5,"regions":[0,1,1,1,1,0,1,2,2,2,0,0,0,0,2,0,3,2,2,2,0,4,4,4,4],"solution":[2,0,4,1,3],"difficulty":"easy","source":"curated-99","given":[16]},{"id":9,"size":5,"regions":[0,0,0,1,1,0,1,1,1,1,0,2,3,4,1,0,0,3,4,4,0,3,3,3,3],"solution":[0,3,1,4,2],"difficulty":"easy","source":"curated-99","given":[11]},{"id":10,"size":5,"regions":[0,0,0,1,1,0,2,2,1,1,0,3,2,2,3,0,3,2,4,3,0,3,3,3,3],"solution":[4,2,0,3,1],"difficulty":"easy","source":"curated-99","given":[18]},{"id":11,"size":5,"regions":[0,0,0,0,1,0,2,0,1,1,3,2,0,0,3,3,2,3,4,3,3,3,3,3,3],"solution":[2,4,1,3,0],"difficulty":"easy","source":"curated-99"},{"id":12,"size":5,"regions":[0,1,1,1,2,0,1,2,1,2,3,2,2,2,2,3,3,2,4,2,3,2,2,4,2],"solution":[2,0,4,1,3],"difficulty":"easy","source":"curated-99"},{"id":13,"size":5,"regions":[0,0,1,2,2,0,1,1,3,2,1,1,1,3,2,3,3,1,3,4,3,3,3,3,4],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99"},{"id":14,"size":5,"regions":[0,0,0,0,1,2,3,3,1,1,3,3,3,3,1,3,4,1,1,1,3,4,4,4,4],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99"},{"id":15,"size":5,"regions":[0,0,1,1,1,2,0,0,1,0,2,2,0,0,0,3,4,0,4,4,3,4,4,4,4],"solution":[2,4,1,3,0],"difficulty":"easy","source":"curated-99"},{"id":16,"size":5,"regions":[0,0,0,1,1,2,0,1,1,3,2,0,4,4,3,0,0,3,3,3,0,0,0,0,0],"solution":[3,0,2,4,1],"difficulty":"easy","source":"curated-99"},{"id":17,"size":5,"regions":[0,0,1,2,2,0,3,1,1,2,3,3,1,2,2,3,1,1,2,2,3,3,1,4,2],"solution":[1,4,2,0,3],"difficulty":"normal","source":"curated-99"},{"id":18,"size":5,"regions":[0,0,0,0,0,0,1,2,3,0,0,1,3,3,3,0,1,1,3,4,0,1,4,4,4],"solution":[0,2,4,1,3],"difficulty":"normal","source":"curated-99"},{"id":19,"size":6,"regions":[0,0,1,1,1,1,0,1,1,2,3,1,0,0,1,2,3,3,2,2,2,2,3,4,2,4,4,4,5,4,2,2,4,4,4,4],"solution":[3,0,5,1,4,2],"difficulty":"normal","source":"curated-99"},{"id":20,"size":6,"regions":[0,0,0,1,1,1,0,2,0,3,4,1,0,2,2,3,1,1,2,2,2,3,3,1,2,5,5,5,5,1,2,5,5,5,1,1],"solution":[0,4,1,3,5,2],"difficulty":"normal","source":"curated-99"},{"id":21,"size":6,"regions":[0,0,0,0,0,0,1,0,2,0,3,0,2,2,2,3,3,0,2,4,4,3,3,0,2,4,5,5,3,3,4,4,5,5,5,3],"solution":[5,0,2,4,1,3],"difficulty":"normal","source":"curated-99"},{"id":22,"size":6,"regions":[0,1,1,1,1,2,0,0,0,1,2,2,0,0,3,3,3,2,0,0,4,3,3,3,5,0,0,0,5,3,5,5,5,5,5,5],"solution":[1,4,0,2,5,3],"difficulty":"normal","source":"curated-99"},{"id":23,"size":6,"regions":[0,0,0,0,0,1,2,2,1,1,0,1,2,3,4,1,1,1,3,3,4,5,1,4,3,4,4,1,1,4,4,4,4,4,4,4],"solution":[4,1,5,3,0,2],"difficulty":"normal","source":"curated-99"},{"id":24,"size":6,"regions":[0,1,1,2,2,2,0,0,1,2,3,2,0,1,1,2,4,4,0,0,2,2,2,4,5,5,2,4,2,4,5,2,2,4,4,4],"solution":[2,4,0,3,1,5],"difficulty":"normal","source":"curated-99"},{"id":25,"size":6,"regions":[0,0,0,1,1,1,0,1,1,1,1,1,0,0,2,3,4,4,5,5,3,3,4,3,5,3,3,3,3,3,5,5,3,3,3,3],"solution":[1,5,2,4,0,3],"difficulty":"normal","source":"curated-99"},{"id":26,"size":6,"regions":[0,0,0,0,1,1,0,0,2,2,2,1,0,0,2,3,4,1,0,5,2,4,4,4,5,5,2,2,4,4,5,5,5,2,2,4],"solution":[4,1,3,5,2,0],"difficulty":"normal","source":"curated-99"},{"id":27,"size":6,"regions":[0,0,0,1,1,1,0,1,1,1,2,2,0,3,1,2,2,4,3,3,4,4,4,4,3,4,4,3,5,4,3,3,3,3,4,4],"solution":[3,5,0,2,4,1],"difficulty":"normal","source":"curated-99"},{"id":28,"size":6,"regions":[0,0,0,1,1,2,0,1,1,1,2,2,0,0,3,1,3,2,0,3,3,3,3,3,0,4,3,5,5,3,5,5,5,5,3,3],"solution":[5,2,0,4,1,3],"difficulty":"normal","source":"curated-99"},{"id":29,"size":6,"regions":[0,0,1,2,2,2,0,1,1,1,3,2,0,4,3,3,3,3,4,4,3,4,3,4,4,3,3,4,5,4,4,4,4,4,4,4],"solution":[5,3,0,2,4,1],"difficulty":"normal","source":"curated-99"},{"id":30,"size":6,"regions":[0,0,0,0,1,1,0,2,0,1,1,3,0,2,2,2,2,3,4,4,4,2,3,3,4,3,4,3,5,3,4,3,3,3,3,3],"solution":[5,0,3,1,4,2],"difficulty":"normal","source":"curated-99"},{"id":31,"size":6,"regions":[0,0,1,2,2,2,0,1,1,1,3,2,0,0,0,0,2,2,4,0,0,0,0,2,4,4,5,5,2,2,4,5,5,2,2,2],"solution":[2,4,1,5,3,0],"difficulty":"normal","source":"curated-99"},{"id":32,"size":6,"regions":[0,1,1,1,2,3,0,1,1,2,2,3,0,1,1,1,3,3,0,1,4,3,3,3,0,1,5,5,5,5,0,0,0,0,0,5],"solution":[1,3,5,2,4,0],"difficulty":"normal","source":"curated-99"},{"id":33,"size":6,"regions":[0,0,0,1,2,2,0,2,2,2,2,3,0,0,2,2,3,3,0,4,4,2,3,4,5,5,4,4,3,4,5,4,4,4,4,4],"solution":[3,0,2,4,1,5],"difficulty":"normal","source":"curated-99"},{"id":34,"size":6,"regions":[0,0,1,1,1,2,0,0,0,1,2,2,3,4,0,0,2,2,4,4,4,4,2,5,4,5,4,5,5,5,4,5,5,5,5,5],"solution":[1,3,0,4,2,5],"difficulty":"normal","source":"curated-99"},{"id":35,"size":6,"regions":[0,0,0,0,1,2,0,0,0,0,0,2,3,3,0,2,2,2,3,2,2,2,4,2,5,5,4,2,4,2,5,5,4,4,4,2],"solution":[4,2,0,5,1,3],"difficulty":"normal","source":"curated-99"},{"id":36,"size":6,"regions":[0,0,1,2,2,3,0,1,1,1,2,3,0,0,1,3,3,3,0,4,5,5,3,3,0,0,5,5,5,3,0,0,0,0,5,3],"solution":[4,2,5,1,3,0],"difficulty":"normal","source":"curated-99"},{"id":37,"size":7,"regions":[0,0,1,2,3,3,3,0,1,1,2,2,2,3,0,1,1,1,1,2,3,0,1,4,5,5,2,2,0,5,5,5,6,6,2,0,5,0,6,6,2,2,0,0,0,6,6,6,6],"solution":[5,0,4,2,6,1,3],"difficulty":"normal","source":"curated-99"},{"id":38,"size":7,"regions":[0,0,0,0,0,1,1,0,2,0,3,3,3,1,0,2,1,3,4,1,1,2,2,1,4,4,1,1,2,5,1,1,1,1,1,2,5,5,2,2,1,1,2,2,2,2,6,1,1],"solution":[0,5,1,3,6,2,4],"difficulty":"normal","source":"curated-99"},{"id":39,"size":7,"regions":[0,0,0,0,0,0,1,2,2,2,2,2,0,1,2,3,2,0,0,0,1,3,3,4,5,0,1,1,3,4,4,5,5,5,1,3,4,3,3,5,5,1,3,3,3,3,3,3,6],"solution":[0,3,1,5,2,4,6],"difficulty":"normal","source":"curated-99"},{"id":40,"size":7,"regions":[0,0,0,0,0,0,0,0,0,0,0,1,1,0,2,0,2,1,1,1,3,2,4,2,2,5,5,3,2,2,2,2,5,3,3,6,6,2,2,5,3,5,2,2,2,5,5,5,5],"solution":[2,4,6,1,3,0,5],"difficulty":"normal","source":"curated-99"},{"id":41,"size":7,"regions":[0,0,0,0,0,1,1,0,0,1,1,1,1,1,0,0,0,0,1,2,1,0,3,0,4,4,1,1,0,3,3,3,3,5,1,3,3,6,6,5,5,1,3,6,6,6,6,5,5],"solution":[6,0,5,3,1,4,2],"difficulty":"normal","source":"curated-99"},{"id":42,"size":7,"regions":[0,0,1,2,2,2,3,0,0,2,2,4,3,3,0,0,0,2,4,4,3,0,5,2,2,2,3,3,0,5,5,5,5,3,3,0,0,0,6,5,5,3,0,0,0,6,6,5,5],"solution":[2,0,5,3,1,6,4],"difficulty":"normal","source":"curated-99"},{"id":43,"size":7,"regions":[0,0,0,0,0,0,0,0,0,1,2,0,3,3,0,0,1,1,1,1,3,0,1,1,1,1,3,3,0,0,1,1,4,4,4,0,5,1,5,4,6,4,0,5,5,5,4,6,6],"solution":[0,3,6,2,4,1,5],"difficulty":"normal","source":"curated-99"},{"id":44,"size":7,"regions":[0,0,1,1,1,2,2,3,0,0,0,1,1,2,3,3,1,1,1,2,2,4,4,1,5,5,5,2,4,1,1,6,4,5,2,4,4,4,4,4,5,2,5,5,5,5,5,5,5],"solution":[4,2,0,6,3,1,5],"difficulty":"normal","source":"curated-99"},{"id":45,"size":7,"regions":[0,0,0,0,1,1,1,0,0,0,1,1,2,2,0,0,0,0,1,1,2,3,0,4,4,5,1,2,3,3,4,6,2,2,2,3,6,6,6,2,2,2,3,3,3,6,2,2,2],"solution":[5,1,6,4,2,0,3],"difficulty":"hard","source":"curated-99"},{"id":46,"size":7,"regions":[0,1,1,1,1,1,1,0,1,1,1,1,1,1,0,1,1,2,1,1,1,0,1,1,1,3,4,4,5,1,1,1,3,4,4,5,5,5,1,1,6,6,5,5,5,1,1,6,6],"solution":[2,0,3,6,4,1,5],"difficulty":"hard","source":"curated-99"},{"id":47,"size":7,"regions":[0,0,0,0,0,0,0,0,1,2,2,0,3,3,4,1,2,2,0,0,3,4,4,4,2,2,0,3,4,4,5,2,3,0,3,4,4,5,2,3,3,3,5,5,5,6,3,3,3],"solution":[5,1,6,4,2,0,3],"difficulty":"hard","source":"curated-99"},{"id":48,"size":7,"regions":[0,0,0,0,0,0,0,0,0,0,0,0,1,1,2,0,0,0,3,3,1,2,4,4,0,0,0,0,2,2,2,0,0,0,0,2,5,5,0,0,6,0,5,5,5,0,0,0,0],"solution":[3,6,4,2,0,5,1],"difficulty":"hard","source":"curated-99"},{"id":49,"size":7,"regions":[0,0,0,0,0,0,0,0,1,1,1,2,2,0,0,1,1,0,0,0,0,1,1,0,0,3,4,4,1,5,5,5,3,3,3,1,6,5,3,3,5,3,1,5,5,5,5,5,5],"solution":[0,5,2,6,4,1,3],"difficulty":"hard","source":"curated-99"},{"id":50,"size":7,"regions":[0,0,0,1,1,2,2,0,0,0,3,3,2,2,0,0,0,0,3,2,3,0,0,0,0,3,2,3,0,4,0,0,3,5,3,0,4,4,4,3,3,3,6,6,6,4,4,4,4],"solution":[3,6,4,1,5,2,0],"difficulty":"hard","source":"curated-99"},{"id":51,"size":7,"regions":[0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,2,0,0,3,0,0,0,2,0,4,3,0,0,0,0,0,4,3,0,0,5,0,6,4,3,0,0,0,0,6,6,6,0],"solution":[6,0,5,2,4,1,3],"difficulty":"hard","source":"curated-99"},{"id":52,"size":7,"regions":[0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,2,2,0,0,0,3,0,0,0,0,4,0,0,5,6,0,0,4,0,0,5,6,0,0,4,0,0,5,6,0],"solution":[0,2,6,3,5,1,4],"difficulty":"hard","source":"curated-99"},{"id":53,"size":7,"regions":[0,0,0,0,0,0,0,0,0,1,0,2,2,0,0,0,1,0,0,0,0,0,0,0,3,3,0,4,0,0,0,5,3,0,4,0,0,0,5,3,0,0,6,0,0,5,5,0,0],"solution":[1,5,2,4,6,3,0],"difficulty":"hard","source":"curated-99"},{"id":54,"size":7,"regions":[0,1,1,1,1,2,2,0,0,1,1,3,3,2,0,0,1,1,1,2,2,0,0,1,4,4,5,2,0,1,1,1,1,5,2,0,6,2,2,1,2,2,0,6,2,2,2,2,2],"solution":[2,4,0,3,5,1,6],"difficulty":"hard","source":"curated-99"},{"id":55,"size":7,"regions":[0,0,0,1,1,2,2,3,0,1,1,1,2,4,3,0,0,5,1,2,4,3,0,6,5,1,6,4,0,0,6,6,6,6,4,0,4,6,6,6,4,4,4,4,4,4,4,4,4],"solution":[5,2,0,3,1,4,6],"difficulty":"hard","source":"curated-99"},{"id":56,"size":7,"regions":[0,0,0,1,1,1,1,0,0,2,2,2,3,3,0,0,0,4,2,2,3,0,5,5,4,4,2,2,5,5,5,4,6,6,2,5,5,5,6,6,2,2,5,5,5,6,6,2,2],"solution":[5,2,6,0,3,1,4],"difficulty":"hard","source":"curated-99"},{"id":57,"size":8,"regions":[0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,1,2,1,3,4,0,0,0,1,2,3,3,4,4,5,0,1,2,2,3,3,3,5,0,1,2,2,2,6,3,2,7,1,2,6,6,6,6,2,2,2,2,2,2,2,2],"solution":[4,2,5,7,0,6,1,3],"difficulty":"hard","source":"curated-99"},{"id":58,"size":8,"regions":[0,1,2,2,2,3,3,3,0,0,2,2,3,3,3,3,0,2,2,2,3,3,4,4,5,2,3,3,3,6,6,4,5,2,5,5,3,6,6,6,5,5,5,5,5,6,6,6,5,5,5,5,5,6,7,6,5,5,5,5,5,7,7,7],"solution":[1,3,0,7,4,6,2,5],"difficulty":"hard","source":"curated-99"},{"id":59,"size":8,"regions":[0,1,1,1,0,2,2,3,0,0,1,0,0,2,2,2,0,0,0,0,0,4,2,4,0,0,0,4,4,4,4,4,5,0,4,4,4,4,4,4,5,0,0,4,4,4,6,6,5,5,7,7,7,4,6,6,5,5,7,7,7,6,6,6],"solution":[7,2,6,1,4,0,3,5],"difficulty":"hard","source":"curated-99"},{"id":60,"size":8,"regions":[0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,1,3,4,1,1,1,1,2,1,3,4,5,5,1,6,1,1,3,4,5,5,1,1,1,3,3,3,5,5,5,5,7,3,3,3,5,5,5,7,7,7,3,3],"solution":[0,2,4,7,3,6,1,5],"difficulty":"hard","source":"curated-99"},{"id":61,"size":8,"regions":[0,0,0,0,1,1,1,1,0,0,0,0,0,1,1,2,3,0,0,0,4,4,2,2,0,0,0,0,5,4,6,2,0,0,0,5,5,6,6,6,5,5,5,5,5,5,6,6,7,7,7,7,6,6,6,6,7,7,7,7,6,6,6,6],"solution":[4,7,0,5,1,3,6,2],"difficulty":"hard","source":"curated-99"},{"id":62,"size":8,"regions":[0,1,1,2,2,2,2,2,0,0,1,2,2,2,2,3,0,0,0,4,4,2,2,3,4,0,4,4,5,6,6,3,4,4,4,4,5,6,6,6,4,4,4,5,5,6,6,6,4,4,4,5,5,5,6,6,4,4,7,5,5,5,5,6],"solution":[1,5,0,7,3,6,4,2],"difficulty":"hard","source":"curated-99"},{"id":63,"size":8,"regions":[0,0,0,0,0,1,1,1,2,2,0,1,0,1,3,1,2,1,1,1,1,1,3,4,2,1,1,1,3,3,3,4,2,2,2,1,5,3,4,4,2,6,2,1,5,3,3,3,2,6,1,1,5,5,5,5,6,6,6,6,6,6,6,7],"solution":[3,0,2,4,6,1,5,7],"difficulty":"hard","source":"curated-99"},{"id":64,"size":8,"regions":[0,1,1,1,1,1,1,1,0,1,1,0,0,1,2,1,0,0,0,0,0,1,2,1,0,0,3,0,4,1,2,2,0,5,3,3,3,2,2,2,0,5,6,6,7,7,7,2,0,5,6,7,7,7,2,2,5,5,6,6,6,7,7,2],"solution":[7,0,6,4,2,5,1,3],"difficulty":"hard","source":"curated-99"},{"id":65,"size":8,"regions":[0,0,0,1,1,1,1,2,0,3,3,3,3,1,1,1,0,4,4,3,3,3,3,3,0,4,4,4,4,5,5,3,6,6,4,4,4,5,5,5,6,6,4,4,5,5,5,5,6,6,7,7,5,5,5,5,6,7,7,7,5,5,5,5],"solution":[7,5,3,0,4,1,6,2],"difficulty":"hard","source":"curated-99"},{"id":66,"size":8,"regions":[0,1,1,2,2,2,2,2,0,0,0,0,3,2,2,4,0,3,3,3,3,2,2,4,0,0,0,3,3,2,4,4,0,5,0,3,3,3,4,4,0,5,5,5,3,3,3,4,5,6,5,5,7,3,3,4,5,5,5,7,7,3,4,4],"solution":[2,6,0,7,5,3,1,4],"difficulty":"hard","source":"curated-99"},{"id":67,"size":8,"regions":[0,0,0,0,1,1,2,3,0,4,0,1,1,2,2,2,0,4,4,1,1,1,1,2,4,4,1,1,5,1,5,2,4,4,4,1,5,1,5,5,4,5,5,5,5,5,5,6,7,5,7,7,5,5,6,6,7,7,7,7,5,5,5,6],"solution":[7,5,0,3,1,4,6,2],"difficulty":"hard","source":"curated-99"},{"id":68,"size":8,"regions":[0,1,1,1,2,2,2,3,1,1,1,2,2,2,2,3,1,1,1,4,5,4,6,3,1,1,4,4,5,4,6,6,1,1,4,4,4,4,6,6,1,7,4,4,4,6,6,6,7,7,4,7,4,6,6,6,7,7,7,7,6,6,6,6],"solution":[0,5,7,4,1,3,6,2],"difficulty":"hard","source":"curated-99"},{"id":69,"size":8,"regions":[0,1,1,1,2,2,3,3,0,1,1,1,2,2,2,3,1,1,1,2,2,2,2,3,1,1,1,2,2,2,2,2,1,4,4,2,2,2,5,5,4,4,4,2,2,5,5,5,6,4,4,6,6,5,5,5,6,6,6,6,6,5,5,7],"solution":[6,0,2,4,1,5,3,7],"difficulty":"hard","source":"curated-99"},{"id":70,"size":8,"regions":[0,0,0,0,0,1,1,1,2,2,2,3,0,0,1,1,3,2,3,3,0,1,1,1,3,3,3,0,0,4,4,4,3,3,3,3,4,4,4,5,3,6,4,4,4,4,5,5,3,7,7,4,4,4,4,5,7,7,5,5,5,5,5,5],"solution":[5,2,4,6,3,1,7,0],"difficulty":"hard","source":"curated-99"},{"id":71,"size":8,"regions":[0,0,1,1,1,2,2,2,0,3,1,1,1,2,2,2,4,3,1,1,2,2,2,2,3,3,1,1,1,2,2,2,3,3,3,3,2,2,2,5,3,3,3,6,6,2,5,5,3,3,3,3,6,6,6,7,3,3,3,6,6,6,6,7],"solution":[1,3,0,5,2,6,4,7],"difficulty":"hard","source":"curated-99"},{"id":72,"size":8,"regions":[0,0,0,1,1,1,1,1,0,2,0,0,0,0,0,1,0,2,0,3,0,1,0,1,0,2,0,3,0,1,1,1,4,2,3,3,0,3,1,1,4,4,5,3,3,3,6,1,4,5,5,5,3,3,3,3,4,4,5,3,3,7,7,3],"solution":[7,4,1,3,0,6,2,5],"difficulty":"hard","source":"curated-99"},{"id":73,"size":8,"regions":[0,0,1,2,2,2,2,2,3,3,1,2,1,1,1,2,3,1,1,1,1,1,2,2,3,3,3,3,1,1,1,1,3,4,3,3,3,3,1,5,3,4,3,6,6,6,5,5,3,4,4,6,4,6,5,5,7,4,4,4,4,6,6,5],"solution":[1,4,6,3,7,5,2,0],"difficulty":"hard","source":"curated-99"},{"id":74,"size":8,"regions":[0,0,0,0,0,0,1,2,0,3,0,0,2,2,2,2,0,3,0,2,2,2,4,2,0,3,0,2,5,2,4,2,3,3,5,5,5,4,4,4,3,6,5,4,4,4,4,4,3,6,7,4,7,7,7,4,3,7,7,7,7,4,4,4],"solution":[6,2,7,4,0,5,1,3],"difficulty":"hard","source":"curated-99"},{"id":75,"size":8,"regions":[0,0,1,1,2,2,2,2,1,0,1,3,3,3,2,2,1,1,1,3,4,4,4,4,1,1,3,3,3,3,4,4,1,3,3,5,6,3,3,4,1,1,5,5,6,3,6,4,1,7,5,6,6,6,6,5,1,1,5,5,5,5,5,5],"solution":[0,6,2,5,7,4,1,3],"difficulty":"hard","source":"curated-99"},{"id":76,"size":8,"regions":[0,0,1,1,1,1,2,2,0,0,1,1,3,2,2,4,0,0,0,1,3,4,4,4,0,1,1,1,3,3,5,4,0,1,5,5,6,3,5,4,1,1,5,6,6,5,5,4,1,5,5,6,6,5,7,4,1,1,5,5,5,5,4,4],"solution":[0,5,7,4,1,3,6,2],"difficulty":"hard","source":"curated-99"},{"id":77,"size":8,"regions":[0,1,1,1,1,2,2,2,0,3,3,3,3,3,3,2,0,0,0,0,3,3,3,2,0,0,4,3,3,2,2,2,0,0,4,3,5,5,6,2,0,4,4,4,5,5,6,2,0,5,4,4,5,5,6,2,5,5,5,5,5,6,6,7],"solution":[1,3,0,5,2,6,4,7],"difficulty":"hard","source":"curated-99"},{"id":78,"size":8,"regions":[0,0,0,1,1,1,1,1,0,0,0,1,1,1,1,1,2,0,3,1,1,1,1,4,2,3,3,3,4,4,4,4,2,3,5,2,2,2,4,6,2,3,5,2,7,2,2,6,2,3,5,2,7,7,2,6,2,2,2,2,2,7,2,2],"solution":[1,4,0,3,6,2,7,5],"difficulty":"hard","source":"curated-99"},{"id":79,"size":9,"regions":[0,1,1,1,1,1,1,1,1,0,0,2,3,1,4,4,1,1,3,3,3,3,5,5,4,4,1,3,3,5,5,5,5,4,4,1,3,5,5,4,4,4,4,1,1,3,6,4,4,6,4,7,1,1,8,6,6,6,6,4,7,7,1,8,6,8,6,4,4,7,7,1,8,8,8,8,4,4,4,4,4],"solution":[0,2,5,1,6,8,4,7,3],"difficulty":"hard","source":"curated-99"},{"id":80,"size":9,"regions":[0,1,2,2,2,3,3,3,3,0,1,1,1,2,4,3,5,5,1,1,1,6,4,4,3,3,5,1,6,6,6,4,3,3,3,5,1,4,7,6,4,4,3,3,5,1,4,4,4,4,3,3,5,5,1,1,1,8,4,4,4,5,8,1,8,8,8,4,8,5,5,8,1,1,1,8,8,8,8,8,8],"solution":[4,0,3,6,2,7,5,8,1],"difficulty":"hard","source":"curated-99"},{"id":81,"size":9,"regions":[0,0,0,0,0,0,0,0,0,1,0,2,2,2,2,2,2,0,1,0,0,0,0,2,3,2,0,1,0,4,4,0,2,3,0,0,1,1,1,4,4,3,3,3,3,1,1,1,4,3,3,5,5,3,6,6,1,4,4,4,5,3,3,7,6,6,5,4,5,5,8,3,7,7,7,5,5,5,3,3,3],"solution":[4,0,5,3,8,6,1,7,2],"difficulty":"hard","source":"curated-99"},{"id":82,"size":9,"regions":[0,0,0,1,1,2,2,2,2,0,0,0,1,1,3,2,2,2,0,0,0,1,3,3,3,4,4,0,0,0,1,1,3,3,4,4,5,5,5,5,1,3,3,4,4,5,6,6,5,1,1,1,1,1,6,6,6,5,1,1,7,7,1,6,6,6,5,1,7,7,8,1,6,6,6,5,1,1,8,8,1],"solution":[3,6,4,1,8,0,2,5,7],"difficulty":"hard","source":"curated-99"},{"id":83,"size":9,"regions":[0,0,0,0,1,1,1,1,2,3,3,3,1,1,2,2,2,2,3,3,3,1,4,4,2,4,2,3,5,3,3,3,4,4,4,2,5,5,3,5,3,4,6,4,2,5,5,5,5,6,6,6,4,4,5,7,7,5,5,5,6,6,4,7,7,8,4,4,4,6,6,4,8,8,8,8,8,4,4,4,4],"solution":[2,7,3,0,6,8,5,1,4],"difficulty":"hard","source":"curated-99"},{"id":84,"size":9,"regions":[0,0,0,0,0,0,0,0,0,0,0,0,1,2,2,3,3,0,0,1,1,1,1,2,3,3,2,1,1,1,1,2,2,3,2,2,1,1,4,1,2,2,3,2,5,1,1,4,4,4,2,2,2,5,1,4,4,6,2,2,5,7,5,8,8,8,2,2,2,5,7,5,8,5,5,5,5,5,5,5,5],"solution":[4,6,1,5,2,8,3,7,0],"difficulty":"hard","source":"curated-99"},{"id":85,"size":9,"regions":[0,0,0,0,1,1,1,2,3,0,1,1,1,1,3,1,1,3,0,0,0,3,3,3,1,3,3,0,4,5,5,3,1,1,1,3,4,4,4,5,3,3,3,3,3,4,5,5,5,3,3,3,6,3,7,5,5,3,3,6,6,6,3,7,5,5,5,3,6,3,3,3,7,5,6,6,6,6,8,8,3],"solution":[7,4,2,8,1,3,5,0,6],"difficulty":"hard","source":"curated-99"},{"id":86,"size":9,"regions":[0,0,0,0,0,1,1,1,2,0,3,1,1,1,1,4,4,4,3,3,5,5,5,1,4,1,4,3,3,5,1,1,1,1,1,1,3,5,5,5,5,1,5,6,1,5,5,5,5,5,5,5,6,6,5,7,7,7,7,5,8,6,8,5,8,5,5,5,5,8,6,8,5,8,8,8,8,8,8,8,8],"solution":[8,0,6,1,5,2,4,7,3],"difficulty":"hard","source":"curated-99"},{"id":87,"size":9,"regions":[0,0,1,1,1,1,1,1,1,0,1,1,2,2,2,1,1,3,0,0,0,2,2,1,1,1,3,0,0,0,3,2,2,1,1,3,4,4,5,3,3,3,3,3,3,4,3,3,3,6,6,7,7,3,6,6,8,8,6,7,7,6,3,6,8,8,6,6,6,7,6,3,6,6,6,6,6,6,6,6,3],"solution":[7,5,1,8,2,0,3,6,4],"difficulty":"hard","source":"curated-99"},{"id":88,"size":9,"regions":[0,0,0,1,1,1,1,1,1,0,2,2,2,1,3,3,3,1,0,2,4,4,4,4,3,1,1,0,2,4,3,3,3,3,3,1,0,2,4,4,4,3,5,5,1,0,2,2,2,4,4,6,5,5,2,2,2,4,4,7,7,7,5,2,8,8,8,8,7,5,5,5,2,2,2,2,8,8,8,8,8],"solution":[3,0,2,4,1,6,8,5,7],"difficulty":"hard","source":"curated-99"},{"id":89,"size":9,"regions":[0,1,1,1,1,1,1,1,2,0,0,0,0,0,0,0,1,2,0,3,3,3,3,3,0,1,2,0,3,3,4,5,3,0,1,2,0,4,4,4,6,3,6,1,2,0,4,4,0,6,6,6,2,2,0,4,0,0,0,0,2,2,7,0,4,4,0,8,8,8,8,7,0,0,0,0,0,0,0,8,7],"solution":[3,0,2,4,6,1,7,5,8],"difficulty":"hard","source":"curated-99"},{"id":90,"size":9,"regions":[0,0,1,2,2,2,3,3,3,0,1,1,2,1,2,3,4,3,0,1,1,1,1,2,2,4,3,0,1,2,2,2,2,3,3,3,1,1,1,2,5,2,5,3,3,5,5,1,2,5,5,5,5,3,6,5,5,5,5,5,3,5,3,6,6,6,6,7,3,3,3,3,6,6,7,7,7,8,8,3,3],"solution":[1,7,2,8,3,5,0,4,6],"difficulty":"hard","source":"curated-99"},{"id":91,"size":9,"regions":[0,1,2,2,2,0,0,0,0,0,1,2,0,2,2,2,2,0,0,1,2,0,0,0,0,0,0,0,0,0,0,0,3,3,3,0,4,4,5,5,0,6,3,3,0,7,4,7,5,6,6,3,0,0,7,4,7,6,6,6,3,3,3,7,4,7,8,8,6,6,6,3,7,7,7,7,8,8,6,3,3],"solution":[8,6,1,7,0,3,5,2,4],"difficulty":"hard","source":"curated-99"},{"id":92,"size":9,"regions":[0,0,0,0,1,1,1,1,1,0,2,2,2,1,3,3,3,1,0,2,1,1,1,1,4,3,5,0,0,0,0,1,4,4,3,5,0,6,6,0,1,1,4,3,4,0,0,6,0,0,4,4,3,4,0,6,6,6,0,0,4,7,4,6,6,8,6,6,8,4,4,4,8,8,8,8,8,8,8,8,8],"solution":[4,6,1,8,3,5,7,0,2],"difficulty":"hard","source":"curated-99"},{"id":93,"size":9,"regions":[0,0,0,0,0,0,0,1,1,2,2,3,0,3,3,0,1,1,2,3,3,3,3,0,0,1,1,2,2,4,3,3,3,0,0,1,5,3,4,4,3,0,0,1,1,5,3,4,3,3,0,0,1,1,3,3,3,3,6,0,7,7,1,8,8,8,3,7,7,7,1,1,3,3,3,3,3,3,7,7,1],"solution":[6,1,8,5,3,0,4,2,7],"difficulty":"hard","source":"curated-99"},{"id":94,"size":9,"regions":[0,0,0,0,0,1,1,2,2,0,1,1,1,1,1,3,3,2,0,0,0,1,1,2,2,3,2,0,1,1,1,2,2,2,2,2,0,4,4,1,1,1,1,5,2,0,0,4,4,1,4,1,1,2,0,6,6,4,4,4,2,2,2,0,6,4,4,4,7,7,2,7,6,6,8,8,8,8,7,7,7],"solution":[8,6,4,0,7,3,1,5,2],"difficulty":"hard","source":"curated-99"},{"id":95,"size":9,"regions":[0,0,0,0,1,1,2,1,1,0,0,3,4,4,1,1,1,1,3,3,3,3,4,1,1,4,1,3,5,5,3,4,4,4,4,1,3,3,6,6,6,6,4,4,4,3,6,6,7,7,6,6,6,4,3,6,6,7,7,8,6,6,4,3,6,6,6,7,8,4,4,4,3,7,7,7,7,7,7,7,7],"solution":[6,1,8,2,4,0,5,7,3],"difficulty":"hard","source":"curated-99"},{"id":96,"size":9,"regions":[0,1,2,2,2,2,2,2,2,0,1,1,2,3,2,4,4,2,0,5,5,2,3,2,2,4,2,5,5,5,3,3,3,3,4,2,6,5,3,3,6,6,3,4,2,6,6,6,6,6,2,3,4,2,6,6,7,2,2,2,2,2,2,6,6,7,7,2,8,8,8,2,6,6,6,6,2,2,8,2,2],"solution":[0,2,7,5,1,4,8,3,6],"difficulty":"hard","source":"curated-99"},{"id":97,"size":9,"regions":[0,0,0,1,1,1,1,1,1,0,2,0,1,3,3,3,1,4,0,2,0,0,5,5,1,1,4,2,2,2,0,5,5,1,4,4,2,6,0,0,0,5,1,0,4,2,6,0,7,7,5,1,0,4,2,6,0,7,7,5,1,0,4,2,6,0,8,8,5,0,0,4,2,0,0,0,0,0,0,0,4],"solution":[8,6,2,7,5,3,1,4,0],"difficulty":"hard","source":"curated-99"},{"id":98,"size":9,"regions":[0,0,0,0,0,1,1,1,1,2,2,2,2,0,0,0,0,1,2,3,0,0,0,1,1,1,1,3,3,3,3,0,1,4,4,1,3,5,5,5,1,1,4,4,1,3,6,6,5,5,5,5,4,1,3,6,5,5,4,4,4,4,4,3,6,7,5,5,5,7,7,4,8,7,7,7,7,7,7,4,4],"solution":[4,2,8,3,7,5,1,6,0],"difficulty":"hard","source":"curated-99"},{"id":99,"size":9,"regions":[0,0,1,2,2,2,2,2,3,4,4,1,1,2,5,2,3,3,4,6,6,6,2,5,2,3,3,4,6,2,2,2,5,3,3,3,4,4,4,2,7,5,5,5,3,4,4,4,2,7,3,3,3,3,4,8,4,7,7,7,7,7,3,4,8,4,8,7,3,7,3,3,8,8,8,8,8,3,3,3,3],"solution":[0,3,6,1,7,2,5,8,4],"difficulty":"hard","source":"curated-99"}];

},
"home-flow":function(module,exports,require){
'use strict';

function createHomeFlow({ ctx, width, height, getGrid, getMask, createCanvas, now = Date.now }) {
  const pixelWidth = Math.ceil(width), pixelHeight = Math.ceil(height), ratio = width / 1080;
  const spriteWidth = 1092 * 1.02 * ratio, spriteHeight = 2356 * 1.02 * ratio;
  const left = (width - spriteWidth) / 2, top = 1197 * ratio - spriteHeight / 2;
  let state = null, failed = null;

  function initialize(grid, mask) {
    const canvas = createCanvas(pixelWidth, pixelHeight);
    function read(image) {
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, image.width, image.height); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    }
    // 两张源图仅读取一次；每帧只写离屏画布，主画布不读回像素。
    const gridData = read(grid), maskData = read(mask);
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    const context = canvas.getContext('2d'), output = context.createImageData(pixelWidth, pixelHeight);
    const maskAlpha = new Float32Array(pixelWidth * pixelHeight), us = [], vs = [];
    for (let x = 0; x < pixelWidth; x++) us[x] = (x + .5 - left) / spriteWidth;
    for (let y = 0; y < pixelHeight; y++) {
      const v = vs[y] = (y + .5 - top) / spriteHeight;
      for (let x = 0; x < pixelWidth; x++) {
        const u = us[x], index = y * pixelWidth + x;
        if (u < 0 || u > 1 || v < 0 || v > 1) { maskAlpha[index] = -1; continue; }
        const mx = Math.max(0, Math.min(mask.width - 1, u * mask.width - .5));
        const my = Math.max(0, Math.min(mask.height - 1, v * mask.height - .5));
        const x0 = Math.floor(mx), y0 = Math.floor(my), x1 = Math.min(x0 + 1, mask.width - 1), y1 = Math.min(y0 + 1, mask.height - 1);
        const fx = mx - x0, fy = my - y0;
        maskAlpha[index] = (maskData[(y0 * mask.width + x0) * 4 + 3] * (1 - fx) + maskData[(y0 * mask.width + x1) * 4 + 3] * fx) * (1 - fy)
          + (maskData[(y1 * mask.width + x0) * 4 + 3] * (1 - fx) + maskData[(y1 * mask.width + x1) * 4 + 3] * fx) * fy;
      }
    }
    return { grid, mask, canvas, context, output, gridData, maskAlpha, us, vs, lastTime: -Infinity };
  }

  function draw(time = now()) {
    const grid = getGrid && getGrid(), mask = getMask && getMask();
    if (!grid || !mask || !createCanvas || !(width > 0 && height > 0)) return false;
    if (state && (state.grid !== grid || state.mask !== mask)) { state = null; failed = null; return false; }
    if (failed && failed[0] === grid && failed[1] === mask) return false;
    try {
      if (!state) state = initialize(grid, mask);
      if (time - state.lastTime >= 100 || time < state.lastTime) {
        const { gridData, maskAlpha, us, vs, output } = state, pixels = output.data;
        const phase = (time % (1000 / .015)) * .015 / 1000, gw = grid.width, gh = grid.height;
        pixels.fill(0);
        for (let y = 0; y < pixelHeight; y++) {
          const gy = ((vs[y] - phase) % 1 + 1) % 1 * gh - .5, yFloor = Math.floor(gy);
          const y0 = (yFloor + gh) % gh, y1 = (y0 + 1) % gh, fy = gy - yFloor;
          for (let x = 0; x < pixelWidth; x++) {
            const index = y * pixelWidth + x, ma = maskAlpha[index];
            if (ma < 0) continue;
            const gx = ((us[x] + phase) % 1 + 1) % 1 * gw - .5, xFloor = Math.floor(gx);
            const x0 = (xFloor + gw) % gw, x1 = (x0 + 1) % gw, fx = gx - xFloor;
            const t0 = (y0 * gw + x0) * 4, t1 = (y0 * gw + x1) * 4, t2 = (y1 * gw + x0) * 4, t3 = (y1 * gw + x1) * 4;
            const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
            const alpha = Math.max(0, gridData[t0 + 3] * w0 + gridData[t1 + 3] * w1 + gridData[t2 + 3] * w2 + gridData[t3 + 3] * w3 - ma) * .2;
            if (alpha < 255 * .00025) continue;
            const target = index * 4;
            for (let channel = 0; channel < 3; channel++) pixels[target + channel] = gridData[t0 + channel] * w0 + gridData[t1 + channel] * w1 + gridData[t2 + channel] * w2 + gridData[t3 + channel] * w3;
            if (Math.max(pixels[target], pixels[target + 1], pixels[target + 2]) <= .255) continue;
            // 原shader是透明度相减；destination-out的相乘会改变半透明边缘。
            pixels[target + 3] = alpha;
          }
        }
        state.context.putImageData(output, 0, 0); state.lastTime = time;
      }
      ctx.drawImage(state.canvas, 0, 0, width, height);
      return true;
    } catch (_) {
      state = null; failed = [grid, mask]; return false;
    }
  }
  return { draw };
}

module.exports = { createHomeFlow };

},
"art":function(module,exports,require){
'use strict';
const spriteFrames = require('./sprite-frames.js');
const originalUI = require('./ui-frames.js');
const originalCats = require('./cat-frames.js');

// 图集按需分包加载；未就绪时使用Canvas绘制和备用动物图。
function createArt(ctx, box, text, getAtlas, getExpressions, getOriginalUI, getOriginalCats) {
  const frames = { cat: 0, corgi: 9, rabbit: 10, panda: 11, lion: 12, crocodile: 13, duck: 14, calico: 15 };
  function sprite(name, cx, cy, maxWidth, maxHeight) {
    const bitmap = getOriginalUI && getOriginalUI(), frame = originalUI.frames[name];
    if (!bitmap || !frame) return false;
    const [sx, sy, sw, sh] = frame, scale = Math.min(maxWidth / sw, (maxHeight === undefined ? maxWidth : maxHeight) / sh);
    ctx.drawImage(bitmap, sx, sy, sw, sh, cx - sw * scale / 2, cy - sh * scale / 2, sw * scale, sh * scale);
    return true;
  }
  function drawAnimal(bitmap, collection, index, cx, cy, size) {
    const [sx, sy, sw, sh, ax, ay] = collection.frames[index];
    const extent = 2 * Math.max(ax - sx, sx + sw - ax, ay - sy, sy + sh - ay);
    const scale = size / Math.max(collection.nominalSize, extent);
    const dx = cx + (sx - ax) * scale, dy = cy + (sy - ay) * scale;
    const holes = collection.holes[index];
    if (holes) {
      // 两个帧的相邻毛边只占一像素条，用反向路径扣除，不裁掉自己的耳尖。
      ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, sw * scale, sh * scale);
      holes.forEach(([x, y, width, height]) => {
        const hx = cx + (x - ax) * scale, hy = cy + (y - ay) * scale, hw = width * scale, hh = height * scale;
        ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + hh); ctx.lineTo(hx + hw, hy + hh); ctx.lineTo(hx + hw, hy); ctx.closePath();
      }); ctx.clip();
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
    if (holes) ctx.restore();
  }
  function animal(cx, cy, size, id, expression) {
    const original = id === 'cat' && getOriginalCats && getOriginalCats();
    if (original) {
      drawAnimal(original, originalCats, ((expression || 0) % 9 + 9) % 9, cx, cy, size); return;
    }
    const expanded = getExpressions && getExpressions(), row = ['calico', 'panda', 'rabbit', 'corgi', 'lion', 'crocodile', 'duck'].indexOf(id);
    if (expanded && row >= 0) {
      const col = ((expression || 0) % 9 + 9) % 9;
      drawAnimal(expanded, spriteFrames.expanded, row * 9 + col, cx, cy, size); return;
    }
    const atlas = getAtlas(), frame = id === 'cat' ? ((expression || 0) % 9 + 9) % 9 : frames[id] || 0;
    if (atlas) {
      drawAnimal(atlas, spriteFrames.primary, frame, cx, cy, size);
    } else text(id === 'cat' ? '🐱' : id === 'rabbit' ? '🐰' : id === 'panda' ? '🐼' : id === 'lion' ? '🦁' : '🐾', cx, cy, size * .7, '#935A5A', 'center');
  }
  function silhouette(x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40); ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-18, -5); ctx.lineTo(-18, -19); ctx.quadraticCurveTo(-16, -24, -7, -13); ctx.lineTo(7, -13); ctx.quadraticCurveTo(16, -24, 18, -19); ctx.lineTo(18, -5); ctx.bezierCurveTo(23, 15, 11, 20, 0, 20); ctx.bezierCurveTo(-11, 20, -23, 15, -18, -5); ctx.fill(); ctx.restore();
  }
  function icon(name, x, y, size, color) {
    // 工具调用传入圆直径的55%，原灯泡框占圆直径的106/210。
    if (name === 'bulb' && sprite('icon_hint_lamp', x, y, size * 67 / (210 * .55), size * 106 / (210 * .55))) return;
    if (name === 'gift' && sprite('treasure_box', x, y, size, size)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40); ctx.strokeStyle = color || '#935A5A'; ctx.fillStyle = color || '#935A5A'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (name === 'back') { ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-12, 0); ctx.moveTo(-3, -10); ctx.lineTo(-13, 0); ctx.lineTo(-3, 10); ctx.stroke(); }
    if (name === 'close') { ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke(); }
    if (name === 'settings') { for (let k = 0; k < 8; k++) { ctx.save(); ctx.rotate(k * Math.PI / 4); ctx.fillRect(-3.5, -19, 7, 10); ctx.restore(); } ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
    if (name === 'lock') { ctx.beginPath(); ctx.arc(0, -6, 7, Math.PI, 0); ctx.lineTo(7, 1); ctx.moveTo(-7, -6); ctx.lineTo(-7, 1); ctx.stroke(); box(-11, 0, 22, 18, color || '#935A5A', 4); ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(0, 6, 2, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-1, 6, 2, 7); }
    if (name === 'check') { ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-3, 8); ctx.lineTo(12, -9); ctx.stroke(); }
    if (name === 'edit') { ctx.rotate(.6); ctx.fillRect(-4, -14, 8, 23); ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(4, 12); ctx.lineTo(0, 19); ctx.fill(); }
    if (name === 'music') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-5, -12); ctx.lineTo(12, -16); ctx.lineTo(12, 6); ctx.stroke(); ctx.beginPath(); ctx.ellipse(-10, 11, 7, 5, -.4, 0, Math.PI * 2); ctx.ellipse(7, 7, 7, 5, -.4, 0, Math.PI * 2); ctx.fill(); }
    if (name === 'sound') { ctx.beginPath(); ctx.moveTo(-14, -7); ctx.lineTo(-6, -7); ctx.lineTo(5, -15); ctx.lineTo(5, 15); ctx.lineTo(-6, 7); ctx.lineTo(-14, 7); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(3, 0, 15, -.8, .8); ctx.stroke(); }
    if (name === 'vibrate') { box(-7, -15, 14, 30, color || '#935A5A', 3); ctx.fillStyle = '#FFF'; ctx.fillRect(-4, -12, 8, 21); [-1, 1].forEach(sign => { ctx.beginPath(); ctx.moveTo(sign * 13, -9); ctx.quadraticCurveTo(sign * 19, 0, sign * 13, 9); ctx.stroke(); }); }
    if (name === 'bulb') { const g = ctx.createRadialGradient(-5, -9, 1, 0, -4, 17); if (g) { g.addColorStop(0, '#FFFCC4'); g.addColorStop(.4, '#FFD84B'); g.addColorStop(1, '#F8B800'); } ctx.fillStyle = g || '#FFD84B'; ctx.beginPath(); ctx.ellipse(0, -6, 13, 16, 0, 0, Math.PI * 2); ctx.fill(); box(-6, 6, 12, 9, '#FFCE23', 3); box(-6, 14, 12, 8, '#9071B3', 3); ctx.strokeStyle = '#6F598D'; ctx.lineWidth = 1.5; [-1, 2, 5].forEach(v => { ctx.beginPath(); ctx.moveTo(-5, 17 + v); ctx.lineTo(5, 17 + v); ctx.stroke(); }); }
    if (name === 'gift') { box(-15, -3, 30, 24, '#FFC92B', 4); box(-17, -8, 34, 9, '#FFD653', 3); ctx.fillStyle = '#EF6952'; ctx.fillRect(-3, -8, 6, 29); ctx.beginPath(); ctx.ellipse(-7, -13, 8, 4, .6, 0, Math.PI * 2); ctx.ellipse(7, -13, 8, 4, -.6, 0, Math.PI * 2); ctx.strokeStyle = '#E86649'; ctx.lineWidth = 5; ctx.stroke(); }
    ctx.restore();
  }
  function yarn(x, y, size, faded) {
    // 维持已有毛线球视觉边界：顶y-.94size，底y+.5size。
    if (sprite(faded ? 'wool_unchecked' : 'wool_checked', x, y - size * .22, size, size * 1.44)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 80, size / 80); if (faded) ctx.globalAlpha = .2;
    [[-12, -32, -.4, '#FFD52B'], [14, -27, .5, '#3BB8B5']].forEach(v => { ctx.save(); ctx.translate(v[0], v[1]); ctx.rotate(v[2]); ctx.fillStyle = v[3]; ctx.beginPath(); ctx.ellipse(0, -17, 10, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = v[3]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 0); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -42); ctx.stroke(); ctx.restore(); });
    const g = ctx.createRadialGradient(-9, -1, 2, 0, 13, 29); if (g) { g.addColorStop(0, '#FFC348'); g.addColorStop(1, '#EE8422'); } ctx.fillStyle = g || '#F5A32A'; ctx.beginPath(); ctx.arc(0, 14, 26, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#FFB447'; ctx.lineWidth = 5;
    // 毛线弧限制在球体内，避免叠加椭圆把圆形边缘挤成不规则块。
    ctx.save(); ctx.beginPath(); ctx.arc(0, 14, 26, 0, Math.PI * 2); ctx.clip();
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath(); ctx.moveTo(-32, 14 + k * 8); ctx.bezierCurveTo(-12, -1 + k * 8, 12, 29 + k * 8, 32, 14 + k * 8);
      ctx.strokeStyle = 'rgba(170,91,13,.25)'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#FFBA48'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore(); box(-7, -14, 14, 6, '#F5A32A', 3); ctx.restore();
  }
  function pattern(kind, x, y, size) {
    const index = ((kind % originalUI.patterns.length) + originalUI.patterns.length) % originalUI.patterns.length;
    if (sprite(originalUI.patterns[index], x, y, size, size)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100); ctx.globalAlpha *= .11; ctx.strokeStyle = '#344C43'; ctx.fillStyle = '#344C43'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    switch (kind % 6) {
      case 0: ctx.rotate(-.6); ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); [-10, 2, 14].forEach(v => { ctx.moveTo(v, -12); ctx.lineTo(v, 12); }); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-22, -16); ctx.quadraticCurveTo(-45, 0, -22, 16); ctx.closePath(); ctx.moveTo(22, 0); ctx.lineTo(37, -12); ctx.lineTo(37, 12); ctx.closePath(); ctx.fill(); break;
      case 1: ctx.beginPath(); ctx.arc(0, -24, 7, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-25, 16); ctx.quadraticCurveTo(-23, -19, 0, -20); ctx.quadraticCurveTo(23, -19, 25, 16); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 22, 8, 0, Math.PI * 2); ctx.fill(); break;
      case 2: [-23, 0, 23].forEach(a => [-23, 0, 23].forEach(b => { ctx.beginPath(); ctx.moveTo(a, b - 9); ctx.quadraticCurveTo(a + 2, b - 2, a + 9, b); ctx.quadraticCurveTo(a + 2, b + 2, a, b + 9); ctx.quadraticCurveTo(a - 2, b + 2, a - 9, b); ctx.quadraticCurveTo(a - 2, b - 2, a, b - 9); ctx.fill(); })); break;
      case 3: [[-22, -10], [-9, -24], [11, -24], [25, -9]].forEach(v => { ctx.beginPath(); ctx.ellipse(v[0], v[1], 8, 10, 0, 0, Math.PI * 2); ctx.fill(); }); ctx.beginPath(); ctx.ellipse(0, 16, 24, 18, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 4: [-16, 0, 16].forEach(v => { ctx.beginPath(); ctx.moveTo(v - 10, 24); ctx.quadraticCurveTo(v, -6, v + 18, -25); ctx.stroke(); }); break;
      default: ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke(); [-10, 3, 16].forEach(v => { ctx.beginPath(); ctx.ellipse(0, 0, 29, 11, v / 13, 0, Math.PI * 2); ctx.stroke(); });
    }
    ctx.restore();
  }
  return { animal, silhouette, icon, yarn, pattern, sprite };
}
module.exports = { createArt };

},
"tutorial":function(module,exports,require){
'use strict';

// 独立教学状态机；只保留本模块的猫和叉，不读取或写入正式关卡存档。
function createTutorial(options) {
  const { p, ctx, w, top, bottom, helpers, onDone, onExit, onSound = () => {} } = options;
  const { box, text, wrap, button, drawBoard, getBoard } = helpers;
  const level = {
    id: 0, size: 4, regions: [0, 1, 2, 1, 0, 1, 1, 1, 0, 0, 3, 1, 0, 3, 3, 1],
    solution: [2, 0, 3, 1], colorMap: ['#38A9C0', '#FA9D5C', '#8BD57D', '#D36F8F']
  };
  const targets = { 1: [2], 3: [0, 1, 3, 6, 10, 14], 4: [13], 5: [8, 9, 12], 6: [4] };
  const messages = [
    '', '轻点两次亮起的格子，找到第一只猫。', '每个颜色区域只能有一只猫，记住了吗？',
    '猫所在行和列不能再有猫。点击或滑动，把亮起的格子打叉。',
    '粉色区域只剩这一格，轻点两次放猫。', '继续排除邻近格。点击或滑动，把亮起的格子打叉。',
    '蓝色区域只剩这一格，轻点两次放猫。', '最后一只交给你！每行、每列、每色一只，猫之间不能紧挨着。'
  ];
  let phase = 1, cats = [], marks = [], completed = false, active = false, gesture = null, lastTap = null;

  function start() {
    phase = 1;
    cats = [];
    marks = [];
    completed = false;
    active = true;
    gesture = null;
    lastTap = null;
  }
  function cancel() {
    if (gesture && gesture.before) { marks = gesture.before; phase = gesture.phase; }
    gesture = null; lastTap = null;
  }
  function allowed(cell, stage) {
    return cell >= 0 && !cats.includes(cell) && (stage === 7 || (targets[stage] || []).includes(cell));
  }
  function cellAt(x, y) {
    const b = getBoard();
    if (!b || x < b.x || y < b.y || x >= b.x + b.size || y >= b.y + b.size) return -1;
    return Math.floor((y - b.y) / b.cell) * 4 + Math.floor((x - b.x) / b.cell);
  }
  function inside(b, x, y) { return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height; }
  function mark(cell, value, stage) {
    if (!allowed(cell, stage)) return;
    const before = marks.includes(cell);
    if (value && !marks.includes(cell)) marks.push(cell);
    if (!value && stage === 7) marks = marks.filter(c => c !== cell);
    if (before !== marks.includes(cell)) onSound(value ? 'mark' : 'unmark');
  }
  function advanceMarks(stage) {
    if (phase === stage && (stage === 3 || stage === 5) && targets[stage].every(cell => marks.includes(cell))) {
      phase++; lastTap = null;
    }
  }
  function place(cell) {
    cats.push(cell); marks = marks.filter(c => c !== cell); lastTap = null;
    onSound('correct');
    if (phase === 7) { completed = true; active = false; if (onDone) onDone(); }
    else phase++;
  }

  function render() {
    const compact = bottom - top < 540, y = top + (compact ? 113 : 141);
    const size = Math.min(w * 919 / 1080, bottom - y - 72), x = (w - size) / 2;
    text('找猫入门', w / 2, top + 18, 19, '#935A5A', 'center', true);
    button('跳过教学', w - 94, top + 2, 80, 32, () => { cancel(); active = false; if (onExit) onExit(); });
    text('第 ' + phase + ' 步 / 7', 20, top + 51, 11, '#A19189');
    const panelY = top + 64, panelH = compact ? 43 : 67;
    box(18, panelY, w - 36, panelH, '#FFFBF7', 12, '#E6D7D0');
    wrap(messages[phase], 30, panelY + 15, w - 60, compact ? 11 : 13, '#935A5A', compact ? 14 : 19);
    drawBoard(level, cats, marks, [], x, y, size, true);
    const b = getBoard(), focus = targets[phase] || [];
    if (b && focus.length) {
      for (let cell = 0; cell < 16; cell++) {
        if (focus.includes(cell) || cats.includes(cell)) continue;
        ctx.fillStyle = 'rgba(0,0,0,.43)';
        ctx.fillRect(b.x + cell % 4 * b.cell, b.y + Math.floor(cell / 4) * b.cell, b.cell, b.cell);
      }
      focus.forEach(cell => {
        ctx.strokeStyle = '#FFF8DF'; ctx.lineWidth = 2;
        ctx.strokeRect(b.x + cell % 4 * b.cell + 3, b.y + Math.floor(cell / 4) * b.cell + 3, b.cell - 6, b.cell - 6);
      });
      const target = focus.find(cell => !marks.includes(cell)) === undefined ? focus[0] : focus.find(cell => !marks.includes(cell));
      const hx = b.x + (target % 4 + .67) * b.cell, hy = b.y + (Math.floor(target / 4) + .65) * b.cell;
      const pulse = 1 + Math.sin(p.now() / 250) * .04;
      ctx.save(); ctx.translate(hx, hy); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#FFF4E6'; ctx.strokeStyle = '#B78F77'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-5, 17); ctx.lineTo(-5, -6); ctx.quadraticCurveTo(0, -12, 5, -6);
      ctx.lineTo(5, 5); ctx.lineTo(17, 9); ctx.lineTo(15, 27); ctx.lineTo(0, 28); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (phase === 2) {
      button('明白了', 26, y + size + 16, w - 52, 42, () => { phase = 3; cancel(); }, 'primary');
    } else {
      text(phase === 3 || phase === 5 ? '已打叉的格子不能擦除，试着滑动吧' : phase === 7 ? '练习阶段不会消耗机会' : '第一下不会打叉，第二次松手才放猫', w / 2, y + size + 27, 11, '#A19189', 'center');
    }
  }

  function pointer(event, buttons) {
    if (!active || completed) return;
    const cell = cellAt(event.x, event.y), time = Number.isFinite(event.time) ? event.time : p.now();
    if (event.type === 'cancel') { cancel(); return; }
    if (event.type === 'down') {
      const hit = (buttons || []).find(b => inside(b, event.x, event.y));
      if (hit) { lastTap = null; gesture = { button: hit }; return; }
      if (phase === 2 || !allowed(cell, phase)) { gesture = null; lastTap = null; return; }
      gesture = { cell, phase, before: marks.slice(), value: phase === 7 ? !marks.includes(cell) : true, moved: false, x: event.x, y: event.y };
      return;
    }
    if (!gesture) return;
    if (event.type === 'move' && gesture.before) {
      const g = gesture;
      if (cell !== g.cell) g.moved = true;
      if ((g.phase !== 3 && g.phase !== 5 && g.phase !== 7) || g.phase !== phase) return;
      const b = getBoard(), dx = event.x - g.x, dy = event.y - g.y;
      const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (b.cell / 3)));
      // 只修改经过的允许格；被限制格、猫和棋盘外均跳过。
      for (let k = 0; k <= count; k++) {
        const passed = cellAt(g.x + dx * k / count, g.y + dy * k / count);
        mark(passed, g.value, g.phase);
      }
      g.x = event.x; g.y = event.y; advanceMarks(g.phase); lastTap = null;
      return;
    }
    if (event.type !== 'up') return;
    const g = gesture; gesture = null;
    if (g.button) {
      if (inside(g.button, event.x, event.y) && typeof g.button.action === 'function') { onSound('click'); g.button.action(); }
      return;
    }
    if (g.phase !== phase) return;
    if (g.moved) { lastTap = null; advanceMarks(g.phase); return; }
    if (cell !== g.cell) { lastTap = null; return; }
    const catStep = phase === 1 || phase === 4 || phase === 6 || phase === 7 && cell === 11;
    if (catStep) {
      // 教学窗口从第一次松手开始，第二次松手在 350 毫秒内才提交。
      const gap = lastTap ? time - lastTap.time : Infinity;
      if (lastTap && lastTap.cell === cell && gap >= 0 && gap <= 350) place(cell);
      else lastTap = { cell, time };
    } else {
      mark(cell, g.value, phase); lastTap = null; advanceMarks(phase);
    }
  }

  return {
    start, render, pointer, cancel,
    getState: () => ({
      phase,
      cats: cats.slice(),
      marks: marks.slice(),
      completed,
      screen: 'tutorial',
      levelId: 0,
      size: 4,
      hearts: 3,
      board: getBoard()
    })
  };
}

module.exports = { createTutorial };

},
"game":function(module,exports,require){
'use strict';

const { createPlatform } = require('./platform.js');
const logic = require('./logic.js');
const legacyLevels = require('./levels.js');
const { createTutorial } = require('./tutorial.js');
const progress = require('./progression.js');
const { createAudio } = require('./audio.js');
const { createArt } = require('./art.js');
const { createInputUI } = require('./input-ui.js');
const { createGardenArt } = require('./garden-art.js');
const { createHomeFlow } = require('./home-flow.js');
const { createCosmeticArt } = require('./cosmetic-art.js');

// 棋盘默认色板。
const COLORS = ['#E8BC45', '#AED68F', '#69BBDD', '#F7B7CF', '#5D78AF', '#F8A569', '#4AB2B1', '#92CBB3', '#C0B7DD', '#E4C56C', '#8FAFD1', '#BC987F'];
const INK = '#935A5A', MUTED = '#89756A';
const DIFFICULTY = { easy: '轻松', normal: '进阶', hard: '挑战' };
const KEY = 'miaoge-home-v1';

function cleanRecords(input, dailyRecords, levelCount) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  Object.keys(input).forEach(key => {
    const record = input[key];
    const validKey = dailyRecords ? /^\d{4}-\d{2}-\d{2}$/.test(key) : Number.isInteger(Number(key)) && Number(key) >= 1 && Number(key) <= levelCount;
    if (validKey && record && Number.isFinite(record.time) && record.time >= 0 && Number.isInteger(record.hints) && record.hints >= 0) {
      out[key] = { time: record.time, hints: record.hints };
      ['locates', 'steps', 'revives'].forEach(k => { if (Number.isInteger(record[k]) && record[k] >= 0) out[key][k] = record[k]; });
      if (Number.isSafeInteger(record.score) && record.score >= 0) out[key].score = record.score;
    }
  });
  return out;
}

// Canvas 绘制界面；微信排行榜通过开放数据域处理好友数据。
function startGame(options) {
  options = options || {};
  const p = options.platform || createPlatform(options), ctx = p.ctx;
  const w = p.width, h = p.height, top = p.safeTop + 14, bottom = h - p.safeBottom - 16;
  const levels = options.levels || legacyLevels;
  let screen = 'home', returnScreen = 'home', selectedPage = 0, level = levels[0], daily = false, dailyDate = '';
  let cats = [], marks = [], errors = [], hearts = 3, hints = 0, steps = 0, locates = 0, revives = 0, elapsed = 0, anchor = null;
  let score = 0, combo = 0, manual = 0, assisted = 0, resultScore = null, clearReward = null, checkinReward = null;
  let profileTab = 'avatar', wardrobeTab = 'animal', wardrobePage = 0, toast = '', toastUntil = 0;
  let history = [], buttons = [], board = null, uiLayout = null, gesture = null, lastTap = null, nextGame = null;
  let message = '', highlighted = -1, pendingHint = null, feedback = null, failOpenedAt = 0, winOpenedAt = 0, dirty = true, hidden = false, hiddenAt = 0, stopped = false, shownSecond = -1;
  const ranking = p.ranking;
  let rankStatus = 'idle', rankReturn = 'home', rankRequest = 0, rankGranted = false, lastSubmittedScore = '';
  let privacyPrompt = null, privacyLinkError = '';
  if (ranking && ranking.onPrivacyRequest) ranking.onPrivacyRequest(prompt => { privacyPrompt = prompt; privacyLinkError = ''; notify(); });
  const stored = p.storage.get(KEY);
  const dateKey = () => new Date(p.now() + 8 * 3600000).toISOString().slice(0, 10);
  const data = {
    unlocked: stored && Number.isInteger(stored.unlocked) ? Math.max(1, Math.min(levels.length, stored.unlocked)) : 1,
    completed: cleanRecords(stored && stored.completed, false, levels.length),
    daily: cleanRecords(stored && stored.daily, true),
    tutorialDone: Boolean(stored && stored.tutorialDone),
    settings: {
      vibrate: stored && stored.settings && typeof stored.settings.vibrate === 'boolean' ? stored.settings.vibrate : true
    },
    session: stored && stored.session,
    feedback: stored && stored.feedback && typeof stored.feedback.kind === 'string' ? { kind: stored.feedback.kind, levelId: stored.feedback.levelId, date: stored.feedback.date } : null
  };
  ['music', 'sound', 'pattern'].forEach(key => { data.settings[key] = stored && stored.settings && typeof stored.settings[key] === 'boolean' ? stored.settings[key] : key !== 'music'; });
  data.progression = progress.hydrate(stored && stored.progression, data.completed, data.daily, dateKey());
  if (!stored || !stored.progression || stored.progression.inventoryDate !== data.progression.inventoryDate ||
      JSON.stringify(stored.progression.inventory) !== JSON.stringify(data.progression.inventory) ||
      stored.settings && Object.prototype.hasOwnProperty.call(stored.settings, 'autoMark')) p.storage.set(KEY, data);
  const audio = options.audio || createAudio({ settings: data.settings });
  const inputUI = options.inputUI || createInputUI();
  let mode = 'mark', catAtlas = null, lifeFull = null, lifeDim = null, celebrationAtlas = null, celebrationLoading = false, animalAtlas = null, animalLoading = false;
  let originalUI = null, originalCatAtlas = null, plantAtlas = null, homeGrid = null, homeMask = null, lastAmbientFrame = 0;
  const art = createArt(ctx, box, text, () => catAtlas, () => animalAtlas, () => originalUI, () => originalCatAtlas);
  const cosmeticArt = createCosmeticArt({ ctx, box, silhouette: art.silhouette });
  const garden = createGardenArt(ctx, () => plantAtlas);
  const homeFlow = createHomeFlow({ ctx, width: w, height: h, createCanvas: p.createCanvas, getGrid: () => homeGrid, getMask: () => homeMask });
  const tutorial = createTutorial({ p, ctx, w, h, top, bottom,
    helpers: { box, text, wrap, cat, cross, button, drawBoard, getBoard: () => board },
    onDone: finishTutorial, onExit: finishTutorial, onSound: kind => audio.event(kind) });
  if (p.loadImage) {
    p.loadImage('assets/animal-faces.png', bitmap => { catAtlas = bitmap; dirty = true; });
    p.loadImage('assets/fish_full.png', bitmap => { lifeFull = bitmap; dirty = true; });
    p.loadImage('assets/fish_dim.png', bitmap => { lifeDim = bitmap; dirty = true; });
  }
  const clock = () => elapsed + (anchor === null ? 0 : Math.max(0, p.now() - anchor));
  const timeText = ms => Math.floor(ms / 60000).toString().padStart(2, '0') + ':' + Math.floor(ms / 1000 % 60).toString().padStart(2, '0');
  const validCells = list => Array.from(new Set(Array.isArray(list) ? list.filter(i => Number.isInteger(i) && i >= 0 && i < level.size * level.size) : []));
  const isAnswer = i => level.solution[Math.floor(i / level.size)] === i % level.size;
  const vibrate = kind => { if (data.settings.vibrate) p.vibrate(kind); };
  const theme = () => progress.THEMES.find(item => item.id === data.progression.theme) || progress.THEMES[0];
  const levelInfo = () => progress.levelInfo(data.progression.xp);
  function showToast(value) { toast = value; toastUntil = p.now() + 1800; notify(); }
  let nextToolCheck = 0;
  function refreshDailyTools() {
    if (!progress.refreshTools(data.progression, dateKey())) return false;
    save(); notify(); return true;
  }
  function loadCelebration() {
    if (celebrationAtlas || celebrationLoading || !p.loadImage) return;
    celebrationLoading = true;
    const loaded = () => p.loadImage('celebration-assets/celebration.png', bitmap => { celebrationAtlas = bitmap; celebrationLoading = false; dirty = true; });
    if (typeof wx !== 'undefined' && typeof wx.loadSubpackage === 'function') wx.loadSubpackage({ name: 'celebration', success: loaded, fail: () => { celebrationLoading = false; } });
    else loaded();
  }
  function loadAnimals() {
    if (animalAtlas || animalLoading || !p.loadImage) return;
    animalLoading = true;
    const loaded = () => p.loadImage('animal-assets/expressions.png', bitmap => { animalAtlas = bitmap; animalLoading = false; dirty = true; if (!bitmap) showToast('动物表情暂未载入，可稍后重试'); });
    if (typeof wx !== 'undefined' && typeof wx.loadSubpackage === 'function') wx.loadSubpackage({ name: 'animals', success: loaded, fail: () => { animalLoading = false; showToast('新表情暂未载入，已保留当前伙伴'); } }); else loaded();
  }
  if (data.progression.animal !== 'cat') loadAnimals();

  // 小分包在首页准备，失败时已有画面仍可用；销毁后的回调不再更新界面。
  function loadVisualPackage(name, images) {
    if (!p.loadImage) return;
    const loaded = () => {
      if (stopped) return;
      images.forEach(([path, assign]) => p.loadImage(path, bitmap => {
        if (stopped) return;
        assign(bitmap); dirty = true;
      }));
    };
    const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
    if (wechat && typeof wechat.loadSubpackage === 'function') wechat.loadSubpackage({ name, success: loaded, fail() {} });
    else loaded();
  }
  loadVisualPackage('ui', [['ui-assets/ui-atlas.png', bitmap => { originalUI = bitmap; }], ['ui-assets/cat-atlas.png', bitmap => { originalCatAtlas = bitmap; }],
    ['ui-assets/home-grid.png', bitmap => { homeGrid = bitmap; }], ['ui-assets/home-grid-mask.png', bitmap => { homeMask = bitmap; }]]);
  loadVisualPackage('garden', [['garden-assets/plant-growth.png', bitmap => { plantAtlas = bitmap; }]]);

  function pauseClock() { if (anchor !== null) { elapsed = clock(); anchor = null; } }
  function save() {
    if (screen === 'play' || screen === 'fail' || (['rules', 'settings', 'restart'].includes(screen) && returnScreen === 'play')) {
      data.session = { levelId: level.id, levelSource: level.source ? 'original-99' : 'legacy-60', daily, date: daily ? dailyDate : dateKey(), cats, marks, errors, hearts, hints, steps, locates, revives, elapsed: clock(), mode, score, combo, manual, assisted };
    }
    p.storage.set(KEY, data);
  }
  function notify() {
    if (typeof audio.setMusicPaused === 'function') audio.setMusicPaused(screen === 'fail');
    dirty = true;
    if (options.onState) {
      const state = { screen, levelId: level.id, size: level.size, cats: cats.length, hearts, hints, steps, locates, revives, elapsed: clock(), message, score, combo };
      if (screen === 'tutorial') { const t = tutorial.getState(); Object.assign(state, { levelId: 0, size: 4, cats: t.cats.length, hearts: 3, hints: 0, steps: 0, locates: 0, revives: 0, elapsed: 0, message: '教学第 ' + t.phase + ' 步 / 7' }); }
      options.onState(state);
    }
  }
  function startTutorial() {
    save(); pauseClock(); screen = 'tutorial'; gesture = null; lastTap = null; pendingHint = null; feedback = null;
    tutorial.start(); notify();
  }
  function finishTutorial() {
    data.tutorialDone = true; p.storage.set(KEY, data);
    if (data.session) resume(); else startLevel(data.unlocked, false);
  }
  function switchScreen(next) {
    if (screen === 'ranking' && next !== 'ranking') {
      rankRequest++; if (privacyPrompt) { const prompt = privacyPrompt; privacyPrompt = null; prompt.disagree(); }
      if (ranking && ranking.available) ranking.hide();
    }
    save(); pauseClock(); screen = next; gesture = null; lastTap = null; pendingHint = null;
    if (next === 'play' && !hidden) anchor = p.now();
    notify();
  }
  function startLevel(id, isDaily) {
    refreshDailyTools();
    level = levels.find(item => item.id === id) || levels[0];
    daily = Boolean(isDaily); dailyDate = daily ? dateKey() : ''; cats = (level.given || []).slice(); marks = []; errors = [];
    hearts = 3; hints = 0; steps = 0; locates = 0; revives = 0; elapsed = 0; anchor = null; history = []; highlighted = -1; pendingHint = null; feedback = null; mode = 'mark';
    score = 0; combo = 0; manual = 0; assisted = 0; resultScore = null; clearReward = null; loadCelebration();
    message = cats.length ? '已有猫在等你。先观察只有一格的颜色区域。' : '每行、每列、每个颜色区域，找到一只猫。';
    screen = 'play'; if (!hidden) anchor = p.now();
    lastTap = null; gesture = null; shownSecond = -1; save(); audio.event('board'); notify();
  }
  function chooseLevel(id, isDaily) {
    if (data.session && !isDaily && !data.session.daily && data.session.levelId === id) { resume(); return; }
    if (data.session && data.session.hearts > 0) {
      nextGame = { id, daily: isDaily }; returnScreen = screen; switchScreen('newgame'); return;
    }
    startLevel(id, isDaily);
  }
  function resume() {
    const s = data.session;
    if (!s || !levels.some(l => l.id === s.levelId) || (s.daily && s.date !== dateKey())) {
      startLevel(levels[data.unlocked - 1].id, false); return;
    }
    // 旧棋局继续使用原60题，避免换题后猫与标记落到另一张棋盘。
    level = (s.levelSource !== 'original-99' && s.levelId <= legacyLevels.length ? legacyLevels : levels).find(l => l.id === s.levelId);
    daily = Boolean(s.daily); dailyDate = daily ? s.date : '';
    cats = validCells((level.given || []).concat(s.cats || [])).filter(isAnswer);
    errors = validCells(s.errors).filter(i => !isAnswer(i));
    marks = validCells(s.marks).filter(i => !cats.includes(i) && !errors.includes(i));
    hearts = Number.isInteger(s.hearts) ? Math.max(0, Math.min(3, s.hearts)) : 3;
    hints = Number.isInteger(s.hints) ? Math.max(0, s.hints) : 0;
    steps = Number.isInteger(s.steps) ? Math.max(0, s.steps) : 0;
    locates = Number.isInteger(s.locates) ? Math.max(0, s.locates) : 0;
    revives = Number.isInteger(s.revives) ? Math.max(0, s.revives) : 0;
    score = Number.isSafeInteger(s.score) && s.score >= 0 ? s.score : 0;
    combo = Number.isInteger(s.combo) && s.combo >= 0 ? Math.min(s.combo, level.size) : 0;
    manual = Number.isInteger(s.manual) && s.manual >= 0 ? Math.min(s.manual, level.size) : 0;
    assisted = Number.isInteger(s.assisted) && s.assisted >= 0 ? Math.min(s.assisted, level.size - manual) : 0;
    resultScore = null; clearReward = null; loadCelebration();
    elapsed = Number.isFinite(s.elapsed) ? Math.max(0, s.elapsed) : 0;
    mode = s.mode === 'cat' ? 'cat' : 'mark'; history = []; highlighted = -1; pendingHint = null;
    message = '小屋已记住你的进度，继续找猫吧。';
    screen = hearts ? 'play' : 'fail'; if (!hearts) failOpenedAt = p.now(); anchor = !hidden && hearts ? p.now() : null;
    if (logic.isComplete(level, cats)) complete();
    else if (screen === 'play') audio.event('board');
    notify();
  }
  function complete() {
    pauseClock(); screen = 'win'; winOpenedAt = p.now(); data.session = null;
    resultScore = progress.finishScore({ size: level.size, difficulty: level.difficulty, manual, assisted, errors: errors.length, elapsed, score, hints, revives });
    score = resultScore.total;
    const result = { time: elapsed, hints, steps, locates, revives, score };
    const mergeRecord = old => Object.assign({}, !old || elapsed < old.time ? result : old, { score: Math.max(old && old.score || 0, score) });
    clearReward = progress.rewardClear(data.progression, { id: level.id, size: level.size, daily, date: dailyDate });
    if (daily) {
      const old = data.daily[dailyDate];
      data.daily[dailyDate] = mergeRecord(old);
    } else {
      const old = data.completed[level.id];
      data.completed[level.id] = mergeRecord(old);
      data.unlocked = Math.min(levels.length, Math.max(data.unlocked, level.id + 1));
    }
    p.storage.set(KEY, data); if (!daily) submitRankingScore(); audio.event('win'); vibrate('medium'); notify();
  }
  function rankingScore() {
    const best = new Map();
    Object.entries(data.completed).forEach(([key, record]) => {
      const id = Number(key), time = Math.round(record.time);
      if (Number.isInteger(id) && id >= 1 && id <= levels.length && Number.isSafeInteger(time) && time >= 0) {
        const old = best.get(id), points = Number.isSafeInteger(record.score) && record.score >= 0 ? record.score : 0;
        best.set(id, { time: Math.min(old ? old.time : time, time), points: Math.max(old ? old.points : 0, points) });
      }
    });
    return { points: Array.from(best.values()).reduce((sum, row) => sum + row.points, 0), completed: best.size, totalTimeMs: Array.from(best.values()).reduce((sum, row) => sum + row.time, 0) };
  }
  function submitRankingScore() {
    if (!ranking || !ranking.available) return;
    const score = rankingScore(), key = score.points + '/' + score.completed + '/' + score.totalTimeMs;
    if (!score.completed || key === lastSubmittedScore) return;
    ranking.submit(score, result => { if (result.success) lastSubmittedScore = key; });
  }
  function rankBounds() { return { x: 18, y: top + 186, width: w - 36, height: bottom - top - 249 }; }
  function showRankingList(requestId) {
    const area = rankBounds();
    const sent = ranking.show({ width: area.width, height: area.height, requestId, ownScore: rankingScore() });
    rankStatus = sent === false ? 'failed' : 'ready'; notify();
  }
  function refreshRanking(useSettings) {
    if (!ranking || !ranking.available) { rankStatus = 'local'; notify(); return; }
    const requestId = ++rankRequest; rankStatus = 'loading'; notify();
    const authorize = useSettings ? ranking.openSettings : ranking.authorize;
    authorize(result => {
      if (requestId !== rankRequest || screen !== 'ranking' || hidden || stopped) return;
      if (!result.success) { rankGranted = false; rankStatus = result.privacyDenied ? 'privacyDenied' : result.unsupported ? 'unsupported' : result.denied ? 'denied' : 'failed'; notify(); return; }
      rankGranted = true; showRankingList(requestId);
    });
  }
  function openRanking() {
    rankReturn = screen === 'ranking' ? rankReturn : screen;
    switchScreen('ranking'); refreshRanking(false);
  }
  function placeCat(cell, fromHint, countStep) {
    if (screen !== 'play' || !Number.isInteger(cell) || cell < 0 || cell >= level.size * level.size || cats.includes(cell) || errors.includes(cell)) return false;
    highlighted = cell; pendingHint = null;
    if (countStep !== false) steps++;
    if (!isAnswer(cell)) {
      errors.push(cell); marks = marks.filter(i => i !== cell); hearts--; combo = 0; history = []; lastTap = null; audio.event('error');
      message = '这里没有猫。红叉已保留，观察其余格子再试。'; vibrate('error');
      const near = logic.conflicts(level, cats.concat(cell)).filter(i => i !== cell);
      const priority = i => {
        const row = Math.floor(i / level.size), col = i % level.size, cr = Math.floor(cell / level.size), cc = cell % level.size;
        const rule = level.regions[i] === level.regions[cell] ? 1 : row === cr || col === cc ? 2 : 3;
        return rule * 1000 + (Math.abs(row - cr) + Math.abs(col - cc)) * 10 + (row === cr ? 0 : 1);
      };
      near.sort((a, b) => priority(a) - priority(b));
      feedback = { type: 'error', cell, offended: near.length ? near[0] : -1, start: p.now(), duration: 1569 };
      if (!hearts) { pauseClock(); screen = 'fail'; failOpenedAt = p.now(); audio.event('fail'); }
    } else {
      cats.push(cell); marks = marks.filter(i => i !== cell); history = [];
      const gained = progress.correctScore({ size: level.size, difficulty: level.difficulty, combo, assisted: !!fromHint });
      score += gained.points; combo = gained.combo; if (fromHint) assisted++; else manual++;
      feedback = { type: 'cat', cell, points: gained.points, comboBonus: gained.comboBonus, start: p.now(), duration: 1333 }; audio.event(fromHint ? 'helper' : 'correct');
      if (!fromHint) message = '找到一只！猫已安家，继续观察剩下的区域。';
      vibrate('light');
      if (logic.isComplete(level, cats)) complete();
    }
    save();
    notify(); return true;
  }
  function markCell(cell, value) {
    if (cats.includes(cell) || errors.includes(cell)) return false;
    const before = marks.includes(cell);
    if (value && !marks.includes(cell)) marks.push(cell);
    if (!value) marks = marks.filter(i => i !== cell);
    if (before !== value) audio.event(value ? 'mark' : 'unmark');
    return before !== value;
  }
  function toggleMark(cell) {
    if (screen !== 'play' || !Number.isInteger(cell) || cell < 0 || cell >= level.size * level.size || cats.includes(cell) || errors.includes(cell)) return;
    history.push(marks.slice()); markCell(cell, !marks.includes(cell)); steps++; highlighted = -1; pendingHint = null; save(); notify();
  }
  function undo() {
    if (screen !== 'play' || !history.length) return;
    const previous = marks;
    marks = history.pop().filter(i => !cats.includes(i) && !errors.includes(i));
    if (previous.some(i => !marks.includes(i))) audio.event('unmark');
    else if (marks.some(i => !previous.includes(i))) audio.event('mark');
    highlighted = -1; pendingHint = null; message = '已撤销上一次标记。'; save(); notify();
  }
  function hint() {
    if (screen !== 'play') return;
    refreshDailyTools();
    if (!pendingHint && data.progression.inventory.hints <= 0) { showToast('今日提示已用完，请等待明天刷新'); return; }
    if (!pendingHint) {
      const step = logic.getHint(level, cats, marks.concat(errors));
      if (step.kind === 'mark' && ['row', 'column', 'adjacent'].includes(step.rule)) {
        const n = level.size, r = Math.floor(step.cell / n), c = step.cell % n;
        const owner = cats.find(i => Math.floor(i / n) === r || i % n === c || (Math.abs(Math.floor(i / n) - r) <= 1 && Math.abs(i % n - c) <= 1));
        if (owner !== undefined) {
          const or = Math.floor(owner / n), oc = owner % n;
          step.cells = level.regions.map((_, i) => i).filter(i => !cats.includes(i) && !marks.includes(i) && !errors.includes(i) && (Math.floor(i / n) === or || i % n === oc || (Math.abs(Math.floor(i / n) - or) <= 1 && Math.abs(i % n - oc) <= 1)));
          step.source = owner; step.reason = '这只猫的同行、同列及相邻格不会有其他猫，可以一起排除。';
        }
      }
      message = step.reason; highlighted = step.cell;
      // 查看有效推理即消耗一次，关闭后不会返还，应用同一条提示不再扣次。
      if (step.kind !== 'none' && progress.consume(data.progression, 'hints')) { hints++; audio.event('hint'); pendingHint = Object.assign({ openedAt: p.now() }, step); save(); }
      notify(); return;
    }
    const step = pendingHint; pendingHint = null;
    if (step.kind === 'place') placeCat(step.cell, true);
    else {
      history.push(marks.slice());
      if (step.kind === 'mark') (step.cells || [step.cell]).forEach(cell => markCell(cell, true));
      if (step.kind === 'repair') markCell(step.cell, false);
      steps++;
      save(); notify();
    }
  }
  function locate() {
    if (screen !== 'play') return;
    refreshDailyTools();
    if (data.progression.inventory.helpers <= 0) { showToast('今日猫咪助手已用完，请等待明天刷新'); return; }
    pendingHint = null;
    const step = logic.locateCat(level, cats, marks.concat(errors));
    message = step.reason;
    if (step.kind === 'place' && progress.consume(data.progression, 'helpers')) { locates++; placeCat(step.cell, true); } else notify();
  }
  function revive() {
    if (screen !== 'fail') return;
    hearts = 3; revives++; screen = 'play'; history = []; pendingHint = null;
    feedback = { type: 'revive', cell: -1, start: p.now(), duration: 500 };
    message = '已恢复三条鱼，继续这盘找猫。'; if (!hidden) anchor = p.now();
    save(); notify();
  }
  function dailyLevel(protectExisting) {
    let hash = 0; for (const char of dateKey()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    // 同一天使用相同精选关卡，所有记录保存在当前设备。
    const id = levels[12 + hash % (levels.length - 12)].id;
    if (protectExisting) chooseLevel(id, true); else startLevel(id, true);
  }
  function restartCurrent() {
    if (daily && dailyDate !== dateKey()) dailyLevel();
    else startLevel(level.id, daily);
  }
  function openPage(page) {
    returnScreen = screen; switchScreen(page);
    if (page === 'settings') audio.event('dialog');
    if (page === 'wardrobe') loadAnimals();
  }
  function claimCheckin() {
    checkinReward = progress.dailyClaim(data.progression, dateKey());
    save(); if (checkinReward.claimed) { audio.event('checkin'); vibrate('medium'); }
    notify(); return checkinReward;
  }
  function selectCosmetic(kind, id) {
    if (!progress.selectCosmetic(data.progression, kind, id)) { showToast('达到对应等级后即可解锁'); return false; }
    if (kind === 'animal' && id !== 'cat') loadAnimals(); save(); notify(); return true;
  }
  function editNickname() {
    inputUI.editNickname(data.progression.profile.nickname, result => {
      if (stopped || !result.confirmed) return;
      if (progress.setNickname(data.progression, result.value)) { save(); notify(); } else showToast('请输入 1～12 个字符的昵称');
    });
  }
  function setSetting(key) {
    if (!['music', 'sound', 'vibrate', 'pattern'].includes(key)) return;
    data.settings[key] = !data.settings[key];
    audio.configure(data.settings); save();
    showToast(({ music: '音乐', sound: '音效', vibrate: '震动', pattern: '图案模式' })[key] + (data.settings[key] ? '已开启' : '已关闭'));
  }

  function rounded(x, y, width, height, radius) {
    const corners = (Array.isArray(radius) ? radius : [radius, radius, radius, radius]).map(v => Math.max(0, Math.min(v, width / 2, height / 2)));
    const [tl, tr, br, bl] = corners;
    ctx.beginPath(); ctx.moveTo(x + tl, y); ctx.lineTo(x + width - tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + tr); ctx.lineTo(x + width, y + height - br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height); ctx.lineTo(x + bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - bl); ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y); ctx.closePath();
  }
  function box(x, y, width, height, fill, radius, stroke) {
    rounded(x, y, width, height, radius === undefined ? 16 : radius); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  function text(value, x, y, size, color, align, bold) {
    ctx.fillStyle = color || INK; ctx.font = (bold ? '600 ' : '') + size + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
  }
  function fittedText(value, x, y, width, size, color, bold) {
    let output = String(value); ctx.font = (bold ? '600 ' : '') + size + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    if (ctx.measureText(output).width > width) { const chars = Array.from(output); while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop(); output = chars.join('') + '…'; }
    text(output, x, y, size, color, 'left', bold);
  }
  function wrap(value, x, y, width, size, color, lineHeight) {
    let line = '', row = 0; lineHeight = lineHeight || size * 1.6;
    for (const char of value) {
      ctx.font = size + 'px system-ui, sans-serif';
      if (char === '\n' || (line && ctx.measureText(line + char).width > width)) { text(line, x, y + row * lineHeight, size, color); row++; line = char === '\n' ? '' : char; }
      else line += char;
    }
    if (line) text(line, x, y + row * lineHeight, size, color);
    return (row + 1) * lineHeight;
  }
  function button(label, x, y, width, height, action, style, disabled) {
    style = style || 'light';
    const fill = disabled ? '#C5C1BA' : style === 'victory' ? '#F49419' : style === 'revive' ? '#72A7DB' : style === 'retry' ? '#DFEFFF' : style === 'primary' ? theme().accent : style === 'active' ? '#D7E7D6' : '#FFFFFF';
    ctx.save(); if (['primary', 'victory'].includes(style) && !disabled) { ctx.shadowColor = 'rgba(221,131,35,.25)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5; }
    box(x, y, width, height, fill, ['primary', 'victory'].includes(style) ? height / 2 : 14, ['primary', 'revive', 'retry', 'victory'].includes(style) ? null : '#E6E3D6'); ctx.restore();
    let fontSize = ['primary', 'victory'].includes(style) ? Math.min(20, Math.max(17, height * .36)) : height < 40 ? 13 : 15;
    ctx.font = '600 ' + fontSize + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    const measured = ctx.measureText(label).width;
    if (measured > width - 24) fontSize *= (width - 24) / measured;
    text(label, x + width / 2, y + height / 2, fontSize, disabled ? '#A6AEA6' : ['primary', 'revive', 'victory'].includes(style) ? '#FFFBF0' : style === 'retry' ? '#6A9CCD' : INK, 'center', true);
    if (!disabled) buttons.push({ label, x, y, width, height, action });
  }
  function circleButton(label, cx, cy, diameter, action, iconName, count) {
    ctx.save(); ctx.shadowColor = 'rgba(214,150,94,.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    box(cx - diameter / 2, cy - diameter / 2, diameter, diameter, '#FFFFFF', diameter / 2); ctx.restore();
    if (iconName) art.icon(iconName, cx, cy, diameter * .55, INK);
    if (count !== undefined) { box(cx + diameter * .21, cy - diameter * .59, diameter * .4, diameter * .35, '#ED443C', diameter / 5); text(count, cx + diameter * .41, cy - diameter * .415, diameter * .25, '#FFF', 'center', true); }
    buttons.push({ label, x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter, action });
  }
  function touchLabel(label, x, y, width, action, color) {
    text(label, x + width / 2, y + 15, 12, color || MUTED, 'center'); buttons.push({ label, x, y, width, height: 30, action });
  }
  function modal(title, height, onClose) {
    const mw = Math.min(w - 42, 360), mh = Math.min(height, bottom - top - 22), mx = (w - mw) / 2, my = (top + bottom - mh) / 2;
    buttons = []; ctx.fillStyle = 'rgba(32,29,27,.76)'; ctx.fillRect(0, 0, w, h); box(mx, my, mw, mh, '#FFFCF7', 24); box(mx, my, mw, 49, '#F9EDDF', [24, 24, 0, 0]);
    text(title, w / 2, my + 26, 24, INK, 'center'); art.icon('close', mx + mw - 26, my + 26, 27);
    buttons.push({ label: '关闭', x: mx + mw - 48, y: my + 7, width: 42, height: 38, action: onClose }); return { x: mx, y: my, width: mw, height: mh };
  }
  function toggle(label, key, x, y, width) {
    const on = data.settings[key];
    box(x, y, width, 23, on ? '#49B457' : '#CABDA9', 12); text(on ? 'ON' : 'OFF', x + (on ? width * .3 : width * .64), y + 12, 11, '#FFF', 'center', true);
    box(x + (on ? width - 21 : 2), y + 2, 19, 19, '#FFFCF7', 10); buttons.push({ label, x: x - 4, y: y - 4, width: width + 8, height: 31, action: () => setSetting(key) });
  }

  function cat(cx, cy, size, small, expression) {
    art.animal(cx, cy, size, data.progression.animal, expression || 0);
  }
  function cross(x, y, size, color, progress, secondStart) {
    progress = progress === undefined ? 1 : progress;
    ctx.strokeStyle = color || '#FFFFFF'; ctx.lineWidth = Math.max(2.5, size / 6); ctx.lineCap = 'round';
    const first = Math.max(0, Math.min(1, progress * 490 / 68)), second = Math.max(0, Math.min(1, (progress * 490 - (secondStart === undefined ? 166 : secondStart)) / 68));
    ctx.beginPath(); ctx.moveTo(x - size / 2, y - size / 2); ctx.lineTo(x - size / 2 + size * first, y - size / 2 + size * first);
    if (second > 0) { ctx.moveTo(x + size / 2, y - size / 2); ctx.lineTo(x + size / 2 - size * second, y - size / 2 + size * second); }
    ctx.stroke(); ctx.lineCap = 'butt';
  }
  function heart(x, y, filled, index) {
    // 使用生命鱼纹理；满生命为金鱼，扣命后立即留下白色鱼轮廓。
    const size = 60 * 30 / 84, lost = feedback && feedback.type === 'error' && index === hearts;
    const age = feedback ? p.now() - feedback.start : 10000;
    if (!filled && lifeDim) ctx.drawImage(lifeDim, x - size * 64 / 120, y - size / 2, size * 64 / 60, size);
    if ((!filled && !(lost && age < 250)) || !lifeFull) return;
    ctx.save();
    if (lost && age < 250) {
      const phase = age / 250;
      y += (phase < .4 ? phase * .5 : .2 - (phase - .4) * .8) * size;
    }
    if (feedback && feedback.type === 'revive' && age < 500) {
      const phase = age / 500, scale = phase < .35 ? .3 + phase / .35 : phase < .65 ? 1.3 - .45 * (phase - .35) / .3 : .85 + .15 * (phase - .65) / .35;
      ctx.translate(x, y); x = 0; y = 0; ctx.scale(scale, scale);
    }
    ctx.drawImage(lifeFull, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  }
  function colorIndex(l, region) { return l.colorMap && Number.isInteger(l.colorMap[region]) ? l.colorMap[region] : region; }
  function regionColor(l, region) { return l.colorMap && typeof l.colorMap[region] === 'string' ? l.colorMap[region] : COLORS[colorIndex(l, region)]; }
  function drawBoard(l, catCells, markCells, errorCells, x, y, size, active, focusOnly) {
    const n = l.size, padding = size * 15 / (n * 108 + 30), gridSize = size - padding * 2, cell = gridSize / n;
    const gap = cell * 4 / 108, gx = x + padding, gy = y + padding;
    if (!focusOnly) { box(x, y + 3, size, size, '#E9E0DD', 12); box(x, y, size, size, '#FFFFFF', 12); }
    const effect = active && feedback ? Math.max(0, Math.min(1, (p.now() - feedback.start) / feedback.duration)) : 1;
    const focus = pendingHint ? hintFocus(pendingHint) : [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (focusOnly && !focus.includes(i)) continue;
      ctx.save();
      if (focusOnly && i === highlighted) ctx.globalAlpha = 50 / 255 + (1 - 50 / 255) * (1 - Math.cos((p.now() - pendingHint.openedAt) / 650 * Math.PI)) / 2;
      let cx = gx + c * cell, cy = gy + r * cell;
      const radii = [r === 0 && c === 0, r === 0 && c === n - 1, r === n - 1 && c === n - 1, r === n - 1 && c === 0].map(outer => cell * (outer ? 30 : 10) / 108);
      const hit = active && feedback && feedback.cell === i;
      if (hit && feedback.type === 'error' && effect < 1) cx += Math.sin(effect * Math.PI * 18) * (1 - effect) * 3;
      box(cx + gap, cy + gap, cell - gap * 2, cell - gap * 2, regionColor(l, l.regions[i]), radii);
      if (data.settings.pattern) art.pattern(colorIndex(l, l.regions[i]), cx + cell / 2, cy + cell / 2, cell * .88);
      if (markCells.includes(i)) cross(cx + cell / 2, cy + cell / 2, cell * .49, null, hit && feedback.type === 'mark' ? effect : 1);
      if (hit && feedback.type === 'erase' && effect < 1 && !markCells.includes(i)) {
        ctx.save(); ctx.globalAlpha = 1 - effect; cross(cx + cell / 2, cy + cell / 2, cell * .45); ctx.restore();
      }
      if (errorCells.includes(i)) {
        if (hit && effect < 1) box(cx + gap, cy + gap, cell - gap * 2, cell - gap * 2, 'rgba(228,85,104,' + ((1 - effect) * .7) + ')', radii);
        if (hit && feedback.type === 'error') {
          const age = p.now() - feedback.start;
          if (age < 493) { ctx.save(); ctx.globalAlpha = age < 351 ? 1 : (493 - age) / 142; cross(cx + cell / 2, cy + cell / 2, cell * .45, '#FFFFFF', age / 490); ctx.restore(); }
          if (age >= 1136) cross(cx + cell / 2, cy + cell / 2, cell * .45, '#FD6A2E', (age - 1136) / 490, 86);
        } else cross(cx + cell / 2, cy + cell / 2, cell * .45, '#FD6A2E');
      }
      if (catCells.includes(i)) {
        let scale = 1;
        if (hit && feedback.type === 'cat' && effect < 1) scale = effect < .18 ? 1 - .05 * effect / .18 : effect < .36 ? .95 + .1 * (effect - .18) / .18 : 1.05 - .05 * (effect - .36) / .64;
        ctx.save();
        if (hit && feedback.type === 'cat') ctx.globalAlpha = Math.min(1, effect * 6);
        const expression = (catCells.indexOf(i) + level.id * 2) % 9;
        cat(cx + cell / 2, cy + cell / 2, cell * .94 * scale, n > 7, feedback && feedback.type === 'error' && feedback.offended === i && effect < .9 ? 7 : expression);
        ctx.restore();
        if (hit && feedback.type === 'cat' && effect > .1 && effect < .9) {
          ctx.save(); ctx.globalAlpha = 1 - effect;
          for (let k = 0; k < 6; k++) { const angle = k * Math.PI / 3, radius = cell * (.24 + effect * .4); text('✦', cx + cell / 2 + Math.cos(angle) * radius, cy + cell / 2 + Math.sin(angle) * radius, cell * .16, '#FFE58D', 'center'); }
          ctx.restore();
        }
      }
      if (active && pendingHint && i === highlighted) { rounded(cx + gap, cy + gap, cell - gap * 2, cell - gap * 2, radii); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.stroke(); }
      if (focusOnly && pendingHint && pendingHint.kind === 'mark' && (i === highlighted || (pendingHint.cells || []).includes(i)) && !markCells.includes(i)) { cross(cx + cell / 2, cy + cell / 2, cell * .49, '#FFFFFF'); cross(cx + cell / 2, cy + cell / 2, cell * .4, regionColor(l, l.regions[i])); }
      ctx.restore();
    }
    if (active && !focusOnly) board = { x: gx, y: gy, size: gridSize, cell, n, plateX: x, plateY: y, plateSize: size };
    if (active && !focusOnly && feedback && feedback.type === 'cat' && feedback.points && effect < 1) {
      const i = feedback.cell, tx = gx + (i % n + .5) * cell, ty = gy + (Math.floor(i / n) + .2) * cell - effect * 25;
      ctx.save(); ctx.globalAlpha = 1 - effect * .85; ctx.font = '700 ' + Math.min(22, cell * .34) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#FFF'; ctx.lineWidth = 4; ctx.strokeText('+' + feedback.points, tx, ty); ctx.fillStyle = '#F49419'; ctx.fillText('+' + feedback.points, tx, ty); ctx.restore();
    }
  }
  function hintFocus(step) {
    if (Array.isArray(step.cells)) return step.cells.concat(step.source === undefined ? [] : [step.source]);
    const cell = step.cell, row = Math.floor(cell / level.size), col = cell % level.size;
    return level.regions.map((_, i) => i).filter(i => i === cell ||
      (step.rule.includes('row') && Math.floor(i / level.size) === row) ||
      (step.rule.includes('column') && i % level.size === col) ||
      (step.rule === 'region-single' && level.regions[i] === level.regions[cell]));
  }
  function drawHint() {
    if (!board || !pendingHint) return;
    buttons = []; const alpha = Math.min(1, (p.now() - pendingHint.openedAt) / 300) * .75;
    ctx.fillStyle = 'rgba(0,0,0,' + alpha + ')'; ctx.fillRect(0, 0, w, h);
    drawBoard(level, cats, marks, errors, board.plateX, board.plateY, board.plateSize, true, true);
    const width = Math.min(w - 36, w * 900 / 1080), height = Math.max(58, w * 190 / 1080);
    const y = Math.max(top + 38, board.plateY - height - w * 15 / 1080);
    box((w - width) / 2, y, width, height, '#FFF9F4', 14);
    wrap(pendingHint.reason, (w - width) / 2 + 15, y + 22, width - 30, 13, INK, 20);
    const buttonY = Math.min(bottom - 55, board.plateY + board.plateSize + w * 15 / 1080);
    button('应用', w * .155, buttonY, w * .69, 51, hint, 'primary');
    button('关闭', w - 70, top, 52, 34, () => { pendingHint = null; highlighted = -1; message = '已关闭提示。'; notify(); });
  }
  function drawFailure() {
    buttons = [];
    const age = Math.max(0, p.now() - failOpenedAt), appear = Math.min(1, age / 1900), span = bottom - top;
    ctx.fillStyle = 'rgba(0,0,0,.8509804)'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = Math.min(1, appear * 3);
    ctx.font = '600 ' + Math.min(28, w * .07) + 'px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = '#72A7DB'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.strokeText('差一点，就找到啦', w / 2, top + span * .19); ctx.fillStyle = '#FFFFFF'; ctx.fillText('差一点，就找到啦', w / 2, top + span * .19);
    const sway = Math.sin(age / 3170 * Math.PI * 2) * 3, size = Math.min(126, w * .31, span * .23);
    cat(w * .37, top + span * .39 + sway, size, false, 2); cat(w * .64, top + span * .39 - sway, size * .85, false, 2);
    text('还有 ' + (level.size - cats.length) + ' 只猫等你找到', w / 2, top + span * .56, 19, '#FFFFFF', 'center', true);
    text('别着急，继续这一盘', w / 2, top + span * .61, 13, '#C4D9EF', 'center');
    const bh = Math.min(52, span * .09), bx = w * .145, bw = w * .71;
    button('恢复三条鱼 · 免费继续', bx, top + span * .68, bw, bh, revive, 'revive');
    button('重新找猫', bx, top + span * .79, bw, bh, restartCurrent, 'retry');
    button('回到小屋', w / 2 - 48, bottom - 36, 96, 30, () => switchScreen('home'));
    ctx.restore();
  }
  function heading(title, backAction, rightLabel, rightAction) {
    button('‹', 18, top, 42, 38, backAction); text(title, w / 2, top + 19, 18, INK, 'center', true);
    if (rightLabel) button(rightLabel, w - 65, top, 47, 38, rightAction);
  }

  function homeBackground() {
    if (homeFlow.draw(p.now())) return;
    ctx.save(); ctx.globalAlpha = .045;
    const cell = w / 4;
    for (let r = 0; r < Math.ceil(h / cell); r++) for (let c = 0; c < 4; c++) {
      if (r > 2 && r < Math.floor(h / cell) - 2) continue;
      const x = c * cell, y = r * cell;
      box(x + 2, y + 2, cell - 4, cell - 4, '#DFAF7E', 15);
      box(x + 5, y + 5, cell - 10, cell - 10, theme().paper, 12);
      if ((r + c) % 3 === 0) art.silhouette(x + cell / 2, y + cell / 2, cell * .57, '#DFAF7E');
      else if ((r + c) % 3 === 1) cross(x + cell / 2, y + cell / 2, cell * .5, '#DFAF7E');
    } ctx.restore();
  }
  function avatar(cx, cy, size, id, frameId) {
    const frame = progress.FRAMES.find(item => item.id === (frameId || data.progression.profile.frame)) || progress.FRAMES[0];
    ctx.save();
    if (frame.style === 'sun') { ctx.beginPath(); ctx.arc(cx, cy, size * .39, 0, Math.PI * 2); ctx.clip(); }
    box(cx - size / 2, cy - size / 2, size, size, frame.color, size * .17);
    box(cx - size * .43, cy - size * .43, size * .86, size * .86, '#F5D79F', size * .12);
    const avatarNames = { cat: 'head_0001', panda: 'head_0002', corgi: 'head_0003', crocodile: 'head_0004', duck: 'head_0006', lion: 'head_0007', calico: 'head_0008' };
    if (!art.sprite(avatarNames[id || data.progression.profile.avatar], cx, cy, size * .84, size * .84)) art.animal(cx, cy, size * .82, id || data.progression.profile.avatar, 0);
    ctx.restore();
    cosmeticArt.frame(cx, cy, size, frame);
  }
  function drawHome() {
    homeBackground(); const span = bottom - top, compact = span < 660, tiny = span < 520;
    const avatarSize = compact ? 44 : 58;
    avatar(19 + avatarSize / 2, top + avatarSize / 2, avatarSize);
    buttons.push({ label: '个人资料', x: 16, y: top, width: avatarSize + 6, height: avatarSize, action: () => openPage('profile') });
    box(w / 2 - 51, top + 7, 102, 38, '#FFF', 20); garden.plant(w / 2 - 21, top + 24, 27, 35, data.progression.checkin.total, p.now());
    text(data.progression.checkin.streak, w / 2 + 14, top + 26, 21, '#AC710C', 'center', true);
    buttons.push({ label: '每日打卡', x: w / 2 - 54, y: top, width: 108, height: 51, action: () => { checkinReward = null; openPage('checkin'); } });
    circleButton('小屋设置', w - 37, top + 25, 38, () => openPage('settings'), 'settings');
    const by = bottom - (tiny ? 140 : compact ? 158 : 174), bh = tiny ? 42 : compact ? 48 : 54, bx = w * .153, bw = w * .694;
    const infoTop = by - 74, heroTop = top + 72, heroBottom = infoTop - 16;
    if (options.brandLogo) {
      const ratio = options.brandLogo.width / options.brandLogo.height;
      const logoWidth = Math.min(w * .56, (heroBottom - heroTop - 25) * ratio), logoHeight = logoWidth / ratio;
      const logoTop = heroTop + (heroBottom - heroTop - logoHeight - 25) / 2;
      ctx.drawImage(options.brandLogo, (w - logoWidth) / 2, logoTop, logoWidth, logoHeight);
    } else {
      const fs = Math.min(w * .155, (heroBottom - heroTop - 26) / 3.04), logoY = heroTop + (heroBottom - heroTop - fs * 3.04 - 25.5) / 2 + fs / 2;
      text('喵喵', w / 2, logoY, fs, '#8B5B3F', 'center', true);
      text('谜谜', w / 2, logoY + fs * 1.02, fs, '#8B5B3F', 'center', true);
      text('小屋', w / 2, logoY + fs * 2.04, fs, '#8B5B3F', 'center', true);
    }
    const info = levelInfo();
    text('Lv.' + info.level + '  ' + data.progression.profile.nickname, w / 2, infoTop + 7, 14, INK, 'center', true);
    box(w / 2 - 62, infoTop + 26, 124, 5, '#E8DBCF', 3); if (info.progress > 0) box(w / 2 - 62, infoTop + 26, Math.max(5, 124 * info.progress), 5, theme().accent, 3);
    text(info.currentXp + ' / ' + info.neededXp + ' 经验 · ' + Object.keys(data.completed).length + ' / ' + levels.length + ' 关', w / 2, infoTop + 43, 12, MUTED, 'center');
    const firstVisit = !data.session && !data.tutorialDone && !Object.keys(data.completed).length;
    button(data.session ? '继续第 ' + data.session.levelId + ' 关' : firstVisit ? '开始找猫' : '第 ' + data.unlocked + ' 关', bx, by, bw, bh, firstVisit ? startTutorial : resume, 'primary');
    button('每日挑战', bx, by + bh + 14, bw, bh, () => dailyLevel(true), 'primary');
    const fy = bottom - 30;
    touchLabel('关卡', 18, fy, (w - 36) / 4, () => { selectedPage = Math.floor((data.unlocked - 1) / 12); switchScreen('levels'); });
    touchLabel('排行榜', 18 + (w - 36) / 4, fy, (w - 36) / 4, openRanking);
    touchLabel('动物小屋', 18 + (w - 36) / 2, fy, (w - 36) / 4, () => openPage('wardrobe'));
    touchLabel('新手教学', 18 + (w - 36) * .75, fy, (w - 36) / 4, startTutorial);
    uiLayout = { screen: 'home', hero: { top: heroTop, bottom: heroBottom }, info: { top: infoTop, bottom: infoTop + 50 }, primary: { top: by, bottom: by + bh }, secondary: { top: by + bh + 14, bottom: by + bh * 2 + 14 }, actions: { top: fy, bottom: fy + 30 } };
  }

  function ruleMini(x, y, size, kind) {
    const cell = size / 3, grid = kind === 0 ? [1,1,1,1,2,0,1,0,0] : kind === 1 ? [1,2,1,0,1,0,0,1,0] : [1,1,1,1,2,1,1,1,1];
    grid.forEach((v, i) => { const cx = x + i % 3 * cell, cy = y + Math.floor(i / 3) * cell; box(cx, cy, cell - 1, cell - 1, v === 1 ? '#B8845C' : '#DCC2AE', 1); if (v === 1) cross(cx + cell / 2, cy + cell / 2, cell * .56); if (v === 2) art.animal(cx + cell / 2, cy + cell / 2, cell * .94, 'cat', 0); });
  }
  function drawPlay() {
    const span = bottom - top, compact = span < 660, tiny = span < 520;
    circleButton('‹', 32, top + 25, 36, () => switchScreen('home'), 'back');
    circleButton('设置', w - 32, top + 25, 36, () => openPage('settings'), 'settings');
    const headY = top + (tiny ? 3 : 12);
    text(daily ? '每日' : '关卡', w * .37, headY, tiny ? 15 : 17, INK, 'center'); text(daily ? '挑战' : level.id, w * .37, headY + (tiny ? 23 : 25), tiny ? 20 : 22, INK, 'center', true);
    text('分数', w * .63, headY, tiny ? 15 : 17, INK, 'center'); text(score.toLocaleString('en-US'), w * .63, headY + (tiny ? 23 : 25), tiny ? 20 : 22, INK, 'center', true);
    const timerY = top + (tiny ? 43 : compact ? 64 : 72), lifeY = timerY + (tiny ? 20 : 28);
    text(timeText(clock()), w / 2, timerY, 12, MUTED, 'center');
    box(w / 2 - 48, lifeY - 15, 96, 30, '#FFF', 16); [0,1,2].forEach(i => heart(w / 2 - 25 + i * 25, lifeY - 1, i < hearts, i));
    const ruleY = top + (compact ? 116 : 140), rh = compact ? 54 : 62, rw = (w - 36) / 3;
    if (!tiny) box(13, ruleY, w - 26, rh, '#FFF', 12);
    const labels = [['每种颜色', '一只动物'], ['每行每列', '各一只'], ['相邻格子', '不能放']];
    if (!tiny) labels.forEach((lines, i) => { const x = 20 + i * rw; box(x, ruleY + 7, rw - 6, rh - 14, '#FBF4EE', 8); ruleMini(x + 6, ruleY + (rh - 24) / 2, 24, i); lines.forEach((line, row) => text(line, x + 37, ruleY + rh / 2 - 7 + row * 14, 11, INK)); });
    const y0 = tiny ? top + 82 : ruleY + rh + (compact ? 38 : 44), reserve = tiny ? 60 : compact ? 100 : 132;
    const size = Math.min(w * (level.size >= 8 || tiny ? .972222 : .934), bottom - y0 - reserve), x = (w - size) / 2;
    const y = compact ? y0 : y0 + (bottom - reserve - y0 - size) / 2;
    const tw = Math.min(size * .68, level.size * 25 + 18), ty = y - 28;
    if (!tiny) box(w / 2 - tw / 2, ty, tw, 28, '#FFF', [18, 18, 0, 0]);
    for (let i = 0; !tiny && i < level.size; i++) {
      const tx = w / 2 - tw / 2 + (i + .5) * tw / level.size;
      if (cats.some(c => level.regions[c] === i)) { art.animal(tx, ty + 14, 21, data.progression.animal, i % 9); box(tx + 6, ty + 18, 6, 6, regionColor(level, i), 3); }
      else art.silhouette(tx, ty + 14, 20, regionColor(level, i));
    }
    drawBoard(level, cats, marks, errors, x, y, size, true);
    const diameter = tiny ? 34 : compact ? 52 : 64, toolY = tiny ? bottom - 36 : compact ? bottom - 62 : bottom - 76;
    circleButton('找猫', w * .25, toolY, diameter, locate, null, data.progression.inventory.helpers);
    if (!art.sprite('tool_cat_item', w * .25, toolY, diameter * 106 / 210, diameter * 106 / 210)) art.animal(w * .25, toolY, diameter * .7, 'cat', 2);
    circleButton('提示', w * .5, toolY, diameter, hint, 'bulb', data.progression.inventory.hints);
    circleButton('动物小屋', w * .75, toolY, diameter, () => openPage('wardrobe'));
    if (levelInfo().level < 21) { ctx.save(); ctx.globalAlpha = .22; art.animal(w * .75, toolY, diameter * .65, 'lion', 0); ctx.restore(); text('Lv.21', w * .75, toolY + 1, 13, INK, 'center', true); art.icon('lock', w * .75 + diameter * .33, toolY - diameter * .44, 19); }
    else art.animal(w * .75, toolY, diameter * .7, data.progression.animal, 1);
    if (!compact) text(combo > 1 ? '连续正确 ' + combo + ' 次 · 连击加分中' : '双击放猫 · 滑动连续打叉', w / 2, y + size + 12, 12, combo > 1 ? '#CC8930' : MUTED, 'center');
    const footerY = bottom - (tiny ? 15 : 28), fw = (w - 36) / 4;
    box(20 + (mode === 'cat' ? fw : 0), footerY + 3, fw - 4, 24, '#EFE3D6', 12);
    touchLabel('×  标记', 18, footerY, fw, () => { mode = 'mark'; lastTap = null; notify(); }, mode === 'mark' ? INK : MUTED);
    touchLabel('猫  放置', 18 + fw, footerY, fw, () => { mode = 'cat'; lastTap = null; notify(); }, mode === 'cat' ? INK : MUTED);
    touchLabel('撤销', 18 + fw * 2, footerY, fw, undo);
    touchLabel('重开', 18 + fw * 3, footerY, fw, () => openPage('restart'));
    uiLayout = { screen: 'play', rules: tiny ? null : { top: ruleY, bottom: ruleY + rh }, progress: tiny ? null : { top: ty, bottom: y }, board: { top: y, bottom: y + size + 3 }, tools: { top: toolY - diameter * .59, bottom: toolY + diameter / 2 }, actions: { top: footerY, bottom: footerY + 30 } };
  }
  function drawRanking() {
    heading('排行榜', () => switchScreen(rankReturn));
    const score = rankingScore(), totalSeconds = Math.floor(score.totalTimeMs / 1000);
    const duration = totalSeconds >= 3600 ? Math.floor(totalSeconds / 3600) + ':' + String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0') + ':' + String(totalSeconds % 60).padStart(2, '0') : timeText(score.totalTimeMs);
    box(18, top + 60, w - 36, 86, '#FFFFFF', 14, '#E8DAD3');
    text('我的本机成绩', 34, top + 81, 12, MUTED);
    text(score.points.toLocaleString('en-US') + ' 分', 34, top + 112, 23, INK, 'left', true);
    text(score.completed + ' 关 · 累计最佳用时', w - 34, top + 81, 11, MUTED, 'right');
    text(duration, w - 34, top + 114, 21, INK, 'right', true);
    const area = rankBounds();
    box(area.x, area.y, area.width, area.height, '#FFFFFF', 14, '#E8DAD3');
    if (rankStatus === 'ready' && ranking && ranking.available) {
      ctx.save(); rounded(area.x, area.y, area.width, area.height, 14); ctx.clip();
      ranking.draw(ctx, area.x, area.y, area.width, area.height); ctx.restore();
    } else {
      const cy = area.y + Math.min(63, area.height * .29);
      cat(w / 2, cy, Math.min(70, area.height * .32), false);
      const title = rankStatus === 'loading' ? '正在打开排行榜…' : rankStatus === 'denied' ? '允许查看好友排名后，再来比一比' : rankStatus === 'privacyDenied' ? '阅读并允许后，可查看排行榜' : rankStatus === 'unsupported' ? '更新微信后，再来看看排行榜' : rankStatus === 'failed' ? '暂时没能打开排行榜' : '和微信好友一起找猫';
      text(title, w / 2, cy + 50, w < 350 ? 12 : 14, INK, 'center', true);
      const note = rankStatus === 'local' ? '在微信小游戏中打开，可查看好友排名。这里展示你的真实本机成绩。' : rankStatus === 'denied' ? '你的本机成绩已保留，可以在微信设置中允许查看。' : rankStatus === 'privacyDenied' ? '暂不开启也能继续找猫，本机成绩会保留。' : rankStatus === 'unsupported' ? '当前微信版本暂不支持所需授权，离线玩法仍可用。' : rankStatus === 'failed' ? '请检查网络或微信设置，再点刷新。' : rankStatus === 'idle' ? '点击下方按钮，查看好友的成绩。' : '你的本机成绩会一直保留。';
      wrap(note, area.x + 22, cy + 79, area.width - 44, 12, MUTED, 20);
    }
    if (ranking && ranking.available) {
      button(rankStatus === 'denied' ? '微信设置' : rankStatus === 'privacyDenied' ? '重新查看' : '刷新', 26, bottom - 44, w - 52, 38, () => refreshRanking(rankStatus === 'denied'), 'primary', rankStatus === 'loading');
    } else text('好友排名在微信小游戏中查看', w / 2, bottom - 24, 12, MUTED, 'center');
  }
  function drawPrivacyPrompt() {
    buttons = [];
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, w, h);
    const height = Math.min(360, bottom - top - 24), y = (top + bottom - height) / 2;
    box(20, y, w - 40, height, '#FFFDFB', 22);
    text('排行榜隐私说明', w / 2, y + 31, 20, INK, 'center', true);
    wrap('为显示排行榜，微信将托管你的积分、通关数量和用时，并在小游戏内展示好友昵称、头像和成绩。请阅读隐私保护指引后选择。', 40, y + 75, w - 80, 13, INK, 22);
    button('查看隐私保护指引', 38, y + 175, w - 76, 38, () => {
      const prompt = privacyPrompt;
      prompt.openContract(result => { if (privacyPrompt === prompt) { privacyLinkError = result.success ? '' : '暂时无法打开指引，请稍后重试'; notify(); } });
    });
    if (privacyLinkError) text(privacyLinkError, w / 2, y + 231, 11, '#B56C5B', 'center');
    button('同意并继续', 38, y + height - 109, w - 76, 44, () => { const prompt = privacyPrompt; privacyPrompt = null; prompt.agree(); notify(); }, 'primary');
    button('暂不开启', 38, y + height - 54, w - 76, 36, () => { const prompt = privacyPrompt; privacyPrompt = null; prompt.disagree(); notify(); });
  }
  function drawLevels() {
    heading('谜谜关卡', () => switchScreen('home'));
    text(levels.length + ' 关 · 由易到难 · 每题唯一解', w / 2, top + 70, 13, MUTED, 'center');
    const gap = 12, bw = (w - 52 - gap * 2) / 3, bh = Math.min(82, (bottom - top - 175) / 4 - gap), y = top + 110;
    for (let i = 0; i < 12; i++) {
      const l = levels[selectedPage * 12 + i]; if (!l) break;
      const bx = 26 + i % 3 * (bw + gap), by = y + Math.floor(i / 3) * (bh + gap), unlocked = l.id <= data.unlocked;
      button(String(l.id) + (data.completed[l.id] ? '  ✓' : unlocked ? '' : '  ·'), bx, by, bw, bh, () => chooseLevel(l.id, false), unlocked && l.id === data.unlocked ? 'active' : 'light', !unlocked);
      text(l.size + '阶 · ' + DIFFICULTY[l.difficulty], bx + bw / 2, by + bh - 14, 10, MUTED, 'center');
    }
    const fy = bottom - 54;
    button('上一页', 26, fy, 84, 40, () => { selectedPage--; notify(); }, 'light', selectedPage === 0);
    text((selectedPage + 1) + ' / ' + Math.ceil(levels.length / 12), w / 2, fy + 20, 13, MUTED, 'center');
    button('下一页', w - 110, fy, 84, 40, () => { selectedPage++; notify(); }, 'light', selectedPage >= Math.ceil(levels.length / 12) - 1);
  }
  function drawRules() {
    heading('怎么玩', () => switchScreen(returnScreen));
    if (bottom - top < 520) {
      const rows = [['01', '每行、每列各一只猫'], ['02', '每个颜色区域各一只猫'], ['03', '猫不能上下、左右或贴角相邻']];
      rows.forEach((r, i) => { const y = top + 80 + i * 55; box(24, y - 16, 32, 32, COLORS[i], 10); text(r[0], 40, y, 12, INK, 'center', true); text(r[1], 68, y, 13, INK, 'left', true); });
      wrap('单击打叉，双击放猫，滑动连续标记。\n远处的斜线可以有猫；正确猫会锁定。\n撤销只影响普通标记，红叉不能擦除。', 26, top + 254, w - 52, 12, MUTED, 21);
      button('明白了', 26, bottom - 50, w - 52, 44, () => switchScreen(returnScreen), 'primary'); return;
    }
    const y = top + 90, step = Math.min(86, (bottom - y - 160) / 4);
    const rules = [ ['01', '每行、每列各一只', '猫不能共享同一行或同一列。'], ['02', '每个颜色区域一只', '不同形状的同色格子构成一个区域。'], ['03', '猫之间不能紧挨着', '上下、左右、相邻对角格都不能接触。'], ['04', '标记帮助你排除', '单击打叉，双击放猫；滑动可连续打叉。'] ];
    rules.forEach((r, i) => {
      const ry = y + i * step;
      box(24, ry - 10, 36, 36, COLORS[i], 12); text(r[0], 42, ry + 8, 13, INK, 'center', true);
      text(r[1], 74, ry + 1, 17, INK, 'left', true); wrap(r[2], 74, ry + 29, w - 100, 12, MUTED, 18);
    });
    const ry = y + step * 4 + 5;
    wrap('远距离的斜线可以有猫。正确的猫会锁定，红叉代表放错的位置；撤销只影响普通标记。', 26, ry, w - 52, 13, MUTED, 22);
    button('明白了', 26, bottom - 56, w - 52, 48, () => switchScreen(returnScreen), 'primary');
  }

  function drawSettings() {
    const m = modal('设置', 455, () => switchScreen(returnScreen)), scale = m.height / 455, pad = 17, gap = 9, cw = (m.width - pad * 2 - gap * 2) / 3, cy = m.y + 78 * scale;
    [['music','音乐'], ['sound','音效'], ['vibrate','震动']].forEach((row, i) => {
      const x = m.x + pad + i * (cw + gap), cx = x + cw / 2;
      box(x, cy, cw, 88 * scale, '#FFFCF7', 13, '#E5D9CC'); art.icon(row[0], cx, cy + 25 * scale, 28 * scale);
      if (!data.settings[row[0]]) { ctx.strokeStyle = '#B57870'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 14, cy + 39); ctx.lineTo(cx + 14, cy + 11); ctx.stroke(); }
      text(row[1], cx, cy + 47 * scale, 10, MUTED, 'center'); toggle(row[1], row[0], x + 7, cy + 59 * scale, cw - 14);
    });
    const py = cy + 104 * scale;
    box(m.x + pad, py, m.width - pad * 2, 44 * scale, '#FFFCF7', 14, '#E5D9CC'); text('图案模式', m.x + pad + 13, py + 23 * scale, Math.max(13, 17 * scale), INK); toggle('图案模式', 'pattern', m.x + m.width - pad - 57, py + 11 * scale, 47);
    const smallY = py + 92 * scale, hw = (m.width - 48) / 2;
    touchLabel('查看玩法', m.x + 17, smallY, hw, () => { screen = 'rules'; notify(); });
    touchLabel('排行榜', m.x + 31 + hw, smallY, hw, openRanking);
    const fy = m.y + m.height - 124 * scale;
    button('反馈', m.x + 26, fy, m.width - 52, 43 * scale, () => { screen = 'feedback'; notify(); });
    button(returnScreen === 'play' ? '重新开始' : '继续', m.x + 26, fy + 57 * scale, m.width - 52, 49 * scale, () => { if (returnScreen === 'play') { screen = 'restart'; notify(); } else switchScreen(returnScreen); }, 'primary');
  }

  function drawResult() {
    buttons = []; const age = Math.max(0, p.now() - winOpenedAt), span = bottom - top;
    ctx.fillStyle = 'rgba(26,27,31,.84)'; ctx.fillRect(0, 0, w, h);
    const title = !errors.length && !revives ? '完美通关' : '找猫高手', titleY = top + span * .16, fontSize = Math.min(39, w * .105);
    ctx.save(); ctx.globalAlpha = Math.min(1, age / 400); ctx.font = '700 ' + fontSize + 'px system-ui, "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#A85719'; ctx.lineWidth = 9; ctx.strokeText(title, w / 2, titleY); ctx.strokeStyle = '#FFC736'; ctx.lineWidth = 5; ctx.strokeText(title, w / 2, titleY); ctx.fillStyle = '#FFFBF0'; ctx.fillText(title, w / 2, titleY); ctx.restore();
    const cy = top + span * .42, radius = Math.min(w * .4, span * .22);
    ctx.save(); ctx.translate(w / 2, cy); ctx.rotate(age / 9000);
    for (let k = 0; k < 14; k++) { const a = k * Math.PI / 7; ctx.fillStyle = k % 2 ? 'rgba(90,200,255,.15)' : 'rgba(204,106,255,.17)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * radius * 1.25, Math.sin(a) * radius * 1.25); ctx.lineTo(Math.cos(a + .15) * radius * 1.25, Math.sin(a + .15) * radius * 1.25); ctx.closePath(); ctx.fill(); } ctx.restore();
    const bh = Math.min(span * .37, w * .73), bw = bh * .73, bob = Math.sin(age / 700) * 3;
    if (celebrationAtlas && data.progression.animal === 'cat') ctx.drawImage(celebrationAtlas, w / 2 - bw / 2, cy - bh / 2 + bob, bw, bh);
    else { art.animal(w / 2, cy + bob, bh * .69, data.progression.animal, 1); art.icon('gift', w / 2, cy + bh * .3, 35); }
    for (let k = 0; k < 28; k++) { const x = (k * 79 % Math.round(w)), y = top + ((k * 103 + age * (.013 + k % 4 * .003)) % Math.round(span * .76)); ctx.save(); ctx.translate(x, y); ctx.rotate(k + age / 1300); ctx.fillStyle = ['#FFCC48','#F27AB0','#4AD4E3','#FF6054'][k % 4]; if (k % 3) ctx.fillRect(-2, -4, 4, 8); else text('✦', 0, 0, 12, ctx.fillStyle, 'center'); ctx.restore(); }
    const sy = top + span * .655;
    text(score.toLocaleString('en-US') + ' 分', w / 2, sy, 29, '#FFE291', 'center', true);
    if (resultScore) text('放置 ' + resultScore.placement + ' · 连对已计入', w / 2, sy + 29, 11, '#F4E9DD', 'center');
    if (resultScore) text('无误 +' + resultScore.perfectBonus + '  快速 +' + resultScore.speedBonus, w / 2, sy + 49, 11, '#F4E9DD', 'center');
    if (clearReward) {
      const unlocked = clearReward.unlocked.animals.concat(clearReward.unlocked.themes);
      text(unlocked.length ? '升级解锁新伙伴与小屋 · Lv.' + clearReward.levelAfter : clearReward.rewarded ? '经验 +' + clearReward.reward.xp + '  ·  Lv.' + clearReward.levelAfter : '已保留本关最高分', w / 2, sy + 72, 11, '#FFDB83', 'center');
    }
    const buttonH = Math.min(54, span * .09), by = bottom - buttonH - 45, next = level.id < levels.length;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (age - 913) / 363));
    button(!daily && next ? '下一关 · ' + (level.id + 1) : '再玩一次', w * .153, by, w * .694, buttonH, () => { if (!daily && next) startLevel(level.id + 1, false); else restartCurrent(); }, 'victory');
    ctx.restore();
    touchLabel('回到小屋', w / 2 - 60, bottom - 33, 120, () => switchScreen('home'), '#FFE9DA');
  }
  function drawRestart() {
    heading('重新开始', () => switchScreen('play'));
    if (bottom - top < 520) {
      cat(w / 2, top + 111, 80, false);
      text('让这一屋重新开始', w / 2, top + 183, 21, INK, 'center', true);
      wrap('清空本关的猫、标记和计时。\n已完成的关卡会保留。', 32, top + 230, w - 64, 13, MUTED, 21);
      button('重新开始这一关', 26, bottom - 113, w - 52, 46, restartCurrent, 'primary');
      button('继续当前关卡', 26, bottom - 56, w - 52, 44, () => switchScreen('play')); return;
    }
    cat(w / 2, top + 142, 95, false);
    text('让这一屋重新开始', w / 2, top + 240, 23, INK, 'center', true);
    wrap('当前关卡的猫、标记和计时将重新开始，已完成的关卡会保留。', 32, top + 285, w - 64, 14, MUTED, 23);
    const y = Math.min(top + 366, bottom - 133);
    button('重新开始这一关', 26, y, w - 52, 50, restartCurrent, 'primary');
    button('继续当前关卡', 26, y + 63, w - 52, 46, () => switchScreen('play'));
  }
  function drawNewGame() {
    const compact = bottom - top < 520;
    heading('已有未完成的棋局', () => switchScreen(returnScreen));
    cat(w / 2, top + (compact ? 106 : 140), 90, false);
    text('先继续，还是开始新题', w / 2, top + (compact ? 183 : 237), 21, INK, 'center', true);
    wrap('开始新题将替换当前续局。\n已完成的关卡和成绩会保留。', 32, top + (compact ? 230 : 282), w - 64, 13, MUTED, 21);
    const y = compact ? bottom - 113 : Math.min(top + 361, bottom - 133);
    button('开始新棋局', 26, y, w - 52, 46, () => { const target = nextGame; nextGame = null; startLevel(target.id, target.daily); }, 'primary');
    button('继续未完成棋局', 26, y + 57, w - 52, 44, resume);
  }
  function drawCheckin() {
    const span = bottom - top, tiny = span < 520, record = data.progression.checkin, signed = record.lastDate === dateKey();
    ctx.fillStyle = '#F9F2E0'; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createLinearGradient && ctx.createLinearGradient(0, 0, 0, h * .55);
    if (glow) { glow.addColorStop(0, '#F9EACD'); glow.addColorStop(1, '#F9F2E0'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h); }
    ctx.save(); ctx.translate(w * .89, top + 76); ctx.rotate(.22); ctx.globalAlpha = .28;
    box(-52, -38, 104, 104, '#FFFFFF', 14); box(-47, -14, 94, 74, '#F9EACD', 8);
    text('7', 0, 23, 58, '#FFFFFF', 'center', true); ctx.restore();
    text('每日打卡', w / 2, top + 24, 23, INK, 'center'); circleButton('返回', 32, top + 23, 36, () => switchScreen(returnScreen), 'back');
    const by = bottom - (tiny ? 50 : 66), bh = tiny ? 44 : 54, rewardY = by - 20, gap = (w - 42) / 7;
    const weekBottom = rewardY - 19, weekTop = weekBottom - 24 - gap * .7, ry = weekTop + 24 + gap * .35;
    const bestBottom = weekTop - (tiny ? 12 : 22), bestTop = bestBottom - 26;
    const labelY = bestTop - (tiny ? 17 : 24), numberSize = tiny ? 36 : 57, numberBottom = labelY - 9 - (tiny ? 8 : 15), numberY = numberBottom - numberSize / 2;
    const yarnTop = top + 54, yarnBottom = numberBottom - numberSize - 10, yarnSize = Math.min(w * .4, (yarnBottom - yarnTop) / 1.44);
    const cy = (yarnTop + yarnBottom - yarnSize * 1.44) / 2 + yarnSize * .93;
    const plant = garden.plant(w / 2, (yarnTop + yarnBottom) / 2, Math.min(w * .58, (yarnBottom - yarnTop) * .9), yarnBottom - yarnTop, record.total, p.now());
    if (!plant.drawn) art.yarn(w / 2, cy, yarnSize, !signed);
    buttons.push({ label: '打卡领奖', x: w / 2 - Math.max(34, yarnSize * .5), y: yarnTop, width: Math.max(68, yarnSize), height: yarnBottom - yarnTop, action: claimCheckin });
    text(record.streak, w / 2, numberY, numberSize, '#F49419', 'center', true);
    text(signed ? '当前打卡' : '浇水打卡，让盆栽长大', w / 2, labelY, 17, signed ? '#F49419' : INK, 'center');
    box(w / 2 - 80, bestTop, 160, 26, '#FFF', 15); text('最佳打卡：' + record.best + ' 天', w / 2, bestTop + 13, 13, INK, 'center');
    const day = signed ? (record.streak - 1) % 7 + 1 : 0;
    const firstDay = new Date((signed ? record.lastDate : dateKey()) + 'T12:00:00').getDay() - Math.max(0, day - 1);
    for (let i = 0; i < 7; i++) {
      const x = 21 + (i + .5) * gap;
      text('周' + ['日', '一', '二', '三', '四', '五', '六'][((firstDay + i) % 7 + 7) % 7], x, weekTop + 6, 11, i < day ? '#F49419' : INK, 'center');
      if (i !== 6) { box(x - gap * .35, ry - gap * .35, gap * .7, gap * .7, i < day ? '#F49419' : '#E3D7C3', gap / 2); if (i < day) art.icon('check', x, ry, gap * .6, '#FFF'); }
      else {
        art.icon('gift', x, ry, gap * .85);
        if (day === 7) { box(x + gap * .12, ry + gap * .12, gap * .35, gap * .35, '#28B966', gap); art.icon('check', x + gap * .295, ry + gap * .295, gap * .28, '#FFF'); }
        buttons.push({ label: '七日礼盒', x: x - gap / 2, y: ry - gap / 2, width: gap, height: gap, action: () => showToast('神秘礼盒~') });
      }
    }
    text(signed ? '今日已打卡' : '每天浇水，让小芽慢慢长大', w / 2, rewardY, tiny ? 10 : 11, INK, 'center');
    button(signed ? '继续' : '打卡领奖', w * .153, by, w * .694, bh, signed ? () => switchScreen(returnScreen) : claimCheckin, 'primary');
    uiLayout = { screen: 'checkin', title: { top: top + 9, bottom: top + 39 }, yarn: { top: yarnTop, bottom: yarnBottom }, number: { top: numberBottom - numberSize, bottom: numberBottom }, label: { top: labelY - 9, bottom: labelY + 9 }, best: { top: bestTop, bottom: bestBottom }, week: { top: weekTop, bottom: weekBottom }, reward: { top: rewardY - 7, bottom: rewardY + 7 }, primary: { top: by, bottom: by + bh } };
  }
  function drawProfile() {
    const m = modal('个人资料', 478, () => switchScreen(returnScreen)), scale = m.height / 478, profile = data.progression.profile, py = m.y + 91 * scale;
    avatar(m.x + 41, py, 56 * scale); box(m.x + 82, py - 22 * scale, m.width - 99, 44 * scale, '#F9EDDF', 9);
    fittedText(profile.nickname, m.x + 95, py, m.width - 156, 17, INK, true); art.icon('edit', m.x + m.width - 36, py, 24, '#BB8454');
    buttons.push({ label: '修改昵称', x: m.x + 82, y: py - 24 * scale, width: m.width - 99, height: 48 * scale, action: editNickname });
    const tabsY = m.y + 149 * scale, half = (m.width - 34) / 2;
    button('头像', m.x + 17, tabsY, half, 36 * scale, () => { profileTab = 'avatar'; notify(); }, profileTab === 'avatar' ? 'active' : 'light');
    button('头像框', m.x + 17 + half, tabsY, half, 36 * scale, () => { profileTab = 'frame'; notify(); }, profileTab === 'frame' ? 'active' : 'light');
    const gridY = tabsY + 47 * scale, slot = (m.width - 47) / 4, cell = Math.min(slot, m.height * .15), available = profileTab === 'avatar' ? progress.AVATARS : progress.FRAMES, cardHeight = cell + (profileTab === 'frame' ? 14 * scale : 0);
    box(m.x + 17, gridY - 5, m.width - 34, cardHeight * 2 + 18 * scale, '#F9EDDF', 14);
    available.forEach((item, index) => { const x = m.x + 22 + index % 4 * (slot + 2), y = gridY + Math.floor(index / 4) * (cardHeight + 8 * scale), selected = profile[profileTab] === item.id, unlocked = levelInfo().level >= item.level;
      if (profileTab === 'avatar') avatar(x + cell / 2, y + cell / 2, cell - 8, item.id, 'basic');
      else {
        box(x, y, cell, cardHeight, '#FFFCF7', 10, selected ? item.detail : '#E8DCD0');
        avatar(x + cell / 2, y + cell * .41, cell * .65, profile.avatar, item.id);
        text(item.name, x + cell / 2, y + cardHeight - 7, Math.min(10, cell / 6), INK, 'center');
      }
      if (!unlocked) { art.icon('lock', x + cell - 8, y + 11, 12); text('Lv.' + item.level, x + cell / 2, y + cell - 6, 9, MUTED, 'center'); }
      if (selected) { box(x + cell - 17, y + 2, 16, 16, '#28B966', 8); art.icon('check', x + cell - 9, y + 10, 14, '#FFF'); }
      buttons.push({ label: item.name, x, y, width: cell, height: cardHeight, action: () => selectCosmetic(profileTab, item.id) });
    });
    text('Lv.' + levelInfo().level + ' · ' + rankingScore().points.toLocaleString('en-US') + ' 积分', w / 2, m.y + m.height - 99 * scale + 6, 12, MUTED, 'center');
    button('确认', m.x + 26, m.y + m.height - 74 * scale, m.width - 52, 49 * scale, () => switchScreen(returnScreen), 'primary');
  }
  function drawWardrobe() {
    const m = modal('动物小屋', 535, () => switchScreen(returnScreen)), info = levelInfo(), tabY = m.y + 65, half = (m.width - 34) / 2;
    text('Lv.' + info.level, w / 2, m.y + 51, 10, MUTED, 'center');
    button('动物', m.x + 17, tabY, half, 32, () => { wardrobeTab = 'animal'; wardrobePage = 0; notify(); }, wardrobeTab === 'animal' ? 'active' : 'light');
    button('小屋主题', m.x + 17 + half, tabY, half, 32, () => { wardrobeTab = 'theme'; wardrobePage = Math.floor(Math.max(0, progress.THEMES.findIndex(item => item.id === data.progression.theme)) / 6); notify(); }, wardrobeTab === 'theme' ? 'active' : 'light');
    const animals = wardrobeTab === 'animal', catalog = animals ? progress.ANIMALS : progress.THEMES;
    const gap = 9, cw = (m.width - 43) / 2, rows = animals ? 4 : 3, rowH = Math.min(animals ? 80 : 100, (m.height - (animals ? 174 : 192)) / rows), gy = tabY + 45;
    const visible = animals ? catalog : catalog.slice(wardrobePage * 6, wardrobePage * 6 + 6);
    visible.forEach((item, i) => { const x = m.x + 17 + i % 2 * (cw + gap), y = gy + Math.floor(i / 2) * rowH, unlocked = info.level >= item.level, selected = data.progression[wardrobeTab] === item.id;
      box(x, y, cw, rowH - 7, selected ? '#FFF1D6' : '#FFFCF7', 12, selected ? '#E9A94D' : '#E8DDD1');
      if (animals) {
        box(x + 7, y + 7, 36, Math.max(16, rowH - 21), ['#F5D5B6', '#E9D7DE', '#D7E7D1', '#E0DEF0', '#F2DEB4', '#EDCEB2', '#D0E6D4', '#D1E6EC'][i], 10);
        art.animal(x + 26, y + (rowH - 7) / 2, Math.min(40, rowH - 12), item.id, i % 9);
        text(item.name, x + 49, y + rowH * .32, 12, INK, 'left', true); text(selected ? '使用中' : unlocked ? '点击使用' : 'Lv.' + item.level + ' 解锁', x + 49, y + rowH * .62, 11, selected ? '#C38A36' : MUTED);
      } else {
        cosmeticArt.themePreview(x + 7, y + 6, cw - 14, (rowH - 7) * .5, item);
        text(item.name, x + cw / 2, y + rowH * .66, 12, INK, 'center', true);
        text(selected ? '使用中' : unlocked ? '点击使用' : 'Lv.' + item.level + ' 解锁', x + cw / 2, y + rowH * .83, 10, selected ? '#C38A36' : MUTED, 'center');
      }
      if (!unlocked) art.icon('lock', x + cw - 12, y + (animals ? rowH * .32 : 15), 13);
      buttons.push({ label: item.name, x, y, width: cw, height: rowH - 7, action: () => selectCosmetic(wardrobeTab, item.id) });
    });
    if (!animals) {
      const pagerY = m.y + m.height - 81;
      button('上一页', m.x + 17, pagerY, 76, 26, () => { wardrobePage--; notify(); }, 'light', wardrobePage === 0);
      text((wardrobePage + 1) + ' / ' + Math.ceil(catalog.length / 6), w / 2, pagerY + 13, 11, MUTED, 'center');
      button('下一页', m.x + m.width - 93, pagerY, 76, 26, () => { wardrobePage++; notify(); }, 'light', wardrobePage >= Math.ceil(catalog.length / 6) - 1);
    }
    button('确认', m.x + 26, m.y + m.height - 48, m.width - 52, 34, () => switchScreen(returnScreen), 'primary');
  }
  function drawFeedback() {
    const m = modal('反馈', 330, () => { screen = 'settings'; notify(); });
    wrap('请选择你的建议类型。意见保存在本机，可随工程反馈给开发者。', m.x + 23, m.y + 78, m.width - 46, 13, INK, 21);
    ['操作不顺手', '界面和动物建议', '关卡或提示问题'].forEach((kind, i) => button(kind, m.x + 26, m.y + 136 + i * 50, m.width - 52, 39, () => { data.feedback = { kind, levelId: level.id, date: dateKey() }; save(); showToast('意见已保存在本机，感谢你的建议'); screen = 'settings'; notify(); }));
  }
  function render() {
    buttons = []; board = null; uiLayout = null; ctx.clearRect(0, 0, w, h); ctx.fillStyle = theme().paper; ctx.fillRect(0, 0, w, h);
    cosmeticArt.background(w, h, theme(), p.now());
    if (screen === 'home') drawHome();
    if (screen === 'ranking') drawRanking();
    if (screen === 'tutorial') tutorial.render();
    if (screen === 'play' || screen === 'fail' || screen === 'win') drawPlay();
    if (screen === 'levels') drawLevels();
    if (screen === 'rules') drawRules();
    if (['settings', 'profile', 'wardrobe', 'feedback'].includes(screen)) { if (returnScreen === 'play') drawPlay(); else drawHome(); }
    if (screen === 'settings') drawSettings();
    if (screen === 'profile') drawProfile();
    if (screen === 'wardrobe') drawWardrobe();
    if (screen === 'feedback') drawFeedback();
    if (screen === 'checkin') drawCheckin();
    if (screen === 'win') drawResult();
    if (screen === 'fail') drawFailure();
    if (screen === 'restart') drawRestart();
    if (screen === 'newgame') drawNewGame();
    if (screen === 'play' && pendingHint) drawHint();
    if (privacyPrompt) drawPrivacyPrompt();
    if (toast && toastUntil > p.now()) { const width = Math.min(w - 30, Array.from(toast).length * 12 + 28), ty = Math.max(top + 65, h * .25); box((w - width) / 2, ty, width, 43, 'rgba(65,52,47,.89)', 12); text(toast, w / 2, ty + 22, Math.min(13, (width - 18) / Array.from(toast).length), '#FFF', 'center'); }
    dirty = false;
  }
  function cellAt(x, y) {
    if (!board || x < board.x || y < board.y || x >= board.x + board.size || y >= board.y + board.size) return -1;
    return Math.floor((y - board.y) / board.cell) * board.n + Math.floor((x - board.x) / board.cell);
  }
  function inside(b, x, y) { return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height; }
  function strokeChanged(g) { return marks.length !== g.before.length || marks.some(i => !g.before.includes(i)); }
  function commitStroke(g) {
    if (g.committed) return;
    if (strokeChanged(g)) { history.push(g.before); steps++; }
    g.committed = true; save();
  }
  function paintStroke(g, cell) {
    if (cats.includes(cell) || errors.includes(cell)) return;
    if (g.value === null) g.value = !marks.includes(cell);
    markCell(cell, g.value);
  }
  function guardCell(g, raw, x, y) {
    // 对应包内默认 HOTZONE_40：跨四格后锁轴，擦叉时不保护。
    if (g.value === false) return raw;
    if (g.axisLock) {
      const lock = g.axisLock, value = lock.axis === 'row' ? y : x;
      const lo = (lock.axis === 'row' ? board.y : board.x) + lock.coordinate * board.cell;
      const overshoot = Math.max(lo - value, value - lo - board.cell, 0);
      if (overshoot <= board.cell * 100 / 108 * .4) {
        const accepted = lock.axis === 'row' ? lock.coordinate * board.n + raw % board.n : Math.floor(raw / board.n) * board.n + lock.coordinate;
        g.guardLast = accepted; return accepted;
      }
      g.axisLock = null;
      g.runAxis = lock.axis === 'row' ? 'column' : 'row';
      g.runCoordinate = lock.axis === 'row' ? raw % board.n : Math.floor(raw / board.n);
      const along = lock.axis === 'row' ? Math.floor(raw / board.n) : raw % board.n;
      g.runMin = Math.min(lock.coordinate, along); g.runMax = Math.max(lock.coordinate, along);
      g.guardLast = raw; return raw;
    }
    const last = g.guardLast === undefined ? g.cell : g.guardLast;
    const lr = Math.floor(last / board.n), lc = last % board.n, rr = Math.floor(raw / board.n), rc = raw % board.n;
    const axis = lr === rr && lc !== rc ? 'row' : lc === rc && lr !== rr ? 'column' : null;
    if (raw !== last) {
      if (!axis) g.runAxis = null;
      else {
        const coordinate = axis === 'row' ? rr : rc, along = axis === 'row' ? rc : rr, previous = axis === 'row' ? lc : lr;
        if (g.runAxis !== axis || g.runCoordinate !== coordinate) { g.runAxis = axis; g.runCoordinate = coordinate; g.runMin = Math.min(previous, along); g.runMax = Math.max(previous, along); }
        else { g.runMin = Math.min(g.runMin, along); g.runMax = Math.max(g.runMax, along); }
        if (g.value === true && g.runMax - g.runMin + 1 >= 4) g.axisLock = { axis, coordinate };
      }
    }
    g.guardLast = raw; return raw;
  }
  function pointer(event) {
    if (hidden) return;
    if (event.type === 'down') audio.unlock();
    if (screen === 'tutorial') { tutorial.pointer(event, buttons); notify(); return; }
    // 失败演出前 1.5 秒屏蔽输入，防止误触复活或重开。
    if (screen === 'fail' && p.now() - failOpenedAt < 1500) { gesture = null; return; }
    if (screen === 'ranking') {
      const area = rankBounds();
      if (event.type === 'down' && rankStatus === 'ready' && inside(area, event.x, event.y)) { gesture = { rankY: event.y }; return; }
      if (event.type === 'move' && gesture && gesture.rankY !== undefined) { ranking.scroll(gesture.rankY - event.y); gesture.rankY = event.y; return; }
      if ((event.type === 'up' || event.type === 'cancel') && gesture && gesture.rankY !== undefined) { gesture = null; return; }
    }
    const i = cellAt(event.x, event.y);
    if (event.type === 'down') {
      const btn = buttons.find(b => inside(b, event.x, event.y));
      if (btn) { lastTap = null; gesture = { button: btn }; return; }
      if (screen !== 'play' || i < 0 || errors.includes(i)) { gesture = null; lastTap = null; return; }
      if (pendingHint) { pendingHint = null; highlighted = -1; gesture = null; lastTap = null; message = '已关闭提示，继续找猫。'; notify(); return; }
      if (cats.includes(i)) {
        gesture = { cell: i, prevCell: i, before: marks.slice(), value: null, moved: false, downTime: event.time, x: event.x, y: event.y };
        lastTap = null; return;
      }
      if (mode === 'cat') { lastTap = null; gesture = { place: i }; return; }
      // 普通双击沿用的第二次按下即生效；新增单击模式在松手时提交。
      if (lastTap && lastTap.cell === i && event.time - lastTap.time <= 350) {
        lastTap = null; placeCat(i, false, false); gesture = { consumed: true }; return;
      }
      gesture = { cell: i, prevCell: i, before: marks.slice(), value: !marks.includes(i), moved: false, downTime: event.time, x: event.x, y: event.y };
      paintStroke(gesture, i); feedback = { type: gesture.value ? 'mark' : 'erase', cell: i, start: p.now(), duration: gesture.value ? 490 : 306 };
      highlighted = -1; pendingHint = null; notify();
    } else if (event.type === 'move' && gesture && gesture.before) {
      if (gesture.latched) return;
      // 离开棋盘即结束整笔，重新进入必须先松手。
      if (i < 0) { commitStroke(gesture); gesture.latched = true; lastTap = null; notify(); return; }
      // 在两个触点之间插值，快速滑过的格子也能得到同一种标记。
      const dx = event.x - gesture.x, dy = event.y - gesture.y;
      if (i !== gesture.prevCell || Math.abs(dx) + Math.abs(dy) > 4) {
        const accepted = guardCell(gesture, i, event.x, event.y), prev = gesture.prevCell;
        const dc = accepted % board.n - prev % board.n, dr = Math.floor(accepted / board.n) - Math.floor(prev / board.n);
        const count = Math.max(Math.abs(dc), Math.abs(dr));
        for (let k = 1; k <= count; k++) {
          const c = Math.round(Math.floor(prev / board.n) + dr * k / count) * board.n + Math.round(prev % board.n + dc * k / count);
          if (c >= 0 && c !== gesture.cell) { gesture.moved = true; paintStroke(gesture, c); }
        }
        gesture.prevCell = accepted; gesture.x = event.x; gesture.y = event.y; notify();
      }
    } else if ((event.type === 'up' || event.type === 'cancel') && gesture) {
      const g = gesture; gesture = null;
      if (g.button && event.type === 'up' && inside(g.button, event.x, event.y)) { audio.event('click'); g.button.action(); }
      if (g.place !== undefined && event.type === 'up' && i === g.place) placeCat(g.place, false);
      if (g.before) {
        if (event.type === 'cancel' && !g.committed) { marks = g.before; feedback = null; lastTap = null; }
        else {
          commitStroke(g);
          lastTap = !g.moved && !g.latched && !cats.includes(g.cell) && i === g.cell ? { cell: i, time: g.downTime } : null;
        }
        notify();
      }
    }
  }
  p.onPointer(pointer);
  p.onHide(() => {
    if (screen === 'ranking') { if (!privacyPrompt) rankRequest++; if (ranking && ranking.available) ranking.hide(); }
    if (screen === 'tutorial') tutorial.cancel();
    if (gesture && gesture.before && !gesture.committed) { marks = gesture.before; if (feedback && ['mark', 'erase'].includes(feedback.type)) feedback = null; }
    gesture = null; lastTap = null; pauseClock(); audio.pause(); hidden = true; hiddenAt = p.now(); save();
  });
  p.onShow(() => {
    if (hidden && feedback) feedback.start += p.now() - hiddenAt;
    if (hidden && pendingHint) pendingHint.openedAt += p.now() - hiddenAt;
    if (hidden && screen === 'fail') failOpenedAt += p.now() - hiddenAt;
    if (hidden && screen === 'win') winOpenedAt += p.now() - hiddenAt;
    hidden = false; refreshDailyTools(); audio.resume(); if (screen === 'play' && anchor === null) anchor = p.now();
    if (screen === 'ranking' && ranking && ranking.available) { if (privacyPrompt) rankStatus = 'loading'; else if (rankGranted) showRankingList(++rankRequest); else rankStatus = 'idle'; }
    notify();
  });
  function frame() {
    if (stopped) return;
    if (!hidden && p.now() >= nextToolCheck) { nextToolCheck = p.now() + 1000; refreshDailyTools(); }
    const second = Math.floor(clock() / 1000);
    if (screen === 'play' && second !== shownSecond) { shownSecond = second; dirty = true; }
    if (!hidden && feedback) { dirty = true; if (p.now() - feedback.start >= feedback.duration) feedback = null; }
    if (!hidden && toast) { dirty = true; if (p.now() >= toastUntil) toast = ''; }
    if (!hidden && (pendingHint || ['fail', 'win', 'tutorial', 'ranking'].includes(screen))) dirty = true;
    if (!hidden && ['home', 'checkin'].includes(screen) && p.now() - lastAmbientFrame >= 100) { lastAmbientFrame = p.now(); dirty = true; }
    if (!hidden && dirty) render();
    p.requestFrame(frame);
  }
  submitRankingScore(); render(); notify(); p.requestFrame(frame);
  // 控制器用于自动验证；浏览器页面不暴露答案或调试全局变量。
  return {
    startLevel, startTutorial, resume, placeCat, toggleMark, hint, locate, revive, undo, render, pointer, dailyLevel, openRanking,
    openPage, switchScreen, claimCheckin, selectCosmetic, setSetting, editNickname,
    getState: () => Object.assign({ screen, levelId: level.id, daily, cats: cats.slice(), marks: marks.slice(), errors: errors.slice(), hearts, hints, steps, locates, revives, score, combo, manual, assisted, progression: JSON.parse(JSON.stringify(data.progression)), settings: Object.assign({}, data.settings), resultScore: resultScore && Object.assign({}, resultScore), clearReward: clearReward && JSON.parse(JSON.stringify(clearReward)), pendingHint: pendingHint && Object.assign({}, pendingHint), feedback: feedback && Object.assign({}, feedback), elapsed: clock(), mode, unlocked: data.unlocked, message, ranking: { status: rankStatus, score: rankingScore(), area: rankBounds(), privacyPending: !!privacyPrompt }, board: board && Object.assign({}, board), layout: uiLayout && JSON.parse(JSON.stringify(uiLayout)), buttons: buttons.map(b => ({ label: b.label, x: b.x, y: b.y, width: b.width, height: b.height })) }, screen === 'tutorial' ? Object.assign({ errors: [], daily: false, elapsed: 0, hints: 0, steps: 0, locates: 0, revives: 0, mode: 'mark' }, tutorial.getState()) : {}),
    stop: () => { rankRequest++; stopped = true; audio.destroy(); inputUI.destroy(); if (privacyPrompt) { const prompt = privacyPrompt; privacyPrompt = null; prompt.disagree(); } if (ranking && ranking.available) ranking.hide(); pauseClock(); save(); }
  };
}

module.exports = { startGame };

},
"quotes":function(module,exports,require){
'use strict';

// 只收录核对过原典的公版名言；简繁转换与标点整理不改变原句含义。
const QUOTES = [
  { text: '三人行，必有我师焉。择其善者而从之，其不善者而改之。', author: '孔子', work: '《论语·述而》', source: 'https://zh.wikisource.org/wiki/論語/述而第七' },
  { text: '吾尝终日而思矣，不如须臾之所学也；吾尝跂而望矣，不如登高之博见也。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '故不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '骐骥一跃，不能十步；驽马十驾，功在不舍。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '锲而舍之，朽木不折；锲而不舍，金石可镂。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '天下难事，必作于易；天下大事，必作于细。', author: '老子', work: '《道德经》第六十三章', source: 'https://zh.wikisource.org/wiki/道德經_(王弼本)#六十三章' },
  { text: '合抱之木，生于毫末；九层之台，起于累土；千里之行，始于足下。', author: '老子', work: '《道德经》第六十四章', source: 'https://zh.wikisource.org/wiki/道德經_(王弼本)#六十四章' },
  { text: '夫君子之行，静以修身，俭以养德；非淡泊无以明志，非宁静无以致远。', author: '诸葛亮', work: '《诫子书》', source: 'https://zh.wikisource.org/zh-hans/戒子' },
  { text: '默而识之，学而不厌，诲人不倦，何有于我哉？', author: '孔子', work: '《论语·述而》', source: 'https://zh.wikisource.org/wiki/論語/述而第七' },
  { text: '博观而约取，厚积而薄发，吾告子止于此矣。', author: '苏轼', work: '《稼说送张琥》', source: 'https://zh.wikisource.org/wiki/稼說（送張琥）' }
];

function pickQuote(random = Math.random) {
  const value = random();
  const index = Number.isFinite(value) ? Math.max(0, Math.min(QUOTES.length - 1, Math.floor(value * QUOTES.length))) : 0;
  return QUOTES[index];
}

module.exports = { QUOTES, pickQuote };

},
"splash":function(module,exports,require){
'use strict';

const { createArt } = require('./art.js');

function capsule(ctx, x, y, width, height, color) {
  if (width <= 0) return;
  const radius = Math.min(height / 2, width / 2);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.fill();
}

function linesFor(ctx, value, width) {
  const lines = []; let line = '';
  for (const char of Array.from(value)) {
    if (char === '\n') { lines.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + char).width > width) {
      if ('，。！？；：、”’）》'.includes(char) && Array.from(line).length > 1) {
        const characters = Array.from(line), tail = [characters.pop()];
        while (characters.length > 1 && '，。！？；：、”’）》'.includes(tail[0])) tail.unshift(characters.pop());
        lines.push(characters.join('')); line = tail.join('') + char;
      } else { lines.push(line); line = char; }
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

// 短屏缩放文字，保留进度、猫头像和标志的相对位置。
function drawLoading(p, state) {
  state = state || {};
  const ctx = p.ctx, width = p.width, height = p.height;
  const safeTop = p.safeTop || 0, safeBottom = p.safeBottom || 0;
  const scale = width / 1080, bottom = height - safeBottom;
  const quote = state.quote || { text: '', author: '' };
  const value = Number.isFinite(state.progress) ? Math.max(0, Math.min(1, state.progress)) : 0;
  const left = 90 * scale, textWidth = 900 * scale;
  const trackTop = bottom - 502 * scale, trackHeight = 38 * scale;
  const barTop = trackTop + 4 * scale, barHeight = 32 * scale;
  const fillRight = left + textWidth * value;
  const catWidth = 86 * scale, catHeight = catWidth * 80 / 88;
  const catTop = bottom - 598 * scale;
  const logoWidth = 1180 * .31 * scale, logoHeight = logoWidth * (state.logo ? state.logo.height / state.logo.width : 1184 / 1328);
  const logoTop = barTop + barHeight + 104 * scale, logoLeft = (width - logoWidth) / 2;
  const quoteTop = safeTop + Math.min(362 * scale, (bottom - safeTop) * .158);
  const maxQuoteHeight = catTop - quoteTop - Math.max(16, 30 * scale);
  let fontSize = 80 * scale, authorSize = 70 * scale, lineHeight, lines;
  const content = '“' + String(quote.text || '').replace(/^[“"]|[”"]$/g, '') + '”';
  // 按真实字体宽度换行，避免中文标点独占一行；安全区较小时逐步收紧字号。
  do {
    ctx.font = '500 ' + fontSize + 'px system-ui';
    lines = linesFor(ctx, content, textWidth);
    lineHeight = fontSize * 1.5;
    authorSize = fontSize * .875;
    if (lines.length * lineHeight + authorSize + fontSize * .55 <= maxQuoteHeight || fontSize <= 17) break;
    fontSize -= .5;
  } while (true);
  const quoteBottom = quoteTop + lines.length * lineHeight;
  const authorTop = quoteBottom + fontSize * .55;
  ctx.save(); ctx.fillStyle = '#F7F2EE'; ctx.fillRect(0, 0, width, height);
  ctx.font = '500 ' + fontSize + 'px system-ui'; ctx.fillStyle = '#935A5A'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((line, index) => ctx.fillText(line, left, quoteTop + index * lineHeight));
  ctx.font = '400 ' + authorSize + 'px system-ui'; ctx.fillStyle = '#A37676'; ctx.textAlign = 'right';
  ctx.fillText('- ' + String(quote.author || ''), width - left, authorTop);
  capsule(ctx, left - 3 * scale, trackTop, textWidth + 6 * scale, trackHeight, '#E5DEDA');
  capsule(ctx, left, barTop, textWidth * value, barHeight, '#F19320');
  const catCenterX = fillRight, catCenterY = catTop + catHeight / 2;
  if (state.catFace) ctx.drawImage(state.catFace, catCenterX - catWidth / 2, catTop, catWidth, catHeight);
  else {
    const text = (str, x, y, size, color) => {
      ctx.font = '500 ' + size + 'px system-ui'; ctx.fillStyle = color;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, x, y);
    };
    createArt(ctx, () => {}, text, () => state.catAtlas).animal(catCenterX, catCenterY, catWidth, 'cat', 0);
  }
  if (state.logo) ctx.drawImage(state.logo, logoLeft, logoTop, logoWidth, logoHeight);
  else {
    // 位图下载前保留相同标志占位，不阻塞首帧绘制。
    ctx.font = '900 ' + logoWidth * .25 + 'px system-ui'; ctx.fillStyle = '#8D5B3B'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('喵喵', width / 2, logoTop); ctx.fillText('谜谜', width / 2, logoTop + logoHeight * .33);
    ctx.fillText('小屋', width / 2, logoTop + logoHeight * .66);
  }
  ctx.restore();
  return {
    screen: 'loading',
    quote: { left, right: width - left, top: quoteTop, bottom: quoteBottom, fontSize, lines },
    author: { left, right: width - left, top: authorTop, bottom: authorTop + authorSize, fontSize: authorSize },
    cat: { left: catCenterX - catWidth / 2, right: catCenterX + catWidth / 2, top: catTop, bottom: catTop + catHeight },
    progress: { left, right: width - left, top: trackTop, bottom: trackTop + trackHeight, value, fillRight },
    logo: { left: logoLeft, right: logoLeft + logoWidth, top: logoTop, bottom: logoTop + logoHeight }
  };
}

module.exports = { drawLoading };

},
"boot":function(module,exports,require){
'use strict';

const { createPlatform } = require('./platform.js');
const { startGame } = require('./game.js');
const { pickQuote } = require('./quotes.js');
const { drawLoading } = require('./splash.js');
const originalLevels = require('./level-data.js');

// 启动页只负责资源准备；完成后交给原有游戏控制器，计时与存档从那时开始。
function startApp(options = {}) {
  const p = options.platform || createPlatform(options);
  const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
  const quote = pickQuote(options.random || Math.random);
  const minimum = options.minDurationMs === undefined ? 3000 : Math.max(0, options.minDurationMs);
  const base = ['assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png'];
  const brand = ['splash-assets/garden-logo.png', 'splash-assets/loading-cat.png'];
  const tasks = base.concat(['splash-package'], brand), settled = new Set(), images = {}, failed = [];
  let game = null, stopped = false, hidden = false, hiddenAt = 0;
  let started = p.now(), previous = started, displayed = 0, finishAt = null, finishFrom = 0, layout = null, lastPercent = -1;

  function state() {
    if (game) return game.getState();
    return { screen: 'loading', quote: Object.assign({}, quote), progress: displayed, completed: settled.size,
      total: tasks.length, failed: failed.slice(), layout: layout && JSON.parse(JSON.stringify(layout)) };
  }
  function render() {
    if (stopped) return;
    if (game) { game.render(); return; }
    layout = drawLoading(p, { quote, progress: displayed, catAtlas: images[base[0]],
      logo: images[brand[0]], catFace: images[brand[1]] });
  }
  function notify() {
    const percent = Math.floor(displayed * 100);
    if (percent !== lastPercent && options.onState) { lastPercent = percent; options.onState(state()); }
  }
  function settle(name, ok) {
    if (stopped || game || settled.has(name)) return;
    settled.add(name);
    if (!ok) failed.push(name);
  }
  function loadImage(name) {
    if (!p.loadImage) { settle(name, false); return; }
    try {
      p.loadImage(name, bitmap => {
        if (stopped || game || settled.has(name)) return;
        images[name] = bitmap; settle(name, !!bitmap);
      });
    } catch (_) { settle(name, false); }
  }
  function loadBrand() {
    if (stopped || game || settled.has('splash-package')) return;
    settle('splash-package', true);
    brand.forEach(loadImage);
  }
  function enter() {
    if (stopped || game || hidden) return;
    // 已载入位图交给游戏复用；失败的位图由原游戏加载流程再次尝试。
    const platform = Object.assign({}, p, { loadImage(name, done) {
      if (images[name]) { done(images[name]); return images[name]; }
      if (p.loadImage) return p.loadImage(name, done);
      done(null); return null;
    } });
    game = startGame(Object.assign({}, options, { platform, levels: originalLevels, brandLogo: images[brand[0]] }));
    if (options.onReady) options.onReady(game);
  }
  function frame() {
    if (stopped || game) return;
    if (hidden) { p.requestFrame(frame); return; }
    const now = p.now(), delta = Math.max(0, now - previous); previous = now;
    // 超时或图片失败时仍能进入基础画面，避免启动页永远卡住。
    if (now - started >= 8000) tasks.forEach(name => { if (!settled.has(name)) settle(name, false); });
    const target = settled.size / tasks.length;
    if (finishAt !== null) displayed = finishFrom + (1 - finishFrom) * Math.max(0, Math.min(1, (now - finishAt) / 100));
    else displayed = Math.min(target, displayed + (1 - displayed) * Math.min(1, minimum ? delta / minimum : 1));
    if (settled.size === tasks.length && now - started >= minimum && finishAt === null) {
      finishAt = now; finishFrom = displayed;
    }
    render(); notify();
    if (finishAt !== null && displayed >= 1 && now - finishAt >= 100) enter();
    else p.requestFrame(frame);
  }
  p.onHide(() => { if (!game && !stopped && !hidden) { hidden = true; hiddenAt = p.now(); } });
  p.onShow(() => {
    if (!game && !stopped && hidden) {
      const pause = Math.max(0, p.now() - hiddenAt); started += pause;
      if (finishAt !== null) finishAt += pause;
      previous = p.now(); hidden = false;
    }
  });
  render(); notify();
  base.forEach(loadImage);
  if (wechat && typeof wechat.loadSubpackage === 'function') {
    try {
      wechat.loadSubpackage({ name: 'splash', success: loadBrand, fail() {
        settle('splash-package', false); brand.forEach(name => settle(name, false));
      } });
    } catch (_) { settle('splash-package', false); brand.forEach(name => settle(name, false)); }
  } else loadBrand();
  p.requestFrame(frame);
  return { getState: state, render, stop() { stopped = true; if (game) game.stop(); } };
}

module.exports = { startApp };

}};
const cache={};
function load(name){
  if(name.startsWith('./')) name=name.slice(2);
  if(name.endsWith('.js')) name=name.slice(0,-3);
  if(!cache[name]){const m={exports:{}};cache[name]=m;factories[name](m,m.exports,load);}
  return cache[name].exports;
}
const canvas=document.getElementById('game');
const status=document.getElementById('status');
const mobile=window.innerWidth<=760;
const width=mobile?Math.min(390,window.innerWidth):390;
const height=mobile?window.innerHeight:Math.min(780,Math.max(568,window.innerHeight-56));
canvas.style.height=height+'px';canvas.style.aspectRatio='auto';
const names={loading:'正在进入小屋',home:'小屋首页',ranking:'排行榜',tutorial:'新手教学',play:'正在找猫',levels:'选择关卡',rules:'玩法说明',settings:'小屋设置',profile:'个人资料',wardrobe:'动物小屋',checkin:'每日打卡',feedback:'反馈',win:'猫咪都到家了',fail:'再试一次',restart:'重新开始',newgame:'已有未完成的棋局'};
let restoreScreen='';
try{restoreScreen=window.sessionStorage.getItem('miaoge-resize-screen')||'';window.sessionStorage.removeItem('miaoge-resize-screen');}catch(_){}
const app=load('boot').startApp({canvas,width,height,onState:s=>{
  canvas.setAttribute('aria-label',s.screen==='loading'?'启动加载页：随机名言、猫头像和资源进度条。':'找猫棋盘。单击标记，双击放猫，也可切换放置模式。');
  status.textContent=names[s.screen]+(s.screen==='loading'?' · '+Math.floor(s.progress*100)+'% · '+s.quote.text+' — '+s.quote.author:'')+(s.screen==='play'?' · 第'+s.levelId+'关 · 分数'+s.score+' · 已找到'+s.cats+'/'+s.size+' · 剩余'+s.hearts+'份生命':'')+(s.message&&['play','tutorial'].includes(s.screen)?'。'+s.message:'');
},onReady:game=>{
  if(['play','fail'].includes(restoreScreen)) game.resume();
  else if(['checkin','profile','wardrobe','settings'].includes(restoreScreen)) game.openPage(restoreScreen);
}});
// 大幅调整预览窗口时保存并重新适配，输入昵称时不打断键盘。
let resizeTimer;
const originalWidth=window.innerWidth, originalHeight=window.innerHeight;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if(document.activeElement&&document.activeElement.tagName==='INPUT') return;
    if(window.innerWidth===originalWidth&&Math.abs(window.innerHeight-originalHeight)<80) return;
    const state=app.getState();app.stop();
    try{window.sessionStorage.setItem('miaoge-resize-screen',state.screen);}catch(_){}
    window.location.reload();
  },180);
});
})();
