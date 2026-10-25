'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createArt } = require('../src/art.js');

// 以下固定坐标来自真实图集的透明像素连通主体，不能从待测元数据反推期望值。
// 主图按 alpha > 32、扩展图按 alpha > 128 识别主体，边框额外保留一像素。
const PRIMARY = [
  [22,34,288,269,166.0,168.5],
  [332,32,288,267,476.0,165.5],
  [638,31,287,267,781.5,164.5],
  [959,39,283,261,1100.5,169.5],
  [15,327,289,275,159.5,464.5],
  [324,324,287,279,467.5,463.5],
  [642,329,283,272,783.5,465.0],
  [955,329,286,277,1098.0,467.5],
  [21,621,292,276,167.0,759.0],
  [327,616,303,291,478.5,761.5],
  [644,605,269,312,778.5,761.0],
  [940,644,302,262,1091.0,775.0],
  [7,909,327,326,170.5,1072.0],
  [341,950,280,254,481.0,1077.0],
  [632,927,290,281,777.0,1067.5],
  [936,932,305,281,1088.5,1072.5]
];
const EXPANDED = [
  [23,19,154,138,100.0,88.0],
  [191,18,151,138,266.5,87.0],
  [353,20,149,137,427.5,88.5],
  [507,20,137,135,575.5,87.5],
  [643,20,149,136,717.5,88.0],
  [798,19,144,136,870.0,87.0],
  [951,17,147,139,1024.5,86.5],
  [1103,21,145,136,1175.5,89.0],
  [1256,18,148,139,1330.0,87.5],
  [22,167,155,135,99.5,234.5],
  [190,169,151,132,265.5,235.0],
  [351,171,150,131,426.0,236.5],
  [503,163,140,136,573.0,231.0],
  [647,158,148,144,721.0,230.0],
  [799,170,147,131,872.5,235.5],
  [953,170,146,131,1026.0,235.5],
  [1103,174,144,128,1175.0,238.0],
  [1255,171,147,131,1328.5,236.5],
  [29,305,141,177,99.5,393.5],
  [195,306,138,175,264.0,393.5],
  [357,307,140,171,427.0,392.5],
  [518,307,127,173,581.5,393.5],
  [657,308,134,172,724.0,394.0],
  [809,310,133,171,875.5,395.5],
  [960,309,133,170,1026.5,394.0],
  [1112,312,131,170,1177.5,397.0],
  [1262,309,137,172,1330.5,395.0],
  [22,479,158,150,101.0,554.0],
  [188,482,160,147,268.0,555.5],
  [354,485,148,146,428.0,558.0],
  [506,484,138,146,575.0,557.0],
  [648,487,151,146,723.5,560.0],
  [801,490,149,142,875.5,561.0],
  [955,482,145,149,1027.5,556.5],
  [1107,490,143,143,1178.5,561.5],
  [1256,487,150,147,1331.0,560.5],
  [19,631,161,145,99.5,703.5],
  [186,631,156,147,264.0,704.5],
  [349,634,156,144,427.0,706.0],
  [506,635,136,138,574.0,704.0],
  [643,635,157,145,721.5,707.5],
  [800,637,152,143,876.0,708.5],
  [952,634,152,145,1028.0,706.5],
  [1106,638,148,141,1180.0,708.5],
  [1253,637,152,142,1329.0,708.0],
  [22,788,153,125,98.5,850.5],
  [186,786,156,128,264.0,850.0],
  [351,790,150,129,426.0,854.5],
  [506,787,140,121,576.0,847.5],
  [647,793,150,120,722.0,853.0],
  [802,796,147,114,875.5,853.0],
  [955,790,143,123,1026.5,851.5],
  [1102,794,149,120,1176.5,854.0],
  [1258,791,148,125,1332.0,853.5],
  [24,921,153,147,100.5,994.5],
  [187,918,154,149,264.0,992.5],
  [350,922,152,147,426.0,995.5],
  [509,919,141,149,579.5,993.5],
  [651,922,147,147,724.5,995.5],
  [802,921,147,145,875.5,993.5],
  [953,918,146,149,1026.0,992.5],
  [1104,921,148,147,1178.0,994.5],
  [1259,920,148,148,1333.0,994.0]
];
const BOUNDS = {"primary":[[23,35,309,302],[333,33,619,298],[639,32,924,297],[960,40,1241,299],[16,328,303,601],[325,325,610,602],[643,330,924,600],[956,330,1240,605],[22,622,312,896],[328,617,629,906],[645,606,912,916],[941,645,1241,905],[8,910,333,1234],[342,951,620,1203],[633,928,921,1207],[937,933,1240,1212]],"expanded":[[24,20,176,156],[192,19,341,155],[354,21,501,156],[508,21,643,154],[644,21,791,155],[799,20,941,154],[952,18,1097,155],[1104,22,1247,156],[1257,19,1403,156],[23,168,176,301],[191,170,340,300],[352,172,500,301],[504,164,642,298],[648,159,794,301],[800,171,945,300],[954,171,1098,300],[1104,175,1246,301],[1256,172,1401,301],[30,306,169,481],[196,307,332,480],[358,308,496,477],[519,308,644,479],[658,309,790,479],[810,311,941,480],[961,310,1092,478],[1113,313,1242,481],[1263,310,1398,480],[23,480,179,628],[189,483,347,628],[355,486,501,630],[507,485,643,629],[649,488,798,632],[802,491,949,631],[956,483,1099,630],[1108,491,1249,632],[1257,488,1405,633],[20,632,179,775],[187,632,341,777],[350,635,504,777],[507,636,641,772],[644,636,799,779],[801,638,951,779],[953,635,1103,778],[1107,639,1253,778],[1254,638,1404,778],[23,789,174,912],[187,787,341,913],[352,791,500,918],[507,788,645,907],[648,794,796,912],[803,797,948,909],[956,791,1097,912],[1103,795,1250,913],[1259,792,1405,915],[25,922,176,1067],[188,919,340,1066],[351,923,501,1068],[510,920,649,1067],[652,923,797,1068],[803,922,948,1065],[954,919,1098,1066],[1105,922,1251,1067],[1260,921,1406,1067]]};
const HOLES = {"18":[[161,480,6,1],[34,481,4,1],[159,481,11,1]],"27":[[79,479,33,1],[93,480,7,1]]};
const ROW_ANIMALS = ['calico', 'panda', 'rabbit', 'corgi', 'lion', 'crocodile', 'duck'];
const FALLBACK_ANIMALS = ['corgi', 'rabbit', 'panda', 'lion', 'crocodile', 'duck', 'calico'];
const PRIMARY_IMAGE = { width: 1254, height: 1254 };
const EXPANDED_IMAGE = { width: 1422, height: 1106 };
const EPSILON = 1e-8;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, message + '：' + actual + ' 应等于 ' + expected);
}
function transform(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}
function polygonWinding(points, point) {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && cross > 0) winding++;
    if (a.y > point.y && b.y <= point.y && cross < 0) winding--;
  }
  return winding;
}
function visibleAt(draw, point) {
  return draw.clips.every(layer => {
    const winding = layer.polygons.reduce((sum, polygon) => sum + polygonWinding(polygon, point), 0);
    return layer.rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
  });
}

// 记录真实 Canvas 操作，检查实际主体的投影位置以及裁剪孔是否生效。
function setup(expanded) {
  const draws = [], rotations = [], scales = [], stack = [];
  let matrix = [1, 0, 0, 1, 0, 0], clips = [], polygons = [], current = [];
  const pushCurrent = () => { if (current.length) { polygons.push(current); current = []; } };
  const ctx = {
    save() { stack.push({ matrix: matrix.slice(), clips: clips.slice() }); },
    restore() { const saved = stack.pop(); assert.ok(saved, '画布保存与恢复成对'); matrix = saved.matrix; clips = saved.clips; },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    rotate(angle) {
      rotations.push(angle); const [a, b, c, d] = matrix, co = Math.cos(angle), si = Math.sin(angle);
      matrix[0] = a * co + c * si; matrix[1] = b * co + d * si; matrix[2] = c * co - a * si; matrix[3] = d * co - b * si;
    },
    scale(x, y) { scales.push([x, y]); matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    beginPath() { polygons = []; current = []; },
    moveTo(x, y) { pushCurrent(); current.push(transform(matrix, x, y)); },
    lineTo(x, y) { current.push(transform(matrix, x, y)); },
    closePath() { pushCurrent(); },
    rect(x, y, width, height) {
      pushCurrent(); polygons.push([[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(p => transform(matrix, ...p)));
    },
    clip(rule) { pushCurrent(); clips = clips.concat({ polygons: polygons.map(p => p.slice()), rule: rule || 'nonzero' }); },
    drawImage(...args) { draws.push({ args, matrix: matrix.slice(), clips: clips.slice() }); }
  };
  const art = createArt(ctx, () => {}, () => {}, () => PRIMARY_IMAGE, () => expanded ? EXPANDED_IMAGE : null);
  return { art, draws, rotations, scales, stack };
}
function sourcePoint(draw, sourceX, sourceY) {
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = draw.args;
  return transform(draw.matrix, dx + (sourceX - sx) / sw * dw, dy + (sourceY - sy) / sh * dh);
}
function checkDraw(env, fixture, bounds, image, cx, cy, size) {
  assert.equal(env.draws.length, 1, '一个表情只绘制一张实际头像');
  const draw = env.draws[0], [, sx, sy, sw, sh, dx, dy, dw, dh] = draw.args;
  assert.equal(draw.args.length, 9, '使用明确的来源裁剪框');
  assert.equal(draw.args[0], image, '选择对应的真实图集');
  assert.deepEqual([sx, sy, sw, sh], fixture.slice(0, 4), '读取完整主体 ROI，不按等分格裁掉耳朵或读入相邻脸');
  assert.ok(sx >= 0 && sy >= 0 && sx + sw <= image.width && sy + sh <= image.height, '来源框完整位于图集内部');
  assert.ok(sx <= bounds[0] && sy <= bounds[1] && sx + sw >= bounds[2] && sy + sh >= bounds[3], '来源框保留真实主体全部边界');
  const center = sourcePoint(draw, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
  near(center.x, cx, '头像实际主体横向居中'); near(center.y, cy, '头像实际主体纵向居中');
  near(dw / sw, dh / sh, '横纵缩放一致，长耳和圆脸不变形');
  assert.ok(dw > 0 && dh > 0, '头像有可见尺寸');
  const topLeft = transform(draw.matrix, dx, dy), bottomRight = transform(draw.matrix, dx + dw, dy + dh);
  assert.ok(topLeft.x >= cx - size / 2 - EPSILON && bottomRight.x <= cx + size / 2 + EPSILON, '头像不越过指定方框的左右边界');
  assert.ok(topLeft.y >= cy - size / 2 - EPSILON && bottomRight.y <= cy + size / 2 + EPSILON, '头像不越过指定方框的上下边界');
  assert.equal(visibleAt(draw, center), true, '裁剪保留头像主体中心');
  assert.equal(env.stack.length, 0, '绘制结束恢复画布状态');
  return draw;
}

test('实际 PNG 与固定主体测量一致，全部 79 帧元数据对应真实尺寸和中心', () => {
  for (const [file, expected] of [
    ['assets/animal-faces.png', 'f5bc4cc157a356c86f0b79fcea9e26efb37ebba882a0785ffe19d1b4eb9337e6'],
    ['animal-assets/expressions.png', '8fd3737d98a0be4f3dc2aa76ff359b6df8a322750de2e84103e9dfee72a5b5e3']
  ]) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, '图集改变后必须重新校准真实主体坐标');
  }
  const metadata = require('../src/sprite-frames.js');
  for (const [name, width, height, nominalSize, fixtures] of [
    ['primary', 1254, 1254, 313.5, PRIMARY], ['expanded', 1422, 1106, 158, EXPANDED]
  ]) {
    assert.equal(metadata[name].width, width); assert.equal(metadata[name].height, height);
    assert.equal(metadata[name].nominalSize, nominalSize); assert.deepEqual(metadata[name].frames, fixtures, '元数据必须匹配独立像素测量：' + name);
  }
  assert.deepEqual(metadata.expanded.holes, HOLES, '只排除两个交叠帧的实际邻脸边缘');
});

test('主图 16 个真实表情全部按实际主体中心绘制，原比例与完整耳朵保留', () => {
  PRIMARY.forEach((fixture, index) => {
    const env = setup(false), id = index < 9 ? 'cat' : FALLBACK_ANIMALS[index - 9], expression = index < 9 ? index : 0;
    env.art.animal(194.25, 368.5, 67.2, id, expression);
    checkDraw(env, fixture, BOUNDS.primary[index], PRIMARY_IMAGE, 194.25, 368.5, 67.2);
  });
});

test('扩展图 7 种动物各 9 个表情全部居中，长耳、长脸保持宽高比', () => {
  EXPANDED.forEach((fixture, index) => {
    const env = setup(true); env.art.animal(110.5, 219.75, 52.3, ROW_ANIMALS[Math.floor(index / 9)], index % 9);
    checkDraw(env, fixture, BOUNDS.expanded[index], EXPANDED_IMAGE, 110.5, 219.75, 52.3);
  });
});

test('小格、大格、浮点位置与反馈缩放都围绕主体中心，不随尺寸漂移', () => {
  for (const [cx, cy, size] of [[0, 0, 10], [-5.3, 12.7, 127.75], [194.25, 368.5, 34.42], [219, 427, 89.3]]) {
    for (const [expanded, fixtures, image, group] of [[false, PRIMARY, PRIMARY_IMAGE, 'primary'], [true, EXPANDED, EXPANDED_IMAGE, 'expanded']]) {
      fixtures.forEach((fixture, index) => {
        const env = setup(expanded), id = expanded ? ROW_ANIMALS[Math.floor(index / 9)] : index < 9 ? 'cat' : FALLBACK_ANIMALS[index - 9];
        env.art.animal(cx, cy, size, id, expanded ? index % 9 : index < 9 ? index : 0);
        checkDraw(env, fixture, BOUNDS[group][index], image, cx, cy, size);
      });
    }
  }
});

test('扩展图载入前的非猫备用头像居中，表情索引不再旋转或镜像头像', () => {
  FALLBACK_ANIMALS.forEach((id, index) => {
    for (const expression of [0, 1, 4, 8, -1, 13]) {
      const env = setup(false); env.art.animal(43.5, 76.25, 47.4, id, expression);
      assert.deepEqual(env.rotations, [], '备用头像不旋转：' + id); assert.deepEqual(env.scales, [], '备用头像不镜像：' + id);
      checkDraw(env, PRIMARY[index + 9], BOUNDS.primary[index + 9], PRIMARY_IMAGE, 43.5, 76.25, 47.4);
    }
  });
});

test('兔子与柯基相邻边缘的裁剪孔真实生效，其余表情不额外裁剪', () => {
  EXPANDED.forEach((fixture, index) => {
    const env = setup(true); env.art.animal(163.25, 307.5, 83.7, ROW_ANIMALS[Math.floor(index / 9)], index % 9);
    const draw = checkDraw(env, fixture, BOUNDS.expanded[index], EXPANDED_IMAGE, 163.25, 307.5, 83.7);
    if (HOLES[index]) {
      assert.ok(draw.clips.length > 0, '交叠表情必须应用实际裁剪孔');
      HOLES[index].forEach(([x, y, width, height]) => {
        assert.equal(visibleAt(draw, sourcePoint(draw, x + width / 2, y + height / 2)), false, '邻脸边缘不能泄漏到方格');
      });
    } else assert.equal(draw.clips.length, 0, '不存在邻脸交叠的表情不增添裁剪');
  });
});
