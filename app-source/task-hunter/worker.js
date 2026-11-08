import { WorkflowEntrypoint } from "cloudflare:workers";

const APP_ORIGIN = "https://mediachafa-transfer.vercel.app";
const SUPABASE_URL = "https://velxgwkujcabdaxbppyj.supabase.co";
const SUPABASE_KEY = "sb_publishable_fbyju-9gVuWpbLwhz7Ki9w_6mWg593-";
const OWNER_EMAIL = "nxmollpy@gmail.com";
const BETA_AI_ORIGIN = "https://mediachafa-beta-ai.nxmollpy.workers.dev";
const TASK_TTL_SECONDS = 30 * 24 * 60 * 60;
const WORKERS_AI_DAILY_LIMIT = 900;
const TASK_DAILY_LIMIT = 3;
const MODELS = {
  "mediachafa::pro": "@cf/openai/gpt-oss-120b",
  "mediachafa::codigo": "@cf/qwen/qwen2.5-coder-32b-instruct",
  "mediachafa::rapida": "@cf/openai/gpt-oss-20b"
};

function response(data, status = 200, origin = APP_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "null",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Vary": "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function taskKey(userId, taskId) { return `task-hunter:${userId}:${taskId}`; }
async function saveState(env, state) {
  state.updatedAt = Date.now();
  await env.BETA_LIMITS.put(taskKey(state.userId, state.id), JSON.stringify(state), { expirationTtl: TASK_TTL_SECONDS });
}
async function loadState(env, userId, taskId) {
  const raw = await env.BETA_LIMITS.get(taskKey(userId, taskId));
  if (!raw) return null;
  try { const state = JSON.parse(raw); return state.userId === userId && state.id === taskId ? state : null; }
  catch { return null; }
}
function extractText(result) {
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.choices?.[0]?.message?.content === "string") return result.choices[0].message.content;
  if (typeof result?.result?.response === "string") return result.result.response;
  if (Array.isArray(result?.output)) return result.output.flatMap(x => x?.content || []).map(x => x?.text || "").join("\n");
  return "";
}
function publicState(state) {
  return {
    executionId: state.id, status: state.status, stage: state.stage,
    startedAt: state.startedAt || null, finishedAt: state.finishedAt || null,
    activeSeconds: Number(state.activeSeconds || 0),
    elapsedSeconds: state.startedAt ? Math.max(0, Math.floor(((state.finishedAt || Date.now()) - state.startedAt) / 1000)) : 0,
    resultSummary: state.resultSummary || null,
    resultData: state.resultData || {},
    qualityChecks: state.qualityChecks || [],
    error: state.error || null,
    updatedAt: state.updatedAt
  };
}
async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer\\s+\\S+$/i.test(auth)) return null;
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_KEY, Authorization: auth }
  });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id || user.is_anonymous || String(user.email || "").toLowerCase() !== OWNER_EMAIL) return null;
  return { user, auth };
}
async function supabaseRequest(env, path, auth, init = {}) {
  return fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
}
function taskRecordFromState(task, state) {
  if (!state) return task;
  return {
    ...task,
    status: state.status,
    stage: state.stage,
    started_at: state.startedAt ? new Date(state.startedAt).toISOString() : task.started_at,
    finished_at: state.finishedAt ? new Date(state.finishedAt).toISOString() : task.finished_at,
    active_seconds: state.activeSeconds || 0,
    elapsed_seconds: state.startedAt ? Math.max(0, Math.floor(((state.finishedAt || Date.now()) - state.startedAt) / 1000)) : 0,
    result_summary: state.resultSummary || task.result_summary,
    result_data: state.resultData || task.result_data,
    quality_checks: state.qualityChecks || task.quality_checks,
    checkpoint: { ...(task.checkpoint || {}), workflow_id: state.id, executor: "cloudflare_workflow", last_stage: state.stage }
  };
}

async function createTask(env, user, auth, payload) {
  const title = String(payload.title || "").trim().slice(0, 180);
  const description = String(payload.description || "").trim().slice(0, 12000);
  const model = String(payload.assigned_model || "mediachafa::pro");
  if (!title || !Object.hasOwn(MODELS, model)) throw new Error("Título o modelo de IA inválido.");
  if (!env.AI || !env.TASK_HUNTER_WORKFLOW || !env.BETA_LIMITS) throw new Error("El motor de ejecución todavía no está configurado.");
  const activeQuery = new URLSearchParams({
    select: "id,assigned_model,status",
    user_id: "eq." + user.id,
    assigned_model: "eq." + model,
    status: "in.(queued,running,waiting)",
    limit: "1"
  });
  const activeResponse = await supabaseRequest(env, "/rest/v1/task_hunter_jobs?" + activeQuery, auth);
  const activeRows = await activeResponse.json().catch(() => []);
  if (!activeResponse.ok) throw new Error("No se pudo comprobar si esa IA está ocupada.");
  if (activeRows.length) throw new Error("Esa IA ya está ocupada con otro trabajo. Elegí otra o esperá a que termine.");
  const date = new Date().toISOString().slice(0, 10);
  const dailyKey = `task-hunter-daily:${user.id}:${date}`;
  const dailyCount = Number(await env.BETA_LIMITS.get(dailyKey) || 0);
  if (dailyCount >= TASK_DAILY_LIMIT) throw new Error("Alcanzaste el límite prudente de 3 trabajos por día para cuidar la cuota gratuita.");
  const reward = payload.estimated_reward === "" || payload.estimated_reward == null ? null : Number(payload.estimated_reward);
  if (reward !== null && (!Number.isFinite(reward) || reward < 0)) throw new Error("Pago estimado inválido.");
  const minutes = Number(payload.estimated_duration_minutes);
  const row = {
    user_id: user.id, title, description, assigned_model: model,
    source_platform: String(payload.source_platform || "manual").slice(0,80),
    source_url: payload.source_url ? String(payload.source_url).slice(0,2000) : null,
    task_category: String(payload.task_category || "other").slice(0,80),
    estimated_reward: reward,
    estimated_currency: /^[A-Z]{3}$/.test(payload.estimated_currency || "USD") ? payload.estimated_currency : "USD",
    estimated_duration_seconds: Number.isFinite(minutes) && minutes > 0 ? Math.min(604800, Math.floor(minutes * 60)) : null,
    status: "queued", stage: "queued",
    checkpoint: { executor: "cloudflare_workflow", workflow_id: null }
  };
  const insert = await supabaseRequest(env, "/rest/v1/task_hunter_jobs", auth, { method: "POST", body: JSON.stringify(row) });
  const inserted = await insert.json().catch(() => []);
  if (!insert.ok || !inserted[0]?.id) throw new Error(inserted?.message || "No se pudo guardar el trabajo.");
  const task = inserted[0];
  const state = {
    id: task.id, userId: user.id, title, description, assignedModel: model,
    status: "queued", stage: "queued", createdAt: Date.now(), updatedAt: Date.now(),
    startedAt: null, finishedAt: null, activeSeconds: 0,
    resultSummary: null, resultData: {}, qualityChecks: [], error: null
  };
  await saveState(env, state);
  try {
    const instance = await env.TASK_HUNTER_WORKFLOW.create({ id: task.id, params: { userId: user.id, taskId: task.id } });
    await env.BETA_LIMITS.put(dailyKey, String(dailyCount + 1), { expirationTtl: 172800 });
    const patch = await supabaseRequest(env, "/rest/v1/task_hunter_jobs?id=eq." + task.id, auth, {
      method: "PATCH",
      body: JSON.stringify({ status: "running", stage: "starting", started_at: new Date().toISOString(), checkpoint: { executor: "cloudflare_workflow", workflow_id: instance.id } })
    });
    if (!patch.ok) throw new Error("El Workflow arrancó, pero no se pudo sincronizar el registro.");
    const latest = await loadState(env, user.id, task.id) || state;
    if (latest.status === "queued") {
      latest.status = "running"; latest.stage = "starting"; latest.startedAt = latest.startedAt || Date.now();
      await saveState(env, latest);
    }
    return { task: taskRecordFromState(task, state), execution: "started", workflowId: instance.id };
  } catch (error) {
    state.status = "failed"; state.stage = "start_failed"; state.finishedAt = Date.now();
    state.error = String(error?.message || "No se pudo iniciar el Workflow.").slice(0, 500);
    await saveState(env, state);
    await supabaseRequest(env, "/rest/v1/task_hunter_jobs?id=eq." + task.id, auth, {
      method: "PATCH", body: JSON.stringify({ status: "failed", stage: "start_failed", finished_at: new Date().toISOString(), checkpoint: { executor: "cloudflare_workflow", error: state.error } })
    });
    throw new Error(state.error);
  }
}

export class TaskHunterWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    let payload = event.payload || {};
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = {}; } }
    const { userId, taskId } = payload;
    if (!userId || !taskId) throw new Error("Faltan los identificadores del trabajo.");
    const state = await step.do("load-task", async () => {
      const current = await loadState(this.env, userId, taskId);
      if (!current) throw new Error("No existe el checkpoint persistente del trabajo.");
      return { title: current.title, description: current.description, assignedModel: current.assignedModel, status: current.status };
    });
    if (state.status === "completed" || state.status === "cancelled") return state;
    await step.do("mark-running", async () => {
      const current = await loadState(this.env, userId, taskId);
      if (!current) throw new Error("El trabajo desapareció.");
      current.status = "running"; current.stage = "generating";
      current.startedAt = current.startedAt || Date.now();
      await saveState(this.env, current);
      return { stage: current.stage };
    });
    let generated;
    try {
      generated = await step.do("generate-deliverable", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" } }, async () => {
        const current = await loadState(this.env, userId, taskId);
        if (!current) throw new Error("El trabajo desapareció antes de la ejecución.");
        const date = new Date().toISOString().slice(0, 10);
        const quotaKey = `beta-ai-requests:${userId}:workersai:day:${date}`;
        const used = Number(await this.env.BETA_LIMITS.get(quotaKey) || 0);
        if (used >= WORKERS_AI_DAILY_LIMIT) throw new Error("Se agotó el límite diario de seguridad de Workers AI; no se intentó usar un motor pago.");
        await this.env.BETA_LIMITS.put(quotaKey, String(used + 1), { expirationTtl: 172800 });
        const model = MODELS[current.assignedModel] || MODELS["mediachafa::pro"];
        const prompt = [
          "TAREA: " + current.title,
          current.description ? "INSTRUCCIONES:\n" + current.description : "",
          "Entregá un resultado completo y utilizable. Respondé en español salvo que el encargo pida otro idioma.",
          "No inventes fuentes, datos, experiencia personal, envíos, aceptación de plataformas ni pagos.",
          "Si se necesita navegar, iniciar sesión, completar una encuesta o enviar un trabajo y no tenés una herramienta habilitada para hacerlo, marcá esa parte como pendiente y no simules haberla realizado.",
          "No inventes información personal del usuario. Separá hechos, supuestos y pasos que requieren intervención humana."
        ].filter(Boolean).join("\n\n");
        const started = Date.now();
        const result = await this.env.AI.run(model, {
          messages: [
            { role: "system", content: "Sos MediaChafa, un asistente de trabajo autónomo. Producí entregables concretos y de calidad. Nunca declares ingresos ni tareas externas completadas sin evidencia." },
            { role: "user", content: prompt }
          ],
          max_tokens: 1800,
          temperature: 0.25
        });
        const output = extractText(result).trim();
        if (output.length < 80) throw new Error("La IA no devolvió un resultado suficientemente completo.");
        return { output: output.slice(0, 24000), durationMs: Date.now() - started, model };
      });
    } catch (error) {
      await step.do("save-failure", async () => {
        const current = await loadState(this.env, userId, taskId);
        if (current) {
          current.status = "failed"; current.stage = "failed"; current.finishedAt = Date.now();
          current.error = String(error?.message || "Falló la ejecución.").slice(0, 600);
          await saveState(this.env, current);
        }
        return { saved: true };
      });
      throw error;
    }
    const checks = [
      { name: "resultado_no_vacio", passed: generated.output.trim().length >= 80 },
      { name: "limite_de_salida", passed: generated.output.length <= 24000 },
      { name: "sin_pago_ficticio", passed: !/\b(pago recibido|dinero acreditado|ganancia confirmada|cobro realizado)\b/i.test(generated.output) }
    ];
    await step.do("save-result", async () => {
      const current = await loadState(this.env, userId, taskId);
      if (!current) throw new Error("No se pudo recuperar el checkpoint al guardar.");
      current.status = checks.every(x => x.passed) ? "completed" : "waiting";
      current.stage = checks.every(x => x.passed) ? "quality_checked" : "quality_review_required";
      current.finishedAt = Date.now();
      current.activeSeconds = Math.max(1, Math.ceil(generated.durationMs / 1000));
      current.resultData = { output: generated.output, model: generated.model };
      current.resultSummary = generated.output.slice(0, 600);
      current.qualityChecks = checks;
      await saveState(this.env, current);
      return publicState(current);
    });
    return { status: checks.every(x => x.passed) ? "completed" : "waiting" };
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET" && (!origin || origin === APP_ORIGIN)) return response({ ok: true, service: "MediaChafa Task Hunter", execution: env.TASK_HUNTER_WORKFLOW ? "durable_workflow_enabled" : "not_configured" });
    if (request.method === "OPTIONS") return origin === APP_ORIGIN
      ? new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": APP_ORIGIN, "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type", Vary: "Origin" } })
      : response({ error: "Origen no autorizado." }, 403, origin);
    if (origin !== APP_ORIGIN) return response({ error: "Origen no autorizado." }, 403, origin);
    const session = await authenticate(request, env);
    if (!session) return response({ error: "Sesión no válida o cuenta no autorizada." }, 401, origin);
    const { user, auth } = session;
    if (pathname === "/opportunities" && request.method === "GET") {
      const q = new URLSearchParams({ select: "*", order: "discovered_at.desc", limit: "100" });
      const r = await supabaseRequest(env, "/rest/v1/task_hunter_opportunities?" + q, auth);
      const rows = await r.json().catch(() => []);
      if (!r.ok) return response({ error: rows.message || "No se pudieron cargar las oportunidades." }, r.status, origin);
      return response({ opportunities: rows }, 200, origin);
    }
    if (pathname === "/opportunities" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return response({ error: "Solicitud inválida." }, 400, origin); }
      const title = String(payload.title || "").trim().slice(0,180);
      const description = String(payload.description || "").trim().slice(0,12000);
      const platform = String(payload.platform || "other").trim().slice(0,80);
      const category = String(payload.category || "other").trim().slice(0,80);
      const url = payload.url ? String(payload.url).trim().slice(0,2000) : null;
      const reward = payload.estimated_reward === "" || payload.estimated_reward == null ? null : Number(payload.estimated_reward);
      const currency = /^[A-Z]{3}$/.test(payload.currency || "USD") ? payload.currency : "USD";
      if (!title || (reward !== null && (!Number.isFinite(reward) || reward < 0))) return response({ error: "Título o pago estimado inválido." }, 400, origin);
      if (url) { try { const parsed = new URL(url); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); } catch { return response({ error: "El enlace debe ser HTTP o HTTPS." }, 400, origin); } }
      const row = { user_id: user.id, platform, external_id: payload.external_id ? String(payload.external_id).slice(0,160) : null, title, description, category, url, estimated_reward: reward, currency, eligibility_status: "manual_check", automation_status: "assisted_only", status: "new", source_data: { imported_manually: true } };
      const r = await supabaseRequest(env, "/rest/v1/task_hunter_opportunities", auth, { method: "POST", body: JSON.stringify(row) });
      const rows = await r.json().catch(() => []);
      if (!r.ok) return response({ error: rows.message || "No se pudo guardar la oportunidad." }, r.status, origin);
      return response({ opportunity: rows[0] || null }, 201, origin);
    }
    const assignMatch = pathname.match(/^\\/opportunities\\/([0-9a-f-]{36})\\/assign$/i);
    if (assignMatch && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return response({ error: "Solicitud inválida." }, 400, origin); }
      const q = new URLSearchParams({ select: "*", id: "eq." + assignMatch[1], status: "in.(new,saved)", limit: "1" });
      const found = await supabaseRequest(env, "/rest/v1/task_hunter_opportunities?" + q, auth);
      const rows = await found.json().catch(() => []);
      if (!found.ok || !rows[0]) return response({ error: "La oportunidad no existe o ya fue asignada." }, 404, origin);
      const opportunity = rows[0];
      try {
        const created = await createTask(env, user, auth, {
          title: opportunity.title, description: [opportunity.description, opportunity.url ? "ENLACE DE REFERENCIA: " + opportunity.url : "", "La IA debe preparar el entregable y señalar cualquier paso externo que requiera aprobación o intervención humana."].filter(Boolean).join("\\n\\n"),
          assigned_model: payload.assigned_model || "mediachafa::pro",
          estimated_reward: opportunity.estimated_reward, estimated_currency: opportunity.currency,
          source_platform: opportunity.platform, source_url: opportunity.url, task_category: opportunity.category
        });
        await supabaseRequest(env, "/rest/v1/task_hunter_opportunities?id=eq." + opportunity.id, auth, { method: "PATCH", body: JSON.stringify({ status: "assigned" }) });
        return response({ ...created, opportunity_id: opportunity.id }, 201, origin);
      } catch (error) { return response({ error: String(error?.message || "No se pudo asignar la oportunidad.").slice(0,600) }, 409, origin); }
    }
    if (pathname === "/tasks" && request.method === "GET") {
      const q = new URLSearchParams({ select: "*", order: "updated_at.desc", limit: "100" });
      const r = await supabaseRequest(env, "/rest/v1/task_hunter_jobs?" + q, auth);
      const rows = await r.json().catch(() => []);
      if (!r.ok) return response({ error: rows.message || "No se pudieron cargar los trabajos." }, r.status, origin);
      const tasks = await Promise.all(rows.map(async task => {
        const state = await loadState(env, user.id, task.id);
        const merged = taskRecordFromState(task, state);
        if (state && ["completed","failed","waiting"].includes(state.status) && task.status !== state.status) {
          await supabaseRequest(env, "/rest/v1/task_hunter_jobs?id=eq." + task.id, auth, {
            method: "PATCH",
            body: JSON.stringify({
              status: state.status, stage: state.stage,
              active_seconds: state.activeSeconds || 0, elapsed_seconds: merged.elapsed_seconds,
              started_at: merged.started_at, finished_at: merged.finished_at,
              result_summary: state.resultSummary, result_data: state.resultData,
              quality_checks: state.qualityChecks, checkpoint: merged.checkpoint
            })
          });
        }
        return merged;
      }));
      return response({ tasks }, 200, origin);
    }
    if (pathname === "/tasks" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return response({ error: "Solicitud inválida." }, 400, origin); }
      try { return response(await createTask(env, user, auth, payload), 201, origin); }
      catch (error) { return response({ error: String(error?.message || "No se pudo iniciar el trabajo.").slice(0, 600) }, 409, origin); }
    }
    const match = pathname.match(/^\/tasks\/([0-9a-f-]{36})$/i);
    if (match && request.method === "PATCH") {
      let payload;
      try { payload = await request.json(); } catch { return response({ error: "Solicitud inválida." }, 400, origin); }
      if (payload.status !== "cancelled") return response({ error: "Solo se permite cancelar un trabajo en cola." }, 400, origin);
      const r = await supabaseRequest(env, "/rest/v1/task_hunter_jobs?id=eq." + match[1] + "&status=eq.queued", auth, {
        method: "PATCH", body: JSON.stringify({ status: "cancelled", stage: "cancelled", updated_at: new Date().toISOString() })
      });
      const rows = await r.json().catch(() => []);
      return r.ok ? response({ task: rows[0] || null }, 200, origin) : response({ error: "No se pudo cancelar el trabajo." }, r.status, origin);
    }
    return response({ error: "Ruta no encontrada." }, 404, origin);
  }
};
