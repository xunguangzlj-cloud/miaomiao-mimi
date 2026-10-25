'use strict';
const gardenFrames = require('./garden-frames.js');

function stageForTotal(total) {
  return Math.max(0, Math.min(7, Math.floor(Number(total) || 0)));
}

function createGardenArt(ctx, getPlantAtlas) {
  function plant(cx, cy, width, height, total, now) {
    const stage = stageForTotal(total), frame = gardenFrames.frames[stage];
    const bitmap = getPlantAtlas && getPlantAtlas();
    const scale = Math.min(width / gardenFrames.frameWidth, height / gardenFrames.frameHeight) * .96;
    const drawWidth = gardenFrames.frameWidth * scale, drawHeight = gardenFrames.frameHeight * scale;
    const left = cx - drawWidth / 2, top = cy - drawHeight / 2;
    const baselineX = left + frame.potBaseline[0] * scale;
    const baselineY = top + frame.potBaseline[1] * scale;
    const angle = stage > 0 ? Math.sin((Number(now) || 0) / 2300) * .008 : 0;
    if (bitmap) {
      // 从盆底固定锚点轻摆，统一画布始终等比缩放，保留各阶段叶花及透明边缘。
      ctx.save(); ctx.translate(baselineX, baselineY); ctx.rotate(angle);
      ctx.drawImage(bitmap, ...frame.rect, -frame.potBaseline[0] * scale,
        -frame.potBaseline[1] * scale, drawWidth, drawHeight);
      ctx.restore();
    }
    return { stage, drawn: !!bitmap, left, top, width: drawWidth, height: drawHeight,
      baselineX, baselineY, angle };
  }
  return { plant };
}

module.exports = { createGardenArt, stageForTotal };
