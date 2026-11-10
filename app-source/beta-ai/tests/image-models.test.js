import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAioQwenInputData } from "../image-models.js";

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
