import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker.js";

const origin = "https://mediachafa-transfer.vercel.app";
const kv = new Map();
const aiCalls = [];
const makeEnv = (aiRun) => ({
  TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(3)).toString("base64"),
  AI: { run: aiRun },
  BETA_LIMITS: {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  },
});
globalThis.fetch = async (input) => {
  if (String(input).endsWith("/auth/v1/user")) return Response.json({ id: "owner", email: "nxmollpy@gmail.com", is_anonymous: false });
  return new Response("{}", { status: 404 });
};
const chat = (env, model, extra = {}) => worker.fetch(new Request(`${origin}/chat`, {
  method: "POST",
  headers: { Origin: origin, Authorization: "Bearer t", "Content-Type": "application/json" },
  body: JSON.stringify({ message: "hacé una tarea de código", model, mode: "autonomous", ...extra }),
}), env);

test("status lists the three MediaChafa models first, starred and unlimited", async () => {
  const res = await worker.fetch(new Request(`${origin}/status`, { headers: { Origin: origin, Authorization: "Bearer t" } }), makeEnv(async () => ({})));
  const data = await res.json();
  assert.deepEqual(data.models.slice(0, 3).map((m) => m.id), ["mediachafa::codigo", "mediachafa::pro", "mediachafa::rapida"]);
  assert.ok(data.models.slice(0, 3).every((m) => m.own && m.unlimited));
});

test("rotates to the next engine when Cloudflare reports quota exhausted", async () => {
  const env = makeEnv(async (model) => {
    aiCalls.push(model);
    if (aiCalls.length === 1) throw new Error("4006: you have used up your daily free allocation of 10,000 neurons");
    if (aiCalls.length <= 2) return { response: '{"answer":"Hola desde respaldo","actions":[]}' };
    return { response: '{"decision":"approve","confidence":0.95,"findings":[]}' };
  });
  const res = await chat(env, "mediachafa::codigo");
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.match(data.answer, /Las tres IAs llegaron a un acuerdo\\. Hola desde respaldo/);
  assert.equal(data.rotations, 1);
  assert.equal(aiCalls[0], "@cf/qwen/qwen2.5-coder-32b-instruct");
  assert.equal(aiCalls[1], "@cf/openai/gpt-oss-120b");
  assert.equal(aiCalls.length, 4);
  assert.equal(data.consensus.status, "approved");
});

test("images go only to engines that can see images", async () => {
  const seen = [];
  const env = makeEnv(async (model) => {
    seen.push(model);
    return { response: seen.length === 1 ? '{"answer":"rojo","actions":[]}' : '{"decision":"approve","confidence":0.95,"findings":[]}' };
  });
  const res = await chat(env, "mediachafa::pro", { image: { data: "data:image/png;base64,iVBORw0KGgo=" } });
  assert.equal(res.status, 200);
  assert.equal(seen[0], "@cf/meta/llama-4-scout-17b-16e-instruct");
});

test("broken JSON answers never show raw code or JSON to the user", async () => {
  const broken = 'Lamento el error.\n\n{"answer":"Preparé el repositorio.","actions":[{"action":"addFile","params":{"content":"<html>"}},"addFile","params":{}}]}';
  let calls = 0;
  const env = makeEnv(async () => {
    calls += 1;
    return { response: calls === 1 ? broken : '{"decision":"approve","confidence":0.95,"findings":[]}' };
  });
  const data = await (await chat(env, "mediachafa::rapida")).json();
  assert.match(data.answer, /Las tres IAs llegaron a un acuerdo\\. Preparé el repositorio\\./);
});
