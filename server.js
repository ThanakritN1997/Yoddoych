// เซิร์ฟเวอร์สะท้อนหน้าจอ: เสิร์ฟไฟล์หน้าเว็บ + WebSocket สำหรับจับคู่ห้อง, ส่งสัญญาณ WebRTC และส่งต่อภาพหน้าจอ
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const studio = require('./studio-server');
const mirror = require('./mirror-server');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    if (!isLocal(req)) return res.writeHead(403).end();
    const api = req.url.startsWith('/api/mirror') ? mirror : studio;
    if ((await api.handleApi(req, res)) === false) res.writeHead(404).end();
    return;
  }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ไม่พบหน้า');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// rooms: code -> { sender, viewers: Map<id, ws>, lastImage, live }
const rooms = new Map();
let nextId = 1;

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function newRoomCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000));
  while (rooms.has(code));
  return code;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
const studioWss = studio.attach();

// /studio = ส่งวิดีโอไปไลฟ์, ที่เหลือ = ห้องสะท้อนหน้าจอ
server.on('upgrade', (req, socket, head) => {
  const isStudio = req.url.startsWith('/studio');
  if (isStudio && !isLocal(req)) return socket.destroy(); // สตูดิโอใช้ได้เฉพาะบนเครื่องนี้
  const target = isStudio ? studioWss : wss;
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.id = String(nextId++);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const room = ws.room && rooms.get(ws.room);

    switch (msg.type) {
      case 'create': {
        const code = newRoomCode();
        rooms.set(code, { sender: ws, viewers: new Map(), lastImage: null, live: false });
        ws.room = code;
        ws.role = 'sender';
        send(ws, { type: 'created', room: code });
        break;
      }
      case 'join': {
        const target = rooms.get(String(msg.room || '').trim());
        if (!target) {
          send(ws, { type: 'error', message: 'ไม่พบห้องนี้ หรือผู้แชร์ปิดห้องไปแล้ว' });
          return;
        }
        ws.room = String(msg.room).trim();
        ws.role = 'viewer';
        target.viewers.set(ws.id, ws);
        send(ws, { type: 'joined', room: ws.room, id: ws.id, live: target.live });
        if (target.lastImage) send(ws, { type: 'image', ...target.lastImage });
        send(target.sender, { type: 'viewer-joined', id: ws.id, count: target.viewers.size });
        break;
      }
      case 'signal': {
        // ส่งต่อ offer/answer/ice ระหว่างผู้แชร์กับผู้ชม
        if (!room) return;
        const to = ws.role === 'sender' ? room.viewers.get(msg.to) : room.sender;
        send(to, { type: 'signal', from: ws.id, data: msg.data });
        break;
      }
      case 'image': {
        if (!room || ws.role !== 'sender') return;
        room.lastImage = { data: msg.data, time: Date.now() };
        for (const v of room.viewers.values()) send(v, { type: 'image', ...room.lastImage });
        send(ws, { type: 'image-sent', count: room.viewers.size });
        break;
      }
      case 'live': {
        if (!room || ws.role !== 'sender') return;
        room.live = !!msg.on;
        if (!room.live) for (const v of room.viewers.values()) send(v, { type: 'live-stopped' });
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (ws.role === 'sender') {
      for (const v of room.viewers.values()) send(v, { type: 'ended' });
      rooms.delete(ws.room);
    } else {
      room.viewers.delete(ws.id);
      send(room.sender, { type: 'viewer-left', id: ws.id, count: room.viewers.size });
    }
  });
});

// ตัดการเชื่อมต่อที่หลุดไปแล้ว
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`\nเว็บสะท้อนหน้าจอพร้อมใช้งาน`);
  console.log(`  เครื่องนี้:      http://localhost:${PORT}`);
  console.log(`  สตูดิโอไลฟ์:    http://localhost:${PORT}/studio.html`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  มือถือ (Wi-Fi เดียวกัน): http://${n.address}:${PORT}`);
    }
  }
  console.log('');
  // ตรวจตัวเข้ารหัสไว้ก่อน หน้าสตูดิโอจะได้ไม่ต้องรอ
  setTimeout(() => console.log('  ตัวเข้ารหัสที่ใช้ได้: ' + studio.detectEncoders().map((e) => e.id).join(', ')), 100);
});
