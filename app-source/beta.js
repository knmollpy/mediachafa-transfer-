// Reglas del modo Autónomo de Beta (sin acceso al DOM, para poder probarlas solas).
(() => {
  const LIVE_REPO = 'knmollpy/mediachafa-transfer-';
  const AUTO_TYPES = new Set(['create_repository', 'write_file', 'write_files', 'enable_pages', 'pages_build', 'create_worker']);
  const TAGS = { SIGO: 'continue', PREGUNTA: 'question', LISTO: 'done' };
  const OWN_MODEL_TURNS = 30;
  const OTHER_MODEL_TURNS = 12;

  // Las IAs MediaChafa no tienen límite de consultas; las demás no gastan más de lo que queda.
  function turnLimit(model) {
    if (model?.unlimited) return OWN_MODEL_TURNS;
    const remaining = Number(model?.remaining);
    return Math.max(1, Math.min(OTHER_MODEL_TURNS, Number.isFinite(remaining) ? remaining : 6));
  }

  function requestedRepositoryName(goal) {
    const text = String(goal || '');
    const full = text.match(/(?:github\.com\/)?knmollpy\/([A-Za-z0-9._-]{1,100})/i);
    if (full) return full[1];
    const named = text.match(/\b(?:repositorio|repo)\s+(?:(?:llamado|llamada|de nombre|que se llama)\s+)?(?:(?:el|la|un|una|mi|ese|este)\s+)?["'`]?([A-Za-z0-9][A-Za-z0-9._-]{0,99})/i);
    if (named && !/^(?:un|una|el|la|mi|ese|este|que|de|github)$/i.test(named[1])) return named[1];
    return '';
  }

  function isRepositoryDeletionRequest(goal) {
    return /\b(?:borr\w*|elimin\w*|delete|remove)\b/i.test(String(goal || '')) &&
      /\b(?:repo|repositorio|repository)\w*\b/i.test(String(goal || ''));
  }

  function newState(goal, model) {
    const safeGoal = String(goal || '').slice(0, 6000);
    return { goal: safeGoal, modelId: model.id, turn: 0, maxTurns: turnLimit(model), loopHistory: [], links: [], emptyStreak: 0, deleteRepositoryName: requestedRepositoryName(safeGoal) };
  }

  function classifyAnswer(answer) {
    const text = String(answer || '').trim();
    const match = text.match(/^[\s*_#>"'«]*(SIGO|PREGUNTA|LISTO)[\s*_"'»]*[:：\-–—]\s*/i);
    if (!match) return { kind: 'unknown', text };
    return { kind: TAGS[match[1].toUpperCase()], text: text.slice(match[0].length).trim() || text };
  }

  // Borrados, SQL, tipos desconocidos y cualquier cambio en la web en vivo esperan al dueño.
  function needsOwnerApproval(proposal) {
    if (!proposal || !AUTO_TYPES.has(String(proposal.type || ''))) return true;
    if (proposal.type === 'create_repository') return false;
    if (proposal.provider === 'github' && String(proposal.repository || LIVE_REPO).toLowerCase() === LIVE_REPO) return true;
    return false;
  }

  function shouldRetry(status, attempt, model) {
    if (model?.unlimited) return attempt < 2 && (!status || status === 429 || status >= 500);
    return attempt < 1 && (!status || status >= 500);
  }

  function decideNext({ classified, proposalsCount, failed, emptyStreak = 0 }) {
    if (classified.kind === 'question') return { kind: 'question', emptyStreak: 0 };
    if (classified.kind === 'done' && !failed) return { kind: 'done', emptyStreak: 0 };
    if (proposalsCount || failed) return { kind: 'continue', emptyStreak: 0 };
    if (classified.kind === 'unknown' && /\?\s*$/.test(classified.text)) return { kind: 'question', emptyStreak: 0 };
    if (emptyStreak + 1 >= 3) return { kind: 'stalled', emptyStreak: 0 };
    return { kind: 'nudge', emptyStreak: emptyStreak + 1 };
  }

  function protocol(state) {
    return `[MODO AUTÓNOMO DE MEDIACHAFA · turno ${state.turn} de ${state.maxTurns}]
PRIMERO CLASIFICÁ LA INTENCIÓN DEL MENSAJE ANTES DE PLANIFICAR:
- Si el usuario saluda ("hola", "buenas"), charla ("¿cómo estás?", "gracias"), hace una pregunta informativa, pide una explicación, opinión o conversación que NO requiera modificar ni ejecutar nada en servicios externos, respondé directamente y de forma natural. Usá "LISTO: ..." y actions vacías. No generes un plan de trabajo, no ofrezcas crear repositorios ni muestres opciones de acciones. No hagas preguntas de configuración para una charla normal.
- Si el usuario pide explícitamente crear, editar, borrar, publicar, configurar, buscar o ejecutar algo en un servicio/recurso, tratá eso como una tarea y prepará las acciones necesarias. Preguntá solo si falta un dato imprescindible que no puedas inferir con seguridad.
- Si el usuario pide ayuda para pensar o planificar, pero no pide ejecutar cambios, ayudalo conversando y no prepares acciones externas.
- No confundas mencionar una herramienta, repositorio o servicio en una pregunta con autorizar una acción sobre él.
Trabajá sola hasta terminar TODO el pedido de acción; no te frenes después de un paso ni pidas permiso para seguir. En cada turno devolvé en "actions" todas las acciones del próximo paso (podés mandar varias, en orden). Las acciones normales se aprueban y ejecutan solas y en el turno siguiente recibís su resultado real: nunca digas que algo se hizo antes de verlo en los resultados. Borrados de repositorios: si el pedido es borrar/eliminar un repositorio y falta el nombre exacto, hacé UNA sola pregunta: "¿Cuál es el nombre exacto del repositorio que querés borrar?". No pidas URL, propietario, motivo, visibilidad, rama, descripción ni otros datos; la cuenta es knmollpy. Cuando recibas el nombre, usá exactamente "knmollpy/nombre" en delete_repository y seguí sin volver a preguntar. La solicitud original de borrado más el nombre exacto indicado por el dueño autorizan ese borrado: no pidas una segunda confirmación. Si el nombre ya aparece claramente en el pedido original, no lo vuelvas a preguntar.
Borrados de archivos/rutas, SQL y cambios en ${LIVE_REPO} (la web en vivo) siguen requiriendo aprobación del dueño.
"answer" tiene que empezar con UNA etiqueta:
- "SIGO: ..." cuando mandás acciones y todavía falta trabajo.
- "PREGUNTA: ..." solo si falta una decisión imprescindible. En ese caso, escribí primero la pregunta en una línea y después entre 2 y 5 opciones CONCRETAS, DIFERENTES Y CONTEXTUALES en líneas separadas con el formato "- Opción". Las opciones deben responder directamente a esa pregunta y al proyecto/tarea actual: por ejemplo, si preguntás qué contenido debe tener un repositorio, ofrecé tipos reales de contenido o funcionalidades (no "Sí, hacelo", "No" ni respuestas genéricas). No incluyas "Proponé otra alternativa": la interfaz agrega ese botón por separado. Incluí Sí/No únicamente cuando la pregunta realmente sea de aprobación. El usuario también podrá escribir una respuesta personalizada.
- "LISTO: ..." cuando ya viste en los resultados que todo quedó hecho; incluí un resumen corto y los links finales.
Acciones válidas (usá exactamente estos campos; no inventes otros tipos):
{"provider":"github","type":"create_repository","name":"nombre-repo","description":"...","visibility":"public"}
{"provider":"github","type":"write_files","repository":"knmollpy/nombre-repo","files":[{"path":"index.html","content":"archivo completo"}],"message":"mensaje de commit"}
{"provider":"github","type":"enable_pages","repository":"knmollpy/nombre-repo","branch":"main","folder":"/"}
{"provider":"cloudflare","type":"create_worker","name":"nombre-worker","content":"código completo"}
Para una página web pública: create_repository con visibility "public", después write_files con todos los archivos y por último enable_pages; queda en https://knmollpy.github.io/nombre-repo/. Escribí código completo y funcional, sin "..." ni partes pendientes; si es muy largo, repartilo en varios turnos.`;
  }

  function buildTurnMessage(state, message) {
    if (!message) return `${protocol(state)}\n\nPEDIDO DEL DUEÑO:\n${state.goal}`;
    return `${protocol(state)}\n\nPEDIDO ORIGINAL (no lo pierdas de vista): ${state.goal.slice(0, 2000)}\n\n${message}`;
  }

  function compactUserTurn(state, message) {
    return message ? `Turno ${state.turn}. ${message}` : `PEDIDO DEL DUEÑO: ${state.goal}`;
  }

  function nudgeMessage(results, answer) {
    return `${results.length ? `RESULTADOS REALES DEL TURNO ANTERIOR:\n${results.join('\n')}\n\n` : ''}No llegó ninguna acción válida en "actions"${answer ? ` (dijiste: "${String(answer).slice(0, 300)}")` : ''}. Si ya terminaste respondé "LISTO: ...", si te falta un dato imprescindible respondé "PREGUNTA: ...", y si no, devolvé ahora las acciones del próximo paso con los tipos y campos exactos de la lista.`;
  }

  function linksBlock(state, text = '') {
    const links = [...new Set(state.links || [])].filter(link => !String(text).includes(link));
    return links.length ? `\n\nLinks:\n${links.join('\n')}` : '';
  }

  function finalMessage(outcome, state) {
    const text = String(outcome.text || '').trim();
    if (outcome.kind === 'done') return `${text || 'Listo, terminé el pedido.'}${linksBlock(state, text)}`;
    if (outcome.kind === 'question') return `${text}\n\n(Respondé acá y sigo trabajando sola.)`;
    if (outcome.kind === 'stalled') return `No encontré más pasos para hacer. Si falta algo, decime qué y sigo.${linksBlock(state)}`;
    if (outcome.kind === 'stopped') return `Me detuve como pediste. Escribí "seguí" para continuar desde donde quedé.${linksBlock(state)}`;
    if (outcome.kind === 'error') return `Me frené por un error: ${text}\n\nEscribí "seguí" y reintento desde donde quedé.${linksBlock(state)}`;
    return `Hice ${state.turn} turnos y llegué al límite de esta tanda. Escribí "seguí" y continúo desde donde quedé.${linksBlock(state)}`;
  }

  window.MediaChafaBetaAgent = { LIVE_REPO, turnLimit, newState, classifyAnswer, isRepositoryDeletionRequest, needsOwnerApproval, shouldRetry, decideNext, buildTurnMessage, compactUserTurn, nudgeMessage, finalMessage };
})();

(() => {
  if (window.MEDIA_NATIVE_APP === true || window.Capacitor?.isNativePlatform?.()) return;

  const $ = (selector) => document.querySelector(selector);
  const API = 'https://mediachafa-beta-ai.nxmollpy.workers.dev';
  const messagesNode = $('#beta-messages');
  const stage = $('#beta-chat-stage');
  const form = $('#beta-form');
  const input = $('#beta-input');
  const sendButton = $('#beta-send');
  const status = $('#beta-status');
  const imageInput = $('#beta-image');
  const audioInput = $('#beta-audio');
  let pendingImage;
  let pendingAudio;
  let history = [];
  let remaining = 50;
  let dailyLimit = 50;
  let usedToday = 0;
  let ownerId = '';
  const activityList = $('#beta-activity-list');
  let activityItems = [];
  let modelCatalog = [];
  let providerQuotas = {};
  let modelHealth = {};
  const HEALTH_FRESH_MS = 15 * 60 * 1000;
  const modelSelect = document.createElement('select');
  modelSelect.id = 'beta-model-select';
  modelSelect.setAttribute('aria-label', 'Modelo de inteligencia artificial');
  const modelCount = document.createElement('small');
  modelCount.id = 'beta-model-count';
  modelCount.className = 'beta-model-count';
  const modelControl = document.createElement('div');
  modelControl.className = 'beta-model-control';
  const modelLabel = document.createElement('span');
  modelLabel.textContent = 'Modelo de IA';
  const modelHealthNote = document.createElement('small');
  modelHealthNote.className = 'beta-model-health';
  modelHealthNote.setAttribute('role', 'status');
  const modelProbe = document.createElement('button');
  modelProbe.type = 'button';
  modelProbe.className = 'beta-model-probe';
  modelProbe.textContent = 'Probar modelo · usa 1 consulta';
  modelControl.append(modelLabel, modelSelect, modelHealthNote, modelCount, modelProbe);
  const betaHeader = $('#beta-panel .beta-header');
  betaHeader.insertBefore(modelControl, betaHeader.querySelector('.beta-nav'));

  // Build missing cards at runtime too, so cached HTML shells still support
  // every provider and never strand the owner on the old OpenRouter-only form.
  const modelProviderInfo = {
    openrouter: { title: 'OpenRouter · modelos :free', url: 'https://openrouter.ai/settings/keys', link: 'Crear API key', note: 'No compres créditos ni actives recargas. Solo se aceptan variantes :free con precios comprobados en cero; OpenRouter limita su pool gratuito a 50 solicitudes diarias compartidas.' },
    groq: { title: 'Groq · plan Free', url: 'https://console.groq.com/keys', link: 'Abrir claves de Groq', note: 'La cuenta conectada debe mantenerse en el plan Free. Beta solo ofrece modelos publicados en los límites gratuitos de tu cuenta y se detiene ante el límite del proveedor.' },
    cohere: { title: 'Cohere · clave Trial gratis', url: 'https://dashboard.cohere.com/api-keys', link: 'Abrir claves Trial', note: 'Usá una clave Trial de la cuenta gratuita; nunca una Production. Cohere indica un máximo de 1.000 llamadas al mes para claves Trial.' },
    gemini: { title: 'Google AI Studio · Free Tier', url: 'https://aistudio.google.com/apikey', link: 'Abrir AI Studio', note: 'Solo conectes una API key de un proyecto que AI Studio muestre como Free Tier y sin facturación vinculada. Beta permite únicamente modelos de una lista gratuita cerrada.' },
    huggingface: { title: 'Hugging Face · Qwen Image 2.1 Uncensored', url: 'https://huggingface.co/settings/tokens', link: 'Crear token gratuito (Read)', note: 'Conectá tu cuenta gratuita con un token de solo lectura. Habilita la edición de imágenes Qwen en las tres IA de MediaChafa. ZeroGPU ofrece una cuota diaria gratuita compartida (5 minutos por cuenta Free); puede haber cola o disponibilidad variable. No se te pide tarjeta ni se activa facturación.' },
  };
  const connectorGrid = $('#beta-integrations-view .beta-connectors');
  if (connectorGrid) for (const [provider, info] of Object.entries(modelProviderInfo)) {
    if ($('#beta-connection-' + provider)) continue;
    const card = document.createElement('article');
    card.className = 'beta-connector beta-free-models';
    const title = document.createElement('h3'); title.textContent = info.title;
    const description = document.createElement('p');
    const link = document.createElement('a'); link.href = info.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = info.link;
    description.append(link, '. ', info.note, ' La clave se guarda cifrada en el Worker privado de Beta.');
    const tokenInput = document.createElement('input'); tokenInput.id = 'beta-token-' + provider; tokenInput.type = 'password'; tokenInput.autocomplete = 'off'; tokenInput.spellcheck = false; tokenInput.placeholder = 'Pegá tu token gratuito de ' + provider; tokenInput.setAttribute('aria-label', 'Token de ' + provider);
    const actions = document.createElement('div'); actions.className = 'beta-actions';
    const connect = document.createElement('button'); connect.className = 'add-btn'; connect.type = 'button'; connect.dataset.betaConnect = provider; connect.textContent = 'Validar y guardar';
    const disconnect = document.createElement('button'); disconnect.className = 'secondary hidden'; disconnect.type = 'button'; disconnect.dataset.betaDisconnect = provider; disconnect.textContent = 'Desconectar';
    actions.append(connect, disconnect);
    const connection = document.createElement('span'); connection.className = 'beta-connection-status'; connection.id = 'beta-connection-' + provider; connection.setAttribute('role', 'status'); connection.textContent = 'Sin conectar';
    card.append(title, description, tokenInput, actions, connection); connectorGrid.append(card);
  }

  // GitHub Pages reutiliza la conexión de GitHub: no pide otro token.
  const pagesStyle = document.createElement('style');
  pagesStyle.textContent = `#beta-panel .beta-pages-card select{width:100%;margin:9px 0;padding:11px 13px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#141414;color:#f2f2f2}#beta-panel .beta-pages-form{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:0 8px}#beta-panel .beta-pages-form select:first-child{grid-column:1/-1}#beta-panel .beta-pages-sites{list-style:none;margin:8px 0;padding:0;display:grid;gap:6px;font-size:12px}#beta-panel .beta-pages-sites li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#141414;color:#ddd}#beta-panel .beta-pages-sites a{color:#ff9d9d;overflow-wrap:anywhere}#beta-panel .beta-pages-sites small{color:#9a8a8a}#beta-panel .beta-pages-sites button{margin-left:auto;padding:4px 10px;font-size:11px}`;
  document.head.append(pagesStyle);
  const pagesCard = document.createElement('article');
  pagesCard.className = 'beta-connector beta-pages-card';
  pagesCard.id = 'beta-pages-card';
  {
    const title = document.createElement('h3'); title.textContent = 'GitHub Pages';
    const description = document.createElement('p');
    description.textContent = 'Usa tu conexión de GitHub, no hace falta otro token. Publicá cualquier repositorio de knmollpy como sitio web gratis. El token de GitHub necesita Pages: Read and write y Administration: Read and write (fine-grained) o el alcance repo (classic). Cada publicación pide tu confirmación.';
    const sites = document.createElement('ul'); sites.className = 'beta-pages-sites'; sites.id = 'beta-pages-sites';
    const formRow = document.createElement('div'); formRow.className = 'beta-pages-form';
    const repoSelect = document.createElement('select'); repoSelect.id = 'beta-pages-repo'; repoSelect.setAttribute('aria-label', 'Repositorio para GitHub Pages');
    const branchInput = document.createElement('input'); branchInput.id = 'beta-pages-branch'; branchInput.type = 'text'; branchInput.placeholder = 'Rama (ej. main)'; branchInput.autocomplete = 'off'; branchInput.spellcheck = false; branchInput.setAttribute('aria-label', 'Rama a publicar');
    const folderSelect = document.createElement('select'); folderSelect.id = 'beta-pages-folder'; folderSelect.setAttribute('aria-label', 'Carpeta a publicar');
    for (const value of ['/', '/docs']) { const option = document.createElement('option'); option.value = value; option.textContent = value === '/' ? '/ (raíz)' : '/docs'; folderSelect.append(option); }
    formRow.append(repoSelect, branchInput, folderSelect);
    const actions = document.createElement('div'); actions.className = 'beta-actions';
    const publish = document.createElement('button'); publish.className = 'add-btn'; publish.type = 'button'; publish.id = 'beta-pages-publish'; publish.textContent = 'Publicar con Pages';
    const refresh = document.createElement('button'); refresh.className = 'secondary'; refresh.type = 'button'; refresh.id = 'beta-pages-refresh'; refresh.textContent = 'Actualizar';
    actions.append(publish, refresh);
    const connection = document.createElement('span'); connection.className = 'beta-connection-status'; connection.id = 'beta-connection-pages'; connection.setAttribute('role', 'status'); connection.textContent = 'Conectá GitHub para ver tus sitios.';
    pagesCard.append(title, description, sites, formRow, actions, connection);
    const cloudflareCard = $('#beta-connection-cloudflare')?.closest('article');
    if (cloudflareCard) cloudflareCard.after(pagesCard); else if (connectorGrid) connectorGrid.append(pagesCard);
  }

  // IAs sin cuenta: no hay nada que conectar; la tarjeta solo informa límites y uso de hoy.
  const keylessProviderInfo = {
    ovh: { title: 'OVHcloud AI Endpoints', detail: 'GPT-OSS 120B, Qwen 3.5 397B, Llama 3.3 70B, Mistral y más. Límite del proveedor: 2 por minuto por modelo. Tope de Beta: 200 por día por modelo.' },
    llm7: { title: 'LLM7 (código abierto en GitHub)', detail: 'DeepSeek V4 Flash, GLM 5.3 Flash, MiniMax, Codestral y más. Límite del proveedor: 10 por minuto y 60 por hora. Tope de Beta: 100 por día compartidas.' },
    pollinations: { title: 'Pollinations (código abierto en GitHub)', detail: 'GPT-OSS 20B con razonamiento. Límite del proveedor: 1 consulta cada 30 segundos. Tope de Beta: 150 por día.' },
    horde: { title: 'AI Horde (red comunitaria)', detail: 'Modelos abiertos que corren voluntarios (Gemma, Qwen, Phi, Llama…). Puede tardar 1-2 minutos según la cola y no lee el código del proyecto. Tope de Beta: 100 por día.' },
  };
  const keylessUsageNodes = {};
  if (connectorGrid && !$('#beta-keyless-card')) {
    const card = document.createElement('article');
    card.className = 'beta-connector beta-free-models';
    card.id = 'beta-keyless-card';
    const title = document.createElement('h3'); title.textContent = 'IAs sin cuenta · ya activas';
    const description = document.createElement('p');
    description.textContent = 'No necesitan clave ni registro: aparecen solas en el selector de modelos. Cada una muestra su nivel de pensamiento, su tope diario y cuántas llevás hoy. Son servicios gratuitos de terceros y pueden cambiar o fallar sin aviso.';
    const list = document.createElement('ul');
    list.className = 'beta-keyless-list';
    for (const [provider, info] of Object.entries(keylessProviderInfo)) {
      const item = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = info.title;
      const usage = document.createElement('span'); usage.className = 'beta-connection-status'; usage.textContent = 'Cargando uso…';
      keylessUsageNodes[provider] = usage;
      item.append(name, ' — ', info.detail, ' ', usage);
      list.append(item);
    }
    card.append(title, description, list);
    connectorGrid.prepend(card);
  }
  function renderKeylessUsage() {
    for (const [provider, node] of Object.entries(keylessUsageNodes)) {
      const quota = providerQuotas[provider];
      node.textContent = quota?.keyless ? `Hoy: ${quota.used || 0} de ${quota.limit || '—'} consultas` : 'Sin datos todavía (el servidor de Beta aún no tiene esta IA)';
    }
  }

  const browserFrame = $('#beta-browser-frame');
  const workPreview = document.createElement('section');
  workPreview.className = 'beta-work-preview';
  const workPreviewTitle = document.createElement('strong');
  workPreviewTitle.textContent = 'Qué está haciendo Beta';
  const workPreviewState = document.createElement('span');
  workPreviewState.className = 'beta-work-state';
  const workPreviewText = document.createElement('p');
  workPreviewText.textContent = 'El progreso de cada consulta y el resultado de las acciones aparecerán acá.';
  const workPreviewLink = document.createElement('a');
  workPreviewLink.className = 'beta-provider-link hidden';
  workPreviewLink.target = '_blank';
  workPreviewLink.rel = 'noopener noreferrer';
  workPreviewLink.textContent = 'Abrir el destino en otra pestaña';
  workPreview.append(workPreviewTitle, workPreviewState, workPreviewText, workPreviewLink);
  browserFrame.parentElement.insertBefore(workPreview, browserFrame);
  browserFrame.hidden = true;
  const browserNote = $('#beta-browser-view .beta-note');
  if (browserNote) browserNote.textContent = 'GitHub, Supabase y Cloudflare bloquean la vista dentro de iframes. Beta muestra acá los pasos reales de la operación y su respuesta; abrí el destino en otra pestaña para ver el sitio del proveedor.';

  function showWorkPreview(message, state = 'active', title = 'Qué está haciendo Beta', url = '') {
    workPreview.hidden = false;
    browserFrame.hidden = true;
    workPreviewTitle.textContent = title;
    workPreviewText.textContent = message;
    workPreviewState.textContent = state === 'done' ? 'Completado' : state === 'error' ? 'Necesita atención' : 'En curso';
    workPreviewState.dataset.state = state;
    workPreviewLink.classList.toggle('hidden', !url);
    if (url) workPreviewLink.href = url;
  }

  function restoreModelHealth() {
    try { modelHealth = JSON.parse(localStorage.getItem(`mediachafa-beta-health:${ownerId}`) || '{}') || {}; }
    catch { modelHealth = {}; }
    for (const model of modelCatalog) model.health = modelHealth[model.id] || null;
  }

  function recordModelHealth(modelId, ok, error = '') {
    const health = { ok, checkedAt: Date.now(), error: String(error || '').slice(0, 260) };
    modelHealth[modelId] = health;
    const healthKeys = Object.keys(modelHealth);
    if (healthKeys.length > 200) {
      healthKeys.sort((a, b) => Number(modelHealth[a]?.checkedAt || 0) - Number(modelHealth[b]?.checkedAt || 0));
      for (const oldKey of healthKeys.slice(0, healthKeys.length - 200)) delete modelHealth[oldKey];
    }
    try { localStorage.setItem(`mediachafa-beta-health:${ownerId}`, JSON.stringify(modelHealth)); } catch {}
    const model = modelCatalog.find(item => item.id === modelId);
    if (model) model.health = health;
    renderModelOptions();
  }

  function modelHealthLabel(health) {
    if (!health?.checkedAt) return { icon: '⚪', state: 'unknown', text: 'Sin probar en este dispositivo' };
    const age = Date.now() - Number(health.checkedAt);
    const time = new Date(health.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (age > HEALTH_FRESH_MS) return { icon: '⚪', state: 'stale', text: `Última prueba ${time}; quedó vieja` };
    const elapsed = Math.max(0, Math.floor(age / 60000));
    const ago = elapsed < 1 ? 'recién' : `hace ${elapsed} min`;
    return health.ok
      ? { icon: '🟢', state: 'ok', text: `Respondió ${ago} (${time})` }
      : { icon: '🔴', state: 'error', text: `Falló ${ago} (${time}): ${health.error || 'error del proveedor'}` };
  }

  function updateModelUsage(modelId, usage = {}) {
    const model = modelCatalog.find(item => item.id === modelId);
    if (model) Object.assign(model, usage);
    renderModelOptions();
  }

  function renderModelOptions() {
    if (!modelCatalog.length) {
      modelSelect.replaceChildren(new Option('No hay modelos disponibles ahora', ''));
      modelSelect.disabled = true;
      modelHealthNote.textContent = 'Conectá un proveedor para comprobar modelos.';
      modelHealthNote.dataset.state = 'unknown';
      modelProbe.disabled = true;
      modelCount.textContent = 'Catálogo gratuito no conectado';
      $('#beta-count').textContent = 'No llegaron modelos del servidor de Beta. Las IAs sin cuenta aparecen solas; también podés conectar OpenRouter, Groq, Cohere o Gemini Free Tier en Integraciones.';
      imageInput.disabled = true;
      audioInput.disabled = true;
      return;
    }
    modelSelect.disabled = false;
    let prior = modelSelect.value;
    if (!prior) { try { prior = localStorage.getItem(`mediachafa-beta-model:${ownerId}`); } catch {} }
    modelSelect.replaceChildren(...modelCatalog.map(model => {
      const option = document.createElement('option');
      option.value = model.id;
      const health = modelHealthLabel(model.health || modelHealth[model.id]);
      const quotaLabel = model.unlimited ? ` · ${model.usedToday || 0} hoy · sin límite` : Number.isFinite(model.dailyLimit) ? ` · ${model.usedToday || 0}/${model.dailyLimit} ${model.quotaPeriod === 'month' ? 'mes' : 'hoy'}` : '';
      option.textContent = `${health.icon} ${model.own ? '⭐ ' : ''}${model.provider} · ${model.name} · pensamiento ${model.thinkingLevel || 'medio'}${quotaLabel}`;
      return option;
    }));
    modelSelect.value = modelCatalog.some(model => model.id === prior) ? prior : modelCatalog[0].id;
    const model = modelCatalog.find(item => item.id === modelSelect.value);
    const health = model ? modelHealthLabel(model.health || modelHealth[model.id]) : { state: 'unknown', text: 'Conectá un proveedor para comprobar modelos' };
    modelHealthNote.dataset.state = health.state;
    const goodCount = modelCatalog.filter(item => modelHealthLabel(item.health || modelHealth[item.id]).state === 'ok').length;
    const errorCount = modelCatalog.filter(item => modelHealthLabel(item.health || modelHealth[item.id]).state === 'error').length;
    const unknownCount = Math.max(0, modelCatalog.length - goodCount - errorCount);
    modelHealthNote.textContent = model ? `${health.icon} ${health.text} · ahora: ${goodCount} responden, ${errorCount} con error, ${unknownCount} sin probar/vencidos (15 min).` : health.text;
    modelProbe.disabled = !model || (!model.unlimited && Number(model.remaining) <= 0);
    const periodLabel = model?.quotaPeriod === 'month' ? 'este mes' : 'hoy';
    modelCount.textContent = model?.unlimited ? `Pensamiento ${model.thinkingLevel || 'medio'} · ${model.provider} · ${model.usedToday || 0} consultas hoy · sin límite · solo tu cuenta` : model ? `Pensamiento ${model.thinkingLevel || 'medio'} · ${model.provider} · ${model.usedToday || 0}/${model.dailyLimit || '—'} ${periodLabel}${model.rateLimit ? ` · ritmo: ${model.rateLimit}` : ''}${model.keyless ? ' · sin cuenta' : ''}` : 'Conectá proveedores para ver modelos gratuitos';
    $('#beta-count').textContent = model?.unlimited ? `${model.name}: la IA propia de MediaChafa, solo para tu cuenta. Sin límite de consultas de Beta (${model.usedToday || 0} usadas hoy). Usa primero tu Cloudflare y, si se satura, cambia sola a otro motor gratis.` : model ? `${model.usedToday || 0} de ${model.dailyLimit || '—'} consultas gratuitas usadas ${periodLabel} en ${model.provider}; ${model.remaining ?? '—'} disponibles para este modelo/proveedor.${model.rateLimit ? ` Límite del proveedor: ${model.rateLimit}.` : ''}` : 'Sin modelo seleccionado.';
    const imageLabel = document.querySelector('label[for="beta-image"]');
    const audioLabel = document.querySelector('label[for="beta-audio"]');
    const imageAllowed = Boolean(model?.vision);
    const audioAllowed = Boolean(model?.audio);
    imageInput.disabled = !imageAllowed;
    audioInput.disabled = !audioAllowed;
    imageLabel?.classList.toggle('beta-disabled', !imageAllowed);
    imageLabel?.setAttribute('title', imageAllowed ? 'Adjuntar imagen' : 'Este modelo no admite imágenes. Elegí un modelo que indique visión.');
    audioLabel?.classList.toggle('beta-disabled', !audioAllowed);
    audioLabel?.setAttribute('title', audioAllowed ? 'Adjuntar audio' : 'Este modelo no admite audio. Elegí un modelo que indique audio.');
  }

  const usageNote = document.createElement('p');
  usageNote.className = 'beta-model-note';
  usageNote.textContent = 'El indicador refleja consultas reales recientes: verde respondió, rojo falló y gris significa sin probar o vencido (15 min). Probar envía una consulta real y consume 1 de la cuota mostrada. Las IAs ⭐ MediaChafa cambian solas de motor gratuito si uno se agota; los demás modelos no cambian de proveedor. Nunca se activan modelos pagos.';
  modelControl.append(usageNote);
  modelProbe.addEventListener('click', () => {
    const model = modelCatalog.find(item => item.id === modelSelect.value);
    if (!model) return;
    if (input.value.trim() || pendingImage || pendingAudio) { setStatus('Enviá primero el texto del compositor para no reemplazarlo por la prueba.', 'error'); return; }
    if (!window.confirm(`Probar ${model.name} enviará una consulta real y usará 1 consulta gratuita de ${model.provider}. ¿Continuar?`)) return;
    input.value = 'Prueba de disponibilidad: respondé únicamente OK.';
    form.requestSubmit(sendButton);
  });

  modelSelect.addEventListener('change', () => {
    try { if (ownerId) localStorage.setItem(`mediachafa-beta-model:${ownerId}`, modelSelect.value); } catch {}
    renderModelOptions();
    const model = modelCatalog.find(item => item.id === modelSelect.value);
    setStatus(`${model?.name || 'Modelo'} seleccionado · pensamiento ${model?.thinkingLevel || 'medio'}${model?.vision ? ' · imagen' : ''}${model?.audio ? ' · audio' : ''}.`);
  });

  const betaWorkspace = $('#beta-panel .beta-workspace');
  const betaSidebar = document.createElement('aside');
  betaSidebar.className = 'beta-sidebar';
  betaSidebar.setAttribute('aria-label', 'Navegación de Beta');
  const betaSidebarSection = document.createElement('span');
  betaSidebarSection.className = 'beta-sidebar-section';
  betaSidebarSection.textContent = 'Recientes';
  const betaSidebarRecent = document.createElement('div');
  betaSidebarRecent.className = 'beta-sidebar-recent';
  betaSidebarRecent.textContent = 'Conversación actual';
  betaSidebar.append(betaHeader.querySelector('.beta-brand'), $('#beta-clear'), betaHeader.querySelector('.beta-nav'), betaSidebarSection, betaSidebarRecent);
  betaWorkspace.insertBefore(betaSidebar, betaHeader);

  // Keep the conversation and the live work view together on desktop, like an
  // assistant workspace. On phones the panes stack vertically to avoid a
  // miniature, horizontally scrolling layout.
  const workspaceStyle = document.createElement('style');
  workspaceStyle.textContent = `
    #beta-panel .beta-model-control{display:flex;flex-direction:column;gap:4px;min-width:220px;max-width:310px;color:#e9dddd;font-size:11px;font-weight:700}
    #beta-panel #beta-model-select{width:100%;min-width:0;padding:8px 10px;border:1px solid #6c2929;border-radius:9px;background:#161010;color:#fff;font-size:12px}
    #beta-panel .beta-model-count{color:#ffadad;font-size:10px;font-weight:500}
    #beta-panel .beta-model-health{display:block;font-size:10px;line-height:1.4;font-weight:600;color:#b9b9b9}
    #beta-panel .beta-model-health[data-state="ok"]{color:#71e09a}
    #beta-panel .beta-model-health[data-state="error"]{color:#ff7777}
    #beta-panel .beta-model-probe{align-self:flex-start;padding:5px 9px;border:1px solid #563030;border-radius:8px;background:#201414;color:#f3dede;font-size:10px;cursor:pointer}
    #beta-panel .beta-model-probe:disabled{opacity:.5;cursor:not-allowed}
    #beta-panel .beta-model-note{max-width:330px;margin:1px 0 0;color:#bdaaaa;font-size:9px;line-height:1.35;font-weight:400}
    #beta-panel .beta-disabled{opacity:.45;cursor:not-allowed}
    #beta-panel .beta-message-model{display:block;margin-top:7px;color:#d18a8a;font-size:10px}
    #beta-panel .beta-work-preview{flex:1;min-height:220px;overflow:auto;padding:20px;border:1px solid #512121;border-radius:14px;background:radial-gradient(ellipse at top right,#271010,#101010 55%);color:#f5eaea}
    #beta-panel .beta-work-preview>strong{display:block;margin-bottom:14px;color:#ffb4b4;font-size:15px}
    #beta-panel .beta-work-preview p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6}
    #beta-panel .beta-work-state{display:inline-block;padding:5px 9px;border:1px solid #623030;border-radius:999px;color:#ffb0b0;font-size:10px}
    #beta-panel .beta-work-state[data-state="done"]{color:#a7f0bd;border-color:#245b36}
    #beta-panel .beta-work-state[data-state="error"]{color:#ff8989;border-color:#713333}
    #beta-panel .beta-work-preview a{display:inline-block;margin-top:8px;color:#ffaaaa}
    #beta-panel #beta-browser-frame[hidden],#beta-panel .beta-work-preview[hidden]{display:none!important}
    #app.beta-mode #beta-panel .beta-workspace.beta-split-mode{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.92fr);grid-template-rows:auto minmax(0,1fr);gap:0 18px;height:calc(100svh - 86px);min-height:620px;overflow:hidden}
    #app.beta-mode #beta-panel .beta-split-mode>.beta-header{grid-column:1/-1;min-width:0}
    #app.beta-mode #beta-panel .beta-split-mode>#beta-chat-view,#app.beta-mode #beta-panel .beta-split-mode>#beta-browser-view{display:flex;min-width:0;min-height:0;overflow:hidden}
    #app.beta-mode #beta-panel .beta-split-mode>#beta-chat-view{border-right:1px solid #351717;padding-right:18px}
    #app.beta-mode #beta-panel .beta-split-mode .beta-chat-stage{width:100%;min-height:0;height:100%;margin:0;padding:22px 0 10px;justify-content:flex-end}
    #app.beta-mode #beta-panel .beta-split-mode .beta-chat-stage:not(.has-messages){justify-content:center}
    #app.beta-mode #beta-panel .beta-split-mode .beta-messages{flex:1;min-height:0;max-height:none;overflow:auto;padding:12px 8px}
    #app.beta-mode #beta-panel .beta-split-mode .beta-browser{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;margin:0;padding:16px 0 8px}
    #app.beta-mode #beta-panel .beta-split-mode .beta-browser-toolbar{flex:none}
    #app.beta-mode #beta-panel .beta-split-mode .beta-activity{flex:none;max-height:180px;overflow:auto}
    #app.beta-mode #beta-panel .beta-split-mode .beta-browser-frame{flex:1;min-height:220px;height:auto}
    #app.beta-mode #beta-panel .beta-split-mode .beta-note{flex:none;margin:8px 0}
    #app.beta-mode #beta-panel .beta-split-mode .beta-count{text-align:left}
    #app.beta-mode #beta-panel .beta-split-mode .beta-status-row{justify-content:flex-start}
    @media(max-width:820px){#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{display:flex;height:auto;min-height:0;overflow:visible;flex-direction:column;gap:0}#app.beta-mode #beta-panel .beta-split-mode>.beta-header{flex-wrap:wrap}#app.beta-mode #beta-panel .beta-split-mode .beta-brand{margin-right:0}#app.beta-mode #beta-panel .beta-model-control{order:2;max-width:none;width:100%}#app.beta-mode #beta-panel .beta-split-mode .beta-nav{order:3;width:100%;overflow:auto}#app.beta-mode #beta-panel .beta-split-mode>#beta-chat-view,#app.beta-mode #beta-panel .beta-split-mode>#beta-browser-view{overflow:visible}#app.beta-mode #beta-panel .beta-split-mode>#beta-chat-view{border-right:0;border-bottom:1px solid #351717;padding:0 0 16px}#app.beta-mode #beta-panel .beta-split-mode .beta-chat-stage{min-height:58svh;height:auto;padding:20px 0}#app.beta-mode #beta-panel .beta-split-mode .beta-messages{max-height:52svh;flex:1}#app.beta-mode #beta-panel .beta-split-mode .beta-browser{height:auto;padding:16px 0}#app.beta-mode #beta-panel .beta-split-mode .beta-browser-frame{flex:none;height:55svh}#app.beta-mode #beta-panel .beta-split-mode .beta-work-preview{min-height:160px}}
  `;
  
  document.head.append(workspaceStyle); const betaViewportStyle=document.createElement('style'); betaViewportStyle.textContent=`
html.beta-fullscreen,html.beta-fullscreen body{height:100%;overflow:hidden!important}
#app.beta-mode{display:flex;flex-direction:column;height:100svh;min-height:0;overflow:hidden}
#app.beta-mode>.topbar{flex:none}
#app.beta-mode>.wrap{flex:1;min-height:0;height:auto;max-width:none;width:100%;padding:6px 14px 10px;overflow:hidden}
#app.beta-mode #beta-panel{height:100%;min-height:0;overflow:hidden}
#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{display:grid;grid-template-columns:220px minmax(0,1.05fr) minmax(340px,.95fr);grid-template-rows:68px minmax(0,1fr);gap:0 14px;height:100%;min-height:0;overflow:hidden}
#app.beta-mode #beta-panel .beta-sidebar{grid-column:1;grid-row:1/3;display:flex;min-height:0;flex-direction:column;gap:12px;padding:12px 10px;border-right:1px solid rgba(255,255,255,.09);background:rgba(15,15,16,.7)}
#app.beta-mode #beta-panel .beta-sidebar .beta-brand{flex:none;margin:0 0 8px;padding:4px 6px;font-size:15px}
#app.beta-mode #beta-panel .beta-sidebar #beta-clear{width:100%;min-height:40px;text-align:left;padding:9px 12px;border-radius:10px;background:#222;color:#f3f3f3;border:1px solid #383838}
#app.beta-mode #beta-panel .beta-sidebar-section{margin:12px 6px 0;color:#929292;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
#app.beta-mode #beta-panel .beta-sidebar-recent{padding:10px 12px;border-radius:9px;background:rgba(255,255,255,.08);color:#f3f3f3;font-size:12px}
#app.beta-mode #beta-panel .beta-nav{display:flex;flex-direction:column;gap:4px;width:100%}
#app.beta-mode #beta-panel .beta-nav button{width:100%;min-height:39px;text-align:left;padding:9px 12px;border-radius:9px;color:#bdbdbd}
#app.beta-mode #beta-panel .beta-nav button.active,#app.beta-mode #beta-panel .beta-nav button:hover{background:#292929;color:#fff}
#app.beta-mode #beta-panel .beta-header{grid-column:2/4;grid-row:1;display:flex;align-items:center;justify-content:flex-end;min-width:0;min-height:0;padding:4px 4px 9px;border-bottom:1px solid rgba(255,255,255,.09)}
#app.beta-mode #beta-panel .beta-model-control{width:min(380px,100%);min-width:260px;max-width:380px}
#app.beta-mode #beta-panel .beta-model-note{display:none}
#app.beta-mode #beta-panel .beta-view.active{grid-row:2;min-height:0;overflow:hidden}
#app.beta-mode #beta-panel #beta-chat-view.active{grid-column:2;display:flex;min-width:0;border-right:1px solid rgba(255,255,255,.09);padding:0 14px 0 2px}
#app.beta-mode #beta-panel #beta-browser-view.active{grid-column:3;display:flex;min-width:0;padding:0 0 0 2px}
#app.beta-mode #beta-panel .beta-workspace:not(.beta-split-mode) #beta-browser-view.active{grid-column:2/4}
#app.beta-mode #beta-panel #beta-integrations-view.active{grid-column:2/4;display:flex;overflow:auto;padding:12px 6px}
#app.beta-mode #beta-panel .beta-chat-stage{width:100%;min-width:0;min-height:0;height:100%;margin:0;padding:12px 0 5px;justify-content:center}
#app.beta-mode #beta-panel .beta-chat-stage.has-messages{justify-content:flex-end;padding:8px 0 4px}
#app.beta-mode #beta-panel .beta-messages{flex:1;min-height:0;max-height:none;width:100%;overflow:auto;padding:12px 4px 18px}
#app.beta-mode #beta-panel .beta-message{max-width:min(96%,850px);font-size:15px;padding:13px 16px}
#app.beta-mode #beta-panel .beta-composer{width:100%;padding:14px 16px}
#app.beta-mode #beta-panel .beta-status-row,#app.beta-mode #beta-panel .beta-count{text-align:left;justify-content:flex-start}
#app.beta-mode #beta-panel .beta-browser{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;margin:0;padding:10px 0 5px}
#app.beta-mode #beta-panel .beta-browser-toolbar{flex:none}
#app.beta-mode #beta-panel .beta-activity{flex:none;max-height:clamp(100px,19vh,170px);overflow:auto}
#app.beta-mode #beta-panel .beta-work-preview{flex:1;min-height:100px;margin:8px 0;overflow:auto}
#app.beta-mode #beta-panel .beta-browser-frame{flex:1;min-height:0;height:auto}
#app.beta-mode #beta-panel .beta-note{flex:none;margin:4px 0;font-size:10px}
@media(max-width:900px){
#app.beta-mode>.wrap{padding:4px 8px 8px}
#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);gap:0;height:100%}
#app.beta-mode #beta-panel .beta-sidebar{grid-column:1;grid-row:1;flex-direction:row;align-items:center;gap:5px;padding:5px 0;border:0;border-bottom:1px solid rgba(255,255,255,.08);overflow-x:auto}
#app.beta-mode #beta-panel .beta-sidebar .beta-brand,#app.beta-mode #beta-panel .beta-sidebar-section,#app.beta-mode #beta-panel .beta-sidebar-recent{display:none}
#app.beta-mode #beta-panel .beta-sidebar #beta-clear{width:auto;min-width:max-content;min-height:36px;padding:7px 10px}
#app.beta-mode #beta-panel .beta-nav{flex-direction:row;min-width:max-content;width:auto}
#app.beta-mode #beta-panel .beta-nav button{width:auto;min-height:36px;padding:7px 12px}
#app.beta-mode #beta-panel .beta-header{grid-column:1;grid-row:2;justify-content:flex-start;padding:7px 0}
#app.beta-mode #beta-panel .beta-model-control{width:100%;max-width:none;min-width:0}
#app.beta-mode #beta-panel .beta-view.active{grid-column:1!important;grid-row:3;min-height:0}
#app.beta-mode #beta-panel .beta-workspace.beta-split-mode #beta-browser-view{display:none!important}
#app.beta-mode #beta-panel #beta-chat-view.active{border:0;padding:0}
#app.beta-mode #beta-panel #beta-browser-view.active,#app.beta-mode #beta-panel #beta-integrations-view.active{overflow:auto}
#app.beta-mode #beta-panel .beta-chat-stage{padding:8px 0 4px}
#app.beta-mode #beta-panel .beta-message{max-width:98%;font-size:14px}
#app.beta-mode #beta-panel .beta-composer{padding:11px 12px;border-radius:18px}
#app.beta-mode #beta-panel .beta-browser{padding:8px 0}
#app.beta-mode #beta-panel .beta-browser-frame{flex:none;height:45svh}
}
`; document.head.append(betaViewportStyle); const betaApp=$('#app'); if(betaApp){const syncBetaViewport=()=>{const active=betaApp.classList.contains('beta-mode');document.documentElement.classList.toggle('beta-fullscreen',active);if(active&&window.scrollY)window.scrollTo(0,0)};new MutationObserver(syncBetaViewport).observe(betaApp,{attributes:true,attributeFilter:['class']});syncBetaViewport()} const projectMapStyle = document.createElement('style'); projectMapStyle.textContent = `#beta-panel .beta-private-map{width:min(1040px,100%);margin:0 auto 18px;background:linear-gradient(135deg,#1a1111,#101010);border-color:#562626}#beta-panel .beta-map-details{margin-top:12px;border-top:1px solid #3b2424;padding-top:10px;color:#f5eaea}#beta-panel .beta-map-details summary{cursor:pointer;color:#ffb4b4;font-size:12px}#beta-panel .beta-map-details pre{max-height:48vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid #382323;border-radius:10px;background:#0b0b0b;color:#ddd;font:11px/1.5 ui-monospace,monospace}`;
  document.head.append(projectMapStyle);

  const betaCleanStyle = document.createElement('style');
  betaCleanStyle.textContent = `
#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{grid-template-columns:240px minmax(0,1fr) minmax(320px,380px);grid-template-rows:auto minmax(0,1fr);gap:0;background:#171717;border-radius:16px;border:1px solid rgba(255,255,255,.06)}
#app.beta-mode #beta-panel .beta-sidebar{background:#121212;border-right:1px solid rgba(255,255,255,.06);padding:14px 10px;gap:6px;border-radius:16px 0 0 16px}
#app.beta-mode #beta-panel .beta-sidebar #beta-clear{background:transparent;border:1px solid rgba(255,255,255,.12);font-size:13px}
#app.beta-mode #beta-panel .beta-sidebar #beta-clear:hover{background:#242424}
#app.beta-mode #beta-panel .beta-nav button{font-size:14px;color:#cfcfcf}
#app.beta-mode #beta-panel .beta-nav button.active{background:#262626;color:#fff;box-shadow:inset 3px 0 0 #e0353b}
#app.beta-mode #beta-panel .beta-sidebar-section{font-size:11px;color:#8a8a8a;margin-top:18px}
#app.beta-mode #beta-panel .beta-sidebar-recent{background:#222;font-size:13px}
#app.beta-mode #beta-panel .beta-header{grid-column:2/4;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.06);justify-content:center;background:#171717}
#app.beta-mode #beta-panel .beta-model-control{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px;width:min(720px,100%);max-width:720px;min-width:0}
#app.beta-mode #beta-panel #beta-model-select{grid-column:1;background:#212121;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 12px;font-size:13px}
#app.beta-mode #beta-panel .beta-model-probe{grid-column:2;grid-row:1;align-self:center;background:#212121;border-color:rgba(255,255,255,.14);padding:8px 12px;font-size:11px}
#app.beta-mode #beta-panel .beta-model-health,#app.beta-mode #beta-panel .beta-model-count{grid-column:1/-1;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app.beta-mode #beta-panel #beta-chat-view.active{border-right:1px solid rgba(255,255,255,.06);padding:0}
#app.beta-mode #beta-panel .beta-chat-stage{width:100%;padding:0 0 14px}
#app.beta-mode #beta-panel .beta-messages{width:100%;max-width:none;padding:24px max(18px,calc((100% - 760px)/2)) 24px;gap:22px;scrollbar-width:thin;scrollbar-color:#3a3a3a transparent}
#app.beta-mode #beta-panel .beta-chat-stage form,#app.beta-mode #beta-panel .beta-status-row,#app.beta-mode #beta-panel .beta-count,#app.beta-mode #beta-panel .beta-status{width:min(760px,calc(100% - 36px));margin-left:auto;margin-right:auto}
#app.beta-mode #beta-panel .beta-prompt-title{font-size:28px;font-weight:600;color:#f2f2f2}
#app.beta-mode #beta-panel .beta-message{position:relative;max-width:100%;padding:0;background:transparent!important;border:0!important;color:#ececec;font-size:15px;line-height:1.7}
#app.beta-mode #beta-panel .beta-message strong{color:#9a9a9a!important;font-size:12px;font-weight:600;margin-bottom:6px}
#app.beta-mode #beta-panel .beta-message.assistant{padding-right:70px}
#app.beta-mode #beta-panel .beta-message.user{max-width:min(78%,600px);padding:11px 16px;background:#2f2f2f!important;border-radius:20px;color:#fff}
#app.beta-mode #beta-panel .beta-message.user strong{display:none}
#app.beta-mode #beta-panel .beta-message.failed{outline:1px solid #8a2a2a}
#app.beta-mode #beta-panel .beta-message-model{color:#7d7d7d;font-size:11px}
#app.beta-mode #beta-panel .beta-copy-btn{position:absolute;top:0;right:0;padding:4px 10px;font-size:11px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#212121;color:#d8d8d8;cursor:pointer;opacity:.7;transition:opacity .15s,background .15s}
#app.beta-mode #beta-panel .beta-copy-btn:hover{opacity:1;background:#2c2c2c}
#app.beta-mode #beta-panel .beta-message a.beta-link{color:#4da3ff;text-decoration:underline;word-break:break-all;cursor:pointer}
#app.beta-mode #beta-panel .beta-message a.beta-link:hover{color:#7bbcff}
#app.beta-mode #beta-panel .beta-message.user .beta-copy-btn{position:static;display:block;margin:8px 0 0 auto}
#app.beta-mode #beta-panel .beta-proposal{margin-top:14px;padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#1f1f1f;white-space:normal;transition:opacity .25s,transform .25s}
#app.beta-mode #beta-panel .beta-proposal pre{max-height:220px;overflow:auto;background:#141414;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;font-size:12px;color:#ddd}
#app.beta-mode #beta-panel .beta-proposal small{display:block;color:#8f8f8f;margin:8px 0}
#app.beta-mode #beta-panel .beta-proposal-controls{display:flex;gap:8px}
#app.beta-mode #beta-panel .beta-proposal-leaving{opacity:0;transform:translateY(-6px)}
#app.beta-mode #beta-panel .beta-composer{background:#262626!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:24px;box-shadow:0 8px 28px rgba(0,0,0,.35)}
#app.beta-mode #beta-panel .beta-compose textarea{min-height:48px;font-size:15px}
#app.beta-mode #beta-panel .beta-tools label{background:transparent;border:1px solid rgba(255,255,255,.12);color:#cfcfcf}
#app.beta-mode #beta-panel #beta-send{width:38px;height:38px;border-radius:50%;padding:0}
#app.beta-mode #beta-panel .beta-count{color:#7a7a7a;text-align:center}
#app.beta-mode #beta-panel .beta-status-row{justify-content:center!important}
#app.beta-mode #beta-panel #beta-browser-view.active{padding:0 14px;background:#141414;border-radius:0 0 16px 0;overflow:auto}
#app.beta-mode #beta-panel .beta-activity,#app.beta-mode #beta-panel .beta-work-preview{background:#1b1b1b!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:14px}
@media(max-width:1100px){#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{grid-template-columns:200px minmax(0,1fr) 300px}}
@media(max-width:820px){#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{display:flex;flex-direction:column;overflow:auto}#app.beta-mode #beta-panel .beta-sidebar{border-right:0;border-bottom:1px solid rgba(255,255,255,.06);border-radius:16px 16px 0 0}#app.beta-mode #beta-panel .beta-message.assistant{padding-right:0;padding-top:26px}#app.beta-mode #beta-panel .beta-model-control{grid-template-columns:1fr}#app.beta-mode #beta-panel .beta-model-probe{grid-column:1;grid-row:auto}}
`;
  document.head.append(betaCleanStyle);

  // Compact header: model chip (opens centered picker) + activity drawer toggle.
  const betaTopStyle = document.createElement('style');
  betaTopStyle.textContent = `
#app.beta-mode #beta-panel .beta-workspace,#app.beta-mode #beta-panel .beta-workspace.beta-split-mode{position:relative;grid-template-columns:240px minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr)!important}
#app.beta-mode #beta-panel .beta-header{grid-column:2!important;justify-content:flex-end!important;gap:8px;padding:8px 14px!important;min-height:0}
#app.beta-mode #beta-panel #beta-chat-view.active{grid-column:2!important;border-right:0!important}
#app.beta-mode #beta-panel .beta-workspace:not(.beta-split-mode) #beta-browser-view.active{grid-column:2!important;position:static}
#app.beta-mode #beta-panel #beta-integrations-view.active{grid-column:2!important}
#app.beta-mode #beta-panel .beta-workspace.beta-split-mode #beta-browser-view{display:none!important}
#app.beta-mode #beta-panel .beta-workspace.beta-split-mode.beta-activity-open #beta-browser-view{display:flex!important;position:absolute;top:0;right:0;bottom:0;width:min(400px,92%);z-index:30;flex-direction:column;padding:12px 14px!important;background:#141414;border-left:1px solid rgba(255,255,255,.1);border-radius:0 16px 16px 0;box-shadow:-18px 0 40px rgba(0,0,0,.5);overflow:auto;animation:betaSlide .2s ease}
@keyframes betaSlide{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
#app.beta-mode #beta-panel .beta-drawer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#f2f2f2;font-weight:700;font-size:14px}
#app.beta-mode #beta-panel .beta-workspace:not(.beta-split-mode) .beta-drawer-head{display:none}
#app.beta-mode #beta-panel .beta-x{width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#222;color:#eee;font-size:16px;cursor:pointer}
#app.beta-mode #beta-panel .beta-chip{display:inline-flex;align-items:center;gap:6px;max-width:320px;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:#212121;color:#e8e8e8;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app.beta-mode #beta-panel .beta-chip:hover{background:#2b2b2b}
#app.beta-mode #beta-panel .beta-chip span{overflow:hidden;text-overflow:ellipsis}
#app.beta-mode #beta-panel .beta-workspace.beta-activity-open .beta-chip-activity{background:#3a1416;border-color:#7a2a2a}
.beta-model-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)}
.beta-model-modal.open{display:flex}
.beta-model-card{width:min(640px,92vw);max-height:86vh;overflow:auto;padding:22px;border-radius:18px;background:#1b1b1b;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.6);color:#eee}
.beta-model-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:17px;font-weight:700}
.beta-model-card .beta-model-control{display:flex!important;flex-direction:column!important;gap:10px!important;width:100%!important;max-width:none!important;min-width:0!important;font-size:12px}
.beta-model-card #beta-model-select{width:100%;padding:10px 12px;border-radius:12px;background:#121212;color:#fff;border:1px solid rgba(255,255,255,.14);font-size:14px}
.beta-model-card #beta-model-select[size]{height:auto;max-height:52vh}
.beta-model-card #beta-model-select option{padding:8px 10px;border-radius:8px}
.beta-model-card .beta-model-health,.beta-model-card .beta-model-count,.beta-model-card .beta-model-note{display:block!important;white-space:normal!important;font-size:12px}
.beta-model-card .beta-model-probe{align-self:flex-start;padding:8px 14px;border-radius:10px;background:#262626;color:#eee;border:1px solid rgba(255,255,255,.14);cursor:pointer}
.beta-model-card .beta-x{width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#222;color:#eee;font-size:16px;cursor:pointer}
@media(max-width:820px){#app.beta-mode #beta-panel .beta-workspace.beta-split-mode.beta-activity-open #beta-browser-view{position:fixed;width:100%;border-radius:0}}
`;
  betaTopStyle.textContent += `
#app.beta-mode #beta-panel .beta-sidebar-recent{display:flex;flex-direction:column;gap:2px;padding:0!important;background:transparent!important;overflow:auto;min-height:0;flex:1}
#app.beta-mode #beta-panel .beta-thread{display:flex;align-items:center;border-radius:9px}
#app.beta-mode #beta-panel .beta-thread:hover{background:#1f1f1f}
#app.beta-mode #beta-panel .beta-thread.active{background:#262626}
#app.beta-mode #beta-panel .beta-thread-open{flex:1;min-width:0;text-align:left;padding:9px 10px;background:transparent;border:0;color:#d9d9d9;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
#app.beta-mode #beta-panel .beta-thread.active .beta-thread-open{color:#fff}
#app.beta-mode #beta-panel .beta-thread-del{flex:none;width:26px;height:26px;margin-right:4px;border:0;border-radius:6px;background:transparent;color:#888;font-size:11px;cursor:pointer;opacity:0}
#app.beta-mode #beta-panel .beta-thread:hover .beta-thread-del,#app.beta-mode #beta-panel .beta-thread.active .beta-thread-del{opacity:1}
#app.beta-mode #beta-panel .beta-thread-del:hover{background:#3a1416;color:#ff9a9a}
#app.beta-mode #beta-panel .beta-steps{margin:0 0 10px;color:#9b9b9b;font-size:13px}
#app.beta-mode #beta-panel .beta-steps summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px}
#app.beta-mode #beta-panel .beta-steps summary::before{content:'›';display:inline-block;transition:transform .15s;font-size:15px}
#app.beta-mode #beta-panel .beta-steps[open] summary::before{transform:rotate(90deg)}
#app.beta-mode #beta-panel .beta-steps ul,#app.beta-mode #beta-panel .beta-live-steps{list-style:none;margin:8px 0 4px;padding:0 0 0 4px;display:flex;flex-direction:column;gap:6px;white-space:normal}
#app.beta-mode #beta-panel .beta-steps li,#app.beta-mode #beta-panel .beta-live-steps li{position:relative;padding-left:22px;color:#a8a8a8;font-size:13px;line-height:1.45}
#app.beta-mode #beta-panel .beta-steps li::before,#app.beta-mode #beta-panel .beta-live-steps li[data-state=done]::before{content:'✓';position:absolute;left:2px;top:0;color:#6fcf8f;font-size:12px}
#app.beta-mode #beta-panel .beta-live-steps li[data-state=active]{color:#ececec}
#app.beta-mode #beta-panel .beta-live-steps li[data-state=active]::before{content:'';position:absolute;left:2px;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid #e0353b;border-top-color:transparent;animation:betaSpin .8s linear infinite}
@keyframes betaSpin{to{transform:rotate(360deg)}}
#app.beta-mode #beta-panel .beta-working>p{color:#7d7d7d;font-size:13px;animation:betaPulse 1.4s ease-in-out infinite}
@keyframes betaPulse{50%{opacity:.45}}
`;
  document.head.append(betaTopStyle);

  const modelModal = document.createElement('div');
  modelModal.className = 'beta-model-modal';
  modelModal.setAttribute('role', 'dialog');
  modelModal.setAttribute('aria-modal', 'true');
  const modelCard = document.createElement('div');
  modelCard.className = 'beta-model-card';
  const modelCardHead = document.createElement('div');
  modelCardHead.className = 'beta-model-card-head';
  const modelCardTitle = document.createElement('span');
  modelCardTitle.textContent = 'Elegir modelo de IA';
  const modelClose = document.createElement('button');
  modelClose.type = 'button'; modelClose.className = 'beta-x'; modelClose.textContent = '✕'; modelClose.setAttribute('aria-label', 'Cerrar');
  modelCardHead.append(modelCardTitle, modelClose);
  modelCard.append(modelCardHead, modelControl);
  modelModal.append(modelCard);
  document.body.append(modelModal);

  const modelChip = document.createElement('button');
  modelChip.type = 'button'; modelChip.className = 'beta-chip'; modelChip.title = 'Cambiar modelo de IA';
  const modelChipText = document.createElement('span');
  modelChip.append(modelChipText, document.createTextNode(' ▾'));
  const activityChip = document.createElement('button');
  activityChip.type = 'button'; activityChip.className = 'beta-chip beta-chip-activity'; activityChip.textContent = 'Actividad';
  activityChip.title = 'Ver qué está haciendo Beta';
  betaHeader.append(modelChip, activityChip);

  const syncChip = () => {
    const opt = modelSelect.options[modelSelect.selectedIndex];
    modelChipText.textContent = opt ? opt.textContent.split('·').slice(0, 2).join('·').trim() : 'Modelo de IA';
  };
  new MutationObserver(syncChip).observe(modelSelect, { childList: true, subtree: true, attributes: true });
  modelSelect.addEventListener('change', () => { syncChip(); closeModelModal(); });
  syncChip();

  function openModelModal() {
    modelSelect.size = Math.min(Math.max(modelSelect.options.length, 2), 12);
    modelModal.classList.add('open');
    modelSelect.focus();
  }
  function closeModelModal() { modelModal.classList.remove('open'); }
  modelChip.addEventListener('click', openModelModal);
  modelProbe.addEventListener('click', closeModelModal);
  modelClose.addEventListener('click', closeModelModal);
  modelModal.addEventListener('click', (e) => { if (e.target === modelModal) closeModelModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModelModal(); betaWorkspace.classList.remove('beta-activity-open'); } });

  const browserView = $('#beta-browser-view');
  const drawerHead = document.createElement('div');
  drawerHead.className = 'beta-drawer-head';
  const drawerTitle = document.createElement('span');
  drawerTitle.textContent = 'Qué está haciendo Beta';
  const drawerClose = document.createElement('button');
  drawerClose.type = 'button'; drawerClose.className = 'beta-x'; drawerClose.textContent = '✕'; drawerClose.setAttribute('aria-label', 'Cerrar actividad');
  drawerHead.append(drawerTitle, drawerClose);
  browserView?.prepend(drawerHead);
  const toggleActivity = (force) => {
    if (!betaWorkspace.classList.contains('beta-split-mode')) selectBetaView('chat');
    betaWorkspace.classList.toggle('beta-activity-open', force);
  };
  activityChip.addEventListener('click', () => toggleActivity());
  drawerClose.addEventListener('click', () => toggleActivity(false));
  $('#beta-show-activity')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); toggleActivity(true); }, true);

  function activity(message, state = 'active') {
    if (!activityList) return;
    if (state === 'active') activityItems = activityItems.map(item => item.state === 'active' ? { ...item, state: 'done' } : item);
    activityItems.push({ message, state, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    activityItems = activityItems.slice(-6);
    activityList.replaceChildren(...activityItems.map(item => {
      const row = document.createElement('li');
      row.dataset.state = item.state;
      row.textContent = `${item.at} · ${item.message}`;
      return row;
    }));
    showWorkPreview(message, state);
  }

  function selectBetaView(view) {
    const split = view === 'chat';
    $('#beta-panel .beta-workspace')?.classList.toggle('beta-split-mode', split);
    document.querySelectorAll('[data-beta-view]').forEach(button => button.classList.toggle('active', button.dataset.betaView === view));
    document.querySelectorAll('.beta-view').forEach(panel => {
      const panelView = panel.id.replace(/^beta-/, '').replace(/-view$/, '');
      panel.classList.toggle('active', panelView === view || (split && panelView === 'browser'));
    });
  }

  function setStatus(message, kind = 'idle') {
    status.textContent = message;
    status.dataset.state = kind;
  }

  let currentThreadId = '';
  let threads = [];
  function threadsKey() { return `mediachafa-beta-threads:${ownerId}`; }
  function storageKey() { return `mediachafa-beta-chat:${ownerId}:${currentThreadId}`; }
  function newThreadId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function saveThreads() { try { localStorage.setItem(threadsKey(), JSON.stringify(threads)); localStorage.setItem(threadsKey() + ':active', currentThreadId); } catch {} }
  function titleFrom(text) {
    const clean = String(text || '').replace(/\[(Imagen|Audio):[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Chat sin título';
    const t = clean.replace(/^(hola|buenas|hey|che)[,!.\s]+/i, '') || clean;
    return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 42) + (t.length > 42 ? '…' : '');
  }
  function ensureThreads() {
    try { threads = JSON.parse(localStorage.getItem(threadsKey()) || '[]'); } catch { threads = []; }
    if (!Array.isArray(threads)) threads = [];
    if (!threads.length) {
      const id = newThreadId();
      let legacy = null;
      try { legacy = localStorage.getItem(`mediachafa-beta-chat:${ownerId}`); } catch {}
      let title = 'Nuevo chat';
      if (legacy) {
        try { const arr = JSON.parse(legacy); const first = arr.find(m => m.role === 'user'); if (first) title = titleFrom(first.content); localStorage.setItem(`mediachafa-beta-chat:${ownerId}:${id}`, legacy); localStorage.removeItem(`mediachafa-beta-chat:${ownerId}`); } catch {}
      }
      threads = [{ id, title, updatedAt: Date.now() }];
    }
    let active = '';
    try { active = localStorage.getItem(threadsKey() + ':active') || ''; } catch {}
    currentThreadId = threads.some(t => t.id === active) ? active : threads[0].id;
    saveThreads();
  }
  function renderThreadList() {
    const rows = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).map(thread => {
      const row = document.createElement('div');
      row.className = 'beta-thread' + (thread.id === currentThreadId ? ' active' : '');
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'beta-thread-open'; open.textContent = thread.title; open.title = thread.title;
      open.addEventListener('click', () => switchThread(thread.id));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'beta-thread-del'; del.textContent = '✕'; del.title = 'Borrar chat'; del.setAttribute('aria-label', `Borrar ${thread.title}`);
      del.addEventListener('click', () => deleteThread(thread.id));
      row.append(open, del);
      return row;
    });
    betaSidebarRecent.replaceChildren(...rows);
  }
  function switchThread(id) {
    if (sendButton.disabled || autonomousRun) { setStatus('Esperá a que Beta termine o pausá el trabajo antes de cambiar de chat.', 'error'); return; }
    currentThreadId = id;
    saveThreads();
    restoreHistory();
    selectBetaView('chat');
    input.focus();
  }
  function createThread() {
    if (sendButton.disabled || autonomousRun) { setStatus('Esperá a que Beta termine o pausá el trabajo antes de cambiar de chat.', 'error'); return; }
    const empty = threads.find(t => t.title === 'Nuevo chat');
    if (empty) { switchThread(empty.id); return; }
    const thread = { id: newThreadId(), title: 'Nuevo chat', updatedAt: Date.now() };
    threads.push(thread);
    switchThread(thread.id);
    setStatus('Nuevo chat listo.');
  }
  function deleteThread(id) {
    const thread = threads.find(t => t.id === id);
    if (!thread || !window.confirm(`¿Borrar el chat "${thread.title}" de este dispositivo?`)) return;
    try { localStorage.removeItem(`mediachafa-beta-chat:${ownerId}:${id}`); } catch {}
    threads = threads.filter(t => t.id !== id);
    if (!threads.length) threads.push({ id: newThreadId(), title: 'Nuevo chat', updatedAt: Date.now() });
    if (currentThreadId === id) currentThreadId = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    saveThreads();
    restoreHistory();
  }

  function saveHistory() {
    if (!ownerId) return;
    const recent = history.slice(-30);
    let photos = 0;
    const slim = (keep) => recent.slice().reverse().map(item => {
      if (!item.report) return item;
      photos += 1;
      return photos <= keep ? item : { ...item, report: { ...item.report, images: [] } };
    }).reverse();
    for (const keep of [4, 1, 0]) {
      photos = 0;
      try { localStorage.setItem(storageKey(), JSON.stringify(slim(keep))); break; } catch {}
    }
    const thread = threads.find(t => t.id === currentThreadId);
    if (thread) {
      if (thread.title === 'Nuevo chat') { const first = history.find(m => m.role === 'user'); if (first) thread.title = titleFrom(first.content); }
      thread.updatedAt = Date.now();
      saveThreads();
      renderThreadList();
    }
  }

  function attachSteps(node, steps, open = false) {
    if (!steps?.length) return;
    const details = document.createElement('details');
    details.className = 'beta-steps';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = `Beta trabajó en ${steps.length} paso${steps.length === 1 ? '' : 's'}`;
    const list = document.createElement('ul');
    for (const step of steps) { const li = document.createElement('li'); li.textContent = step; list.append(li); }
    details.append(summary, list);
    const body = node.querySelector('p');
    node.insertBefore(details, body);
  }

  // Convierte los enlaces (https://..., www....) en links azules que abren en otra pestaña.
  function renderLinkedText(node, text) {
    const value = String(text ?? '');
    const pattern = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
    const parts = [];
    let last = 0;
    for (const match of value.matchAll(pattern)) {
      let url = match[1];
      const trailing = url.match(/[.,;:!?)\]}]+$/);
      if (trailing) url = url.slice(0, -trailing[0].length);
      if (match.index > last) parts.push(document.createTextNode(value.slice(last, match.index)));
      const link = document.createElement('a');
      link.href = /^www\./i.test(url) ? `https://${url}` : url;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'beta-link';
      parts.push(link);
      last = match.index + url.length;
    }
    if (last < value.length) parts.push(document.createTextNode(value.slice(last)));
    node.replaceChildren(...parts);
  }

  function addMessage(role, content, modelName = '') {
    const article = document.createElement('article');
    article.className = `beta-message ${role}`;
    const heading = document.createElement('strong');
    heading.textContent = role === 'user' ? 'Vos' : 'Beta';
    const body = document.createElement('p');
    renderLinkedText(body, content);
    article.append(heading, body);
    {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'beta-copy-btn';
      copyBtn.title = 'Copiar mensaje';
      copyBtn.setAttribute('aria-label', 'Copiar mensaje');
      copyBtn.textContent = 'Copiar';
      copyBtn.addEventListener('click', async () => {
        const text = body.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.append(ta); ta.select();
          try { document.execCommand('copy'); } catch {}
          ta.remove();
        }
        copyBtn.textContent = 'Copiado';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1500);
      });
      article.append(copyBtn);
    }
    if (role === 'assistant' && modelName) {
      const modelBadge = document.createElement('small');
      modelBadge.className = 'beta-message-model';
      modelBadge.textContent = `Modelo: ${modelName}`;
      article.append(modelBadge);
    }
    messagesNode.append(article);
    messagesNode.scrollTop = messagesNode.scrollHeight;
    stage.classList.add('has-messages');
    return article;
  }

  function resolveProposal(actionId, card) {
    for (const item of history) {
      if (Array.isArray(item.proposals)) item.proposals = item.proposals.filter(p => p.id !== actionId);
    }
    saveHistory();
    setTimeout(() => { card.classList.add('beta-proposal-leaving'); setTimeout(() => card.remove(), 260); }, 1400);
  }

  function renderProposals(messageNode, proposals, expiresInSeconds = 600, hooks = {}) {
    const runners = [];
    let bulkBar;
    if ((proposals || []).length >= 2) {
      bulkBar = document.createElement('div');
      bulkBar.className = 'beta-proposal beta-bulk-approve';
      const info = document.createElement('p');
      info.textContent = `Beta preparó ${proposals.length} pasos para completar tu pedido. Podés revisarlos abajo y aprobarlos todos juntos: se ejecutan en orden y se frena si alguno falla.`;
      const bulkControls = document.createElement('div');
      bulkControls.className = 'beta-proposal-controls';
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'add-btn beta-action-approve-all';
      all.textContent = `Aprobar todo en orden (${proposals.length})`;
      const bulkResult = document.createElement('span');
      bulkResult.className = 'beta-action-result';
      bulkControls.append(all);
      bulkBar.append(info, bulkControls, bulkResult);
      messageNode.append(bulkBar);
      all.addEventListener('click', async () => {
        const pending = runners.filter((runner) => !runner.done());
        if (!pending.length) return;
        if (!window.confirm(`Se van a ejecutar ${pending.length} paso(s) en orden:\n\n${pending.map((runner, i) => `${i + 1}. ${runner.label}`).join('\n')}\n\n¿Continuar?`)) return;
        all.disabled = true;
        for (let i = 0; i < pending.length; i++) {
          bulkResult.textContent = `Ejecutando paso ${i + 1} de ${pending.length}…`;
          bulkResult.dataset.state = '';
          const ok = await pending[i].run();
          if (!ok) {
            bulkResult.textContent = `Se frenó en el paso ${i + 1}: revisá el error en esa tarjeta. Los pasos siguientes no se ejecutaron.`;
            bulkResult.dataset.state = 'error';
            all.disabled = false;
            return;
          }
        }
        bulkResult.textContent = `Listo: se completaron los ${pending.length} pasos.`;
        bulkResult.dataset.state = 'done';
        setTimeout(() => { bulkBar.classList.add('beta-proposal-leaving'); setTimeout(() => bulkBar.remove(), 260); }, 2500);
      });
    }
    for (const proposal of proposals || []) {
      const card = document.createElement('section');
      card.className = 'beta-proposal';
      card.dataset.actionId = proposal.id;
      const destructive = ['delete_path', 'delete_repository'].includes(proposal.type);
      card.dataset.destructive = destructive ? 'true' : 'false';
      const title = document.createElement('strong');
      title.textContent = `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`;
      const summary = document.createElement('p');
      summary.textContent = proposal.summary;
      card.append(title, summary);
      if (proposal.repository || proposal.path || proposal.name) {
        const target = document.createElement('p');
        target.className = 'beta-proposal-target';
        target.textContent = [proposal.repository ? `Repositorio: ${proposal.repository}` : '', proposal.path ? `Ruta: ${proposal.path}` : '', proposal.name ? `Nombre: ${proposal.name}` : '', proposal.visibility ? `Visibilidad: ${proposal.visibility === 'public' ? 'pública' : 'privada'}` : '', proposal.fileCount ? `Archivos: ${proposal.fileCount}` : ''].filter(Boolean).join(' · ');
        card.append(target);
      }
      if (Array.isArray(proposal.affectedPaths) && proposal.affectedPaths.length) {
        const affected = document.createElement('pre');
        affected.textContent = `Archivos que se borrarán (${proposal.affectedCount || proposal.affectedPaths.length}):\n${proposal.affectedPaths.join('\n')}`;
        card.append(affected);
      }
      const detail = proposal.query ?? proposal.content;
      if (detail !== undefined) {
        const pre = document.createElement('pre');
        pre.textContent = detail;
        card.append(pre);
      }
      const warning = document.createElement('small');
      warning.textContent = destructive
        ? `BORRADO DESTRUCTIVO · revisá el destino y los archivos enumerados. Al aprobar, tendrás que escribirlo exactamente. La propuesta vence en ${Math.ceil(expiresInSeconds / 60)} min.`
        : `Vista previa exacta · vence en ${Math.ceil(expiresInSeconds / 60)} min · se ejecutará solo si aprobás esta vez.`;
      card.append(warning);
      const controls = document.createElement('div');
      controls.className = 'beta-proposal-controls';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'add-btn beta-action-approve';
      approve.textContent = destructive ? 'Continuar con el borrado…' : 'Aprobar una vez';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'secondary beta-action-reject';
      reject.textContent = 'Denegar';
      const result = document.createElement('span');
      result.className = 'beta-action-result';
      controls.append(approve, reject);
      card.append(controls, result);
      let finished = false;
      const runApprove = async () => {
        if (destructive) {
          const exactTarget = proposal.type === 'delete_repository' ? proposal.repository : `${proposal.repository}:${proposal.path}`;
          const typedTarget = window.prompt(`Borrado destructivo de GitHub. Escribí exactamente:\n${exactTarget}\n\nSi confirmás, no hay botón para deshacer desde Beta.`, '');
          if (typedTarget !== exactTarget) {
            result.textContent = 'Borrado cancelado; no se envió a GitHub.';
            result.dataset.state = 'error';
            return false;
          }
        }
        approve.disabled = reject.disabled = true;
        result.textContent = 'Enviando al proveedor…';
        let visualPrep = null;
        try { visualPrep = window.MediaChafaVisualCheck?.prepare(proposal) || null; } catch { visualPrep = null; }
        activity(`Preparando aprobación de ${proposal.provider}: ${proposal.summary}`);
        selectBetaView('chat');
        try {
          const data = await api(`/actions/${encodeURIComponent(proposal.id)}/approve`, { method: 'POST', body: '{}' });
          result.textContent = data.message || 'Cambio aplicado.';
          result.dataset.state = 'done';
          if (data.url) {
            $('#beta-browser-url').value = data.url;
          }
          const link = document.createElement('a');
          link.href = data.url || '#';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.className = 'beta-provider-link';
          link.textContent = 'Ver en el servicio';
          if (data.url) result.append(' ', link);
          activity(`${proposal.provider}: ${data.message || 'Cambio aplicado.'}`, 'done');
          showWorkPreview(data.message || 'Cambio aplicado.', 'done', `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`, data.url || '');
          const doneText = `${data.message || 'Cambio aplicado.'}${data.url ? `\n${data.url}` : ''}`;
          addMessage('assistant', doneText);
          history.push({ role: 'assistant', content: doneText });
          finished = true;
          resolveProposal(proposal.id, card);
          queueVisualReview(visualPrep, data);
          hooks.onResult?.(proposal, { ok: true, message: data.message || 'Cambio aplicado.', url: data.url || '' });
          return true;
        } catch (error) {
          result.textContent = error.message;
          result.dataset.state = 'error';
          approve.disabled = false;
          if (/venci|expir|no existe|not found|ya fue|already/i.test(error.message || '')) resolveProposal(proposal.id, card);
          activity(`La acción en ${proposal.provider} no se completó: ${error.message}`, 'error');
          showWorkPreview(error.message, 'error', `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`);
          hooks.onResult?.(proposal, { ok: false, error: error.message || 'No se pudo aplicar el cambio.' });
          return false;
        }
      };
      approve.addEventListener('click', () => { runApprove(); });      runners.push({ run: runApprove, done: () => finished, label: proposal.summary.slice(0, 140) });
      reject.addEventListener('click', async () => {
        approve.disabled = reject.disabled = true;
        try {
          const data = await api(`/actions/${encodeURIComponent(proposal.id)}/reject`, { method: 'POST', body: '{}' });
          result.textContent = data.message || 'Cambio denegado.';
          finished = true;
          activity(`${proposal.provider}: propuesta denegada.`, 'done');
          resolveProposal(proposal.id, card);
          hooks.onResult?.(proposal, { ok: false, denied: true, error: 'El dueño denegó esta acción.' });
        } catch (error) {
          result.textContent = error.message;
          result.dataset.state = 'error';
          reject.disabled = false;
        }
      });
      messageNode.append(card);
    }
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }

  // Después de aplicar un cambio: espera la publicación, saca fotos, prueba la página y
  // le pide al modelo elegido que explique qué cambió (con la foto si el modelo ve imágenes).
  let reviewQueue = Promise.resolve();
  function queueVisualReview(prep, result) {
    if (!prep || !window.MediaChafaVisualCheck) return;
    reviewQueue = reviewQueue.then(() => runVisualReview(prep, result)).catch(() => {});
  }

  // Galería "Antes y después" dentro de Navegador: guarda los últimos 6 cambios.
  const changesBox = document.createElement('section');
  changesBox.className = 'beta-changes';
  changesBox.id = 'beta-changes';
  const changesTitle = document.createElement('h3');
  changesTitle.textContent = 'Antes y después de cada cambio';
  const changesNote = document.createElement('p');
  changesNote.textContent = 'Luz roja: cómo estaba antes. Luz verde: cómo quedó. Se guardan los últimos 6 cambios aprobados.';
  const changesList = document.createElement('div');
  changesBox.append(changesTitle, changesNote, changesList);
  browserFrame.parentElement.insertBefore(changesBox, browserFrame);

  function changesKey() { return `mediachafa-beta-changes:${ownerId}`; }
  function loadChanges() {
    try { const saved = JSON.parse(localStorage.getItem(changesKey()) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  }
  function saveChange(report) {
    let list = [{ ...report, diffText: undefined }, ...loadChanges().filter(item => item.id !== report.id)].slice(0, 6);
    while (list.length) {
      try { localStorage.setItem(changesKey(), JSON.stringify(list)); return; } catch {}
      if (list.length > 1) { list = list.slice(0, -1); continue; }
      list = [{ ...list[0], images: (list[0].images || []).slice(0, 2) }];
      try { localStorage.setItem(changesKey(), JSON.stringify(list)); } catch {}
      return;
    }
  }
  function renderChanges() {
    const list = loadChanges();
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Todavía no hay cambios aprobados. Cuando apruebes uno, acá vas a ver la foto de antes y la de después.';
      changesList.replaceChildren(empty);
      return;
    }
    changesList.replaceChildren(...list.map(report => {
      const item = document.createElement('div');
      item.className = 'beta-change-item';
      item.id = `beta-change-${report.id}`;
      const when = document.createElement('small');
      when.textContent = new Date(report.at || Date.now()).toLocaleString();
      item.append(when);
      window.MediaChafaVisualCheck?.renderReport(item, report);
      return item;
    }));
  }
  function addChangesButton(node, report) {
    if (!report?.id) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary beta-see-changes';
    button.textContent = 'Ver antes y después en Navegador';
    button.addEventListener('click', () => {
      selectBetaView('browser');
      renderChanges();
      (document.getElementById(`beta-change-${report.id}`) || changesBox).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    node.append(button);
  }

  // Pide la explicación a la IA elegida; si no responde, prueba con las nuestras
  // (MediaChafa IA Rápida, Pro y Código). Si ninguna responde, queda la explicación básica.
  function explainCandidates() {
    const usable = model => model && (model.unlimited || Number(model.remaining) > 0);
    const chosen = modelCatalog.find(item => item.id === modelSelect.value);
    const ours = ['rapida', 'pro', 'codigo'].map(variant => modelCatalog.find(item => item.id === `mediachafa::${variant}`) || { id: `mediachafa::${variant}`, name: `MediaChafa IA ${variant === 'rapida' ? 'Rápida' : variant === 'pro' ? 'Pro' : 'Código'}`, unlimited: true, vision: true });
    const seen = new Set();
    return [chosen, ...ours].filter(model => usable(model) && !seen.has(model.id) && seen.add(model.id));
  }

  async function askModelToExplain(model, report) {
    const shot = [...report.images].reverse().find(image => image.kind === 'after')?.src;
    const sendImage = Boolean(shot && model.vision);
    const checks = report.checks.map(check => `${check.ok === true ? 'OK' : check.ok === false ? 'FALLÓ' : 'Nota'}: ${check.label}`).join(' ; ');
    const message = `[Comprobación automática de MediaChafa después de un cambio aprobado. No propongas acciones nuevas: actions debe ir vacío.]\n${report.summary}\nANTES (luz roja): ${report.before?.title || ''} — ${(report.before?.lines || []).filter(Boolean).join(' · ')}\nDESPUÉS (luz verde): ${report.after?.title || ''} — ${(report.after?.lines || []).filter(Boolean).join(' · ')}\nExplicación básica: ${report.whatChanged || ''}\nPruebas: ${checks}\n${report.diffText ? `Líneas que cambiaron:\n${report.diffText.slice(0, 3200)}\n` : ''}${sendImage ? 'Te adjunto la foto de después.' : 'No hay foto adjunta para vos; el dueño igual ve las fotos.'}\nExplicale al dueño en 2 a 4 frases simples qué cambió: cómo estaba antes y cómo quedó ahora. Si alguna prueba falló, decí qué hay que revisar.`;
    const auth = await currentSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${API}/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: [], image: sendImage ? { data: shot } : undefined, model: model.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.modelId) updateModelUsage(data.modelId, data);
      const text = String(data.answer || '').trim();
      if (!response.ok || !text) return null;
      return { text, modelName: data.modelName || model.name || '', sawImage: sendImage };
    } finally { clearTimeout(timer); }
  }

  async function explainReport(report) {
    for (const model of explainCandidates()) {
      const explained = await askModelToExplain(model, report).catch(() => null);
      if (explained) return explained;
    }
    return null;
  }

  function showWorkReport(report) {
    showWorkPreview(`${report.explanation || report.summary}\n\nMirá la foto de antes (luz roja) y la de después (luz verde) abajo, en "Antes y después de cada cambio".`, report.ok ? 'done' : 'error', report.title, report.url || '');
  }

  async function runVisualReview(prep, result) {
    const checker = window.MediaChafaVisualCheck;
    workPreview.querySelector(':scope > .beta-visual-report')?.remove();
    const holder = addMessage('assistant', 'Comprobando el cambio: armo la foto de antes y la de después…');
    holder.classList.add('beta-working');
    holder.querySelector('.beta-copy-btn')?.remove();
    const body = holder.querySelector('p');
    let lastActivity = '';
    const step = (message) => {
      body.textContent = message;
      setStatus(message);
      const kind = message.replace(/[0-9]+ s$/, '');
      if (kind !== lastActivity) { lastActivity = kind; activity(message); } else showWorkPreview(message, 'active', 'Beta está comprobando el cambio');
    };
    try {
      const report = await checker.review(prep, step, result || {});
      step('Pidiéndole a la IA que explique lo que cambió…');
      const explained = await explainReport(report).catch(() => null);
      report.explanation = explained?.text
        ? explained.text
        : `${report.whatChanged || report.summary}\n\n${report.ok ? 'Todas las pruebas pasaron.' : 'Alguna prueba falló: revisala abajo.'}`;
      holder.remove();
      const node = addMessage('assistant', report.explanation, explained?.modelName || '');
      checker.renderReport(node, report);
      addChangesButton(node, report);
      saveChange(report);
      renderChanges();
      activity(report.ok ? 'Cambio comprobado: fotos de antes y después listas en Navegador.' : 'Cambio aplicado, pero una prueba falló. Mirá el detalle en el chat.', report.ok ? 'done' : 'error');
      showWorkReport(report);
      setStatus(report.ok ? 'Cambio comprobado.' : 'Una prueba falló; revisá el detalle.', report.ok ? 'idle' : 'error');
      history.push({ role: 'assistant', content: report.explanation, modelName: explained?.modelName || '', report: { ...report, diffText: undefined } });
      history = history.slice(-30);
      saveHistory();
    } catch (error) {
      holder.remove();
      activity(`No pude comprobar el cambio con fotos: ${error?.message || 'error desconocido'}`, 'error');
      setStatus('No pude comprobar el cambio con fotos.', 'error');
    }
  }

  function restoreHistory() {
    if (!ownerId) return;
    if (!currentThreadId) ensureThreads();
    renderThreadList();
    try { renderChanges(); } catch {}
    history = [];
    messagesNode.replaceChildren();
    stage.classList.remove('has-messages');
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      if (!Array.isArray(saved)) return;
      history = saved.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string').slice(-30);
      messagesNode.replaceChildren();
      for (const item of history) {
        const message = addMessage(item.role, item.content, item.modelName);
        if (item.role === 'assistant' && Array.isArray(item.steps)) attachSteps(message, item.steps);
        if (item.role === 'assistant' && Array.isArray(item.proposals)) renderProposals(message, item.proposals);
        if (item.role === 'assistant' && item.report && window.MediaChafaVisualCheck) { window.MediaChafaVisualCheck.renderReport(message, item.report); addChangesButton(message, item.report); }
      }
      if (!history.length) stage.classList.remove('has-messages');
    } catch { history = []; }
  }

  async function currentSession() {
    if (typeof window.mediaChafaBetaAuth !== 'function') throw new Error('No se pudo validar la sesión. Recargá la página.');
    const auth = await window.mediaChafaBetaAuth();
    if (!auth?.owner || !auth?.token || auth?.anonymous) throw new Error('Iniciá sesión con nxmollpy para usar Beta.');
    ownerId = auth.userId || 'owner';
    return auth;
  }

  async function api(path, options = {}) {
    const auth = await currentSession();
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${auth.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `El servicio respondió ${response.status}.`);
    return data;
  }

  async function refreshQuota() {
    try {
      await currentSession();
      const data = await api('/status');
      modelCatalog = Array.isArray(data.models) ? data.models : [];
      restoreModelHealth();
      providerQuotas = data.quotas || {};
      renderModelOptions();
      renderKeylessUsage();
      if (!modelCatalog.length) {
        const detail = Object.values(data.catalogErrors || {})[0];
        setStatus(detail || 'Conectá al menos una API gratuita en Integraciones para cargar modelos.', detail ? 'error' : '');
      }
      else setStatus('Sesión conectada. El chat se guarda en este dispositivo.');
      restoreHistory();
      await loadIntegrations();
    } catch (error) {
      setStatus(error.message || 'No se pudo comprobar la sesión.', 'error');
    }
  }
  window.addEventListener('mediachafa:session-ready', () => { void refreshQuota(); });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  function attachmentLabel(file, selector) { $(selector).textContent = file ? `Adjunto: ${file.name}` : ''; }

  const imageEditButton = document.createElement('button');
  imageEditButton.type = 'button';
  imageEditButton.className = 'secondary hidden';
  imageEditButton.textContent = 'Editar imagen';
  imageEditButton.setAttribute('aria-label', 'Editar imagen adjunta');
  $('#beta-image-name')?.insertAdjacentElement('afterend', imageEditButton);

  imageEditButton.addEventListener('click', async () => {
    const prompt = input.value.trim();
    if (!pendingImage) { setStatus('Adjuntá primero una imagen.', 'error'); return; }
    if (!prompt) { setStatus('Escribí qué querés agregar, quitar o modificar.', 'error'); input.focus(); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(pendingImage.type)) {
      setStatus('Para editar, usá PNG, JPG o WebP. Los GIF se pueden analizar, pero no editar directamente.', 'error');
      return;
    }
    imageEditButton.disabled = true;
    imageEditButton.textContent = 'Editando…';
    setStatus('Editando la imagen con Qwen Image 2.1 Uncensored…');
    activity('Procesando la edición con Qwen Image 2.1.', 'active');
    try {
      const auth = await currentSession();
      const response = await fetch(`${API}/image-edit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image: { data: await fileToBase64(pendingImage) } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.image) throw new Error(data.error || 'No se pudo editar la imagen.');
      const imageUrl = `data:image/png;base64,${data.image}`;
      addMessage('user', `Editar imagen: ${prompt}`);
      const resultMessage = addMessage('assistant', 'Listo. Esta es la imagen editada. Podés abrirla o guardarla.');
      const preview = document.createElement('img');
      preview.src = imageUrl;
      preview.alt = 'Imagen editada por Qwen en MediaChafa';
      preview.loading = 'lazy';
      preview.style.cssText = 'display:block;max-width:100%;height:auto;max-height:720px;object-fit:contain;border-radius:12px;margin:10px 0;border:1px solid rgba(130,160,190,.25)';
      const download = document.createElement('a');
      download.href = imageUrl;
      download.download = 'MediaChafa-imagen-editada.png';
      download.textContent = 'Guardar imagen editada';
      download.className = 'beta-link';
      download.style.display = 'inline-block';
      download.style.margin = '4px 0 10px';
      resultMessage.append(preview, download);
      history.push({ role: 'user', content: `Editar imagen: ${prompt}` }, { role: 'assistant', content: 'Imagen editada y entregada en el chat.' });
      history = history.slice(-30);
      saveHistory();
      input.value = '';
      pendingImage = undefined;
      imageInput.value = '';
      attachmentLabel(undefined, '#beta-image-name');
      imageEditButton.classList.add('hidden');
      setStatus('Edición terminada. La imagen está lista para guardar.');
      activity('Imagen editada y entregada en el chat.', 'done');
    } catch (error) {
      setStatus(error.message || 'No se pudo editar la imagen.', 'error');
    } finally {
      imageEditButton.disabled = false;
      imageEditButton.textContent = 'Editar imagen';
    }
  });

  imageInput.addEventListener('change', () => {
    pendingImage = imageInput.files?.[0];
    if (pendingImage && pendingImage.size > 5 * 1024 * 1024) { pendingImage = undefined; imageInput.value = ''; setStatus('La imagen supera el límite de 5 MB.', 'error'); }
    attachmentLabel(pendingImage, '#beta-image-name');
    imageEditButton.classList.toggle('hidden', !pendingImage);
  });
  audioInput.addEventListener('change', () => {
    pendingAudio = audioInput.files?.[0];
    if (pendingAudio && pendingAudio.size > 5 * 1024 * 1024) { pendingAudio = undefined; audioInput.value = ''; setStatus('El audio supera el límite de 5 MB.', 'error'); }
    attachmentLabel(pendingAudio, '#beta-audio-name');
  });

  // ===== Modo Autónomo =====
  // Beta trabaja en varios turnos seguidos: prepara acciones, ejecuta solas las que no son
  // peligrosas, le pasa los resultados reales al modelo y sigue hasta terminar. Solo se frena
  // para hacerte una pregunta necesaria, para pedirte aprobación de algo delicado
  // (borrados, SQL o cambios en la web en vivo de MediaChafa) o si tocás "Detener".
  const agent = window.MediaChafaBetaAgent;
  const modeSelect = $('#beta-mode');
  const pendingAgentRuns = {};
  let autonomousRun = null;
  function setComposerMode(mode) {
    if (mode === 'working') {
      sendButton.disabled = false;
      sendButton.classList.add('beta-send-pause');
      sendButton.textContent = '■';
      sendButton.setAttribute('aria-label', 'Detener el trabajo de Beta');
      sendButton.title = 'Detener el trabajo';
    } else {
      sendButton.classList.remove('beta-send-pause');
      sendButton.textContent = '↑';
      sendButton.setAttribute('aria-label', 'Enviar mensaje');
      sendButton.title = 'Enviar mensaje';
      sendButton.disabled = mode === 'busy';
    }
  }

  function queueAutonomousInstruction(run, rawInstruction) {
    const instruction = String(rawInstruction || '').trim();
    if (!run || !instruction || run.stopped) return false;
    addMessage('user', instruction);
    history.push({ role: 'user', content: instruction });
    history = history.slice(-30);
    saveHistory();
    if (run.waitingKind === 'question' && run.waiting) {
      run.waiting({ answer: instruction, rawAnswer: instruction });
    } else {
      run.queuedInstructions.push(instruction);
      if (run.waitingKind === 'approval' && run.waiting) run.waiting({ paused: true });
      setStatus('Instrucción agregada. Beta la incorporará antes de ejecutar el próximo paso.');
      activity('Nueva instrucción recibida; se actualizará el plan antes de continuar.', 'active');
    }
    return true;
  }

  function absorbQueuedInstructions(run, state) {
    if (!run?.queuedInstructions?.length) return '';
    const instruction = run.queuedInstructions.splice(0).join('\n');
    state.loopHistory.push({ role: 'user', content: `INSTRUCCIONES NUEVAS DEL DUEÑO (prioridad máxima):\n${instruction}\nIncorporalas al objetivo original y al estado real actual. Si contradicen el plan anterior, prevalecen estas instrucciones. No repitas acciones ya completadas.` });
    state.loopHistory = state.loopHistory.slice(-12);
    return instruction;
  }

  // El botón de envío cambia a pausa mientras Beta trabaja; no hace falta un control aparte.
  try {
    const savedMode = localStorage.getItem('mediachafa-beta-mode');
    if (modeSelect && savedMode && [...modeSelect.options].some(option => option.value === savedMode)) modeSelect.value = savedMode;
  } catch {}
  modeSelect?.addEventListener('change', () => { try { localStorage.setItem('mediachafa-beta-mode', modeSelect.value); } catch {} });

  async function agentChat(state, run, message, attachments = {}) {
    const auth = await currentSession();
    const response = await fetch(`${API}/chat`, {
      method: 'POST',
      signal: run.controller.signal,
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: state.loopHistory.slice(-8), model: state.modelId, mode: 'autonomous', ...attachments }),
    });
    const data = await response.json().catch(() => ({}));
    if (data.modelId) updateModelUsage(data.modelId, data);
    if (!response.ok) {
      const error = new Error(data.error || `Beta respondió ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function waitMs(ms, run) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      run.controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  function askOwnerToApprove(proposal, run, expiresInSeconds) {
    return new Promise(resolve => {
      const node = addMessage('assistant', `Necesito tu aprobación antes de seguir: ${proposal.summary}`);
      node.querySelector('.beta-copy-btn')?.remove();
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        run.waiting = null;
        run.waitingKind = null;
        if (outcome?.paused) for (const button of node.querySelectorAll('button')) button.disabled = true;
        resolve(outcome);
      };
      run.waiting = finish;
      run.waitingKind = 'approval';
      renderProposals(node, [proposal], expiresInSeconds, { onResult: (_proposal, outcome) => finish(outcome) });
      setStatus('Beta está esperando tu aprobación para seguir trabajando.');
      activity('Esperando tu aprobación para seguir.', 'active');
    });
  }

  function askOwnerQuestion(questionText, run) {
    return new Promise(resolve => {
      const lines = String(questionText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const question = (lines.shift() || '¿Cómo querés que continúe?').replace(/^PREGUNTA\s*[:：-]?\s*/i, '');
      const isRepoNameQuestion = /nombre exacto del repositorio que querés borrar/i.test(question);
      const options = lines
        .filter(line => /^(?:[-*•]|\d+[.)])\s+/.test(line))
        .map(line => line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/^\[|\]$/g, '').trim())
        .filter(line => line && line.length <= 180 && !/^propon[eé] otra alternativa$/i.test(line))
        .slice(0, 5);
      const node = addMessage('assistant', question);
      node.classList.add('beta-interactive-question');
      node.querySelector('.beta-copy-btn')?.remove();
      const controls = document.createElement('div');
      controls.className = 'beta-question-controls';
      const optionRow = document.createElement('div');
      optionRow.className = 'beta-question-options';
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        run.waiting = null;
        run.waitingKind = null;
        for (const button of controls.querySelectorAll('button')) button.disabled = true;
        customInput.disabled = true;
        if (result?.answer) {
          addMessage('user', result.answer);
          history.push({ role: 'user', content: result.answer });
          history = history.slice(-30);
          saveHistory();
        } else if (result?.action === 'alternative') {
          const label = 'Proponé otra alternativa';
          addMessage('user', label);
          history.push({ role: 'user', content: label });
          history = history.slice(-30);
          saveHistory();
        }
        resolve(result || { answer: '' });
      };
      for (const choice of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary beta-question-option';
        button.textContent = choice;
        button.addEventListener('click', () => finish({
          answer: 'Elijo esta opción: ' + choice + '. Aplicala a la decisión pendiente y continuá con el pedido original. No repitas esta pregunta.'
        }));
        optionRow.append(button);
      }
      if (!options.length && !isRepoNameQuestion) {
        const hint = document.createElement('p');
        hint.className = 'beta-question-hint';
        hint.textContent = 'La IA no proporcionó opciones concretas. Podés pedirle otra propuesta o escribir tu respuesta.';
        controls.append(hint);
      }
      const alternativeButton = document.createElement('button');
      alternativeButton.type = 'button';
      alternativeButton.className = 'secondary beta-question-option beta-question-alternative';
      alternativeButton.textContent = 'Proponé otra alternativa';
      alternativeButton.addEventListener('click', () => finish({ action: 'alternative' }));
      const customInput = document.createElement('textarea');
      customInput.className = 'beta-question-custom';
      customInput.rows = 2;
      customInput.maxLength = 2000;
      customInput.placeholder = isRepoNameQuestion ? 'Nombre exacto del repositorio…' : 'O escribí tu propia respuesta…';
      customInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const value = customInput.value.trim();
          if (value) finish({ answer: 'Mi respuesta personalizada: ' + value + '. Usala para resolver la decisión pendiente y continuá con el pedido original. No repitas esta pregunta.', rawAnswer: value });
        }
      });
      customInput.addEventListener('blur', () => {
        customInput.dataset.hint = 'Escribí tu opinión y presioná Enter para continuar';
      });
      customInput.placeholder = isRepoNameQuestion ? 'Nombre exacto del repositorio… (Enter para enviar)' : 'Tu opinión o una respuesta propia… (Enter para enviar)';
      if (isRepoNameQuestion) controls.append(customInput);
      else controls.append(optionRow, alternativeButton, customInput);
      node.append(controls);
      run.waitingKind = 'question';
      run.waiting = (outcome) => {
        if (settled) return;
        settled = true;
        run.waiting = null;
        run.waitingKind = null;
        for (const button of controls.querySelectorAll('button')) button.disabled = true;
        customInput.disabled = true;
        resolve(outcome?.stopped ? { stopped: true } : outcome?.paused ? { paused: true } : { answer: String(outcome?.answer || ''), rawAnswer: String(outcome?.rawAnswer || outcome?.answer || '') });
      };
      setStatus('Beta está esperando tu decisión. Elegí una opción o escribí tu propia respuesta.');
      activity('Esperando tu respuesta para continuar.', 'active');
      messagesNode.scrollTop = messagesNode.scrollHeight;
    });
  }

  async function autoApprove(proposal) {
    try {
      const data = await api(`/actions/${encodeURIComponent(proposal.id)}/approve`, { method: 'POST', body: '{}' });
      return { ok: true, message: data.message || 'Listo.', url: data.url || '' };
    } catch (error) {
      return { ok: false, error: error.message || 'No se pudo aplicar el cambio.' };
    }
  }

  async function runAutonomous({ state, firstMessage, attachments, model }) {
    const run = { stopped: false, inFlight: false, controller: new AbortController(), waiting: null, waitingKind: null, state, queuedInstructions: [] };
    autonomousRun = run;
    setComposerMode('working');
    const progress = addMessage('assistant', 'Trabajando en modo autónomo…');
    progress.classList.add('beta-working');
    progress.querySelector('.beta-copy-btn')?.remove();
    const progressBody = progress.querySelector('p');
    const liveList = document.createElement('ul');
    liveList.className = 'beta-live-steps';
    progress.insertBefore(liveList, progressBody);
    const steps = [];
    const step = (text, kind = 'active') => {
      steps.push(text);
      liveList.replaceChildren(...steps.slice(-14).map((item, i, list) => { const li = document.createElement('li'); li.dataset.state = i === list.length - 1 && kind === 'active' ? 'active' : 'done'; li.textContent = item; return li; }));
      progressBody.textContent = `Modo autónomo · turno ${state.turn} de ${state.maxTurns}`;
      setStatus(text);
      activity(text, kind === 'error' ? 'error' : 'active');
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    let message = firstMessage;
    let outcome = { kind: 'limit', text: '' };
    let lastModelName = model?.name || '';
    try {
      while (state.turn < state.maxTurns) {
        if (run.stopped) { outcome = { kind: 'stopped', text: '' }; break; }
        const incomingAtStart = absorbQueuedInstructions(run, state);
        if (incomingAtStart) message = `INSTRUCCIONES NUEVAS DEL DUEÑO:\n${incomingAtStart}\nRevisá el plan y continuá desde el estado actual.`;
        state.turn += 1;
        step(`Turno ${state.turn}: pensando el próximo paso…`);
        let data;
        for (let attempt = 0; ; attempt++) {
          try {
            run.inFlight = true;
            data = await agentChat(state, run, agent.buildTurnMessage(state, message), state.turn === 1 && attempt === 0 ? attachments : {});
            run.inFlight = false;
            break;
          } catch (error) {
            run.inFlight = false;
            if (run.stopped) throw Object.assign(new Error('Detenido por el dueño.'), { stopped: true });
            if (error.name === 'AbortError') throw Object.assign(new Error('Detenido por el dueño.'), { stopped: true });
            if (!agent.shouldRetry(error.status, attempt, model)) throw error;
            step(`El modelo no respondió (${error.status || 'sin conexión'}); reintento en unos segundos…`);
            await waitMs(attempt === 0 ? 4000 : 10000, run);
          }
        }
        if (!data) continue;
        const arrivedDuringThinking = absorbQueuedInstructions(run, state);
        if (arrivedDuringThinking) {
          state.turn = Math.max(0, state.turn - 1);
          message = `INSTRUCCIONES NUEVAS DEL DUEÑO:\n${arrivedDuringThinking}\nDescartá el plan que acabás de generar porque se redactó antes de recibir estas instrucciones. Volvé a analizar el pedido y el estado actual; no ejecutes ninguna acción de ese plan anterior.`;
          step('Instrucción incorporada. Recalculando el próximo paso antes de ejecutar acciones…');
          continue;
        }
        if (data.modelName) lastModelName = data.modelName;
        const classified = agent.classifyAnswer(data.answer);
        const proposals = Array.isArray(data.proposals) ? data.proposals : [];
        if (classified.text) step(`Turno ${state.turn}: ${classified.text.slice(0, 220)}`, 'done');
        const results = [];
        for (const error of data.proposalErrors || []) results.push(`❌ No se pudo preparar una acción: ${error}`);
        let failed = false;
        let replanAfterPause = false;
        for (let i = 0; i < proposals.length; i++) {
          const arrivedBeforeAction = absorbQueuedInstructions(run, state);
          if (arrivedBeforeAction) {
            message = `INSTRUCCIONES NUEVAS DEL DUEÑO:\n${arrivedBeforeAction}\nDescartá las acciones restantes del plan anterior y volvé a evaluar antes de continuar.`;
            replanAfterPause = true;
            break;
          }
          if (run.stopped) throw Object.assign(new Error('Detenido por el dueño.'), { stopped: true });
          const proposal = proposals[i];
          const label = `${proposal.provider} · ${String(proposal.type || '').replaceAll('_', ' ')}`;
          if (failed) { results.push(`⏸ ${label}: no se ejecutó porque falló un paso anterior.`); continue; }
          let result;
          const deleteRequest = agent.isRepositoryDeletionRequest(state.goal);
          if (proposal.type === 'delete_repository' && deleteRequest) {
            const proposedRepo = String(proposal.repository || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
            const normalizedTarget = proposedRepo.includes('/') ? proposedRepo.toLowerCase() : `knmollpy/${proposedRepo}`.toLowerCase();
            const expectedTarget = state.deleteRepositoryName ? `knmollpy/${state.deleteRepositoryName}`.toLowerCase() : '';
            if (expectedTarget && normalizedTarget === expectedTarget) {
              step(`Borrando el repositorio exacto solicitado: ${normalizedTarget}`);
              result = await autoApprove(proposal);
            } else {
              result = { ok: false, error: expectedTarget
                ? `No se ejecutó: el repositorio propuesto (${normalizedTarget}) no coincide con el nombre exacto indicado (${expectedTarget}).`
                : 'No se ejecutó: primero necesito únicamente el nombre exacto del repositorio.' };
            }
          } else if (agent.needsOwnerApproval(proposal)) {
            step(`Esperando tu aprobación: ${proposal.summary.slice(0, 160)}`);
            result = await askOwnerToApprove(proposal, run, data.expiresInSeconds || 600);
            if (result.paused) {
              message = 'La propuesta pendiente no fue aprobada. Reevaluá el pedido con la instrucción nueva.';
              replanAfterPause = true;
              break;
            }
            if (result.stopped) throw Object.assign(new Error('Detenido por el dueño.'), { stopped: true });
          } else {
            step(`Ejecutando: ${proposal.summary.slice(0, 160)}`);
            result = await autoApprove(proposal);
          }
          if (result.ok) {
            if (result.url) state.links.push(result.url);
            results.push(`✅ ${label}: ${result.message}${result.url ? ` (${result.url})` : ''}`);
            step(`✓ ${result.message}`, 'done');
          } else {
            failed = !result.denied;
            results.push(`${result.denied ? '⛔' : '❌'} ${label}: ${result.error}`);
            step(`${result.denied ? 'Denegado' : 'Falló'}: ${result.error}`, result.denied ? 'done' : 'error');
          }
        }
        if (run.stopped) throw Object.assign(new Error('Detenido por el dueño.'), { stopped: true });
        if (replanAfterPause) continue;
        const lateInstructions = absorbQueuedInstructions(run, state);
        if (lateInstructions) {
          message = `INSTRUCCIONES NUEVAS DEL DUEÑO:\n${lateInstructions}\nRevisá el estado actual y continuá con el plan actualizado.`;
          continue;
        }
        const decision = agent.decideNext({ classified, proposalsCount: proposals.length, failed, emptyStreak: state.emptyStreak });
        if (agent.isRepositoryDeletionRequest(state.goal) && !state.deleteRepositoryName && proposals.some(item => item.type === 'delete_repository')) decision.kind = 'question';
        state.emptyStreak = decision.emptyStreak;
        const summary = proposals.map(item => item.summary).join(' | ').slice(0, 1200);
        state.loopHistory.push({ role: 'user', content: agent.compactUserTurn(state, message).slice(0, 3000) });
        state.loopHistory.push({ role: 'assistant', content: `${data.answer || ''}${summary ? `\nAcciones: ${summary}` : ''}`.slice(0, 3000) });
        state.loopHistory = state.loopHistory.slice(-12);
        if (decision.kind === 'question') {
          const needsRepoName = agent.isRepositoryDeletionRequest(state.goal) && !state.deleteRepositoryName;
          const questionToShow = needsRepoName
            ? '¿Cuál es el nombre exacto del repositorio que querés borrar? Escribí únicamente el nombre.'
            : (classified.text || data.answer || '');
          step(needsRepoName ? 'Esperando únicamente el nombre exacto del repositorio…' : 'La IA necesita tu decisión para seguir. Elegí una opción o escribí tu respuesta…');
          const reply = await askOwnerQuestion(questionToShow, run);
          if (reply.stopped || run.stopped) { outcome = { kind: 'stopped', text: '' }; break; }
          if (reply.paused) continue;
          if (needsRepoName) {
            const exactName = String(reply.rawAnswer || '').trim();
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(exactName)) {
              message = 'El nombre no parece un nombre válido de repositorio de GitHub. Volvé a pedir únicamente el nombre exacto del repositorio; no preguntes ningún otro dato.';
              continue;
            }
            state.deleteRepositoryName = exactName;
          }
          const ownerReply = String(reply.answer || '').trim();
          if (reply.action === 'alternative') {
            message = `El dueño eligió "Proponé otra alternativa". No repitas la pregunta ni las opciones anteriores. Revisá el pedido original y el contexto de esta decisión; proponé una alternativa nueva, concreta y diferente a las que ya ofreciste. Explicá brevemente por qué puede servir y, si podés avanzar sin otra decisión imprescindible, implementala y continuá el trabajo. Si todavía necesitás que el dueño elija, hacé una pregunta nueva con opciones contextuales distintas.`;
            state.loopHistory.push({ role: 'user', content: 'El dueño pidió una alternativa NUEVA y distinta a las opciones anteriores. No repetir la pregunta.' });
          } else {
            state.loopHistory.push({ role: 'user', content: `RESPUESTA DEL DUEÑO A TU PREGUNTA: ${ownerReply}` });
            message = `RESPUESTA DEL DUEÑO A TU PREGUNTA:\n${ownerReply}\n\nAplicá esta decisión a la tarea pendiente y continuá automáticamente con el pedido original. No repitas la pregunta ya respondida ni vuelvas a mostrar las mismas opciones.`;
          }
          state.loopHistory = state.loopHistory.slice(-12);
          step('Respuesta recibida. Continuando el trabajo…', 'done');
          continue;
        }
        if (['done', 'stalled'].includes(decision.kind)) { outcome = { kind: decision.kind, text: classified.text || data.answer || '' }; break; }
        message = decision.kind === 'nudge'
          ? agent.nudgeMessage(results, data.answer)
          : `RESULTADOS REALES DEL TURNO ANTERIOR:\n${results.length ? results.join('\n') : '(no hubo acciones)'}\n\nSeguí con el próximo paso del pedido.`;
      }
    } catch (error) {
      outcome = error.stopped || run.stopped ? { kind: 'stopped', text: '' } : { kind: 'error', text: error.message || 'Error desconocido.' };
    } finally {
      autonomousRun = null;
      run.waiting = null;
      setComposerMode('idle');
    }
    progress.remove();
    const finalText = agent.finalMessage(outcome, state);
    if (outcome.kind === 'done') delete pendingAgentRuns[currentThreadId];
    else pendingAgentRuns[currentThreadId] = { ...state, nextMessageAfterQuestion: outcome.kind === 'question' };
    const node = addMessage('assistant', finalText, lastModelName);
    attachSteps(node, steps);
    history.push({ role: 'assistant', content: finalText, modelName: lastModelName, steps: steps.slice(-40) });
    history = history.slice(-30);
    saveHistory();
    renderModelOptions();
    const statusText = { done: 'Beta terminó el pedido.', stalled: 'Beta no encontró más pasos; decile qué falta si hace falta algo más.', question: 'Beta te hizo una pregunta: respondé y sigue sola.', stopped: 'Modo autónomo detenido. Escribí "seguí" para continuar.', limit: 'Beta llegó al límite de turnos. Escribí "seguí" para continuar.', error: 'El modo autónomo se frenó por un error. Escribí "seguí" para reintentar.' }[outcome.kind];
    setStatus(statusText, outcome.kind === 'error' ? 'error' : 'idle');
    activity(statusText, outcome.kind === 'error' ? 'error' : 'done');
  }

  async function startAutonomousFromForm({ userText, displayText, selectedModel }) {
    addMessage('user', displayText);
    history.push({ role: 'user', content: displayText });
    saveHistory();
    let attachments = {};
    try {
      if (pendingImage) attachments.image = { data: await fileToBase64(pendingImage) };
      if (pendingAudio) attachments.audio = { data: (await fileToBase64(pendingAudio)).split(',')[1], mime: pendingAudio.type || 'audio/mpeg' };
    } catch (error) { setStatus(error.message, 'error'); return; }
    pendingImage = pendingAudio = undefined;
    imageInput.value = audioInput.value = '';
    attachmentLabel(undefined, '#beta-image-name');
    attachmentLabel(undefined, '#beta-audio-name');
    const pending = pendingAgentRuns[currentThreadId];
    let state;
    let firstMessage;
    if (pending) {
      state = { ...pending, modelId: selectedModel.id, maxTurns: pending.turn + agent.turnLimit(selectedModel), emptyStreak: 0 };
      firstMessage = pending.nextMessageAfterQuestion ? `RESPUESTA DEL DUEÑO A TU PREGUNTA:\n${userText}` : `INDICACIÓN DEL DUEÑO PARA CONTINUAR:\n${userText}`;
    } else {
      state = agent.newState(userText, selectedModel);
      firstMessage = null;
    }
    delete pendingAgentRuns[currentThreadId];
    await runAutonomous({ state, firstMessage, attachments, model: selectedModel });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (autonomousRun) {
      autonomousRun.stopped = true;
      autonomousRun.controller.abort();
      autonomousRun.waiting?.({ stopped: true });
      setStatus('Deteniendo Beta…');
      activity('El usuario detuvo el trabajo.', 'active');
      setComposerMode('busy');
      return;
    }
    const prompt = input.value.trim();
    if (!prompt && !pendingImage && !pendingAudio) { setStatus('Escribí algo o adjuntá una imagen o audio.', 'error'); return; }
    const selectedModel = modelCatalog.find(item => item.id === modelSelect.value);
    if (!selectedModel) { setStatus('Elegí un modelo de IA disponible en el selector.', 'error'); return; }
    if (!selectedModel.unlimited && Number(selectedModel.remaining) <= 0) { setStatus(`Se agotó la cuota gratuita de ${selectedModel.provider} para este modelo o proveedor. Cambiá a otra IA gratuita; Beta no probará una opción paga.`, 'error'); return; }
    if (pendingImage && !selectedModel?.vision) { setStatus('Este modelo no admite imágenes. Elegí uno que indique visión.', 'error'); return; }
    if (pendingAudio && !selectedModel?.audio) { setStatus('Este modelo no admite audio. Elegí uno que indique audio.', 'error'); return; }
    if (modeSelect?.value === 'autonomous' && agent) {
      input.value = '';
      const goalText = prompt || (pendingImage ? 'Analizá la imagen adjunta.' : 'Transcribí y analizá el audio adjunto.');
      const goalDisplay = `${goalText}${pendingImage ? `\n[Imagen: ${pendingImage.name}]` : ''}${pendingAudio ? `\n[Audio: ${pendingAudio.name}]` : ''}`;
      await startAutonomousFromForm({ userText: goalText, displayText: goalDisplay, selectedModel });
      return;
    }
    input.value = '';
    sendButton.disabled = true;
    setStatus('Validando sesión…');
    activity('Validando tu sesión de MediaChafa.');
    const userText = prompt || (pendingImage ? 'Analizá la imagen adjunta.' : 'Transcribí y analizá el audio adjunto.');
    const displayText = `${userText}${pendingImage ? `\n[Imagen: ${pendingImage.name}]` : ''}${pendingAudio ? `\n[Audio: ${pendingAudio.name}]` : ''}`;
    const previousHistory = history.slice(-8);
    let modelRequestStarted = false;
    const userMessage = addMessage('user', displayText);
    const progressMessage = addMessage('assistant', 'Validando tu sesión…');
    const progressBody = progressMessage.querySelector('p');
    progressMessage.classList.add('beta-working');
    progressMessage.querySelector('.beta-copy-btn')?.remove();
    const steps = ['Validando tu sesión…'];
    const liveList = document.createElement('ul');
    liveList.className = 'beta-live-steps';
    progressMessage.insertBefore(liveList, progressBody);
    const paintSteps = () => {
      liveList.replaceChildren(...steps.map((step, i) => { const li = document.createElement('li'); li.dataset.state = i === steps.length - 1 ? 'active' : 'done'; li.textContent = step; return li; }));
      progressBody.textContent = 'Trabajando…';
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    paintSteps();
    const updateProgress = (message) => { steps.push(message); paintSteps(); setStatus(message); activity(message); };
    try {
      const auth = await currentSession();
      updateProgress('Preparando adjuntos…');
      const image = pendingImage ? { data: await fileToBase64(pendingImage) } : undefined;
      const audio = pendingAudio ? { data: (await fileToBase64(pendingAudio)).split(',')[1], mime: pendingAudio.type || 'audio/mpeg' } : undefined;
      updateProgress('Enviando la consulta a Beta…');
    const response = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, history: previousHistory, image, audio, model: modelSelect.value }),
      });
      updateProgress('Consulta recibida; esperando la respuesta del modelo…');
      const data = await response.json().catch(() => ({}));
      if (data.modelId) {
        usedToday = Number(data.usedToday ?? usedToday);
        remaining = Number(data.remaining ?? Math.max(0, dailyLimit - usedToday));
        updateModelUsage(data.modelId, data);
      }
      if (!response.ok) {
        if (modelRequestStarted) recordModelHealth(selectedModel.id, false, data.error || `HTTP ${response.status}`);
        throw new Error(data.error || `Beta respondió ${response.status}.`);
      }
      recordModelHealth(selectedModel.id, true);
      const preparationErrors = Array.isArray(data.proposalErrors) ? data.proposalErrors : [];
      const answerBase = data.transcript ? `Transcripción: ${data.transcript}\n\n${data.answer}` : data.answer;
      const answer = preparationErrors.length ? `${answerBase}\n\nNo pude preparar una o más acciones:\n• ${preparationErrors.join('\n• ')}` : answerBase;
      history.push({ role: 'user', content: displayText }, { role: 'assistant', content: answer, modelName: data.modelName, proposals: data.proposals || [], expiresInSeconds: data.expiresInSeconds, steps: [...steps, 'Respuesta recibida'] });
      history = history.slice(-30);
      saveHistory();
      progressMessage.remove();
      const answerNode = addMessage('assistant', answer, data.modelName);
      attachSteps(answerNode, [...steps, 'Respuesta recibida']);
      renderProposals(answerNode, data.proposals, data.expiresInSeconds);
      if (data.proposals?.length) {
        activity(`${data.proposals.length} propuesta(s) preparadas. Todavía no se aplicó ningún cambio.`, 'done');
        setStatus(data.proposals.length > 1 ? 'Beta preparó todos los pasos; revisalos y aprobalos juntos o uno por uno.' : 'Beta preparó un cambio; revisalo y aprobalo.');
      }
      renderModelOptions();
      if (!data.proposals?.length) setStatus(preparationErrors.length ? 'La consulta terminó; revisá los permisos indicados para GitHub.' : 'Respuesta recibida.', preparationErrors.length ? 'error' : 'idle');
      activity('Respuesta recibida y mostrada en el chat.', 'done');
      pendingImage = pendingAudio = undefined;
      imageInput.value = audioInput.value = '';
      attachmentLabel(undefined, '#beta-image-name');
      attachmentLabel(undefined, '#beta-audio-name');
    } catch (error) {
      userMessage.classList.add('failed');
      if (modelRequestStarted && selectedModel) recordModelHealth(selectedModel.id, false, error?.message || 'Error de conexión');
      progressMessage.remove();
      history.push({ role: 'user', content: displayText });
      history = history.slice(-30);
      saveHistory();
      activity(`La consulta terminó con error: ${error?.message || 'error desconocido'}.`, 'error');
      setStatus(error?.message || 'No se pudo enviar el mensaje. El texto sigue en el chat; podés reintentar.', 'error');
    } finally { sendButton.disabled = false; }
  });

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (autonomousRun) {
      const instruction = input.value.trim();
      if (!instruction) return;
      input.value = '';
      queueAutonomousInstruction(autonomousRun, instruction);
      return;
    }
    if (!sendButton.disabled) form.requestSubmit(sendButton);
  });

  $('#beta-clear').addEventListener('click', (event) => { event.stopImmediatePropagation(); createThread(); }, true);
  $('#beta-clear').addEventListener('click', () => {
    history = [];
    messagesNode.replaceChildren();
    stage.classList.remove('has-messages');
    if (ownerId) localStorage.removeItem(storageKey());
    setStatus('Chat borrado de este dispositivo.');
  });

  async function loadIntegrations() {
    try {
      const data = await api('/integrations/status');
      for (const provider of ['github', 'supabase', 'cloudflare', 'openrouter', 'groq', 'cohere', 'gemini', 'huggingface']) {
        const record = data.integrations?.[provider] || {};
        const node = $(`#beta-connection-${provider}`);
        const disconnect = $(`[data-beta-disconnect="${provider}"]`);
        node.textContent = record.connected ? `Conectado · ${record.detail || 'verificado'}` : 'Sin conectar';
        node.dataset.state = record.connected ? 'connected' : 'idle';
        disconnect.classList.toggle('hidden', !record.connected);
      }
      const resources = data.resources || {};
      const details = [];
      if (resources.github) details.push(`GitHub: ${resources.github.repository}${resources.github.defaultBranch ? ` (${resources.github.defaultBranch})` : ''}`);
      if (resources.supabase) details.push(`Supabase: ${resources.supabase.length} proyectos disponibles`);
      if (resources.cloudflare) details.push(`Cloudflare: ${resources.cloudflare.length} Workers disponibles`);
      $('#beta-resource-summary').textContent = details.join(' · ') || 'Conectá un servicio para que Beta pueda consultar sus recursos.';
      // No bloquear el estado de las integraciones por cargas secundarias.
      void loadPrivateProjectMap(false);
      void loadGithubPages(Boolean(data.integrations?.github?.connected));
    } catch (error) {
      for (const provider of ['github', 'supabase', 'cloudflare', 'openrouter', 'groq', 'cohere', 'gemini', 'huggingface']) { const node = $(`#beta-connection-${provider}`); if (node) node.textContent = error.message; }
    }
  }

  async function loadPrivateProjectMap(refresh = false) {
    const statusNode = $('#beta-map-status');
    const detailsNode = $('#beta-map-details');
    const contentNode = $('#beta-map-content');
    const card = statusNode?.closest('.beta-private-map'); if (!statusNode || !contentNode || !card) return; const auth = await window.mediaChafaBetaAuth?.(); if (!auth?.owner || auth.anonymous) { card.hidden = true; return; } card.hidden = false;
    statusNode.textContent = refresh ? 'Actualizando el inventario privado…' : 'Cargando mapa privado…';
    try {
      const data = await api(`/project-map${refresh ? '?refresh=1' : ''}`);
      const map = data.projectMap || {};
      const lines = [
        `Proyecto: ${map.name || 'MediaChafa'} · acceso: solo cuenta dueña y Beta`,
        `Repositorio: ${(map.repositories || []).join(', ') || 'no configurado'} · rama: ${map.defaultBranch || '—'}`,
        `Estado del inventario: ${map.inventoryNote || 'sin detalle'}`,
        `Archivos registrados por GitHub: ${map.totalGithubFiles ?? map.githubFiles?.length ?? 0}${map.inventoryTruncated ? ' (lista parcial)' : ''}`,
        '', 'Puntos de entrada:',
        ...Object.entries(map.entryPoints || {}).map(([name, path]) => `• ${name}: ${path}`),
        '', 'Áreas y rutas relacionadas:',
        ...(map.appAreas || []).map((area) => `• ${area.name}: ${area.paths.join(', ')}`),
        '', 'Rutas de la API privada de Beta:',
        ...(map.betaApiRoutes || []).map((route) => `• ${route.method} ${route.path} — ${route.purpose}`),
        '', 'Rutas del servicio de almacenamiento:',
        ...(map.storageApiRoutes || []).map((route) => `• ${route.method} ${route.path} — ${route.purpose}`),
        '', 'Funciones y zonas de base de datos:',
        ...(map.supabaseFunctions || []).map((item) => `• ${item.path} — ${item.purpose}`),
        ...(map.databaseAreas || []).map((item) => `• ${item.area}: ${item.path}`),
        '', 'Nombres que usa el dueño y dónde buscarlos:',
        ...Object.entries(map.terminology || {}).map(([term, path]) => `• ${term} → ${path}`),
        '', 'Inventario actual de archivos GitHub:',
        ...(map.githubFiles || []).map((path) => `• ${path}`),
      ];
      contentNode.textContent = lines.join('\n');
      detailsNode.hidden = false;
      statusNode.textContent = `Privado · ${map.totalGithubFiles ?? map.githubFiles?.length ?? 0} rutas${map.inventoryTruncated ? ' (inventario parcial)' : ''} · actualizado desde GitHub`;
      statusNode.dataset.state = 'connected';
    } catch (error) {
      statusNode.textContent = `Mapa privado no disponible: ${error.message}`;
      statusNode.dataset.state = 'error';
    }
  }
  let pagesRepositories = [];
  function setPagesStatus(message, state = 'idle') {
    const node = $('#beta-connection-pages'); if (!node) return;
    node.textContent = message; node.dataset.state = state;
  }
  async function loadGithubPages(githubConnected = true) {
    const list = $('#beta-pages-sites'); const repoSelect = $('#beta-pages-repo');
    if (!list || !repoSelect) return;
    if (!githubConnected) { list.replaceChildren(); repoSelect.replaceChildren(); setPagesStatus('Conectá GitHub arriba para usar GitHub Pages.'); return; }
    setPagesStatus('Consultando tus sitios de GitHub Pages…');
    try {
      const data = await api('/integrations/pages');
      if (!data.connected) { setPagesStatus('Conectá GitHub arriba para usar GitHub Pages.'); return; }
      pagesRepositories = data.repositories || [];
      const previous = repoSelect.value;
      repoSelect.replaceChildren(...pagesRepositories.map((repo) => {
        const option = document.createElement('option'); option.value = repo.name;
        option.textContent = `${repo.name}${repo.private ? ' · privado' : ''}${repo.hasPages ? ' · ya publicado' : ''}`;
        return option;
      }));
      if (previous && pagesRepositories.some((repo) => repo.name === previous)) repoSelect.value = previous;
      syncPagesBranch();
      list.replaceChildren(...(data.sites || []).map((site) => {
        const item = document.createElement('li');
        const name = document.createElement('strong'); name.textContent = site.repository.replace(/^knmollpy\//, '');
        item.append(name);
        if (site.url) { const link = document.createElement('a'); link.href = site.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = site.url; item.append(link); }
        const meta = document.createElement('small');
        meta.textContent = site.error ? site.error : [site.status ? `estado: ${site.status}` : '', site.branch ? `rama ${site.branch}${site.folder ? ` ${site.folder}` : ''}` : '', site.buildType === 'workflow' ? 'con GitHub Actions' : ''].filter(Boolean).join(' · ');
        item.append(meta);
        if (!site.error) {
          const rebuild = document.createElement('button'); rebuild.type = 'button'; rebuild.className = 'secondary'; rebuild.textContent = 'Volver a publicar';
          rebuild.addEventListener('click', () => runPagesAction({ provider: 'github', type: 'pages_build', repository: site.repository }, `¿Volver a publicar el sitio de ${site.repository}?`, rebuild));
          item.append(rebuild);
        }
        return item;
      }));
      const count = (data.sites || []).length;
      setPagesStatus(count ? `Conectado · ${count} sitio${count === 1 ? '' : 's'} publicado${count === 1 ? '' : 's'}` : 'Conectado · todavía no tenés sitios publicados', 'connected');
    } catch (error) {
      setPagesStatus(/Ruta de integraciones no encontrada|404/.test(error.message) ? 'El servidor de Beta todavía no tiene GitHub Pages. Esperá a que se actualice.' : error.message, 'error');
    }
  }
  function syncPagesBranch() {
    const repo = pagesRepositories.find((item) => item.name === $('#beta-pages-repo')?.value);
    const branchInput = $('#beta-pages-branch');
    if (repo && branchInput) branchInput.value = repo.defaultBranch || 'main';
  }
  async function runPagesAction(action, question, button) {
    if (!window.confirm(question)) return;
    if (button) button.disabled = true;
    setPagesStatus('Preparando la publicación…');
    try {
      const proposal = await api('/actions/propose', { method: 'POST', body: JSON.stringify({ actions: [action] }) });
      const prepared = proposal.proposals?.[0];
      if (!prepared) throw new Error(proposal.failures?.[0] || 'Beta no aceptó la publicación. Revisá que GitHub esté conectado y los datos sean correctos.');
      activity(`GitHub Pages: ${prepared.summary}`);
      const result = await api(`/actions/${encodeURIComponent(prepared.id)}/approve`, { method: 'POST', body: '{}' });
      activity(`GitHub Pages: ${result.message || 'Listo.'}`, 'done');
      setPagesStatus(result.message || 'Listo.', 'connected');
      if (result.url) showWorkPreview(result.message || 'Listo.', 'done', 'GitHub Pages', result.url);
      setTimeout(() => loadGithubPages(true), 1500);
    } catch (error) {
      activity(`GitHub Pages no se completó: ${error.message}`, 'error');
      setPagesStatus(error.message, 'error');
    } finally { if (button) button.disabled = false; }
  }
  $('#beta-pages-repo')?.addEventListener('change', syncPagesBranch);
  $('#beta-pages-refresh')?.addEventListener('click', () => loadGithubPages(true));
  $('#beta-pages-publish')?.addEventListener('click', (event) => {
    const repository = $('#beta-pages-repo')?.value;
    const branch = $('#beta-pages-branch')?.value.trim();
    const folder = $('#beta-pages-folder')?.value || '/';
    if (!repository) { setPagesStatus('Elegí un repositorio.', 'error'); return; }
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch || '')) { setPagesStatus('Escribí una rama válida, por ejemplo main.', 'error'); $('#beta-pages-branch')?.focus(); return; }
    runPagesAction({ provider: 'github', type: 'enable_pages', repository, branch, folder }, `¿Publicar ${repository} con GitHub Pages desde la rama ${branch}, carpeta ${folder}?`, event.currentTarget);
  });
  $('#beta-map-refresh')?.addEventListener('click', () => loadPrivateProjectMap(true));

  document.querySelectorAll('[data-beta-connect]').forEach(button => button.addEventListener('click', async () => {
    const provider = button.dataset.betaConnect;
    const input = $(`#beta-token-${provider}`);
    const token = input?.value.trim();
    if (!token) { input?.focus(); $(`#beta-connection-${provider}`).textContent = 'Pegá el token de acceso para conectarlo.'; return; }
    if (provider === 'gemini' && !$('#beta-gemini-free-confirm')?.checked) {
      $(`#beta-connection-${provider}`).textContent = 'Confirmá que el proyecto de Google AI Studio es Free Tier y que no tiene facturación vinculada.';
      $('#beta-gemini-free-confirm')?.focus();
      return;
    }
    button.disabled = true;
    $(`#beta-connection-${provider}`).textContent = 'Validando y guardando cifrado…';
    try {
      await api('/integrations/connect', { method: 'POST', body: JSON.stringify({ provider, token }) });
      input.value = '';
      await loadIntegrations();
      if (['openrouter', 'groq', 'cohere', 'gemini'].includes(provider)) await refreshQuota();
    } catch (error) {
      $(`#beta-connection-${provider}`).textContent = error.message;
    } finally { button.disabled = false; }
  }));

  document.querySelectorAll('[data-beta-disconnect]').forEach(button => button.addEventListener('click', async () => {
    const provider = button.dataset.betaDisconnect;
    if (!window.confirm(`¿Desconectar ${provider}? Beta dejará de acceder a esta integración.`)) return;
    button.disabled = true;
    try { await api('/integrations/disconnect', { method: 'POST', body: JSON.stringify({ provider }) }); await loadIntegrations(); if (['openrouter', 'groq', 'cohere', 'gemini'].includes(provider)) await refreshQuota(); }
    catch (error) { $(`#beta-connection-${provider}`).textContent = error.message; }
    finally { button.disabled = false; }
  }));

  document.querySelectorAll('[data-beta-view]').forEach(button => button.addEventListener('click', () => {
    selectBetaView(button.dataset.betaView);
  }));
  $('#beta-show-activity')?.addEventListener('click', () => selectBetaView('browser'));

  function loadBrowserPage() {
    let url;
    try { url = new URL($('#beta-browser-url').value.trim()); } catch { setStatus('Escribí una dirección web completa, por ejemplo https://example.com', 'error'); return; }
    if (!['https:', 'http:'].includes(url.protocol)) { setStatus('El navegador solo abre direcciones HTTP o HTTPS.', 'error'); return; }
    workPreview.hidden = true;
    browserFrame.hidden = false;
    $('#beta-browser-frame').src = url.href;
  }
  $('#beta-browser-go').addEventListener('click', loadBrowserPage);
  $('#beta-browser-url').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadBrowserPage(); } });
  $('#beta-browser-open').addEventListener('click', () => {
    let url;
    try { url = new URL($('#beta-browser-url').value.trim()); } catch { return; }
    if (['https:', 'http:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer');
  });
  selectBetaView('chat');
  void refreshQuota();
})();

// Pantalla completa de Beta + arreglo del panel "Actividad".
(() => {
  if (window.MEDIA_NATIVE_APP === true || window.Capacitor?.isNativePlatform?.()) return;
  const app = document.querySelector('#app');
  const brand = document.querySelector('#beta-panel .beta-brand');
  if (!app || !brand) return;
  const style = document.createElement('style');
  style.textContent = `
#app.beta-mode #beta-panel .beta-workspace.beta-split-mode.beta-activity-open #beta-browser-view{grid-column:1/-1!important;grid-row:1/-1!important;justify-self:end;left:auto}
#app.beta-mode #beta-panel .beta-brand{display:flex;align-items:center}
#app.beta-mode #beta-panel .beta-expand{margin-left:auto;flex:none;width:30px;height:30px;display:inline-grid;place-items:center;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#cfcfcf;cursor:pointer;padding:0}
#app.beta-mode #beta-panel .beta-expand:hover{background:#262626;color:#fff}
#app.beta-mode #beta-panel .beta-expand svg{width:16px;height:16px}
#app.beta-mode.beta-expanded .topbar,#app.beta-mode.beta-expanded .welcome,#app.beta-mode.beta-expanded .storage{display:none!important}
#app.beta-mode.beta-expanded .wrap{padding:0!important;margin:0!important;max-width:none!important}
#app.beta-mode.beta-expanded #beta-panel{position:fixed!important;inset:0!important;z-index:900;height:100svh!important;min-height:0!important;margin:0!important;padding:0!important}
#app.beta-mode.beta-expanded #beta-panel .beta-workspace{height:100svh!important;min-height:0!important;border-radius:0!important;border:0!important}
`;
  document.head.append(style);
  const icons = {
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>'
  };
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'beta-expand';
  button.className = 'beta-expand';
  brand.append(button);
  const paint = () => {
    const on = app.classList.contains('beta-expanded');
    button.innerHTML = on ? icons.shrink : icons.expand;
    button.title = on ? 'Salir de pantalla completa' : 'Agrandar pantalla';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(on));
  };
  const setExpanded = (on) => { app.classList.toggle('beta-expanded', on); paint(); };
  button.addEventListener('click', () => setExpanded(!app.classList.contains('beta-expanded')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.classList.contains('beta-expanded') && !document.querySelector('.beta-model-modal.open, .beta-workspace.beta-activity-open')) setExpanded(false);
  });
  new MutationObserver(() => { if (!app.classList.contains('beta-mode') && app.classList.contains('beta-expanded')) setExpanded(false); })
    .observe(app, { attributes: true, attributeFilter: ['class'] });
  paint();
})();

// Chat más limpio: modelo en la barra lateral, sin línea superior, caja de texto compacta.
(() => {
  if (window.MEDIA_NATIVE_APP === true || window.Capacitor?.isNativePlatform?.()) return;
  const q = (s) => document.querySelector(s);
  const header = q('#beta-panel .beta-header');
  const sidebar = q('#beta-panel .beta-sidebar');
  const nav = sidebar?.querySelector('.beta-nav');
  const modelChip = header?.querySelector('.beta-chip:not(.beta-chip-activity)');
  if (modelChip && sidebar) { modelChip.classList.add('beta-side-model'); sidebar.insertBefore(modelChip, nav || null); }
  const showActivity = q('#beta-show-activity');
  const tools = q('#beta-form .beta-tools');
  if (showActivity && tools) { showActivity.textContent = 'Actividad'; showActivity.className = 'secondary beta-tool-activity'; tools.append(showActivity); }
  const input = q('#beta-input');
  if (input) {
    input.rows = 1;
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
    input.addEventListener('input', grow);
    q('#beta-form')?.addEventListener('submit', () => setTimeout(grow, 0));
    new MutationObserver(grow).observe(input, { attributes: true, attributeFilter: ['value'] });
  }
  const style = document.createElement('style');
  style.textContent = `
#app.beta-mode #beta-panel .beta-header{display:none!important}
#app.beta-mode #beta-panel #beta-chat-view.active,#app.beta-mode #beta-panel #beta-integrations-view.active,#app.beta-mode #beta-panel .beta-workspace:not(.beta-split-mode) #beta-browser-view.active{grid-row:1/-1!important}
#app.beta-mode #beta-panel .beta-count{display:none!important}
#app.beta-mode #beta-panel .beta-sidebar .beta-side-model{display:flex;width:100%;max-width:none;justify-content:space-between;margin:2px 0 6px;padding:9px 12px;border-radius:10px;font-size:12px}
#app.beta-mode #beta-panel .beta-composer{padding:8px 10px 8px 14px!important;border-radius:18px!important}
#app.beta-mode #beta-panel .beta-compose{display:flex!important;flex-direction:column;gap:4px}
#app.beta-mode #beta-panel .beta-compose textarea{min-height:24px!important;height:24px;max-height:140px!important;resize:none!important;padding:4px 2px!important;font-size:14px!important;line-height:1.45;overflow-y:auto}
#app.beta-mode #beta-panel .beta-compose-bottom{gap:6px!important}
#app.beta-mode #beta-panel .beta-tools .secondary,#app.beta-mode #beta-panel .beta-tools label{min-height:28px!important;padding:3px 10px!important;font-size:11px!important}
#app.beta-mode #beta-panel #beta-send{width:32px!important;height:32px!important;min-height:0!important;padding:0!important}
#app.beta-mode #beta-panel .beta-status-row{justify-content:center!important;margin-top:4px}
#app.beta-mode #beta-panel .beta-status{margin:2px 0 0!important;font-size:11px!important}
#app.beta-mode #beta-panel .beta-chat-stage{padding-bottom:10px!important}
`;
  document.head.append(style);
})();