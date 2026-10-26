import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
type Input = { action?: string; username?: string; password?: string; captchaToken?: string; role?: "collaborator" | "member"; can_view_public_files?: boolean; can_view_links?: boolean; can_view_ps4_games?: boolean; can_create_folders?: boolean; can_upload?: boolean; storage_limit_bytes?: number };
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let input: Input;
  try { input = await req.json(); } catch { return json({ error: "Datos inválidos." }, 400); }
  const username = (input.username || "").trim().toLowerCase(), admin = createClient(url, service);
  if (input.action === "login" || input.action === "guest") {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    const captchaToken = typeof input.captchaToken === "string" ? input.captchaToken : "";
    if (!secret) return json({ error: "Falta configurar la verificación de seguridad." }, 503);
    if (!captchaToken || captchaToken.length > 2048) return json({ error: "Completá la verificación de seguridad." }, 400);
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", captchaToken);
    const remoteIp = req.headers.get("CF-Connecting-IP");
    if (remoteIp) form.set("remoteip", remoteIp);
    let captcha: { success?: boolean; hostname?: string };
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      captcha = await response.json();
    } catch {
      return json({ error: "No se pudo verificar el acceso. Intentá de nuevo." }, 503);
    }
    if (!captcha.success || !["mediachafa-transfer.vercel.app", "localhost"].includes(captcha.hostname || "")) {
      return json({ error: "La verificación venció o no es válida. Intentá de nuevo." }, 403);
    }
    if (input.action === "guest") return json({ ok: true });
    if (!/^[a-z0-9_]{3,24}$/.test(username) || !(input.password || "")) return json({ error: "Usuario o contraseña incorrectos." }, 401);
    let email: string;
    let account: Record<string, unknown> | null = null;
    if (username === "nxmollpy") {
      email = "nxmollpy@gmail.com";
    } else {
      const { data: member } = await admin.from("media_users").select("id,username,email,role,can_upload,can_view_public_files,can_view_links,can_view_ps4_games,can_create_folders,storage_limit_bytes").eq("username", username).maybeSingle();
      if (!member) return json({ error: "Usuario o contraseña incorrectos." }, 401);
      account = member;
      email = member.email;
    }
    const auth = createClient(url, anon), { data, error } = await auth.auth.signInWithPassword({ email, password: input.password! });
    if (error || !data.session) return json({ error: "Usuario o contraseña incorrectos." }, 401);
    return json({ session: data.session, user: data.user, account });
  }
  if (input.action !== "create") return json({ error: "Acción inválida." }, 400);
  const authorization = req.headers.get("Authorization") || "", caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user || user.id !== "3da2624d-d1cc-49e9-a536-ed8c0c480779") return json({ error: "Solo el dueño puede crear usuarios." }, 403);
  const password = input.password || "", role = input.role === "member" ? "member" : "collaborator";
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ error: "El usuario debe tener de 3 a 24 caracteres: letras, números o _." }, 400);
  if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  const { data: existing } = await admin.from("media_users").select("id").eq("username", username).maybeSingle();
  if (existing) return json({ error: "Ese nombre de usuario ya está ocupado." }, 409);
  const email = username + "@accounts.mediachafa.invalid", permissions = {
    role, can_upload: role === "collaborator" || (role === "member" && input.can_upload === true),
    can_view_public_files: role === "collaborator" || input.can_view_public_files === true,
    can_view_links: role === "collaborator" || input.can_view_links === true,
    can_view_ps4_games: role === "collaborator" || input.can_view_ps4_games === true,
    can_create_folders: role === "collaborator" || input.can_create_folders === true,
    storage_limit_bytes: role === "member" && input.can_upload === true ? Math.max(0, Math.min(Number(input.storage_limit_bytes) || 0, 10 * 1024 * 1024 * 1024)) : 0
  };
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, role } });
  if (createError || !created.user) return json({ error: createError?.message || "No se pudo crear la cuenta." }, 400);
  const { error: rowError } = await admin.from("media_users").insert({ id: created.user.id, username, email, created_by: user.id, ...permissions });
  if (rowError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: rowError.message }, 400); }
  return json({ username, permissions }, 201);
});
