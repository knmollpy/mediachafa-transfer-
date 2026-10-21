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

async function isOwner(session, env) {
  return Boolean(session && session.user.id === env.OWNER_USER_ID);
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, storage: Boolean(env.MEDIA_BUCKET), configured: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.OWNER_USER_ID && env.SHARE_SIGNING_SECRET) });
      }

      if (url.pathname === "/sign" && request.method === "POST") {
        if (!env.SHARE_SIGNING_SECRET) return json({ error: "El servicio de enlaces no está configurado." }, 503);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        if (!path || path.length > 1024 || path.split("/").some(part => part === "..")) return json({ error: "Archivo inválido." }, 400);
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
        const object = await env.MEDIA_BUCKET.get(path);
        return withCors(await serveObject(object, path.split("/").pop()));
      }

      if (url.pathname.startsWith("/object/") && request.method === "GET") {
        const path = objectKey(url.pathname, "/object/");
        if (!path) return json({ error: "Archivo inválido." }, 400);
        const object = await env.MEDIA_BUCKET.get(path);
        const mode = url.searchParams.get("preview") === "1" ? "inline" : "attachment";
        return withCors(await serveObject(object, path.split("/").pop(), mode));
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
        const upload = await env.MEDIA_BUCKET.createMultipartUpload(path, { httpMetadata: { contentType } });
        return json({ ok: true, path, uploadId: upload.uploadId, partSize: 32 * 1024 * 1024 });
      }

      if (url.pathname === "/multipart/part" && request.method === "PUT") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const path = url.searchParams.get("path") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!path || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ error: "Parte inválida." }, 400);
        if (session.user.id !== env.OWNER_USER_ID && !path.startsWith(`${session.user.id}/`)) return json({ error: "Ruta de archivo no autorizada." }, 403);
        const upload = env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId);
        const part = await upload.uploadPart(partNumber, request.body);
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
        if (session.user.id !== env.OWNER_USER_ID && !path.startsWith(`${session.user.id}/`)) return json({ error: "Ruta de archivo no autorizada." }, 403);
        const upload = env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId);
        const object = await upload.complete(parts.map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag) })));
        return json({ ok: true, path, etag: object.etag, size: object.size });
      }

      if (url.pathname === "/multipart/abort" && request.method === "POST") {
        const session = await getUser(request, env);
        if (!await canUpload(session, env)) return json({ error: "No tenés permiso para subir archivos." }, 403);
        const input = await request.json().catch(() => ({}));
        const path = typeof input.path === "string" ? input.path : "";
        const uploadId = typeof input.uploadId === "string" ? input.uploadId : "";
        if (!path || !uploadId) return json({ error: "Datos de cancelación inválidos." }, 400);
        if (session.user.id !== env.OWNER_USER_ID && !path.startsWith(`${session.user.id}/`)) return json({ error: "Ruta de archivo no autorizada." }, 403);
        await env.MEDIA_BUCKET.resumeMultipartUpload(path, uploadId).abort();
        return json({ ok: true });
      }

      if (url.pathname.startsWith("/object/") && request.method === "DELETE") {
        const path = objectKey(url.pathname, "/object/");
        if (!path) return json({ error: "Archivo inválido." }, 400);
        const session = await getUser(request, env);
        if (!session) return json({ error: "Iniciá sesión para eliminar archivos." }, 401);
        const owner = await isOwner(session, env);
        if (!owner) {
          if (!path.startsWith(`${session.user.id}/`)) return json({ error: "Solo el dueño puede eliminar archivos." }, 403);
          const query = `${env.SUPABASE_URL}/rest/v1/media_files?select=id&storage_path=eq.${encodeURIComponent(path)}&limit=1`;
          const record = await fetch(query, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: session.authorization } });
          if (!record.ok || (await record.json()).length > 0) return json({ error: "No se puede eliminar un archivo ya registrado." }, 403);
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
