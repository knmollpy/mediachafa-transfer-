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
  const modeSelect = $('#beta-mode');
  const imageInput = $('#beta-image');
  const audioInput = $('#beta-audio');
  let pendingImage;
  let pendingAudio;
  let activeRun = null;
  let pausedRequest = null;
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
    const tokenInput = document.createElement('input'); tokenInput.id = 'beta-token-' + provider; tokenInput.type = 'password'; tokenInput.autocomplete = 'off'; tokenInput.spellcheck = false; tokenInput.placeholder = 'Pegá tu clave gratuita de ' + provider; tokenInput.setAttribute('aria-label', 'Clave gratuita de ' + provider);
    const actions = document.createElement('div'); actions.className = 'beta-actions';
    const connect = document.createElement('button'); connect.className = 'add-btn'; connect.type = 'button'; connect.dataset.betaConnect = provider; connect.textContent = 'Validar y guardar';
    const disconnect = document.createElement('button'); disconnect.className = 'secondary hidden'; disconnect.type = 'button'; disconnect.dataset.betaDisconnect = provider; disconnect.textContent = 'Desconectar';
    actions.append(connect, disconnect);
    const connection = document.createElement('span'); connection.className = 'beta-connection-status'; connection.id = 'beta-connection-' + provider; connection.setAttribute('role', 'status'); connection.textContent = 'Sin conectar';
    card.append(title, description, tokenInput, actions, connection); connectorGrid.append(card);
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
      modelSelect.replaceChildren(new Option('Conectá un proveedor gratuito en Integraciones', ''));
      modelSelect.disabled = true;
      modelCount.textContent = 'Catálogo gratuito no conectado';
      $('#beta-count').textContent = 'Conectá OpenRouter, Groq, Cohere o Gemini Free Tier en Integraciones para cargar los modelos gratuitos disponibles.';
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
      const quotaLabel = Number.isFinite(model.dailyLimit) ? ` · ${model.usedToday || 0}/${model.dailyLimit} ${model.quotaPeriod === 'month' ? 'mes' : 'hoy'}` : '';
      option.textContent = `${health.icon} ${model.provider} · ${model.name} · ${model.thinkingLevel || 'medio'}${quotaLabel}`;
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
    modelProbe.disabled = !model || Number(model.remaining) <= 0;
    const periodLabel = model?.quotaPeriod === 'month' ? 'este mes' : 'hoy';
    modelCount.textContent = model ? `Pensamiento ${model.thinkingLevel || 'medio'} · ${model.provider} · ${model.usedToday || 0}/${model.dailyLimit || '—'} ${periodLabel}` : 'Conectá proveedores para ver modelos gratuitos';
    $('#beta-count').textContent = model ? `${model.usedToday || 0} de ${model.dailyLimit || '—'} consultas gratuitas usadas ${periodLabel} en ${model.provider}; ${model.remaining ?? '—'} disponibles para este modelo/proveedor.` : 'Sin modelo seleccionado.';
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
  usageNote.textContent = 'El indicador refleja consultas reales recientes: verde respondió, rojo falló y gris significa sin probar o vencido (15 min). Probar envía una consulta real y consume 1 de la cuota mostrada. Los errores no activan modelos pagos ni cambian de proveedor automáticamente.';
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

  // Keep the conversation and the live work view together on desktop, like an
  // assistant workspace. On phones the panes stack vertically to avoid a
  // miniature, horizontally scrolling layout.
  const workspaceStyle = document.createElement('style');
  workspaceStyle.textContent = `
    #beta-panel .beta-mode-label{color:#d9baba;font-size:10px;font-weight:700}
    #beta-panel .beta-mode-select{min-height:34px;padding:5px 9px;border:1px solid #563030;border-radius:999px;background:#201414;color:#f3dede;font-size:11px}
    #beta-panel .beta-mode-select:disabled{opacity:.6}
    #beta-panel .beta-live-steps{margin:0 0 8px;padding-left:22px;color:#e5c7c7;font-size:12px;line-height:1.55}
    #beta-panel .beta-live-steps li+li{margin-top:3px}
    #beta-panel .beta-plan{margin:8px 0;padding:9px 11px;border:1px solid #563030;border-radius:10px;background:#160e0e;color:#f3dede;font-size:12px}
    #beta-panel .beta-plan summary{cursor:pointer;font-weight:700;color:#ffb4b4}
    #beta-panel .beta-plan ol{padding-left:22px;line-height:1.55}
    #beta-panel .beta-plan li+li{margin-top:4px}
    #beta-panel .beta-batch-approve{display:grid;gap:8px;border-color:#805050;background:#241313}
    #beta-panel .beta-batch-approve p{margin:0;color:#f0dada;font-size:12px;line-height:1.5}
    #beta-panel .beta-batch-approve button{justify-self:start}
    #beta-panel .beta-proposal details{margin-top:8px}
    #beta-panel .beta-proposal details summary{cursor:pointer;color:#ffb4b4;font-size:12px}
    #beta-panel .beta-proposal details pre{max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
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
  document.head.append(workspaceStyle);
  const projectMapStyle = document.createElement('style');
  projectMapStyle.textContent = `#beta-panel .beta-private-map{width:min(1040px,100%);margin:0 auto 18px;background:linear-gradient(135deg,#1a1111,#101010);border-color:#562626}#beta-panel .beta-map-details{margin-top:12px;border-top:1px solid #3b2424;padding-top:10px;color:#f5eaea}#beta-panel .beta-map-details summary{cursor:pointer;color:#ffb4b4;font-size:12px}#beta-panel .beta-map-details pre{max-height:48vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid #382323;border-radius:10px;background:#0b0b0b;color:#ddd;font:11px/1.5 ui-monospace,monospace}`;
  document.head.append(projectMapStyle);

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

  function storageKey() { return `mediachafa-beta-chat:${ownerId}`; }

  function saveHistory() {
    if (!ownerId) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(history.slice(-30))); } catch {}
  }

  function addMessage(role, content, modelName = '') {
    const article = document.createElement('article');
    article.className = `beta-message ${role}`;
    const heading = document.createElement('strong');
    heading.textContent = role === 'user' ? 'Vos' : 'Beta';
    const body = document.createElement('p');
    body.textContent = content;
    article.append(heading, body);
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

  function attachPlan(messageNode, plan) {
    if (!Array.isArray(plan) || !plan.length) return;
    const details = document.createElement('details');
    details.className = 'beta-plan';
    const summary = document.createElement('summary');
    summary.textContent = `Plan de trabajo · ${plan.length} paso${plan.length === 1 ? '' : 's'}`;
    const list = document.createElement('ol');
    for (const step of plan) {
      const item = document.createElement('li');
      item.textContent = step;
      list.append(item);
    }
    details.append(summary, list);
    messageNode.append(details);
  }

  function renderProposals(messageNode, proposals, expiresInSeconds = 600) {
    const approvalTasks = [];
    if ((proposals || []).length > 1) {
      const batch = document.createElement('section');
      batch.className = 'beta-proposal beta-batch-approve';
      const description = document.createElement('p');
      description.textContent = `Beta preparó ${proposals.length} acciones. Podés aprobarlas en orden con una sola confirmación; si una falla, las siguientes no se ejecutan. Los borrados siguen pidiendo confirmación exacta.`;
      const approveAll = document.createElement('button');
      approveAll.type = 'button';
      approveAll.className = 'add-btn';
      approveAll.textContent = `Aprobar todo en orden (${proposals.length})`;
      const batchStatus = document.createElement('span');
      batchStatus.className = 'beta-action-result';
      batch.append(description, approveAll, batchStatus);
      messageNode.append(batch);
      approveAll.addEventListener('click', async () => {
        if (!window.confirm(`Se ejecutarán ${approvalTasks.length} acciones en orden:\n\n${proposals.map((item, index) => `${index + 1}. ${item.summary}`).join('\n')}\n\n¿Continuar?`)) return;
        approveAll.disabled = true;
        for (let index = 0; index < approvalTasks.length; index++) {
          batchStatus.textContent = `Ejecutando paso ${index + 1} de ${approvalTasks.length}…`;
          const ok = await approvalTasks[index]();
          if (!ok) {
            batchStatus.textContent = `Se detuvo en el paso ${index + 1}. Revisá el resultado de esa acción; las siguientes no se ejecutaron.`;
            batchStatus.dataset.state = 'error';
            approveAll.disabled = false;
            return;
          }
        }
        batchStatus.textContent = `Completado: ${approvalTasks.length} acciones ejecutadas.`;
        batchStatus.dataset.state = 'done';
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
        target.textContent = [proposal.repository ? `Repositorio: ${proposal.repository}` : '', proposal.path ? `Ruta: ${proposal.path}` : '', proposal.name ? `Nombre: ${proposal.name}` : ''].filter(Boolean).join(' · ');
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
      if (Array.isArray(proposal.files)) {
        for (const file of proposal.files) {
          const filePreview = document.createElement('details');
          const fileName = document.createElement('summary');
          fileName.textContent = file.path;
          const fileContent = document.createElement('pre');
          fileContent.textContent = file.content;
          filePreview.append(fileName, fileContent);
          card.append(filePreview);
        }
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
      const runApproval = async () => {
        if (approve.disabled) return result.dataset.state === 'done';
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
          addMessage('assistant', `${data.message || 'Cambio aplicado.'}${data.url ? `\n${data.url}` : ''}`);
          return true;
        } catch (error) {
          result.textContent = error.message;
          result.dataset.state = 'error';
          approve.disabled = false;
          activity(`La acción en ${proposal.provider} no se completó: ${error.message}`, 'error');
          showWorkPreview(error.message, 'error', `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`);
          return false;
        }
      };
      approve.addEventListener('click', () => { void runApproval(); });
      approvalTasks.push(runApproval);
      reject.addEventListener('click', async () => {
        approve.disabled = reject.disabled = true;
        try {
          const data = await api(`/actions/${encodeURIComponent(proposal.id)}/reject`, { method: 'POST', body: '{}' });
          result.textContent = data.message || 'Cambio denegado.';
          activity(`${proposal.provider}: propuesta denegada.`, 'done');
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

  function restoreHistory() {
    if (!ownerId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      if (!Array.isArray(saved)) return;
      history = saved.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string').slice(-30);
      messagesNode.replaceChildren();
      for (const item of history) {
        const message = addMessage(item.role, item.content, item.modelName);
        if (item.role === 'assistant') {
          attachPlan(message, item.plan);
          if (Array.isArray(item.proposals)) renderProposals(message, item.proposals);
        }
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
      modeSelect.value = savedMode();
      const data = await api('/status');
      modelCatalog = Array.isArray(data.models) ? data.models : [];
      restoreModelHealth();
      providerQuotas = data.quotas || {};
      renderModelOptions();
      if (!modelCatalog.length) {
        const detail = Object.values(data.catalogErrors || {})[0];
        setStatus(detail || 'Conectá al menos una API gratuita en Integraciones para cargar modelos.', detail ? 'error' : '');
      }
      else setStatus('Sesión conectada. El chat se guarda en este dispositivo.');
      restoreHistory();
      await loadIntegrations();
      await restoreAgentExecution();
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

  imageInput.addEventListener('change', () => {
    pendingImage = imageInput.files?.[0];
    if (pendingImage && pendingImage.size > 5 * 1024 * 1024) { pendingImage = undefined; imageInput.value = ''; setStatus('La imagen supera el límite de 5 MB.', 'error'); }
    attachmentLabel(pendingImage, '#beta-image-name');
  });
  audioInput.addEventListener('change', () => {
    pendingAudio = audioInput.files?.[0];
    if (pendingAudio && pendingAudio.size > 5 * 1024 * 1024) { pendingAudio = undefined; audioInput.value = ''; setStatus('El audio supera el límite de 5 MB.', 'error'); }
    attachmentLabel(pendingAudio, '#beta-audio-name');
  });

  const savedMode = () => {
    try {
      const value = localStorage.getItem(`mediachafa-beta-mode:${ownerId}`);
      return ['normal', 'autonomous'].includes(value) ? value : 'normal';
    } catch { return 'normal'; }
  };
  modeSelect.value = savedMode();
  modeSelect.addEventListener('change', () => {
    try { if (ownerId) localStorage.setItem(`mediachafa-beta-mode:${ownerId}`, modeSelect.value); } catch {}
  });

  function updateSendButton() {
    if (activeRun) {
      sendButton.textContent = input.value.trim() ? 'Pausar + sumar' : 'Pausar';
      sendButton.setAttribute('aria-label', input.value.trim() ? 'Pausar y agregar indicaciones' : 'Pausar ejecución');
    } else if (pausedRequest) {
      sendButton.textContent = input.value.trim() ? 'Continuar + sumar' : 'Continuar';
      sendButton.setAttribute('aria-label', input.value.trim() ? 'Agregar indicaciones y continuar la ejecución' : 'Continuar la ejecución pausada');
    } else {
      sendButton.textContent = '↑';
      sendButton.setAttribute('aria-label', 'Enviar mensaje');
    }
  }
  input.addEventListener('input', updateSendButton);

  function clearAttachments() {
    pendingImage = pendingAudio = undefined;
    imageInput.value = audioInput.value = '';
    attachmentLabel(undefined, '#beta-image-name');
    attachmentLabel(undefined, '#beta-audio-name');
  }

  function appendToRequest(job, addition, imageFile, audioFile) {
    if (job.message.length + addition.length > 6000) throw new Error('El pedido combinado supera el límite de 6000 caracteres. Quitá parte de las indicaciones nuevas.');
    if (imageFile && job.imageFile) throw new Error('Esta ejecución ya tiene una imagen adjunta. Enviá la imagen nueva en otro mensaje.');
    if (audioFile && job.audioFile) throw new Error('Esta ejecución ya tiene un audio adjunto. Enviá el audio nuevo en otro mensaje.');
    const model = modelCatalog.find((item) => item.id === job.modelId);
    if (imageFile && !model?.vision) throw new Error('El modelo seleccionado no admite imágenes. Elegí un modelo con visión antes de iniciar la ejecución.');
    if (audioFile && !model?.audio) throw new Error('El modelo seleccionado no admite audio. Elegí un modelo compatible antes de iniciar la ejecución.');
    job.message = [job.message, addition].filter(Boolean).join('\n\n');
    if (imageFile) job.imageFile = imageFile;
    if (audioFile) job.audioFile = audioFile;
    job.displayText = `${job.message || (job.imageFile ? 'Analizá la imagen adjunta.' : 'Analizá el audio adjunto.')}${job.imageFile ? `\n[Imagen: ${job.imageFile.name}]` : ''}${job.audioFile ? `\n[Audio: ${job.audioFile.name}]` : ''}`;
    job.userMessage.querySelector('p').textContent = job.displayText;
  }

  function agentExecutionStorageKey() {
    return `mediachafa-beta-agent:${ownerId}`;
  }

  function saveAgentExecution(job) {
    try {
      if (job?.executionId) localStorage.setItem(agentExecutionStorageKey(), JSON.stringify({ executionId: job.executionId, modelId: job.modelId, message: job.message }));
    } catch {}
  }

  function clearAgentExecution() {
    try { localStorage.removeItem(agentExecutionStorageKey()); } catch {}
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function runAutonomousRequest(job) {
    const controller = new AbortController();
    const run = { controller, job };
    activeRun = run;
    pausedRequest = null;
    updateSendButton();
    modelSelect.disabled = modeSelect.disabled = true;
    const progressMessage = addMessage('assistant', 'Iniciando agente autónomo…');
    progressMessage.classList.add('beta-working');
    progressMessage.querySelector('.beta-copy-btn')?.remove();
    const progressBody = progressMessage.querySelector('p');
    const steps = document.createElement('ol');
    steps.className = 'beta-live-steps';
    progressMessage.insertBefore(steps, progressBody);
    const updateProgress = (message) => {
      const step = document.createElement('li');
      step.textContent = message;
      steps.append(step);
      progressBody.textContent = message;
      setStatus(message);
      activity(message);
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    try {
      await currentSession();
      if (job.imageFile || job.audioFile) throw new Error('El agente autónomo acepta texto en esta etapa. Usá el modo Normal para adjuntar imagen o audio.');
      if (!job.executionId) {
        updateProgress('Creando una ejecución persistente y una rama aislada…');
        const started = await api('/agent/start', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({ message: job.message, model: job.modelId, mode: 'autonomous' }),
        });
        job.executionId = started.executionId;
        saveAgentExecution(job);
        updateProgress(`Ejecución ${job.executionId} · rama ${started.branch}. Sin acceso a producción.`);
        if (job.pauseAfterStart) {
          job.pauseAfterStart = false;
          await api(`/agent/${encodeURIComponent(job.executionId)}/pause`, { method: 'POST', body: JSON.stringify({ message: job.pauseInstruction || '' }) });
        }
      } else {
        let current = await api(`/agent/${encodeURIComponent(job.executionId)}`);
        while (current.status === 'pausing' || current.status === 'step_in_progress') {
          await wait(500);
          current = await api(`/agent/${encodeURIComponent(job.executionId)}`);
        }
        if (current.status === 'paused') {
          const instruction = job.resumeInstruction || '';
          job.resumeInstruction = '';
          await api(`/agent/${encodeURIComponent(job.executionId)}/resume`, { method: 'POST', body: JSON.stringify({ message: instruction }) });
        }
        saveAgentExecution(job);
      }

      let state;
      let lastToolFingerprint = '';
      for (let requestCount = 0; requestCount <= 2 * 10; requestCount++) {
        if (controller.signal.aborted) throw new DOMException('Ejecución pausada.', 'AbortError');
        state = await api(`/agent/${encodeURIComponent(job.executionId)}/step`, { method: 'POST', signal: controller.signal, body: '{}' });
        if (state.lastToolResult) {
          const fingerprint = `${state.toolCalls}:${state.lastToolResult.name}:${JSON.stringify(state.lastToolResult).slice(0, 100)}`;
          if (fingerprint !== lastToolFingerprint) {
            lastToolFingerprint = fingerprint;
            updateProgress(`${state.lastToolResult.ok ? 'Herramienta completada' : 'Herramienta con error'}: ${state.lastToolResult.name}. Ronda ${state.rounds}/${state.maxRounds}, herramienta ${state.toolCalls}/${state.maxTools}.`);
          }
          if (['github_check_status', 'vercel_preview_status'].includes(state.lastToolResult.name) && ['queued', 'in_progress', 'BUILDING', 'INITIALIZING'].includes(state.lastToolResult.result?.status || state.lastToolResult.result?.readyState)) {
            updateProgress('Esperando la finalización de la verificación remota…');
            await wait(5000);
          }
        } else {
          updateProgress(`Razonando sobre el siguiente paso · ronda ${state.rounds}/${state.maxRounds}.`);
        }
        if (state.status === 'running') continue;
        if (state.status === 'step_in_progress') {
          updateProgress('Otra solicitud está procesando el siguiente paso de esta ejecución…');
          await wait(1000);
          continue;
        }
        if (state.status === 'pausing') {
          await wait(500);
          continue;
        }
        break;
      }

      if (!state) throw new Error('El agente no devolvió estado de ejecución.');
      progressMessage.remove();
      if (state.status === 'paused') {
        pausedRequest = job;
        setStatus('Ejecución pausada. Los resultados y cambios ya completados quedaron guardados; pulsá Continuar para seguir.', 'idle');
        activity('Ejecución pausada y estado persistido en el servidor.', 'done');
        showWorkPreview(`Ejecución ${state.executionId} pausada. ${state.rounds} rondas y ${state.toolCalls} herramientas conservadas.`, 'active', 'Agente autónomo');
      } else if (state.status === 'completed') {
        const verification = state.verified ? 'Verificación automatizada: aprobada.' : state.lastChecksSucceeded ? 'Las pruebas del workflow pasaron.' : 'No se confirmó que las verificaciones hayan pasado.';
        const answer = `${state.answer || 'La ejecución terminó.'}${state.summary ? `\n\n${state.summary}` : ''}\n\n${verification}\nRama de trabajo: ${state.branch || 'sin cambios de código'}${state.commitSha ? ` · commit ${state.commitSha.slice(0, 10)}` : ''}${state.vercelDeployment?.url ? `\nPreview: ${state.vercelDeployment.url}` : ''}\nConsumo estimado: ${state.estimatedTokens || 0} tokens · USD ${Number(state.estimatedCostUsd || 0).toFixed(4)} (límite USD 0).`;
        history.push(
          { role: 'user', content: job.displayText },
          { role: 'assistant', content: answer, modelName: job.modelName, mode: 'autonomous', plan: steps.innerText.split('\n').filter(Boolean) },
        );
        history = history.slice(-30);
        saveHistory();
        const answerNode = addMessage('assistant', answer, job.modelName);
        attachPlan(answerNode, steps.innerText.split('\n').filter(Boolean));
        clearAgentExecution();
        await refreshQuota();
        setStatus(state.verified ? 'Agente finalizó y las verificaciones pasaron.' : 'Agente finalizó; revisá el estado de verificación antes de integrar los cambios.', state.verified ? 'idle' : 'error');
        activity(`Ejecución finalizada en ${state.rounds} rondas y ${state.toolCalls} herramientas.`, 'done');
      } else {
        const reason = state.error || `La ejecución terminó en estado ${state.status}.`;
        addMessage('assistant', `El agente no pudo completar la tarea: ${reason}\n\nLos cambios permanecen en la rama ${state.branch || 'de trabajo'}; producción no fue modificada.`);
        clearAgentExecution();
        setStatus(reason, 'error');
        activity(`Ejecución detenida: ${reason}`, 'error');
      }
    } catch (error) {
      progressMessage.remove();
      if (pausedRequest) return;
      job.userMessage.classList.add('failed');
      setStatus(error?.message || 'No se pudo ejecutar el agente.', 'error');
      activity(`La ejecución autónoma terminó con error: ${error?.message || 'error desconocido'}.`, 'error');
      if (!job.executionId) clearAgentExecution();
    } finally {
      if (activeRun === run) {
        activeRun = null;
        modelSelect.disabled = modeSelect.disabled = Boolean(pausedRequest);
        updateSendButton();
      }
    }
  }

  async function restoreAgentExecution() {
    if (activeRun || pausedRequest || !ownerId) return;
    try {
      const data = await api('/agent');
      const state = (data.executions || []).find((item) => ['running', 'pausing', 'paused'].includes(item.status));
      if (!state) { clearAgentExecution(); return; }
      let userNode = null;
      const job = {
        executionId: state.executionId,
        message: state.initialMessage || '',
        displayText: state.initialMessage || '',
        modelId: state.modelId,
        modelName: state.modelName,
        mode: 'autonomous',
        previousHistory: [],
        userMessage: userNode,
      };
      job.userMessage = addMessage('user', `[Ejecución recuperada] ${job.displayText}`);
      saveAgentExecution(job);
      if (state.status === 'paused') {
        pausedRequest = job;
        setStatus(`Ejecución ${state.executionId} pausada; estado recuperado del servidor.`, 'idle');
        updateSendButton();
      } else {
        activity(`Recuperando la ejecución autónoma ${state.executionId}.`);
        void runAutonomousRequest(job);
      }
    } catch (error) {
      setStatus(`No pude recuperar la ejecución autónoma: ${error.message}`, 'error');
    }
  }

  async function runRequest(job) {
    if (job.mode === 'autonomous') return runAutonomousRequest(job);
    const controller = new AbortController();
    const run = { controller, job };
    activeRun = run;
    pausedRequest = null;
    updateSendButton();
    modelSelect.disabled = modeSelect.disabled = true;
    const progressMessage = addMessage('assistant', 'Preparando la ejecución…');
    progressMessage.classList.add('beta-working');
    progressMessage.querySelector('.beta-copy-btn')?.remove();
    const progressBody = progressMessage.querySelector('p');
    const steps = document.createElement('ol');
    steps.className = 'beta-live-steps';
    progressMessage.insertBefore(steps, progressBody);
    const updateProgress = (message) => {
      const step = document.createElement('li');
      step.textContent = message;
      steps.append(step);
      progressBody.textContent = message;
      setStatus(message);
      activity(message);
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };
    try {
      const auth = await currentSession();
      updateProgress(job.mode === 'autonomous' ? 'Inspeccionando el contexto y preparando el plan…' : 'Preparando el contexto…');
      const image = job.imageFile ? { data: await fileToBase64(job.imageFile) } : undefined;
      const audio = job.audioFile ? { data: (await fileToBase64(job.audioFile)).split(',')[1], mime: job.audioFile.type || 'audio/mpeg' } : undefined;
      if (controller.signal.aborted) throw new DOMException('Ejecución pausada.', 'AbortError');
      updateProgress('Enviando la consulta al modelo seleccionado…');
      const response = await fetch(`${API}/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: job.message || (job.imageFile ? 'Analizá la imagen adjunta.' : 'Analizá el audio adjunto.'), history: job.previousHistory, image, audio, model: job.modelId, mode: job.mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (controller.signal.aborted) throw new DOMException('Ejecución pausada.', 'AbortError');
      if (data.modelId) {
        usedToday = Number(data.usedToday ?? usedToday);
        remaining = Number(data.remaining ?? Math.max(0, dailyLimit - usedToday));
        updateModelUsage(data.modelId, data);
      }
      if (!response.ok) throw new Error(data.error || `Beta respondió ${response.status}.`);
      recordModelHealth(job.modelId, true);
      const preparationErrors = Array.isArray(data.proposalErrors) ? data.proposalErrors : [];
      const answer = preparationErrors.length
        ? `${data.answer}\n\nNo pude preparar una o más acciones:\n• ${preparationErrors.join('\n• ')}`
        : data.answer;
      const plan = Array.isArray(data.plan) && data.plan.length
        ? data.plan
        : (data.proposals || []).map((proposal) => proposal.summary);
      history.push(
        { role: 'user', content: job.displayText },
        { role: 'assistant', content: answer, modelName: data.modelName, mode: data.mode || job.mode, plan, proposals: data.proposals || [], expiresInSeconds: data.expiresInSeconds },
      );
      history = history.slice(-30);
      saveHistory();
      progressMessage.remove();
      const answerNode = addMessage('assistant', answer, data.modelName);
      attachPlan(answerNode, plan);
      renderProposals(answerNode, data.proposals, data.expiresInSeconds);
      renderModelOptions();
      if (data.proposals?.length) {
        activity(`${data.proposals.length} propuesta(s) preparadas. Todavía no se aplicó ningún cambio.`, 'done');
        setStatus(data.proposals.length > 1 ? 'Plan listo: revisá las vistas previas y aprobá todas las acciones juntas o por separado.' : 'Beta preparó un cambio; revisá la vista previa y aprobalo.');
      } else {
        setStatus(preparationErrors.length ? 'La consulta terminó; revisá los permisos indicados.' : 'Respuesta recibida.', preparationErrors.length ? 'error' : 'idle');
      }
      activity('Respuesta recibida y mostrada en el chat.', 'done');
      clearAttachments();
    } catch (error) {
      progressMessage.remove();
      if (controller.signal.aborted) {
        if (job.restartAfterAbort) {
          job.restartAfterAbort = false;
          activity('Incorporé tus indicaciones; retomando la tarea completa.');
          void runRequest(job);
        } else {
          pausedRequest = job;
          setStatus('Ejecución pausada. Continuar vuelve a enviar el pedido y puede consumir otra consulta del proveedor.', 'idle');
          activity('Ejecución pausada por vos.', 'done');
        }
        return;
      }
      job.userMessage.classList.add('failed');
      history.push({ role: 'user', content: job.displayText });
      history = history.slice(-30);
      saveHistory();
      recordModelHealth(job.modelId, false, error?.message || 'Error de conexión');
      activity(`La consulta terminó con error: ${error?.message || 'error desconocido'}.`, 'error');
      setStatus(error?.message || 'No se pudo enviar el mensaje. El texto sigue en el chat; podés reintentar.', 'error');
    } finally {
      if (activeRun === run) {
        activeRun = null;
        modelSelect.disabled = modeSelect.disabled = Boolean(pausedRequest);
        updateSendButton();
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const addition = input.value.trim();
    const imageFile = pendingImage;
    const audioFile = pendingAudio;
    input.value = '';
    try {
      if (activeRun) {
        if (activeRun.job.mode === 'autonomous') {
          if (imageFile || audioFile) throw new Error('No se pueden agregar adjuntos durante una ejecución autónoma; enviá las indicaciones como texto.');
          if (addition) appendToRequest(activeRun.job, addition);
          if (!activeRun.job.executionId) {
            activeRun.job.pauseAfterStart = true;
            activeRun.job.pauseInstruction = addition;
            setStatus('Pausaré la ejecución al terminar de crear su estado persistente…');
            return;
          }
          await api(`/agent/${encodeURIComponent(activeRun.job.executionId)}/pause`, { method: 'POST', body: JSON.stringify({ message: addition }) });
          setStatus('Pausando el agente entre herramientas; los resultados completados quedan guardados.');
          activity('Solicitaste pausar la ejecución autónoma y conservar el estado.');
          return;
        }
        if (addition || imageFile || audioFile) {
          appendToRequest(activeRun.job, addition, imageFile, audioFile);
          clearAttachments();
          activeRun.job.restartAfterAbort = true;
          setStatus('Pausando para incorporar tus indicaciones…');
          activity('Pausando la consulta para integrar nuevas indicaciones.');
        } else {
          activeRun.job.restartAfterAbort = false;
        }
        activeRun.controller.abort();
        return;
      }
      if (pausedRequest) {
        if (pausedRequest.mode === 'autonomous') {
          if (imageFile || audioFile) throw new Error('El agente autónomo no admite adjuntos en esta etapa.');
          if (addition) {
            appendToRequest(pausedRequest, addition);
            pausedRequest.resumeInstruction = addition;
          }
          clearAttachments();
          void runRequest(pausedRequest);
          return;
        }
        if (addition || imageFile || audioFile) appendToRequest(pausedRequest, addition, imageFile, audioFile);
        clearAttachments();
        void runRequest(pausedRequest);
        return;
      }
      if (!addition && !imageFile && !audioFile) { setStatus('Escribí algo o adjuntá una imagen o audio.', 'error'); return; }
      const selectedModel = modelCatalog.find(item => item.id === modelSelect.value);
      if (!selectedModel) { setStatus('Elegí un modelo de IA disponible en el selector.', 'error'); return; }
      if (Number(selectedModel.remaining) <= 0) { setStatus(`Se agotó la cuota gratuita de ${selectedModel.provider} para este modelo o proveedor. Cambiá a otra IA gratuita; Beta no probará una opción paga.`, 'error'); return; }
      if (imageFile && !selectedModel.vision) { setStatus('Este modelo no admite imágenes. Elegí uno que indique visión.', 'error'); return; }
      if (audioFile && !selectedModel.audio) { setStatus('Este modelo no admite audio. Elegí uno que indique audio.', 'error'); return; }
      if (modeSelect.value === 'autonomous' && (imageFile || audioFile)) { setStatus('El agente autónomo acepta texto en esta etapa. Usá el modo Normal para adjuntar imagen o audio.', 'error'); return; }
      const message = addition || (imageFile ? 'Analizá la imagen adjunta.' : 'Transcribí y analizá el audio adjunto.');
      const displayText = `${message}${imageFile ? `\n[Imagen: ${imageFile.name}]` : ''}${audioFile ? `\n[Audio: ${audioFile.name}]` : ''}`;
      const job = {
        message, displayText, imageFile, audioFile,
        previousHistory: history.slice(-8),
        modelId: selectedModel.id,
        modelName: selectedModel.name,
        mode: modeSelect.value,
        userMessage: addMessage('user', displayText),
      };
      clearAttachments();
      void runRequest(job);
    } catch (error) {
    input.value = addition;
    setStatus(error.message || 'No se pudo preparar la ejecución.', 'error');
    } finally {
      updateSendButton();
    }
  }, true);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const prompt = input.value.trim();
    if (!prompt && !pendingImage && !pendingAudio) { setStatus('Escribí algo o adjuntá una imagen o audio.', 'error'); return; }
    const selectedModel = modelCatalog.find(item => item.id === modelSelect.value);
    if (!selectedModel) { setStatus('Conectá OpenRouter y elegí un modelo gratuito disponible.', 'error'); return; }
    if (Number(selectedModel.remaining) <= 0) { setStatus(`Se agotó la cuota gratuita de ${selectedModel.provider} para este modelo o proveedor. Cambiá a otra IA gratuita; Beta no probará una opción paga.`, 'error'); return; }
    if (pendingImage && !selectedModel?.vision) { setStatus('Este modelo no admite imágenes. Elegí uno que indique visión.', 'error'); return; }
    if (pendingAudio && !selectedModel?.audio) { setStatus('Este modelo no admite audio. Elegí uno que indique audio.', 'error'); return; }
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
    const updateProgress = (message) => { progressBody.textContent = message; setStatus(message); activity(message); };
    try {
      const auth = await currentSession();
      modeSelect.value = savedMode();
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
      history.push({ role: 'user', content: displayText }, { role: 'assistant', content: answer, modelName: data.modelName, proposals: data.proposals || [], expiresInSeconds: data.expiresInSeconds });
      history = history.slice(-30);
      saveHistory();
      progressMessage.remove();
      const answerNode = addMessage('assistant', answer, data.modelName);
      renderProposals(answerNode, data.proposals, data.expiresInSeconds);
      if (data.proposals?.length) {
        activity(`${data.proposals.length} propuesta(s) preparadas. Todavía no se aplicó ningún cambio.`, 'done');
        setStatus('Beta preparó cambios; revisalos y aprobá cada uno por separado.');
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
    if (!sendButton.disabled) form.requestSubmit(sendButton);
  });

  $('#beta-clear').addEventListener('click', () => {
    if (activeRun || pausedRequest) { setStatus('Pausá o terminá la ejecución antes de iniciar otro chat.', 'error'); return; }
    history = [];
    messagesNode.replaceChildren();
    stage.classList.remove('has-messages');
    if (ownerId) localStorage.removeItem(storageKey());
    setStatus('Chat borrado de este dispositivo.');
  });

  async function loadIntegrations() {
    try {
      const data = await api('/integrations/status');
      for (const provider of ['github', 'supabase', 'cloudflare', 'vercel', 'openrouter', 'groq', 'cohere', 'gemini']) {
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
      if (resources.vercel) details.push(`Vercel: ${resources.vercel.length} proyectos disponibles`);
      $('#beta-resource-summary').textContent = details.join(' · ') || 'Conectá un servicio para que Beta pueda consultar sus recursos.';
      await loadPrivateProjectMap(false);
    } catch (error) {
      for (const provider of ['github', 'supabase', 'cloudflare', 'vercel', 'openrouter', 'groq', 'cohere', 'gemini']) { const node = $(`#beta-connection-${provider}`); if (node) node.textContent = error.message; }
    }
  }

  async function loadPrivateProjectMap(refresh = false) {
    const statusNode = $('#beta-map-status');
    const detailsNode = $('#beta-map-details');
    const contentNode = $('#beta-map-content');
    if (!statusNode || !contentNode) return;
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
