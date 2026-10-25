'use strict';

const ranking = require('./ranking');
const { createScoreSync } = require('./sync');

function createRankingView(api) {
  const canvas = api.getSharedCanvas(), ctx = canvas.getContext('2d'), avatars = new Map();
  let visible = false, generation = 0, width = 1, height = 1, ratio = 1, offset = 0;
  let status = 'loading', rows = [], ownScore = { points: 0, completed: 0, totalTimeMs: 0 }, ownSource = '本机';
  let requestId = null, waitingToken = null;
  const headerHeight = 40, footerHeight = 68, rowHeight = 74;
  const ink = '#935A5A', muted = '#A19189', blue = '#4AA3DB';
  const sync = createScoreSync(api, result => {
    if (result.cloud) ownScore = ranking.bestScore(ownScore, result.cloud);
    ownSource = result.state === 'loading' ? '同步中' : result.state === 'failed' ? '同步失败 · 稍后重试' :
      result.cloud ? '微信已同步' : '本机';
    if (visible) draw();
  }, () => {
    if (waitingToken !== null && current(waitingToken)) {
      const token = waitingToken; waitingToken = null; fetchFriends(token);
    }
  });

  function text(value, x, y, size, color, align) {
    ctx.font = size + 'px sans-serif'; ctx.fillStyle = color || ink;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
  }

  function shorten(value, maxWidth) {
    const chars = Array.from(value || '微信用户');
    if (ctx.measureText(chars.join('')).width <= maxWidth) return chars.join('');
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
    return chars.join('') + '…';
  }

  function avatar(url, x, y, token) {
    ctx.fillStyle = '#F5E4D5'; ctx.beginPath(); ctx.arc(x + 20, y + 20, 20, 0, Math.PI * 2); ctx.fill();
    if (!/^https:\/\//i.test(url) || !api.createImage) { text('喵', x + 20, y + 20, 17, ink, 'center'); return; }
    let entry = avatars.get(url);
    if (!entry) {
      const image = api.createImage(); entry = { image, ready: false, failed: false, waiting: new Set() };
      avatars.set(url, entry);
      image.onload = () => { entry.ready = true; if (visible && entry.waiting.has(generation)) draw(); entry.waiting.clear(); };
      image.onerror = () => { entry.failed = true; entry.waiting.clear(); };
      entry.waiting.add(token); image.src = url;
      if (avatars.size > 100) {
        for (const [key, cached] of avatars) {
          if (key !== url && (cached.ready || cached.failed)) { avatars.delete(key); break; }
        }
      }
    }
    if (entry.ready) {
      ctx.save(); ctx.beginPath(); ctx.arc(x + 20, y + 20, 20, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(entry.image, x, y, 40, 40); ctx.restore();
    } else {
      entry.waiting.add(token); text('喵', x + 20, y + 20, 17, ink, 'center');
    }
  }

  function draw() {
    if (!visible) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
    const footerY = Math.max(headerHeight, height - footerHeight), listHeight = Math.max(0, footerY - headerHeight);
    ctx.fillStyle = '#F7F2EF'; ctx.fillRect(0, 0, width, headerHeight);
    text('名次', 24, 20, 12, muted, 'center'); text('玩家', 58, 20, 12, muted);
    text('积分 / 关卡 · 用时', width - 12, 20, 12, muted, 'right');
    ctx.save(); ctx.beginPath(); ctx.rect(0, headerHeight, width, listHeight); ctx.clip();
    if (status !== 'ready' || rows.length === 0) {
      const label = status === 'loading' ? '正在读取朋友成绩…' : status === 'failed' ? '暂时无法读取朋友成绩' : '还没有朋友成绩';
      text(label, width / 2, headerHeight + listHeight / 2 - 12, 16, ink, 'center');
      const detail = status === 'failed' ? '请检查微信授权与网络后重试' : status === 'empty' ? '朋友玩过并同步成绩后会出现在这里' : '';
      if (detail) text(detail, width / 2, headerHeight + listHeight / 2 + 16, 12, muted, 'center');
    } else {
      const first = Math.floor(offset / rowHeight), last = Math.min(rows.length, Math.ceil((offset + listHeight) / rowHeight));
      for (let index = first; index < last; index++) {
        const row = rows[index], y = headerHeight + index * rowHeight - offset;
        ctx.fillStyle = index % 2 ? '#FFFCFA' : '#FFFFFF'; ctx.fillRect(0, y, width, rowHeight);
        text(row.rank, 24, y + 35, 18, row.rank <= 3 ? blue : ink, 'center');
        avatar(row.avatarUrl, 48, y + 16, generation);
        const points = ranking.formatPoints(row.points) + ' 分';
        ctx.font = '17px sans-serif'; const scoreWidth = ctx.measureText(points).width;
        ctx.font = '15px sans-serif';
        text(shorten(row.nickname, Math.max(24, width - scoreWidth - 124)), 98, y + 27, 15, ink);
        text(points, width - 12, y + 26, 17, blue, 'right');
        text(row.completed + ' 关 · ' + ranking.formatTime(row.totalTimeMs), width - 12, y + 49, 13, muted, 'right');
      }
    }
    ctx.restore();
    ctx.fillStyle = '#DFEFFF'; ctx.fillRect(0, footerY, width, footerHeight);
    text('我', 18, footerY + 24, 17, ink);
    text(ownSource, 18, footerY + 48, 11, muted);
    text(ranking.formatPoints(ownScore.points) + ' 分', width - 14, footerY + 23, 19, blue, 'right');
    text(ownScore.completed + ' 关 · ' + ranking.formatTime(ownScore.totalTimeMs), width - 14, footerY + 48, 13, muted, 'right');
    // 未拿到本人 openid，不推测本人在好友榜中的身份与名次。
  }

  function current(token) { return visible && generation === token; }

  function show(message) {
    generation++; visible = true; const token = generation; requestId = message.requestId;
    width = Math.max(160, Math.min(2048, Number(message.width) || 320));
    height = Math.max(160, Math.min(4096, Number(message.height) || 400));
    ratio = Math.max(1, Math.min(4, Number(message.pixelRatio) || 1));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    offset = 0; rows = []; status = 'loading';
    ownScore = ranking.normalizeScore(message.ownScore) || { points: 0, completed: 0, totalTimeMs: 0 };
    ownSource = '本机'; waitingToken = token; draw();
    sync.submit(ownScore);
  }

  function fetchFriends(token) {
    if (typeof api.getFriendCloudStorage !== 'function') { status = 'failed'; draw(); return; }
    try {
      api.getFriendCloudStorage({ keyList: [ranking.STORAGE_KEY], success(res) {
        if (!current(token)) return;
        if (!res || !Array.isArray(res.data)) { status = 'failed'; draw(); return; }
        rows = ranking.makeRanking(res.data); status = rows.length ? 'ready' : 'empty'; draw();
      }, fail() { if (current(token)) { status = 'failed'; draw(); } } });
    } catch (_) { if (current(token)) { status = 'failed'; draw(); } }
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'rank:show') show(message);
    else if (message.type === 'rank:submit') sync.submit(message.score);
    else if (message.type === 'rank:hide') {
      visible = false; waitingToken = null; generation++;
      avatars.forEach(entry => entry.waiting.clear());
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (message.type === 'rank:scroll' && visible && Number.isFinite(message.delta)) {
      const max = Math.max(0, rows.length * rowHeight - Math.max(0, height - headerHeight - footerHeight));
      offset = Math.max(0, Math.min(max, offset + message.delta)); draw();
    }
  }

  api.onMessage(onMessage);
  return { onMessage, getState: () => ({ visible, requestId, status, offset, width, height, pixelRatio: ratio, rows: rows.map(row => Object.assign({}, row)), ownScore: Object.assign({}, ownScore), ownSource, sync: sync.getState() }) };
}

module.exports = { createRankingView };
