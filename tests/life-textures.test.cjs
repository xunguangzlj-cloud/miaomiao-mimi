'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const progress = require('../src/progression.js');
const KEY = 'miaoge-home-v1';
const FULL = 'assets/fish_full.png', DIM = 'assets/fish_dim.png';
const UNIT = 30 / 84;
const copy = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message + '：' + actual + ' 应等于 ' + expected);

// 使用实际画布调用与可控时间，隔离真实玩家存档及浏览器资源。
function setup() {
  let now = Date.UTC(2026, 9, 13, 8), matrix = [1, 0, 0, 1, 0, 0], alpha = 1;
  const draws = [], stack = [], requested = [];
  const project = (x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
  const methods = {
    save() { stack.push({ matrix: matrix.slice(), alpha }); },
    restore() { const saved = stack.pop(); assert.ok(saved, '画布保存与恢复成对'); matrix = saved.matrix; alpha = saved.alpha; },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    rotate(angle) {
      const [a, b, c, d] = matrix, co = Math.cos(angle), si = Math.sin(angle);
      matrix[0] = a * co + c * si; matrix[1] = b * co + d * si;
      matrix[2] = c * co - a * si; matrix[3] = d * co - b * si;
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: Array.from(String(value)).length * 8 }),
    drawImage(bitmap, ...args) {
      if (!bitmap || ![FULL, DIM].includes(bitmap.src)) return;
      assert.ok([4, 8].includes(args.length), '鱼纹理使用明确的目标宽高');
      const [x, y, width, height] = args.slice(-4), center = project(x + width / 2, y + height / 2);
      const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([cx, cy]) => project(cx, cy));
      draws.push({ src: bitmap.src, center, width: Math.hypot(matrix[0], matrix[1]) * width,
        height: Math.hypot(matrix[2], matrix[3]) * height, matrix: matrix.slice(), alpha, corners });
    }
  };
  const ctx = new Proxy(methods, {
    get(target, key) { return key === 'globalAlpha' ? alpha : key in target ? target[key] : () => {}; },
    set(target, key, value) { if (key === 'globalAlpha') alpha = value; else target[key] = value; return true; }
  });
  let stored = { unlocked: 1, completed: {}, daily: {}, tutorialDone: true, progression: progress.hydrate() };
  const platform = {
    ctx, width: 390, height: 844, safeTop: 0, safeBottom: 0, now: () => now,
    storage: { get: key => key === KEY ? copy(stored) : null, set: (key, value) => { assert.equal(key, KEY); stored = copy(value); return true; } },
    loadImage(src, callback) { requested.push(src); callback({ src, width: src === DIM ? 64 : 120, height: src === DIM ? 60 : 120 }); },
    requestFrame() {}, onPointer() {}, onHide() {}, onShow() {}, vibrate() {}
  };
  const silent = new Proxy({}, { get: () => () => {} });
  const game = startGame({ platform, audio: silent, inputUI: { editNickname() {}, destroy() {} } });
  game.startLevel(9);
  return {
    game, requested, advance: ms => { now += ms; },
    render() { draws.length = 0; game.render(); assert.equal(stack.length, 0, '绘制结束后恢复画布'); return draws.slice(); }
  };
}

function wrongCells(id = 9) {
  const level = levels.find(item => item.id === id);
  return level.regions.map((_, cell) => cell).filter(cell => level.solution[Math.floor(cell / level.size)] !== cell % level.size);
}
function expectedLifeCenter(index) {
  // 390×844 无安全区的常规竖屏：时间中心为顶部14+72，生命条在下方28。
  return { x: 390 / 2 - 25 + index * 25, y: 14 + 72 + 28 - 1 };
}
function assertFull(draw, index) {
  const center = expectedLifeCenter(index);
  assert.equal(draw.src, FULL); near(draw.center.x, center.x, '完整鱼横向居中'); near(draw.center.y, center.y, '完整鱼纵向居中');
  near(draw.width, 60 * UNIT, '完整鱼宽度沿用原比例'); near(draw.height, 60 * UNIT, '完整鱼高度沿用原比例');
  near(draw.matrix[1], 0, '原纹理不旋转'); near(draw.matrix[2], 0, '原纹理不旋转');
  assert.ok(draw.matrix[0] > 0 && draw.matrix[3] > 0, '原纹理不翻转'); near(draw.alpha, 1, '完整鱼保持不透明');
}

test('完整鱼和缺失鱼 PNG 的尺寸与完整性保持一致', () => {
  for (const [file, width, height, expected] of [
    [FULL, 120, 120, '209eb6fafa50dd39cb584cffd08992f75476353555236981c2fe3f1e1b53ff2d'],
    [DIM, 64, 60, '460ee5a0c6b7d2c49e19aef50cb36f42cab61c6df4154844fc2e49cbea86db40']
  ]) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file + ' 为 PNG');
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, file + ' 没有重新绘制或改色');
  }
});

test('三生命使用三张原金鱼纹理，在时间下方等比绘制并保持方向', () => {
  const env = setup();
  try {
    assert.ok(env.requested.includes(FULL)); assert.ok(env.requested.includes(DIM));
    const draws = env.render(); assert.equal(draws.length, 3);
    draws.forEach(assertFull); assert.equal(env.game.getState().hearts, 3);
  } finally { env.game.stop(); }
});

test('放错后立即在最右槽显示原缺失鱼，250毫秒后完整鱼消失且不消耗道具', () => {
  const env = setup();
  try {
    const before = env.game.getState(); env.game.placeCat(wrongCells()[0]);
    const immediate = env.render(), dim = immediate.filter(draw => draw.src === DIM);
    assert.equal(dim.length, 1); const right = expectedLifeCenter(2);
    near(dim[0].center.x, right.x, '缺失鱼只出现在右槽'); near(dim[0].center.y, right.y, '缺失鱼保持槽中心');
    near(dim[0].width, 64 * UNIT, '缺失鱼保持原宽度'); near(dim[0].height, 60 * UNIT, '缺失鱼保持原高度');
    assert.equal(immediate.filter(draw => draw.src === FULL).length, 3, '扣命动画先保留完整鱼');
    env.advance(249); assert.equal(env.render().filter(draw => draw.src === FULL).length, 3, '完整鱼在隐藏节点前仍出现');
    env.advance(1); const settled = env.render(), remaining = settled.filter(draw => draw.src === FULL);
    assert.equal(remaining.length, 2); remaining.forEach(assertFull);
    assert.equal(settled.filter(draw => draw.src === DIM).length, 1);
    const after = env.game.getState(); assert.equal(after.hearts, 2);
    assert.deepEqual(after.progression.inventory, before.progression.inventory); assert.equal(after.hints, before.hints); assert.equal(after.locates, before.locates);
  } finally { env.game.stop(); }
});

test('免费复活半秒后恢复三张原金鱼，动画不越生命条且保留棋盘与道具', () => {
  const env = setup();
  try {
    wrongCells().slice(0, 3).forEach(cell => { env.game.placeCat(cell); env.advance(300); });
    const before = env.game.getState(); assert.equal(before.screen, 'fail'); assert.equal(before.hearts, 0);
    env.game.revive(); assert.equal(env.game.getState().screen, 'play');
    for (const delta of [100, 150, 249]) {
      env.advance(delta);
      const draws = env.render(); assert.equal(draws.filter(draw => draw.src === DIM).length, 0);
      for (const draw of draws) for (const corner of draw.corners) {
        assert.ok(corner.x >= 390 / 2 - 48 && corner.x <= 390 / 2 + 48, '复活鱼不越胶囊左右边界');
        assert.ok(corner.y >= 114 - 15 && corner.y <= 114 + 15, '复活鱼不越胶囊上下边界');
      }
    }
    env.advance(1); const draws = env.render(); assert.equal(draws.length, 3); draws.forEach(assertFull);
    const after = env.game.getState(); assert.equal(after.hearts, 3); assert.equal(after.revives, before.revives + 1);
    for (const key of ['cats', 'marks', 'errors', 'score', 'steps', 'hints', 'locates']) assert.deepEqual(after[key], before[key], '复活保持' + key);
    assert.deepEqual(after.progression.inventory, before.progression.inventory);
  } finally { env.game.stop(); }
});
