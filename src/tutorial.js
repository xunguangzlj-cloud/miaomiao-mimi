'use strict';

// 独立教学状态机；只保留本模块的猫和叉，不读取或写入正式关卡存档。
function createTutorial(options) {
  const { p, ctx, w, top, bottom, helpers, onDone, onExit, onSound = () => {} } = options;
  const { box, text, wrap, button, drawBoard, getBoard } = helpers;
  const level = {
    id: 0, size: 4, regions: [0, 1, 2, 1, 0, 1, 1, 1, 0, 0, 3, 1, 0, 3, 3, 1],
    solution: [2, 0, 3, 1], colorMap: ['#38A9C0', '#FA9D5C', '#8BD57D', '#D36F8F']
  };
  const targets = { 1: [2], 3: [0, 1, 3, 6, 10, 14], 4: [13], 5: [8, 9, 12], 6: [4] };
  const messages = [
    '', '轻点两次亮起的格子，找到第一只猫。', '每个颜色区域只能有一只猫，记住了吗？',
    '猫所在行和列不能再有猫。点击或滑动，把亮起的格子打叉。',
    '粉色区域只剩这一格，轻点两次放猫。', '继续排除邻近格。点击或滑动，把亮起的格子打叉。',
    '蓝色区域只剩这一格，轻点两次放猫。', '最后一只交给你！每行、每列、每色一只，猫之间不能紧挨着。'
  ];
  let phase = 1, cats = [], marks = [], completed = false, active = false, gesture = null, lastTap = null;

  function start() {
    phase = 1;
    cats = [];
    marks = [];
    completed = false;
    active = true;
    gesture = null;
    lastTap = null;
  }
  function cancel() {
    if (gesture && gesture.before) { marks = gesture.before; phase = gesture.phase; }
    gesture = null; lastTap = null;
  }
  function allowed(cell, stage) {
    return cell >= 0 && !cats.includes(cell) && (stage === 7 || (targets[stage] || []).includes(cell));
  }
  function cellAt(x, y) {
    const b = getBoard();
    if (!b || x < b.x || y < b.y || x >= b.x + b.size || y >= b.y + b.size) return -1;
    return Math.floor((y - b.y) / b.cell) * 4 + Math.floor((x - b.x) / b.cell);
  }
  function inside(b, x, y) { return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height; }
  function mark(cell, value, stage) {
    if (!allowed(cell, stage)) return;
    const before = marks.includes(cell);
    if (value && !marks.includes(cell)) marks.push(cell);
    if (!value && stage === 7) marks = marks.filter(c => c !== cell);
    if (before !== marks.includes(cell)) onSound(value ? 'mark' : 'unmark');
  }
  function advanceMarks(stage) {
    if (phase === stage && (stage === 3 || stage === 5) && targets[stage].every(cell => marks.includes(cell))) {
      phase++; lastTap = null;
    }
  }
  function place(cell) {
    cats.push(cell); marks = marks.filter(c => c !== cell); lastTap = null;
    onSound('correct');
    if (phase === 7) { completed = true; active = false; if (onDone) onDone(); }
    else phase++;
  }

  function render() {
    const compact = bottom - top < 540, y = top + (compact ? 113 : 141);
    const size = Math.min(w * 919 / 1080, bottom - y - 72), x = (w - size) / 2;
    text('找猫入门', w / 2, top + 18, 19, '#935A5A', 'center', true);
    button('跳过教学', w - 94, top + 2, 80, 32, () => { cancel(); active = false; if (onExit) onExit(); });
    text('第 ' + phase + ' 步 / 7', 20, top + 51, 11, '#A19189');
    const panelY = top + 64, panelH = compact ? 43 : 67;
    box(18, panelY, w - 36, panelH, '#FFFBF7', 12, '#E6D7D0');
    wrap(messages[phase], 30, panelY + 15, w - 60, compact ? 11 : 13, '#935A5A', compact ? 14 : 19);
    drawBoard(level, cats, marks, [], x, y, size, true);
    const b = getBoard(), focus = targets[phase] || [];
    if (b && focus.length) {
      for (let cell = 0; cell < 16; cell++) {
        if (focus.includes(cell) || cats.includes(cell)) continue;
        ctx.fillStyle = 'rgba(0,0,0,.43)';
        ctx.fillRect(b.x + cell % 4 * b.cell, b.y + Math.floor(cell / 4) * b.cell, b.cell, b.cell);
      }
      focus.forEach(cell => {
        ctx.strokeStyle = '#FFF8DF'; ctx.lineWidth = 2;
        ctx.strokeRect(b.x + cell % 4 * b.cell + 3, b.y + Math.floor(cell / 4) * b.cell + 3, b.cell - 6, b.cell - 6);
      });
      const target = focus.find(cell => !marks.includes(cell)) === undefined ? focus[0] : focus.find(cell => !marks.includes(cell));
      const hx = b.x + (target % 4 + .67) * b.cell, hy = b.y + (Math.floor(target / 4) + .65) * b.cell;
      const pulse = 1 + Math.sin(p.now() / 250) * .04;
      ctx.save(); ctx.translate(hx, hy); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#FFF4E6'; ctx.strokeStyle = '#B78F77'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-5, 17); ctx.lineTo(-5, -6); ctx.quadraticCurveTo(0, -12, 5, -6);
      ctx.lineTo(5, 5); ctx.lineTo(17, 9); ctx.lineTo(15, 27); ctx.lineTo(0, 28); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (phase === 2) {
      button('明白了', 26, y + size + 16, w - 52, 42, () => { phase = 3; cancel(); }, 'primary');
    } else {
      text(phase === 3 || phase === 5 ? '已打叉的格子不能擦除，试着滑动吧' : phase === 7 ? '练习阶段不会消耗机会' : '第一下不会打叉，第二次松手才放猫', w / 2, y + size + 27, 11, '#A19189', 'center');
    }
  }

  function pointer(event, buttons) {
    if (!active || completed) return;
    const cell = cellAt(event.x, event.y), time = Number.isFinite(event.time) ? event.time : p.now();
    if (event.type === 'cancel') { cancel(); return; }
    if (event.type === 'down') {
      const hit = (buttons || []).find(b => inside(b, event.x, event.y));
      if (hit) { lastTap = null; gesture = { button: hit }; return; }
      if (phase === 2 || !allowed(cell, phase)) { gesture = null; lastTap = null; return; }
      gesture = { cell, phase, before: marks.slice(), value: phase === 7 ? !marks.includes(cell) : true, moved: false, x: event.x, y: event.y };
      return;
    }
    if (!gesture) return;
    if (event.type === 'move' && gesture.before) {
      const g = gesture;
      if (cell !== g.cell) g.moved = true;
      if ((g.phase !== 3 && g.phase !== 5 && g.phase !== 7) || g.phase !== phase) return;
      const b = getBoard(), dx = event.x - g.x, dy = event.y - g.y;
      const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (b.cell / 3)));
      // 只修改经过的允许格；被限制格、猫和棋盘外均跳过。
      for (let k = 0; k <= count; k++) {
        const passed = cellAt(g.x + dx * k / count, g.y + dy * k / count);
        mark(passed, g.value, g.phase);
      }
      g.x = event.x; g.y = event.y; advanceMarks(g.phase); lastTap = null;
      return;
    }
    if (event.type !== 'up') return;
    const g = gesture; gesture = null;
    if (g.button) {
      if (inside(g.button, event.x, event.y) && typeof g.button.action === 'function') { onSound('click'); g.button.action(); }
      return;
    }
    if (g.phase !== phase) return;
    if (g.moved) { lastTap = null; advanceMarks(g.phase); return; }
    if (cell !== g.cell) { lastTap = null; return; }
    const catStep = phase === 1 || phase === 4 || phase === 6 || phase === 7 && cell === 11;
    if (catStep) {
      // 教学窗口从第一次松手开始，第二次松手在 350 毫秒内才提交。
      const gap = lastTap ? time - lastTap.time : Infinity;
      if (lastTap && lastTap.cell === cell && gap >= 0 && gap <= 350) place(cell);
      else lastTap = { cell, time };
    } else {
      mark(cell, g.value, phase); lastTap = null; advanceMarks(phase);
    }
  }

  return {
    start, render, pointer, cancel,
    getState: () => ({
      phase,
      cats: cats.slice(),
      marks: marks.slice(),
      completed,
      screen: 'tutorial',
      levelId: 0,
      size: 4,
      hearts: 3,
      board: getBoard()
    })
  };
}

module.exports = { createTutorial };
