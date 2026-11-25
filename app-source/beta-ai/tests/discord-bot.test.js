import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DiscordGateway } from "../worker.js";

const ownerId = "3da2624d-d1cc-49e9-a536-ed8c0c480779";
const originalFetch = globalThis.fetch;
const encryptionBytes = new Uint8Array(32).fill(19);
const encryptionKey = await crypto.subtle.importKey("raw", encryptionBytes, { name: "AES-GCM" }, false, ["encrypt"]);

async function encryptedToken(token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    new TextEncoder().encode(token),
  ));
  return JSON.stringify({
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    version: 1,
    meta: { detail: "OpenRouter free test credential" },
  });
}

function makeContext() {
  const values = new Map();
  return {
    values,
    ctx: {
      storage: {
        get: async (key) => values.get(key),
        put: async (key, value) => { values.set(key, value); },
        delete: async (key) => values.delete(key),
        setAlarm: async () => {},
        deleteAlarm: async () => {},
      },
      waitUntil: (promise) => promise,
    },
  };
}

after(() => { globalThis.fetch = originalFetch; });

test("Discord uses private inference quota but sends only the question and public titles to AI", async () => {
  const { ctx, values } = makeContext();
  const kv = new Map();
  kv.set("integration:" + ownerId + ":openrouter", await encryptedToken("test-private-provider-token"));
  const env = {
    DISCORD_GUILD_ID: "guild-public",
    DISCORD_CHANNEL_ID: "channel-requests",
    DISCORD_BOT_TOKEN: "test-discord-token",
    TOKEN_ENCRYPTION_KEY: Buffer.from(encryptionBytes).toString("base64"),
    BETA_LIMITS: {
      get: async (key) => kv.get(key) ?? null,
      put: async (key, value) => { kv.set(key, value); },
      delete: async (key) => { kv.delete(key); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }),
    },
  };
  let inferenceBody;
  let discordReply;
  const privateSentinel = "MEDIA_CHAFA_PRIVATE_CONTEXT_MUST_NEVER_LEAK";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "velxgwkujcabdaxbppyj.supabase.co" && url.pathname === "/rest/v1/ps4_games") {
      assert.equal(url.searchParams.get("select"), "title,download_url");
      assert.equal(url.searchParams.get("is_private"), "eq.false");
      return Response.json([
        { title: "Grand Theft Auto V", download_url: "https://downloads.example/public-gta-v" },
      ]);
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/key") {
      assert.equal(init.headers.Authorization, "Bearer test-private-provider-token");
      return Response.json({ data: { is_free_tier: true, free_model_daily_requests: { used: 0, limit: 50, remaining: 50 } } });
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/models") {
      assert.equal(init.headers.Authorization, "Bearer test-private-provider-token");
      return Response.json({ data: [{
        id: "openai/gpt-oss-20b:free",
        name: "GPT OSS 20B Free",
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text"] },
      }] });
    }
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/chat/completions") {
      inferenceBody = JSON.parse(init.body);
      assert.equal(init.headers.Authorization, "Bearer test-private-provider-token");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ intent: "search", titles: ["Grand Theft Auto V"] }) } }] });
    }
    if (url.hostname === "discord.com" && url.pathname === "/api/v10/channels/channel-requests/messages" && init.method === "POST") {
      discordReply = JSON.parse(init.body);
      return Response.json({ id: "reply-id" });
    }
    throw new Error("Unexpected external request: " + url.href);
  };

  const gateway = new DiscordGateway(ctx, env);
  await gateway.handleMessageCreate({
    id: "incoming-message",
    guild_id: "guild-public",
    channel_id: "channel-requests",
    author: { id: "discord-user", bot: false },
    content: "gta pasame el link",
  });

  assert.ok(inferenceBody, "the AI provider should receive an ambiguous game-name query");
  assert.deepEqual(inferenceBody.messages.map((message) => message.role), ["system", "user"]);
  const prompt = inferenceBody.messages.map((message) => message.content).join("\n");
  assert.ok(prompt.includes("gta"));
  assert.ok(prompt.includes("Grand Theft Auto V"));
  assert.ok(!prompt.includes(privateSentinel));
  assert.ok(!prompt.includes("test-private-provider-token"));
  assert.ok(!prompt.includes("test-discord-token"));
  assert.ok(!prompt.includes("https://downloads.example/public-gta-v"));
  assert.equal(kv.get("beta-ai-requests:" + ownerId + ":openrouter:day:" + new Date().toISOString().slice(0, 10)), "1");
  assert.ok(discordReply.content.includes("Grand Theft Auto V"));
  assert.ok(discordReply.content.includes("https://downloads.example/public-gta-v"));
  assert.deepEqual(discordReply.allowed_mentions, { parse: [] });
  assert.equal([...values.keys()].some((key) => key.includes(privateSentinel)), false);
});
