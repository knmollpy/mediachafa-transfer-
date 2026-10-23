const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

// R2 supports individual objects up to 5 TiB. Keep the UI aligned with the
// library quota; multipart uploads avoid sending large bodies through Worker.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const GOOGLE_REDIRECT_URI = "https://mediachafa-storage.nxmollpy.workers.dev/google/callback";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function objectKey(pathname, prefix) {
  let key;
  try { key = decodeURIComponent(pathname.slice(prefix.length)); } catch { return null; }
  if (!key || key.length > 1024 || key.includes("\0") || key.split("/").some(part => part === "..")) return null;
  return key;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function getUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization },
  });
  if (!response.ok) return null;
  return { user: await response.json(), authorization };
}

async function canUpload(session, env) {
  if (!session) return false;
  if (session.user.id === env.OWNER_USER_ID) return true;
  const url = `${env.SUPABASE_URL}/rest/v1/media_users?select=can_upload&id=eq.${encodeURIComponent(session.user.id)}&limit=1`;
  const response = await fetch(url, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
  if (!response.ok) return false;
  const rows = await response.json();
  return rows[0]?.can_upload === true;
}

async function isRegisteredCollaborator(session, env) {
  if (!session || session.user.id === env.OWNER_USER_ID) return false;
  const url = `${env.SUPABASE_URL}/rest/v1/media_users?select=id&id=eq.${encodeURIComponent(session.user.id)}&limit=1`;
  const response = await fetch(url, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
  if (!response.ok) return false;
  return (await response.json()).length > 0;
}

async function isOwner(session, env) {
  return Boolean(session && session.user.id === env.OWNER_USER_ID);
}

async function canTransfer(session, env) {
  return Boolean(await isOwner(session, env) || await canUpload(session, env));
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function googleEncryptionKey(env) {
  return crypto.subtle.importKey("raw", base64ToBytes(env.GOOGLE_TOKEN_ENCRYPTION_KEY), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptGoogleToken(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await googleEncryptionKey(env), new TextEncoder().encode(value));
  return JSON.stringify({ iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) });
}

async function decryptGoogleToken(value, env) {
  if (!value || !env.GOOGLE_TOKEN_ENCRYPTION_KEY) return null;
  const stored = JSON.parse(value);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(stored.iv) }, await googleEncryptionKey(env), base64ToBytes(stored.data));
  return new TextDecoder().decode(decrypted);
}

async function googleAccessToken(env) {
  const encrypted = await env.GOOGLE_OAUTH_STORE.get(`refresh:${env.OWNER_USER_ID}`);
  const refreshToken = await decryptGoogleToken(encrypted, env);
  if (!refreshToken) return null;
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error("Google no aceptó la renovación de sesión.");
  const result = await response.json();
  return result.access_token || null;
}

async function googleQuota(env) {
  const accessToken = await googleAccessToken(env);
  if (!accessToken) return null;
  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage,usageInDrive)", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("No se pudo consultar el espacio de Google Drive.");
  return (await response.json()).storageQuota || null;
}

function googleFileId(path) {
  if (typeof path !== "string" || !path.startsWith("gdrive://")) return null;
  const id = path.slice("gdrive://".length);
  return /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : null;
}

async function findGoogleFileRecord(id, env, session = null) {
  const path = `gdrive://${id}`;
  const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=file_name,storage_path&storage_path=eq.${encodeURIComponent(path)}&limit=1`;
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY };
  if (session?.authorization) headers.Authorization = session.authorization;
  const response = await fetch(query, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

async function findMediaFileByPath(path, env, session = null) {
  const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=id,storage_path,file_name,created_by,is_private,allowed_user_ids,folder&storage_path=eq.${encodeURIComponent(path)}&limit=1`;
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY };
  if (session?.authorization) headers.Authorization = session.authorization;
  const response = await fetch(query, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

async function canReadWallpaper(path, session, env) {
  if (!session) return false;
  const query = `${env.SUPABASE_URL}/rest/v1/media_preferences?select=background_image_path&user_id=eq.${encodeURIComponent(session.user.id)}&background_image_path=eq.${encodeURIComponent(path)}&limit=1`;
  const response = await fetch(query, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
  if (!response.ok) return false;
  return (await response.json()).length > 0;
}

async function serveObject(object, filename = "", disposition = "attachment") {
  if (!object) return json({ error: "Archivo no encontrado." }, 404);
  const headers = new Headers();
  if (object.httpMetadata?.contentType) headers.set("Content-Type", object.httpMetadata.contentType);
  else headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", "private, max-age=60");
  if (filename) headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(object.body, { headers });
}

async function migrate(files, env) {
  if (!Array.isArray(files) || files.length > 100) return { status: 400, body: { error: "Lista de migración inválida." } };
  const results = [];
  for (const item of files) {
    const path = typeof item?.path === "string" ? item.path : "";
    const expectedSize = Number(item?.size);
    if (!path || !Number.isFinite(expectedSize) || expectedSize < 0) {
      results.push({ path, ok: false, error: "Datos de archivo inválidos." });
      continue;
    }
    const existing = await env.MEDIA_BUCKET.head(path);
    if (existing && existing.size === expectedSize) {
      results.push({ path, ok: true, copied: false, size: existing.size });
      continue;
    }
    const sourceUrl = `${env.SUPABASE_URL}/storage/v1/object/games/${encodePath(path)}`;
    const source = await fetch(sourceUrl, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY } });
    if (!source.ok || !source.body) {
      results.push({ path, ok: false, error: `El archivo de origen respondió ${source.status}.` });
      continue;
    }
    const contentType = source.headers.get("Content-Type") || "application/octet-stream";
    await env.MEDIA_BUCKET.put(path, source.body, { httpMetadata: { contentType } });
    const verified = await env.MEDIA_BUCKET.head(path);
    if (!verified || verified.size !== expectedSize) {
      results.push({ path, ok: false, error: "La verificación de tamaño no coincidió." });
      continue;
    }
    results.push({ path, ok: true, copied: true, size: verified.size });
  }
  return { status: 200, body: { results, copied: results.filter(item => item.ok && item.copied).length, verified: results.filter(item => item.ok).length } };
}

async function getMediaFile(id, session, env) {
  const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=id,storage_path,file_name,size_bytes,created_by&id=eq.${encodeURIComponent(id)}&limit=1`;
  const response = await fetch(query, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
  if (!response.ok) throw new Error("No se pudo consultar el archivo en la biblioteca.");
  const rows = await response.json();
  return rows[0] || null;
}

async function updateMediaFile(session, env, id, storagePath) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/media_files?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ storage_path: storagePath, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("La copia terminó, pero la biblioteca no permitió actualizar el archivo.");
  const rows = await response.json();
  if (!rows.length) throw new Error("La biblioteca no confirmó el cambio de almacenamiento.");
}

async function saveTransfer(env, id, state) {
  state.updatedAt = Date.now();
  try { await env.GOOGLE_OAUTH_STORE.put(`transfer:${id}`, JSON.stringify(state), { expirationTtl: 24 * 60 * 60 }); }
  catch (error) { console.error("Transfer progress could not be saved", error instanceof Error ? error.message : "unknown error"); }
}

async function startGoogleTransfer(id, record, session, env) {
  const size = Number(record.size_bytes);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("El tamaño del archivo no es válido para transferirlo.");
  const source = await env.MEDIA_BUCKET.head(record.storage_path);
  if (!source || source.size !== size) throw new Error("El archivo de origen no está en Cloudflare R2 o su tamaño cambió.");
  const accessToken = await googleAccessToken(env);
  if (!accessToken) throw new Error("Google Drive todavía no está conectado.");
  const contentType = source.httpMetadata?.contentType || "application/octet-stream";
  const initiation = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": contentType, "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ name: record.file_name, mimeType: contentType }),
  });
  const uploadUrl = initiation.headers.get("Location");
  if (!initiation.ok || !uploadUrl) throw new Error("Google Drive no pudo preparar la transferencia.");
  const state = { userId: session.user.id, fileId: record.id, fileName: record.file_name, size, done: 0, status: "running", phase: "Transfiriendo de Cloudflare R2 a Google Drive", target: "google", source: "r2", sourcePath: record.storage_path, uploadUrl, contentType };
  await saveTransfer(env, id, state);
  return state;
}

async function advanceGoogleTransfer(id, state, session, env) {
  if (!state || state.status !== "running" || state.target !== "google" || !state.uploadUrl) throw new Error("La transferencia no está activa.");
  const accessToken = await googleAccessToken(env);
  if (!accessToken) throw new Error("Google Drive todavía no está conectado.");
  const start = Number(state.done || 0);
  if (start >= state.size) throw new Error("Google Drive no confirmó la transferencia completa.");
  const length = Math.min(8 * 1024 * 1024, state.size - start);
  const source = await env.MEDIA_BUCKET.get(state.sourcePath, { range: { offset: start, length } });
  if (!source?.body || source.size !== state.size) throw new Error("No se pudo leer el siguiente fragmento desde Cloudflare R2.");
  const end = start + length - 1;
  const chunk = await new Response(source.body).arrayBuffer();
  if (chunk.byteLength !== length) throw new Error("El fragmento leído desde Cloudflare R2 está incompleto.");
  let uploadedResponse;
  try {
    uploadedResponse = await fetch(state.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": state.contentType, "Content-Length": String(length), "Content-Range": `bytes ${start}-${end}/${state.size}` }, body: chunk });
  } catch (error) {
    throw new Error(`La conexión se interrumpió durante el fragmento ${formatTransferOffset(start)}. Podés reintentar; Google verificará los bytes recibidos.`);
  }
  if (uploadedResponse.status === 308) {
    const range = uploadedResponse.headers.get("Range");
    const lastByte = range?.match(/bytes=0-(\d+)/)?.[1];
    state.done = lastByte ? Math.min(state.size, Number(lastByte) + 1) : 0;
    state.phase = "Transfiriendo de Cloudflare R2 a Google Drive";
    await saveTransfer(env, id, state);
    return state;
  }
  if (uploadedResponse.status === 200 || uploadedResponse.status === 201) {
    const uploaded = await uploadedResponse.json().catch(() => ({}));
    if (!uploaded.id || (uploaded.size != null && Number(uploaded.size) !== state.size)) throw new Error("Google Drive no confirmó una copia completa del archivo.");
    state.phase = "Actualizando la biblioteca"; await saveTransfer(env, id, state);
    try { await updateMediaFile(session, env, state.fileId, `gdrive://${uploaded.id}`); }
    catch (error) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
      throw error;
    }
    state.phase = "Quitando el original de Cloudflare R2"; await saveTransfer(env, id, state);
    let sourceRemoved = true;
    try { await env.MEDIA_BUCKET.delete(state.sourcePath); } catch { sourceRemoved = false; }
    state.status = "complete"; state.done = state.size; state.sourceRemoved = sourceRemoved;
    state.message = sourceRemoved ? "Archivo transferido a Google Drive." : "La copia está en Google Drive; el original de R2 quedó conservado.";
    delete state.uploadUrl; delete state.sourcePath; delete state.contentType;
    await saveTransfer(env, id, state);
    return state;
  }
  const body = await uploadedResponse.json().catch(() => ({}));
  if (uploadedResponse.status >= 500 || uploadedResponse.status === 429) throw new Error(`Google Drive respondió ${uploadedResponse.status}; podés reintentar el fragmento.`);
  throw new Error(body.error?.message || `Google Drive devolvió ${uploadedResponse.status} durante la transferencia.`);
}

function formatTransferOffset(value) { return `${Math.floor(value / (1024 * 1024))} MB`; }

function publicTransferState(state) {
  return { fileName: state.fileName, size: state.size, done: state.done, status: state.status, phase: state.phase, error: state.error || null, message: state.message || null, sourceRemoved: state.sourceRemoved };
}

function trackTransferStream(stream, env, id, state) {
  let done = 0, lastSavedBytes = 0, lastSavedAt = Date.now();
  const persist = async force => {
    const now = Date.now();
    if (!force && done - lastSavedBytes < 8 * 1024 * 1024 && now - lastSavedAt < 1000) return;
    state.done = done; state.updatedAt = now; lastSavedBytes = done; lastSavedAt = now;
    await saveTransfer(env, id, state);
  };
  return stream.pipeThrough(new TransformStream({
    async transform(chunk, controller) { done += chunk.byteLength; controller.enqueue(chunk); await persist(false); },
    async flush() { state.done = done; await persist(true); },
  }));
}

async function runStorageTransfer(id, record, target, session, env) {
  const sourcePath = record.storage_path;
  const sourceIsGoogle = sourcePath.startsWith("gdrive://");
  const size = Number(record.size_bytes);
  const state = { userId: session.user.id, fileId: record.id, fileName: record.file_name, size, done: 0, status: "running", phase: "Preparando transferencia", target, source: sourceIsGoogle ? "google" : "r2" };
  let createdGoogleId = null, createdR2Path = null;
  await saveTransfer(env, id, state);
  try {
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("El tamaño del archivo no es válido para transferirlo.");
    if (target === "google") {
      if (sourceIsGoogle) throw new Error("El archivo ya está en Google Drive.");
      const source = await env.MEDIA_BUCKET.get(sourcePath);
      if (!source || source.size !== size) throw new Error("El archivo de origen no está en Cloudflare R2 o su tamaño cambió.");
      const accessToken = await googleAccessToken(env);
      if (!accessToken) throw new Error("Google Drive todavía no está conectado.");
      const contentType = source.httpMetadata?.contentType || "application/octet-stream";
      const initiation = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": contentType, "X-Upload-Content-Length": String(size) },
        body: JSON.stringify({ name: record.file_name, mimeType: contentType }),
      });
      const uploadUrl = initiation.headers.get("Location");
      if (!initiation.ok || !uploadUrl) throw new Error("Google Drive no pudo preparar la transferencia.");
      state.phase = "Transfiriendo de Cloudflare R2 a Google Drive"; await saveTransfer(env, id, state);
      const upload = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType, "Content-Length": String(size), "Content-Range": `bytes 0-${Math.max(0, size - 1)}/${size}` }, body: trackTransferStream(source.body, env, id, state) });
      const uploaded = await upload.json().catch(() => ({}));
      if ((upload.status !== 200 && upload.status !== 201) || !uploaded.id) throw new Error(uploaded.error?.message || `Google Drive devolvió ${upload.status} durante la transferencia.`);
      createdGoogleId = uploaded.id;
      if (uploaded.size != null && Number(uploaded.size) !== size) throw new Error("El tamaño de la copia en Google Drive no coincide con el original.");
      state.phase = "Actualizando la biblioteca"; await saveTransfer(env, id, state);
      await updateMediaFile(session, env, record.id, `gdrive://${uploaded.id}`);
      state.phase = "Quitando el original de Cloudflare R2"; await saveTransfer(env, id, state);
      let sourceRemoved = true;
      try { await env.MEDIA_BUCKET.delete(sourcePath); } catch { sourceRemoved = false; }
      state.status = "complete"; state.done = size; state.sourceRemoved = sourceRemoved;
      state.message = sourceRemoved ? "Archivo transferido a Google Drive." : "La copia está en Google Drive; el original de R2 quedó conservado.";
    } else if (target === "r2") {
      if (!sourceIsGoogle) throw new Error("El archivo ya está en Cloudflare R2.");
      const googleId = sourcePath.slice("gdrive://".length);
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(googleId)) throw new Error("El identificador de Google Drive no es válido.");
      const accessToken = await googleAccessToken(env);
      if (!accessToken) throw new Error("Google Drive todavía no está conectado.");
      state.phase = "Descargando desde Google Drive"; await saveTransfer(env, id, state);
      const source = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(googleId)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!source.ok || !source.body) throw new Error("Google Drive no pudo entregar el archivo para transferirlo.");
      const contentType = source.headers.get("Content-Type") || "application/octet-stream";
      const safeName = String(record.file_name || "archivo").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
      createdR2Path = `${session.user.id}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
      state.phase = "Guardando en Cloudflare R2"; await saveTransfer(env, id, state);
      const copied = await env.MEDIA_BUCKET.put(createdR2Path, trackTransferStream(source.body, env, id, state), { httpMetadata: { contentType } });
      if (!copied || copied.size !== size) throw new Error("El tamaño de la copia en Cloudflare R2 no coincide con el original.");
      state.phase = "Actualizando la biblioteca"; await saveTransfer(env, id, state);
      await updateMediaFile(session, env, record.id, createdR2Path);
      createdR2Path = null;
      state.phase = "Quitando el original de Google Drive"; await saveTransfer(env, id, state);
      let sourceRemoved = true;
      try {
        const deleted = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(googleId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
        if (!deleted.ok && deleted.status !== 404) sourceRemoved = false;
      } catch { sourceRemoved = false; }
      state.status = "complete"; state.done = size; state.sourceRemoved = sourceRemoved;
      state.message = sourceRemoved ? "Archivo transferido a Cloudflare R2." : "La copia está en Cloudflare R2; el original de Google Drive quedó conservado.";
    } else throw new Error("El destino de almacenamiento no es válido.");
  } catch (error) {
    if (createdGoogleId) {
      const token = await googleAccessToken(env).catch(() => null);
      if (token) await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(createdGoogleId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    if (createdR2Path) await env.MEDIA_BUCKET.delete(createdR2Path).catch(() => {});
    state.status = "error"; state.phase = "Transferencia interrumpida"; state.error = error instanceof Error ? error.message : "No se pudo completar la transferencia.";
  }
  await saveTransfer(env, id, state);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, storage: Boolean(env.MEDIA_BUCKET), configured: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.OWNER_USER_ID && env.SHARE_SIGNING_SECRET), googleConfigured: Boolean(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_ENCRYPTION_KEY && env.GOOGLE_OAUTH_STORE) });
      }

      if (url.pathname === "/google/connect" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "La sesión venció. Volvé a iniciar sesión y conectá Drive de nuevo." }, 401);
        if (!await isOwner(session, env)) return json({ error: "Solo el dueño puede conectar Google Drive." }, 403);
        if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_TOKEN_ENCRYPTION_KEY || !env.GOOGLE_OAUTH_STORE) return json({ error: "Falta configurar el almacenamiento seguro de Google Drive." }, 503);
        const stateBytes = crypto.getRandomValues(new Uint8Array(32));
        const state = bytesToBase64(stateBytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        await env.GOOGLE_OAUTH_STORE.put(`state:${state}`, session.user.id, { expirationTtl: 600 });
        const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorize.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: "code", scope: GOOGLE_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
        return json({ url: authorize.toString() });
      }

      if (url.pathname === "/google/callback" && request.method === "GET") {
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        if (url.searchParams.has("error")) return new Response("La autorización de Google fue cancelada. Podés cerrar esta ventana.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        if (!/^[A-Za-z0-9_-]{40,60}$/.test(state) || !code) return new Response("No se pudo validar la autorización. Volvé a intentarlo desde MediaChafa.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        const ownerId = await env.GOOGLE_OAUTH_STORE.get(`state:${state}`);
        await env.GOOGLE_OAUTH_STORE.delete(`state:${state}`);
        if (!ownerId || ownerId !== env.OWNER_USER_ID) return new Response("El inicio de sesión expiró. Volvé a intentarlo desde MediaChafa.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: "authorization_code" }) });
        const tokens = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokens.access_token) return new Response("Google no pudo completar la conexión. Volvé a intentarlo desde MediaChafa.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        const existing = await env.GOOGLE_OAUTH_STORE.get(`refresh:${ownerId}`);
        if (tokens.refresh_token) await env.GOOGLE_OAUTH_STORE.put(`refresh:${ownerId}`, await encryptGoogleToken(tokens.refresh_token, env));
        else if (!existing) return new Response("Google no entregó un permiso persistente. Revocá la conexión de MediaChafa en tu cuenta de Google y volvé a conectar.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        return Response.redirect("https://mediachafa-transfer.vercel.app/?drive=connected", 302);
      }

      if (url.pathname === "/google/status" && request.method === "GET") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "La sesión venció. Volvé a iniciar sesión." }, 401);
        if (!await isOwner(session, env) && !await isRegisteredCollaborator(session, env)) return json({ error: "No tenés permiso para usar el Drive compartido." }, 403);
        const connected = Boolean(await env.GOOGLE_OAUTH_STORE?.get(`refresh:${env.OWNER_USER_ID}`));
        if (!connected) return json({ configured: Boolean(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_STORE), connected: false });
        // Collaborators use the owner's connected Drive, so expose its quota to
        // them as well. The quota describes the shared Google account pool.
        return json({ configured: true, connected: true, quota: await googleQuota(env) });
      }

      if (url.pathname === "/transfer" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "La sesión venció. Volvé a iniciar sesión para transferir." }, 401);
        if (!await canTransfer(session, env)) return json({ error: "Solo el dueño y los colaboradores habilitados pueden transferir archivos." }, 403);
        if (!await env.GOOGLE_OAUTH_STORE?.get(`refresh:${env.OWNER_USER_ID}`)) return json({ error: "Conectá Google Drive antes de transferir archivos." }, 409);
        const input = await request.json().catch(() => ({}));
        const fileId = typeof input.fileId === "string" ? input.fileId : "";
        const target = input.target;
        const requestId = typeof input.requestId === "string" && /^[0-9a-f-]{36}$/i.test(input.requestId) ? input.requestId : null;
        if (!fileId || fileId.length > 100 || !["google", "r2"].includes(target)) return json({ error: "Archivo o destino inválido." }, 400);
        const requestKey = requestId ? `transfer-start:${session.user.id}:${requestId}` : null;
        if (requestKey) {
          const priorId = await env.GOOGLE_OAUTH_STORE.get(requestKey);
          if (priorId) return json({ transferId: priorId, status: "running" }, 202);
        }
        const record = await getMediaFile(fileId, session, env);
        if (!record) return json({ error: "El archivo no existe en la biblioteca." }, 404);
        const source = String(record.storage_path || "").startsWith("gdrive://") ? "google" : "r2";
        if (source === target) return json({ error: "El archivo ya está guardado en ese servicio." }, 409);
        const transferId = crypto.randomUUID();
        if (target === "google") {
          await startGoogleTransfer(transferId, record, session, env);
          if (requestKey) await env.GOOGLE_OAUTH_STORE.put(requestKey, transferId, { expirationTtl: 24 * 60 * 60 });
          return json({ transferId, status: "running" }, 202);
        }
        const initial = { userId: session.user.id, fileId, fileName: record.file_name, size: Number(record.size_bytes), done: 0, status: "running", phase: "Preparando transferencia", source, target };
        await saveTransfer(env, transferId, initial);
        ctx.waitUntil(runStorageTransfer(transferId, record, target, session, env));
        return json({ transferId, status: "running" }, 202);
      }

      if (url.pathname === "/transfer/step" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "La sesión venció. Volvé a iniciar sesión para transferir." }, 401);
        if (!await canTransfer(session, env)) return json({ error: "No tenés permiso para transferir archivos." }, 403);
        const id = url.searchParams.get("id") || "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Transferencia inválida." }, 400);
        const state = await env.GOOGLE_OAUTH_STORE.get(`transfer:${id}`, "json");
        if (!state || state.userId !== session.user.id) return json({ error: "Transferencia no encontrada." }, 404);
        try {
          await advanceGoogleTransfer(id, state, session, env);
          return json({ transferId: id, ...publicTransferState(state) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "No se pudo avanzar la transferencia.";
          const retryable = /conexión se interrumpió|podés reintentar|NetworkError|fetch failed/i.test(message);
          if (!retryable) { state.status = "error"; state.phase = "Transferencia interrumpida"; state.error = message; delete state.uploadUrl; delete state.sourcePath; delete state.contentType; await saveTransfer(env, id, state); }
          return json({ transferId: id, ...publicTransferState(state), retryable }, retryable ? 503 : 502);
        }
      }

      if (url.pathname === "/transfer/status" && request.method === "GET") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "La sesión venció. Volvé a iniciar sesión para consultar la transferencia." }, 401);
        if (!await canTransfer(session, env)) return json({ error: "No tenés permiso para consultar estas transferencias." }, 403);
        const id = url.searchParams.get("id") || "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Transferencia inválida." }, 400);
        const state = await env.GOOGLE_OAUTH_STORE.get(`transfer:${id}`, "json");
        if (!state || state.userId !== session.user.id) return json({ error: "Transferencia no encontrada." }, 404);
        return json({ transferId: id, ...publicTransferState(state) });
      }

      if (url.pathname === "/google/upload-session" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const name = typeof input.name === "string" ? input.name.trim().slice(0, 240) : "";
        const size = Number(input.size);
        const contentType = typeof input.contentType === "string" ? input.contentType.slice(0, 160) : "application/octet-stream";
        if (!name || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return json({ error: "Nombre o tamaño de archivo inválido." }, 400);
        const accessToken = await googleAccessToken(env);
        if (!accessToken) return json({ error: "Google Drive todavía no está conectado por el dueño." }, 409);
        const quota=await googleQuota(env);
        if(quota?.limit&&Number(quota.limit)-Number(quota.usage||0)<size) return json({error:"El archivo supera el espacio disponible en Google Drive."},413);
        const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": contentType, "X-Upload-Content-Length": String(size) }, body: JSON.stringify({ name, mimeType: contentType }) });
        if (!response.ok || !response.headers.get("Location")) return json({ error: "Google Drive no pudo iniciar la subida." }, 502);
        const uploadId = crypto.randomUUID();
        const uploadState = JSON.stringify({ url: response.headers.get("Location"), userId: session.user.id, size, contentType });
        await env.GOOGLE_OAUTH_STORE.put(`upload:${uploadId}`, await encryptGoogleToken(uploadState, env), { expirationTtl: 7 * 24 * 60 * 60 });
        return json({ uploadId, partSize: 8 * 1024 * 1024, expiresIn: 7 * 24 * 60 * 60 });
      }

      if (url.pathname === "/google/upload-part" && request.method === "PUT") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const uploadId = url.searchParams.get("id") || "";
        const probe=url.searchParams.get("probe")==="1";
        const start = Number(url.searchParams.get("start")), end = Number(url.searchParams.get("end")), total = Number(url.searchParams.get("total"));
        if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isSafeInteger(total) || total<=0 || (!probe&&(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= total || end - start + 1 > 8 * 1024 * 1024))) return json({ error: "Parte de subida inválida." }, 400);
        const rawState = await env.GOOGLE_OAUTH_STORE.get(`upload:${uploadId}`);
        if (!rawState) return json({ error: "La sesión de subida expiró. Iniciá la subida nuevamente." }, 410);
        const state = JSON.parse(await decryptGoogleToken(rawState, env));
        if (state.userId !== session.user.id || state.size !== total) return json({ error: "La sesión de subida no pertenece a este usuario o archivo." }, 403);
        const accessToken = await googleAccessToken(env);
        if (!accessToken) return json({ error: "Google Drive todavía no está conectado por el dueño." }, 409);
        const bytes = probe ? new ArrayBuffer(0) : await request.arrayBuffer();
        if (!probe&&bytes.byteLength !== end - start + 1) return json({ error: "El tamaño de la parte no coincide." }, 400);
        const response = await fetch(state.url, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": state.contentType, "Content-Range": probe?`bytes */${total}`:`bytes ${start}-${end}/${total}` }, body: bytes });
        if (response.status === 308) {
          const last=response.headers.get("Range")?.match(/bytes=0-(\d+)/)?.[1];
          return json({ ok:true, complete:false, next:last?Number(last)+1:0 });
        }
        if (response.status !== 200 && response.status !== 201) {
          const failure = await response.json().catch(() => ({}));
          return json({ error: failure.error?.message || `Google Drive devolvió ${response.status}.`, retryable:response.status>=500||response.status===429 }, response.status>=500||response.status===429?503:502);
        }
        await env.GOOGLE_OAUTH_STORE.delete(`upload:${uploadId}`);
        const file = await response.json().catch(() => ({}));
        if (!file.id) return json({ error: "Google Drive finalizó, pero no devolvió el identificador del archivo." }, 502);
        return json({ ok: true, complete: true, file });
      }

      if (url.pathname === "/google/sign" && request.method === "POST") {
        if (!env.SHARE_SIGNING_SECRET) return json({ error: "El servicio de enlaces no está configurado." }, 503);
        const input = await request.json().catch(() => ({}));
        const id = googleFileId(input.path);
        if (!id || !await findGoogleFileRecord(id, env)) return json({ error: "Archivo no encontrado." }, 404);
        const expires = Math.floor(Date.now() / 1000) + SHARE_TTL_SECONDS;
        const preview = input.preview === true;
        const signature = await sign(env.SHARE_SIGNING_SECRET, `gdrive:${id}\n${expires}\n${preview ? "inline" : "attachment"}`);
        const shareUrl = new URL(`/google/download/${encodeURIComponent(id)}`, url.origin);
        shareUrl.searchParams.set("expires", String(expires));
        shareUrl.searchParams.set("signature", signature);
        if (preview) shareUrl.searchParams.set("preview", "1");
        return json({ url: shareUrl.toString(), expiresAt: new Date(expires * 1000).toISOString(), expiresIn: SHARE_TTL_SECONDS });
      }

      if (url.pathname.startsWith("/google/download/") && request.method === "GET") {
        const id = decodeURIComponent(url.pathname.slice("/google/download/".length));
        const expires = Number(url.searchParams.get("expires"));
        const preview = url.searchParams.get("preview") === "1";
        const mode = preview ? "inline" : "attachment";
        const suppliedSignature = url.searchParams.get("signature") || "";
        const now = Math.floor(Date.now() / 1000);
        if (!googleFileId(`gdrive://${id}`) || !Number.isInteger(expires) || expires <= now || expires > now + SHARE_TTL_SECONDS + 60) return json({ error: "Este enlace venció o no es válido." }, 410);
        if (!safeEqual(await sign(env.SHARE_SIGNING_SECRET, `gdrive:${id}\n${expires}\n${mode}`), suppliedSignature)) return json({ error: "Este enlace no es válido." }, 403);
        const record = await findGoogleFileRecord(id, env);
        if (!record) return json({ error: "Archivo no encontrado." }, 404);
        const accessToken = await googleAccessToken(env);
        if (!accessToken) return json({ error: "Google Drive no está conectado." }, 503);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok || !response.body) return json({ error: "Google Drive no pudo entregar el archivo." }, 502);
        const headers = new Headers({ "Content-Type": response.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": `${mode}; filename*=UTF-8''${encodeURIComponent(record.file_name || "archivo")}` });
        for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
        return new Response(response.body, { headers });
      }

      if (url.pathname.startsWith("/google/delete/") && request.method === "DELETE") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "Iniciá sesión para eliminar archivos." }, 401);
        const id = decodeURIComponent(url.pathname.slice("/google/delete/".length));
        if (!googleFileId(`gdrive://${id}`)) return json({ error: "Archivo inválido." }, 400);
        const path = `gdrive://${id}`;
        const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=id,created_by&storage_path=eq.${encodeURIComponent(path)}&limit=1`;
        const recordResponse = await fetch(query, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
        if (!recordResponse.ok) return json({ error: "No se pudo verificar quién subió este archivo." }, 502);
        const rows = await recordResponse.json();
        const owner = await isOwner(session, env);
        if (!rows.length) return json({ error: "El archivo no existe en la biblioteca." }, 404);
        if (!owner && rows[0].created_by !== session.user.id) return json({ error: "Solo podés borrar los archivos que subiste." }, 403);
        const accessToken = await googleAccessToken(env);
        if (!accessToken) return json({ error: "Google Drive no está conectado." }, 503);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok && response.status !== 404) return json({ error: "No se pudo eliminar en Google Drive." }, 502);
        return json({ ok: true });
      }

      if (url.pathname === "/sign" && request.method === "POST") {
        if (!env.SHARE_SIGNING_SECRET) return json({ error: "El servicio de enlaces no está configurado." }, 503);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        if (!path || path.length > 1024 || path.split("/").some(part => part === "..")) return json({ error: "Archivo inválido." }, 400);
        if (!await findMediaFileByPath(path, env)) return json({ error: "Solo se pueden compartir archivos públicos." }, 403);
        if (!await env.MEDIA_BUCKET.head(path)) return json({ error: "Archivo no encontrado en R2." }, 404);
        const expires = Math.floor(Date.now() / 1000) + SHARE_TTL_SECONDS;
        const signature = await sign(env.SHARE_SIGNING_SECRET, `${path}\n${expires}`);
        const shareUrl = new URL("/share/" + encodePath(path), url.origin);
        shareUrl.searchParams.set("expires", String(expires));
        shareUrl.searchParams.set("signature", signature);
        return json({ url: shareUrl.toString(), expiresAt: new Date(expires * 1000).toISOString(), expiresIn: SHARE_TTL_SECONDS });
      }

      if (url.pathname.startsWith("/share/") && request.method === "GET") {
        if (!env.SHARE_SIGNING_SECRET) return json({ error: "El servicio de enlaces no está configurado." }, 503);
        const path = objectKey(url.pathname, "/share/");
        const expires = Number(url.searchParams.get("expires"));
        const suppliedSignature = url.searchParams.get("signature") || "";
        const now = Math.floor(Date.now() / 1000);
        if (!path || !Number.isInteger(expires) || expires <= now || expires > now + SHARE_TTL_SECONDS + 60) return json({ error: "Este enlace venció o no es válido." }, 410);
        const expected = await sign(env.SHARE_SIGNING_SECRET, `${path}\n${expires}`);
        if (!safeEqual(expected, suppliedSignature)) return json({ error: "Este enlace no es válido." }, 403);
        if (!await findMediaFileByPath(path, env)) return json({ error: "El archivo ya no es público o no existe." }, 404);
        const object = await env.MEDIA_BUCKET.get(path);
        return withCors(await serveObject(object, path.split("/").pop()));
      }

      if (url.pathname.startsWith("/object/") && request.method === "GET") {
        const path = objectKey(url.pathname, "/object/");
        if (!path) return json({ error: "Archivo inválido." }, 400);
        const session = await getUser(request, env);
        const fileRecord = await findMediaFileByPath(path, env, session);
        if (!fileRecord && !await canReadWallpaper(path, session, env)) return json({ error: "Archivo no encontrado o no tenés permiso para verlo." }, 404);
        const object = await env.MEDIA_BUCKET.get(path);
        const mode = url.searchParams.get("preview") === "1" ? "inline" : "attachment";
        return withCors(await serveObject(object, path.split("/").pop(), mode));
      }

      if (url.pathname.startsWith("/google/private/") && request.method === "GET") {
        const session = await getUser(request, env);
        if (!session) return json({ error: "Iniciá sesión para ver este archivo privado." }, 401);
        const id = decodeURIComponent(url.pathname.slice("/google/private/".length));
        if (!googleFileId(`gdrive://${id}`)) return json({ error: "Archivo inválido." }, 400);
        const record = await findGoogleFileRecord(id, env, session);
        if (!record) return json({ error: "Archivo no encontrado o no tenés permiso para verlo." }, 404);
        const accessToken = await googleAccessToken(env);
        if (!accessToken) return json({ error: "Google Drive no está conectado." }, 503);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok || !response.body) return json({ error: "Google Drive no pudo entregar el archivo." }, 502);
        const preview = url.searchParams.get("preview") === "1";
        const headers = new Headers({
          "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.file_name || "archivo")}`
        });
        const length = response.headers.get("Content-Length");
        if (length) headers.set("Content-Length", length);
        for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
        return new Response(response.body, { headers });
      }

      if (url.pathname === "/migrate" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await isOwner(session, env)) return json({ error: "Solo el dueño puede migrar archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const result = await migrate(input.files, env);
        return json(result.body, result.status);
      }

      if (url.pathname.startsWith("/object/") && request.method === "PUT") {
        const path = objectKey(url.pathname, "/object/");
        if (!path) return json({ error: "Archivo inválido." }, 400);
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        if (session.user.id !== env.OWNER_USER_ID && !path.startsWith(`${session.user.id}/`)) return json({ error: "Ruta de archivo no autorizada." }, 403);
        const size = Number(request.headers.get("Content-Length") || 0);
        if (size > MAX_UPLOAD_BYTES) return json({ error: "El máximo por archivo es 10 GB." }, 413);
        if (size > 100 * 1024 * 1024) return json({ error: "Para archivos mayores a 100 MB usá carga multipart." }, 413);
        if (!request.body) return json({ error: "El archivo está vacío." }, 400);
        const contentType = request.headers.get("Content-Type") || "application/octet-stream";
        const object = await env.MEDIA_BUCKET.put(path, request.body, { httpMetadata: { contentType } });
        return json({ ok: true, path, etag: object.etag });
      }

      if (url.pathname === "/multipart/create" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        const size = Number(input.size);
        const contentType = typeof input.contentType === "string" ? input.contentType : "application/octet-stream";
        if (!path || path.length > 1024 || path.split("/").some(part => part === "..")) return json({ error: "Ruta inválida." }, 400);
        if (session.user.id !== env.OWNER_USER_ID && !path.startsWith(`${session.user.id}/`)) return json({ error: "Ruta de archivo no autorizada." }, 403);
        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return json({ error: "El máximo por archivo es 10 GB." }, 413);
        const partSize = 8 * 1024 * 1024;
        const upload = await env.MEDIA_BUCKET.createMultipartUpload(path, { httpMetadata: { contentType } });
        try {
          if (!env.GOOGLE_OAUTH_STORE) throw new Error("No hay almacenamiento temporal configurado.");
          await env.GOOGLE_OAUTH_STORE.put(`r2-upload:${upload.uploadId}`, JSON.stringify({ userId: session.user.id, path, size, partSize }), { expirationTtl: 7 * 24 * 60 * 60 });
        } catch {
          await upload.abort().catch(() => {});
          return json({ error: "No se pudo reservar la carga. Volvé a intentarlo." }, 503);
        }
        return json({ ok: true, path, uploadId: upload.uploadId, partSize });
      }

      if (url.pathname === "/multipart/part" && request.method === "PUT") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const path = url.searchParams.get("path") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!path || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ error: "Parte inválida." }, 400);
        const metadata = await env.GOOGLE_OAUTH_STORE?.get(`r2-upload:${uploadId}`, "json");
        if (!metadata || metadata.userId !== session.user.id || metadata.path !== path) return json({ error: "La carga no existe o no te pertenece." }, 403);
        const expectedParts = Math.ceil(metadata.size / metadata.partSize);
        const expectedSize = partNumber === expectedParts ? metadata.size - metadata.partSize * (expectedParts - 1) : metadata.partSize;
        if (partNumber > expectedParts || !request.body) return json({ error: "Parte inválida." }, 400);
        const upload = env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength !== expectedSize) return json({ error: `La parte ${partNumber} llegó incompleta; reintentá subirla.` }, 400);
        const part = await upload.uploadPart(partNumber, bytes);
        return json({ ok: true, partNumber, etag: part.etag });
      }

      if (url.pathname === "/multipart/complete" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        const uploadId = typeof input.uploadId === "string" ? input.uploadId : "";
        const parts = Array.isArray(input.parts) ? input.parts : [];
        if (!path || !uploadId || !parts.length || parts.length > 10000) return json({ error: "Datos de finalización inválidos." }, 400);
        const metadata = await env.GOOGLE_OAUTH_STORE?.get(`r2-upload:${uploadId}`, "json");
        if (!metadata || metadata.userId !== session.user.id || metadata.path !== path) return json({ error: "La carga no existe o no te pertenece." }, 403);
        const expectedParts = Math.ceil(metadata.size / metadata.partSize);
        if (parts.length !== expectedParts || parts.some((part, index) => Number(part.partNumber) !== index + 1 || typeof part.etag !== "string" || !part.etag)) return json({ error: "Faltan partes o están desordenadas. Volvé a subir el archivo." }, 400);
        const upload = env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId);
        const object = await upload.complete(parts.map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag) })));
        await env.GOOGLE_OAUTH_STORE.delete(`r2-upload:${uploadId}`);
        if (object.size !== metadata.size) {
          await env.MEDIA_BUCKET.delete(path);
          return json({ error: "La verificación del tamaño no coincidió. Volvé a subir el archivo." }, 502);
        }
        return json({ ok: true, path, etag: object.etag, size: object.size });
      }

      if (url.pathname === "/multipart/abort" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        const uploadId = typeof input.uploadId === "string" ? input.uploadId : "";
        if (!path || !uploadId) return json({ error: "Datos de cancelación inválidos." }, 400);
        const metadata = await env.GOOGLE_OAUTH_STORE?.get(`r2-upload:${uploadId}`, "json");
        if (!metadata || metadata.userId !== session.user.id || metadata.path !== path) return json({ error: "La carga no existe o no te pertenece." }, 403);
        await env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId).abort();
        await env.GOOGLE_OAUTH_STORE.delete(`r2-upload:${uploadId}`);
        return json({ ok: true });
      }

      if (url.pathname.startsWith("/object/") && request.method === "DELETE") {
        const path = objectKey(url.pathname, "/object/");
        if (!path) return json({ error: "Archivo inválido." }, 400);
        const session = await getUser(request, env);
        if (!session) return json({ error: "Iniciá sesión para eliminar archivos." }, 401);
        const owner = await isOwner(session, env);
        if (!owner) {
          const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=id,created_by&storage_path=eq.${encodeURIComponent(path)}&limit=1`;
          const record = await fetch(query, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
          if (!record.ok) return json({ error: "No se pudo verificar quién subió este archivo." }, 502);
          const rows = await record.json();
          if (!rows.length || rows[0].created_by !== session.user.id || !path.startsWith(`${session.user.id}/`)) return json({ error: "Solo podés borrar los archivos que subiste." }, 403);
        }
        if (!await env.MEDIA_BUCKET.head(path)) return json({ error: "Archivo no encontrado en R2." }, 404);
        await env.MEDIA_BUCKET.delete(path);
        return json({ ok: true });
      }

      return json({ error: "Ruta no encontrada." }, 404);
    } catch (error) {
      console.error("MediaChafa R2 request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "No se pudo completar la operación de almacenamiento." }, 500);
    }
  },
};

