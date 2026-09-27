// ควบคุมตัวรับ AirPlay (UxPlay) จากหน้าเว็บ: เปิด/ปิด และบอกสถานะว่า iPhone ต่ออยู่ไหม
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UXPLAY_DIR = process.env.UXPLAY_DIR || 'C:\\msys64\\ucrt64\\bin';
const UXPLAY = path.join(UXPLAY_DIR, 'uxplay.exe');
const NAME = process.env.MIRROR_NAME || 'PC-Mirror';

let proc = null;
let state = { connected: 0, device: '', streaming: false, lastLine: '' };

// ใช้ MAC ของการ์ดแลน/Wi-Fi จริง (ข้าม VPN / เครื่องเสมือน) เป็น Device ID
function lanMac() {
  const skip = /vpn|radmin|virtual|vethernet|hyper-v|wsl|tailscale|zerotier|loopback|bluetooth/i;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    const a = (addrs || []).find((x) => x.family === 'IPv4' && !x.internal && !x.address.startsWith('169.254.'));
    if (a && a.mac && a.mac !== '00:00:00:00:00:00') return a.mac;
  }
  return null;
}

function externalRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq uxplay.exe', '/NH'], { windowsHide: true, encoding: 'utf8' });
  return /uxplay\.exe/i.test(r.stdout || '');
}

function onLine(line) {
  state.lastLine = line;
  let m;
  if ((m = line.match(/connection request from (.+?) \(/))) state.device = m[1];
  if (/Accepted .* client on socket/.test(line)) state.connected++;
  if (/Connection closed on socket/.test(line)) state.connected = Math.max(0, state.connected - 1);
  if (/Begin streaming to GStreamer video/.test(line)) state.streaming = true;
  if (/lost connection with client/.test(line)) state.connected = 0;
  if (!state.connected) {
    state.streaming = false;
    state.device = '';
  }
}

function start() {
  if (proc) return status();
  if (!fs.existsSync(UXPLAY)) return { ...status(), error: 'ไม่พบ uxplay.exe ที่ ' + UXPLAY };
  // ปิดตัวที่เปิดค้างไว้ (เช่นจาก start.bat เดิม) เพื่อไม่ให้พอร์ตชนกัน
  spawnSync('taskkill', ['/IM', 'uxplay.exe', '/F'], { windowsHide: true });

  const args = ['-n', NAME, '-nh', '-p', '-nohold', '-vs', 'd3d12videosink'];
  const mac = lanMac();
  if (mac) args.push('-m', mac);

  state = { connected: 0, device: '', streaming: false, lastLine: '' };
  const p = spawn(UXPLAY, args, {
    cwd: UXPLAY_DIR,
    env: { ...process.env, PATH: UXPLAY_DIR + ';' + process.env.PATH },
    windowsHide: false, // หน้าต่างภาพ iPhone ต้องแสดง เพื่อให้เลือกแชร์หน้าต่างได้
  });
  proc = p;
  let buf = '';
  const read = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    lines.forEach((l) => l.trim() && onLine(l.trim()));
  };
  p.stdout.on('data', read);
  p.stderr.on('data', read);
  p.on('exit', () => {
    if (proc === p) proc = null;
  });
  p.on('error', (e) => {
    state.lastLine = e.message;
    if (proc === p) proc = null;
  });
  return status();
}

function stop() {
  if (proc) proc.kill();
  proc = null;
  spawnSync('taskkill', ['/IM', 'uxplay.exe', '/F'], { windowsHide: true });
  return status();
}

function status() {
  return {
    installed: fs.existsSync(UXPLAY),
    running: !!proc,
    external: !proc && externalRunning(),
    name: NAME,
    connected: state.connected > 0,
    device: state.device,
    streaming: state.streaming,
  };
}

async function handleApi(req, res) {
  const json = (obj) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  if (req.url === '/api/mirror' && req.method === 'GET') return json(status());
  if (req.url === '/api/mirror/start' && req.method === 'POST') return json(start());
  if (req.url === '/api/mirror/stop' && req.method === 'POST') return json(stop());
  return false;
}

process.on('exit', () => proc && proc.kill());

module.exports = { handleApi };
