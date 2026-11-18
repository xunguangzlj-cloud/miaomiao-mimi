'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startGame } = require('../src/game.js');
const levels = require('../src/levels.js');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// 显式控制时间与前后台事件，验证续局和动画生命周期。
function mock(options) {
  options = options || {};
  let time = Date.UTC(2026, 9, 13, 8), saved = clone(options.saved), frame;
  const hooks = {}, draws = [], transforms = [], texts = [], stack = [], ctx = new Proxy({
    globalAlpha: 1, fillStyle: '#000000', strokeStyle: '#000000',
    save() { stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); },
    restore() { if (stack.length) Object.assign(this, stack.pop()); },
    fillRect(...args) { draws.push({ args, style: this.fillStyle, alpha: this.globalAlpha }); },
    fillText(value, ...args) { texts.push({ value, args, alpha: this.globalAlpha }); }
  }, {
    get(target, key) {
      if (key === 'measureText') return value => ({ width: String(value).length * 12 });
      if (['translate', 'scale', 'rotate'].includes(key)) return (...args) => { transforms.push({ method: key, args }); };
      return key in target ? target[key] : (() => {});
    }
  });
  const platform = {
    ctx, width: 390, height: 844, safeTop: 80, safeBottom: 34,
    now: () => time, requestFrame: fn => { frame = fn; }, vibrate() {},
    storage: { get: () => clone(saved), set: (key, value) => { saved = clone(value); return true; } },
    onPointer(fn) { hooks.pointer = fn; }, onHide(fn) { hooks.hide = fn; }, onShow(fn) { hooks.show = fn; }
  };
  return {
    game: startGame({ platform }), now: () => time, advance: ms => { time += ms; },
    saved: () => clone(saved), hide: () => hooks.hide(), show: () => hooks.show(), frame: () => { if (frame) frame(); },
    pointer: (type, point) => hooks.pointer({ type, x: point.x, y: point.y, time }), draws, transforms, texts
  };
}

function load(env) { env.game.startLevel(13, false); env.game.render(); return levels[12]; }
function solutions(level) { return level.solution.map((column, row) => row * level.size + column); }
function wrong(level) { const good = solutions(level); return level.regions.map((_, cell) => cell).filter(cell => !good.includes(cell)); }
function point(env, cell) {
  const board = env.game.getState().board;
  return { x: board.x + (cell % board.n + .5) * board.cell, y: board.y + (Math.floor(cell / board.n) + .5) * board.cell };
}
function axisPoint(env, axis, along, across) {
  const board = env.game.getState().board;
  return { x: board.x + (axis === 'row' ? along : across) * board.cell, y: board.y + (axis === 'row' ? across : along) * board.cell };
}
function failed() {
  const env = mock(), level = load(env);
  wrong(level).slice(0, 3).forEach(cell => env.game.placeCat(cell)); env.game.render();
  assert.equal(env.game.getState().screen, 'fail');
  return env;
}
function won() {
  const env = mock(), level = load(env); env.advance(1250);
  solutions(level).forEach(cell => env.game.placeCat(cell)); env.game.render();
  assert.equal(env.game.getState().screen, 'win'); return env;
}
function revivalPoint() {
  const sample = failed(); sample.advance(1500); sample.game.render();
  const button = sample.game.getState().buttons.find(item => item.label.includes('恢复三条鱼'));
  assert.ok(button); sample.game.stop();
  return { x: button.x + button.width / 2, y: button.y + button.height / 2 };
}
function tap(env, target) { env.pointer('down', target); env.pointer('up', target); env.game.render(); }
function lastBlackMaskAlpha(env) {
  for (let i = env.draws.length - 1; i >= 0; i--) {
    const call = env.draws[i];
    if (call.args[0] !== 0 || call.args[1] !== 0 || call.args[2] !== 390 || call.args[3] !== 844) continue;
    const style = String(call.style).toLowerCase().replace(/\s/g, '');
    if (['black', '#000', '#000000', 'rgb(0,0,0)'].includes(style)) return call.alpha;
    const match = style.match(/^rgba\(0,0,0,([\d.]+)\)$/);
    if (match) return Number(match[1]) * call.alpha;
  }
  assert.fail('没有记录到全屏黑色遮罩绘制。');
}

test('新用户不再保存自动排除设置，落猫不自动替玩家打叉', () => {
  const env = mock(), level = load(env); env.game.placeCat(solutions(level)[0]);
  assert.equal(Object.hasOwn(env.saved().settings, 'autoMark'), false); assert.deepEqual(env.game.getState().marks, []); env.game.stop();
});
test('旧存档中的自动排除值均被清除，正确落猫不会补排除叉', () => {
  for (const value of [true, false, 'true', 1, null]) {
    const env = mock({ saved: { settings: { autoMark: value, vibrate: false } } }), level = load(env), good = solutions(level)[0];
    assert.equal(Object.hasOwn(env.saved().settings, 'autoMark'), false, '启动就持久化移除旧设置');
    env.game.placeCat(good); assert.equal(Object.hasOwn(env.game.getState().settings, 'autoMark'), false);
    assert.deepEqual(env.game.getState().marks, []);
    env.game.stop();
  }
});
test('失败棋盘可存档恢复，复活仅补三心并继续原猫、标记和红叉', () => {
  const env = mock(), level = load(env), bad = wrong(level), good = solutions(level)[0];
  const bounds = clone(env.game.getState().board);
  env.game.placeCat(good); env.game.toggleMark(bad[3]); env.advance(1750); bad.slice(0, 3).forEach(cell => env.game.placeCat(cell));
  const failed = env.game.getState(); assert.equal(failed.screen, 'fail'); assert.equal(env.saved().session.hearts, 0);
  env.game.render(); assert.deepEqual(env.game.getState().board, bounds);
  env.advance(30000); assert.equal(env.game.getState().elapsed, 1750);
  const restored = mock({ saved: env.saved() }); restored.game.resume();
  assert.equal(restored.game.getState().screen, 'fail'); assert.deepEqual(restored.game.getState().cats, failed.cats);
  assert.deepEqual(restored.game.getState().marks, failed.marks); assert.deepEqual(restored.game.getState().errors, failed.errors);
  restored.game.revive(); const continued = restored.game.getState();
  assert.equal(continued.screen, 'play'); assert.equal(continued.hearts, 3); assert.equal(continued.revives, failed.revives + 1);
  assert.deepEqual(continued.cats, failed.cats); assert.deepEqual(continued.marks, failed.marks); assert.deepEqual(continued.errors, failed.errors);
  assert.equal(continued.elapsed, 1750); restored.advance(500); assert.equal(restored.game.getState().elapsed, 2250);
  assert.equal(restored.saved().session.hearts, 3); env.game.stop(); restored.game.stop();
});
test('正常游戏中重复调用复活不能增加次数或重置棋盘', () => {
  const env = mock(), level = load(env); env.game.placeCat(solutions(level)[0]); const before = env.game.getState(); env.game.revive();
  assert.equal(env.game.getState().revives, before.revives); assert.deepEqual(env.game.getState().cats, before.cats); env.game.stop();
});
test('旧版本续局缺少道具与步数统计时仍可恢复', () => {
  const level = levels[12], cat = solutions(level)[0];
  const env = mock({ saved: { settings: { autoMark: false }, session: { levelId: 13, daily: false, cats: [cat], marks: [], errors: [], hearts: 2, hints: 1, elapsed: 2300, mode: 'mark' } } });
  env.game.resume(); const state = env.game.getState(); assert.deepEqual(state.cats, [cat]); assert.equal(state.hearts, 2); assert.equal(state.hints, 1); assert.equal(state.elapsed, 2300);
  assert.equal(state.steps, 0); assert.equal(state.locates, 0); assert.equal(state.revives, 0); env.game.stop();
});
test('独立找猫道具放正确猫，仅增加找猫次数与一步', () => {
  const env = mock(), level = load(env), before = env.game.getState(); env.game.locate(); const after = env.game.getState();
  assert.equal(after.cats.length, before.cats.length + 1); assert.ok(after.cats.every(cell => solutions(level).includes(cell)));
  assert.equal(after.locates, before.locates + 1); assert.equal(after.hints, before.hints); assert.equal(after.steps, before.steps + 1);
  assert.equal(after.hearts, 3); assert.equal(env.saved().session.locates, after.locates); env.game.stop();
});
test('提示查看即计次，应用修复错误叉只计一步且不再次收费', () => {
  const env = mock(), level = load(env), good = solutions(level)[0]; env.game.toggleMark(good); const before = env.game.getState();
  env.game.hint(); const preview = env.game.getState(); assert.ok(preview.pendingHint); assert.deepEqual(preview.marks, before.marks); assert.equal(preview.hints, before.hints + 1); assert.equal(preview.steps, before.steps); assert.equal(preview.progression.inventory.hints, before.progression.inventory.hints - 1);
  env.game.hint(); const applied = env.game.getState(); assert.equal(applied.pendingHint, null); assert.ok(!applied.marks.includes(good)); assert.equal(applied.hints, before.hints + 1); assert.equal(applied.steps, before.steps + 1); env.game.stop();
});
test('找猫和重新开始都会清除过期提示覆盖层', () => {
  const env = mock(); load(env); env.game.hint(); assert.ok(env.game.getState().pendingHint); env.game.locate(); assert.equal(env.game.getState().pendingHint, null); assert.equal(env.game.getState().hints, 1);
  env.game.hint(); assert.ok(env.game.getState().pendingHint); env.game.startLevel(14, false); assert.equal(env.game.getState().pendingHint, null); env.game.stop();
});
test('离开棋盘会关闭提示，返回后必须重新预览', () => {
  const env = mock(); load(env); env.game.hint(); assert.ok(env.game.getState().pendingHint); env.game.switchScreen('home'); assert.equal(env.game.getState().pendingHint, null);
  env.game.switchScreen('play'); const before = env.game.getState(); env.game.hint(); assert.equal(env.game.getState().hints, before.hints + 1); assert.equal(env.game.getState().progression.inventory.hints, before.progression.inventory.hints - 1); assert.deepEqual(env.game.getState().cats, before.cats); env.game.stop();
});
test('反馈动画在后台暂停，返回后保留进度并在剩余时长后结束', () => {
  const env = mock(), level = load(env); env.game.placeCat(solutions(level)[0]); assert.equal(env.game.getState().feedback.type, 'cat');
  env.advance(200); const age = env.now() - env.game.getState().feedback.start; env.hide(); env.advance(60000); env.frame(); assert.ok(env.game.getState().feedback); env.show();
  assert.equal(env.now() - env.game.getState().feedback.start, age); env.frame(); assert.ok(env.game.getState().feedback);
  const remaining = env.game.getState().feedback.duration - age; env.advance(remaining - 1); env.frame(); assert.ok(env.game.getState().feedback);
  env.advance(2); env.frame(); assert.equal(env.game.getState().feedback, null); env.game.stop();
});

test('从猫格起笔，首个可写格决定画叉或擦叉，整笔只计一步', () => {
  for (const erase of [false, true]) {
    const env = mock(), level = load(env), cat = solutions(level)[0], neighbor = cat % level.size < level.size - 1 ? cat + 1 : cat - 1;
    env.game.placeCat(cat); env.game.render(); if (erase) env.game.toggleMark(neighbor);
    const before = env.game.getState(), start = point(env, cat), end = point(env, neighbor);
    env.pointer('down', start); env.pointer('move', end); env.pointer('up', end);
    const after = env.game.getState(); assert.equal(after.marks.includes(neighbor), !erase); assert.deepEqual(after.cats, before.cats); assert.equal(after.steps, before.steps + 1);
    env.game.undo(); assert.deepEqual(env.game.getState().marks, before.marks); env.game.stop();
  }
});
test('滑出棋盘提交整笔并锁笔，未松手重入不会续画或重复计步', () => {
  const env = mock(); load(env); const first = point(env, 0), other = point(env, 4), board = env.game.getState().board;
  env.pointer('down', first); env.pointer('move', { x: board.x - 10, y: first.y }); const committed = env.game.getState();
  assert.deepEqual(committed.marks, [0]); assert.equal(committed.steps, 1); assert.deepEqual(env.saved().session.marks, [0]);
  env.pointer('move', other); env.pointer('up', other); assert.deepEqual(env.game.getState().marks, [0]); assert.equal(env.game.getState().steps, 1);
  env.game.undo(); assert.deepEqual(env.game.getState().marks, []); env.game.stop();
});
test('双击窗口从第一次按下计算，长按松手后快点不误放猫', () => {
  const env = mock(), level = load(env), target = point(env, wrong(level)[0]);
  env.pointer('down', target); env.advance(500); env.pointer('up', target); env.advance(100); env.pointer('down', target); env.pointer('up', target);
  assert.equal(env.game.getState().hearts, 3); assert.deepEqual(env.game.getState().errors, []); assert.deepEqual(env.game.getState().marks, []); assert.equal(env.game.getState().steps, 2); env.game.stop();
  const quick = mock(), other = load(quick), good = solutions(other)[0], p = point(quick, good);
  quick.pointer('down', p); quick.pointer('up', p); quick.advance(100); quick.pointer('down', p); quick.pointer('up', p);
  assert.ok(quick.game.getState().cats.includes(good)); assert.equal(quick.game.getState().steps, 1); quick.game.stop();
});
test('取消笔画或在猫格空点不计步，红错误格不能成为笔画起点', () => {
  const env = mock(), level = load(env), from = point(env, 0), to = point(env, 4);
  env.pointer('down', from); env.pointer('move', to); env.pointer('cancel', to); assert.deepEqual(env.game.getState().marks, []); assert.equal(env.game.getState().steps, 0);
  const cat = solutions(level)[0]; env.game.placeCat(cat); env.game.render(); const catsSteps = env.game.getState().steps, catPoint = point(env, cat);
  env.pointer('down', catPoint); env.pointer('up', catPoint); assert.equal(env.game.getState().steps, catsSteps);
  const bad = wrong(level)[0]; env.game.placeCat(bad); env.game.render(); const errorSteps = env.game.getState().steps, errorPoint = point(env, bad);
  env.pointer('down', errorPoint); env.pointer('move', to); env.pointer('up', to); assert.equal(env.game.getState().steps, errorSteps); assert.deepEqual(env.game.getState().marks, []); env.game.stop();
});

test('默认轴保护：快速跨四格锁行或列，浅入邻行列不误画', () => {
  for (const axis of ['row', 'column']) {
    const env = mock(), level = load(env), n = level.size;
    env.pointer('down', axisPoint(env, axis, .5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, 1.2)); env.pointer('up', axisPoint(env, axis, 3.5, 1.2));
    assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), axis === 'row' ? [0, 1, 2, 3] : [0, n, 2 * n, 3 * n]); assert.equal(env.game.getState().steps, 1); env.game.stop();
  }
});
test('默认轴保护：深入邻行列超过容差会释放锁轴', () => {
  for (const axis of ['row', 'column']) {
    const env = mock(), level = load(env), n = level.size;
    env.pointer('down', axisPoint(env, axis, .5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, 1.5)); env.pointer('up', axisPoint(env, axis, 3.5, 1.5));
    assert.ok(env.game.getState().marks.includes(axis === 'row' ? n + 3 : 3 * n + 1)); assert.equal(env.game.getState().steps, 1); env.game.stop();
  }
});
test('默认轴保护：擦叉不锁轴，浅入邻行列也能擦除', () => {
  for (const axis of ['row', 'column']) {
    const env = mock(), level = load(env), n = level.size, initial = axis === 'row' ? [0, 1, 2, 3, n + 3] : [0, n, 2 * n, 3 * n, 3 * n + 1];
    initial.forEach(cell => env.game.toggleMark(cell)); const before = env.game.getState().steps;
    env.pointer('down', axisPoint(env, axis, .5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, .5)); env.pointer('move', axisPoint(env, axis, 3.5, 1.2)); env.pointer('up', axisPoint(env, axis, 3.5, 1.2));
    assert.deepEqual(env.game.getState().marks, []); assert.equal(env.game.getState().steps, before + 1); env.game.stop();
  }
});
test('默认轴保护：不足四格时不吸附，行列均可直接转向', () => {
  for (const axis of ['row', 'column']) {
    const env = mock(), level = load(env), n = level.size;
    env.pointer('down', axisPoint(env, axis, .5, .5)); env.pointer('move', axisPoint(env, axis, 2.5, .5)); env.pointer('move', axisPoint(env, axis, 2.5, 1.2)); env.pointer('up', axisPoint(env, axis, 2.5, 1.2));
    assert.ok(env.game.getState().marks.includes(axis === 'row' ? n + 2 : 2 * n + 1)); assert.equal(env.game.getState().steps, 1); env.game.stop();
  }
});

test('释放锁轴继承已跨过的转向跨度，下一格可再次锁定新轴', () => {
  for (const axis of ['row', 'column']) {
    const env = mock(), level = load(env), n = level.size;
    env.pointer('down', axisPoint(env, axis, .5, .5));
    for (const [along, across] of [[3.5, .5], [3.5, 3.5], [3.5, 4.5], [4.2, 4.5]]) env.pointer('move', axisPoint(env, axis, along, across));
    env.pointer('up', axisPoint(env, axis, 4.2, 4.5));
    const expected = axis === 'row' ? [0, 1, 2, 3, n + 3, 2 * n + 3, 3 * n + 3, 4 * n + 3] : [0, n, 2 * n, 3 * n, 3 * n + 1, 3 * n + 2, 3 * n + 3, 3 * n + 4];
    assert.deepEqual(env.game.getState().marks.slice().sort((a, b) => a - b), expected); env.game.stop();
  }
});
test('跨猫待定阶段先不锁轴，首个可写格确认画叉后再启用保护', () => {
  const env = mock(), level = load(env), column = level.solution[0], direction = column <= level.size - 4 ? 1 : -1, end = column + direction * 3;
  env.game.placeCat(column); env.game.render(); const before = env.game.getState().steps;
  env.pointer('down', axisPoint(env, 'row', column + .5, .5)); env.pointer('move', axisPoint(env, 'row', end + .5, .5)); env.pointer('move', axisPoint(env, 'row', end + .5, 1.2)); env.pointer('up', axisPoint(env, 'row', end + .5, 1.2));
  assert.ok(env.game.getState().marks.includes(level.size + end)); assert.equal(env.game.getState().steps, before + 1); env.game.stop();
});

test('提示遮罩在 300 毫秒达到最终透明度，不等待下一次计时刷新', () => {
  const env = mock(); load(env); env.game.hint(); env.draws.length = 0;
  env.advance(150); env.frame(); const middle = lastBlackMaskAlpha(env);
  env.advance(150); env.frame(); const final = lastBlackMaskAlpha(env);
  assert.ok(middle > 0 && middle < .75); assert.ok(final > middle); assert.ok(Math.abs(final - .75) < 1e-6); env.game.stop();
});
test('失败弹层 1500 毫秒前屏蔽按钮，提前按住也不能在解锁后提交', () => {
  const target = revivalPoint(), env = failed();
  tap(env, target); assert.equal(env.game.getState().screen, 'fail'); assert.equal(env.game.getState().revives, 0);
  env.advance(1499); env.pointer('down', target); env.advance(1); env.pointer('up', target); env.game.render();
  assert.equal(env.game.getState().screen, 'fail'); assert.equal(env.game.getState().revives, 0);
  tap(env, target); assert.equal(env.game.getState().screen, 'play'); assert.equal(env.game.getState().hearts, 3); assert.equal(env.game.getState().revives, 1); env.game.stop();
});
test('失败弹层的后台停留不计入 1500 毫秒按钮门槛', () => {
  const target = revivalPoint(), env = failed(); env.advance(100); env.hide(); env.advance(60000); env.frame(); env.show(); env.game.render();
  tap(env, target); assert.equal(env.game.getState().screen, 'fail');
  env.advance(1399); tap(env, target); assert.equal(env.game.getState().screen, 'fail'); assert.equal(env.game.getState().revives, 0);
  env.advance(1); tap(env, target); assert.equal(env.game.getState().screen, 'play'); assert.equal(env.game.getState().revives, 1); env.game.stop();
});

test('获胜弹层的标题、猫浮动与按钮淡入在后台冻结，返回后继续', () => {
  for (const age of [300, 1050]) {
    const env = won(); env.advance(age); env.transforms.length = 0; env.texts.length = 0; env.frame();
    const before = clone(env.transforms), visible = clone(env.texts), alpha = env.texts.findLast(item => item.value.startsWith('下一关')).alpha;
    if (age === 1050) assert.ok(alpha > 0 && alpha < 1); assert.equal(env.game.getState().elapsed, 1250);
    env.hide(); env.transforms.length = 0; env.texts.length = 0; env.advance(60000); env.frame();
    assert.deepEqual(env.transforms, []); assert.deepEqual(env.texts, []);
    env.show(); env.frame();
    assert.deepEqual(env.transforms, before); assert.deepEqual(env.texts, visible);
    assert.equal(env.game.getState().elapsed, 1250); assert.equal(env.saved().completed[13].time, 1250);
    env.advance(300); env.transforms.length = 0; env.texts.length = 0; env.frame();
    assert.notDeepEqual(env.transforms, before);
    if (age === 1050) assert.equal(env.texts.findLast(item => item.value.startsWith('下一关')).alpha, 1); env.game.stop();
  }
});
test('获胜页下一关立即保存新棋局并保留成绩，重启恢复新关而不重记旧关', () => {
  for (const delay of [0, 1300]) {
    const env = won(), record = clone(env.saved().completed[13]);
    assert.equal(env.saved().session, null); env.advance(delay); env.game.render();
    const button = env.game.getState().buttons.find(item => item.label.startsWith('下一关'));
    assert.ok(button); tap(env, { x: button.x + button.width / 2, y: button.y + button.height / 2 });
    const after = env.game.getState(); assert.equal(after.screen, 'play'); assert.equal(after.levelId, 14);
    assert.deepEqual(after.cats, levels[13].given || []); assert.deepEqual(after.marks, []); assert.deepEqual(after.errors, []);
    assert.equal(after.hearts, 3); assert.equal(after.elapsed, 0); assert.equal(after.steps, 0);
    assert.deepEqual(env.saved().completed[13], record); assert.equal(env.saved().session.levelId, 14); assert.equal(env.saved().session.elapsed, 0);
    const restored = mock({ saved: env.saved() }); restored.game.resume();
    assert.equal(restored.game.getState().levelId, 14); assert.deepEqual(restored.game.getState().cats, after.cats);
    assert.deepEqual(restored.saved().completed[13], record); env.game.stop(); restored.game.stop();
  }
});
