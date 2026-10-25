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
