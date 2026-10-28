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
  let remaining = 100;
  let dailyLimit = 100;
  let ownerId = '';
  const activityList = $('#beta-activity-list');
  let activityItems = [];
  let modelCatalog = [];
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
    if (!modelCatalog.length) return;
    let prior = modelSelect.value;
    if (!prior) { try { prior = localStorage.getItem(`mediachafa-beta-model:${ownerId}`); } catch {} }
    modelSelect.replaceChildren(...modelCatalog.map(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name} · ${model.usedToday}/${model.dailyLimit} usadas hoy`;
      return option;
    }));
    modelSelect.value = modelCatalog.some(model => model.id === prior) ? prior : modelCatalog[0].id;
    const model = modelCatalog.find(item => item.id === modelSelect.value);
    remaining = model?.remaining ?? 0;
    dailyLimit = model?.dailyLimit ?? 1000;
    modelCount.textContent = model ? `${model.usedToday} usadas · ${remaining} disponibles / ${model.dailyLimit}` : '';
    $('#beta-count').textContent = `Este modelo: ${model?.usedToday ?? 0} usadas hoy · ${remaining} disponibles · reinicio 00:00 UTC`;
    const imageLabel = document.querySelector('label[for="beta-image"]');
    const imageAllowed = Boolean(model?.vision);
    imageInput.disabled = !imageAllowed;
    imageLabel?.classList.toggle('beta-disabled', !imageAllowed);
    imageLabel?.setAttribute('title', imageAllowed ? 'Adjuntar imagen' : 'Este modelo no admite imágenes. Elegí Gemma 4, Llama 4 Scout o Mistral Small 3.1.');
  }

  const usageNote = document.createElement('p');
  usageNote.className = 'beta-model-note';
  usageNote.textContent = 'Hasta 1.000 consultas de Beta por modelo al día. El cupo de neuronas de Cloudflare se comparte entre modelos y puede agotarse antes; en plan pago, el uso que exceda el cupo gratuito puede generar cargos.';
  modelControl.append(usageNote);
  modelSelect.addEventListener('change', () => {
    try { if (ownerId) localStorage.setItem(`mediachafa-beta-model:${ownerId}`, modelSelect.value); } catch {}
    renderModelOptions();
    const model = modelCatalog.find(item => item.id === modelSelect.value);
    setStatus(model?.vision ? `${model.name} seleccionado; acepta imágenes y audio.` : `${model?.name || 'Modelo'} seleccionado; acepta texto y audio. Para imágenes, elegí un modelo con visión.`);
  });

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
  document.head.append(workspaceStyle);

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
      const title = document.createElement('strong');
      title.textContent = `${proposal.provider} · ${proposal.type.replaceAll('_', ' ')}`;
      const summary = document.createElement('p');
      summary.textContent = proposal.summary;
      card.append(title, summary);
      if (proposal.path || proposal.name) {
        const target = document.createElement('p');
        target.className = 'beta-proposal-target';
        target.textContent = proposal.path ? `Ruta: ${proposal.path}` : `Nombre: ${proposal.name}`;
        card.append(target);
      }
      const detail = proposal.query ?? proposal.content;
      if (detail !== undefined) {
        const pre = document.createElement('pre');
        pre.textContent = detail;
        card.append(pre);
      }
      const warning = document.createElement('small');
      warning.textContent = `Vista previa exacta · vence en ${Math.ceil(expiresInSeconds / 60)} min · se ejecutará solo si aprobás esta vez.`;
      card.append(warning);
      const controls = document.createElement('div');
      controls.className = 'beta-proposal-controls';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'add-btn beta-action-approve';
      approve.textContent = 'Aprobar una vez';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'secondary beta-action-reject';
      reject.textContent = 'Denegar';
      const result = document.createElement('span');
      result.className = 'beta-action-result';
      controls.append(approve, reject);
      card.append(controls, result);
      approve.addEventListener('click', async () => {
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
      renderModelOptions();
      setStatus('Sesión conectada. El chat se guarda en este dispositivo.');
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
    if (remaining <= 0) { setStatus('Llegaste al límite de consultas de hoy.', 'error'); return; }
    const selectedModel = modelCatalog.find(item => item.id === modelSelect.value);
    if (pendingImage && !selectedModel?.vision) { setStatus('Este modelo no admite imágenes. Elegí Gemma 4, Llama 4 Scout o Mistral Small 3.1.', 'error'); return; }
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
      if (data.modelId) updateModelUsage(data.modelId, data);
      if (!response.ok) throw new Error(data.error || `Beta respondió ${response.status}.`);
      const answer = data.transcript ? `Transcripción: ${data.transcript}\n\n${data.answer}` : data.answer;
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
      if (!data.proposals?.length) setStatus('Respuesta recibida.');
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
      for (const provider of ['github', 'supabase', 'cloudflare']) {
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
    } catch (error) {
      for (const provider of ['github', 'supabase', 'cloudflare']) $(`#beta-connection-${provider}`).textContent = error.message;
    }
  }

  document.querySelectorAll('[data-beta-connect]').forEach(button => button.addEventListener('click', async () => {
    const provider = button.dataset.betaConnect;
    const input = $(`#beta-token-${provider}`);
    const token = input?.value.trim();
    if (!token) { input?.focus(); $(`#beta-connection-${provider}`).textContent = 'Pegá el token de acceso para conectarlo.'; return; }
    button.disabled = true;
    $(`#beta-connection-${provider}`).textContent = 'Validando y guardando cifrado…';
    try {
      await api('/integrations/connect', { method: 'POST', body: JSON.stringify({ provider, token }) });
      input.value = '';
      await loadIntegrations();
    } catch (error) {
      $(`#beta-connection-${provider}`).textContent = error.message;
    } finally { button.disabled = false; }
  }));

  document.querySelectorAll('[data-beta-disconnect]').forEach(button => button.addEventListener('click', async () => {
    const provider = button.dataset.betaDisconnect;
    if (!window.confirm(`¿Desconectar ${provider}? Beta dejará de acceder a esta integración.`)) return;
    button.disabled = true;
    try { await api('/integrations/disconnect', { method: 'POST', body: JSON.stringify({ provider }) }); await loadIntegrations(); }
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
