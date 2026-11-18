'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const progress = require('../src/progression.js');

const DIMENSIONS = [
  { width: 320, height: 520, safeTop: 80, safeBottom: 34 },
  { width: 320, height: 568, safeTop: 80, safeBottom: 34 },
  { width: 363, height: 607, safeTop: 0, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 80, safeBottom: 34 },
  { width: 390, height: 844, safeTop: 0, safeBottom: 0 },
  { width: 430, height: 932, safeTop: 54, safeBottom: 34 }
];
const EPSILON = 0.001;

// 从真实绘制过程读取布局块和文字，不使用真实玩家存档。
function setup(dimensions) {
  const drawnText = [], filledShapes = [], context = {}, transforms = [];
  let matrix = [1, 0, 0, 1, 0, 0], path = [];
  function point(x, y) { return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }; }
  function addPoint(x, y) { path.push(point(x, y)); }
  function recordShape(points) {
    if (!points.length) return;
    filledShapes.push({ color: context.fillStyle,
      left: Math.min(...points.map(item => item.x)), right: Math.max(...points.map(item => item.x)),
      top: Math.min(...points.map(item => item.y)), bottom: Math.max(...points.map(item => item.y)) });
  }
  // 记录 Canvas 实际路径变换，用图标填充区域检查文字碰撞。
  context.save = () => transforms.push(matrix.slice());
  context.restore = () => { matrix = transforms.pop() || [1, 0, 0, 1, 0, 0]; };
  context.translate = (x, y) => { const translated = point(x, y); matrix[4] = translated.x; matrix[5] = translated.y; };
  context.scale = (x, y) => { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; };
  context.rotate = angle => {
    const [a, b, c, d] = matrix, cosine = Math.cos(angle), sine = Math.sin(angle);
    matrix[0] = a * cosine + c * sine; matrix[1] = b * cosine + d * sine;
    matrix[2] = c * cosine - a * sine; matrix[3] = d * cosine - b * sine;
  };
  context.beginPath = () => { path = []; };
  context.moveTo = context.lineTo = addPoint;
  context.quadraticCurveTo = (cx, cy, x, y) => { addPoint(cx, cy); addPoint(x, y); };
  context.bezierCurveTo = (ax, ay, bx, by, x, y) => { addPoint(ax, ay); addPoint(bx, by); addPoint(x, y); };
  context.rect = (x, y, width, height) => { addPoint(x, y); addPoint(x + width, y); addPoint(x + width, y + height); addPoint(x, y + height); };
  context.arc = (x, y, radius) => { addPoint(x - radius, y - radius); addPoint(x + radius, y + radius); };
  context.ellipse = (x, y, rx, ry) => { addPoint(x - rx, y - ry); addPoint(x + rx, y + ry); };
  context.fill = () => recordShape(path);
  context.fillRect = (x, y, width, height) => recordShape([point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)]);
  function fontSize() {
    const match = String(context.font || '').match(/([\d.]+)px/);
    return match ? Number(match[1]) : 0;
  }
  context.fillText = (value, x, y) => drawnText.push({ value: String(value), x, y, size: fontSize(),
    width: context.measureText(value).width, align: context.textAlign, color: context.fillStyle });
  context.measureText = value => ({ width: Array.from(String(value)).reduce((sum, char) => sum + fontSize() * (/^[\x00-\x7F]$/.test(char) ? 0.55 : 1), 0) });
  context.createRadialGradient = context.createLinearGradient = () => ({ addColorStop() {} });
  const ctx = new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
  let stored = { unlocked: 1, completed: {}, daily: {}, tutorialDone: true };
  const platform = Object.assign({
    ctx, now: () => Date.UTC(2026, 9, 13, 8), requestFrame() {}, vibrate() {},
    onPointer() {}, onHide() {}, onShow() {},
    storage: {
      get: () => structuredClone(stored),
      set: (_, value) => { stored = structuredClone(value); return true; }
    }
  }, dimensions);
  const audio = new Proxy({}, { get: () => () => {} });
  const game = startGame({ platform, audio, inputUI: { editNickname() {}, destroy() {} } });
  function render() {
    drawnText.length = 0; filledShapes.length = 0;
    game.render();
    return game.getState();
  }
  return { game, platform, drawnText, filledShapes, render };
}

function name(dimensions) {
  return `${dimensions.width}×${dimensions.height}，安全区 ${dimensions.safeTop}/${dimensions.safeBottom}`;
}

function assertBlock(block, dimensions, label) {
  assert.ok(block && Number.isFinite(block.top) && Number.isFinite(block.bottom), label + ' 有真实绘制位置');
  assert.ok(block.top <= block.bottom + EPSILON, label + ' 高度非负');
  assert.ok(block.top >= dimensions.safeTop - EPSILON, label + ' 不进入顶部安全区');
  assert.ok(block.bottom <= dimensions.height - dimensions.safeBottom + EPSILON, label + ' 不进入底部安全区');
}

function assertSequence(layout, keys, dimensions) {
  let previous = null;
  for (const key of keys) {
    const block = layout[key];
    if (block === null) continue;
    assertBlock(block, dimensions, key);
    if (previous) assert.ok(previous.block.bottom <= block.top + EPSILON,
      previous.key + ' 与 ' + key + ' 不交叠：' + JSON.stringify([previous.block, block]));
    previous = { key, block };
  }
}

function assertButtonsSafe(state, dimensions) {
  for (const button of state.buttons) {
    assert.ok(button.width > 0 && button.height > 0, button.label + ' 命中区域为正');
    assert.ok(button.x >= -EPSILON && button.x + button.width <= dimensions.width + EPSILON, button.label + ' 水平不越界');
    assert.ok(button.y >= dimensions.safeTop - EPSILON && button.y + button.height <= dimensions.height - dimensions.safeBottom + EPSILON,
      button.label + ' 保留上下安全区');
  }
}

function assertMainButtonFont(env, state, block, label) {
  const button = state.buttons.find(item => item.y >= block.top - EPSILON && item.y + item.height <= block.bottom + EPSILON);
  assert.ok(button, label + ' 有可点击的主按钮');
  const texts = env.drawnText.filter(item => item.value === button.label && item.x >= button.x && item.x <= button.x + button.width && item.y >= button.y && item.y <= button.y + button.height);
  assert.ok(texts.length, label + ' 主按钮文字实际绘制');
  for (const text of texts) assert.ok(text.size >= 17 - EPSILON, label + ' 短主按钮字号至少 17px，实际 ' + text.size);
}

test('头像框的名称、解锁等级分行，八张卡片不遮挡积分与确认按钮', () => {
  for (const dimensions of DIMENSIONS) {
    const env = setup(dimensions);
    try {
      env.game.openPage('profile'); let state = env.render();
      const tab = state.buttons.find(item => item.label === '头像框');
      const point = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2, time: env.platform.now() };
      env.game.pointer({ ...point, type: 'down' }); env.game.pointer({ ...point, type: 'up' });
      state = env.render(); assertButtonsSafe(state, dimensions);
      const info = env.drawnText.find(item => item.value.endsWith(' 积分'));
      const confirm = state.buttons.find(item => item.label === '确认');
      assert.ok(info.y + info.size / 2 <= confirm.y, '积分不与确认按钮交叠');
      for (const item of progress.FRAMES) {
        const card = state.buttons.find(button => button.label === item.name);
        const title = env.drawnText.find(text => text.value === item.name);
        assert.ok(card && title); assert.ok(card.y + card.height <= info.y - info.size / 2, name(dimensions) + ' ' + item.name + ' 不遮挡积分：' + JSON.stringify({ cardBottom: card.y + card.height, infoTop: info.y - info.size / 2 }));
        if (item.level > 1) {
          const label = env.drawnText.find(text => text.value === 'Lv.' + item.level && text.x === title.x && text.y >= card.y && text.y <= card.y + card.height);
          assert.ok(label); assert.ok(label.y + label.size / 2 <= title.y - title.size / 2, item.name + ' 等级与名称不交叠');
        }
      }
    } finally { env.game.stop(); }
  }
});

test('各竖屏尺寸玩法按规则、动物进度、棋盘、道具、操作栏排列，高阶方格至少 25px', () => {
  const level = levels.find(item => item.size === 9);
  assert.ok(level, '存在九阶关卡');
  for (const dimensions of DIMENSIONS) {
    const env = setup(dimensions);
    try {
      env.game.startLevel(level.id);
      const state = env.render(), layout = state.layout;
      assert.ok(layout, name(dimensions) + ' 提供绘制布局');
      assert.equal(layout.screen, 'play');
      assertSequence(layout, ['rules', 'progress', 'board', 'tools', 'actions'], dimensions);
      assert.ok(state.board.cell >= 25 - EPSILON, name(dimensions) + ' 九阶格长至少 25px，实际 ' + state.board.cell);
      assertButtonsSafe(state, dimensions);
      if (layout.rules) {
        const rules = env.drawnText.filter(item => /[\u3400-\u9FFF]/u.test(item.value) && item.y >= layout.rules.top && item.y <= layout.rules.bottom);
        assert.ok(rules.length, name(dimensions) + ' 规则区有说明文字');
        for (const text of rules) assert.ok(text.size >= 11 - EPSILON, name(dimensions) + ' 规则字号至少 11px：' + text.value + '，实际 ' + text.size);
      }
    } finally { env.game.stop(); }
  }
});

test('各竖屏尺寸首页标志、等级、主按钮、每日挑战、导航不交叠，短主按钮字清楚', () => {
  for (const dimensions of DIMENSIONS) {
    const env = setup(dimensions);
    try {
      env.game.switchScreen('home');
      const state = env.render(), layout = state.layout;
      assert.ok(layout, name(dimensions) + ' 提供绘制布局');
      assert.equal(layout.screen, 'home');
      assertSequence(layout, ['hero', 'info', 'primary', 'secondary', 'actions'], dimensions);
      for (const value of ['喵喵', '谜谜']) {
        const texts = env.drawnText.filter(item => item.value === value);
        assert.equal(texts.length, 1, name(dimensions) + ' 实际绘制一行标志文字：' + value);
        const text = texts[0];
        assert.ok(text.size > 0 && text.align === 'center', value + ' 使用正字号居中绘制');
        assert.ok(Math.abs(text.x - dimensions.width / 2) <= EPSILON, value + ' 位于屏幕横向中心');
        // 按字号盒保守检查中文和英文行，不只相信 layout 自报边界。
        assert.ok(text.y - text.size / 2 >= layout.hero.top - EPSILON && text.y + text.size / 2 <= layout.hero.bottom + EPSILON,
          name(dimensions) + ' ' + value + ' 整行文字位于标志区内');
      }
      assertButtonsSafe(state, dimensions);
      assertMainButtonFont(env, state, layout.primary, name(dimensions));
    } finally { env.game.stop(); }
  }
});

test('320 宽动物小屋的四字名称及等级说明不与实际绘制的锁图标相撞', () => {
  for (const dimensions of DIMENSIONS.filter(item => item.width === 320)) {
    const env = setup(dimensions);
    try {
      env.game.openPage('wardrobe');
      const state = env.render();
      for (const label of ['竹叶熊猫', '开心鳄鱼', '活力小鸭']) {
        const card = state.buttons.find(item => item.label === label);
        assert.ok(card, label + ' 存在动物卡片');
        const nameText = env.drawnText.find(item => item.value === label);
        assert.ok(nameText && nameText.size >= 12, label + ' 保留可读的 12px 名称');
        const icons = env.filledShapes.filter(item => item.color === nameText.color &&
          item.left >= card.x && item.right <= card.x + card.width &&
          item.top >= card.y && item.bottom <= card.y + card.height);
        assert.ok(icons.length, label + ' 卡片确实绘制了锁图标');
        const texts = env.drawnText.filter(item => item.align === 'left' && item.x >= card.x && item.x <= card.x + card.width &&
          item.y >= card.y && item.y <= card.y + card.height);
        for (const text of texts) for (const icon of icons) {
          const overlap = text.x < icon.right && text.x + text.width > icon.left &&
            text.y - text.size / 2 < icon.bottom && text.y + text.size / 2 > icon.top;
          assert.equal(overlap, false, name(dimensions) + ' ' + label + ' 的文字与锁不碰撞：' + text.value);
        }
      }
    } finally { env.game.stop(); }
  }
});

test('各竖屏尺寸打卡页按信息顺序排布，领取前后白条、七天进度、奖励和主按钮不交叠', () => {
  for (const dimensions of DIMENSIONS) {
    const env = setup(dimensions);
    try {
      env.game.openPage('checkin');
      for (const signed of [false, true]) {
        if (signed) env.game.claimCheckin();
        const state = env.render(), layout = state.layout;
        assert.ok(layout, name(dimensions) + ' 提供绘制布局');
        assert.equal(layout.screen, 'checkin');
        assertSequence(layout, ['title', 'yarn', 'number', 'label', 'best', 'week', 'reward', 'primary'], dimensions);
        assertButtonsSafe(state, dimensions);
        assertMainButtonFont(env, state, layout.primary, name(dimensions) + (signed ? ' 已打卡' : ' 待打卡'));
      }
    } finally { env.game.stop(); }
  }
});
