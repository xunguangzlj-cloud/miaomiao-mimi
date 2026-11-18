'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic.js');
const levels = require('../src/levels.js');
const { permutations, verifyWithPermutations, canonical } = require('../tools/generate-levels.cjs');

const simple = { id: 0, size: 5, regions: Array.from({ length: 25 }, (_, c) => c % 5), solution: [0, 2, 4, 1, 3], difficulty: 'easy' };
const cellsFor = level => level.solution.map((c, r) => r * level.size + c);

test('四条约束分别产生冲突，并且排除格与两猫检查一致', () => {
  assert.deepEqual(logic.conflicts(simple, [0, 2]), [0, 2]);
  assert.deepEqual(logic.conflicts(simple, [0, 10]), [0, 10]);
  const level = levels.find(l => l.regions.some((v, a) => l.regions.some((w, b) => v === w && Math.floor(a / l.size) !== Math.floor(b / l.size) && a % l.size !== b % l.size && Math.abs(Math.floor(a / l.size) - Math.floor(b / l.size)) > 1)));
  let regionPair;
  for (let a = 0; a < level.regions.length && !regionPair; a++) for (let b = a + 1; b < level.regions.length; b++) {
    if (level.regions[a] === level.regions[b] && Math.floor(a / level.size) !== Math.floor(b / level.size) && a % level.size !== b % level.size && Math.abs(Math.floor(a / level.size) - Math.floor(b / level.size)) > 1) { regionPair = [a, b]; break; }
  }
  assert.deepEqual(logic.conflicts(level, regionPair), regionPair);
  assert.deepEqual(logic.conflicts(simple, [0, 6]), [0, 6]);
  assert.deepEqual(logic.conflicts(simple, [0, 0]), [0]);
  for (const sample of [simple, levels[0], levels[59]]) {
    for (let cat = 0; cat < sample.size * sample.size; cat++) {
      const excluded = new Set(logic.excludedByCat(sample, cat));
      assert.equal(excluded.has(cat), false);
      for (let cell = 0; cell < sample.size * sample.size; cell++) {
        if (cell !== cat) assert.equal(excluded.has(cell), logic.conflicts(sample, [cat, cell]).length > 0);
      }
    }
  }
});

test('关卡结构、区域连通、答案、预置猫均严格验证', () => {
  assert.equal(logic.validateLevel(simple), true);
  assert.equal(logic.validateLevel({ ...simple, regions: simple.regions.slice(1) }), false);
  assert.equal(logic.validateLevel({ ...simple, solution: [0, 1, 2, 3, 4] }), false);
  assert.equal(logic.validateLevel({ ...simple, given: [1] }), false);
  assert.equal(logic.validateLevel({ ...simple, given: [0, 0] }), false);
  const disconnected = simple.regions.slice(); disconnected[3] = 4; disconnected[4] = 3;
  assert.equal(logic.isComplete({ ...simple, regions: disconnected }, cellsFor(simple)), true);
  assert.equal(logic.validateLevel({ ...simple, regions: disconnected }), false);
  assert.equal(logic.validateLevel(null), false);
  assert.equal(logic.solve({ ...simple, regions: [] }).length, 0);
});

test('求解尊重预置猫、猫与叉标记，且不读取缓存答案', () => {
  assert.equal(logic.solve(simple, { limit: 100 }).length, 14);
  assert.equal(logic.solve(simple).length, 2);
  assert.deepEqual(logic.solve(simple, { cats: [0, 1] }), []);
  assert.deepEqual(logic.solve(simple, { marks: [0, 1, 2, 3, 4] }), []);
  assert.deepEqual(logic.solve(simple, { cats: [-1] }), []);
  assert.deepEqual(logic.solve(simple, { cats: [0, 0] }), []);
  const only = levels[0];
  const poisoned = { ...only, solution: [] };
  assert.deepEqual(logic.solve(poisoned), [only.solution]);
  const solved = logic.solve(only, { cats: [cellsFor(only)[0]], limit: 2 });
  assert.equal(solved.length, 1);
  for (const solution of logic.solve({ ...simple, given: [0] }, { limit: 100 })) assert.equal(solution[0], 0);
  assert.deepEqual(logic.solve({ ...simple, given: [0] }, { marks: [0] }), []);
  assert.equal(logic.isComplete(simple, cellsFor(simple)), true);
  assert.equal(logic.isComplete(simple, [0, 7]), false);
});

test('全部 60 关无预置时唯一、四邻接连通，并经过不同算法校验与对称去重', () => {
  assert.equal(levels.length, 60);
  const cache = new Map(), keys = new Set();
  for (const level of levels) {
    assert.equal(logic.validateLevel(level), true, `关卡 ${level.id} 结构`);
    const noGiven = { ...level, given: [] };
    assert.deepEqual(logic.solve(noGiven), [level.solution], `关卡 ${level.id} 运行时唯一解`);
    if (!cache.has(level.size)) cache.set(level.size, permutations(level.size));
    const independent = verifyWithPermutations(level.size, level.regions, cache.get(level.size));
    assert.equal(independent.count, 1, `关卡 ${level.id} 独立唯一解`);
    assert.deepEqual(independent.solution, level.solution);
    const key = canonical(level.size, level.regions); assert.equal(keys.has(key), false); keys.add(key);
  }
  assert.ok(levels.slice(0, 5).every(l => l.size === 5 && l.given && l.given.length && l.difficulty === 'easy'));
});

test('提示纠正冲突猫、错误猫、单个及多个错误叉，不把正确叉当作错误', () => {
  assert.equal(logic.getHint(simple, [0, 1], []).kind, 'repair');
  const level = levels[0], correct = cellsFor(level), fixed = new Set(level.given);
  const wrongCell = level.regions.findIndex((v, c) => !correct.includes(c) && !fixed.has(c));
  assert.equal(logic.getHint(level, [wrongCell], []).kind, 'repair');
  const unplaced = correct.filter(c => !fixed.has(c));
  function afterPriorityMarks(marked) {
    const marks = marked.slice();
    for (let step = 0; step < level.size * level.size; step++) {
      const hint = logic.getHint(level, [], marks);
      if (hint.kind !== 'mark' || !['row', 'column', 'adjacent'].includes(hint.rule)) return hint;
      marks.push(hint.cell);
    }
    assert.fail('优先排除未收敛');
  }
  const repair = afterPriorityMarks(unplaced);
  assert.equal(repair.kind, 'repair'); assert.ok(unplaced.includes(repair.cell));
  const single = afterPriorityMarks([unplaced[0]]);
  assert.equal(single.kind, 'repair'); assert.equal(single.cell, unplaced[0]);
  const rightMark = level.regions.findIndex((v, c) => !correct.includes(c));
  assert.notEqual(logic.getHint(level, [], [rightMark]).kind, 'repair');
  assert.equal(logic.getHint(level, correct, []).kind, 'none');
});

test('沿提示完成所有关卡，每条落猫或打叉提示由独立唯一答案核查', () => {
  for (const level of levels) {
    const cats = (level.given || []).slice(), marks = [];
    let steps = 0;
    while (!logic.isComplete(level, cats) && steps++ < level.size * level.size * 2) {
      const advice = logic.getHint(level, cats, marks), row = Math.floor(advice.cell / level.size), col = advice.cell % level.size;
      assert.ok(advice.reason.length > 0 && advice.rule.length > 0);
      if (advice.kind === 'place') {
        assert.equal(level.solution[row], col, `关卡 ${level.id} 的落猫提示`); cats.push(advice.cell);
      } else if (advice.kind === 'mark') {
        assert.notEqual(level.solution[row], col, `关卡 ${level.id} 的排除提示`); marks.push(advice.cell);
      } else assert.fail(`关卡 ${level.id} 提示中断：${JSON.stringify(advice)}`);
    }
    assert.equal(logic.isComplete(level, cats), true, `关卡 ${level.id} 可按提示完成`);
  }
});

test('正确猫的全部子集与正确叉共存时，提示不会要求移除正确猫', () => {
  for (const size of [5, 6, 7, 8, 9]) {
    const level = levels.find(l => l.size === size), correct = cellsFor(level);
    const rightMarks = level.regions.map((v, c) => c).filter(c => !correct.includes(c) && c % 3 === 0);
    for (let mask = 0; mask < 1 << size; mask++) {
      const cats = correct.filter((c, r) => mask & (1 << r));
      const hint = logic.getHint(level, cats, rightMarks);
      assert.notEqual(hint.kind, 'repair', `关卡 ${level.id} 的正确状态 ${mask}`);
    }
  }
  const level = levels.find(l => !l.given), correct = cellsFor(level), good = correct[0];
  const wrong = Array.from({ length: level.size }, (_, c) => c).find(c => c !== good);
  const hint = logic.getHint(level, [good, wrong], []);
  assert.equal(hint.kind, 'repair'); assert.equal(hint.cell, wrong);
});
