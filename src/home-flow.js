'use strict';

function createHomeFlow({ ctx, width, height, getGrid, getMask, createCanvas, now = Date.now }) {
  const pixelWidth = Math.ceil(width), pixelHeight = Math.ceil(height), ratio = width / 1080;
  const spriteWidth = 1092 * 1.02 * ratio, spriteHeight = 2356 * 1.02 * ratio;
  const left = (width - spriteWidth) / 2, top = 1197 * ratio - spriteHeight / 2;
  let state = null, failed = null;

  function initialize(grid, mask) {
    const canvas = createCanvas(pixelWidth, pixelHeight);
    function read(image) {
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, image.width, image.height); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    }
    // 两张源图仅读取一次；每帧只写离屏画布，主画布不读回像素。
    const gridData = read(grid), maskData = read(mask);
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    const context = canvas.getContext('2d'), output = context.createImageData(pixelWidth, pixelHeight);
    const maskAlpha = new Float32Array(pixelWidth * pixelHeight), us = [], vs = [];
    for (let x = 0; x < pixelWidth; x++) us[x] = (x + .5 - left) / spriteWidth;
    for (let y = 0; y < pixelHeight; y++) {
      const v = vs[y] = (y + .5 - top) / spriteHeight;
      for (let x = 0; x < pixelWidth; x++) {
        const u = us[x], index = y * pixelWidth + x;
        if (u < 0 || u > 1 || v < 0 || v > 1) { maskAlpha[index] = -1; continue; }
        const mx = Math.max(0, Math.min(mask.width - 1, u * mask.width - .5));
        const my = Math.max(0, Math.min(mask.height - 1, v * mask.height - .5));
        const x0 = Math.floor(mx), y0 = Math.floor(my), x1 = Math.min(x0 + 1, mask.width - 1), y1 = Math.min(y0 + 1, mask.height - 1);
        const fx = mx - x0, fy = my - y0;
        maskAlpha[index] = (maskData[(y0 * mask.width + x0) * 4 + 3] * (1 - fx) + maskData[(y0 * mask.width + x1) * 4 + 3] * fx) * (1 - fy)
          + (maskData[(y1 * mask.width + x0) * 4 + 3] * (1 - fx) + maskData[(y1 * mask.width + x1) * 4 + 3] * fx) * fy;
      }
    }
    return { grid, mask, canvas, context, output, gridData, maskAlpha, us, vs, lastTime: -Infinity };
  }

  function draw(time = now()) {
    const grid = getGrid && getGrid(), mask = getMask && getMask();
    if (!grid || !mask || !createCanvas || !(width > 0 && height > 0)) return false;
    if (state && (state.grid !== grid || state.mask !== mask)) { state = null; failed = null; return false; }
    if (failed && failed[0] === grid && failed[1] === mask) return false;
    try {
      if (!state) state = initialize(grid, mask);
      if (time - state.lastTime >= 100 || time < state.lastTime) {
        const { gridData, maskAlpha, us, vs, output } = state, pixels = output.data;
        const phase = (time % (1000 / .015)) * .015 / 1000, gw = grid.width, gh = grid.height;
        pixels.fill(0);
        for (let y = 0; y < pixelHeight; y++) {
          const gy = ((vs[y] - phase) % 1 + 1) % 1 * gh - .5, yFloor = Math.floor(gy);
          const y0 = (yFloor + gh) % gh, y1 = (y0 + 1) % gh, fy = gy - yFloor;
          for (let x = 0; x < pixelWidth; x++) {
            const index = y * pixelWidth + x, ma = maskAlpha[index];
            if (ma < 0) continue;
            const gx = ((us[x] + phase) % 1 + 1) % 1 * gw - .5, xFloor = Math.floor(gx);
            const x0 = (xFloor + gw) % gw, x1 = (x0 + 1) % gw, fx = gx - xFloor;
            const t0 = (y0 * gw + x0) * 4, t1 = (y0 * gw + x1) * 4, t2 = (y1 * gw + x0) * 4, t3 = (y1 * gw + x1) * 4;
            const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
            const alpha = Math.max(0, gridData[t0 + 3] * w0 + gridData[t1 + 3] * w1 + gridData[t2 + 3] * w2 + gridData[t3 + 3] * w3 - ma) * .2;
            if (alpha < 255 * .00025) continue;
            const target = index * 4;
            for (let channel = 0; channel < 3; channel++) pixels[target + channel] = gridData[t0 + channel] * w0 + gridData[t1 + channel] * w1 + gridData[t2 + channel] * w2 + gridData[t3 + channel] * w3;
            if (Math.max(pixels[target], pixels[target + 1], pixels[target + 2]) <= .255) continue;
            // 原shader是透明度相减；destination-out的相乘会改变半透明边缘。
            pixels[target + 3] = alpha;
          }
        }
        state.context.putImageData(output, 0, 0); state.lastTime = time;
      }
      ctx.drawImage(state.canvas, 0, 0, width, height);
      return true;
    } catch (_) {
      state = null; failed = [grid, mask]; return false;
    }
  }
  return { draw };
}

module.exports = { createHomeFlow };
