'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const frames = require('../src/garden-frames.js');
const { createGardenArt, stageForTotal } = require('../src/garden-art.js');

test('累计打卡从空盆到盛开，断签保留成长，异常天数限制在0至7', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => stageForTotal(i)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(stageForTotal(9), 7); assert.equal(stageForTotal(-1), 0);
  assert.equal(stageForTotal(NaN), 0); assert.equal(stageForTotal(Infinity), 7);
  assert.equal(new Set(frames.frames.map(frame => frame.pixelSha256)).size, 8);
  for (const frame of frames.frames) {
    assert.deepEqual(frame.potBaseline, [128, 294]);
    const [x, y, w, h] = frame.rect;
    assert.ok(x >= 0 && y >= 0 && x + w <= frames.width && y + h <= frames.height);
    assert.ok(frame.foregroundBounds[1] >= 0 && frame.foregroundBounds[3] <= frames.frameHeight);
  }
});

test('盆栽始终等比绘制，固定盆底，轻摆不裁到容器边缘', () => {
  for (const [width, height] of [[27, 35], [145, 160], [220, 310]]) {
    const calls = [], bitmap = {}, ctx = { save() {}, restore() {}, translate() {}, rotate() {}, drawImage: (...args) => calls.push(args) };
    const art = createGardenArt(ctx, () => bitmap);
    for (let day = 0; day < 8; day++) {
      const result = art.plant(100, 200, width, height, day, 1200);
      assert.equal(result.drawn, true); assert.ok(Math.abs(result.angle) <= .008);
      assert.ok(Math.abs(result.width / result.height - 256 / 344) < .001);
      assert.ok(result.left >= 100 - width / 2 && result.top >= 200 - height / 2);
      assert.ok(result.left + result.width <= 100 + width / 2 && result.top + result.height <= 200 + height / 2);
      assert.equal(calls.at(-1)[0], bitmap);
    }
  }
  const ctx = { drawImage() { assert.fail('未载入图时不访问画布图片'); } };
  assert.equal(createGardenArt(ctx, () => null).plant(0, 0, 100, 100, 1, 0).drawn, false);
});
