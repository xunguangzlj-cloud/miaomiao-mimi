'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { THEMES, FRAMES } = require('../src/cosmetics.js');
const { createCosmeticArt } = require('../src/cosmetic-art.js');

function drawing() {
  const calls = [], points = [], stack = []; let matrix = [1, 0, 0, 1, 0, 0];
  function point(x, y) {
    const [a, b, c, d, e, f] = matrix, p = [a * x + c * y + e, b * x + d * y + f];
    assert.ok(p.every(Number.isFinite)); points.push(p); return p;
  }
  function multiply(n) {
    const [a, b, c, d, e, f] = matrix, [u, v, w, z, tx, ty] = n;
    matrix = [a * u + c * v, b * u + d * v, a * w + c * z, b * w + d * z, a * tx + c * ty + e, b * tx + d * ty + f];
  }
  const ctx = {
    globalAlpha: 1, save() { stack.push([matrix.slice(), this.globalAlpha]); },
    restore() { [matrix, this.globalAlpha] = stack.pop(); },
    translate(x, y) { multiply([1, 0, 0, 1, x, y]); }, scale(x, y) { multiply([x, 0, 0, y, 0, 0]); },
    rotate(a) { multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    beginPath() {}, closePath() {}, clip() {}, fill() { calls.push(['fill', this.fillStyle]); }, stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth]); },
    moveTo(x, y) { calls.push(['move', ...point(x, y)]); }, lineTo(x, y) { calls.push(['line', ...point(x, y)]); },
    quadraticCurveTo(...a) { calls.push(['quadratic', ...a]); for (let i = 0; i < a.length; i += 2) point(a[i], a[i + 1]); },
    bezierCurveTo(...a) { calls.push(['bezier', ...a]); for (let i = 0; i < a.length; i += 2) point(a[i], a[i + 1]); },
    rect(x, y, w, h) { point(x, y); point(x + w, y + h); calls.push(['rect', x, y, w, h]); },
    arc(x, y, r) { this.ellipse(x, y, r, r, 0); },
    ellipse(x, y, rx, ry, angle) {
      calls.push(['ellipse', x, y, rx, ry, angle]);
      for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; point(x + Math.cos(a) * rx * Math.cos(angle) - Math.sin(a) * ry * Math.sin(angle), y + Math.cos(a) * rx * Math.sin(angle) + Math.sin(a) * ry * Math.cos(angle)); }
    }
  };
  const box = (x, y, w, h, fill, radius) => { point(x, y); point(x + w, y + h); calls.push(['box', x, y, w, h, fill, radius]); };
  const silhouette = (x, y, size, color) => { point(x - size / 2, y - size / 2); point(x + size / 2, y + size / 2); calls.push(['cat', color]); };
  return { ctx, calls, points, stack, art: createCosmeticArt({ ctx, box, silhouette }) };
}
function inside(points, left, top, width, height) {
  points.forEach(([x, y]) => assert.ok(x >= left - .001 && x <= left + width + .001 && y >= top - .001 && y <= top + height + .001, `绘制坐标 (${x}, ${y}) 越过容器`));
}
function signature(calls) { return JSON.stringify(calls.map(call => call.filter(v => typeof v !== 'string' || !v.startsWith('#')))); }
function luminance(hex) {
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}

test('小屋与头像框目录保留旧标识，新增外观都有独立造型与有效配色', () => {
  assert.equal(THEMES.length, 12); assert.equal(FRAMES.length, 8);
  assert.equal(new Set(THEMES.map(v => v.style)).size, 12); assert.equal(new Set(FRAMES.map(v => v.style)).size, 8);
  for (const id of ['cream', 'forest', 'sky', 'rose', 'night', 'royal']) assert.ok(THEMES.some(v => v.id === id));
  for (const id of ['basic', 'mint', 'gold', 'cosmic']) assert.ok(FRAMES.some(v => v.id === id));
  for (const v of THEMES) {
    assert.ok(v.level > 0 && v.level <= 30); ['paper', 'ink', 'accent'].forEach(k => assert.match(v[k], /^#[0-9A-F]{6}$/));
    assert.ok((luminance(v.paper) + .05) / (luminance(v.ink) + .05) >= 4.5, `${v.name} 小字对比度不足`);
  }
});

test('八款头像框以不同形状区分，跨尺寸居中且装饰不超出边界', () => {
  for (const size of [32, 44, 64, 120]) {
    const signatures = new Set();
    for (const frame of FRAMES) {
      const d = drawing(), bounds = d.art.frame(70, 80, size, frame);
      assert.deepEqual(bounds, { left: 70 - size / 2, top: 80 - size / 2, width: size, height: size });
      inside(d.points, bounds.left, bounds.top, size, size); signatures.add(signature(d.calls));
      assert.equal(d.stack.length, 0); assert.equal(d.ctx.globalAlpha, 1);
      // 头像中心保持完整，填充装饰全部位于头像边沿。
      assert.ok(!d.calls.some(v => v[0] === 'box'));
    }
    assert.equal(signatures.size, 8, '头像框不能只改变颜色');
  }
});

test('十二款小屋缩略图用对应环境装饰与棋盘区分，小屏容器内完整呈现', () => {
  for (const [w, h] of [[120, 66], [146, 76], [175, 90]]) {
    const signatures = new Set();
    for (const theme of THEMES) {
      const d = drawing(); d.art.themePreview(13, 23, w, h, theme);
      inside(d.points, 13, 23, w, h); signatures.add(signature(d.calls));
      assert.equal(d.calls.filter(v => v[0] === 'box').length, 11);
      assert.equal(d.stack.length, 0); assert.equal(d.ctx.globalAlpha, 1);
    }
    assert.equal(signatures.size, 12, '小屋不能只改变纸面颜色');
  }
});

test('主题装饰保持在屏幕四角并轻微飘动，奶油小屋保留原动态背景', () => {
  const plain = drawing(); assert.equal(plain.art.background(320, 520, THEMES[0], 1000), false); assert.equal(plain.calls.length, 0);
  for (const theme of THEMES.slice(1)) for (const [w, h] of [[320, 520], [390, 844]]) {
    const a = drawing(), b = drawing(); a.art.background(w, h, theme, 0); b.art.background(w, h, theme, 1200);
    inside(a.points, 0, 0, w, h);
    assert.ok(a.points.slice(2).every(([x, y]) => (x < w * .25 || x > w * .75) && (y < h * .2 || y > h * .8)), '不向棋盘中央铺图案');
    assert.notDeepEqual(a.points, b.points); assert.equal(a.stack.length, 0); assert.equal(a.ctx.globalAlpha, 1);
  }
});
