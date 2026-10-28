const APP_ORIGIN = "https://mediachafa-transfer.vercel.app";
const SUPABASE_URL = "https://velxgwkujcabdaxbppyj.supabase.co";
const SUPABASE_KEY = "sb_publishable_fbyju-9gVuWpbLwhz7Ki9w_6mWg593-";
const OWNER_EMAIL = "nxmollpy@gmail.com";
const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DAILY_REQUEST_LIMIT = 1000;
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const PROVIDERS = ["github", "supabase", "cloudflare"];
const GITHUB_REPO = "knmollpy/mediachafa-transfer-";
const SUPABASE_PROJECT = "velxgwkujcabdaxbppyj";
const CLOUDFLARE_ACCOUNT = "3ed811eed85e393b5d97f052e812cfaf";
const OPERATION_TTL_SECONDS = 600;

function safeAction(action) {
  if (!action || typeof action !== "object") return null;
  const provider = String(action.provider || "").toLowerCase();
  const type = String(action.type || "").toLowerCase();
  const name = String(action.name || "").trim();
  const path = String(action.path || "").trim();
  const content = String(action.content || "");
  const description = String(action.description || "").slice(0, 500);
  if (provider === "github" && type === "write_file" && path && !path.startsWith("/") && !path.split("/").includes("..") && content.length <= 500_000) {
    return { provider, type, path, content, message: String(action.message || `Beta: actualizar ${path}`).slice(0, 120), summary: description || `Crear o actualizar ${path} en ${GITHUB_REPO}.` };
  }
  if (provider === "github" && type === "create_repository" && /^[a-zA-Z0-9_.-]{1,100}$/.test(name)) {
    return { provider, type, name, description, summary: description || `Crear el repositorio privado ${name} en GitHub.` };
  }
  if (provider === "supabase" && type === "sql" && typeof action.query === "string" && action.query.trim().length > 0 && action.query.length <= 100_000) {
    return { provider, type, query: action.query, summary: description || "Ejecutar la consulta SQL mostrada en la vista previa en el proyecto Supabase conectado." };
  }
  if (provider === "cloudflare" && type === "create_worker" && /^[a-z0-9][a-z0-9-]{1,30}$/.test(name) && content.length > 0 && content.length <= 500_000) {
    return { provider, type, name, content, summary: description || `Crear un Worker nuevo llamado ${name}. No modifica Workers existentes.` };
  }
  return null;
}

function extractPlan(output) {
  const text = String(output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    return { answer: String(parsed.answer || "Beta preparó una propuesta."), actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return { answer: String(parsed.answer || "Beta preparó una propuesta."), actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
      } catch {}
    }
    return { answer: text, actions: [] };
  }
}

async function providerRequest(provider, token, path, method, body, headers = {}) {
  const base = provider === "github" ? "https://api.github.com" : provider === "supabase" ? "https://api.supabase.com" : "https://api.cloudflare.com/client/v4";
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: provider === "github" ? "application/vnd.github+json" : "application/json", ...(provider === "github" ? { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "MediaChafa-Beta" } : {}), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: body instanceof FormData || typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${provider} respondió HTTP ${response.status}: ${String(data.message || data.error || data.errors?.[0]?.message || "No se pudo aplicar el cambio.").slice(0, 240)}`);
  return data;
}

async function applyApprovedAction(env, userId, action) {
  const token = await storedToken(env, userId, action.provider);
  if (!token) throw new Error(`La integración ${action.provider} ya no está conectada.`);
  if (action.provider === "github" && action.type === "write_file") {
    const current = await providerRequest("github", token, `/repos/${GITHUB_REPO}/contents/${action.path.split("/").map(encodeURIComponent).join("/")}`, "GET").catch(() => null);
    const result = await providerRequest("github", token, `/repos/${GITHUB_REPO}/contents/${action.path.split("/").map(encodeURIComponent).join("/")}`, "PUT", { message: action.message, content: base64(new TextEncoder().encode(action.content)), ...(current?.sha ? { sha: current.sha } : {}) });
    return { message: `GitHub guardó ${action.path} en ${GITHUB_REPO}.`, url: result.content?.html_url || `https://github.com/${GITHUB_REPO}/blob/main/${action.path}` };
  }
  if (action.provider === "github" && action.type === "create_repository") {
    const result = await providerRequest("github", token, "/user/repos", "POST", { name: action.name, description: action.description, private: true, auto_init: true });
    return { message: `Repositorio privado ${result.full_name} creado.`, url: result.html_url };
  }
  if (action.provider === "supabase" && action.type === "sql") {
    await providerRequest("supabase", token, `/v1/projects/${SUPABASE_PROJECT}/database/query`, "POST", { query: action.query });
    return { message: `Consulta ejecutada en el proyecto ${SUPABASE_PROJECT}.`, url: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/sql` };
  }
  if (action.provider === "cloudflare" && action.type === "create_worker") {
    const existing = await providerRequest("cloudflare", token, `/accounts/${CLOUDFLARE_ACCOUNT}/workers/scripts`, "GET");
    if ((existing.result || []).some(worker => worker.id === action.name)) throw new Error(`Ya existe el Worker ${action.name}; Beta solo puede crear Workers nuevos en esta versión.`);
    const form = new FormData();
    form.set("metadata", JSON.stringify({ main_module: "index.js", compatibility_date: new Date().toISOString().slice(0, 10) }));
    form.set("index.js", new Blob([action.content], { type: "application/javascript+module" }), "index.js");
    await providerRequest("cloudflare", token, `/accounts/${CLOUDFLARE_ACCOUNT}/workers/scripts/${encodeURIComponent(action.name)}`, "PUT", form);
    return { message: `Worker ${action.name} creado.`, url: `https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT}/workers/services/view/${encodeURIComponent(action.name)}/production` };
  }
  throw new Error("Esta clase de acción no está habilitada.");
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function encryptionKey(env) {
  const raw = Uint8Array.from(atob(env.TOKEN_ENCRYPTION_KEY || ""), (c) => c.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("La clave de cifrado de integraciones no está configurada.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(token));
  return JSON.stringify({ iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), version: 1 });
}

async function decryptToken(env, stored) {
  const record = JSON.parse(stored || "{}");
  const from64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(record.iv) }, await encryptionKey(env), from64(record.ciphertext));
  return new TextDecoder().decode(plaintext);
}

async function storedToken(env, userId, provider) {
  if (!PROVIDERS.includes(provider)) return null;
  const value = await env.BETA_LIMITS.get(`integration:${userId}:${provider}`);
  if (!value) return null;
  return decryptToken(env, value);
}

async function verifyProvider(provider, token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "MediaChafa-Beta" };
  if (provider === "github") {
    headers["X-GitHub-Api-Version"] = "2022-11-28";
    const repoResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers });
    if (repoResponse.status === 401) return { ok: false, error: "GitHub rechazó el token (401). Creá uno nuevo y revisá que no esté vencido, revocado ni copiado con espacios." };
    if (repoResponse.status === 403) {
      let reason = "";
      try {
        const raw = await repoResponse.text();
        try { reason = String(JSON.parse(raw).message || raw).slice(0, 240); }
        catch { reason = raw.slice(0, 240); }
      } catch {}
      const sso = repoResponse.headers.get("X-GitHub-SSO");
      return { ok: false, error: `GitHub reconoció el token, pero denegó el acceso (403).${sso ? " GitHub indica que falta autorizar SSO." : ""}${reason ? ` Detalle: ${reason}` : " Revisá el permiso Contents y el acceso al repositorio seleccionado."}` };
    }
    if (repoResponse.status === 404) return { ok: false, error: `GitHub no permite ver el repositorio privado ${GITHUB_REPO} con este token. Si es fine-grained, asegurate de elegir como Resource owner a knmollpy y de incluir mediachafa-transfer-. Si es classic, activá el alcance repo. La opción “todos los repositorios” debe pertenecer a la cuenta knmollpy.` };
    if (!repoResponse.ok) return { ok: false, error: `GitHub no pudo consultar el repositorio (HTTP ${repoResponse.status}).` };
    const repo = await repoResponse.json();
    return { ok: true, detail: `Repositorio ${GITHUB_REPO}`, capabilities: { read: true, write: Boolean(repo.permissions?.push) } };
  }
  if (provider === "supabase") {
    const response = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!response.ok) return { ok: false, error: `Supabase no permitió consultar el proyecto ${SUPABASE_PROJECT} (HTTP ${response.status}). Revisá que el PAT esté vigente y tenga Project Settings: Read para ese proyecto.` };
    return { ok: true, detail: `Proyecto Supabase ${SUPABASE_PROJECT} validado` };
  }
  const verifyUrl = token.startsWith("cfat_")
    ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT}/tokens/verify`
    : "https://api.cloudflare.com/client/v4/user/tokens/verify";
  const verify = await fetch(verifyUrl, { headers: { Authorization: `Bearer ${token}` } });
  let verifyResult;
  try { verifyResult = await verify.json(); } catch { verifyResult = {}; }
  if (!verify.ok || !verifyResult.success) {
    const reason = String(verifyResult.errors?.[0]?.message || "").slice(0, 180);
    return { ok: false, error: `Cloudflare no validó el token (HTTP ${verify.status}).${reason ? ` Detalle: ${reason}` : " Revisá que esté activo y creado para esta cuenta."}` };
  }
  const account = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT}/workers/scripts`, { headers: { Authorization: `Bearer ${token}` } });
  if (!account.ok) return { ok: false, error: "El token es válido, pero no puede leer Workers en la cuenta de MediaChafa." };
  return { ok: true, detail: "Cuenta de Cloudflare validada" };
}

async function integrationStatus(env, userId) {
  const result = {};
  for (const provider of PROVIDERS) {
    const exists = await env.BETA_LIMITS.get(`integration:${userId}:${provider}`);
    result[provider] = { connected: Boolean(exists), ...(exists ? JSON.parse(exists).meta : {}) };
  }
  return result;
}

async function integrationContext(env, userId) {
  const context = {};
  const github = await storedToken(env, userId, "github");
  const supabase = await storedToken(env, userId, "supabase");
  const cloudflare = await storedToken(env, userId, "cloudflare");
  if (github) {
    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers: { Authorization: `Bearer ${github}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "MediaChafa-Beta" } });
      if (response.ok) { const repo = await response.json(); context.github = { repository: repo.full_name, defaultBranch: repo.default_branch, description: repo.description, canWrite: Boolean(repo.permissions?.push) }; }
    } catch {}
  }
  if (supabase) {
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}`, { headers: { Authorization: `Bearer ${supabase}`, Accept: "application/json" } });
      if (response.ok) { const project = await response.json(); context.supabase = [{ name: project.name, id: project.ref || project.id || SUPABASE_PROJECT, status: project.status, region: project.region }]; }
    } catch {}
  }
  if (cloudflare) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT}/workers/scripts`, { headers: { Authorization: `Bearer ${cloudflare}` } });
      if (response.ok) { const payload = await response.json(); context.cloudflare = (payload.result || []).slice(0, 100).map(({ id, handlers, modified_on }) => ({ script: id, handlers, modified: modified_on })); }
    } catch {}
  }
  return context;
}

async function requireOwner(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return undefined;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: authorization },
  });
  if (!response.ok) return undefined;
  const user = await response.json();
  if (user.is_anonymous || String(user.email || "").toLowerCase() !== OWNER_EMAIL) return undefined;
  return user;
}

async function reserveRequest(env, userId) {
  const date = new Date().toISOString().slice(0, 10);
  const key = `beta-ai-requests:${userId}:${date}`;
  const current = Number(await env.BETA_LIMITS.get(key) || 0);
  if (current >= DAILY_REQUEST_LIMIT) return { allowed: false, remaining: 0, resetsAt: `${date}T24:00:00Z` };
  const next = current + 1;
  await env.BETA_LIMITS.put(key, String(next), { expirationTtl: 172800 });
  return { allowed: true, remaining: DAILY_REQUEST_LIMIT - next, resetsAt: `${date}T24:00:00Z` };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== APP_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (origin !== APP_ORIGIN) return json({ error: "Origen no autorizado." }, 403, origin);
    const url = new URL(request.url);
    if (url.pathname === "/status" && request.method === "GET") {
      const user = await requireOwner(request);
      if (!user) return json({ error: "La Beta está disponible solo para la cuenta dueña." }, 403, origin);
      const date = new Date().toISOString().slice(0, 10);
      const used = Number(await env.BETA_LIMITS.get(`beta-ai-requests:${user.id}:${date}`) || 0);
      return json({ ok: true, remaining: Math.max(0, DAILY_REQUEST_LIMIT - used), dailyLimit: DAILY_REQUEST_LIMIT, resetsAt: `${date}T24:00:00Z` }, 200, origin);
    }
    if (url.pathname.startsWith("/integrations/") && request.method !== "GET" && request.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);
    if (url.pathname.startsWith("/integrations/")) {
      const user = await requireOwner(request);
      if (!user) return json({ error: "Conectá la cuenta dueña de MediaChafa para administrar integraciones." }, 403, origin);
      if (url.pathname === "/integrations/status" && request.method === "GET") return json({ integrations: await integrationStatus(env, user.id), resources: await integrationContext(env, user.id) }, 200, origin);
      if (url.pathname === "/integrations/connect" && request.method === "POST") {
        let payload;
        try { payload = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }
        const provider = String(payload.provider || "").toLowerCase();
        const token = String(payload.token || "").trim();
        if (!PROVIDERS.includes(provider) || token.length < 12 || token.length > 4096) return json({ error: "Proveedor o token inválido." }, 400, origin);
        try {
          const verified = await verifyProvider(provider, token);
          if (!verified.ok) return json({ error: verified.error }, 400, origin);
          const encrypted = JSON.parse(await encryptToken(env, token));
          const meta = { detail: verified.detail, connectedAt: new Date().toISOString(), capabilities: verified.capabilities || {} };
          await env.BETA_LIMITS.put(`integration:${user.id}:${provider}`, JSON.stringify({ ...encrypted, meta }));
          return json({ provider, connected: true, detail: verified.detail, capabilities: meta.capabilities }, 200, origin);
        } catch (error) {
          return json({ error: error?.message || "No se pudo validar o guardar la integración." }, 502, origin);
        }
      }
      if (url.pathname === "/integrations/disconnect" && request.method === "POST") {
        let payload;
        try { payload = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }
        const provider = String(payload.provider || "").toLowerCase();
        if (!PROVIDERS.includes(provider)) return json({ error: "Servicio desconocido." }, 400, origin);
        await env.BETA_LIMITS.delete(`integration:${user.id}:${provider}`);
        return json({ provider, connected: false }, 200, origin);
      }
      return json({ error: "Ruta de integraciones no encontrada." }, 404, origin);
    }
    if (url.pathname === "/actions/propose" && request.method === "POST") {
      const user = await requireOwner(request);
      if (!user) return json({ error: "Solo la cuenta dueña puede proponer cambios." }, 403, origin);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }
      const requested = Array.isArray(payload.actions) ? payload.actions.slice(0, 4) : [];
      const proposals = [];
      for (const raw of requested) {
        const action = safeAction(raw);
        if (!action) continue;
        const status = await integrationStatus(env, user.id);
        if (!status[action.provider]?.connected) continue;
        const id = crypto.randomUUID();
        const preview = { id, provider: action.provider, type: action.type, summary: action.summary, ...(action.path ? { path: action.path } : {}), ...(action.name ? { name: action.name } : {}), ...(action.content !== undefined ? { content: action.content } : {}), ...(action.query !== undefined ? { query: action.query } : {}), ...(action.message ? { message: action.message } : {}) };
        await env.BETA_LIMITS.put(`beta-action:${user.id}:${id}`, JSON.stringify({ state: "pending", action }), { expirationTtl: OPERATION_TTL_SECONDS });
        proposals.push(preview);
      }
      return json({ proposals, expiresInSeconds: OPERATION_TTL_SECONDS }, 200, origin);
    }
    if (url.pathname.startsWith("/actions/") && (request.method === "POST" || request.method === "GET")) {
      const user = await requireOwner(request);
      if (!user) return json({ error: "Solo la cuenta dueña puede aprobar cambios." }, 403, origin);
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[1];
      if (!/^[0-9a-f-]{36}$/i.test(id || "")) return json({ error: "Propuesta no válida." }, 400, origin);
      const key = `beta-action:${user.id}:${id}`;
      const stored = await env.BETA_LIMITS.get(key);
      if (!stored) return json({ error: "La propuesta venció o ya no existe. Pedile a Beta que la prepare otra vez." }, 410, origin);
      let record;
      try { record = JSON.parse(stored); } catch { return json({ error: "La propuesta quedó dañada." }, 410, origin); }
      if (request.method === "GET") return json({ state: record.state }, 200, origin);
      const command = parts[2];
      if (record.state !== "pending") return json({ error: "La propuesta ya fue aprobada, rechazada o procesada." }, 409, origin);
      if (command === "reject") {
        await env.BETA_LIMITS.put(key, JSON.stringify({ state: "rejected" }), { expirationTtl: 3600 });
        return json({ state: "rejected", message: "Cambio rechazado; no se envió al proveedor." }, 200, origin);
      }
      if (command !== "approve") return json({ error: "Usá approve o reject." }, 404, origin);
      await env.BETA_LIMITS.put(key, JSON.stringify({ state: "executing" }), { expirationTtl: 3600 });
      try {
        const result = await applyApprovedAction(env, user.id, record.action);
        await env.BETA_LIMITS.put(key, JSON.stringify({ state: "completed", result }), { expirationTtl: 3600 });
        return json({ state: "completed", ...result }, 200, origin);
      } catch (error) {
        await env.BETA_LIMITS.put(key, JSON.stringify({ state: "failed", message: error?.message || "Falló la acción." }), { expirationTtl: 3600 });
        return json({ state: "failed", error: error?.message || "No se pudo aplicar el cambio." }, 502, origin);
      }
    }
    if (url.pathname === "/oauth/start" && request.method === "POST") {
      const user = await requireOwner(request);
      if (!user) return json({ error: "Conectá la cuenta dueña de MediaChafa para administrar integraciones." }, 403, origin);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }
      const provider = String(payload.provider || "").toLowerCase();
      if (!PROVIDERS.includes(provider)) return json({ error: "Proveedor OAuth desconocido." }, 400, origin);
      return json({ error: `La conexión OAuth de ${provider} todavía no está habilitada. Falta registrar su aplicación y completar el callback seguro en el Worker. Google no puede autorizar esa cuenta por ${provider}.` }, 503, origin);
    }
    if (url.pathname !== "/chat" || request.method !== "POST") return json({ error: "Ruta no encontrada." }, 404, origin);

    const user = await requireOwner(request);
    if (!user) return json({ error: "La Beta está disponible solo para la cuenta dueña." }, 403, origin);
    let payload;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: "El mensaje supera el límite de 12 MB." }, 413, origin);
      payload = JSON.parse(rawBody);
    }
    catch { return json({ error: "El mensaje no tiene un formato válido." }, 400, origin); }
    const prompt = String(payload.message || "").trim().slice(0, 6000);
    if (!prompt && !payload.image && !payload.audio) return json({ error: "Escribí un mensaje o adjuntá una imagen o audio." }, 400, origin);

    let image;
    if (payload.image) {
      const value = String(payload.image.data || "");
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) || value.length > MAX_MEDIA_BYTES * 1.4) return json({ error: "La imagen debe ser PNG, JPEG, WebP o GIF y pesar hasta 5 MB." }, 400, origin);
      image = value;
    }

    let transcript = "";
    if (payload.audio) {
      const audio = String(payload.audio.data || "");
      const mime = String(payload.audio.mime || "").toLowerCase();
      if (!/^audio\/(mpeg|mp4|wav|webm|ogg|x-wav|x-m4a|mp3)/i.test(mime) || audio.length > MAX_MEDIA_BYTES * 1.4) return json({ error: "El audio debe ser MP3, M4A, WAV, WebM u OGG y pesar hasta 5 MB." }, 400, origin);
    }

    const history = Array.isArray(payload.history)
      ? payload.history.slice(-8).filter((item) => ["user", "assistant"].includes(item?.role)).map((item) => ({ role: item.role, content: String(item.content || "").slice(0, 3000) }))
      : [];
    const quota = await reserveRequest(env, user.id);
    if (!quota.allowed) return json({ error: `Llegaste al límite de ${DAILY_REQUEST_LIMIT} consultas por día. Vuelve a intentarlo mañana. También puede aplicar antes el límite del proveedor de IA.`, remaining: 0, resetsAt: quota.resetsAt }, 429, origin);

    try {
      if (payload.audio) {
        const audio = String(payload.audio.data).replace(/^data:[^,]+,/, "");
        const result = await env.AI.run(AUDIO_MODEL, { audio, task: "transcribe" });
        transcript = String(result?.text || "").trim();
      }
      const context = [prompt, transcript ? `\n\nTranscripción del audio adjunto:\n${transcript}` : ""].join("").trim() || "Describe la imagen adjunta.";
      const integrations = await integrationStatus(env, user.id);
      const connectedContext = await integrationContext(env, user.id);
      const available = Object.entries(integrations).filter(([, value]) => value.connected).map(([provider, value]) => `${provider}: ${value.detail || "conectado"}`).join("; ") || "ninguna";
      const messages = [
        { role: "system", content: `Sos Beta, la asistente privada de MediaChafa. Respondé siempre como un único objeto JSON, sin markdown ni texto fuera del JSON: {"answer":"respuesta breve y clara en español","actions":[]}. Podés analizar imágenes y texto; si recibís una transcripción, tratala como contenido del usuario. Integraciones conectadas: ${available}. Contexto de recursos: ${JSON.stringify(connectedContext).slice(0, 12000)}. Si el usuario pide un cambio externo y la integración está conectada, explica brevemente qué harás y agrega una propuesta exacta a actions. Nunca afirmes que se hizo antes de que el usuario apruebe y el servidor lo confirme. Nunca pidas tokens en el chat. Acciones permitidas: GitHub escribir un archivo del repositorio conectado {provider:"github",type:"write_file",path,content,message,description}; GitHub crear repositorio privado {provider:"github",type:"create_repository",name,description}; Supabase ejecutar SQL exacto {provider:"supabase",type:"sql",query,description}; Cloudflare crear un Worker nuevo {provider:"cloudflare",type:"create_worker",name,content,description}. No propongas borrar recursos, modificar Workers existentes, cambiar secretos/permisos, operar fuera del repo o proyecto conectados ni editar o desplegar el propio Worker de Beta. Para SQL muestra el SQL completo en query; evita operaciones destructivas o cambios de acceso público, y si son necesarios explica el riesgo en answer y no generes la propuesta. Para cambios de archivos, genera contenido completo. Acciones siempre requieren aprobación individual en la interfaz y vencen en 10 minutos.` },
        ...history,
        { role: "user", content: image ? [ { type: "text", text: context }, { type: "image_url", image_url: { url: image } } ] : context },
      ];
      const result = await env.AI.run(CHAT_MODEL, {
        messages,
        max_tokens: 2400,
        temperature: 0.5,
        chat_template_kwargs: { enable_thinking: false },
      });
      const rawAnswer = result?.response || result?.result || result?.choices?.[0]?.message?.content;
      if (!rawAnswer) throw new Error("El modelo no devolvió una respuesta.");
      const plan = extractPlan(rawAnswer);
      let proposals = [];
      if (plan.actions.length) {
        for (const raw of plan.actions.slice(0, 4)) {
          const action = safeAction(raw);
          if (!action || !integrations[action.provider]?.connected) continue;
          const id = crypto.randomUUID();
          await env.BETA_LIMITS.put(`beta-action:${user.id}:${id}`, JSON.stringify({ state: "pending", action }), { expirationTtl: OPERATION_TTL_SECONDS });
          proposals.push({ id, provider: action.provider, type: action.type, summary: action.summary, ...(action.path ? { path: action.path } : {}), ...(action.name ? { name: action.name } : {}), ...(action.content !== undefined ? { content: action.content } : {}), ...(action.query !== undefined ? { query: action.query } : {}), ...(action.message ? { message: action.message } : {}) });
        }
      }
      return json({ answer: plan.answer, proposals, expiresInSeconds: OPERATION_TTL_SECONDS, transcript, remaining: quota.remaining, dailyLimit: DAILY_REQUEST_LIMIT }, 200, origin);
    } catch (error) {
      return json({ error: error?.message || "No se pudo completar la consulta a la IA.", remaining: quota.remaining }, 502, origin);
    }
  },
};
