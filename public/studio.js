const $ = (id) => document.getElementById(id);

// ---------- แพลตฟอร์ม ----------
// max = บิตเรตวิดีโอสูงสุดที่แนะนำโดยประมาณ (kbps) · orient = แนวภาพที่แพลตฟอร์มนั้นเหมาะ (h แนวนอน / v แนวตั้ง)
const PLATFORMS = {
  youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', max: 9000, orient: 'h', help: 'YouTube Studio → สร้าง → ถ่ายทอดสด → คัดลอก “คีย์สตรีม”' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', max: 9000, orient: 'h', help: 'Facebook → วิดีโอสด → ซอฟต์แวร์สตรีม → คัดลอก “คีย์สตรีม”' },
  tiktok: { name: 'TikTok', url: '', max: 6000, orient: 'v', help: 'TikTok LIVE Center → Stream key (บัญชีต้องได้สิทธิ์ไลฟ์ผ่านคอม) → คัดลอก Server URL และ Stream Key' },
  instagram: { name: 'Instagram', url: '', max: 6000, orient: 'v', help: 'instagram.com บนคอม → สร้าง → วิดีโอสด → คัดลอก Stream URL และ Stream key' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/app', max: 6000, orient: 'h', help: 'Twitch → Creator Dashboard → Settings → Stream → Primary Stream key' },
  kick: { name: 'Kick', url: 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app', max: 8000, orient: 'h', help: 'Kick → Dashboard → Settings → Stream URL & Key (ตรวจ URL ให้ตรงกับหน้า Kick)' },
  x: { name: 'X (Twitter)', url: '', max: 9000, orient: 'h', help: 'X Media Studio → Producer → Sources → สร้าง RTMP source' },
  shopee: { name: 'Shopee / Lazada Live', url: '', max: 4000, orient: 'v', help: 'ถ้าร้านได้สิทธิ์ไลฟ์ผ่าน OBS/RTMP ให้คัดลอก Push URL และ Key จากหน้าผู้ขาย' },
  custom: { name: 'RTMP อื่น ๆ', url: '', max: 20000, help: 'ใส่ Server URL (rtmp:// หรือ rtmps://) และ Stream Key' },
};

// ระดับคุณภาพ: min = บิตเรตต่ำสุดที่ยังดูดี, rec = บิตเรตที่แนะนำ
const TIERS = [
  { label: '1080p 60fps', h: 1080, fps: 60, min: 6000, rec: 8000 },
  { label: '1080p 30fps', h: 1080, fps: 30, min: 4500, rec: 6000 },
  { label: '720p 60fps', h: 720, fps: 60, min: 4000, rec: 5000 },
  { label: '720p 30fps', h: 720, fps: 30, min: 2500, rec: 3500 },
  { label: '540p 30fps', h: 540, fps: 30, min: 1500, rec: 2000 },
  { label: '360p 30fps', h: 360, fps: 30, min: 500, rec: 1000 },
];
const HEADROOM = 0.7; // ใช้อัปโหลดไม่เกิน 70% เผื่อเน็ตแกว่ง

const store = {
  get(k, d) { try { const v = localStorage.getItem('studio.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('studio.' + k, JSON.stringify(v)); } catch {} },
};

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3500);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- ปลายทาง ----------
let dests = store.get('dests', [{ platform: 'youtube', url: PLATFORMS.youtube.url, key: '', on: true }]);
$('rememberKeys').checked = store.get('remember', false);

for (const [id, p] of Object.entries(PLATFORMS)) $('addPlatform').add(new Option(p.name, id));

function saveDests() {
  const remember = $('rememberKeys').checked;
  store.set('remember', remember);
  store.set('dests', dests.map((d) => ({ ...d, key: remember ? d.key : '' })));
}

function renderDests() {
  const list = $('destList');
  list.innerHTML = '';
  dests.forEach((d, i) => {
    const p = PLATFORMS[d.platform] || PLATFORMS.custom;
    const el = document.createElement('div');
    el.className = 'dest' + (d.on ? '' : ' off');
    el.innerHTML = `
      <div class="dest-head">
        <input type="checkbox" ${d.on ? 'checked' : ''} aria-label="เปิดใช้" style="width:auto">
        <b>${esc(p.name)}</b>
        <span class="muted small">≤ ${p.max} kbps</span>
        <button class="icon-btn" title="ลบ" aria-label="ลบ">✕</button>
      </div>
      <input class="u" placeholder="Server URL (rtmp:// หรือ rtmps://)" value="${esc(d.url)}" autocomplete="off" spellcheck="false">
      <input class="k" type="password" placeholder="Stream Key" value="${esc(d.key)}" autocomplete="off" spellcheck="false">
      <div class="help">${esc(p.help)}</div>`;
    const [on, del] = [el.querySelector('input[type=checkbox]'), el.querySelector('.icon-btn')];
    on.onchange = () => { d.on = on.checked; saveDests(); renderDests(); calc(); };
    del.onclick = () => { dests.splice(i, 1); saveDests(); renderDests(); calc(); };
    el.querySelector('.u').oninput = (e) => { d.url = e.target.value.trim(); saveDests(); };
    el.querySelector('.k').oninput = (e) => { d.key = e.target.value.trim(); saveDests(); };
    list.append(el);
  });
  if (!dests.length) list.innerHTML = '<p class="muted small">ยังไม่มีปลายทาง — เลือกแพลตฟอร์มแล้วกด “+ เพิ่ม”</p>';
}

$('btnAdd').onclick = () => {
  const id = $('addPlatform').value;
  dests.push({ platform: id, url: PLATFORMS[id].url, key: '', on: true });
  saveDests();
  renderDests();
  calc();
};
$('rememberKeys').onchange = saveDests;

// ---------- คำนวณบิตเรต ----------
let plan = null; // ค่าที่จะใช้ไลฟ์จริง

function dims(h, vertical) {
  const w = Math.round((h * 16) / 9 / 2) * 2;
  return vertical ? { width: h, height: w } : { width: w, height: h };
}

function calc() {
  const upMbps = parseFloat($('upload').value) || 0;
  const active = dests.filter((d) => d.on);
  const n = Math.max(1, active.length);
  const audio = +$('akbps').value;
  const cap = Math.min(...active.map((d) => (PLATFORMS[d.platform] || PLATFORMS.custom).max), 20000);
  const perDest = Math.floor((upMbps * 1000 * HEADROOM) / n) - audio; // tee ส่งสำเนาแยกให้ทุกปลายทาง → อัปโหลดคูณจำนวนปลายทาง
  const vertical = $('orient').value === 'v';
  const notes = [];

  if ($('manual').checked) {
    const t = { h: +$('res').value, fps: +$('fps').value };
    plan = { ...dims(t.h, vertical), fps: t.fps, videoKbps: +$('vkbps').value, audioKbps: audio, label: `${t.h}p ${t.fps}fps (ตั้งเอง)` };
    if (plan.videoKbps > cap) notes.push(`บิตเรตสูงกว่าที่แพลตฟอร์มแนะนำ (${cap} kbps) อาจถูกปฏิเสธหรือกระตุก`);
  } else {
    const budget = Math.min(perDest, cap);
    const tier = TIERS.find((t) => budget >= t.min) || TIERS[TIERS.length - 1];
    const kbps = Math.max(300, Math.floor(Math.min(tier.rec, budget) / 100) * 100);
    plan = { ...dims(tier.h, vertical), fps: tier.fps, videoKbps: kbps, audioKbps: audio, label: tier.label };
    if (budget < TIERS[TIERS.length - 1].min) notes.push('อัปโหลดไม่พอสำหรับจำนวนปลายทางนี้ — ลดปลายทาง หรือใช้เน็ตที่แรงขึ้น');
  }

  const totalMbps = ((plan.videoKbps + plan.audioKbps) * n) / 1000;
  const pct = upMbps ? Math.round((totalMbps / upMbps) * 100) : 100;
  if (pct > 80) notes.push('ใช้อัปโหลดเกิน 80% — เสี่ยงกระตุกเมื่อเน็ตแกว่ง');
  const wrongOrient = active.filter((d) => { const o = (PLATFORMS[d.platform] || {}).orient; return o && o !== (vertical ? 'v' : 'h'); }).map((d) => PLATFORMS[d.platform].name);
  if (wrongOrient.length && active.length) notes.push(`${wrongOrient.join(', ')} เหมาะกับภาพ${vertical ? 'แนวนอน' : 'แนวตั้ง'} — ภาพจะมีขอบดำ`);
  if (plan.fps === 60 && ($('encoder').value || '').startsWith('libx264')) notes.push('60fps ด้วยซีพียูกินเครื่องหนัก แนะนำใช้การ์ดจอ');

  $('calc').innerHTML = `
    <div class="muted small">แนะนำ</div>
    <div class="big-num">${plan.label} · ${plan.videoKbps.toLocaleString()} kbps</div>
    <div class="muted small">${plan.width}×${plan.height} · เสียง ${plan.audioKbps} kbps · ${active.length || 0} ปลายทาง</div>
    <div class="bar ${pct > 80 ? 'bad' : pct > 70 ? 'warn' : ''}"><div style="width:${Math.min(100, pct)}%"></div></div>
    <div class="small">ใช้อัปโหลดรวม <b>${totalMbps.toFixed(1)} Mbps</b> จาก ${upMbps || '?'} Mbps (${pct}%)</div>
    ${notes.length ? `<ul class="small">${notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;

  resizeCanvas(plan.width, plan.height);
  store.set('quality', { upload: $('upload').value, orient: $('orient').value, manual: $('manual').checked, res: $('res').value, fps: $('fps').value, vkbps: $('vkbps').value, akbps: $('akbps').value, encoder: $('encoder').value });
}

const q = store.get('quality', {});
for (const k of ['upload', 'orient', 'res', 'fps', 'vkbps', 'akbps']) if (q[k]) $(k).value = q[k];
$('manual').checked = !!q.manual;
$('manualBox').hidden = !$('manual').checked;
for (const id of ['upload', 'orient', 'res', 'fps', 'vkbps', 'akbps', 'encoder']) $(id).addEventListener('input', calc);
$('manual').onchange = () => { $('manualBox').hidden = !$('manual').checked; calc(); };

$('btnSpeed').onclick = async () => {
  const b = $('btnSpeed');
  b.disabled = true;
  b.textContent = 'กำลังวัด…';
  try {
    if (!H) throw new Error('ต้องติดตั้ง Yoddoy Helper ก่อน หรือใส่ความเร็วเอง');
    const r = await fetch(H.base + '/api/speedtest', { method: 'POST' }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    $('upload').value = r.uploadMbps;
    toast(`อัปโหลด ${r.uploadMbps} Mbps`);
    calc();
  } catch (e) {
    toast(e.message || 'ทดสอบไม่สำเร็จ');
  }
  b.disabled = false;
  b.textContent = 'ทดสอบ';
};

let H = null; // Yoddoy Helper บนเครื่องนี้ { base, ws, version }

function loadEncoders() {
  fetch(H.base + '/api/encoders').then((r) => r.json()).then((r) => {
    const sel = $('encoder');
    sel.innerHTML = '';
    if (!r.ffmpeg || !r.encoders.length) sel.add(new Option('ไม่พบ FFmpeg', ''));
    r.encoders.forEach((e) => sel.add(new Option(e.label, e.id)));
    if (q.encoder && r.encoders.some((e) => e.id === q.encoder)) sel.value = q.encoder;
    calc();
  }).catch(() => toast('ติดต่อ Yoddoy Helper ไม่ได้'));
}

function showHelperMissing() {
  $('helperCard').hidden = false;
  $('helperDownload').href = window.HELPER_DOWNLOAD;
  $('helperMobile').hidden = !window.IS_MOBILE;
  $('helperDesktop').hidden = window.IS_MOBILE;
  const sel = $('encoder');
  sel.innerHTML = '';
  sel.add(new Option('ต้องมี Yoddoy Helper', ''));
  $('conn').textContent = 'ไม่พบ Helper';
}

// ---------- ผสมภาพบน canvas (เลเยอร์ลาก/ย่อขยายได้) ----------
const canvas = $('canvas');
const ctx2d = canvas.getContext('2d');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const fx = new CameraFX();

// ตำแหน่งเลเยอร์เก็บเป็นสัดส่วนของ canvas (0–1) → เปลี่ยนความละเอียด/แนวภาพแล้วไม่เพี้ยน
// pa = อัตราส่วนกว้าง/สูงของกรอบเป็นพิกเซล, h คำนวณจาก w และ pa เสมอ
const layers = []; // ลำดับวาด ล่าง → บน
let selected = null;

function newLayer(kind) {
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  return { kind, name: kind === 'screen' ? 'จอ iPhone / หน้าต่าง' : 'กล้อง', video, stream: null, visible: true,
    x: 0, y: 0, w: 1, pa: 16 / 9, preset: 'full', crop: { t: 0, b: 0, l: 0, r: 0 }, shape: 'round' };
}
const layerH = (l) => (l.w * canvas.width) / l.pa / canvas.height;
const getLayer = (kind) => layers.find((l) => l.kind === kind);

// อัตราส่วนของเนื้อหาจริง (หลังตัดขอบ)
function contentAspect(l) {
  const v = l.video;
  if (!v.videoWidth) return 16 / 9;
  if (l.kind === 'cam') return l.shape === 'circle' ? 1 : v.videoWidth / v.videoHeight;
  const c = l.crop;
  return Math.max(1, v.videoWidth - c.l - c.r) / Math.max(1, v.videoHeight - c.t - c.b);
}

function applyPreset(l, pos) {
  const W = canvas.width;
  const H = canvas.height;
  const ca = pos === 'full' && l.kind === 'cam' ? W / H : contentAspect(l);
  const m = 0.03;
  l.pa = ca;
  const fitBox = (bw, bh) => { // ใส่อัตราส่วน ca ลงในกรอบ bw×bh (สัดส่วน canvas)
    const wByH = (bh * H * ca) / W;
    return Math.min(bw, wByH);
  };
  if (pos === 'full' || pos === 'center') {
    l.w = fitBox(pos === 'full' ? 1 : 0.6, pos === 'full' ? 1 : 0.6);
    l.x = (1 - l.w) / 2;
    l.y = (1 - layerH(l)) / 2;
  } else if (pos === 'left' || pos === 'right') {
    l.w = fitBox(0.5, 1);
    l.x = pos === 'left' ? (0.5 - l.w) / 2 : 0.5 + (0.5 - l.w) / 2;
    l.y = (1 - layerH(l)) / 2;
  } else {
    const side = Math.min(W, H) * 0.34; // ขนาดมุมจอ ~34% ของด้านสั้น
    l.w = Math.min(side * Math.max(1, ca), side * 1.4) / W;
    const h = layerH(l);
    const bannerGap = bannerText() && pos.startsWith('b') ? 0.09 : 0;
    l.x = pos.endsWith('l') ? m : 1 - l.w - m * (H / W > 1 ? 1 : H / W);
    l.y = pos.startsWith('t') ? m : 1 - h - m - bannerGap;
  }
  l.preset = pos;
  saveLayout();
}

function drawLayer(l) {
  const v = l.video;
  if (!l.visible || !v.videoWidth) return;
  const W = canvas.width;
  const H = canvas.height;
  const x = l.x * W;
  const y = l.y * H;
  const w = l.w * W;
  const h = layerH(l) * H;
  if (l.kind === 'screen') {
    const c = l.crop;
    const sw = v.videoWidth - c.l - c.r;
    const sh = v.videoHeight - c.t - c.b;
    if (sw > 0 && sh > 0) ctx2d.drawImage(v, c.l, c.t, sw, sh, x, y, w, h);
    return;
  }
  // กล้อง: ผ่านฟิลเตอร์ WebGL แล้วครอปแบบ cover ให้เต็มกรอบ
  const src = ($('fxCompare').checked ? null : fx.process(v)) || v;
  const sw = src.width || v.videoWidth;
  const sh = src.height || v.videoHeight;
  const s = Math.max(w / sw, h / sh);
  const cw = w / s;
  const ch = h / s;
  ctx2d.save();
  ctx2d.beginPath();
  if (l.shape === 'circle') ctx2d.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx2d.roundRect(x, y, w, h, l.shape === 'round' ? Math.min(w, h) * 0.06 : 0);
  ctx2d.clip();
  if (src === v && fx.params.mirror) { // ภาพก่อนปรับ/ไม่มี WebGL: กลับด้านเอง
    ctx2d.translate(x * 2 + w, 0);
    ctx2d.scale(-1, 1);
  }
  ctx2d.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
  ctx2d.restore();
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;
  ctx2d.fillStyle = '#000';
  ctx2d.fillRect(0, 0, W, H);
  layers.forEach(drawLayer);

  const text = bannerText();
  if (text) {
    const bh = Math.round(H * 0.08);
    ctx2d.fillStyle = 'rgba(0,0,0,.65)';
    ctx2d.fillRect(0, H - bh, W, bh);
    ctx2d.fillStyle = '#fff';
    ctx2d.font = `600 ${Math.round(bh * 0.45)}px "Noto Sans Thai", "Sarabun", system-ui, sans-serif`;
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(text, Math.round(W * 0.03), H - bh / 2, W * 0.94);
  }
  $('stageHint').hidden = layers.some((l) => l.stream);
  drawOverlay();
}
const bannerText = () => $('banner').value.trim();

function resizeCanvas(w, h) {
  if (canvas.width === w && canvas.height === h) return;
  if (recorder) return; // ห้ามเปลี่ยนขนาดระหว่างไลฟ์
  canvas.width = w;
  canvas.height = h;
  for (const l of layers) {
    if (l.preset) applyPreset(l, l.preset);
    else clampLayer(l);
  }
}

// ---------- กรอบเลือก + ลาก/ย่อขยายบนพรีวิว ----------
const HANDLE = 14; // ขนาดจุดจับ (พิกเซลบนจอ)
function drawOverlay() {
  const r = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (overlay.width !== Math.round(r.width * dpr) || overlay.height !== Math.round(r.height * dpr)) {
    overlay.width = Math.round(r.width * dpr);
    overlay.height = Math.round(r.height * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, r.width, r.height);
  if (!selected || !selected.stream || !selected.visible) return; // กรอบอยู่บน overlay เท่านั้น ไม่ติดไปในไลฟ์
  const x = selected.x * r.width;
  const y = selected.y * r.height;
  const w = selected.w * r.width;
  const h = layerH(selected) * r.height;
  octx.strokeStyle = '#4f8cff';
  octx.lineWidth = 2;
  octx.setLineDash([6, 4]);
  octx.strokeRect(x, y, w, h);
  octx.setLineDash([]);
  octx.fillStyle = '#4f8cff';
  octx.fillRect(x + w - HANDLE / 2, y + h - HANDLE / 2, HANDLE, HANDLE);
  for (const g of guides) {
    octx.strokeStyle = 'rgba(255,80,160,.9)';
    octx.beginPath();
    if (g.x != null) { octx.moveTo(g.x * r.width, 0); octx.lineTo(g.x * r.width, r.height); }
    else { octx.moveTo(0, g.y * r.height); octx.lineTo(r.width, g.y * r.height); }
    octx.stroke();
  }
}

function clampLayer(l) {
  const h = layerH(l);
  l.w = Math.min(Math.max(l.w, 0.05), 3);
  l.x = Math.min(Math.max(l.x, -l.w * 0.8), 1 - l.w * 0.2);
  l.y = Math.min(Math.max(l.y, -h * 0.8), 1 - h * 0.2);
}

let guides = [];
const SNAP = 0.015;
function snap(l) { // ดูดติดขอบและกึ่งกลาง
  guides = [];
  const h = layerH(l);
  const tryAxis = (pos, size, axis) => {
    for (const [target, line] of [[0, 0], [1 - size, 1], [(1 - size) / 2, 0.5]]) {
      if (Math.abs(pos - target) < SNAP) {
        guides.push(axis === 'x' ? { x: line } : { y: line });
        return target;
      }
    }
    return pos;
  };
  l.x = tryAxis(l.x, l.w, 'x');
  l.y = tryAxis(l.y, h, 'y');
}

let drag = null;
function pointerPos(e) {
  const r = overlay.getBoundingClientRect();
  return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, r };
}
function hitTest(fx, fy) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.stream && l.visible && fx >= l.x && fx <= l.x + l.w && fy >= l.y && fy <= l.y + layerH(l)) return l;
  }
  return null;
}
function onHandle(l, p) {
  if (!l) return false;
  const hx = (l.x + l.w) * p.r.width;
  const hy = (l.y + layerH(l)) * p.r.height;
  return Math.abs(p.fx * p.r.width - hx) <= HANDLE && Math.abs(p.fy * p.r.height - hy) <= HANDLE;
}

overlay.addEventListener('pointerdown', (e) => {
  const p = pointerPos(e);
  const resize = onHandle(selected, p);
  const target = resize ? selected : hitTest(p.fx, p.fy);
  if (!target) return;
  select(target);
  overlay.setPointerCapture(e.pointerId);
  drag = { mode: resize ? 'resize' : 'move', start: p, x: target.x, y: target.y, w: target.w };
});
overlay.addEventListener('pointermove', (e) => {
  const p = pointerPos(e);
  if (!drag) {
    overlay.style.cursor = onHandle(selected, p) ? 'nwse-resize' : hitTest(p.fx, p.fy) ? 'move' : 'default';
    return;
  }
  const l = selected;
  const dx = p.fx - drag.start.fx;
  const dy = p.fy - drag.start.fy;
  if (drag.mode === 'move') {
    l.x = drag.x + dx;
    l.y = drag.y + dy;
    snap(l);
  } else {
    // ย่อขยายจากมุมขวาล่าง คงอัตราส่วนเดิม ใช้แกนที่ลากมากกว่า
    const byW = drag.w + dx;
    const byH = ((layerH({ ...l, w: drag.w }) + dy) * canvas.height * l.pa) / canvas.width;
    l.w = Math.max(0.05, Math.abs(dx) > Math.abs(dy) ? byW : byH);
    guides = [];
  }
  l.preset = null;
  clampLayer(l);
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  guides = [];
  saveLayout();
};
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('dblclick', (e) => {
  const p = pointerPos(e);
  const l = hitTest(p.fx, p.fy);
  if (!l) return;
  select(l);
  applyPreset(l, l.preset === 'full' ? (l.kind === 'cam' ? 'br' : 'center') : 'full');
});

// ---------- แผงควบคุมเลเยอร์ ----------
function select(l) {
  selected = l;
  renderLayerPanel();
}

function renderLayerPanel() {
  const active = layers.filter((l) => l.stream);
  $('layerPanel').hidden = !active.length;
  if (!active.includes(selected)) selected = active[active.length - 1] || null;
  $('layerTabs').innerHTML = '';
  for (const l of [...active].reverse()) {
    const b = document.createElement('button');
    b.textContent = l.name;
    b.className = (l === selected ? 'active ' : '') + (l.visible ? '' : 'hidden-layer');
    b.onclick = () => select(l);
    $('layerTabs').append(b);
  }
  if (!selected) return;
  $('cropBox').hidden = selected.kind !== 'screen';
  $('shapeBox').hidden = selected.kind !== 'cam';
  $('lyHide').textContent = selected.visible ? 'ซ่อน' : 'แสดง';
  $('cropTop').value = selected.crop.t;
  $('cropTopLabel').textContent = selected.crop.t + ' px';
  document.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('primary', b.dataset.shape === selected.shape));
}

document.querySelectorAll('[data-pos]').forEach((b) => (b.onclick = () => selected && applyPreset(selected, b.dataset.pos)));
document.querySelectorAll('[data-shape]').forEach((b) => (b.onclick = () => {
  if (!selected) return;
  selected.shape = b.dataset.shape;
  const keepW = selected.w;
  selected.pa = selected.shape === 'circle' ? 1 : selected.preset === 'full' ? canvas.width / canvas.height : contentAspect(selected);
  selected.w = keepW;
  clampLayer(selected);
  renderLayerPanel();
  saveLayout();
}));
$('lyFront').onclick = () => { if (!selected) return; layers.splice(layers.indexOf(selected), 1); layers.push(selected); renderLayerPanel(); saveLayout(); };
$('lyBack').onclick = () => { if (!selected) return; layers.splice(layers.indexOf(selected), 1); layers.unshift(selected); renderLayerPanel(); saveLayout(); };
$('lyHide').onclick = () => { if (!selected) return; selected.visible = !selected.visible; renderLayerPanel(); };
$('lyRemove').onclick = () => selected && removeSource(selected.kind);

// ---------- ตัดหัวหน้าต่าง / ขอบดำ ----------
function setCrop(l, crop) {
  const cx = l.x + l.w / 2;
  const cy = l.y + layerH(l) / 2;
  const areaOld = l.w * layerH(l);
  l.crop = crop;
  if (l.preset) return applyPreset(l, l.preset);
  // คงจุดกึ่งกลางและพื้นที่ใกล้เคียงเดิม
  l.pa = contentAspect(l);
  l.w = Math.sqrt((areaOld * l.pa * canvas.height) / canvas.width);
  l.x = cx - l.w / 2;
  l.y = cy - layerH(l) / 2;
  clampLayer(l);
  saveLayout();
}

// ความสูงแถบชื่อหน้าต่างบน Windows ≈ 31px × สเกลจอ
const titleBarPx = () => Math.round(31 * (window.devicePixelRatio || 1));

// สแกนภาพหาเนื้อหาจริง: ตัดขอบดำรอบภาพ (เช่นขอบดำข้างจอ iPhone แนวตั้ง)
function autoCrop(l) {
  const v = l.video;
  if (!v.videoWidth) return;
  const top = l.kind === 'screen' && l.surface === 'window' ? titleBarPx() : 0;
  const sw = 320;
  const scale = sw / v.videoWidth;
  const srcH = v.videoHeight - top;
  const sh = Math.max(1, Math.round(srcH * scale));
  const c = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, top, v.videoWidth, srcH, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const rowHas = (y) => { for (let x = 0; x < sw; x += 2) if (lum((y * sw + x) * 4) > 24) return true; return false; };
  const colHas = (x) => { for (let y = 0; y < sh; y += 2) if (lum((y * sw + x) * 4) > 24) return true; return false; };
  let t = 0, b = sh - 1, L = 0, R = sw - 1;
  while (t < b && !rowHas(t)) t++;
  while (b > t && !rowHas(b)) b--;
  while (L < R && !colHas(L)) L++;
  while (R > L && !colHas(R)) R--;
  if (b - t < 10 || R - L < 10) return setCrop(l, { t: top, b: 0, l: 0, r: 0 }); // ภาพมืดทั้งจอ → ตัดแค่หัวหน้าต่าง
  const inv = 1 / scale;
  setCrop(l, {
    t: top + Math.round(t * inv),
    b: Math.round((sh - 1 - b) * inv),
    l: Math.round(L * inv),
    r: Math.round((sw - 1 - R) * inv),
  });
  renderLayerPanel();
}

$('cropTop').oninput = () => {
  if (!selected) return;
  setCrop(selected, { ...selected.crop, t: +$('cropTop').value });
  $('cropTopLabel').textContent = selected.crop.t + ' px';
};
$('cropAuto').onclick = () => selected && autoCrop(selected);
$('cropReset').onclick = () => { if (selected) { setCrop(selected, { t: 0, b: 0, l: 0, r: 0 }); renderLayerPanel(); } };

// ---------- จำการจัดวาง ----------
function saveLayout() {
  store.set('layout', layers.map((l) => ({ kind: l.kind, x: l.x, y: l.y, w: l.w, pa: l.pa, preset: l.preset, shape: l.shape })));
}
const savedLayout = store.get('layout', []);
function restoreLayout(l) {
  const s = savedLayout.find((x) => x.kind === l.kind);
  if (!s) return false;
  Object.assign(l, { x: s.x, y: s.y, w: s.w, pa: s.pa, preset: s.preset, shape: s.shape || l.shape });
  if (l.preset) applyPreset(l, l.preset);
  return true;
}

// ใช้ timer ใน Worker เพื่อให้วาดต่อได้แม้สลับไปแท็บอื่น (timer หลักของหน้าจะถูกหน่วงตอนแท็บไม่ได้แสดง)
const ticker = new Worker(URL.createObjectURL(new Blob([
  'let t; onmessage = (e) => { clearInterval(t); t = setInterval(() => postMessage(0), 1000 / e.data); };',
], { type: 'text/javascript' })));
ticker.onmessage = draw;
ticker.postMessage(30);

// ---------- แหล่งภาพ ----------
function addSource(kind, stream) {
  let l = getLayer(kind);
  if (!l) {
    l = newLayer(kind);
    if (kind === 'cam') layers.push(l); // กล้องอยู่บนภาพจอ
    else layers.unshift(l);
  } else if (l.stream && l.stream !== stream && kind === 'screen') {
    l.stream.getTracks().forEach((t) => t.stop());
  }
  l.stream = stream;
  l.visible = true;
  l.video.srcObject = stream;
  l.video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  l.surface = (track.getSettings && track.getSettings().displaySurface) || '';
  l.video.onloadedmetadata = () => {
    const hasOther = layers.some((o) => o !== l && o.stream);
    if (!restoreLayout(l)) applyPreset(l, kind === 'cam' && hasOther ? 'br' : 'full');
    if (kind === 'screen') setTimeout(() => autoCrop(l), 700); // ตัดหัวหน้าต่าง + ขอบดำให้อัตโนมัติ
    renderLayerPanel();
  };
  if (kind === 'screen') connectScreenAudio(stream);
  select(l);
}

function removeSource(kind) {
  const l = getLayer(kind);
  if (!l || !l.stream) return;
  l.stream.getTracks().forEach((t) => t.stop());
  l.stream = null;
  l.video.srcObject = null;
  if (kind === 'screen') connectScreenAudio(null);
  if (kind === 'cam') $('srcCam').textContent = '🎥 เปิดกล้อง';
  renderLayerPanel();
}

// เบราว์เซอร์ในแอป (เช่นหน้าต่างเบราว์เซอร์ของ Claude) บล็อกการจับภาพ → บอกให้เปิดใน Chrome/Edge
const embedded = /\bClaude\/|Electron\//.test(navigator.userAgent) || !navigator.mediaDevices?.getDisplayMedia;
function warnBrowser() {
  $('browserWarn').hidden = false;
}
if (embedded) warnBrowser();
$('btnCopyUrl').onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('คัดลอกลิงก์แล้ว — วางใน Chrome หรือ Edge');
  } catch {
    prompt('คัดลอกลิงก์นี้ไปเปิดใน Chrome หรือ Edge:', location.href);
  }
};

$('srcScreen').onclick = async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) return warnBrowser();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60, displaySurface: 'window' }, audio: true });
    s.getVideoTracks()[0].onended = () => getLayer('screen')?.stream === s && removeSource('screen');
    addSource('screen', s);
  } catch (e) {
    if (embedded || e.name === 'NotSupportedError') warnBrowser();
    toast(e.name === 'NotAllowedError' && !embedded ? 'ยกเลิกการเลือกจอ' : 'จับภาพจอไม่ได้ในเบราว์เซอร์นี้ — เปิดใน Chrome หรือ Edge');
  }
};

$('srcCam').onclick = async () => {
  if (getLayer('cam')?.stream) return removeSource('cam');
  await startCam();
};

async function startCam() {
  try {
    const id = $('camSelect').value;
    const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id && id !== 'default' ? { exact: id } : undefined, width: 1920, height: 1080, frameRate: 30 } });
    const old = getLayer('cam')?.stream;
    if (old) old.getTracks().forEach((t) => t.stop());
    addSource('cam', s);
    $('srcCam').textContent = '🎥 ปิดกล้อง';
    listDevices();
    return true;
  } catch {
    if (embedded) warnBrowser();
    toast('เปิดกล้องไม่ได้');
    return false;
  }
}
$('camSelect').onchange = () => { if (getLayer('cam')?.stream) startCam(); };

// ---------- ฟิลเตอร์กล้อง ----------
const FX_KEYS = ['smooth', 'glow', 'bright', 'contrast', 'sat', 'warm'];
const FX_SCALE = { smooth: 100, glow: 100, bright: 100, contrast: 100, sat: 100, warm: 100 };
Object.assign(fx.params, store.get('fx', {}));
let fxPreset = store.get('fxPreset', 'normal');

function syncFxUi() {
  for (const k of FX_KEYS) {
    const input = document.querySelector(`[data-fx="${k}"]`);
    input.value = Math.round(fx.params[k] * FX_SCALE[k]);
    document.querySelector(`[data-out="${k}"]`).textContent = input.value;
  }
  $('fxMirror').checked = fx.params.mirror;
  $('fxPresets').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === fxPreset));
}
function saveFx() {
  store.set('fx', fx.params);
  store.set('fxPreset', fxPreset);
}
for (const [id, p] of Object.entries(FX_PRESETS)) {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.dataset.id = id;
  b.onclick = () => {
    const { name, ...vals } = p;
    Object.assign(fx.params, vals);
    fxPreset = id;
    syncFxUi();
    saveFx();
  };
  $('fxPresets').append(b);
}
document.querySelectorAll('[data-fx]').forEach((input) => {
  input.oninput = () => {
    const k = input.dataset.fx;
    fx.params[k] = input.value / FX_SCALE[k];
    document.querySelector(`[data-out="${k}"]`).textContent = input.value;
    if (!['smooth', 'glow'].includes(k)) fxPreset = '';
    syncFxUi();
    saveFx();
  };
});
$('fxMirror').onchange = () => { fx.params.mirror = $('fxMirror').checked; saveFx(); };
$('fxReset').onclick = () => {
  Object.assign(fx.params, { smooth: 0.4, glow: 0.2, mirror: true }, (({ name, ...v }) => v)(FX_PRESETS.normal));
  fxPreset = 'normal';
  syncFxUi();
  saveFx();
};
if (!fx.gl) toast('เบราว์เซอร์นี้ไม่รองรับ WebGL — ฟิลเตอร์กล้องใช้ไม่ได้');
syncFxUi();

// ---------- เสียง ----------
const actx = new AudioContext();
const mixOut = actx.createMediaStreamDestination(); // มีแทร็กเสียงเสมอ (เงียบถ้าไม่มีแหล่ง) เพราะแพลตฟอร์มส่วนใหญ่ต้องการเสียง
const micGain = actx.createGain();
const analyser = actx.createAnalyser();
analyser.fftSize = 512;
micGain.connect(mixOut);
micGain.connect(analyser);
let micSrc = null;
let micStream = null;
let screenSrc = null;

function connectScreenAudio(stream) {
  if (screenSrc) screenSrc.disconnect();
  screenSrc = null;
  if (stream && stream.getAudioTracks().length) {
    screenSrc = actx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    screenSrc.connect(mixOut);
    screenSrc.connect(analyser);
  }
}

$('micSelect').onchange = async () => {
  if (micSrc) micSrc.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micSrc = micStream = null;
  const id = $('micSelect').value;
  if (!id) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id === 'default' ? undefined : { exact: id }, echoCancellation: true, noiseSuppression: true } });
    micSrc = actx.createMediaStreamSource(micStream);
    micSrc.connect(micGain);
    actx.resume();
    listDevices();
  } catch {
    toast('เปิดไมค์ไม่ได้');
  }
};
$('micVol').oninput = () => {
  micGain.gain.value = $('micVol').value / 100;
  $('micVolLabel').textContent = $('micVol').value + '%';
};

const meterData = new Uint8Array(analyser.fftSize);
(function meter() {
  analyser.getByteTimeDomainData(meterData);
  let peak = 0;
  for (const v of meterData) peak = Math.max(peak, Math.abs(v - 128));
  $('meterBar').style.width = Math.min(100, (peak / 128) * 140) + '%';
  requestAnimationFrame(meter);
})();

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, first) => {
    const cur = sel.value;
    sel.innerHTML = '';
    sel.add(new Option(first[0], first[1]));
    devs.filter((d) => d.kind === kind).forEach((d, i) => sel.add(new Option(d.label || `${kind === 'audioinput' ? 'ไมค์' : 'กล้อง'} ${i + 1}`, d.deviceId || 'default')));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : sel.options[0].value;
  };
  fill($('micSelect'), 'audioinput', ['ไม่ใช้ไมค์', '']);
  fill($('camSelect'), 'videoinput', ['ค่าเริ่มต้น', '']);
  if (![...$('micSelect').options].some((o) => o.value === 'default')) $('micSelect').add(new Option('ไมค์ค่าเริ่มต้น', 'default'), 1);
}
listDevices();

// ---------- ส่งสตรีม ----------
let ws;
let recorder = null;
let liveStart = 0;
let clock = null;
let slowSince = 0;

function connect() {
  ws = new WebSocket(H.ws + '/studio');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { $('conn').textContent = 'พร้อมไลฟ์'; $('conn').classList.add('on'); };
  ws.onclose = () => {
    $('conn').textContent = 'ไม่ได้เชื่อมต่อ';
    $('conn').classList.remove('on');
    if (recorder) stopRecorder('การเชื่อมต่อกับเซิร์ฟเวอร์หลุด');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}

function handle(m) {
  switch (m.type) {
    case 'started':
      toast('เริ่มไลฟ์แล้ว');
      renderChips(m.dests);
      break;
    case 'stats': {
      $('stFps').textContent = Math.round(m.fps);
      // tee muxer มักไม่รายงานบิตเรต (N/A) → แสดงค่าที่ตั้งไว้แทน
      $('stKbps').textContent = m.kbps ? Math.round(m.kbps).toLocaleString() : '≈' + plan.videoKbps.toLocaleString();
      $('stSpeed').textContent = m.speed.toFixed(2) + 'x';
      $('stDrop').textContent = m.drop;
      renderChips(m.dests);
      advise(m);
      break;
    }
    case 'log':
      appendLog(m.line);
      if (/overflow|dropping/i.test(m.line)) showAdvice('ปลายทางบางช่องรับข้อมูลไม่ทัน (เน็ตอัปโหลดไม่พอ) — ลดบิตเรตหรือจำนวนปลายทาง');
      break;
    case 'error':
      toast(m.message);
      stopRecorder();
      break;
    case 'stopped':
      stopRecorder(m.reason);
      break;
  }
}

function appendLog(line) {
  const log = $('log');
  log.textContent += new Date().toLocaleTimeString('th-TH') + '  ' + line + '\n';
  if (log.textContent.length > 20000) log.textContent = log.textContent.slice(-15000);
  log.scrollTop = log.scrollHeight;
}

function renderChips(list) {
  const label = { connecting: 'กำลังเชื่อมต่อ', live: 'ออนไลน์', error: 'ต่อไม่ได้ · กำลังลองใหม่', failed: 'หลุด' };
  $('destStatus').innerHTML = list.map((d) => `<span class="chip ${d.state}">${esc(d.name)} · ${label[d.state] || d.state}</span>`).join('');
}

function showAdvice(text) {
  $('advice').textContent = text;
  $('advice').hidden = !text;
}

function advise(m) {
  if (!plan || Date.now() - liveStart < 5000) return;
  if (m.speed && m.speed < 0.95) {
    slowSince = slowSince || Date.now();
    if (Date.now() - slowSince > 4000) return showAdvice('เครื่องเข้ารหัสไม่ทัน (ความเร็ว < 1.0x) — เปลี่ยนเป็นตัวเข้ารหัสการ์ดจอ หรือลดความละเอียด/fps');
  } else slowSince = 0;
  if (m.fps && m.fps < plan.fps * 0.85) return showAdvice('ภาพเข้ามาไม่ถึงเฟรมเรตที่ตั้ง — อย่าย่อหน้าต่างเบราว์เซอร์นี้ หรือลด fps');
  if (ws.bufferedAmount > 8e6) return showAdvice('ข้อมูลค้างระหว่างเบราว์เซอร์กับเซิร์ฟเวอร์ — ลดบิตเรต');
  showAdvice('');
}

$('btnLive').onclick = () => (recorder ? stopLive() : startLive());

function pickMime() {
  const opts = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((t) => MediaRecorder.isTypeSupported(t));
}

async function startLive() {
  calc();
  const active = dests.filter((d) => d.on);
  if (!active.length) return toast('เพิ่มปลายทางอย่างน้อย 1 ช่อง');
  const missing = active.find((d) => !d.url || !d.key);
  if (missing) return toast(`${PLATFORMS[missing.platform].name}: ใส่ Server URL และ Stream Key ให้ครบ`);
  if (!H) {
    showHelperMissing();
    $('helperCard').scrollIntoView({ behavior: 'smooth' });
    return toast('ต้องติดตั้งและเปิด Yoddoy Helper บนเครื่องนี้ก่อนไลฟ์');
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return toast('ยังไม่ได้เชื่อมต่อ Yoddoy Helper');
  await actx.resume();

  ticker.postMessage(plan.fps);
  const video = canvas.captureStream(plan.fps).getVideoTracks()[0];
  const stream = new MediaStream([video, mixOut.stream.getAudioTracks()[0]]);
  recorder = new MediaRecorder(stream, {
    mimeType: pickMime(),
    videoBitsPerSecond: Math.max(8e6, plan.videoKbps * 2500), // ส่งภายในเครื่องแบบคุณภาพสูง แล้วค่อยบีบที่ FFmpeg
    audioBitsPerSecond: 192000,
  });
  recorder.ondataavailable = async (e) => {
    if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(await e.data.arrayBuffer());
  };

  ws.send(JSON.stringify({
    type: 'start',
    width: plan.width, height: plan.height, fps: plan.fps,
    videoKbps: plan.videoKbps, audioKbps: plan.audioKbps,
    encoder: $('encoder').value,
    destinations: active.map((d) => ({ name: PLATFORMS[d.platform].name, url: d.url, key: d.key })),
  }));
  recorder.start(250);

  liveStart = Date.now();
  $('liveBadge').hidden = false;
  $('btnLive').textContent = 'หยุดไลฟ์';
  $('btnLive').classList.add('live');
  lockSettings(true);
  clock = setInterval(() => {
    const s = Math.floor((Date.now() - liveStart) / 1000);
    $('liveTime').textContent = [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
  }, 1000);
}

function stopLive() {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  stopRecorder('หยุดไลฟ์แล้ว');
}

function stopRecorder(reason) {
  if (!recorder) return;
  if (recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  clearInterval(clock);
  $('liveBadge').hidden = true;
  $('btnLive').textContent = 'เริ่มไลฟ์';
  $('btnLive').classList.remove('live');
  lockSettings(false);
  showAdvice('');
  if (reason) toast(reason);
  ticker.postMessage(30);
}

function lockSettings(on) {
  for (const id of ['orient', 'manual', 'res', 'fps', 'vkbps', 'akbps', 'encoder', 'upload', 'btnAdd', 'btnSpeed']) $(id).disabled = on;
  $('destList').querySelectorAll('input,button').forEach((el) => (el.disabled = on));
}

window.addEventListener('beforeunload', (e) => {
  if (recorder) e.preventDefault();
});

renderDests();
calc();
window.helper.then((h) => {
  H = h;
  if (!h) return showHelperMissing();
  connect();
  loadEncoders();
});
// ติดตั้ง Helper เสร็จแล้วกลับมาที่แท็บนี้ → ลองหาใหม่อัตโนมัติ
window.addEventListener('focus', async () => {
  if (H || window.IS_MOBILE) return;
  const h = await findHelper();
  if (h) location.reload();
});
