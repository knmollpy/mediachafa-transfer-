const APP_ORIGIN = "https://mediachafa-transfer.vercel.app";
const SUPABASE_URL = "https://velxgwkujcabdaxbppyj.supabase.co";
const SUPABASE_KEY = "sb_publishable_fbyju-9gVuWpbLwhz7Ki9w_6mWg593-";
const OWNER_EMAIL = "nxmollpy@gmail.com";
const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DAILY_REQUEST_LIMIT = 4;
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

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
      return json({ ok: true, remaining: Math.max(0, DAILY_REQUEST_LIMIT - used), dailyLimit: DAILY_REQUEST_LIMIT }, 200, origin);
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
    if (!quota.allowed) return json({ error: "Llegaste al límite gratuito de 10 mensajes por día. Vuelve a intentarlo mañana.", remaining: 0, resetsAt: quota.resetsAt }, 429, origin);

    try {
      if (payload.audio) {
        const audio = String(payload.audio.data).replace(/^data:[^,]+,/, "");
        const result = await env.AI.run(AUDIO_MODEL, { audio, task: "transcribe" });
        transcript = String(result?.text || "").trim();
      }
      const context = [prompt, transcript ? `\n\nTranscripción del audio adjunto:\n${transcript}` : ""].join("").trim() || "Describe la imagen adjunta.";
      const messages = [
        { role: "system", content: "Sos la asistente Beta privada de MediaChafa. Respondé en español claro. Podés analizar imágenes y texto; si recibís una transcripción, tratala como contenido del usuario. No afirmes que conectaste cuentas ni que cambiaste archivos. En esta versión solo conversás; las acciones sobre cuentas requieren autorización explícita en la interfaz." },
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
