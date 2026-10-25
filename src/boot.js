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
