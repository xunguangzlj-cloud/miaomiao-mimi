'use strict';

// 独立实现：每行、每列、每个区域各一只猫，任意两只猫不得八邻接。
function layoutValid(level) {
  if (!level || !Number.isInteger(level.size) || level.size < 3 || level.size > 12) return false;
  const n = level.size;
  return Array.isArray(level.regions) && level.regions.length === n * n &&
    level.regions.every(x => Number.isInteger(x) && x >= 0 && x < n);
}

function indicesValid(level, cells) {
  return Array.isArray(cells) && cells.every(x => Number.isInteger(x) && x >= 0 && x < level.size * level.size);
}

function pairRule(level, a, b) {
  const n = level.size, ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
  if (ar === br) return 'row';
  if (ac === bc) return 'column';
  if (level.regions[a] === level.regions[b]) return 'region';
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1 ? 'adjacent' : '';
}

function conflicts(level, cats) {
  if (!layoutValid(level) || !indicesValid(level, cats)) return [];
  const bad = new Set();
  for (let a = 0; a < cats.length; a++) {
    for (let b = a + 1; b < cats.length; b++) {
      if (pairRule(level, cats[a], cats[b])) { bad.add(cats[a]); bad.add(cats[b]); }
    }
  }
  return Array.from(bad).sort((a, b) => a - b);
}

function isComplete(level, cats) {
  return layoutValid(level) && indicesValid(level, cats) && cats.length === level.size &&
    new Set(cats).size === cats.length && conflicts(level, cats).length === 0;
}

function validateLevel(level) {
  if (!layoutValid(level) || !Array.isArray(level.solution) || level.solution.length !== level.size) return false;
  const n = level.size;
  if (!level.solution.every(c => Number.isInteger(c) && c >= 0 && c < n)) return false;
  const solutionCells = level.solution.map((c, r) => r * n + c);
  if (!isComplete(level, solutionCells)) return false;
  const given = level.given || [];
  if (!indicesValid(level, given) || new Set(given).size !== given.length || given.some(c => !solutionCells.includes(c))) return false;
  for (let region = 0; region < n; region++) {
    const first = level.regions.indexOf(region);
    if (first < 0) return false;
    const seen = new Set([first]), queue = [first];
    for (let p = 0; p < queue.length; p++) {
      const cell = queue[p], r = Math.floor(cell / n), c = cell % n;
      const near = [r > 0 ? cell - n : -1, r < n - 1 ? cell + n : -1, c > 0 ? cell - 1 : -1, c < n - 1 ? cell + 1 : -1];
      near.forEach(next => {
        if (next >= 0 && level.regions[next] === region && !seen.has(next)) { seen.add(next); queue.push(next); }
      });
    }
    if (seen.size !== level.regions.filter(x => x === region).length) return false;
  }
  return true;
}

function excludedByCat(level, index) {
  if (!layoutValid(level) || !indicesValid(level, [index])) return [];
  const out = [];
  for (let cell = 0; cell < level.size * level.size; cell++) {
    if (cell !== index && pairRule(level, cell, index)) out.push(cell);
  }
  return out;
}

// 求解只读取区域和约束，不借用交付数据中的 solution 字段。
function solve(level, options) {
  options = options || {};
  if (!layoutValid(level)) return [];
  const n = level.size, input = options.cats || [], given = level.given || [], marks = options.marks || [];
  if (!indicesValid(level, input) || !indicesValid(level, given) || !indicesValid(level, marks)) return [];
  if (new Set(input).size !== input.length) return [];
  const cats = Array.from(new Set(given.concat(input)));
  if (conflicts(level, cats).length || cats.some(c => marks.includes(c))) return [];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 2;
  const blocked = new Set(marks), chosen = Array(n).fill(-1), solutions = [];
  let columns = 0, regions = 0;
  for (const cell of cats) {
    const r = Math.floor(cell / n), c = cell % n, region = level.regions[cell];
    chosen[r] = c; columns |= 1 << c; regions |= 1 << region;
  }
  function candidates(row, cols, regs) {
    const result = [];
    for (let c = 0; c < n; c++) {
      const cell = row * n + c, region = level.regions[cell];
      if ((cols & (1 << c)) || (regs & (1 << region)) || blocked.has(cell)) continue;
      if (row > 0 && chosen[row - 1] >= 0 && Math.abs(c - chosen[row - 1]) <= 1) continue;
      if (row < n - 1 && chosen[row + 1] >= 0 && Math.abs(c - chosen[row + 1]) <= 1) continue;
      result.push(c);
    }
    return result;
  }
  function visit(cols, regs, remaining) {
    if (!remaining) { solutions.push(chosen.slice()); return; }
    let row = -1, values;
    for (let r = 0; r < n; r++) {
      if (chosen[r] >= 0) continue;
      const current = candidates(r, cols, regs);
      if (!current.length) return;
      if (row < 0 || current.length < values.length) { row = r; values = current; }
    }
    for (const c of values) {
      chosen[row] = c;
      visit(cols | (1 << c), regs | (1 << level.regions[row * n + c]), remaining - 1);
      chosen[row] = -1;
      if (solutions.length >= limit) return;
    }
  }
  visit(columns, regions, n - cats.length);
  return solutions;
}

const noHint = reason => ({ kind: 'none', cell: -1, reason, rule: 'none' });
const advice = (kind, cell, reason, rule) => ({ kind, cell, reason, rule });

function hintState(level, inputCats, inputMarks) {
  if (!layoutValid(level) || !indicesValid(level, inputCats || []) || !indicesValid(level, inputMarks || []) || !indicesValid(level, level.given || [])) return null;
  return { cats: Array.from(new Set((level.given || []).concat(inputCats || []))), marks: Array.from(new Set(inputMarks || [])) };
}

function candidatesFor(level, cats, marks) {
  const blocked = new Set(cats.concat(marks)), result = [];
  for (let cell = 0; cell < level.size * level.size; cell++) {
    if (!blocked.has(cell) && !cats.some(cat => pairRule(level, cat, cell))) result.push(cell);
  }
  return result;
}

function unitsFor(level, cats, candidates) {
  const out = [], n = level.size;
  for (const axis of ['row', 'column', 'region']) {
    const coord = cell => axis === 'row' ? Math.floor(cell / n) : axis === 'column' ? cell % n : level.regions[cell];
    for (let index = 0; index < n; index++) {
      if (!cats.some(cell => coord(cell) === index)) out.push({ axis, index, cells: candidates.filter(cell => coord(cell) === index) });
    }
  }
  return out;
}

// 有限反证只连锁使用单候选，最多推进六只猫；完整求解器另行核实结论。
function singleChainFails(level, initialCats, marks) {
  const cats = initialCats.slice();
  for (let step = 0; step <= 6; step++) {
    if (conflicts(level, cats).length || cats.some(cell => marks.includes(cell))) return true;
    const units = unitsFor(level, cats, candidatesFor(level, cats, marks));
    if (units.some(unit => !unit.cells.length)) return true;
    if (step === 6) return false;
    const single = units.find(unit => unit.cells.length === 1);
    if (!single) return false;
    cats.push(single.cells[0]);
  }
  return false;
}

function getHint(level, inputCats, inputMarks) {
  const state = hintState(level, inputCats, inputMarks);
  if (!state) return noHint('棋盘数据无效。');
  const { cats, marks } = state, n = level.size;
  const available = solve(level, { cats, limit: 2 });
  if (!available.length) {
    const base = solve(level, { limit: 2 });
    let cell;
    if (base.length === 1) cell = cats.find(c => !(level.given || []).includes(c) && base[0][Math.floor(c / n)] !== c % n);
    if (cell === undefined) cell = cats.find(c => !(level.given || []).includes(c) && solve(level, { cats: cats.filter(x => x !== c), limit: 1 }).length);
    if (cell !== undefined) return advice('repair', cell, '当前猫的位置无法一起满足规则，请先移除这一只再分析。', 'conflict');
    return noHint('当前关卡或预置猫没有可行解。');
  }
  if (isComplete(level, cats)) {
    const overlap = marks.find(cell => cats.includes(cell));
    return overlap === undefined ? noHint('已满足全部规则。') : advice('repair', overlap, '猫所在的位置不能同时打叉，请取消这个叉。', 'marked-cat');
  }
  // 第一层只标同行、同列和八邻接；远处同区域格留给后续推理。
  for (const cat of cats) {
    const row = Math.floor(cat / n), column = cat % n;
    for (let cell = 0; cell < n * n; cell++) {
      if (cats.includes(cell) || marks.includes(cell)) continue;
      const r = Math.floor(cell / n), c = cell % n;
      const rule = r === row ? 'row' : c === column ? 'column' : Math.abs(r - row) <= 1 && Math.abs(c - column) <= 1 ? 'adjacent' : '';
      if (!rule || solve(level, { cats: cats.concat(cell), limit: 1 }).length) continue;
      const reason = { row: '同一行已有猫', column: '同一列已有猫', adjacent: '这一格与猫相邻' }[rule];
      return advice('mark', cell, `${reason}，这一格可以打叉。`, rule);
    }
  }
  const overlap = marks.find(cell => cats.includes(cell));
  if (overlap !== undefined) return advice('repair', overlap, '猫所在的位置不能同时打叉，请取消这个叉。', 'marked-cat');
  if (!solve(level, { cats, marks, limit: 1 }).length) {
    const wrong = marks.find(cell => !solve(level, { cats, marks: [cell], limit: 1 }).length);
    if (wrong !== undefined) return advice('repair', wrong, '排除此格会让整盘无解，请取消这个叉，再按规则推理。', 'contradiction-mark');
    const repair = marks.find(cell => solve(level, { cats, marks: marks.filter(c => c !== cell), limit: 1 }).length);
    if (repair !== undefined) return advice('repair', repair, '这些叉同时排除了所有解，取消这个叉可恢复可行布局。', 'marks-inconsistent');
    return noHint('多个标记互相矛盾，请逐步取消标记再分析。');
  }
  // 所有后续落猫/排除返回前都检查相反假设无解，防止错误推理泄露到界面。
  function proven(kind, cell, reason, rule) {
    const opposite = kind === 'mark' ? { cats: cats.concat(cell), marks, limit: 1 } : { cats, marks: marks.concat(cell), limit: 1 };
    return solve(level, opposite).length ? null : advice(kind, cell, reason, rule);
  }
  const candidates = candidatesFor(level, cats, marks), units = unitsFor(level, cats, candidates);
  for (const unit of units) {
    if (unit.cells.length !== 1) continue;
    const name = { row: '行', column: '列', region: '个颜色区域' }[unit.axis];
    const result = proven('place', unit.cells[0], `第 ${unit.index + 1} ${name}只剩这一格可放猫。`, `${unit.axis}-single`);
    if (result) return result;
  }
  // 区域锁定到一条轴，以及一条轴锁定到一个区域，都能排除交集外的候选。
  for (const region of units.filter(unit => unit.axis === 'region')) {
    for (const axis of ['row', 'column']) {
      const coord = cell => axis === 'row' ? Math.floor(cell / n) : cell % n;
      if (!region.cells.length || !region.cells.every(cell => coord(cell) === coord(region.cells[0]))) continue;
      const cell = candidates.find(c => level.regions[c] !== region.index && coord(c) === coord(region.cells[0]));
      if (cell !== undefined) {
        const result = proven('mark', cell, `一个颜色区域的猫必须在这一${axis === 'row' ? '行' : '列'}，其他区域不能占用。`, `region-${axis}`);
        if (result) return result;
      }
    }
  }
  for (const unit of units.filter(unit => unit.axis !== 'region')) {
    if (!unit.cells.length || !unit.cells.every(c => level.regions[c] === level.regions[unit.cells[0]])) continue;
    const coord = cell => unit.axis === 'row' ? Math.floor(cell / n) : cell % n;
    const cell = candidates.find(c => level.regions[c] === level.regions[unit.cells[0]] && coord(c) !== unit.index);
    if (cell !== undefined) {
      const result = proven('mark', cell, `这一${unit.axis === 'row' ? '行' : '列'}的猫必须在同一颜色区域，所以该区域在这条线外的格子可排除。`, `${unit.axis}-region`);
      if (result) return result;
    }
  }
  const regions = units.filter(unit => unit.axis === 'region');
  for (let count = 2; count <= Math.min(6, regions.length - 1); count++) {
    function subset(start, selected) {
      if (selected.length < count) {
        for (let index = start; index <= regions.length - count + selected.length; index++) {
          const found = subset(index + 1, selected.concat(regions[index]));
          if (found) return found;
        }
        return null;
      }
      const ids = new Set(selected.map(unit => unit.index));
      for (const axis of ['row', 'column']) {
        const coord = cell => axis === 'row' ? Math.floor(cell / n) : cell % n;
        const lines = new Set(); selected.forEach(unit => unit.cells.forEach(cell => lines.add(coord(cell))));
        if (lines.size !== count) continue;
        const cell = candidates.find(c => !ids.has(level.regions[c]) && lines.has(coord(c)));
        if (cell !== undefined) {
          const result = proven('mark', cell, `${count} 个区域的猫只能占用 ${count} ${axis === 'row' ? '行' : '列'}，这些线上的其他区域不能放猫。`, `region-subset-${axis}-${count}`);
          if (result) return result;
        }
      }
      return null;
    }
    const result = subset(0, []);
    if (result) return result;
  }
  for (const cell of candidates) {
    if (singleChainFails(level, cats.concat(cell), marks)) {
      const result = proven('mark', cell, '假设这里放猫，连续检查唯一候选后会出现无处放猫的行、列或区域，因此可以排除。', 'single-chain');
      if (result) return result;
    }
  }
  for (const cell of candidates) {
    if (singleChainFails(level, cats, marks.concat(cell))) {
      const result = proven('place', cell, '假设排除此格，连续检查唯一候选后会产生矛盾，因此这里必须有猫。', 'single-chain');
      if (result) return result;
    }
  }
  for (const cell of candidates) {
    const result = proven('mark', cell, '假设此格放猫会使剩余棋盘无解，因此可以排除。', 'contradiction');
    if (result) return result;
  }
  for (const cell of candidates) {
    const result = proven('place', cell, '排除此格会使剩余棋盘无解，因此猫必须放在这里。', 'contradiction');
    if (result) return result;
  }
  return noHint('暂未找到必然成立的提示，可以继续分析。');
}

function locateCat(level, inputCats, inputMarks) {
  const state = hintState(level, inputCats, inputMarks);
  if (!state) return noHint('棋盘数据无效。');
  const { cats, marks } = state, answers = solve(level, { cats, limit: 2 });
  if (answers.length !== 1) return noHint('当前布局没有唯一可验证的答案，先检查棋盘。');
  const choices = answers[0].map((c, r) => r * level.size + c).filter(cell => !cats.includes(cell));
  const unmarked = region => level.regions.reduce((count, value, cell) => count + (value === region && !marks.includes(cell) ? 1 : 0), 0);
  choices.sort((a, b) => unmarked(level.regions[a]) - unmarked(level.regions[b]) || a - b);
  if (!choices.length) return noHint('已找到全部猫。');
  const cell = choices[0];
  // 定位忽略可能出错的叉，仍用相反假设求解核查猫的位置。
  if (solve(level, { cats, marks: [cell], limit: 1 }).length) return noHint('暂不能确认这个猫的位置。');
  return advice('place', cell, '先帮助剩余空格最少的颜色区域，这里是可验证的猫的位置。', 'locate');
}

module.exports = { validateLevel, solve, conflicts, isComplete, excludedByCat, getHint, locateCat };
