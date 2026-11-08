import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker.js";

const origin = "https://mediachafa-transfer.vercel.app";
const token = "or-free-test-token-123456";
let openRouterUsed = 0;
let openRouterIsFree = true;
let failModelOnce = "";
let aiCalls = 0;
let requests = [];

const models = [
  ["qwen/qwen3-coder:free", "Qwen 3 Coder", ["text"]],
  ["openai/gpt-oss-120b:free", "GPT OSS 120B", ["text"]],
  ["meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B", ["text"]],
  ["google/gemma-3-27b-it:free", "Gemma 3", ["text", "image"]],
  ["mistralai/mistral-small-3.1-24b-instruct:free", "Mistral Small", ["text", "image"]],
  ["deepseek/deepseek-r1:free", "DeepSeek R1", ["text"]],
  ["meta-llama/llama-4-scout:free", "Llama 4 Scout", ["text", "image"]],
].map(([id, name, input_modalities]) => ({
  id,
  name,
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities, output_modalities: ["text"] },
}));

function installFetch() {
  openRouterUsed = 0;
  openRouterIsFree = true;
  failModelOnce = "";
  aiCalls = 0;
  requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "velxgwkujcabdaxbppyj.supabase.co" && url.pathname.endsWith("/auth/v1/user")) {
      return Response.json({ id: "owner", email: "nxmollpy@gmail.com", is_anonymous: false });
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/key") {
      return Response.json({
        data: {
          is_free_tier: openRouterIsFree,
          free_model_daily_requests: { used: openRouterUsed, limit: 50, remaining: Math.max(0, 50 - openRouterUsed) },
        },
      });
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/models") {
      return Response.json({ data: [...models, {
        id: "paid/model:paid",
        name: "Paid model must be filtered",
        pricing: { prompt: "0.2", completion: "0.5" },
        architecture: { input_modalities: ["text"] },
      }] });
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/chat/completions") {
      const body = JSON.parse(init.body || "{}");
      requests.push(body);
      if (body.provider?.allow_fallbacks !== false) throw new Error("Paid provider fallbacks must remain disabled.");
      if (failModelOnce && body.model === failModelOnce) {
        failModelOnce = "";
        return Response.json({ error: { message: "free model temporarily unavailable" } }, { status: 429 });
      }
      openRouterUsed += 1;
      return Response.json({ choices: [{ message: { content: '{"answer":"respuesta consensuada","plan":[],"actions":[]}' } }] });
    }
    return new Response("Unexpected network request: " + url.href, { status: 404 });
  };
}

const makeEnv = () => {
  const kv = new Map();
  return {
    TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(3)).toString("base64"),
    AI: { run: async () => { aiCalls += 1; throw new Error("Workers AI must never be called in zero-cost mode."); } },
    __kv: kv,
    BETA_LIMITS: {
      get: async (key) => kv.get(key) ?? null,
      put: async (key, value) => { kv.set(key, value); },
      delete: async (key) => { kv.delete(key); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }),
    },
  };
};

async function connectFreeOpenRouter(env) {
  const raw = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  env.__kv.set("integration:owner:openrouter", JSON.stringify({
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(new Uint8Array(encrypted)).toString("base64"),
    version: 1,
  }));
}

const chat = (env, model = "mediachafa::pro", extra = {}) => worker.fetch(new Request(`${origin}/chat`, {
  method: "POST",
  headers: { Origin: origin, Authorization: "Bearer t", "Content-Type": "application/json" },
  body: JSON.stringify({ message: "hola", model, ...extra }),
}), env);

test("status shows the three MediaChafa roles as quota-limited, never unlimited", async () => {
  installFetch();
  const env = makeEnv();
  const res = await worker.fetch(new Request(`${origin}/status`, { headers: { Origin: origin, Authorization: "Bearer t" } }), env);
  const data = await res.json();
  assert.deepEqual(data.models.slice(0, 3).map((model) => model.id), ["mediachafa::codigo", "mediachafa::pro", "mediachafa::rapida"]);
  assert.ok(data.models.slice(0, 3).every((model) => model.own && model.unlimited === false && model.remaining === 0));
  assert.equal(aiCalls, 0);
});

test("no OpenRouter free key means no inference and no Workers AI fallback", async () => {
  installFetch();
  const env = makeEnv();
  const res = await chat(env);
  assert.equal(res.status, 503);
  assert.equal(aiCalls, 0);
  assert.equal(requests.length, 0);
});

test("a paid OpenRouter key is blocked before any model request", async () => {
  installFetch();
  openRouterIsFree = false;
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env);
  assert.equal(res.status, 503);
  assert.equal(requests.length, 0);
  assert.equal(aiCalls, 0);
});

test("six free models draft independently, cross-review, then synthesize", async () => {
  installFetch();
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env, "mediachafa::pro");
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.answer, "respuesta consensuada");
  assert.equal(data.collaboration.enabled, true);
  assert.equal(data.collaboration.participantCount, 6);
  assert.equal(data.collaboration.reviewCount, 6);
  assert.equal(data.collaboration.status, "consensus");
  assert.deepEqual(
    data.collaboration.participants.slice(0, 3).map((item) => item.name),
    ["MediaChafa IA Código", "MediaChafa IA Pro", "MediaChafa IA Rápida"],
  );
  assert.equal(new Set(data.collaboration.participants.map((item) => item.engine)).size, 6);
  assert.equal(requests.length, 13, "six drafts, six cross-reviews and one synthesis");
  assert.ok(requests.every((request) => request.model.endsWith(":free")));
  assert.ok(requests.every((request) => request.provider?.allow_fallbacks === false));
  assert.equal(aiCalls, 0);
});

test("only vision-capable free models receive image requests", async () => {
  installFetch();
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env, "mediachafa::pro", { image: { data: "data:image/png;base64,iVBORw0KGgo=" } });
  assert.equal(res.status, 200);
  assert.ok(requests.length >= 5);
  assert.ok(requests.every((request) => request.model.endsWith(":free")));
  assert.ok(requests.every((request) => {
    const userMessage = request.messages.findLast((message) => message.role === "user");
    const content = Array.isArray(userMessage?.content) ? userMessage.content : [];
    return content.some((part) => part.type === "image_url");
  }));
  assert.equal(aiCalls, 0);
});

test("replaces a failed free model with another verified free model", async () => {
  installFetch();
  failModelOnce = "qwen/qwen3-coder:free";
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env, "mediachafa::codigo");
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.collaboration.enabled, true);
  assert.equal(data.collaboration.participantCount, 6);
  assert.ok(requests.some((request) => request.model === "meta-llama/llama-4-scout:free"));
  assert.equal(aiCalls, 0);
});

test("uses one free model when fewer than five daily requests remain", async () => {
  installFetch();
  openRouterUsed = 49;
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env, "mediachafa::rapida");
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.answer, "respuesta consensuada");
  assert.equal(data.collaboration, undefined);
  assert.equal(requests.length, 1);
  assert.equal(aiCalls, 0);
});

test("audio transcription is blocked rather than calling billable Workers AI", async () => {
  installFetch();
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const res = await chat(env, "mediachafa::pro", { audio: { mime: "audio/wav", data: "data:audio/wav;base64,AAAA" } });
  assert.equal(res.status, 503);
  assert.equal(aiCalls, 0);
  assert.equal(requests.length, 0);
});
test("publishes authenticated live progress for the six-agent collaboration", async () => {
  installFetch();
  const env = makeEnv();
  await connectFreeOpenRouter(env);
  const progressId = "progress-test-id-1234";
  const res = await chat(env, "mediachafa::pro", { progressId });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.collaboration.enabled, true);
  const raw = await env.BETA_LIMITS.get("beta-chat-progress:owner:" + progressId);
  assert.ok(raw, "progress snapshot is saved in KV");
  const snapshot = JSON.parse(raw);
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.phase, "completed");
  assert.ok(snapshot.participants.length >= 2);
  assert.ok(snapshot.steps.some((step) => /propuestas independientes/i.test(step.label)));
  assert.ok(snapshot.steps.some((step) => /revisiones cruzadas/i.test(step.label)));
  const progressResponse = await worker.fetch(new Request(`${origin}/chat/progress?id=${progressId}`, {
    headers: { Origin: origin, Authorization: "Bearer t" },
  }), env);
  assert.equal(progressResponse.status, 200);
  const visible = await progressResponse.json();
  assert.equal(visible.status, "completed");
  assert.equal(visible.participants.length, snapshot.participants.length);
  const invalid = await worker.fetch(new Request(`${origin}/chat/progress?id=bad`, {
    headers: { Origin: origin, Authorization: "Bearer t" },
  }), env);
  assert.equal(invalid.status, 400);
});
