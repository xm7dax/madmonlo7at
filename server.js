import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = 3001;
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
let liveConnection = null;
let currentUsername = '';

const httpServer = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, requested);
  if (!filePath.startsWith(__dirname + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    response.end(data);
  });
});

const socketServer = new WebSocketServer({ server: httpServer });
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of socketServer.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
function status(message, state = '') {
  broadcast({ type: 'status', message, state });
}
async function disconnectLive() {
  const previous = liveConnection;
  liveConnection = null;
  currentUsername = '';
  if (previous) {
    try { previous.disconnect(); } catch { /* already disconnected */ }
  }
}

socketServer.on('connection', (socket) => {
  socket.on('message', async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== 'connect') return;
    const username = String(message.username || '').trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
      socket.send(JSON.stringify({ type: 'status', message: 'يوزر البث غير صحيح', state: 'error' }));
      return;
    }
    await disconnectLive();
    currentUsername = username;
    status('جارٍ الاتصال ببث @' + username + '…');
    const connection = new TikTokLiveConnection(username, { processInitialData: false });
    liveConnection = connection;
    connection.on(ControlEvent.CONNECTED, () => status('متصل ببث @' + username, 'connected'));
    connection.on(ControlEvent.DISCONNECTED, () => {
      if (liveConnection === connection) status('انقطع الاتصال بالبث', 'error');
    });
    connection.on(ControlEvent.ERROR, (error) => {
      console.error('TikTok LIVE connection error:', error?.message || error);
      if (liveConnection === connection) status('تعذر الاتصال بالبث؛ تحقق من اليوزر وحالة البث', 'error');
    });
    connection.on(WebcastEvent.CHAT, (event) => {
      if (liveConnection !== connection) return;
      broadcast({ type: 'chat', user: event.user?.displayId || event.user?.uniqueId || event.user?.unique_id || '', displayName: event.user?.nickname || '', comment: event.content ?? event.comment ?? '', userId: String(event.user?.id ?? event.user?.userId ?? '') });
    });
    try {
      await connection.connect();
      if (liveConnection === connection) status('متصل ببث @' + username, 'connected');
    } catch (error) {
      console.error('Could not connect to TikTok LIVE:', error?.message || error);
      if (liveConnection === connection) {
        liveConnection = null;
        currentUsername = '';
        status('تعذر الاتصال؛ تأكد أن البث مباشر واليوزر صحيح', 'error');
      }
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`لوحة المزاد على هذا الكمبيوتر: http://127.0.0.1:${port}`);
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === 'IPv4' && !network.internal)
    .map((network) => network.address);
  for (const address of addresses) {
    console.log(`لفتحها من الآيباد على شبكة Wi-Fi نفسها: http://${address}:${port}`);
  }
});
process.on('SIGINT', async () => {
  await disconnectLive();
  socketServer.close();
  httpServer.close(() => process.exit(0));
});



