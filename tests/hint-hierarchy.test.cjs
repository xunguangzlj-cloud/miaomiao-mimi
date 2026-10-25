'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic.js');
const levels = require('../src/levels.js');
const answerCells = level => level.solution.map((c, r) => r * level.size + c);

function proveHint(level, cats, marks, hint) {
  assert.ok(logic.solve(level, { cats, marks, limit: 1 }).length, '证明的当前状态先要有解');
  const opposite = hint.kind === 'mark' ? { cats: cats.concat(hint.cell), marks, limit: 1 } : { cats, marks: marks.concat(hint.cell), limit: 1 };
  assert.equal(logic.solve(level, opposite).length, 0, `提示 ${hint.rule} 的相反假设无解`);
}

test('已有猫的行列邻接排除先于误叉修复和单候选，不枚举远处同区域格', () => {
  const level = levels[0], cats = level.given.slice(), wrongMarks = answerCells(level).filter(c => !cats.includes(c));
  let marks = wrongMarks.slice(), first = logic.getHint(level, cats, marks);
  assert.equal(first.kind, 'mark'); assert.ok(['row', 'column', 'adjacent'].includes(first.rule));
  for (let step = 0; step < level.size * level.size; step++) {
    const hint = logic.getHint(level, cats, marks);
    if (!['row', 'column', 'adjacent'].includes(hint.rule)) { assert.equal(hint.kind, 'repair'); assert.ok(wrongMarks.includes(hint.cell)); break; }
    assert.ok(cats.some(cat => {
      const row = Math.floor(cat / level.size), col = cat % level.size, r = Math.floor(hint.cell / level.size), c = hint.cell % level.size;
      return row === r || col === c || Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1;
    }));
    // 此处故意有误叉，安全排除的证明忽略错误叉，避免利用无解状态推出任何结论。
    assert.equal(logic.solve(level, { cats: cats.concat(hint.cell), limit: 1 }).length, 0);
    marks.push(hint.cell);
  }
});

test('区域到轴和轴到区域的双向锁定均先于反证，并由完整求解器复验', () => {
  const cases = [
    { id: 11, cats: [1, 9], marks: [0, 2, 3, 4, 5, 6, 7, 11, 16, 21, 8, 13, 14, 19, 24], rule: 'region-row' },
    { id: 13, cats: [8], marks: [1, 2, 3, 6, 7, 9, 10, 11, 13, 14, 15, 20, 26, 32, 5], rule: 'region-column' },
    { id: 13, cats: [8], marks: [1, 2, 3, 6, 7, 9, 10, 11, 13, 14, 15, 20, 26, 32, 5, 29, 35], rule: 'column-region' },
    { id: 17, cats: [], marks: [30, 31, 32, 33, 24, 25, 0, 26, 29], rule: 'row-region' }
  ];
  for (const fixture of cases) {
    const level = levels[fixture.id - 1], hint = logic.getHint(level, fixture.cats, fixture.marks);
    assert.equal(hint.rule, fixture.rule); assert.equal(hint.kind, 'mark'); proveHint(level, fixture.cats, fixture.marks, hint);
  }
});

// 合成候选图专门检验组合约束；不加入实际交付关卡，不声称区域连通。
function subsetFixture(count, transpose) {
  const n = count <= 2 ? 5 : count <= 4 ? 7 : 9;
  const own = Array.from({ length: count }, (_, r) => r * 2 % n), extra = Array.from({ length: n }, (_, c) => c).find(c => !own.includes(c));
  const regions = Array.from({ length: n * n }, (_, cell) => count + ((cell % n + Math.floor(cell / n)) % (n - count)));
  for (let r = count; r < n; r++) regions[r * n + r * 2 % n] = r;
  for (let r = 0; r < count; r++) { regions[r * n + own[r]] = r; regions[r * n + extra] = (r + count - 1) % count; }
  const grid = transpose ? regions.map((v, cell) => regions[(cell % n) * n + Math.floor(cell / n)]) : regions;
  return { size: n, regions: grid, solution: [] };
}

test('2–6 个区域占用同数行列的组合排除完整覆盖两轴，且多解棋盘不会误排', () => {
  for (let count = 2; count <= 6; count++) {
    for (const transpose of [false, true]) {
      const level = subsetFixture(count, transpose), hint = logic.getHint(level, [], []);
      assert.equal(hint.rule, `region-subset-${transpose ? 'column' : 'row'}-${count}`);
      assert.equal(hint.kind, 'mark'); proveHint(level, [], [], hint);
    }
  }
});

test('有限单候选链和完整反证兜底区分返回，所有排除均有完整约束证明', () => {
  const level = levels[10], cats = [1, 9], marks = [0, 2, 3, 4, 5, 6, 7, 11, 16, 21, 8, 13, 14, 19, 24, 20];
  const chain = logic.getHint(level, cats, marks);
  assert.equal(chain.rule, 'single-chain'); proveHint(level, cats, marks, chain);
  const fallback = { size: 7, regions: [0, 2, 3, 2, 6, 5, 2, 4, 5, 1, 5, 3, 2, 2, 2, 1, 6, 3, 2, 4, 4, 0, 3, 0, 6, 1, 6, 3, 6, 4, 5, 3, 1, 6, 0, 5, 6, 5, 5, 3, 5, 4, 1, 3, 3, 1, 2, 6, 1], solution: [] };
  const exact = logic.getHint(fallback, [], []); assert.equal(exact.rule, 'contradiction'); proveHint(fallback, [], [], exact);
});

test('60 关的全部提示都在反向假设无解时返回，且仍可完整通关', () => {
  for (const level of levels) {
    const cats = (level.given || []).slice(), marks = [];
    let steps = 0;
    while (!logic.isComplete(level, cats) && steps++ < level.size * level.size * 2) {
      const hint = logic.getHint(level, cats, marks);
      assert.ok(['mark', 'place'].includes(hint.kind), `关卡 ${level.id} 有可应用提示`);
      proveHint(level, cats, marks, hint);
      (hint.kind === 'place' ? cats : marks).push(hint.cell);
    }
    assert.equal(logic.isComplete(level, cats), true);
  }
});

test('独立定位优先本区域未叉格数，然后行列；误叉及污染缓存答案不影响正确性', () => {
  for (const level of levels) {
    const cats = Array.from(new Set((level.given || []).concat(answerCells(level)[0])));
    const marks = level.regions.map((v, cell) => cell).filter(c => (c + level.id) % 4 === 0);
    const expected = answerCells(level).filter(c => !cats.includes(c)).sort((a, b) => {
      const count = cell => level.regions.reduce((sum, region, index) => sum + (region === level.regions[cell] && !marks.includes(index) ? 1 : 0), 0);
      return count(a) - count(b) || a - b;
    })[0];
    const poisoned = { ...level, solution: [] }, hint = logic.locateCat(poisoned, cats, marks);
    assert.equal(hint.kind, 'place'); assert.equal(hint.cell, expected); assert.equal(hint.rule, 'locate');
    assert.equal(logic.solve(poisoned, { cats, marks: [hint.cell], limit: 1 }).length, 0);
  }
  const level = levels[8], cats = answerCells(level);
  assert.equal(logic.locateCat(level, cats, []).kind, 'none');
  const ambiguous = { size: 5, regions: Array.from({ length: 25 }, (_, c) => c % 5), solution: [] };
  assert.equal(logic.locateCat(ambiguous, [], []).kind, 'none');
});
