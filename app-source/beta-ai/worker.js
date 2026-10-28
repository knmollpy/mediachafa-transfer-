const APP_ORIGIN = "https://mediachafa-transfer.vercel.app";
const SUPABASE_URL = "https://velxgwkujcabdaxbppyj.supabase.co";
const SUPABASE_KEY = "sb_publishable_fbyju-9gVuWpbLwhz7Ki9w_6mWg593-";
const OWNER_EMAIL = "nxmollpy@gmail.com";
const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DAILY_REQUEST_LIMIT = 100;
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const PROVIDERS = ["github", "supabase", "cloudflare"];
const GITHUB_REPO = "knmollpy/mediachafa-transfer-";
const CLOUDFLARE_ACCOUNT = "3ed811eed85e393b5d97f052e812cfaf";

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
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  if (provider === "github") {
    headers["X-GitHub-Api-Version"] = "2022-11-28";
    const repoResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers });
    if (!repoResponse.ok) return { ok: false, error: "El token no tiene acceso al repositorio privado knmollpy/mediachafa-transfer-. Comprobá el token y su acceso a ese repositorio." };
    const repo = await repoResponse.json();
    return { ok: true, detail: `Repositorio ${GITHUB_REPO}`, capabilities: { read: true, write: Boolean(repo.permissions?.push) } };
  }
  if (provider === "supabase") {
    const response = await fetch("https://api.supabase.com/v1/projects", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!response.ok) return { ok: false, error: "Supabase rechazó el token. Revisá que sea un Personal Access Token vigente." };
    return { ok: true, detail: "Cuenta de Supabase validada" };
  }
  const verify = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { Authorization: `Bearer ${token}` } });
  if (!verify.ok || !(await verify.json()).success) return { ok: false, error: "Cloudflare rechazó el token. Revisá que esté vigente." };
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
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers: { Authorization: `Bearer ${github}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
      if (response.ok) { const repo = await response.json(); context.github = { repository: repo.full_name, defaultBranch: repo.default_branch, description: repo.description, canWrite: Boolean(repo.permissions?.push) }; }
    } catch {}
  }
  if (supabase) {
    try {
      const response = await fetch("https://api.supabase.com/v1/projects", { headers: { Authorization: `Bearer ${supabase}`, Accept: "application/json" } });
      if (response.ok) { const projects = await response.json(); context.supabase = (Array.isArray(projects) ? projects : []).slice(0, 40).map(({ name, id, ref, status, region }) => ({ name, id: ref || id, status, region })); }
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
        return json({ error: "Las conexiones pegando API tokens están deshabilitadas. Usá la autorización oficial de OAuth cuando esté configurada." }, 410, origin);
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
    if (url.pathname === "/oauth/start" && request.method === "POST") {
      const user = await requireOwner(request);
      if (!user) return json({ error: "Conectá la cuenta dueña de MediaChafa para administrar integraciones." }, 403, origin);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }
      const provider = String(payload.provider || "").toLowerCase();
      if (!PROVIDERS.includes(provider)) return json({ error: "Proveedor OAuth desconocido." }, 400, origin);
      const callback = `${new URL(request.url).origin}/oauth/callback`;
      return json({ error: `Falta terminar la configuración OAuth de ${provider}. Primero hay que registrar su aplicación y su URL de retorno ${callback}; Google no puede autorizar esa cuenta por ${provider}.` }, 503, origin);
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
    if (!quota.allowed) return json({ error: `Llegaste al límite de ${DAILY_REQUEST_LIMIT} consultas por día. Vuelve a intentarlo mañana.`, remaining: 0, resetsAt: quota.resetsAt }, 429, origin);

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
        { role: "system", content: `Sos Beta, la asistente privada de MediaChafa. Respondé en español claro. Podés analizar imágenes y texto; si recibís una transcripción, tratala como contenido del usuario. Integraciones conectadas: ${available}. Contexto de recursos, obtenido desde las cuentas conectadas: ${JSON.stringify(connectedContext).slice(0, 12000)}. No afirmes que ejecutaste una acción a menos que el sistema la haya confirmado. Nunca solicites que peguen tokens en el chat; las conexiones se gestionan en la pestaña Integraciones. Esta versión puede consultar metadatos básicos, pero no ejecutar cambios en GitHub, Supabase o Cloudflare. Antes de habilitar escrituras, hay que mostrar el cambio y pedir confirmación en la interfaz.` },
        ...history,
        { role: "user", content: image ? [ { type: "text", text: context }, { type: "image_url", image_url: { url: image } } ] : context },
      ];
      const result = await env.AI.run(CHAT_MODEL, {
        messages,
        max_tokens: 600,
        temperature: 0.5,
        chat_template_kwargs: { enable_thinking: false },
      });
      const answer = result?.response || result?.result || result?.choices?.[0]?.message?.content;
      if (!answer) throw new Error("El modelo no devolvió una respuesta.");
      return json({ answer: String(answer), transcript, remaining: quota.remaining, dailyLimit: DAILY_REQUEST_LIMIT }, 200, origin);
    } catch (error) {
      return json({ error: error?.message || "No se pudo completar la consulta a la IA.", remaining: quota.remaining }, 502, origin);
    }
  },
};
