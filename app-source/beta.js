const $ = (selector) => document.querySelector(selector);
const API = 'https://mediachafa-beta-ai.nxmollpy.workers.dev';
const messagesNode = $('#beta-messages');
const form = $('#beta-form');
const input = $('#beta-input');
const sendButton = $('#beta-send');
const status = $('#beta-status');
const imageInput = $('#beta-image');
const audioInput = $('#beta-audio');
let pendingImage;
let pendingAudio;
let history = [];
let remaining = 4;

function setStatus(message, kind = 'idle') {
  status.textContent = message;
  status.dataset.state = kind;
}

function addMessage(role, content) {
  messagesNode.querySelector('.beta-empty')?.remove();
  const article = document.createElement('article');
  article.className = `beta-message ${role}`;
  const heading = document.createElement('strong');
  heading.textContent = role === 'user' ? 'Vos' : 'Beta';
  const body = document.createElement('p');
  body.textContent = content;
  article.append(heading, body);
  messagesNode.append(article);
  messagesNode.scrollTop = messagesNode.scrollHeight;
}

async function currentSession() {
  if (typeof window.mediaChafaBetaAuth !== 'function') throw new Error('No se pudo validar la sesión de MediaChafa. Recargá la página.');
  const auth = await window.mediaChafaBetaAuth();
  if (!auth?.owner || !auth?.token || auth?.anonymous) throw new Error('Beta está disponible solo cuando iniciaste sesión con la cuenta dueña.');
  return auth;
}

async function refreshQuota() {
  try {
    const auth = await currentSession();
    const response = await fetch(`${API}/status`, { headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await response.json();
    if (response.ok) { remaining = data.remaining; setStatus(`Quedan ${remaining} de ${data.dailyLimit} consultas de hoy. Usa la cuota diaria sin cargo de Workers AI.`); }
  } catch (error) { setStatus(error.message || 'No se pudo revisar la cuota.', 'error'); }
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

function showAttachment(file, type) {
  const node = type === 'image' ? $('#beta-image-name') : $('#beta-audio-name');
  node.textContent = file ? `Adjunto: ${file.name}` : '';
}

imageInput.addEventListener('change', () => {
  pendingImage = imageInput.files?.[0];
  if (pendingImage && pendingImage.size > 5 * 1024 * 1024) { pendingImage = undefined; imageInput.value = ''; setStatus('La imagen supera el límite de 5 MB.', 'error'); }
  showAttachment(pendingImage, 'image');
});
audioInput.addEventListener('change', () => {
  pendingAudio = audioInput.files?.[0];
  if (pendingAudio && pendingAudio.size > 5 * 1024 * 1024) { pendingAudio = undefined; audioInput.value = ''; setStatus('El audio supera el límite de 5 MB.', 'error'); }
  showAttachment(pendingAudio, 'audio');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (!prompt && !pendingImage && !pendingAudio) { setStatus('Escribí un mensaje o adjuntá una imagen o audio.', 'error'); return; }
  if (remaining <= 0) { setStatus('Llegaste al límite gratuito de hoy.', 'error'); return; }
  sendButton.disabled = true;
  setStatus('La Beta está analizando tu mensaje…');
  try {
    const auth = await currentSession();
    const image = pendingImage ? { data: await fileToBase64(pendingImage) } : undefined;
    const audio = pendingAudio ? { data: (await fileToBase64(pendingAudio)).split(',')[1], mime: pendingAudio.type || 'audio/mpeg' } : undefined;
    const userText = prompt || (image ? 'Analizá la imagen adjunta.' : 'Transcribí y analizá el audio adjunto.');
    addMessage('user', `${userText}${pendingImage ? `\n[Imagen: ${pendingImage.name}]` : ''}${pendingAudio ? `\n[Audio: ${pendingAudio.name}]` : ''}`);
    const response = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText, history, image, audio }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `La IA respondió ${response.status}.`);
    const answer = data.transcript ? `Transcripción: ${data.transcript}\n\n${data.answer}` : data.answer;
    history.push({ role: 'user', content: userText }, { role: 'assistant', content: data.answer });
    history = history.slice(-8);
    addMessage('assistant', answer);
    remaining = data.remaining;
    setStatus(`Quedan ${remaining} de 4 consultas de hoy. La cuota diaria se reinicia a las 00:00 UTC.`);
    input.value = '';
    pendingImage = pendingAudio = undefined;
    imageInput.value = audioInput.value = '';
    showAttachment(undefined, 'image'); showAttachment(undefined, 'audio');
  } catch (error) {
    setStatus(error?.message || 'No se pudo enviar el mensaje.', 'error');
  } finally { sendButton.disabled = false; }
});

$('#beta-clear').addEventListener('click', () => { history = []; messagesNode.replaceChildren(); setStatus('Chat borrado de esta pestaña.'); });
void refreshQuota();
