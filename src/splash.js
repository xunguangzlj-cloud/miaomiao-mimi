'use strict';

const { createArt } = require('./art.js');

function capsule(ctx, x, y, width, height, color) {
  if (width <= 0) return;
  const radius = Math.min(height / 2, width / 2);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.fill();
}

function linesFor(ctx, value, width) {
  const lines = []; let line = '';
  for (const char of Array.from(value)) {
    if (char === '\n') { lines.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + char).width > width) {
      if ('，。！？；：、”’）》'.includes(char) && Array.from(line).length > 1) {
        const characters = Array.from(line), tail = [characters.pop()];
        while (characters.length > 1 && '，。！？；：、”’）》'.includes(tail[0])) tail.unshift(characters.pop());
        lines.push(characters.join('')); line = tail.join('') + char;
      } else { lines.push(line); line = char; }
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

// 短屏缩放文字，保留进度、猫头像和标志的相对位置。
function drawLoading(p, state) {
  state = state || {};
  const ctx = p.ctx, width = p.width, height = p.height;
  const safeTop = p.safeTop || 0, safeBottom = p.safeBottom || 0;
  const scale = width / 1080, bottom = height - safeBottom;
  const quote = state.quote || { text: '', author: '' };
  const value = Number.isFinite(state.progress) ? Math.max(0, Math.min(1, state.progress)) : 0;
  const left = 90 * scale, textWidth = 900 * scale;
  const trackTop = bottom - 502 * scale, trackHeight = 38 * scale;
  const barTop = trackTop + 4 * scale, barHeight = 32 * scale;
  const fillRight = left + textWidth * value;
  const catWidth = 86 * scale, catHeight = catWidth * 80 / 88;
  const catTop = bottom - 598 * scale;
  const logoWidth = 1180 * .31 * scale, logoHeight = logoWidth * (state.logo ? state.logo.height / state.logo.width : 1184 / 1328);
  const logoTop = barTop + barHeight + 104 * scale, logoLeft = (width - logoWidth) / 2;
  const quoteTop = safeTop + Math.min(362 * scale, (bottom - safeTop) * .158);
  const maxQuoteHeight = catTop - quoteTop - Math.max(16, 30 * scale);
  let fontSize = 80 * scale, authorSize = 70 * scale, lineHeight, lines;
  const content = '“' + String(quote.text || '').replace(/^[“"]|[”"]$/g, '') + '”';
  // 按真实字体宽度换行，避免中文标点独占一行；安全区较小时逐步收紧字号。
  do {
    ctx.font = '500 ' + fontSize + 'px system-ui';
    lines = linesFor(ctx, content, textWidth);
    lineHeight = fontSize * 1.5;
    authorSize = fontSize * .875;
    if (lines.length * lineHeight + authorSize + fontSize * .55 <= maxQuoteHeight || fontSize <= 17) break;
    fontSize -= .5;
  } while (true);
  const quoteBottom = quoteTop + lines.length * lineHeight;
  const authorTop = quoteBottom + fontSize * .55;
  ctx.save(); ctx.fillStyle = '#F7F2EE'; ctx.fillRect(0, 0, width, height);
  ctx.font = '500 ' + fontSize + 'px system-ui'; ctx.fillStyle = '#935A5A'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((line, index) => ctx.fillText(line, left, quoteTop + index * lineHeight));
  ctx.font = '400 ' + authorSize + 'px system-ui'; ctx.fillStyle = '#A37676'; ctx.textAlign = 'right';
  ctx.fillText('- ' + String(quote.author || ''), width - left, authorTop);
  capsule(ctx, left - 3 * scale, trackTop, textWidth + 6 * scale, trackHeight, '#E5DEDA');
  capsule(ctx, left, barTop, textWidth * value, barHeight, '#F19320');
  const catCenterX = fillRight, catCenterY = catTop + catHeight / 2;
  if (state.catFace) ctx.drawImage(state.catFace, catCenterX - catWidth / 2, catTop, catWidth, catHeight);
  else {
    const text = (str, x, y, size, color) => {
      ctx.font = '500 ' + size + 'px system-ui'; ctx.fillStyle = color;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, x, y);
    };
    createArt(ctx, () => {}, text, () => state.catAtlas).animal(catCenterX, catCenterY, catWidth, 'cat', 0);
  }
  if (state.logo) ctx.drawImage(state.logo, logoLeft, logoTop, logoWidth, logoHeight);
  else {
    // 位图下载前保留相同标志占位，不阻塞首帧绘制。
    ctx.font = '900 ' + logoWidth * .25 + 'px system-ui'; ctx.fillStyle = '#8D5B3B'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('喵喵', width / 2, logoTop); ctx.fillText('谜谜', width / 2, logoTop + logoHeight * .33);
    ctx.fillText('小屋', width / 2, logoTop + logoHeight * .66);
  }
  ctx.restore();
  return {
    screen: 'loading',
    quote: { left, right: width - left, top: quoteTop, bottom: quoteBottom, fontSize, lines },
    author: { left, right: width - left, top: authorTop, bottom: authorTop + authorSize, fontSize: authorSize },
    cat: { left: catCenterX - catWidth / 2, right: catCenterX + catWidth / 2, top: catTop, bottom: catTop + catHeight },
    progress: { left, right: width - left, top: trackTop, bottom: trackTop + trackHeight, value, fillRight },
    logo: { left: logoLeft, right: logoLeft + logoWidth, top: logoTop, bottom: logoTop + logoHeight }
  };
}

module.exports = { drawLoading };
