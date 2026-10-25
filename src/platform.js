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
