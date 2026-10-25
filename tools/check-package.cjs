'use strict';

const fs = require('node:fs');
const path = require('node:path');
const MIB = 1024 * 1024;
const required = ['game.js', 'game.json', 'src/game.js', 'src/logic.js', 'src/levels.js', 'src/tutorial.js', 'src/platform.js', 'src/boot.js', 'src/splash.js', 'src/quotes.js',
  'src/cosmetics.js', 'src/cosmetic-art.js', 'src/art.js', 'src/audio.js', 'src/progression.js', 'src/input-ui.js', 'src/sprite-frames.js', 'src/ui-frames.js', 'src/cat-frames.js',
  'src/level-data.js', 'src/garden-frames.js', 'src/garden-art.js', 'src/home-flow.js', 'assets/animal-faces.png', 'assets/fish_full.png', 'assets/fish_dim.png',
  'open-data/index.js', 'open-data/view.js', 'open-data/ranking.js', 'open-data/sync.js',
  'celebration-assets/game.js', 'celebration-assets/celebration.png', 'animal-assets/game.js', 'animal-assets/expressions.png',
  'audio-assets/game.js', 'audio-assets/bgm_rain_piano.mp3',
  'splash-assets/game.js', 'splash-assets/loading-cat.png',
  'splash-assets/garden-logo.png', 'ui-assets/game.js', 'ui-assets/ui-atlas.png', 'ui-assets/cat-atlas.png', 'ui-assets/home-grid.png', 'ui-assets/home-grid-mask.png',
  'garden-assets/game.js', 'garden-assets/plant-growth.png',
  ...['board_enter_1', 'mark_x_2', 'unmark_x_2', 'mark_cat', 'mark_wrong_1', 'use_hint', 'all_cleared', 'level_win', 'level_fail', 'btn_click_2', 'dlg_open_1'].map(name => 'assets/audio/' + name + '.mp3')];
const alwaysExclude = new Set(['project.config.json', 'project.private.config.json']);

function checkPackage(directory) {
  const root = path.resolve(directory);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const gameConfig = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  const ignored = (config.packOptions && config.packOptions.ignore) || [];
  const rows = [], errors = [], subpackages = [];

  function isIgnored(relative) {
    return alwaysExclude.has(relative) || relative.startsWith('.') || ignored.some(rule => {
      const value = rule.value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const name = relative.toLowerCase();
      if (rule.type === 'folder') return name === value || name.startsWith(value + '/');
      if (rule.type === 'file') return name === value;
      if (rule.type === 'suffix') return name.endsWith(value);
      if (rule.type === 'prefix') return name.startsWith(value);
      return false;
    });
  }

  function walk(location, prefix) {
    for (const item of fs.readdirSync(location, { withFileTypes: true })) {
      const relative = (prefix ? prefix + '/' : '') + item.name;
      if (isIgnored(relative)) continue;
      const filename = path.join(location, item.name);
      if (item.isDirectory()) walk(filename, relative);
      else rows.push({ file: relative, bytes: fs.statSync(filename).size });
    }
  }

  walk(root, '');
  for (const filename of required) {
    if (!rows.some(row => row.file === filename)) errors.push('缺少正式运行文件：' + filename);
  }
  if (config.compileType !== 'game') errors.push('compileType 必须为 game。');
  if (gameConfig.deviceOrientation !== 'portrait') errors.push('本工程必须配置竖屏。');
  if (gameConfig.openDataContext !== 'open-data') errors.push('排行榜开放数据域目录必须为 open-data。');
  if (gameConfig.subPackages) errors.push('微信小游戏分包字段必须使用小写 subpackages。');
  const definitions = gameConfig.subpackages || [];
  if (!Array.isArray(definitions)) errors.push('subpackages 必须为数组。');
  else definitions.forEach(item => {
    const packageRoot = item && typeof item.root === 'string' ? item.root.replace(/\\/g, '/').replace(/\/$/, '') : '';
    const segments = packageRoot.split('/');
    if (!packageRoot || segments.some(part => !part || part === '.' || part === '..') || /[:]/.test(packageRoot)) {
      errors.push('分包 root 必须为工程内相对目录。'); return;
    }
    if (subpackages.some(pkg => pkg.name === item.name || pkg.root === packageRoot || pkg.root.startsWith(packageRoot + '/') || packageRoot.startsWith(pkg.root + '/'))) {
      errors.push('分包名称或目录不能重复、互相嵌套。'); return;
    }
    if (packageRoot === 'open-data' || packageRoot.startsWith('open-data/') || 'open-data'.startsWith(packageRoot + '/')) {
      errors.push('开放数据域必须保留在主包。'); return;
    }
    const files = rows.filter(row => row.file.startsWith(packageRoot + '/'));
    if (!files.some(row => row.file === packageRoot + '/game.js')) errors.push('分包缺少入口：' + packageRoot + '/game.js');
    const bytes = files.reduce((sum, row) => sum + row.bytes, 0);
    // 普通分包当前无官方单包上限；本工程仍采用 4 MiB 的分包体积预算。
    if (bytes > 4 * MIB) errors.push('分包超过工程 4 MiB 预算：' + packageRoot);
    subpackages.push({ name: item.name, root: packageRoot, bytes, kibibytes: Number((bytes / 1024).toFixed(2)),
      targetBytes: 4 * MIB, files });
  });
  if (!subpackages.some(pkg => pkg.name === 'celebration' && pkg.root === 'celebration-assets')) errors.push('庆祝资源必须配置为 celebration 分包。');
  if (!subpackages.some(pkg => pkg.name === 'audio' && pkg.root === 'audio-assets')) errors.push('音乐必须配置为 audio 分包。');
  if (!subpackages.some(pkg => pkg.name === 'splash' && pkg.root === 'splash-assets')) errors.push('启动图必须配置为 splash 分包。');
  if (!subpackages.some(pkg => pkg.name === 'ui' && pkg.root === 'ui-assets')) errors.push('界面图必须配置为 ui 分包。');
  if (!subpackages.some(pkg => pkg.name === 'garden' && pkg.root === 'garden-assets')) errors.push('成长盆栽必须配置为 garden 分包。');
  const mainFiles = rows.filter(row => !subpackages.some(pkg => row.file.startsWith(pkg.root + '/')));
  const mainBytes = mainFiles.reduce((sum, row) => sum + row.bytes, 0);
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  if (mainBytes > 3 * MIB) errors.push('主包超过完整体验版目标 3 MiB。');
  if (mainBytes > 4 * MIB) errors.push('主包超过微信官方 4M 上限。');
  if (totalBytes > 30 * MIB) errors.push('总包超过微信官方 30M 上限。');
  return {
    status: errors.length ? '失败' : '通过', totalBytes, kibibytes: Number((totalBytes / 1024).toFixed(2)),
    mainBytes, mainKibibytes: Number((mainBytes / 1024).toFixed(2)), targetBytes: 3 * MIB,
    officialMainPackageLimitBytes: 4 * MIB, officialTotalPackageLimitBytes: 30 * MIB,
    appidConfigured: /^wx[0-9a-f]{16}$/i.test(config.appid || ''), mainFiles, subpackages, files: rows, errors,
    note: '统计未压缩正式运行文件；主包与分包分别计数，总包允许超过 4 MiB。普通分包 4 MiB 为工程预算；实际上传体积以微信开发者工具为准。'
  };
}

if (require.main === module) {
  const result = checkPackage(path.resolve(__dirname, '..'));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length ? 1 : 0;
}

module.exports = { checkPackage };
