'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHomeFlow } = require('../src/home-flow.js');

function image(pixels) { return { width: 2, height: 2, data: new Uint8ClampedArray(pixels.flat()) }; }
function uniform(rgba) { return image([rgba, rgba, rgba, rgba]); }
function setup({ width = 4, height = 8, grid = uniform([200, 150, 90, 255]), mask = uniform([255, 255, 255, 0]), failRead = false } = {}) {
  const stats = { reads: 0, puts: 0, draws: 0 }, canvases = [];
  const createCanvas = () => {
    const canvas = { width: 1, height: 1 }, context = {
      clearRect() {}, drawImage(value) { this.image = value; },
      getImageData() { stats.reads++; if (failRead) throw new Error('当前平台禁止读取离屏图像'); return { data: new Uint8ClampedArray(this.image.data) }; },
      createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(value) { stats.puts++; canvas.output = new Uint8ClampedArray(value.data); }
    };
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  };
  const images = { grid, mask }, ctx = { drawImage(canvas, x, y, w, h) { stats.draws++; stats.lastCanvas = canvas; stats.destination = [x, y, w, h]; } };
  return { images, stats, canvases, flow: createHomeFlow({ ctx, width, height, getGrid: () => images.grid, getMask: () => images.mask, createCanvas, now: () => 0 }) };
}
function at(canvas, x, y) { return Array.from(canvas.output.slice((y * canvas.width + x) * 4, (y * canvas.width + x + 1) * 4)); }

test('原透明度采用相减，保留源RGB；相减后负值清零', () => {
  const { flow, canvases, stats } = setup({ grid: uniform([200, 150, 90, 180]), mask: uniform([255, 255, 255, 100]) });
  assert.equal(flow.draw(0), true);
  assert.deepEqual(at(canvases[0], 1, 3), [200, 150, 90, 16]);
  assert.notEqual(at(canvases[0], 1, 3)[3], Math.round(180 * (1 - 100 / 255) * .2));
  assert.equal(stats.reads, 2);
  const dim = setup({ grid: uniform([200, 150, 90, 80]), mask: uniform([255, 255, 255, 100]) });
  dim.flow.draw(0); assert.deepEqual(at(dim.canvases[0], 1, 3), [0, 0, 0, 0]);
});

test('双线性原alpha边缘按采样透明度相减，禁止用乘法替代', () => {
  const grid = image([[100, 100, 100, 40], [100, 100, 100, 240], [100, 100, 100, 40], [100, 100, 100, 240]]);
  const { flow, canvases } = setup({ grid, mask: uniform([255, 255, 255, 60]) });
  flow.draw(0);
  const spriteWidth = 1092 * 1.02 * 4 / 1080, left = (4 - spriteWidth) / 2;
  const sample = ((1.5 - left) / spriteWidth) * 2 - .5;
  assert.equal(at(canvases[0], 1, 3)[3], Math.round(Math.max(0, 40 + 200 * sample - 60) * .2));
});

test('正x负y采样UV使画面向左下移动，66.67秒后闭合', () => {
  const horizontal = setup({ grid: image([[20, 80, 90, 255], [220, 80, 90, 255], [20, 80, 90, 255], [220, 80, 90, 255]]) });
  horizontal.flow.draw(0); const red = at(horizontal.canvases[0], 1, 3)[0];
  horizontal.flow.draw(1000); assert.ok(at(horizontal.canvases[0], 1, 3)[0] > red);
  const vertical = setup({ grid: image([[70, 20, 90, 255], [70, 20, 90, 255], [70, 220, 90, 255], [70, 220, 90, 255]]) });
  vertical.flow.draw(0); const green = at(vertical.canvases[0], 1, 3)[1];
  vertical.flow.draw(1000); assert.ok(at(vertical.canvases[0], 1, 3)[1] < green);
  horizontal.flow.draw(1000 / .015); assert.equal(at(horizontal.canvases[0], 1, 3)[0], red);
});

test('每100毫秒重算，其他绘制只复用缓存，源图各仅读一次', () => {
  const { flow, stats } = setup();
  for (const time of [0, 16, 33, 66, 99]) assert.equal(flow.draw(time), true);
  assert.equal(stats.puts, 1); assert.equal(stats.draws, 5); assert.equal(stats.reads, 2);
  flow.draw(100); assert.equal(stats.puts, 2); assert.equal(stats.reads, 2);
  flow.draw(101); assert.equal(stats.puts, 2);
});

test('遮罩固定在sprite UV内，移动时保持原中心挖空规则', () => {
  const mask = image([[255, 255, 255, 0], [255, 255, 255, 255], [255, 255, 255, 0], [255, 255, 255, 255]]);
  const { flow, canvases } = setup({ mask });
  flow.draw(0); const first = canvases[0].output;
  flow.draw(5000); assert.deepEqual(canvases[0].output, first);
  assert.ok(at(canvases[0], 0, 3)[3] > at(canvases[0], 3, 3)[3]);
});

test('不同viewport等比缩放固定原sprite，超出sprite下缘透明', () => {
  const small = setup({ width: 4, height: 10 }), large = setup({ width: 8, height: 20 });
  small.flow.draw(0); large.flow.draw(0);
  assert.equal(small.canvases[0].width, 4); assert.equal(small.canvases[0].height, 10);
  assert.deepEqual(small.stats.destination, [0, 0, 4, 10]);
  assert.deepEqual(large.stats.destination, [0, 0, 8, 20]);
  assert.equal(at(small.canvases[0], 1, 9)[3], 0);
  assert.equal(at(large.canvases[0], 3, 19)[3], 0);
  assert.equal(at(small.canvases[0], 1, 3)[3], at(large.canvases[0], 3, 7)[3]);
});

test('图片未就绪、替换或离屏读取失败时交还旧首页背景', () => {
  const pending = setup({ grid: null });
  assert.equal(pending.flow.draw(), false); assert.equal(pending.stats.draws, 0); assert.equal(pending.canvases.length, 0);
  const swap = setup(); swap.flow.draw(0); swap.images.grid = uniform([220, 200, 90, 255]);
  assert.equal(swap.flow.draw(100), false); assert.equal(swap.flow.draw(200), true);
  assert.equal(at(swap.canvases[1], 1, 3)[0], 220);
  const denied = setup({ failRead: true });
  assert.equal(denied.flow.draw(0), false); assert.equal(denied.flow.draw(100), false);
  assert.equal(denied.stats.reads, 1); assert.equal(denied.stats.draws, 0);
  assert.equal(createHomeFlow({ ctx: {}, width: 4, height: 8, getGrid: () => ({}), getMask: () => ({}) }).draw(0), false);
});
