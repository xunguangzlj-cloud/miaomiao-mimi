'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkPackage } = require('../tools/check-package.cjs');
const scratch = path.resolve(__dirname, '../work/package-check-fixtures');
const MIB = 1024 * 1024;

function fixture(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'fixture-'));
  t.after(() => {
    // 只清理本次在 D 盘工作目录创建的测试工程。
    assert.equal(path.dirname(path.resolve(root)), scratch);
    assert.ok(path.basename(root).startsWith('fixture-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(relative, value) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, typeof value === 'number' ? '' : value);
    if (typeof value === 'number') fs.truncateSync(filename, value);
  }
  const project = { compileType: 'game', appid: 'wx0000000000000000', packOptions: { ignore: [
    { type: 'folder', value: 'web' }, { type: 'folder', value: 'docs' }, { type: 'folder', value: 'tests' },
    { type: 'folder', value: 'tools' }, { type: 'file', value: 'package.json' }
  ] } };
  const game = { deviceOrientation: 'portrait', openDataContext: 'open-data',
    subpackages: [{ name: 'celebration', root: 'celebration-assets/' }, { name: 'animals', root: 'animal-assets/' }, { name: 'audio', root: 'audio-assets/' }, { name: 'splash', root: 'splash-assets/' }] };
  write('game.js', "'use strict';\n");
  for (const name of ['game', 'logic', 'levels', 'cosmetics', 'cosmetic-art', 'tutorial', 'platform', 'art', 'audio', 'progression', 'input-ui', 'sprite-frames', 'boot', 'splash', 'quotes']) write('src/' + name + '.js', "'use strict';\n");
  for (const name of ['index', 'view', 'ranking', 'sync']) write('open-data/' + name + '.js', "'use strict';\n");
  write('assets/animal-faces.png', 100);
  write('assets/fish_full.png', 100); write('assets/fish_dim.png', 100);
  write('celebration-assets/game.js', "'use strict';\n"); write('celebration-assets/celebration.png', 100);
  write('animal-assets/game.js', "'use strict';\n"); write('animal-assets/expressions.png', 100);
  write('audio-assets/game.js', "'use strict';\n"); write('audio-assets/bgm_rain_piano.mp3', 100);
  write('splash-assets/game.js', "'use strict';\n"); write('splash-assets/loading-cat.png', 100);
  for (const module of ['ui-frames', 'cat-frames', 'level-data', 'garden-frames', 'garden-art', 'home-flow']) write('src/' + module + '.js', "'use strict';\n");
  write('splash-assets/garden-logo.png', 100);
  for (const name of ['ui', 'garden']) { game.subpackages.push({ name, root: name + '-assets/' }); write(name + '-assets/game.js', "'use strict';\n"); }
  for (const file of ['ui-atlas', 'cat-atlas', 'home-grid', 'home-grid-mask']) write('ui-assets/' + file + '.png', 100);
  write('garden-assets/plant-growth.png', 100);
  for (const name of ['board_enter_1', 'mark_x_2', 'unmark_x_2', 'mark_cat', 'mark_wrong_1', 'use_hint', 'all_cleared', 'level_win', 'level_fail', 'btn_click_2', 'dlg_open_1']) write('assets/audio/' + name + '.mp3', 100);
  function saveConfig() { write('project.config.json', JSON.stringify(project)); write('game.json', JSON.stringify(game)); }
  saveConfig();
  return { root, project, game, write, saveConfig, check: () => { saveConfig(); return checkPackage(root); } };
}

test('主包与分包分别统计，正式总包超过 4 MiB 仍通过，交付辅助文件不入包', t => {
  const f = fixture(t);
  f.write('assets/animal-faces.png', Math.floor(2.5 * MIB)); f.write('celebration-assets/celebration.png', 2 * MIB);
  f.write('web/preview.js', 8 * MIB); f.write('docs/说明.md', 8 * MIB); f.write('tests/mock.js', 8 * MIB);
  f.write('tools/test.js', 8 * MIB); f.write('package.json', 8 * MIB); f.write('.draft', 8 * MIB);
  const result = f.check();
  assert.equal(result.status, '通过'); assert.ok(result.mainBytes < 3 * MIB); assert.ok(result.totalBytes > 4 * MIB);
  assert.equal(result.totalBytes, result.mainBytes + result.subpackages.reduce((sum, item) => sum + item.bytes, 0));
  assert.equal(result.subpackages[0].name, 'celebration'); assert.equal(result.subpackages[0].root, 'celebration-assets');
  assert.equal(result.mainFiles.some(row => row.file.startsWith('celebration-assets/')), false);
  assert.equal(result.mainFiles.some(row => row.file.startsWith('animal-assets/')), false);
  assert.equal(result.mainFiles.some(row => row.file === 'assets/animal-faces.png'), true);
  assert.equal(result.files.some(row => ['web/', 'docs/', 'tests/', 'tools/', '.'].some(prefix => row.file.startsWith(prefix))), false);
  assert.equal(result.files.some(row => row.file === 'project.config.json' || row.file === 'package.json'), false);
  assert.equal(result.officialTotalPackageLimitBytes, 30 * MIB); assert.equal(result.appidConfigured, true);
});

test('主包 3 MiB 工程预算和 4 MiB 官方上限分别报错', t => {
  const f = fixture(t); f.write('assets/animal-faces.png', 3 * MIB);
  const budget = f.check();
  assert.ok(budget.errors.some(error => error.includes('目标 3 MiB')));
  assert.equal(budget.errors.some(error => error.includes('官方 4M')), false);
  f.write('assets/animal-faces.png', 4 * MIB);
  assert.ok(f.check().errors.some(error => error.includes('官方 4M')));
});

test('庆祝普通分包超过 4 MiB 只报工程分包预算，不冒认官方普通分包限制', t => {
  const f = fixture(t); f.write('celebration-assets/celebration.png', 4 * MIB);
  const result = f.check();
  assert.ok(result.errors.some(error => error.includes('分包超过工程 4 MiB')));
  assert.equal(result.errors.some(error => error.includes('主包超过')), false);
  assert.equal(result.errors.some(error => error.includes('总包超过')), false);
});

test('所有包合计超过官方 30 MiB 时失败，各子包分别保持 4 MiB 预算', t => {
  const f = fixture(t);
  for (let index = 0; index < 8; index++) {
    const root = 'extra-' + index;
    f.game.subpackages.push({ name: root, root: root + '/' });
    f.write(root + '/game.js', "'use strict';\n"); f.write(root + '/image.bin', Math.floor(3.9 * MIB));
  }
  const result = f.check();
  assert.ok(result.errors.some(error => error.includes('总包超过微信官方 30M')));
  assert.equal(result.errors.some(error => error.includes('分包超过工程')), false);
});

test('新运行模块、动物图集、全部音频和庆祝分包入口均不能被排除', t => {
  const f = fixture(t);
  for (const filename of ['src/art.js', 'src/audio.js', 'src/progression.js', 'src/input-ui.js', 'src/boot.js', 'src/splash.js', 'src/quotes.js', 'assets/animal-faces.png', 'splash-assets/loading-cat.png',
    'assets/audio/mark_cat.mp3', 'assets/fish_full.png', 'assets/fish_dim.png', 'audio-assets/game.js', 'audio-assets/bgm_rain_piano.mp3', 'celebration-assets/game.js', 'celebration-assets/celebration.png',
    'animal-assets/game.js', 'animal-assets/expressions.png']) {
    f.project.packOptions.ignore.push({ type: 'file', value: filename });
    assert.ok(f.check().errors.includes('缺少正式运行文件：' + filename), filename);
    f.project.packOptions.ignore.pop();
  }
});

test('分包必须使用小写 subpackages，缺失庆祝配置不能混入主包误报成功', t => {
  const f = fixture(t); f.game.subPackages = f.game.subpackages; delete f.game.subpackages;
  const result = f.check();
  assert.ok(result.errors.some(error => error.includes('小写 subpackages')));
  assert.ok(result.errors.some(error => error.includes('庆祝资源必须配置')));
  delete f.game.subPackages; f.game.subpackages = {};
  assert.ok(f.check().errors.includes('subpackages 必须为数组。'));
});

test('非法分包路径、重复名称和重叠目录都不能影响主包分类', t => {
  const f = fixture(t);
  for (const root of ['../outside', '/absolute', 'D:/outside', '.', 'a/../outside']) {
    f.game.subpackages.push({ name: 'bad', root });
    assert.ok(f.check().errors.includes('分包 root 必须为工程内相对目录。'), root);
    f.game.subpackages.pop();
  }
  for (const item of [{ name: 'celebration', root: 'other/' }, { name: 'other', root: 'celebration-assets/' },
    { name: 'nested', root: 'celebration-assets/nested/' }]) {
    f.game.subpackages.push(item);
    assert.ok(f.check().errors.includes('分包名称或目录不能重复、互相嵌套。'));
    f.game.subpackages.pop();
  }
});

test('官方要求开放数据域留在主包，分包目录必须包含入口 game.js', t => {
  const f = fixture(t); f.game.subpackages.push({ name: 'friends', root: 'open-data/' });
  assert.ok(f.check().errors.includes('开放数据域必须保留在主包。'));
  f.game.subpackages.pop(); f.game.subpackages.push({ name: 'missing', root: 'missing/' });
  assert.ok(f.check().errors.includes('分包缺少入口：missing/game.js'));
});
