import { Adb, AdbDaemonTransport, AdbServerClient } from '@yume-chan/adb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { AndroidKeyCode, AndroidKeyEventAction, AndroidMotionEventAction } from '@yume-chan/scrcpy';
import { BitmapVideoFrameRenderer, WebCodecsVideoDecoder, WebGLVideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs';

const $ = (selector) => document.querySelector(selector);
const connectButton = $('#phone-connect');
const disconnectButton = $('#phone-disconnect');
const fullscreenButton = $('#phone-fullscreen');
const backButton = $('#phone-back');
const stage = $('#phone-stage');
const stageShell = $('#phone-fullscreen-area');
const status = $('#phone-status');
const deviceName = $('#phone-device-name');
const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

let activeDevice;
let activeAdb;
let activeClient;
let activeDecoder;
let activeVideoStream;
let activeVideoStats;
let disconnectListener;
let isConnecting = false;
let wirelessSocket;
const wifiStatus = $('#phone-wifi-status');
const setWifiStatus = (message, state = 'idle') => { if (wifiStatus) { wifiStatus.textContent = message; wifiStatus.dataset.state = state; } };

function helperRequest(path, token, payload) {
  return fetch(`http://127.0.0.1:27831${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `El auxiliar respondió ${response.status}.`);
    return result;
  });
}

async function downloadPhoneHelper() {
  const button = $('#phone-helper-download');
  const output = $('#phone-helper-download-status');
  button.disabled = true; output.textContent = 'Preparando el ZIP…'; output.dataset.state = 'idle';
  try {
    const names = ['README.md', 'package.json', 'companion.mjs', 'start-linux.sh', 'start-windows.bat'];
    const entries = await Promise.all(names.map(async (name) => {
      const response = await fetch(`/app-source/phone-helper/${name}`);
      if (!response.ok) throw new Error(`No se pudo descargar ${name}.`);
      return { name: `MediaChafa-Phone-Helper/${name}`, data: new Uint8Array(await response.arrayBuffer()) };
    }));
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
    const encoder = new TextEncoder(); const localParts = []; const directoryParts = []; let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name); const crc = crc32(entry.data);
      const local = new Uint8Array(30 + name.length + entry.data.length); const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true); localView.setUint16(6, 0x0800, true); localView.setUint16(8, 0, true);
      localView.setUint32(14, crc, true); localView.setUint32(18, entry.data.length, true); localView.setUint32(22, entry.data.length, true); localView.setUint16(26, name.length, true); localView.setUint16(28, 0, true);
      local.set(name, 30); local.set(entry.data, 30 + name.length); localParts.push(local);
      const directory = new Uint8Array(46 + name.length); const directoryView = new DataView(directory.buffer);
      directoryView.setUint32(0, 0x02014b50, true); directoryView.setUint16(4, 20, true); directoryView.setUint16(6, 20, true); directoryView.setUint16(8, 0x0800, true); directoryView.setUint16(10, 0, true);
      directoryView.setUint32(16, crc, true); directoryView.setUint32(20, entry.data.length, true); directoryView.setUint32(24, entry.data.length, true); directoryView.setUint16(28, name.length, true);
      directoryView.setUint32(42, offset, true); directory.set(name, 46); directoryParts.push(directory); offset += local.length;
    }
    const directorySize = directoryParts.reduce((sum, part) => sum + part.length, 0); const end = new Uint8Array(22); const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true); endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
    const blob = new Blob([...localParts, ...directoryParts, end], { type: 'application/zip' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'MediaChafa-Phone-Helper.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    output.textContent = 'ZIP descargado. Extraelo y ejecutá el iniciador de tu sistema.'; output.dataset.state = 'connected';
  } catch (error) { output.textContent = error?.message || 'No se pudo preparar el ZIP.'; output.dataset.state = 'error'; }
  finally { button.disabled = false; }
}

function createWirelessConnector(token) {
  return {
    async connect() {
      const socket = new WebSocket(`ws://127.0.0.1:27831/adb?token=${encodeURIComponent(token)}`);
      socket.binaryType = 'arraybuffer';
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('No se pudo abrir el puente ADB local. Revisá que el auxiliar siga abierto y que el token sea correcto.')), { once: true });
      });
      wirelessSocket = socket;
      const closed = new Promise((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
      const readable = new ReadableStream({ start(controller) { socket.addEventListener('message', (event) => { if (event.data instanceof ArrayBuffer) controller.enqueue(new Uint8Array(event.data)); else if (event.data instanceof Blob) void event.data.arrayBuffer().then((buffer) => controller.enqueue(new Uint8Array(buffer))); }); socket.addEventListener('close', () => { try { controller.close(); } catch {} }, { once: true }); } });
      const writable = new WritableStream({ async write(data) { if (socket.readyState !== WebSocket.OPEN) throw new Error('El puente ADB local no está conectado.'); socket.send(data instanceof Uint8Array ? data : new Uint8Array(data)); }, close() { socket.close(); }, abort() { socket.close(); } });
      return { readable, writable, close() { socket.close(); }, closed };
    },
    addReverseTunnel() { throw new Error('ADB inverso no está disponible en este modo.'); },
    removeReverseTunnel() {}, clearReverseTunnels() {},
  };
}

function setStatus(message, state = 'idle') {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function setControlsEnabled(enabled) {
  fullscreenButton.disabled = !enabled;
  backButton.disabled = !enabled;
  $('#phone-home').disabled = !enabled;
  connectButton.classList.toggle('hidden', enabled);
  disconnectButton.classList.toggle('hidden', !enabled);
}

function showPlaceholder(title, message) {
  stage.replaceChildren();
  const placeholder = document.createElement('div');
  placeholder.className = 'phone-placeholder';
  const heading = document.createElement('strong');
  heading.textContent = title;
  placeholder.append(heading, document.createTextNode(message));
  stage.append(placeholder);
}

async function drainOutput(client) {
  try {
    const reader = client.output.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // El cierre de la conexión interrumpe la salida del proceso del teléfono.
  }
}

async function stopMirror({ message = 'Teléfono desconectado.', state = 'idle' } = {}) {
  const device = activeDevice;
  const adb = activeAdb;
  const client = activeClient;
  const decoder = activeDecoder;
  activeDevice = activeAdb = activeClient = activeDecoder = activeVideoStream = activeVideoStats = undefined;
  if (device && disconnectListener) device.raw.removeEventListener('disconnect', disconnectListener);
  disconnectListener = undefined;
  try { await client?.close(); } catch { /* ya se cerró al quitar el cable */ }
  try { await adb?.close(); } catch { /* la conexión USB ya no responde */ }
  try { wirelessSocket?.close(); } catch {}
  wirelessSocket = undefined;
  try { decoder?.dispose(); } catch { /* el decodificador ya terminó */ }
  if ($('#phone-wifi-mode')?.getAttribute('aria-pressed') === 'true') setWifiStatus('Auxiliar desconectado.', state === 'error' ? 'error' : 'idle');
  setControlsEnabled(false);
  $('#phone-wifi-disconnect')?.classList.add('hidden');
  deviceName.textContent = 'Sin teléfono conectado';
  showPlaceholder('La pantalla aparecerá acá', 'Conectá el Android por USB y autorizá esta computadora para empezar.');
  setStatus(message, state);
}

async function connectWirelessMirror() {
  if (isConnecting || activeClient) return;
  const token = $('#phone-helper-token').value.trim();
  const host = $('#phone-wifi-host').value.trim();
  const connectPort = Number($('#phone-connect-port').value);
  if (!token || !host || !Number.isInteger(connectPort) || connectPort < 1 || connectPort > 65535) {
    setWifiStatus('Completá el token, la IP y el puerto de conexión.', 'error'); return;
  }
  if (!WebCodecsVideoDecoder.isSupported) { setWifiStatus('Este navegador no ofrece WebCodecs. Actualizá el navegador.', 'error'); return; }
  isConnecting = true;
  $('#phone-wifi-connect').disabled = true;
  setWifiStatus('Conectando con el auxiliar local…');
  let adb; let client; let decoder;
  try {
    await helperRequest('/api/connect', token, { host, port: connectPort });
    const server = new AdbServerClient(createWirelessConnector(token));
    const serial = `${host}:${connectPort}`;
    const devices = await server.getDevices();
    if (!devices.some((device) => device.serial === serial && device.state === 'device')) throw new Error('ADB no encontró el teléfono autorizado. Verificá la IP, el puerto de conexión y que la depuración inalámbrica siga activa.');
    adb = await server.createAdb({ serial }); activeAdb = adb;
    setWifiStatus('Preparando la transmisión por Wi‑Fi…');
    const serverResponse = await fetch('/app-source/scrcpy-server.bin', { cache: 'force-cache' });
    if (!serverResponse.ok) throw new Error('No se pudo cargar el componente de transmisión. Recargá MediaChafa.');
    await AdbScrcpyClient.pushServer(adb, serverResponse.body);
    client = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', new AdbScrcpyOptionsLatest({ video: true, videoCodec: 'h264', audio: false, control: true, maxSize: 1440, maxFps: 30, videoBitRate: 8000000, sendFrameMeta: true, sendCodecMeta: true, sendDeviceMeta: true }));
    activeClient = client; void drainOutput(client);
    if (!client.videoStream) throw new Error('El teléfono no inició la transmisión de pantalla.');
    const videoStream = await client.videoStream; activeVideoStream = videoStream;
    const canvas = document.createElement('canvas');
    const renderer = WebGLVideoFrameRenderer.isSupported ? new WebGLVideoFrameRenderer(canvas) : new BitmapVideoFrameRenderer(canvas);
    decoder = new WebCodecsVideoDecoder({ codec: videoStream.metadata.codec, renderer }); activeDecoder = decoder;
    const stats = { packets: 0, frames: 0, configurations: 0, startedAt: performance.now() }; activeVideoStats = stats;
    decoder.sizeChanged(({ width, height }) => { if (activeDecoder === decoder) deviceName.textContent = `${videoStream.metadata.deviceName || 'Teléfono Android'} · ${width} × ${height}`; });
    stage.replaceChildren(decoder.renderer.canvas);
    const measured = videoStream.stream.pipeThrough(new TransformStream({ transform(packet, controller) { stats.packets++; if (packet.type === 'configuration') stats.configurations++; else if (packet.type === 'data') stats.frames++; controller.enqueue(packet); } }));
    void measured.pipeTo(decoder.writable).catch((error) => { if (activeClient === client) void stopMirror({ message: error?.message || 'La transmisión se interrumpió.', state: 'error' }); });
    deviceName.textContent = videoStream.metadata.deviceName || 'Teléfono Android'; setControlsEnabled(true);
    $('#phone-wifi-disconnect').classList.remove('hidden');
    setStatus('Conectado por Wi‑Fi. Esperando la primera imagen…', 'connected'); setWifiStatus('Conectado. Esperando imagen…', 'connected');
    const check = () => {
      if (activeClient !== client || activeDecoder !== decoder) return;
      if (decoder.framesRendered > 0) { const size = `${decoder.width} × ${decoder.height}`; setStatus(`Imagen en vivo (${size}). Hacé clic o tocá para controlarlo.`, 'connected'); setWifiStatus(`Imagen en vivo (${size}).`, 'connected'); return; }
      if (performance.now() - stats.startedAt >= 15000) { setWifiStatus(stats.packets ? 'Llegó video, pero el navegador no pudo dibujarlo. Desbloqueá el teléfono y volvé a conectar.' : 'ADB conectó, pero el teléfono no envió video. Desbloqueá la pantalla y volvé a conectar.', 'error'); return; }
      setTimeout(check, 750);
    }; setTimeout(check, 750);
    void client.exited.then(() => { if (activeClient === client) void stopMirror({ message: 'La transmisión terminó.', state: 'error' }); }).catch(() => {});
  } catch (error) {
    try { await client?.close(); } catch {} try { await adb?.close(); } catch {} try { decoder?.dispose(); } catch {}
    activeAdb = activeClient = activeDecoder = activeVideoStream = activeVideoStats = undefined;
    wirelessSocket?.close(); wirelessSocket = undefined; setControlsEnabled(false);
    setWifiStatus(error?.message || 'No se pudo conectar por Wi‑Fi.', 'error');
    setStatus(error?.message || 'No se pudo conectar por Wi‑Fi.', 'error');
  } finally { isConnecting = false; $('#phone-wifi-connect').disabled = false; }
}

async function connectMirror() {
  if (isConnecting || activeClient) return;
  if (!window.isSecureContext) {
    setStatus('Abrí MediaChafa desde su dirección HTTPS para permitir la conexión USB.', 'error');
    return;
  }
  if (!manager || !navigator.usb) {
    setStatus('Este navegador no ofrece WebUSB. Probá Brave, Opera GX u otro navegador Chromium actualizado en la computadora.', 'error');
    return;
  }
  if (!WebCodecsVideoDecoder.isSupported) {
    setStatus('Este navegador no puede decodificar la transmisión. Actualizá Brave, Opera GX u otro navegador Chromium compatible.', 'error');
    return;
  }

  isConnecting = true;
  connectButton.disabled = true;
  setStatus('Conectando. Elegí tu teléfono en la ventana del navegador…');
  let device;
  let adb;
  let client;
  let decoder;
  try {
    device = await manager.requestDevice();
    if (!device) {
      setStatus('No se seleccionó ningún teléfono.');
      return;
    }
    activeDevice = device;
    disconnectListener = () => { void stopMirror({ message: 'Se desconectó el cable USB.', state: 'error' }); };
    device.raw.addEventListener('disconnect', disconnectListener, { once: true });

    setStatus('Conectando con Android. Aceptá el aviso de depuración USB en el teléfono…');
    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore('MediaChafa'),
    });
    adb = new Adb(transport);
    activeAdb = adb;

    setStatus('Preparando la transmisión…');
    const serverResponse = await fetch('/app-source/scrcpy-server.bin', { cache: 'force-cache' });
    if (!serverResponse.ok) throw new Error('No se pudo cargar el componente de transmisión. Recargá MediaChafa e intentá otra vez.');
    await AdbScrcpyClient.pushServer(adb, serverResponse.body);
    client = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', new AdbScrcpyOptionsLatest({
      video: true,
      videoCodec: 'h264',
      audio: false,
      control: true,
      maxSize: 1440,
      maxFps: 30,
      videoBitRate: 8000000,
      sendFrameMeta: true,
      sendCodecMeta: true,
      sendDeviceMeta: true,
    }));
    activeClient = client;
    void drainOutput(client);

    if (!client.videoStream) throw new Error('El teléfono no inició la transmisión de pantalla.');
    const videoStream = await client.videoStream;
    activeVideoStream = videoStream;
    const canvas = document.createElement('canvas');
    const renderer = WebGLVideoFrameRenderer.isSupported
      ? new WebGLVideoFrameRenderer(canvas)
      : new BitmapVideoFrameRenderer(canvas);
    decoder = new WebCodecsVideoDecoder({ codec: videoStream.metadata.codec, renderer });
    activeDecoder = decoder;
    const videoStats = { packets: 0, frames: 0, configurations: 0, startedAt: performance.now() };
    activeVideoStats = videoStats;
    decoder.sizeChanged(({ width, height }) => {
      if (activeDecoder === decoder) {
        deviceName.textContent = `${videoStream.metadata.deviceName || device.name || device.raw.productName || 'Teléfono Android'} · ${width} × ${height}`;
      }
    });
    stage.replaceChildren(decoder.renderer.canvas);
    const measuredVideoStream = videoStream.stream.pipeThrough(new TransformStream({
      transform(packet, controller) {
        videoStats.packets += 1;
        if (packet.type === 'configuration') videoStats.configurations += 1;
        else if (packet.type === 'data') videoStats.frames += 1;
        controller.enqueue(packet);
      },
    }));
    void measuredVideoStream.pipeTo(decoder.writable).catch((error) => {
      if (activeClient === client) void stopMirror({ message: error?.message || 'La transmisión se interrumpió.', state: 'error' });
    });

    deviceName.textContent = videoStream.metadata.deviceName || device.name || device.raw.productName || 'Teléfono Android';
    setControlsEnabled(true);
    setStatus('Teléfono conectado. Esperando la primera imagen…', 'connected');
    const checkFirstFrame = () => {
      if (activeClient !== client || activeDecoder !== decoder) return;
      const width = decoder.width;
      const height = decoder.height;
      if (decoder.framesRendered > 0) {
        setStatus(`Imagen en vivo (${width} × ${height}). Hacé clic o tocá la pantalla para controlarlo.`, 'connected');
        return;
      }
      if (performance.now() - videoStats.startedAt >= 15000) {
        const detail = videoStats.frames > 0
          ? `Llegaron ${videoStats.frames} cuadros (${videoStats.configurations} de configuración), pero no se dibujaron. Códec: ${videoStream.metadata.codec}; cuadros dibujados: ${decoder.framesRendered}.`
          : videoStats.packets > 0
            ? `Llegó la configuración del video, pero ningún cuadro (${videoStats.configurations} paquetes de configuración). Códec: ${videoStream.metadata.codec}.`
            : `ADB conectó, pero Scrcpy no envió paquetes de video (códec: ${videoStream.metadata.codec}).`;
        setStatus(`${detail} Desbloqueá la pantalla del teléfono y volvé a conectar.`, 'error');
        return;
      }
      setTimeout(checkFirstFrame, 750);
    };
    setTimeout(checkFirstFrame, 750);
    void client.exited.then(() => {
      if (activeClient === client) void stopMirror({ message: 'La transmisión terminó. Podés volver a conectar el teléfono.', state: 'error' });
    }).catch(() => {});
  } catch (error) {
    try { await client?.close(); } catch { /* se limpia abajo */ }
    try { await adb?.close(); } catch { /* se limpia abajo */ }
    try { decoder?.dispose(); } catch { /* se limpia abajo */ }
    if (device && disconnectListener) device.raw.removeEventListener('disconnect', disconnectListener);
    activeDevice = activeAdb = activeClient = activeDecoder = activeVideoStream = undefined;
    disconnectListener = undefined;
    setControlsEnabled(false);
    deviceName.textContent = 'Sin teléfono conectado';
    showPlaceholder('No se pudo conectar', error?.message || 'Revisá el cable y los permisos de depuración USB.');
    if (error?.name === 'NotFoundError') setStatus('No se seleccionó ningún dispositivo USB. Revisá el cable e intentá de nuevo.', 'error');
    else if (/busy|claim|interface/i.test(error?.message || '')) setStatus('Otro programa está usando ADB. Cerrá Android Studio, scrcpy u otra herramienta ADB e intentá de nuevo.', 'error');
    else setStatus(error?.message || 'No se pudo conectar. Revisá la depuración USB e intentá de nuevo.', 'error');
  } finally {
    isConnecting = false;
    connectButton.disabled = false;
  }
}

function getPointerPosition(event) {
  const bounds = stage.querySelector('canvas')?.getBoundingClientRect();
  const videoWidth = activeVideoStream?.width || activeDecoder?.width || 0;
  const videoHeight = activeVideoStream?.height || activeDecoder?.height || 0;
  if (!bounds || !videoWidth || !videoHeight) return undefined;
  return {
    x: Math.max(0, Math.min(videoWidth - 1, Math.round((event.clientX - bounds.left) / bounds.width * videoWidth))),
    y: Math.max(0, Math.min(videoHeight - 1, Math.round((event.clientY - bounds.top) / bounds.height * videoHeight))),
    videoWidth,
    videoHeight,
  };
}

let pointerActive = false;
async function sendPointer(event, action) {
  const controller = activeClient?.controller;
  const point = getPointerPosition(event);
  if (!controller || !point) return;
  try {
    await controller.injectTouch({
      action,
      pointerId: 1n,
      pointerX: point.x,
      pointerY: point.y,
      videoWidth: point.videoWidth,
      videoHeight: point.videoHeight,
      pressure: action === AndroidMotionEventAction.Up || action === AndroidMotionEventAction.Cancel ? 0 : (event.pressure || 0.5),
      actionButton: action === AndroidMotionEventAction.Down || action === AndroidMotionEventAction.Up ? 1 : 0,
      buttons: action === AndroidMotionEventAction.Up || action === AndroidMotionEventAction.Cancel ? 0 : 1,
    });
  } catch {
    if (activeClient) setStatus('Se perdió el control del teléfono. Revisá el cable USB.', 'error');
  }
}

stage.addEventListener('pointerdown', (event) => {
  if (!activeClient || !(event.target instanceof HTMLCanvasElement)) return;
  event.preventDefault();
  pointerActive = true;
  stage.setPointerCapture(event.pointerId);
  void sendPointer(event, AndroidMotionEventAction.Down);
});
stage.addEventListener('pointermove', (event) => {
  if (pointerActive) {
    event.preventDefault();
    void sendPointer(event, AndroidMotionEventAction.Move);
  }
});
function releasePointer(event, action = AndroidMotionEventAction.Up) {
  if (!pointerActive) return;
  event.preventDefault();
  pointerActive = false;
  void sendPointer(event, action);
}
stage.addEventListener('pointerup', (event) => releasePointer(event));
stage.addEventListener('pointercancel', (event) => releasePointer(event, AndroidMotionEventAction.Cancel));
stage.addEventListener('lostpointercapture', (event) => releasePointer(event, AndroidMotionEventAction.Cancel));

connectButton.addEventListener('click', () => void connectMirror());
disconnectButton.addEventListener('click', () => void stopMirror());
$('#phone-pair').addEventListener('click', async () => {
  const token = $('#phone-helper-token').value.trim();
  const host = $('#phone-wifi-host').value.trim();
  const port = Number($('#phone-pair-port').value);
  const code = $('#phone-pair-code').value.trim();
  if (!token || !host || !Number.isInteger(port) || port < 1 || port > 65535 || !/^\d{6}$/.test(code)) { setWifiStatus('Ingresá el token, IP, puerto de emparejamiento y el código de seis dígitos.', 'error'); return; }
  const button = $('#phone-pair'); button.disabled = true; setWifiStatus('Emparejando en esta computadora…');
  try { const result = await helperRequest('/api/pair', token, { host, port, code }); setWifiStatus(result.message || 'Teléfono emparejado. Ahora tocá Conectar por Wi‑Fi.', 'connected'); $('#phone-pair-code').value = ''; }
  catch (error) { setWifiStatus(error?.message || 'No se pudo emparejar.', 'error'); }
  finally { button.disabled = false; }
});
$('#phone-wifi-connect').addEventListener('click', () => void connectWirelessMirror());
$('#phone-helper-download').addEventListener('click', () => void downloadPhoneHelper());
$('#phone-wifi-disconnect').addEventListener('click', () => void stopMirror({ message: 'Conexión Wi‑Fi cerrada.' }));
$('#phone-usb-mode').addEventListener('click', () => { $('#phone-usb-setup').classList.remove('hidden'); $('#phone-wifi-setup').classList.add('hidden'); $('#phone-usb-mode').setAttribute('aria-pressed', 'true'); $('#phone-wifi-mode').setAttribute('aria-pressed', 'false'); });
$('#phone-wifi-mode').addEventListener('click', () => { $('#phone-usb-setup').classList.add('hidden'); $('#phone-wifi-setup').classList.remove('hidden'); $('#phone-usb-mode').setAttribute('aria-pressed', 'false'); $('#phone-wifi-mode').setAttribute('aria-pressed', 'true'); });
backButton.addEventListener('click', async () => {
  if (!activeClient?.controller) return;
  await activeClient.controller.backOrScreenOn(AndroidKeyEventAction.Down);
  await activeClient.controller.backOrScreenOn(AndroidKeyEventAction.Up);
});
$('#phone-home').addEventListener('click', async () => {
  if (!activeClient?.controller) return;
  await activeClient.controller.injectKeyCode({ action: AndroidKeyEventAction.Down, keyCode: AndroidKeyCode.AndroidHome, repeat: 0, metaState: 0 });
  await activeClient.controller.injectKeyCode({ action: AndroidKeyEventAction.Up, keyCode: AndroidKeyCode.AndroidHome, repeat: 0, metaState: 0 });
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === stageShell) await document.exitFullscreen();
    else await stageShell.requestFullscreen();
  } catch {
    setStatus('El navegador no permitió pantalla completa. Revisá sus permisos e intentá de nuevo.', 'error');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement === stageShell ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
});
window.mediaPhoneMirrorStop = () => {
  if (activeDevice || activeAdb || activeClient) void stopMirror();
};
window.addEventListener('pagehide', window.mediaPhoneMirrorStop);
