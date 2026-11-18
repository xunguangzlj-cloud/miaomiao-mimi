'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const levels = require('../src/levels.js');
const { logicalProfile, difficultyForProfile, difficultyBasis } = require('./generate-levels.cjs');

// 只重算已有棋盘的难度，不执行随机生成，也不更改区域、答案或预置猫。
const fingerprint = () => crypto.createHash('sha256').update(JSON.stringify(levels.map(level => ({ id: level.id, size: level.size, regions: level.regions, solution: level.solution, given: level.given || [] })))).digest('hex');
const before = fingerprint(), started = Date.now(), profiles = [];
for (const level of levels) {
  const profile = logicalProfile(level);
  level.difficulty = difficultyForProfile(profile);
  profiles.push({ id: level.id, ...profile });
}
if (fingerprint() !== before) throw new Error('难度统计意外修改了棋盘');
const reportPath = path.join(__dirname, '../tests/level-generation.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
Object.assign(report, { difficultyBasis, profiles, profileVersion: 'layered-2026-10-13', profileElapsedMs: Date.now() - started, puzzleFingerprint: before });
report.difficultyCounts = levels.reduce((counts, level) => { counts[level.difficulty] = (counts[level.difficulty] || 0) + 1; return counts; }, {});
fs.writeFileSync(path.join(__dirname, '../src/levels.js'), "'use strict';\n// 固定种子生成的 60 个原创关卡；运行时不执行生成过程。\nmodule.exports = " + JSON.stringify(levels) + ';\n');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ count: levels.length, elapsedMs: report.profileElapsedMs, difficulties: report.difficultyCounts, unchangedPuzzles: before }));
