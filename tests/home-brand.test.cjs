'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game');

test('首页复用已下载的六字全名标志，等比居中且与等级信息保持分离', () => {
  for (const [width, height, safeTop, safeBottom] of [[320, 520, 80, 34], [363, 607, 0, 0], [390, 844, 80, 34]]) {
    const logo = { source: '喵喵谜谜艺术字', width: 1328, height: 1184 }, images = [], texts = [];
    const base = { drawImage: (...args) => images.push(args), fillText: value => texts.push(String(value)),
      measureText: value => ({ width: String(value).length * 10 }), createRadialGradient: () => ({ addColorStop() {} }) };
    const ctx = new Proxy(base, { get: (target, key) => key in target ? target[key] : () => {} });
    const platform = { ctx, width, height, safeTop, safeBottom, storage: { get: () => null, set() {} }, now: () => 0,
      requestFrame() {}, onPointer() {}, onHide() {}, onShow() {}, vibrate() {} };
    const silent = new Proxy({}, { get: () => () => {} });
    const game = startGame({ platform, brandLogo: logo, audio: silent, inputUI: { destroy() {} } });
    const state = game.getState(), drawn = images.filter(args => args[0] === logo);
    assert.equal(drawn.length, 1);
    const [, x, y, w, h] = drawn[0];
    assert.ok(Math.abs(x + w / 2 - width / 2) < .001);
    assert.ok(Math.abs(w / h - 1328 / 1184) < .001);
    assert.ok(y >= state.layout.hero.top && y + h <= state.layout.hero.bottom);
    assert.ok(y + h < state.layout.info.top);
    assert.ok(!texts.includes('喵格小屋'));
    game.stop();
  }
});
