'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { drawLoading } = require('../src/splash.js');
const { QUOTES } = require('../src/quotes.js');

const DIMENSIONS = [[320, 520, 80, 34], [320, 568, 80, 34], [363, 607, 0, 0], [390, 844, 80, 34], [390, 844, 0, 0], [430, 932, 54, 34]];
const EPSILON = 1e-7;

function setup(dimensions) {
  const drawnText = [], drawnImages = [], shapes = [];
  const context = {
    measureText(value) {
      const size = Number(String(this.font).match(/([\d.]+)px/)[1]);
      return { width: Array.from(String(value)).reduce((sum, char) => sum + size * (/^[\x00-\x7F]$/.test(char) ? .55 : 1), 0) };
    },
    fillText(value, x, y) {
      drawnText.push({ value, x, y, width: this.measureText(value).width,
        font: this.font, align: this.textAlign, baseline: this.textBaseline });
    },
    drawImage(...args) { drawnImages.push(args); },
    fillRect(...args) { shapes.push({ color: this.fillStyle, args }); }
  };
  const ctx = new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
  const [width, height, safeTop, safeBottom] = dimensions;
  const catFace = { name: '启动猫头像', width: 88, height: 80 }, logo = { name: '六字全名标志', width: 1328, height: 1184 };
  return { p: { ctx, width, height, safeTop, safeBottom }, drawnText, drawnImages, shapes, catFace, logo };
}

for (const dimensions of DIMENSIONS) {
  const [width, height, safeTop, safeBottom] = dimensions;
  test(`启动页 ${width}×${height}，安全区 ${safeTop}/${safeBottom}：全部名言排版和素材比例正确`, () => {
    assert.equal(QUOTES.length, 10);
    for (const quote of QUOTES) {
      const mock = setup(dimensions);
      const layout = drawLoading(mock.p, { quote, progress: .68, catFace: mock.catFace, logo: mock.logo });
      assert.equal(layout.screen, 'loading');
      assert.ok(layout.quote.top >= safeTop);
      assert.ok(layout.quote.bottom <= layout.author.top);
      assert.ok(layout.author.bottom < layout.cat.top);
      assert.ok(layout.cat.bottom < layout.progress.top);
      assert.ok(layout.progress.bottom < layout.logo.top);
      assert.ok(layout.logo.bottom <= height - safeBottom);
      assert.ok(layout.quote.fontSize >= 17);
      assert.ok(Math.abs((layout.cat.left + layout.cat.right) / 2 - layout.progress.fillRight) < EPSILON);
      assert.equal(mock.shapes[0].color, '#F7F2EE');
      assert.deepEqual(mock.shapes[0].args, [0, 0, width, height]);
      const quoteText = mock.drawnText.filter(line => line.align !== 'center');
      const body = quoteText.slice(0, -1), author = quoteText.at(-1);
      assert.equal(body.map(line => line.value).join(''), '“' + quote.text + '”');
      assert.equal(body.length, layout.quote.lines.length);
      body.forEach(line => {
        assert.equal(line.align, 'left'); assert.equal(line.baseline, 'top');
        assert.equal(line.x, layout.quote.left);
        assert.ok(line.x + line.width <= layout.quote.right + EPSILON, quote.text);
        assert.ok(!/^[，。！？；：、”’）》]/.test(line.value), line.value);
      });
      assert.equal(author.value, '- ' + quote.author); assert.equal(author.align, 'right');
      assert.equal(author.x, layout.author.right); assert.ok(author.x - author.width >= layout.author.left);
      const [cat, brand] = mock.drawnImages;
      assert.equal(cat[0], mock.catFace); assert.equal(brand[0], mock.logo);
      assert.ok(Math.abs(cat[3] / cat[4] - 88 / 80) < EPSILON);
      assert.ok(Math.abs(brand[3] / brand[4] - 1328 / 1184) < EPSILON);
      assert.ok(Math.abs(cat[1] + cat[3] / 2 - layout.progress.fillRight) < EPSILON);
      assert.equal(brand[1], layout.logo.left); assert.equal(brand[2], layout.logo.top);
    }
  });
}

test('启动页进度边界：非数值归零，越界裁定，猫跟随起止位置且不出屏', () => {
  for (const dimensions of DIMENSIONS) {
    for (const [progress, expected] of [[0, 0], [1, 1], [-.3, 0], [1.4, 1], [NaN, 0]]) {
      const mock = setup(dimensions);
      const layout = drawLoading(mock.p, { quote: QUOTES[0], progress, catFace: mock.catFace, logo: mock.logo });
      assert.equal(layout.progress.value, expected);
      assert.ok(Math.abs(layout.progress.fillRight - (layout.progress.left + (layout.progress.right - layout.progress.left) * expected)) < EPSILON);
      assert.ok(layout.cat.left >= 0); assert.ok(layout.cat.right <= mock.p.width);
      assert.ok(Math.abs((layout.cat.left + layout.cat.right) / 2 - layout.progress.fillRight) < EPSILON);
    }
  }
});

test('启动页六字标志和猫头像 PNG 的尺寸与完整性保持一致', () => {
  const assets = [
    ['garden-logo.png', 1328, 1184, 1998065, '7b72737dd984dcb993aa9d9a806926f0a2351f768d5a8f5a6e90575487df18c2'],
    ['loading-cat.png', 88, 80, 10075, '90c3e33a09728494151ad3af1257d05503a4350f56e13e21832fda5731c2cafb']
  ];
  for (const [name, width, height, bytes, sha256] of assets) {
    const data = fs.readFileSync(path.join(__dirname, '../splash-assets', name));
    assert.equal(data.length, bytes);
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(data.readUInt32BE(16), width); assert.equal(data.readUInt32BE(20), height);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), sha256);
  }
});
