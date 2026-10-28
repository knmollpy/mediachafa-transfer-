import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 27831;
const token = crypto.randomBytes(24).toString('hex');
const allowedOrigins = new Set([
  'https://mediachafa-transfer.vercel.app',
]);

function privateIp(host) {
  const family = net.isIP(host);
  if (family === 4) {
    const p = host.split('.').map(Number);
    return p[0] === 10 || p[0] === 192 && p[1] === 168 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 169 && p[1] === 254;
  }
  if (family === 6) return host === '::1' || host.toLowerCase().startsWith('fc') || host.toLowerCase().startsWith('fd') || host.toLowerCase().startsWith('fe80:');
  return false;
}

function authorized(req) {
  const origin = req.headers.origin;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  return allowedOrigins.has(origin) && supplied.length === token.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error('La solicitud supera el tamaño permitido.');
  }
  return JSON.parse(text || '{}');
}

async function adb(args) {
  const { stdout, stderr } = await exec(process.env.ADB_PATH || 'adb', args, { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return `${stdout}${stderr}`.trim();
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || !['/api/pair', '/api/connect'].includes(new URL(req.url, `http://${HOST}`).pathname)) { json(res, 404, { error: 'Ruta no encontrada.' }); return; }
  if (!authorized(req)) { json(res, 403, { error: 'Token incorrecto o solicitud desde un origen no autorizado.' }); return; }
  try {
    const data = await body(req);
    const host = String(data.host || '').trim();
    if (!privateIp(host)) throw new Error('Usá la dirección IP local que muestra la depuración inalámbrica de tu teléfono.');
    const pathname = new URL(req.url, `http://${HOST}`).pathname;
    if (pathname === '/api/pair') {
      const port = Number(data.port);
      const code = String(data.code || '');
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\d{6}$/.test(code)) throw new Error('Puerto o código de emparejamiento inválido.');
      const result = await adb(['pair', `${host}:${port}`, code]);
      if (!/success|emparejado/i.test(result)) throw new Error(result || 'ADB no confirmó el emparejamiento.');
      json(res, 200, { message: 'Emparejado en esta computadora. Ahora podés conectarte.' });
    } else {
      const port = Number(data.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto de conexión inválido.');
      const result = await adb(['connect', `${host}:${port}`]);
      if (/unable|failed|cannot|refused/i.test(result)) throw new Error(result);
      json(res, 200, { message: result || 'Teléfono conectado por ADB.' });
    }
  } catch (error) { json(res, 400, { error: error?.message || 'Falló la operación ADB.' }); }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}`);
  const supplied = url.searchParams.get('token') || '';
  if (url.pathname !== '/adb' || !allowedOrigins.has(req.headers.origin) || supplied.length !== token.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws));
});

sockets.on('connection', (ws) => {
  const tcp = net.createConnection({ host: HOST, port: 5037 });
  tcp.on('connect', () => { ws.on('message', (data, binary) => { if (binary) tcp.write(data); }); });
  tcp.on('data', (data) => { if (ws.readyState === ws.OPEN) ws.send(data, { binary: true }); });
  const close = () => { tcp.destroy(); if (ws.readyState === ws.OPEN) ws.close(); };
  tcp.on('error', () => close()); tcp.on('close', () => { if (ws.readyState === ws.OPEN) ws.close(); }); ws.on('close', () => tcp.destroy()); ws.on('error', close);
});

try { await adb(['start-server']); }
catch (error) { console.error('No se pudo iniciar ADB. Instalá Android Platform Tools y revisá que adb esté en PATH.'); console.error(error.message); process.exit(1); }
server.listen(PORT, HOST, () => {
  console.log('\nMediaChafa · auxiliar local para Android');
  console.log(`Escuchando solo en ${HOST}:${PORT}`);
  console.log(`Token temporal: ${token}`);
  console.log('Pegá el token en la sección Teléfono de MediaChafa. Dejá esta ventana abierta.');
  console.log('Para salir, cerrá esta ventana o presioná Ctrl+C.\n');
});

function shutdown() { for (const ws of sockets.clients) ws.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
