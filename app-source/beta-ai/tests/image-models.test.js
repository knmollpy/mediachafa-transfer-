import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAioQwenInputData, buildMossImageInputData } from "../image-models.js";

test("AIO Qwen generation sends the full 12-input Gradio signature", () => {
  const data = buildAioQwenInputData("a red bicycle", "generate", null);
  assert.equal(data.length, 12);
  assert.equal(data[0], "a red bicycle");
  assert.equal(data[1], "Text to Image");
  assert.equal(data[2], null);
  assert.equal(data[8], "Square · 1:1 (1024x1024)");
});

test("AIO Qwen editing sends the reference image in the third input", () => {
  const image = { path: "/tmp/input.png", meta: { _type: "gradio.FileData" } };
  const data = buildAioQwenInputData("remove the background", "edit", image);
  assert.equal(data.length, 12);
  assert.equal(data[1], "Edit Image (1 Ref)");
  assert.equal(data[2], image);
  assert.equal(data[4], "None (Base Uncensored)");
});

test("MOSS Image generation uses the 10-input ZeroGPU API signature", () => {
  const data = buildMossImageInputData("a mountain landscape", 123456);
  assert.equal(data.length, 10);
  assert.equal(data[0], "a mountain landscape");
  assert.equal(data[2], 1024);
  assert.equal(data[3], 1024);
  assert.equal(data[4], 30);
  assert.equal(data[5], 3.0);
  assert.equal(data[6], 0.7);
  assert.equal(data[7], 1.0);
  assert.equal(data[8], true);
  assert.equal(data[9], 123456);
  assert.match(data[1], /bad anatomy/);
});
