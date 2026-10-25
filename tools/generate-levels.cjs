'use strict';

// 关卡生成器：使用随机连通生长。
const fs = require('node:fs');
const path = require('node:path');
const { validateLevel, solve, getHint, isComplete } = require('../src/logic.js');
let state = 0x71c4a39d;
function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }
function pick(values) { return values[Math.floor(random() * values.length)]; }

// 独立校验器：预枚举行列不重复且不相邻的排列，再检查区域。
// 与运行时求解器的动态选行回溯不同，不读取缓存答案，也不使用预置猫。
function permutations(n) {
  const out = [], cols = [];
  function visit(mask) {
    if (cols.length === n) { out.push(cols.slice()); return; }
    for (let c = 0; c < n; c++) {
      if ((mask & (1 << c)) || (cols.length && Math.abs(c - cols[cols.length - 1]) <= 1)) continue;
      cols.push(c); visit(mask | (1 << c)); cols.pop();
    }
  }
  visit(0); return out;
}

function verifyWithPermutations(n, regions, possible) {
  let count = 0, solution = null;
  for (const cols of possible) {
    let mask = 0, valid = true;
    for (let r = 0; r < n; r++) {
      const bit = 1 << regions[r * n + cols[r]];
      if (mask & bit) { valid = false; break; }
      mask |= bit;
    }
    if (valid) { count++; solution = cols; if (count === 2) break; }
  }
  return { count, solution };
}

function grow(n, solution) {
  const regions = Array(n * n).fill(-1), sizes = Array(n).fill(1);
  solution.forEach((c, r) => { regions[r * n + c] = r; });
  // 保留少量小区域，避免大棋盘随机分区产生过多可行解。
  const capped = new Map(), count = n < 7 ? (random() < 0.38 ? 1 : 0) : n - 6 + Math.floor(random() * 2);
  const pool = Array.from({ length: n }, (_, r) => r);
  for (let k = 0; k < count; k++) {
    const index = Math.floor(random() * pool.length), region = pool.splice(index, 1)[0];
    capped.set(region, random() < 0.75 ? 1 : 2);
  }
  while (regions.includes(-1)) {
    const frontier = [];
    for (let cell = 0; cell < n * n; cell++) {
      if (regions[cell] !== -1) continue;
      const r = Math.floor(cell / n), c = cell % n;
      const near = [r ? cell - n : -1, r < n - 1 ? cell + n : -1, c ? cell - 1 : -1, c < n - 1 ? cell + 1 : -1];
      const options = Array.from(new Set(near.filter(x => x >= 0 && regions[x] >= 0 && (!capped.has(regions[x]) || sizes[regions[x]] < capped.get(regions[x]))).map(x => regions[x])));
      options.forEach(region => frontier.push({ cell, region, weight: 1 / Math.sqrt(sizes[region]) }));
    }
    if (!frontier.length) return null;
    const weight = frontier.reduce((sum, x) => sum + x.weight, 0);
    let ticket = random() * weight, choice = frontier[frontier.length - 1];
    for (const option of frontier) { ticket -= option.weight; if (ticket <= 0) { choice = option; break; } }
    regions[choice.cell] = choice.region; sizes[choice.region]++;
  }
  return regions;
}

function canonical(n, regions) {
  const forms = [];
  for (let mirror = 0; mirror < 2; mirror++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const grid = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          let rr = r, cc = mirror ? n - 1 - c : c;
          for (let k = 0; k < rotation; k++) { const prev = rr; rr = cc; cc = n - 1 - prev; }
          grid[rr * n + cc] = regions[r * n + c];
        }
      }
      const labels = new Map();
      forms.push(grid.map(v => { if (!labels.has(v)) labels.set(v, labels.size); return labels.get(v); }).join(','));
    }
  }
  return n + ':' + forms.sort()[0];
}

function logicalProfile(level) {
  const cats = (level.given || []).slice(), marks = [], profile = { singles: 0, direct: 0, locked: 0, subsets: 0, maxSubset: 0, singleChains: 0, contradictions: 0, marks: 0 };
  for (let step = 0; step < level.size * level.size * 2 && !isComplete(level, cats); step++) {
    const hint = getHint(level, cats, marks);
    if (hint.kind === 'place') cats.push(hint.cell);
    else if (hint.kind === 'mark') { marks.push(hint.cell); profile.marks++; }
    else throw new Error('提示流程无法完成原创关卡');
    if (hint.rule.endsWith('-single')) profile.singles++;
    if (['row', 'column', 'adjacent'].includes(hint.rule)) profile.direct++;
    if (['region-row', 'region-column', 'row-region', 'column-region'].includes(hint.rule)) profile.locked++;
    if (hint.rule.startsWith('region-subset-')) { profile.subsets++; profile.maxSubset = Math.max(profile.maxSubset, Number(hint.rule.split('-').pop())); }
    if (hint.rule === 'single-chain') profile.singleChains++;
    if (hint.rule === 'contradiction') profile.contradictions++;
  }
  if (!isComplete(level, cats)) throw new Error('提示流程超出步数限制');
  profile.score = profile.contradictions * 10 + profile.singleChains * 6 + profile.subsets * 4 + profile.locked * 2 + profile.marks / (level.size * level.size);
  return profile;
}

const difficultyBasis = '按分层提示路径分档：直接排除和单候选为简单；双向锁定、区域组合或少量单候选链为普通；3 次以上单候选链、4 区以上组合或完整反证兜底为困难。统计依赖提示顺序，尚未经过真人难度标定。';
function difficultyForProfile(profile) {
  if (profile.contradictions || profile.singleChains >= 3 || profile.maxSubset >= 4) return 'hard';
  return profile.locked || profile.subsets || profile.singleChains ? 'normal' : 'easy';
}

function main() {
  const started = Date.now(), levels = [], seen = new Set(), stats = [], profiles = [];
  for (let n = 5; n <= 9; n++) {
    const possible = permutations(n), before = levels.length;
    let attempts = 0;
    while (levels.length < before + 12) {
      if (++attempts > 100000) throw new Error(`${n} 阶生成次数超限`);
      const desired = pick(possible), regions = grow(n, desired);
      if (!regions) continue;
      const key = canonical(n, regions);
      if (seen.has(key)) continue;
      const check = verifyWithPermutations(n, regions, possible);
      if (check.count !== 1) continue;
      const local = levels.length - before;
      const level = { id: levels.length + 1, size: n, regions, solution: check.solution.slice(), difficulty: 'easy' };
      if (n === 5 && local < 8) {
        const rows = Array.from({ length: n }, (_, r) => r);
        const first = pick(rows);
        level.given = [first * n + level.solution[first]];
        if (local < 3) { const second = pick(rows.filter(r => r !== first)); level.given.push(second * n + level.solution[second]); }
      }
      if (!validateLevel(level) || solve(level).length !== 1) throw new Error('交叉验证失败');
      let profile = logicalProfile(level);
      if (n === 5 && local < 5 && difficultyForProfile(profile) !== 'easy') continue;
      level.difficulty = difficultyForProfile(profile);
      profiles.push({ id: level.id, ...profile });
      seen.add(key); levels.push(level);
    }
    stats.push({ size: n, count: 12, attempts, eligiblePermutations: possible.length });
    console.log(`${n} × ${n}：12 关，${attempts} 次候选，${possible.length} 个不相邻排列`);
  }
  const source = path.join(__dirname, '../src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'levels.js'), "'use strict';\n// 固定种子生成的 60 个原创关卡；运行时不执行生成过程。\nmodule.exports = " + JSON.stringify(levels) + ';\n');
  const report = { seed: '0x71c4a39d', count: levels.length, elapsedMs: Date.now() - started, stats, verification: '全部关卡四邻接连通；全部无预置条件唯一解；八种旋转/镜像与区域重编号去重；运行时求解器与独立行排列枚举器交叉校验。', difficultyBasis, profiles };
  fs.mkdirSync(path.join(__dirname, '../tests'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../tests/level-generation.json'), JSON.stringify(report, null, 2));
  console.log(`共 ${report.count} 关，${report.elapsedMs} 毫秒；推理分档：${JSON.stringify(levels.reduce((out, l) => { out[l.difficulty] = (out[l.difficulty] || 0) + 1; return out; }, {}))}`);
}

if (require.main === module) main();
module.exports = { permutations, verifyWithPermutations, canonical, logicalProfile, difficultyForProfile, difficultyBasis };
