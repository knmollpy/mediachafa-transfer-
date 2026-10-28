import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
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
let disconnectListener;
let isConnecting = false;

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
  activeDevice = activeAdb = activeClient = activeDecoder = activeVideoStream = undefined;
  if (device && disconnectListener) device.raw.removeEventListener('disconnect', disconnectListener);
  disconnectListener = undefined;
  try { await client?.close(); } catch { /* ya se cerró al quitar el cable */ }
  try { await adb?.close(); } catch { /* la conexión USB ya no responde */ }
  try { decoder?.dispose(); } catch { /* el decodificador ya terminó */ }
  setControlsEnabled(false);
  deviceName.textContent = 'Sin teléfono conectado';
  showPlaceholder('La pantalla aparecerá acá', 'Conectá el Android por USB y autorizá esta computadora para empezar.');
  setStatus(message, state);
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
    const serverResponse = await fetch('/scrcpy-server.bin', { cache: 'force-cache' });
    if (!serverResponse.ok) throw new Error('No se pudo cargar el componente de transmisión. Recargá MediaChafa e intentá otra vez.');
    await AdbScrcpyClient.pushServer(adb, serverResponse.body);
    client = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', new AdbScrcpyOptionsLatest({
      video: true,
      audio: false,
      control: true,
      maxSize: 1440,
      maxFps: 30,
      videoBitRate: 8000000,
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
    stage.replaceChildren(decoder.renderer.canvas);
    void videoStream.stream.pipeTo(decoder.writable).catch((error) => {
      if (activeClient === client) void stopMirror({ message: error?.message || 'La transmisión se interrumpió.', state: 'error' });
    });

    deviceName.textContent = videoStream.metadata.deviceName || device.name || device.raw.productName || 'Teléfono Android';
    setControlsEnabled(true);
    setStatus('Teléfono conectado. Hacé clic o tocá la pantalla para controlarlo.', 'connected');
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
