'use strict';

function createCosmeticArt({ ctx, box, silhouette }) {
  const TAU = Math.PI * 2;
  function line(points, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    ctx.moveTo(...points[0]); points.slice(1).forEach(point => ctx.lineTo(...point)); ctx.stroke();
  }
  function dot(x, y, radius, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  }
  function star(x, y, size, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, radius = i % 2 ? size * .3 : size;
      const px = x + Math.sin(angle) * radius, py = y - Math.cos(angle) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    } ctx.closePath(); ctx.fill();
  }
  function motif(style, x, y, size, color, detail) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40);
    ctx.fillStyle = color; ctx.strokeStyle = detail || color; ctx.lineWidth = 2; ctx.lineCap = 'round';
    if (style === 'leaf') {
      line([[-13, 15], [13, -15]], detail || color, 2);
      [[-6, 5], [4, -5]].forEach(([a, b]) => { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(a, b, 9, 4, -.7, 0, TAU); ctx.fill(); });
    } else if (style === 'cloud' || style === 'rain') {
      [[-9, 0, 6], [0, -5, 8], [10, -1, 6]].forEach(v => dot(...v, color));
      if (style === 'rain') [-10, 0, 10].forEach(a => line([[a, 10], [a - 3, 16]], detail || color, 2));
      else line([[-11, 12], [8, 12]], detail || color, 2);
    } else if (style === 'flower') {
      for (let i = 0; i < 5; i++) dot(Math.sin(i * TAU / 5) * 8, Math.cos(i * TAU / 5) * 8, 5.5, color);
      dot(0, 0, 4, '#F2D18A');
    } else if (style === 'moon') {
      ctx.beginPath(); ctx.moveTo(6, -14); ctx.bezierCurveTo(-18, -16, -20, 14, 3, 15);
      ctx.bezierCurveTo(-5, 4, -4, -6, 6, -14); ctx.fill(); star(12, -5, 5, detail || color); star(13, 12, 3, detail || color);
    } else if (style === 'sun') {
      dot(0, 0, 10, color);
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; line([[Math.cos(a) * 14, Math.sin(a) * 14], [Math.cos(a) * 18, Math.sin(a) * 18]], detail || color, 2); }
    } else if (style === 'wave') {
      [-5, 7].forEach(b => { ctx.beginPath(); ctx.moveTo(-18, b); ctx.bezierCurveTo(-6, b - 10, -3, b + 10, 9, b); ctx.quadraticCurveTo(14, b - 5, 18, b); ctx.stroke(); });
      dot(12, -14, 2, color);
    } else if (style === 'candy') {
      dot(0, 0, 11, color); ctx.strokeStyle = detail || color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 6, -.6, Math.PI * 1.4); ctx.stroke();
      [[-1, -1], [1, 1]].forEach(([sign, v]) => { ctx.beginPath(); ctx.moveTo(sign * 10, 0); ctx.lineTo(sign * 18, -8 * v); ctx.lineTo(sign * 18, 8 * v); ctx.closePath(); ctx.fill(); });
    } else if (style === 'wood') {
      [-11, 0, 11].forEach(b => { ctx.beginPath(); ctx.moveTo(-18, b); ctx.bezierCurveTo(-8, b - 5, 6, b + 5, 18, b); ctx.stroke(); });
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, TAU); ctx.stroke();
    } else if (style === 'snow') {
      for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate(i * TAU / 6); line([[0, 0], [0, -18]], color, 2); line([[-5, -11], [0, -7], [5, -11]], color, 2); ctx.restore(); }
    } else if (style === 'lotus') {
      [-.65, 0, .65].forEach(a => { ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, 14); ctx.quadraticCurveTo(-12, -2, 0, -16); ctx.quadraticCurveTo(12, -2, 0, 14); ctx.fill(); ctx.restore(); });
      line([[-17, 16], [17, 16]], detail || color, 2);
    } else if (style === 'bow') {
      [-1, 1].forEach(sign => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(sign * 14, -16, sign * 23, -8, sign * 17, 4); ctx.quadraticCurveTo(sign * 9, 7, 0, 0); ctx.fill(); });
      dot(0, 0, 4, detail || color); line([[-4, 4], [-7, 14]], color, 5); line([[4, 4], [7, 14]], color, 5);
    } ctx.restore();
  }
  function rim(radius, color, width) {
    const a = 44, r = radius; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(-a + r, -a); ctx.lineTo(a - r, -a); ctx.quadraticCurveTo(a, -a, a, -a + r);
    ctx.lineTo(a, a - r); ctx.quadraticCurveTo(a, a, a - r, a); ctx.lineTo(-a + r, a);
    ctx.quadraticCurveTo(-a, a, -a, a - r); ctx.lineTo(-a, -a + r); ctx.quadraticCurveTo(-a, -a, -a + r, -a); ctx.closePath(); ctx.stroke();
  }
  function frame(cx, cy, size, info) {
    const { style, color, detail } = info;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (style === 'sun') {
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 41, 0, TAU); ctx.stroke();
      for (let i = 0; i < 16; i++) { const a = i * TAU / 16; line([[Math.cos(a) * 45, Math.sin(a) * 45], [Math.cos(a) * 48, Math.sin(a) * 48]], detail, 2); }
    } else {
      rim(style === 'wood' ? 4 : style === 'wave' ? 24 : 14, color, style === 'basic' ? 5 : 7);
      rim(style === 'wood' ? 4 : style === 'wave' ? 24 : 14, detail, 1);
      if (style === 'leaf') [[-35, -34], [35, 34]].forEach(v => motif('leaf', ...v, 21, color, detail));
      if (style === 'flower') [[-35, -35], [35, -35], [35, 35], [-35, 35]].forEach(v => motif('flower', ...v, 20, color, detail));
      if (style === 'moon') { motif('moon', -32, -34, 23, color, detail); star(35, 33, 8, '#F1D8A0'); star(35, -35, 5, detail); }
      if (style === 'wave') { motif('wave', 0, -37, 26, color, detail); motif('wave', 0, 37, 26, color, detail); [-1, 1].forEach(sign => dot(sign * 42, 0, 3, '#FFF3E2')); }
      if (style === 'wood') { [-1, 1].forEach(sign => { motif('wood', 0, sign * 38, 22, color, detail); dot(sign * 38, sign * 38, 2, '#EBD9BF'); }); }
      if (style === 'bow') { motif('bow', 0, -35, 30, color, detail); star(-36, 33, 4, '#F8E6D2'); star(36, 33, 4, '#F8E6D2'); }
    } ctx.restore();
    return { left: cx - size / 2, top: cy - size / 2, width: size, height: size };
  }
  function themePreview(x, y, width, height, theme) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    box(x, y, width, height, theme.paper, 12);
    const decor = Math.min(width * .25, height * .42);
    if (theme.style === 'none') {
      if (silhouette) silhouette(x + width * .2, y + height * .29, decor * .65, '#E4C9AD');
      star(x + width * .8, y + height * .24, decor * .16, '#E4C9AD');
    } else {
      motif(theme.style, x + width * .18, y + height * .3, decor, theme.accent, theme.ink);
      ctx.globalAlpha *= .5; motif(theme.style, x + width * .83, y + height * .75, decor * .6, theme.accent, theme.ink); ctx.globalAlpha *= 2;
    }
    const tile = Math.min(width * .12, height * .2), left = x + width / 2 - tile * 1.5, top = y + height / 2 - tile * 1.5;
    box(left - 3, top - 3, tile * 3 + 6, tile * 3 + 6, '#FFFCF7', 6);
    for (let i = 0; i < 9; i++) box(left + i % 3 * tile, top + Math.floor(i / 3) * tile, tile - 2, tile - 2, i % 3 === 0 ? theme.accent : i % 2 ? '#EDD5B0' : '#D6E0D0', 2);
    dot(left + tile * 1.5 - 1, top + tile * 1.5 - 1, tile * .21, '#FFFAEF');
    ctx.restore(); return { x, y, width, height };
  }
  function background(width, height, theme, time) {
    if (theme.style === 'none') return false;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip(); ctx.globalAlpha *= .1;
    const size = Math.min(width * .21, 78), float = Math.sin((Number(time) || 0) / 2600) * size * .025;
    [[size * .6, size * .65 + float], [width - size * .6, size * .65 - float], [size * .6, height - size * .65 - float], [width - size * .6, height - size * .65 + float]].forEach(v => motif(theme.style, ...v, size, theme.accent, theme.ink));
    ctx.restore(); return true;
  }
  return { frame, themePreview, background };
}

module.exports = { createCosmeticArt };
