'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const logic = require('../src/logic.js');
const levels = require('../src/level-data.js');
const legacy = require('../src/levels.js');
const { permutations, verifyWithPermutations, canonical } = require('../tools/generate-levels.cjs');

test('99题编号完整、尺寸从4到9，独立兼容题库保留60题', () => {
  assert.equal(levels.length, 99); assert.equal(legacy.length, 60);
  assert.deepEqual(levels.map(level => level.id), Array.from({ length: 99 }, (_, i) => i + 1));
  assert.equal(levels[0].size, 4);
  assert.equal(levels[98].size, 9);
  assert.ok(levels.every((level, i) => !i || level.size >= levels[i - 1].size));
  assert.ok(levels.every(level => level.source === 'generated-99'));
  assert.ok(levels.slice(0, 2).every(level => level.given.length === 1));
});

test('全部99关卡连通，移除答案和预置仍只有唯一解', () => {
  for (const level of levels) {
    assert.equal(logic.validateLevel(level), true, '结构及区域连通：' + level.id);
    assert.deepEqual(logic.solve({ ...level, given: [], solution: [] }, { limit: 2 }), [level.solution], '无预置唯一解：' + level.id);
  }
});

test('独立排列枚举核对99题唯一解，并按8种镜像旋转和区域重编号去重', () => {
  const permutationsBySize = new Map(), seen = new Set();
  for (const level of levels) {
    if (!permutationsBySize.has(level.size)) permutationsBySize.set(level.size, permutations(level.size));
    const check = verifyWithPermutations(level.size, level.regions, permutationsBySize.get(level.size));
    assert.equal(check.count, 1, '独立枚举解数：' + level.id); assert.deepEqual(check.solution, level.solution, '原答案一致：' + level.id);
    const identity = canonical(level.size, level.regions);
    assert.equal(seen.has(identity), false, '对称及重编号不重复：' + level.id); seen.add(identity);
  }
  assert.equal(seen.size, 99);
});

test('99关现有提示流程可完成，每一步落猫正确、排除不伤答案，定位也可用', () => {
  for (const level of levels) {
    const cats = (level.given || []).slice(), marks = [], answers = new Set(level.solution.map((column, row) => row * level.size + column));
    const locate = logic.locateCat(level, cats, []);
    assert.equal(locate.kind, 'place', '助手有效：' + level.id); assert.ok(answers.has(locate.cell));
    let operations = 0;
    while (!logic.isComplete(level, cats) && operations++ < level.size * level.size * 2) {
      const hint = logic.getHint(level, cats, marks); assert.ok(hint.reason, '提示有解释：' + level.id);
      if (hint.kind === 'place') { assert.ok(answers.has(hint.cell), '提示落猫真值：' + level.id); assert.equal(cats.includes(hint.cell), false); cats.push(hint.cell); }
      else if (hint.kind === 'mark') { assert.equal(answers.has(hint.cell), false, '排除不伤答案：' + level.id); assert.equal(marks.includes(hint.cell), false); marks.push(hint.cell); }
      else assert.fail('提示不能完成第' + level.id + '关：' + hint.reason);
    }
    assert.equal(logic.isComplete(level, cats), true, '全流程完成：' + level.id);
  }
});

test('关卡模块小于80KiB', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/level-data.js'));
  assert.ok(source.length < 80 * 1024);
});
