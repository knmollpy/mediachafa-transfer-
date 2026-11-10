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
