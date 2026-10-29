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
  const modelSelect = document.createElement('select');
  modelSelect.id = 'beta-model-select';
  modelSelect.setAttribute('aria-label', 'Modelo de inteligencia artificial');
  const modelCount = document.createElement('small');
  modelCount.id = 'beta-model-count';
  modelCount.className = 'beta-model-count';
  const modelControl = document.createElement('label');
  modelControl.className = 'beta-model-control';
  const modelLabel = document.createElement('span');
  modelLabel.textContent = 'Modelo de IA';
  modelControl.append(modelLabel, modelSelect, modelCount);
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
      const quotaLabel = Number.isFinite(model.dailyLimit) ? ` · ${model.usedToday || 0}/${model.dailyLimit} ${model.quotaPeriod === 'month' ? 'mes' : 'hoy'}` : '';
      option.textContent = `${model.provider} · ${model.name} · ${model.thinkingLevel || 'medio'}${quotaLabel}`;
      return option;
    }));
    modelSelect.value = modelCatalog.some(model => model.id === prior) ? prior : modelCatalog[0].id;
    const model = modelCatalog.find(item => item.id === modelSelect.value);
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
  usageNote.textContent = 'Cambiá entre OpenRouter, Groq, Cohere Trial y Gemini Free Tier. Cada proveedor conserva su propia cuota gratuita; OpenRouter comparte 50 solicitudes diarias entre sus modelos. Sin fallback a opciones pagas. Los niveles de pensamiento son orientativos.';
  modelControl.append(usageNote);
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

  function renderProposals(messageNode, proposals, expiresInSeconds = 600) {
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
      approve.addEventListener('click', async () => {
        if (destructive) {
          const exactTarget = proposal.type === 'delete_repository' ? proposal.repository : `${proposal.repository}:${proposal.path}`;
          const typedTarget = window.prompt(`Borrado destructivo de GitHub. Escribí exactamente:\n${exactTarget}\n\nSi confirmás, no hay botón para deshacer desde Beta.`, '');
          if (typedTarget !== exactTarget) {
            result.textContent = 'Borrado cancelado; no se envió a GitHub.';
            result.dataset.state = 'error';
            return;
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
        } catch (error) {
          result.textContent = error.message;
          result.dataset.state = 'error';
          approve.disabled = false;
          activity(`La acción en ${proposal.provider} no se completó: ${error.message}`, 'error');
          showWorkPreview(error.message, 'error', `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`);
        }
      });
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
        if (item.role === 'assistant' && Array.isArray(item.proposals)) renderProposals(message, item.proposals);
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
      providerQuotas = data.quotas || {};
      renderModelOptions();
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
    const userMessage = addMessage('user', displayText);
    const progressMessage = addMessage('assistant', 'Validando tu sesión…');
    const progressBody = progressMessage.querySelector('p');
    const updateProgress = (message) => { progressBody.textContent = message; setStatus(message); activity(message); };
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
      if (!response.ok) throw new Error(data.error || `Beta respondió ${response.status}.`);
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
    history = [];
    messagesNode.replaceChildren();
    stage.classList.remove('has-messages');
    if (ownerId) localStorage.removeItem(storageKey());
    setStatus('Chat borrado de este dispositivo.');
  });

  async function loadIntegrations() {
    try {
      const data = await api('/integrations/status');
      for (const provider of ['github', 'supabase', 'cloudflare', 'openrouter', 'groq', 'cohere', 'gemini']) {
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
      await loadPrivateProjectMap(false);
    } catch (error) {
      for (const provider of ['github', 'supabase', 'cloudflare', 'openrouter', 'groq', 'cohere', 'gemini']) { const node = $(`#beta-connection-${provider}`); if (node) node.textContent = error.message; }
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
