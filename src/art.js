'use strict';
const spriteFrames = require('./sprite-frames.js');
const originalUI = require('./ui-frames.js');
const originalCats = require('./cat-frames.js');

// 图集按需分包加载；未就绪时使用Canvas绘制和备用动物图。
function createArt(ctx, box, text, getAtlas, getExpressions, getOriginalUI, getOriginalCats) {
  const frames = { cat: 0, corgi: 9, rabbit: 10, panda: 11, lion: 12, crocodile: 13, duck: 14, calico: 15 };
  function sprite(name, cx, cy, maxWidth, maxHeight) {
    const bitmap = getOriginalUI && getOriginalUI(), frame = originalUI.frames[name];
    if (!bitmap || !frame) return false;
    const [sx, sy, sw, sh] = frame, scale = Math.min(maxWidth / sw, (maxHeight === undefined ? maxWidth : maxHeight) / sh);
    ctx.drawImage(bitmap, sx, sy, sw, sh, cx - sw * scale / 2, cy - sh * scale / 2, sw * scale, sh * scale);
    return true;
  }
  function drawAnimal(bitmap, collection, index, cx, cy, size) {
    const [sx, sy, sw, sh, ax, ay] = collection.frames[index];
    const extent = 2 * Math.max(ax - sx, sx + sw - ax, ay - sy, sy + sh - ay);
    const scale = size / Math.max(collection.nominalSize, extent);
    const dx = cx + (sx - ax) * scale, dy = cy + (sy - ay) * scale;
    const holes = collection.holes[index];
    if (holes) {
      // 两个帧的相邻毛边只占一像素条，用反向路径扣除，不裁掉自己的耳尖。
      ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, sw * scale, sh * scale);
      holes.forEach(([x, y, width, height]) => {
        const hx = cx + (x - ax) * scale, hy = cy + (y - ay) * scale, hw = width * scale, hh = height * scale;
        ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + hh); ctx.lineTo(hx + hw, hy + hh); ctx.lineTo(hx + hw, hy); ctx.closePath();
      }); ctx.clip();
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
    if (holes) ctx.restore();
  }
  function animal(cx, cy, size, id, expression) {
    const original = id === 'cat' && getOriginalCats && getOriginalCats();
    if (original) {
      drawAnimal(original, originalCats, ((expression || 0) % 9 + 9) % 9, cx, cy, size); return;
    }
    const expanded = getExpressions && getExpressions(), row = ['calico', 'panda', 'rabbit', 'corgi', 'lion', 'crocodile', 'duck'].indexOf(id);
    if (expanded && row >= 0) {
      const col = ((expression || 0) % 9 + 9) % 9;
      drawAnimal(expanded, spriteFrames.expanded, row * 9 + col, cx, cy, size); return;
    }
    const atlas = getAtlas(), frame = id === 'cat' ? ((expression || 0) % 9 + 9) % 9 : frames[id] || 0;
    if (atlas) {
      drawAnimal(atlas, spriteFrames.primary, frame, cx, cy, size);
    } else text(id === 'cat' ? '🐱' : id === 'rabbit' ? '🐰' : id === 'panda' ? '🐼' : id === 'lion' ? '🦁' : '🐾', cx, cy, size * .7, '#935A5A', 'center');
  }
  function silhouette(x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40); ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-18, -5); ctx.lineTo(-18, -19); ctx.quadraticCurveTo(-16, -24, -7, -13); ctx.lineTo(7, -13); ctx.quadraticCurveTo(16, -24, 18, -19); ctx.lineTo(18, -5); ctx.bezierCurveTo(23, 15, 11, 20, 0, 20); ctx.bezierCurveTo(-11, 20, -23, 15, -18, -5); ctx.fill(); ctx.restore();
  }
  function icon(name, x, y, size, color) {
    // 工具调用传入圆直径的55%，原灯泡框占圆直径的106/210。
    if (name === 'bulb' && sprite('icon_hint_lamp', x, y, size * 67 / (210 * .55), size * 106 / (210 * .55))) return;
    if (name === 'gift' && sprite('treasure_box', x, y, size, size)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40); ctx.strokeStyle = color || '#935A5A'; ctx.fillStyle = color || '#935A5A'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (name === 'back') { ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-12, 0); ctx.moveTo(-3, -10); ctx.lineTo(-13, 0); ctx.lineTo(-3, 10); ctx.stroke(); }
    if (name === 'close') { ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke(); }
    if (name === 'settings') { for (let k = 0; k < 8; k++) { ctx.save(); ctx.rotate(k * Math.PI / 4); ctx.fillRect(-3.5, -19, 7, 10); ctx.restore(); } ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
    if (name === 'lock') { ctx.beginPath(); ctx.arc(0, -6, 7, Math.PI, 0); ctx.lineTo(7, 1); ctx.moveTo(-7, -6); ctx.lineTo(-7, 1); ctx.stroke(); box(-11, 0, 22, 18, color || '#935A5A', 4); ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(0, 6, 2, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-1, 6, 2, 7); }
    if (name === 'check') { ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-3, 8); ctx.lineTo(12, -9); ctx.stroke(); }
    if (name === 'edit') { ctx.rotate(.6); ctx.fillRect(-4, -14, 8, 23); ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(4, 12); ctx.lineTo(0, 19); ctx.fill(); }
    if (name === 'music') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-5, -12); ctx.lineTo(12, -16); ctx.lineTo(12, 6); ctx.stroke(); ctx.beginPath(); ctx.ellipse(-10, 11, 7, 5, -.4, 0, Math.PI * 2); ctx.ellipse(7, 7, 7, 5, -.4, 0, Math.PI * 2); ctx.fill(); }
    if (name === 'sound') { ctx.beginPath(); ctx.moveTo(-14, -7); ctx.lineTo(-6, -7); ctx.lineTo(5, -15); ctx.lineTo(5, 15); ctx.lineTo(-6, 7); ctx.lineTo(-14, 7); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(3, 0, 15, -.8, .8); ctx.stroke(); }
    if (name === 'vibrate') { box(-7, -15, 14, 30, color || '#935A5A', 3); ctx.fillStyle = '#FFF'; ctx.fillRect(-4, -12, 8, 21); [-1, 1].forEach(sign => { ctx.beginPath(); ctx.moveTo(sign * 13, -9); ctx.quadraticCurveTo(sign * 19, 0, sign * 13, 9); ctx.stroke(); }); }
    if (name === 'bulb') { const g = ctx.createRadialGradient(-5, -9, 1, 0, -4, 17); if (g) { g.addColorStop(0, '#FFFCC4'); g.addColorStop(.4, '#FFD84B'); g.addColorStop(1, '#F8B800'); } ctx.fillStyle = g || '#FFD84B'; ctx.beginPath(); ctx.ellipse(0, -6, 13, 16, 0, 0, Math.PI * 2); ctx.fill(); box(-6, 6, 12, 9, '#FFCE23', 3); box(-6, 14, 12, 8, '#9071B3', 3); ctx.strokeStyle = '#6F598D'; ctx.lineWidth = 1.5; [-1, 2, 5].forEach(v => { ctx.beginPath(); ctx.moveTo(-5, 17 + v); ctx.lineTo(5, 17 + v); ctx.stroke(); }); }
    if (name === 'gift') { box(-15, -3, 30, 24, '#FFC92B', 4); box(-17, -8, 34, 9, '#FFD653', 3); ctx.fillStyle = '#EF6952'; ctx.fillRect(-3, -8, 6, 29); ctx.beginPath(); ctx.ellipse(-7, -13, 8, 4, .6, 0, Math.PI * 2); ctx.ellipse(7, -13, 8, 4, -.6, 0, Math.PI * 2); ctx.strokeStyle = '#E86649'; ctx.lineWidth = 5; ctx.stroke(); }
    ctx.restore();
  }
  function yarn(x, y, size, faded) {
    // 维持已有毛线球视觉边界：顶y-.94size，底y+.5size。
    if (sprite(faded ? 'wool_unchecked' : 'wool_checked', x, y - size * .22, size, size * 1.44)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 80, size / 80); if (faded) ctx.globalAlpha = .2;
    [[-12, -32, -.4, '#FFD52B'], [14, -27, .5, '#3BB8B5']].forEach(v => { ctx.save(); ctx.translate(v[0], v[1]); ctx.rotate(v[2]); ctx.fillStyle = v[3]; ctx.beginPath(); ctx.ellipse(0, -17, 10, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = v[3]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 0); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -42); ctx.stroke(); ctx.restore(); });
    const g = ctx.createRadialGradient(-9, -1, 2, 0, 13, 29); if (g) { g.addColorStop(0, '#FFC348'); g.addColorStop(1, '#EE8422'); } ctx.fillStyle = g || '#F5A32A'; ctx.beginPath(); ctx.arc(0, 14, 26, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#FFB447'; ctx.lineWidth = 5;
    // 毛线弧限制在球体内，避免叠加椭圆把圆形边缘挤成不规则块。
    ctx.save(); ctx.beginPath(); ctx.arc(0, 14, 26, 0, Math.PI * 2); ctx.clip();
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath(); ctx.moveTo(-32, 14 + k * 8); ctx.bezierCurveTo(-12, -1 + k * 8, 12, 29 + k * 8, 32, 14 + k * 8);
      ctx.strokeStyle = 'rgba(170,91,13,.25)'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#FFBA48'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore(); box(-7, -14, 14, 6, '#F5A32A', 3); ctx.restore();
  }
  function pattern(kind, x, y, size) {
    const index = ((kind % originalUI.patterns.length) + originalUI.patterns.length) % originalUI.patterns.length;
    if (sprite(originalUI.patterns[index], x, y, size, size)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100); ctx.globalAlpha *= .11; ctx.strokeStyle = '#344C43'; ctx.fillStyle = '#344C43'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    switch (kind % 6) {
      case 0: ctx.rotate(-.6); ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); [-10, 2, 14].forEach(v => { ctx.moveTo(v, -12); ctx.lineTo(v, 12); }); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-22, -16); ctx.quadraticCurveTo(-45, 0, -22, 16); ctx.closePath(); ctx.moveTo(22, 0); ctx.lineTo(37, -12); ctx.lineTo(37, 12); ctx.closePath(); ctx.fill(); break;
      case 1: ctx.beginPath(); ctx.arc(0, -24, 7, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-25, 16); ctx.quadraticCurveTo(-23, -19, 0, -20); ctx.quadraticCurveTo(23, -19, 25, 16); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 22, 8, 0, Math.PI * 2); ctx.fill(); break;
      case 2: [-23, 0, 23].forEach(a => [-23, 0, 23].forEach(b => { ctx.beginPath(); ctx.moveTo(a, b - 9); ctx.quadraticCurveTo(a + 2, b - 2, a + 9, b); ctx.quadraticCurveTo(a + 2, b + 2, a, b + 9); ctx.quadraticCurveTo(a - 2, b + 2, a - 9, b); ctx.quadraticCurveTo(a - 2, b - 2, a, b - 9); ctx.fill(); })); break;
      case 3: [[-22, -10], [-9, -24], [11, -24], [25, -9]].forEach(v => { ctx.beginPath(); ctx.ellipse(v[0], v[1], 8, 10, 0, 0, Math.PI * 2); ctx.fill(); }); ctx.beginPath(); ctx.ellipse(0, 16, 24, 18, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 4: [-16, 0, 16].forEach(v => { ctx.beginPath(); ctx.moveTo(v - 10, 24); ctx.quadraticCurveTo(v, -6, v + 18, -25); ctx.stroke(); }); break;
      default: ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke(); [-10, 3, 16].forEach(v => { ctx.beginPath(); ctx.ellipse(0, 0, 29, 11, v / 13, 0, Math.PI * 2); ctx.stroke(); });
    }
    ctx.restore();
  }
  return { animal, silhouette, icon, yarn, pattern, sprite };
}
module.exports = { createArt };
