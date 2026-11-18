const test = require("node:test");
const assert = require("node:assert/strict");
const { expandedRect, bestBird, detectorInput } = require("../dist/bird-detector.js");

test("bird crop adds 15 percent to width and height and stays inside the photo", () => {
  assert.deepEqual(expandedRect([10, 20, 110, 220], 200, 300), [2.5, 5, 117.5, 235]);
  assert.deepEqual(expandedRect([0, 20, 100, 299], 150, 300), [0, 0, 107.5, 300]);
});

test("YOLOX letterbox uses BGR and maps its best bird to the original image", () => {
  const { data, width, height } = detectorInput({ data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]), width: 2, height: 1 });
  assert.deepEqual([width, height], [416, 208]);
  assert.deepEqual([data[0], data[416 ** 2], data[2 * 416 ** 2], data[208 * 416]], [30, 20, 10, 114]);
  const output = new Float32Array(3549 * 85);
  output.set([26, 13, Math.log(26), Math.log(13), .9]);
  output[5 + 14] = .8;
  const crop = bestBird(output, 416, 208);
  for (const [i, expected] of [.2125, .2125, .7875, .7875].entries()) {
    assert(Math.abs(crop[i] - expected) < 1e-6);
  }
  output[5 + 14] = 0;
  assert.equal(bestBird(output, 416, 208), null);
});
