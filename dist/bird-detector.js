(function (root) {
  "use strict";
  const size = 416;
  const plane = size * size;
  const bird = 14;
  const padding = .15;
  const minimum = .22;

  function expandedRect([left, top, right, bottom], width, height) {
    const x = (right - left) * padding / 2;
    const y = (bottom - top) * padding / 2;
    const clamp = (value, limit) => Math.max(0, Math.min(limit, value));
    return [clamp(left - x, width), clamp(top - y, height), clamp(right + x, width), clamp(bottom + y, height)];
  }

  function detectorInput(image) {
    const ratio = Math.min(size / image.width, size / image.height);
    const width = Math.max(1, Math.floor(image.width * ratio));
    const height = Math.max(1, Math.floor(image.height * ratio));
    const data = new Float32Array(plane * 3).fill(114);
    for (let y = 0; y < height; y++) {
      const sourceY = Math.max(0, (y + .5) * image.height / height - .5);
      const y0 = Math.floor(sourceY), y1 = Math.min(y0 + 1, image.height - 1);
      const fy = sourceY - y0;
      for (let x = 0; x < width; x++) {
        const sourceX = Math.max(0, (x + .5) * image.width / width - .5);
        const x0 = Math.floor(sourceX), x1 = Math.min(x0 + 1, image.width - 1);
        const fx = sourceX - x0;
        for (let channel = 0; channel < 3; channel++) {
          const c = 2 - channel;
          const a = image.data[(y0 * image.width + x0) * 4 + c];
          const b = image.data[(y0 * image.width + x1) * 4 + c];
          const d = image.data[(y1 * image.width + x0) * 4 + c];
          const e = image.data[(y1 * image.width + x1) * 4 + c];
          data[channel * plane + y * size + x] = Math.round((a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy);
        }
      }
    }
    return { data, width, height };
  }

  function bestBird(output, width, height) {
    let offset = 0;
    let best = minimum;
    let crop = null;
    for (const stride of [8, 16, 32]) {
      const side = size / stride;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++, offset += 85) {
          const score = output[offset + 4] * output[offset + 5 + bird];
          if (!(score > best)) continue;
          const cx = (output[offset] + x) * stride;
          const cy = (output[offset + 1] + y) * stride;
          const halfW = Math.exp(output[offset + 2]) * stride / 2;
          const halfH = Math.exp(output[offset + 3]) * stride / 2;
          const rect = expandedRect([cx - halfW, cy - halfH, cx + halfW, cy + halfH], width, height);
          if (rect[2] - rect[0] < 5 || rect[3] - rect[1] < 5) continue;
          crop = rect.map((value, i) => value / (i % 2 ? height : width));
          best = score;
        }
      }
    }
    return crop;
  }

  async function detect(ort, session, image) {
    const { data, width, height } = detectorInput(image);
    const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, size, size]) });
    const output = outputs[session.outputNames[0]];
    if (output.data.length !== 3549 * 85) throw new Error("Unexpected YOLOX output");
    return bestBird(output.data, width, height);
  }

  const api = { expandedRect, detectorInput, bestBird, detect };
  if (typeof module === "object") module.exports = api;
  else root.HetuBirdDetector = api;
})(globalThis);
