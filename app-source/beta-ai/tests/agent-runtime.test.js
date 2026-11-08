import assert from "node:assert/strict";
import { after, test } from "node:test";
import worker from "../worker.js";

const origin = "https://mediachafa-transfer.vercel.app";
const userId = "3da2624d-d1cc-49e9-a536-ed8c0c480779";
const modelId = "openrouter::openai/gpt-oss-20b:free";
const encryptionBytes = new Uint8Array(32).fill(21);
const encryptionKey = await crypto.subtle.importKey("raw", encryptionBytes, { name: "AES-GCM" }, false, ["encrypt"]);
const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const kv = new Map();
const modelTurns = [
  { type: "tool_call", name: "github_read_file", arguments: { path: "app-source/beta.js" } },
  { type: "tool_call", name: "github_write_files", arguments: { files: [{ path: "app-source/beta.js", content: "export const changed = true;" }], message: "Test change" } },
  { type: "tool_call", name: "github_run_checks", arguments: {} },
  { type: "tool_call", name: "github_check_status", arguments: {} },
  { type: "tool_call", name: "vercel_deploy_preview", arguments: {} },
  { type: "tool_call", name: "vercel_preview_status", arguments: {} },
  { type: "tool_call", name: "github_open_review_pr", arguments: {} },
  { type: "tool_call", name: "github_pr_status", arguments: {} },
  { type: "final", answer: "Tarea completada.", summary: "Leí, modifiqué, probé y publiqué tras revisión independiente.", verified: true },
];
let requestCount = 0;
let createdCommit = false;
let commitCount = 0;
let dispatchedChecks = false;
let activeBranch = "";
let deploymentRequest;
let memoryRows = [{ memory_key: "response_style", memory_value: { text: "Respuestas breves en español." }, user_confirmed: true, reusable: true, sensitive: false }];
let savedMemory = null;
let openedPrBody = null;
let modelGate = null;
const modelPromptMessages = [];
const originalFetch = globalThis.fetch;

async function encryptToken(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, new TextEncoder().encode(value)));
  return JSON.stringify({ iv: base64(iv), ciphertext: base64(ciphertext), version: 1, meta: { detail: "test" } });
}

const env = {
  TOKEN_ENCRYPTION_KEY: base64(encryptionBytes),
  BETA_LIMITS: {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => { kv.set(key, value); },
    delete: async (key) => { kv.delete(key); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }),
  },
};

const api = async (path, method = "GET", body) => worker.fetch(new Request(`${origin}${path}`, {
  method,
  headers: { Origin: origin, Authorization: "Bearer session-token", ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env);

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "nxmollpy@gmail.com", is_anonymous: false });
  if (url.includes("/rest/v1/task_hunter_memory")) {
    if (init.method === "POST") { savedMemory = JSON.parse(init.body); return Response.json([savedMemory], { status: 201 }); }
    return Response.json(memoryRows);
  }
  if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: "openai/gpt-oss-20b:free", name: "Test model", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"] } }] });
  if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: { is_free_tier: true, free_model_daily_requests: { used: 0, limit: 50, remaining: 50 } } });
  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    const turn = modelTurns[requestCount++];
    modelPromptMessages.push(JSON.parse(init.body).messages);
    if (modelGate) {
      const gate = modelGate;
      modelGate = null;
      gate.entered();
      await gate.promise;
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(turn) } }], usage: { prompt_tokens: 100, completion_tokens: 40 } });
  }
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-/git/ref/heads/main") return Response.json({ object: { sha: "base-sha" } });
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-") return Response.json({ default_branch: "main", permissions: { push: true } });
  if (url.endsWith("/contents/app-source/beta.js?ref=main")) return Response.json({ encoding: "base64", content: base64(new TextEncoder().encode("export const original = true;")) });
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-/git/refs" && init.method === "POST") {
    activeBranch = JSON.parse(init.body).ref.replace("refs/heads/", "");
    return Response.json({ ref: `refs/heads/${activeBranch}` });
  }
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-/git/commits/base-sha") return Response.json({ tree: { sha: "base-tree" } });
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-/git/trees" && init.method === "POST") return Response.json({ sha: "new-tree" });
  if (url === "https://api.github.com/repos/knmollpy/mediachafa-transfer-/git/commits" && init.method === "POST") { createdCommit = true; commitCount++; return Response.json({ sha: "new-commit" }); }
  if (url.endsWith(`/git/refs/heads/${activeBranch}`) && init.method === "PATCH") return Response.json({ ref: activeBranch });
  if (url.includes("/pulls?state=open&head=knmollpy:")) return Response.json([]);
  if (url.endsWith("/pulls") && init.method === "POST") { openedPrBody = JSON.parse(init.body).body; return Response.json({ number: 5, html_url: "https://github.com/knmollpy/mediachafa-transfer-/pull/5", state: "open", merged: false }); }
  if (url.endsWith("/pulls/5")) return Response.json({ number: 5, html_url: "https://github.com/knmollpy/mediachafa-transfer-/pull/5", state: "closed", merged: true, head: { sha: "new-commit" }, merge_commit_sha: "merge-sha" });
  if (url.endsWith("/issues/5/comments?per_page=100")) return Response.json([]);
  if (url.endsWith("/pulls/5/reviews?per_page=100")) return Response.json([]);
  if (url.endsWith("/actions/workflows/beta-agent-tests.yml/dispatches") && init.method === "POST") { dispatchedChecks = true; return new Response(null, { status: 204 }); }
  if (url.includes("/actions/workflows/beta-agent-tests.yml/runs?branch=")) return Response.json({ workflow_runs: [{ head_sha: "new-commit", id: 8, status: "completed", conclusion: "success", html_url: "https://github.com/example/run/8" }] });
  if (url === "https://api.vercel.com/v9/projects?limit=100") return Response.json({ projects: [{ id: "vercel-project", name: "mediachafa", teamId: "vercel-team", link: { repo: "mediachafa-transfer-", org: "knmollpy", repoId: "1411026786" } }] });
  if (url === "https://api.vercel.com/v2/teams?limit=10") return Response.json({ teams: [] });
  if (url === "https://api.vercel.com/v2/user") return Response.json({ user: { id: "vercel-user" } });
  if (url === "https://api.vercel.com/v13/deployments?teamId=vercel-team" && init.method === "POST") {
    deploymentRequest = JSON.parse(init.body);
    return Response.json({ id: "preview-deployment", url: "mediachafa-preview.vercel.app", target: "preview", readyState: "BUILDING" });
  }
  if (url === "https://api.vercel.com/v13/deployments/preview-deployment?teamId=vercel-team") return Response.json({ id: "preview-deployment", url: "mediachafa-preview.vercel.app", target: "preview", readyState: "READY" });
  if (url === "https://mediachafa-preview.vercel.app") return new Response("<html>Preview</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  throw new Error(`Unexpected external request: ${init.method || "GET"} ${url}`);
};

after(() => { globalThis.fetch = originalFetch; });

test("autonomous execution persists pause state and verifies isolated GitHub changes", async () => {
  kv.set(`integration:${userId}:openrouter`, await encryptToken("router-token"));
  kv.set(`integration:${userId}:github`, await encryptToken("github-token"));
  kv.set(`integration:${userId}:vercel`, await encryptToken("vercel-token"));

  const start = await api("/agent/start", "POST", { mode: "autonomous", model: modelId, message: "Leé, modificá y verificá Beta." });
  assert.equal(start.status, 201);
  const { executionId: id, branch } = await start.json();
  assert.equal(branch, `beta-agent/${id}`);

  const firstStep = await api(`/agent/${id}/step`, "POST", {});
  const firstState = await firstStep.json();
  assert.equal(firstState.status, "running");
  assert.equal(firstState.lastToolResult.name, "github_read_file");
  assert.equal(firstState.lastToolResult.ok, true, JSON.stringify(firstState.lastToolResult));

  const pause = await api(`/agent/${id}/pause`, "POST", { message: "Asegurate de no escribir en main." });
  assert.equal(pause.status, 202);
  const pausedState = await (await api(`/agent/${id}`)).json();
  assert.equal(pausedState.status, "paused");
  assert.equal(pausedState.toolCalls, 1);

  await api(`/agent/${id}/resume`, "POST", {});
  let state;
  for (let count = 0; count < 10; count++) {
    state = await (await api(`/agent/${id}/step`, "POST", {})).json();
    if (state.status !== "running") break;
  }

  assert.equal(state.status, "completed");
  assert.equal(state.verified, true, JSON.stringify(state));
  assert.equal(state.branch, branch);
  assert.equal(state.commitSha, "new-commit");
  assert.equal(state.lastChecksSucceeded, true);
  assert.equal(state.lastPreviewSucceeded, true, JSON.stringify(state.lastToolResult));
  assert.equal(state.pullRequest.merged, true, JSON.stringify(state.pullRequest));
  const manifestMatch = openedPrBody?.match(/<!--\s*MEDIACHAFA_REVIEW_MANIFEST\s*([\s\S]*?)\s*-->/);
  assert.ok(manifestMatch, "El PR debe incluir un manifiesto legible por el revisor independiente.");
  const manifest = JSON.parse(manifestMatch[1]);
  assert.equal(manifest.version, 1);
  assert.ok(manifest.allowed_paths.includes("app-source/beta-ai/worker.js"));
  assert.equal(manifest.allow_deletions, false);
  assert.equal(state.vercelDeployment.target, "preview");
  assert.equal(state.vercelDeployment.url, "mediachafa-preview.vercel.app");
  assert.equal(deploymentRequest.target, "preview");
  assert.equal(deploymentRequest.gitSource.ref, branch);
  assert.equal(deploymentRequest.gitSource.sha, "new-commit");
  assert.equal(state.estimatedCostUsd, 0);
  assert.equal(requestCount, 9);
  assert.equal(createdCommit, true);
  assert.equal(dispatchedChecks, true);
  assert.ok(modelPromptMessages[0][1].content.includes("Respuestas breves en español."));
});

test("Beta saves persistent memory only after explicit owner approval", async () => {
  savedMemory = null;
  const proposalResponse = await api("/actions/propose", "POST", { actions: [{
    provider: "supabase",
    type: "memory_save",
    memory_key: "response_style",
    memory_value: { text: "Usar respuestas breves y claras en español." },
    user_confirmed: true,
    reusable: true,
    sensitive: false,
    description: "Recordar preferencia de estilo."
  }] });
  assert.equal(proposalResponse.status, 200);
  const proposals = (await proposalResponse.json()).proposals;
  assert.equal(proposals.length, 1);
  const approved = await api(`/actions/${proposals[0].id}/approve`, "POST", {});
  assert.equal(approved.status, 200);
  assert.equal(savedMemory.user_id, userId);
  assert.equal(savedMemory.memory_key, "response_style");
  assert.equal(savedMemory.user_confirmed, true);
  assert.equal(savedMemory.reusable, true);
  assert.equal(savedMemory.sensitive, false);
});

test("sensitive or unconfirmed memory proposals are rejected", async () => {
  const response = await api("/actions/propose", "POST", { actions: [
    {
      provider: "supabase",
      type: "memory_save",
      memory_key: "api_token",
      memory_value: { text: "do not store" },
      user_confirmed: false,
      reusable: true,
      sensitive: false
    },
    {
      provider: "supabase",
      type: "memory_save",
      memory_key: "profile",
      memory_value: { text: "medical diagnosis: example" },
      user_confirmed: true,
      reusable: true,
      sensitive: false
    }
  ] });
  assert.equal((await response.json()).proposals.length, 0);
});

test("Beta rejects protected secret paths for single- and multi-file GitHub writes", async () => {
  const response = await api("/actions/propose", "POST", { actions: [
    { provider: "github", type: "write_file", repository: "knmollpy/mediachafa-transfer-", path: "app-source/.env.production", content: "SECRET=do-not-write" },
    { provider: "github", type: "write_files", repository: "knmollpy/mediachafa-transfer-", files: [
      { path: "app-source/config/credentials.json", content: "{}" }
    ] }
  ] });
  assert.equal((await response.json()).proposals.length, 0);
});

test("pause during a model turn persists instructions and skips the pending tool call", async () => {
  modelTurns.push(
    { type: "tool_call", name: "github_write_files", arguments: { files: [{ path: "app-source/beta.js", content: "must not run while paused" }] } },
    { type: "final", answer: "Continué luego de la pausa.", verified: false },
  );
  const start = await api("/agent/start", "POST", { mode: "autonomous", model: modelId, message: "Modificá el archivo." });
  const { executionId: id } = await start.json();
  let markEntered;
  let releaseModel;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const modelResponse = new Promise((resolve) => { releaseModel = resolve; });
  modelGate = { entered: markEntered, promise: modelResponse };
  const previousCommitCount = commitCount;
  const pendingStep = api(`/agent/${id}/step`, "POST", {});
  await entered;
  const pauseResponse = await api(`/agent/${id}/pause`, "POST", { message: "No ejecutes la escritura pendiente hasta que retome." });
  assert.equal((await pauseResponse.json()).status, "pausing");
  releaseModel();
  const stepState = await (await pendingStep).json();
  assert.equal(stepState.status, "paused");
  assert.equal(stepState.toolCalls, 0);
  assert.equal(commitCount, previousCommitCount);

  await api(`/agent/${id}/resume`, "POST", {});
  const completed = await (await api(`/agent/${id}/step`, "POST", {})).json();
  assert.equal(completed.status, "completed");
  assert.equal(completed.verified, false);
  assert.ok(modelPromptMessages.at(-1).some((message) => message.content.includes("No ejecutes la escritura pendiente")));
});

test("autonomous start rejects non-free or non-OpenRouter models", async () => {
  const response = await api("/agent/start", "POST", { mode: "autonomous", model: "groq::paid-model", message: "No ejecutes esto." });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /OpenRouter :free/);
});

test("Vercel integration validates project access and stores its token encrypted", async () => {
  const response = await api("/integrations/connect", "POST", { provider: "vercel", token: "vercel-owner-token" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.connected, true);
  assert.equal(data.capabilities.previewDeployments, true);
  const stored = kv.get(`integration:${userId}:vercel`);
  assert.ok(stored);
  assert.equal(stored.includes("vercel-owner-token"), false);
});
