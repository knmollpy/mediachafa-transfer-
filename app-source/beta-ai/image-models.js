export function buildAioQwenInputData(prompt, action, imageFile) {
  return [
    prompt,
    action === "generate" ? "Text to Image" : "Edit Image (1 Ref)",
    imageFile,
    null,
    "None (Base Uncensored)",
    1.0,
    "",
    "",
    "Square · 1:1 (1024x1024)",
    30,
    42,
    true,
  ];
}

const MOSS_DEFAULT_NEGATIVE = "blurry, low quality, distorted, bad anatomy, deformed fingers, extra limbs, CGI, render, 3d, cartoon, airbrushed, plastic skin, oversaturated, watermark";

export function buildMossImageInputData(prompt, seed = 42) {
  return [prompt, MOSS_DEFAULT_NEGATIVE, 1024, 1024, 30, 3.0, 0.7, 1.0, true, Number(seed) >>> 0];
}
