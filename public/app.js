const $ = (id) => document.getElementById(id);
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
const MAX_SIDE = 1920; // ย่อภาพก่อนส่งเพื่อให้ส่งเร็ว

let ws;
let role = null;
let room = null;
let pending = []; // ข้อความที่รอส่งตอน socket ยังไม่เปิด

// ---------- WebSocket ----------
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    $('conn').textContent = 'เชื่อมต่อแล้ว';
    $('conn').classList.add('on');
    pending.forEach((m) => ws.send(m));
    pending = [];
  };
  ws.onclose = () => {
    $('conn').textContent = 'หลุดการเชื่อมต่อ';
    $('conn').classList.remove('on');
    if (role) toast('การเชื่อมต่อหลุด กรุณาโหลดหน้าใหม่');
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function send(msg) {
  const s = JSON.stringify(msg);
  if (ws.readyState === WebSocket.OPEN) ws.send(s);
  else pending.push(s);
}

function show(view) {
  for (const v of ['home', 'share', 'watch']) $(v).hidden = v !== view;
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

function handle(msg) {
  switch (msg.type) {
    case 'created': return onCreated(msg.room);
    case 'joined': return onJoined(msg);
    case 'error': toast(msg.message); show('home'); role = null; return;
    case 'viewer-joined':
      viewers.add(msg.id);
      $('viewerCount').textContent = msg.count;
      if (stream) callViewer(msg.id);
      return;
    case 'viewer-left':
      viewers.delete(msg.id);
      $('viewerCount').textContent = msg.count;
      closePeer(msg.id);
      return;
    case 'image-sent': $('sendStatus').textContent = `ส่งแล้ว ${new Date().toLocaleTimeString('th-TH')} · ${msg.count} คนเห็น`; return;
    case 'signal': return onSignal(msg.from, msg.data);
    case 'image': return showImage(msg.data, true);
    case 'live-stopped': return stopRemote();
    case 'ended': $('watchState').textContent = 'ผู้แชร์ปิดห้องแล้ว'; stopRemote(); return;
  }
}

// ---------- ผู้แชร์ ----------
const peers = new Map(); // viewerId -> RTCPeerConnection
const viewers = new Set();
let stream = null;

function onCreated(code) {
  room = code;
  $('roomCode').textContent = code;
  const link = `${location.origin}${location.pathname}?room=${code}`;
  $('btnCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      prompt('คัดลอกลิงก์นี้:', link);
    }
  };
  if (window.qrcode) {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } else {
    $('qr').hidden = true;
  }
  history.replaceState(null, '', location.pathname);
}

$('btnCreate').onclick = () => {
  role = 'sender';
  show('share');
  send({ type: 'create' });
  setupLiveSupport();
};

function setupLiveSupport() {
  const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  if (supported) return;
  $('btnLive').disabled = true;
  $('liveHelp').textContent = !window.isSecureContext
    ? 'ต้องเปิดผ่าน https หรือ localhost จึงจะแชร์หน้าจอสดได้ — ตอนนี้ใช้ “ส่งภาพหน้าจอ” ได้ตามปกติ'
    : 'อุปกรณ์/เบราว์เซอร์นี้ยังไม่รองรับการแชร์หน้าจอสด (iPhone และ Android ส่วนใหญ่) — ใช้ “ส่งภาพหน้าจอ” ด้านบนแทน';
}

$('fileInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    $('sendStatus').textContent = 'กำลังส่ง…';
    try {
      send({ type: 'image', data: await shrink(f) });
    } catch {
      toast('อ่านไฟล์ภาพไม่ได้');
    }
  }
};

// ย่อภาพให้ด้านยาวไม่เกิน MAX_SIDE แล้วแปลงเป็น JPEG
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$('btnLive').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, displaySurface: 'window' }, audio: false });
  } catch {
    return toast('ยกเลิกการแชร์หน้าจอ');
  }
  $('preview').srcObject = stream;
  $('preview').hidden = false;
  $('btnLive').hidden = true;
  $('btnStop').hidden = false;
  stream.getVideoTracks()[0].onended = stopLive;
  send({ type: 'live', on: true });
  for (const id of viewers) callViewer(id);
};
$('btnStop').onclick = stopLive;

function stopLive() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  for (const id of [...peers.keys()]) closePeer(id);
  $('preview').hidden = true;
  $('btnLive').hidden = false;
  $('btnStop').hidden = true;
  send({ type: 'live', on: false });
}

function newPeer(id) {
  const pc = new RTCPeerConnection(ICE);
  pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', to: id, data: { ice: e.candidate } });
  peers.set(id, pc);
  return pc;
}

async function callViewer(id) {
  if (peers.has(id)) return;
  const pc = newPeer(id);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  await pc.setLocalDescription(await pc.createOffer());
  send({ type: 'signal', to: id, data: { sdp: pc.localDescription } });
}

function closePeer(id) {
  const pc = peers.get(id);
  if (pc) pc.close();
  peers.delete(id);
}

// ---------- ผู้ชม ----------
let viewerPc = null;

function join(code) {
  role = 'viewer';
  room = code;
  $('watchRoom').textContent = code;
  show('watch');
  send({ type: 'join', room: code });
}

$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  join($('roomInput').value.trim());
};

function onJoined(msg) {
  $('watchState').textContent = msg.live ? 'กำลังเชื่อมต่อภาพสด…' : 'เชื่อมต่อแล้ว รอผู้แชร์ส่งหน้าจอ';
  history.replaceState(null, '', `${location.pathname}?room=${msg.room}`);
}

async function onSignal(from, data) {
  if (role === 'sender') {
    const pc = peers.get(from);
    if (!pc) return;
    if (data.sdp) await pc.setRemoteDescription(data.sdp);
    else if (data.ice) await pc.addIceCandidate(data.ice).catch(() => {});
    return;
  }
  // ผู้ชม: รับ offer จากผู้แชร์
  if (data.sdp) {
    if (viewerPc) viewerPc.close();
    viewerPc = new RTCPeerConnection(ICE);
    viewerPc.onicecandidate = (e) => e.candidate && send({ type: 'signal', data: { ice: e.candidate } });
    viewerPc.ontrack = (e) => {
      const v = $('remote');
      v.srcObject = e.streams[0];
      v.hidden = false;
      $('shot').hidden = true;
      $('empty').hidden = true;
      $('watchState').textContent = '🔴 กำลังดูภาพสด';
      v.play().catch(() => {});
    };
    viewerPc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(viewerPc.connectionState)) $('watchState').textContent = 'สัญญาณภาพสดหลุด';
    };
    await viewerPc.setRemoteDescription(data.sdp);
    await viewerPc.setLocalDescription(await viewerPc.createAnswer());
    send({ type: 'signal', data: { sdp: viewerPc.localDescription } });
  } else if (data.ice && viewerPc) {
    await viewerPc.addIceCandidate(data.ice).catch(() => {});
  }
}

function stopRemote() {
  if (viewerPc) viewerPc.close();
  viewerPc = null;
  $('remote').hidden = true;
  $('remote').srcObject = null;
  if (!$('shot').src) $('empty').hidden = false;
  else $('shot').hidden = false;
  if ($('watchState').textContent.includes('สด')) $('watchState').textContent = 'ผู้แชร์หยุดภาพสดแล้ว';
}

function showImage(src, addToHistory) {
  if (role !== 'viewer') return;
  const img = $('shot');
  img.src = src;
  if ($('remote').hidden) img.hidden = false;
  $('empty').hidden = true;
  if (!addToHistory) return;
  $('watchState').textContent = `ภาพล่าสุด ${new Date().toLocaleTimeString('th-TH')}`;
  const h = $('history');
  h.querySelectorAll('img').forEach((t) => t.classList.remove('active'));
  const thumb = document.createElement('img');
  thumb.src = src;
  thumb.className = 'active';
  thumb.alt = 'ภาพก่อนหน้า';
  thumb.onclick = () => {
    h.querySelectorAll('img').forEach((t) => t.classList.remove('active'));
    thumb.classList.add('active');
    showImage(src, false);
  };
  h.prepend(thumb);
  while (h.children.length > 30) h.lastChild.remove();
}

$('btnFull').onclick = () => {
  const stage = $('stage');
  const video = $('remote');
  if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  else if (!video.hidden && video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
  else toast('อุปกรณ์นี้ไม่รองรับโหมดเต็มจอ');
};

// ---------- เริ่มต้น ----------
connect();
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) join(qRoom);
