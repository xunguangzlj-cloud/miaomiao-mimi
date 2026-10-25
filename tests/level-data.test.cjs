'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const logic = require('../src/logic.js');
const levels = require('../src/level-data.js');
const legacy = require('../src/levels.js');
const audit = require('../docs/level-validation.json');
const { permutations, verifyWithPermutations, canonical } = require('../tools/generate-levels.cjs');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

test('99题编号完整、尺寸与原rank不回退，旧60题仍单独保留', () => {
  assert.equal(levels.length, 99); assert.equal(legacy.length, 60);
  assert.deepEqual(levels.map(level => level.id), Array.from({ length: 99 }, (_, i) => i + 1));
  assert.equal(levels[0].size, 4); assert.ok(levels.slice(1, 18).every(level => level.size === 5));
  assert.ok(levels.slice(18, 36).every(level => level.size === 6)); assert.ok(levels.slice(36, 56).every(level => level.size === 7));
  assert.ok(levels.slice(56, 78).every(level => level.size === 8)); assert.ok(levels.slice(78).every(level => level.size === 9));
  assert.ok(levels.every((level, i) => !i || level.size >= levels[i - 1].size));
  assert.ok(audit.entries.every((entry, i) => !i || entry.rank >= audit.entries[i - 1].rank));
  assert.ok(levels.slice(0, 16).every(level => level.difficulty === 'easy'));
  assert.ok(levels.slice(16, 44).every(level => level.difficulty === 'normal'));
  assert.ok(levels.slice(44).every(level => level.difficulty === 'hard'));
  assert.ok(audit.entries.slice(44).every(entry => entry.rank >= 4));
});

test('首两题区域、答案、预置猫及颜色映射逐格对应用户截图', () => {
  assert.deepEqual(levels[0].regions, [0, 1, 2, 2, 0, 2, 2, 3, 0, 0, 2, 3, 0, 2, 2, 2]);
  assert.deepEqual(levels[0].solution, [1, 3, 0, 2]); assert.deepEqual(levels[0].given, [7]);
  assert.deepEqual(levels[0].colorMap, [0, 3, 2, 1]);
  assert.deepEqual(levels[1].regions, [0, 0, 0, 1, 2, 0, 0, 3, 1, 2, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 4, 4, 4, 4, 4]);
  assert.deepEqual(levels[1].solution, [4, 2, 0, 3, 1]); assert.deepEqual(levels[1].given, [4]);
  assert.deepEqual(levels[1].colorMap, [6, 4, 1, 3, 0]);
});

test('全部99关卡连通、至多1个单格区域，移除答案和预置仍只有唯一解', () => {
  for (const level of levels) {
    assert.equal(logic.validateLevel(level), true, '结构及区域连通：' + level.id);
    const areas = level.regions.reduce((out, region) => { out[region] = (out[region] || 0) + 1; return out; }, {});
    assert.ok(Object.values(areas).filter(count => count === 1).length <= 1, '单格区域过滤：' + level.id);
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
    assert.equal(audit.entries[level.id - 1].canonicalSha256, sha256(identity));
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

test('关卡数据与校验记录一致，全部99关均有完整性记录', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/level-data.js'));
  assert.equal(audit.count, 99);
  assert.equal(audit.runtimeSourceSha256, sha256(source)); assert.equal(audit.runtimeSourceBytes, source.length);
  assert.ok(source.length < 80 * 1024, '运行关卡模块小于80KiB');
  assert.deepEqual(audit.verification, { validConnected: 99, uniqueWithoutGiven: 99, independentUnique: 99, canonicalDistinct: 99 });
  assert.equal(audit.entries.length, 99);
  for (const level of levels) {
    const record = audit.entries[level.id - 1];
    assert.equal(record.id, level.id); assert.ok(record.rank >= 1 && record.rank <= 5);
    assert.match(record.canonicalSha256, /^[a-f0-9]{64}$/);
  }
});
