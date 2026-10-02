const $ = (id) => document.getElementById(id);

// ---------- แพลตฟอร์ม ----------
// max = บิตเรตวิดีโอสูงสุดที่แนะนำโดยประมาณ (kbps) · orient = แนวภาพที่แพลตฟอร์มนั้นเหมาะ (h แนวนอน / v แนวตั้ง)
const PLATFORMS = {
  youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', max: 9000, orient: 'h', help: 'YouTube Studio → สร้าง → ถ่ายทอดสด → คัดลอก “คีย์สตรีม” · แนะนำ: ปิด “หยุดอัตโนมัติ” ในการตั้งค่าสตรีม เพื่อไม่ให้แยกเป็นหลายคลิปเวลาเน็ตสะดุด' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', max: 9000, orient: 'h', help: 'Facebook → วิดีโอสด → ซอฟต์แวร์สตรีม → คัดลอก “คีย์สตรีม”' },
  tiktok: { name: 'TikTok', url: '', max: 6000, orient: 'v', help: 'TikTok LIVE Center → Stream key (บัญชีต้องได้สิทธิ์ไลฟ์ผ่านคอม) → คัดลอก Server URL และ Stream Key · ไม่มี Stream Key? ใช้ปุ่ม “เปิดจอสำหรับ LIVE Studio” แทน' },
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
  renderLatency();
  store.set('quality', { upload: $('upload').value, orient: $('orient').value, manual: $('manual').checked, res: $('res').value, fps: $('fps').value, vkbps: $('vkbps').value, akbps: $('akbps').value, encoder: $('encoder').value, latency: $('latency').value, delaySec: $('delaySec').value });
}

// ---------- ดีเลย์ ----------
// เวลาที่ส่งชิ้นวิดีโอจากเบราว์เซอร์ (ms) — ยิ่งสั้นยิ่งหน่วงน้อย
const RECORDER_SLICE = { low: 100, normal: 250, stable: 500 };
// ดีเลย์ของโปรแกรมเราโดยประมาณ (วินาที) — ไม่รวมดีเลย์ของแพลตฟอร์ม
const OUR_DELAY = { low: '≈ 0.5–1', normal: '≈ 1–2', stable: '≈ 2–3' };
const delaySec = () => Math.min(300, Math.max(0, Math.round(Number($('delaySec').value) || 0)));

function renderLatency() {
  const mode = $('latency').value;
  const extra = delaySec();
  $('delayLabel').textContent = extra ? `คนดูจะเห็นช้ากว่าจริง ${extra} วินาที` : '';
  const yt = { low: 'ความหน่วงต่ำพิเศษ (Ultra-low)', normal: 'ความหน่วงต่ำ (Low)', stable: 'ปกติ (Normal)' }[mode];
  $('latencyInfo').innerHTML = `
    <div>ดีเลย์จากโปรแกรมนี้ <b>${OUR_DELAY[mode]} วินาที</b>${extra ? ` + หน่วงเพิ่ม <b>${extra} วินาที</b>` : ''}</div>
    <div class="muted">ดีเลย์ส่วนใหญ่มาจากแพลตฟอร์ม — ตั้งใน YouTube Studio → การตั้งค่าสตรีม → <b>ความหน่วงของสตรีม: ${yt}</b>
    (ปกติ ≈ 15–30 วิ · ต่ำ ≈ 5–10 วิ · ต่ำพิเศษ ≈ 2–5 วิ) · Facebook/TikTok ≈ 3–10 วิ ตั้งค่าไม่ได้</div>
    ${extra ? '<div class="muted">หน่วงเพิ่มใช้กันคนดูไลฟ์แอบส่อง (เช่นเกม ROV) — ทุกแพลตฟอร์มหน่วงเท่ากัน</div>' : ''}`;
}

const q = store.get('quality', {});
for (const k of ['upload', 'orient', 'res', 'fps', 'vkbps', 'akbps', 'latency', 'delaySec']) if (q[k] != null && q[k] !== '') $(k).value = q[k];
$('manual').checked = !!q.manual;
$('manualBox').hidden = !$('manual').checked;
for (const id of ['upload', 'orient', 'res', 'fps', 'vkbps', 'akbps', 'encoder', 'latency', 'delaySec']) $(id).addEventListener('input', calc);
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

// ชนิดเลเยอร์: screen = จอ/หน้าต่าง (1 ชิ้น) · cam = กล้อง (1 ชิ้น) · image = รูป (หลายชิ้น) · web = URL/วิดเจ็ตที่จับภาพจากหน้าต่าง (หลายชิ้น)
const LAYER_NAMES = { screen: 'จอ iPhone / หน้าต่าง', cam: 'กล้อง', image: 'รูป', web: 'URL' };
function newLayer(kind, name) {
  const l = { kind, name: name || LAYER_NAMES[kind], stream: null, visible: true, opacity: 1,
    x: 0, y: 0, w: 1, pa: 16 / 9, preset: 'full', crop: { t: 0, b: 0, l: 0, r: 0 }, shape: 'round' };
  // รหัสเลเยอร์สำหรับจำในฉาก: จอ/กล้องมีชิ้นเดียว · URL มีเฉพาะรอบนี้ · รูปใช้ uid ที่บันทึกไว้
  l.sid = kind === 'screen' || kind === 'cam' ? kind : (kind === 'web' ? 'w:' : 'i:') + Math.random().toString(36).slice(2, 9);
  if (kind !== 'image') l.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  return l;
}
const layerH = (l) => (l.w * canvas.width) / l.pa / canvas.height;
const getLayer = (kind) => layers.find((l) => l.kind === kind);
const hasContent = (l) => !!(l && (l.stream || l.img));
const isCapture = (l) => l.kind === 'screen' || l.kind === 'web';

// อัตราส่วนของเนื้อหาจริง (หลังตัดขอบ)
function contentAspect(l) {
  if (l.kind === 'image') return l.img.naturalWidth / Math.max(1, l.img.naturalHeight);
  const v = l.video;
  if (!v.videoWidth) return 16 / 9;
  if (l.kind === 'cam') return l.shape === 'circle' ? 1 : l.camAspect || v.videoWidth / v.videoHeight;
  const c = l.crop;
  return Math.max(1, v.videoWidth - c.l - c.r) / Math.max(1, v.videoHeight - c.t - c.b);
}

// เต็มจออัตโนมัติ: จอแนวตั้งในกรอบแนวตั้ง (เช่น iPhone 19.5:9 ใน 9:16) → "เต็มกรอบ" ไม่มีขอบดำ
// อื่น ๆ → "พอดีจอ" เห็นภาพครบ
function autoFull(l) {
  if (l.userFit) return l.userFit; // ผู้ใช้กดเลือกเองแล้ว → ไม่เปลี่ยนให้
  const portraitCanvas = canvas.height > canvas.width;
  return l.kind === 'screen' && portraitCanvas && contentAspect(l) < 1 ? 'fill' : 'full';
}

function applyPreset(l, pos) {
  const W = canvas.width;
  const H = canvas.height;
  if (pos === 'fill') {
    // เต็มกรอบทั้งหมด ครอปส่วนเกินตรงกลาง (ดู drawLayer)
    Object.assign(l, { pa: W / H, w: 1, x: 0, y: 0, preset: 'fill' });
    saveLayout();
    return;
  }
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
  if (!l.visible || !hasContent(l)) return;
  ctx2d.save();
  ctx2d.globalAlpha = l.opacity ?? 1;
  drawLayerContent(l);
  ctx2d.restore();
}

function drawLayerContent(l) {
  const W = canvas.width;
  const H = canvas.height;
  const x = l.x * W;
  const y = l.y * H;
  const w = l.w * W;
  const h = layerH(l) * H;
  if (l.kind === 'image') {
    // กรอบไม่เท่าสัดส่วนรูป → ครอปตรงกลาง ไม่ยืดรูป
    const iw = l.img.naturalWidth;
    const ih = l.img.naturalHeight;
    const s = Math.max(w / iw, h / ih);
    const cw = w / s;
    const ch = h / s;
    ctx2d.drawImage(l.img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, x, y, w, h);
    return;
  }
  const v = l.video;
  if (!v.videoWidth) return;
  if (isCapture(l)) {
    const c = l.crop;
    let sx = c.l;
    let sy = c.t;
    let sw = v.videoWidth - c.l - c.r;
    let sh = v.videoHeight - c.t - c.b;
    if (sw <= 0 || sh <= 0) return;
    // กรอบกับภาพสัดส่วนไม่ตรงกัน (เช่นโหมดเต็มกรอบ) → ครอปส่วนเกินตรงกลาง ไม่ยืดภาพ
    const boxA = w / h;
    if (sw / sh > boxA + 0.001) {
      const nw = sh * boxA;
      sx += (sw - nw) / 2;
      sw = nw;
    } else if (sw / sh < boxA - 0.001) {
      const nh = sw / boxA;
      sy += (sh - nh) / 2;
      sh = nh;
    }
    // วิดเจ็ต URL: ลบพื้นหลังสีที่เลือก
    if (l.kind === 'web' && l.key && l.key.color && l.chroma) {
      const keyed = l.chroma.process(v, sx, sy, sw, sh, l.key.color, l.key.sim);
      if (keyed) return ctx2d.drawImage(keyed, x, y, w, h);
    }
    ctx2d.drawImage(v, sx, sy, sw, sh, x, y, w, h);
    return;
  }
  // กล้อง: จับใบหน้า (ถ้าเปิดหน้าเรียว/สติกเกอร์) → ฟิลเตอร์ WebGL → ครอปแบบ cover ให้เต็มกรอบ
  const compare = $('fxCompare').checked;
  const face = faceWanted() ? faceTracker.update(v) : null;
  fx.params.foundation = (faceCfg.foundation || 0) / 100; // รองพื้นใช้ได้แม้ยังไม่เจอใบหน้า
  fx.setFace(!compare && face ? buildFaceFx(face, v, faceCfg) : null);
  fx.setBackground(!compare ? backgroundFor(v) : null);
  const src = (compare ? null : fx.process(v)) || v;
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

  // กรอบกล้อง (ตามรูปทรงกล้อง) · ดู FRAMES ใน face.js
  if (l.frame && l.frame !== 'none') {
    const path = (g) => {
      g.beginPath();
      if (l.shape === 'circle') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else g.roundRect(x, y, w, h, l.shape === 'round' ? Math.min(w, h) * 0.06 : 0);
    };
    drawFrame(ctx2d, l.frame, x, y, w, h, path, performance.now() / 1000);
  }

  // สติกเกอร์: วาดนอกกรอบตัด (หูกระต่าย/เขาโผล่พ้นกรอบกล้องได้)
  if (face && faceCfg.sticker && !compare) {
    const mirror = fx.params.mirror;
    const map = (p) => ({
      x: x + ((mirror ? 1 - p.x : p.x) * sw - (sw - cw) / 2) * (w / cw),
      y: y + (p.y * sh - (sh - ch) / 2) * (h / ch),
    });
    drawSticker(ctx2d, faceCfg.sticker, face, map);
  }
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;
  ctx2d.fillStyle = '#000';
  ctx2d.fillRect(0, 0, W, H);
  drawSceneCard(W, H); // ฉากหลังสำเร็จรูปของฉาก (scenes.js)
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
  drawViewerBadge(W, H);
  drawShoutout(W, H);
  drawTransition();
  $('stageHint').hidden = layers.some(hasContent) || !!curScene().card;
  drawOverlay();
}
const bannerText = () => $('banner').value.trim();
const UI_FONT = '"Noto Sans Thai", "Sarabun", system-ui, sans-serif';

// ---------- ชื่อขึ้นจอ (ป้ายขอบคุณคนดู) ----------
const SHOUT_TYPES = {
  follow: { emoji: '💖', text: (n) => `ขอบคุณ ${n} ที่กดติดตาม!`, c1: '#7c5cff', c2: '#ff4d8d' },
  gift: { emoji: '🎁', text: (n) => `${n} ส่งของขวัญ ขอบคุณมาก!`, c1: '#f59e0b', c2: '#ef4444' },
  share: { emoji: '🔁', text: (n) => `ขอบคุณ ${n} ที่แชร์ไลฟ์!`, c1: '#06b6d4', c2: '#3b82f6' },
  member: { emoji: '⭐', text: (n) => `ยินดีต้อนรับสมาชิกใหม่ ${n}!`, c1: '#eab308', c2: '#a855f7' },
  donate: { emoji: '💸', text: (n) => `ขอบคุณ ${n} สำหรับโดเนท!`, c1: '#22c55e', c2: '#14b8a6' },
};
const shoutQueue = [];
let shoutNow = null;
const SHOUT_MS = 6000;
function queueShout(name, type) {
  shoutQueue.push({ name, type });
  if (!shoutNow) nextShout();
}
function nextShout() {
  const s = shoutQueue.shift();
  shoutNow = s ? { ...s, start: performance.now() } : null;
}
function drawShoutout(W, H) {
  if (!shoutNow) return;
  const t = performance.now() - shoutNow.start;
  if (t > SHOUT_MS) return nextShout();
  const st = SHOUT_TYPES[shoutNow.type] || SHOUT_TYPES.follow;
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const inK = ease(t / 450); // เลื่อนลงจากบน
  const outK = ease((t - (SHOUT_MS - 450)) / 450); // เลื่อนขึ้นออก
  const k = inK - outK;
  const S = Math.min(W, H);
  const fs = Math.round(S * 0.05);
  ctx2d.save();
  ctx2d.font = `800 ${fs}px ${UI_FONT}`;
  const label = `${st.emoji}  ${st.text(shoutNow.name)}`;
  const tw = Math.min(W * 0.9, ctx2d.measureText(label).width + fs * 1.6);
  const bh = fs * 2;
  const x = (W - tw) / 2;
  const y = S * 0.05 - (1 - k) * (bh + S * 0.08);
  const pop = 1 + 0.06 * Math.sin(Math.min(1, t / 600) * Math.PI); // เด้งตอนเข้า
  ctx2d.globalAlpha = Math.max(0, Math.min(1, k * 1.2));
  ctx2d.translate(W / 2, y + bh / 2);
  ctx2d.scale(pop, pop);
  ctx2d.translate(-W / 2, -(y + bh / 2));
  const g = ctx2d.createLinearGradient(x, 0, x + tw, 0);
  g.addColorStop(0, st.c1);
  g.addColorStop(1, st.c2);
  ctx2d.shadowColor = 'rgba(0,0,0,.45)';
  ctx2d.shadowBlur = fs * 0.8;
  ctx2d.fillStyle = g;
  ctx2d.beginPath();
  ctx2d.roundRect(x, y, tw, bh, bh / 2);
  ctx2d.fill();
  // ประกายวิ่งผ่าน
  ctx2d.shadowBlur = 0;
  ctx2d.save();
  ctx2d.clip();
  const sx = x - tw * 0.3 + ((t % 1600) / 1600) * tw * 1.6;
  const sg = ctx2d.createLinearGradient(sx - fs * 2, 0, sx + fs * 2, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.5, 'rgba(255,255,255,.35)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx2d.fillStyle = sg;
  ctx2d.fillRect(x, y, tw, bh);
  ctx2d.restore();
  ctx2d.fillStyle = '#fff';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(label, W / 2, y + bh / 2 + fs * 0.04, tw - fs);
  ctx2d.restore();
}

// ---------- ยอดคนดูบนจอ ----------
const viewerData = {}; // { youtube: { viewers, likes, at } }
function drawViewerBadge(W, H) {
  if (!$('viewerOnScreen').checked) return;
  const total = Object.values(viewerData).reduce((s, d) => s + (d.viewers || 0), 0);
  if (!Object.keys(viewerData).length) return;
  const S = Math.min(W, H);
  const fs = Math.round(S * 0.032);
  const m = S * 0.03;
  ctx2d.save();
  ctx2d.font = `700 ${fs}px ${UI_FONT}`;
  const label = `👁 ${total.toLocaleString()}`;
  const tw = ctx2d.measureText(label).width + fs * 3.6;
  const bh = fs * 1.7;
  ctx2d.fillStyle = 'rgba(0,0,0,.55)';
  ctx2d.beginPath();
  ctx2d.roundRect(m, m, tw, bh, bh / 2);
  ctx2d.fill();
  ctx2d.fillStyle = '#ff3b5c';
  ctx2d.beginPath();
  ctx2d.roundRect(m + fs * 0.3, m + fs * 0.3, fs * 2.3, bh - fs * 0.6, (bh - fs * 0.6) / 2);
  ctx2d.fill();
  ctx2d.fillStyle = '#fff';
  ctx2d.textBaseline = 'middle';
  ctx2d.font = `800 ${Math.round(fs * 0.7)}px ${UI_FONT}`;
  ctx2d.fillText('LIVE', m + fs * 0.62, m + bh / 2);
  ctx2d.font = `700 ${fs}px ${UI_FONT}`;
  ctx2d.fillText(label, m + fs * 2.95, m + bh / 2);
  ctx2d.restore();
}

function resizeCanvas(w, h) {
  if (canvas.width === w && canvas.height === h) return;
  if (recorder) return; // ห้ามเปลี่ยนขนาดระหว่างไลฟ์
  canvas.width = w;
  canvas.height = h;
  for (const l of layers) {
    if (l.kind === 'screen' && ['full', 'fill'].includes(l.preset)) applyPreset(l, autoFull(l));
    else if (l.preset) applyPreset(l, l.preset);
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
  if (!hasContent(selected) || !selected.visible) return; // กรอบอยู่บน overlay เท่านั้น ไม่ติดไปในไลฟ์
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
    if (hasContent(l) && l.visible && fx >= l.x && fx <= l.x + l.w && fy >= l.y && fy <= l.y + layerH(l)) return l;
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
  const isFull = l.preset === 'full' || l.preset === 'fill';
  applyPreset(l, isFull ? (l.kind === 'cam' ? 'br' : 'center') : autoFull(l));
});

// ---------- แผงควบคุมเลเยอร์ ----------
function select(l) {
  selected = l;
  renderLayerPanel();
}

function renderLayerPanel() {
  const active = layers.filter(hasContent);
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
  $('cropBox').hidden = !isCapture(selected);
  $('cropAuto').hidden = selected.kind !== 'screen'; // ตัดขอบดำอัตโนมัติเฉพาะจอ (วิดเจ็ตมักมีพื้นทึบ)
  $('shapeBox').hidden = selected.kind !== 'cam';
  $('keyBox').hidden = selected.kind !== 'web';
  $('lyHide').textContent = selected.visible ? 'ซ่อน' : 'แสดง';
  $('cropTop').value = selected.crop.t;
  $('cropTopLabel').textContent = selected.crop.t + ' px';
  $('lyOpacity').value = Math.round((selected.opacity ?? 1) * 100);
  $('lyOpacityLabel').textContent = $('lyOpacity').value + '%';
  document.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('primary', b.dataset.shape === selected.shape));
  document.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('primary', b.dataset.frame === (selected.frame || 'none')));
  document.querySelectorAll('[data-camaspect]').forEach((b) => b.classList.toggle('primary', selected.shape !== 'circle' && Math.abs(+b.dataset.camaspect - (selected.camAspect || 0)) < 0.01));
  if (selected.kind === 'web') {
    const k = selected.key || {};
    document.querySelectorAll('[data-key]').forEach((b) => b.classList.toggle('primary', (b.dataset.key === 'off' && !k.color) || b.dataset.key === k.mode));
    $('keySim').value = Math.round((k.sim ?? 0.3) * 100);
    if (k.color) $('keyColor').value = rgbToHex(k.color);
  }
}

const rgbToHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

$('lyOpacity').oninput = () => {
  if (!selected) return;
  selected.opacity = $('lyOpacity').value / 100;
  $('lyOpacityLabel').textContent = $('lyOpacity').value + '%';
  saveLayout();
};

// ลบพื้นหลังสีของวิดเจ็ต URL
const KEY_PRESETS = { green: [0, 1, 0], black: [0, 0, 0], white: [1, 1, 1] };
function sampleCornerColor(l) {
  const v = l.video;
  const c = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, l.crop.l + 4, l.crop.t + 4, 1, 1, 0, 0, 1, 1); // มุมซ้ายบนของเนื้อหา มักเป็นพื้นหลัง
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}
document.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => {
  const l = selected;
  if (!l || l.kind !== 'web') return;
  const mode = b.dataset.key;
  l.key = l.key || { sim: 0.3 };
  l.key.mode = mode;
  if (mode === 'off') l.key.color = null;
  else if (mode === 'auto') l.key.color = sampleCornerColor(l);
  else l.key.color = KEY_PRESETS[mode];
  if (l.key.color && !l.chroma) l.chroma = new ChromaKey();
  renderLayerPanel();
}));
$('keyColor').oninput = () => {
  const l = selected;
  if (!l || l.kind !== 'web') return;
  l.key = { ...(l.key || { sim: 0.3 }), mode: 'custom', color: hexToRgb($('keyColor').value) };
  if (!l.chroma) l.chroma = new ChromaKey();
  renderLayerPanel();
};
$('keySim').oninput = () => {
  if (!selected || !selected.key) return;
  selected.key.sim = $('keySim').value / 100;
};

document.querySelectorAll('[data-pos]').forEach((b) => (b.onclick = () => {
  if (!selected) return;
  const pos = b.dataset.pos;
  if (pos === 'full' || pos === 'fill') selected.userFit = pos;
  applyPreset(selected, pos);
}));
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
// สัดส่วนกล้อง: แนวนอน/แนวตั้ง/4:3/1:1 — คงความสูงกรอบเดิม ภาพกล้องครอปแบบ cover ให้เต็มกรอบ
document.querySelectorAll('[data-camaspect]').forEach((b) => (b.onclick = () => {
  const l = selected;
  if (!l || l.kind !== 'cam') return;
  const r = +b.dataset.camaspect;
  const h = layerH(l);
  l.camAspect = r;
  if (l.shape === 'circle') l.shape = 'round';
  if (l.preset && l.preset !== 'full' && l.preset !== 'fill') {
    applyPreset(l, l.preset);
  } else {
    const cy = l.y + h / 2;
    const cx = l.x + l.w / 2;
    l.pa = r;
    l.w = Math.min(1, (h * canvas.height * r) / canvas.width);
    l.x = cx - l.w / 2;
    l.y = cy - layerH(l) / 2;
    l.preset = null;
    clampLayer(l);
  }
  renderLayerPanel();
  saveLayout();
}));
document.querySelectorAll('[data-frame]').forEach((b) => (b.onclick = () => {
  if (!selected) return;
  selected.frame = b.dataset.frame;
  renderLayerPanel();
  saveLayout();
}));
$('lyFront').onclick = () => { if (!selected) return; layers.splice(layers.indexOf(selected), 1); layers.push(selected); renderLayerPanel(); saveLayout(); };
$('lyBack').onclick = () => { if (!selected) return; layers.splice(layers.indexOf(selected), 1); layers.unshift(selected); renderLayerPanel(); saveLayout(); };
$('lyHide').onclick = () => { if (!selected) return; selected.visible = !selected.visible; renderLayerPanel(); saveLayout(); };
$('lyRemove').onclick = () => selected && removeLayer(selected);

// ---------- ตัดหัวหน้าต่าง / ขอบดำ ----------
function setCrop(l, crop) {
  const cx = l.x + l.w / 2;
  const cy = l.y + layerH(l) / 2;
  const areaOld = l.w * layerH(l);
  l.crop = crop;
  if (l.kind === 'screen' && ['full', 'fill'].includes(l.preset)) return applyPreset(l, autoFull(l));
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
  const top = isCapture(l) && l.surface === 'window' ? titleBarPx() : 0;
  // เริ่มสแกนใต้แถบชื่อลงมาอีก 3px และปิดการเกลี่ยพิกเซล ไม่ให้สีแถบชื่อซึมมาถูกนับเป็นเนื้อหา
  const scanTop = top ? top + 3 : 0;
  const sw = 320;
  const scale = sw / v.videoWidth;
  const srcH = v.videoHeight - scanTop;
  const sh = Math.max(1, Math.round(srcH * scale));
  const c = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(v, 0, scanTop, v.videoWidth, srcH, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const rowHas = (y) => { for (let x = 0; x < sw; x += 2) if (lum((y * sw + x) * 4) > 24) return true; return false; };
  const colHas = (x) => { for (let y = 0; y < sh; y += 2) if (lum((y * sw + x) * 4) > 24) return true; return false; };
  let t = 0, b = sh - 1, L = 0, R = sw - 1;
  while (t < b && !rowHas(t)) t++;
  while (b > t && !rowHas(b)) b--;
  while (L < R && !colHas(L)) L++;
  while (R > L && !colHas(R)) R--;
  if (b - t < 10 || R - L < 10) {
    // ภาพยังมืดทั้งจอ (เฟรมแรกยังไม่มา หรือ iPhone ยังไม่ได้ต่อ) → ตัดแค่หัวหน้าต่างไว้ก่อน แล้วลองใหม่
    setCrop(l, { t: top, b: 0, l: 0, r: 0 });
    return false;
  }
  const inv = 1 / scale;
  setCrop(l, {
    t: t === 0 ? top : scanTop + Math.round(t * inv),
    b: Math.round((sh - 1 - b) * inv),
    l: Math.round(L * inv),
    r: Math.round((sw - 1 - R) * inv),
  });
  renderLayerPanel();
  return true;
}

// ตัดขอบอัตโนมัติตอนเริ่มแชร์: ลองซ้ำทุก 1 วินาทีจนเจอภาพจริง (สูงสุด ~1 นาที)
function autoCropWhenReady(l, stream, tries = 0) {
  if (l.stream !== stream || tries > 60) return;
  if (!autoCrop(l)) setTimeout(() => autoCropWhenReady(l, stream, tries + 1), 1000);
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
  store.set('layout', layers.filter((l) => l.kind === 'screen' || l.kind === 'cam').map((l) => ({ kind: l.kind, x: l.x, y: l.y, w: l.w, pa: l.pa, preset: l.preset, shape: l.shape, opacity: l.opacity, frame: l.frame, camAspect: l.camAspect })));
  saveImagesSoon();
  if (typeof sceneCapture === 'function') sceneCapture(); // แก้เลเยอร์ = จำลงฉากที่เปิดอยู่
}
const savedLayout = store.get('layout', []);
function restoreLayout(l) {
  const s = savedLayout.find((x) => x.kind === l.kind);
  if (!s) return false;
  Object.assign(l, { x: s.x, y: s.y, w: s.w, pa: s.pa, preset: s.preset, shape: s.shape || l.shape, opacity: s.opacity ?? 1, frame: s.frame || 'none', camAspect: s.camAspect || null });
  if (l.preset) applyPreset(l, l.preset);
  return true;
}

// ใช้ timer ใน Worker เพื่อให้วาดต่อได้แม้สลับไปแท็บอื่น (timer หลักของหน้าจะถูกหน่วงตอนแท็บไม่ได้แสดง)
const ticker = new Worker(URL.createObjectURL(new Blob([
  'let t; onmessage = (e) => { clearInterval(t); t = setInterval(() => postMessage(0), 1000 / e.data); };',
], { type: 'text/javascript' })));
// ถ้าเฟรมก่อนวาดช้า สัญญาณจาก Worker จะค้างคิว → ข้ามสัญญาณที่มาถี่เกิน แทนที่จะวาดรัว ๆ ติดกัน (ต้นเหตุภาพกระตุก)
let tickFps = 30;
let lastDrawAt = 0;
ticker.onmessage = () => {
  if (typeof audioTick === 'function') audioTick(); // noise gate + ลดเพลงตอนพูด (mixer.js)
  const now = performance.now();
  if (now - lastDrawAt < (1000 / tickFps) * 0.6) return;
  lastDrawAt = now;
  draw();
};
function setTickFps(f) {
  tickFps = f;
  ticker.postMessage(f);
}
setTickFps(30);

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
    const restored = restoreLayout(l);
    // ภาพจอที่เคยตั้งเต็มจอ → เลือกแบบเต็มกรอบ/พอดีจอให้ตามแนวภาพตอนนี้
    if (!restored || (kind === 'screen' && ['full', 'fill'].includes(l.preset))) applyPreset(l, kind === 'cam' ? (hasOther ? 'br' : 'full') : autoFull(l));
    sceneApplyLayer(l, true);
    if (kind === 'screen') setTimeout(() => autoCropWhenReady(l, stream), 500); // ตัดหัวหน้าต่าง + ขอบดำให้อัตโนมัติ
    if (kind === 'cam') {
      if (!l.frame || l.frame === 'none') l.frame = store.get('camFrame', 'none');
      renderFrames();
    }
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

function removeLayer(l) {
  if (l.kind === 'screen' || l.kind === 'cam') return removeSource(l.kind);
  if (l.stream) l.stream.getTracks().forEach((t) => t.stop());
  if (l.win && !l.win.closed) l.win.close();
  if (l.img) URL.revokeObjectURL(l.img.src);
  layers.splice(layers.indexOf(l), 1);
  if (l.kind === 'image') idb('delete', l.uid);
  if (selected === l) selected = null;
  renderLayerPanel();
  saveLayout();
}

// ---------- ที่เก็บรูปในเครื่อง (IndexedDB — รูปใหญ่เกิน localStorage) ----------
let dbp = null;
function idb(op, key, value) {
  try {
    dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open('yoddoy-studio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp.then((db) => new Promise((res, rej) => {
      const st = db.transaction('images', op === 'get' || op === 'all' ? 'readonly' : 'readwrite').objectStore('images');
      const r = op === 'put' ? st.put(value, key) : op === 'delete' ? st.delete(key) : op === 'all' ? st.getAll() : st.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    })).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

let saveImagesTimer;
function saveImagesSoon() {
  clearTimeout(saveImagesTimer);
  saveImagesTimer = setTimeout(() => {
    layers.forEach((l, order) => {
      if (l.kind !== 'image') return;
      idb('put', l.uid, { uid: l.uid, name: l.name, blob: l.blob, order, visible: l.visible, opacity: l.opacity, x: l.x, y: l.y, w: l.w, pa: l.pa, preset: l.preset });
    });
  }, 400);
}

// ย่อรูปใหญ่ให้ไม่เกิน 1920px (คงความโปร่งใสด้วย WebP)
async function normalizeImage(blob) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  if (s === 1 && blob.size < 3e6) return blob;
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/webp', 0.92));
}

async function addImageLayer(blob, name, saved) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try {
    await img.decode();
  } catch {
    return toast('เปิดไฟล์รูปนี้ไม่ได้');
  }
  const l = newLayer('image', name || 'รูป');
  Object.assign(l, { img, blob, uid: saved?.uid || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())) });
  layers.push(l);
  if (saved) {
    Object.assign(l, { x: saved.x, y: saved.y, w: saved.w, pa: saved.pa, preset: saved.preset, opacity: saved.opacity ?? 1, visible: saved.visible !== false });
    if (l.preset) applyPreset(l, l.preset);
    sceneApplyLayer(l, false);
  } else {
    applyPreset(l, 'center');
    select(l);
  }
  renderLayerPanel();
  saveLayout();
  return l;
}

$('imgFile').onchange = async (e) => {
  for (const f of [...e.target.files]) await addImageLayer(await normalizeImage(f), f.name.replace(/\.[^.]+$/, ''));
  e.target.value = '';
};

// รูปจากลิงก์: ลองโหลดตรงก่อน ถ้าเว็บนั้นไม่อนุญาต (CORS) ให้ Helper ช่วยโหลด
$('imgUrlAdd').onclick = async () => {
  const url = $('imgUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) return toast('ใส่ลิงก์รูปที่ขึ้นต้นด้วย https://');
  let blob = null;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) blob = await r.blob();
  } catch {}
  if ((!blob || !blob.type.startsWith('image/')) && H) {
    try {
      const r = await fetch(H.base + '/api/image?url=' + encodeURIComponent(url));
      if (r.ok) blob = await r.blob();
    } catch {}
  }
  if (!blob || !blob.type.startsWith('image/')) return toast('โหลดรูปจากลิงก์นี้ไม่ได้ — ดาวน์โหลดรูปแล้วเลือกจากไฟล์แทน');
  await addImageLayer(await normalizeImage(blob), new URL(url).pathname.split('/').pop() || 'รูป');
  $('imgUrl').value = '';
};

// โหลดรูปที่เคยใส่ไว้กลับมา
idb('all').then(async (items) => {
  // ข้ามรูปพื้นหลังกำหนดเอง (kind: 'bg') ที่เก็บในที่เดียวกัน
  for (const it of (items || []).filter((x) => x.uid && x.kind !== 'bg').sort((a, b) => a.order - b.order)) if (it.blob) await addImageLayer(it.blob, it.name, it);
});

// ---------- แปะ URL (เหมือน Browser Source ของ OBS) ----------
// เบราว์เซอร์วาดหน้าเว็บคนอื่นลงภาพไลฟ์ตรง ๆ ไม่ได้ → เปิดลิงก์ในหน้าต่างเล็ก แล้วจับภาพหน้าต่างนั้นมาเป็นเลเยอร์
// (ต้องกด 2 ครั้ง เพราะเบราว์เซอร์ให้เปิดป๊อปอัปและขอจับภาพจอได้ทีละอย่างต่อการคลิก 1 ครั้ง)
let pendingWeb = null;
$('webOpen').onclick = () => {
  const url = $('webUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) return toast('ใส่ลิงก์ที่ขึ้นต้นด้วย https://');
  const w = Math.min(3840, Math.max(200, +$('webW').value || 800));
  const h = Math.min(2160, Math.max(150, +$('webH').value || 600));
  const name = 'yoddoy-web-' + Date.now();
  const win = window.open(url, name, `popup=yes,width=${w},height=${h}`);
  if (!win) return toast('เบราว์เซอร์บล็อกป๊อปอัป — อนุญาตป๊อปอัปสำหรับเว็บนี้แล้วกดอีกครั้ง');
  pendingWeb = { url, win };
  $('webCapture').hidden = false;
  $('webStep').textContent = 'ขั้นที่ 2: กด “จับภาพหน้าต่างนี้” → เลือกแท็บ/หน้าต่างของลิงก์ที่เพิ่งเปิด';
};
$('webCapture').onclick = async () => {
  if (!pendingWeb) return;
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const { url, win } = pendingWeb;
    pendingWeb = null;
    $('webCapture').hidden = true;
    $('webStep').textContent = '';
    const l = newLayer('web', 'URL: ' + new URL(url).hostname.replace(/^www\./, ''));
    Object.assign(l, { stream: s, url, win, key: { sim: 0.3, color: null, mode: 'off' } });
    l.video.srcObject = s;
    l.video.play().catch(() => {});
    const track = s.getVideoTracks()[0];
    l.surface = (track.getSettings && track.getSettings().displaySurface) || '';
    track.onended = () => layers.includes(l) && removeLayer(l);
    layers.push(l);
    l.video.onloadedmetadata = () => {
      if (l.surface === 'window') setCrop(l, { t: titleBarPx(), b: 0, l: 0, r: 0 }); // จับทั้งหน้าต่าง → ตัดแถบชื่อ
      const a = contentAspect(l);
      applyPreset(l, Math.abs(a - canvas.width / canvas.height) < 0.05 ? 'fill' : 'center');
      renderLayerPanel();
    };
    select(l);
    toast('แปะแล้ว — ถ้ามีพื้นหลังทึบ ให้กด “ลบพื้นหลังสี” ในแผงเลเยอร์');
  } catch {
    toast('ยกเลิกการจับภาพ');
  }
};
document.querySelectorAll('[data-websize]').forEach((b) => (b.onclick = () => {
  const [w, h] = b.dataset.websize === 'canvas' ? [canvas.width, canvas.height] : b.dataset.websize.split('x');
  $('webW').value = w;
  $('webH').value = h;
}));

// ---------- แชทสด ----------
const host = location.hostname;
function youtubeId(s) {
  s = String(s || '').trim();
  const m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/video\/|\/shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : '';
}
const CHAT_SOURCES = {
  youtube: {
    embed: (v) => { const id = youtubeId(v); return id && `https://www.youtube.com/live_chat?v=${id}&embed_domain=${host}&dark_theme=1`; },
    popout: (v) => { const id = youtubeId(v); return id && `https://www.youtube.com/live_chat?is_popout=1&v=${id}`; },
  },
  twitch: {
    embed: (v) => v && `https://www.twitch.tv/embed/${encodeURIComponent(v.trim())}/chat?parent=${host}&darkpopout`,
    popout: (v) => v && `https://www.twitch.tv/popout/${encodeURIComponent(v.trim())}/chat?popout=`,
  },
};
const chatCfg = store.get('chat', { youtube: '', twitch: '', tab: 'youtube' });
$('chatYoutube').value = chatCfg.youtube || '';
$('chatTwitch').value = chatCfg.twitch || '';

function showChat(tab) {
  chatCfg.tab = tab;
  chatCfg.youtube = $('chatYoutube').value.trim();
  chatCfg.twitch = $('chatTwitch').value.trim();
  store.set('chat', chatCfg);
  document.querySelectorAll('[data-chat]').forEach((b) => b.classList.toggle('active', b.dataset.chat === tab));
  const frame = $('chatFrame');
  const note = $('chatNote');
  const src = CHAT_SOURCES[tab] && CHAT_SOURCES[tab].embed(chatCfg[tab]);
  frame.hidden = !src;
  note.hidden = !!src;
  if (src && frame.src !== src) frame.src = src;
  if (!src) {
    note.innerHTML = {
      youtube: 'ใส่ลิงก์ไลฟ์หรือ Video ID ของ YouTube ด้านบน (เช่น https://youtube.com/live/xxxxxxxxxxx)',
      twitch: 'ใส่ชื่อช่อง Twitch ด้านบน',
      facebook: 'Facebook ไม่อนุญาตให้ฝังแชทไลฟ์ — กดปุ่มด้านล่างเพื่อเปิดหน้าคอมเมนต์ใน Live Producer',
      tiktok: 'TikTok ไม่มีช่องทางดึงแชททางการ — ดูแชทใน TikTok LIVE Studio หรือแอป TikTok',
    }[tab];
  }
  $('chatPin').hidden = !(CHAT_SOURCES[tab] && CHAT_SOURCES[tab].popout(chatCfg[tab]));
  $('chatFbOpen').hidden = tab !== 'facebook';
}
document.querySelectorAll('[data-chat]').forEach((b) => (b.onclick = () => showChat(b.dataset.chat)));
$('chatYoutube').onchange = () => showChat('youtube');
$('chatTwitch').onchange = () => showChat('twitch');
$('chatFbOpen').onclick = () => window.open('https://www.facebook.com/live/producer', '_blank');
// แปะแชทบนจอ = เตรียมลิงก์แชทแบบป๊อปเอาท์ในส่วน "แปะ URL" แล้วเปิดหน้าต่างให้เลย
$('chatPin').onclick = () => {
  const src = CHAT_SOURCES[chatCfg.tab].popout(chatCfg[chatCfg.tab]);
  $('webUrl').value = src;
  $('webW').value = 400;
  $('webH').value = 600;
  $('webDetails').open = true;
  $('webOpen').click();
  $('webDetails').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
showChat(chatCfg.tab || 'youtube');

// ---------- ฟิลเตอร์สี ----------
const FX_KEYS = ['bright', 'contrast', 'sat', 'warm'];
Object.assign(fx.params, store.get('fx', {}));
let fxPreset = store.get('fxPreset', 'normal');

function syncFxUi() {
  for (const k of FX_KEYS) {
    const input = document.querySelector(`[data-fx="${k}"]`);
    input.value = Math.round(fx.params[k] * 100);
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
    fx.params[k] = input.value / 100;
    fxPreset = '';
    syncFxUi();
    saveFx();
  };
});
$('fxMirror').onchange = () => { fx.params.mirror = $('fxMirror').checked; saveFx(); };
$('fxReset').onclick = () => {
  const { name, ...vals } = FX_PRESETS.normal;
  Object.assign(fx.params, vals); // คงค่าผิวเนียน/ผิวสว่างไว้
  fxPreset = 'normal';
  syncFxUi();
  saveFx();
};
if (!fx.gl) toast('เบราว์เซอร์นี้ไม่รองรับ WebGL — ฟิลเตอร์กล้องใช้ไม่ได้');
syncFxUi();

// ---------- บิวตี้ใบหน้า (แบบแผงของ TikTok LIVE Studio) ----------
const faceTracker = new FaceTracker();
const faceCfg = Object.assign({ sticker: '', lipColor: LIP_COLORS[0], blushColor: BLUSH_COLORS[0] }, store.get('face', {}));
// ผิวเนียน/ผิวสว่างเก็บใน fx.params (ใช้ได้โดยไม่ต้องจับใบหน้า) — ค่าเก่า 0–1 แปลงเป็น 0–100
const beautyGet = (item) => (item.fx ? Math.round((fx.params[item.key] || 0) * 100) : faceCfg[item.key] || 0);
function beautySet(item, val) {
  if (item.fx) {
    fx.params[item.key] = val / 100;
    saveFx();
  } else faceCfg[item.key] = val;
}
const needFace = () => FACE_KEYS.some((k) => faceCfg[k]) || !!faceCfg.sticker;
const faceWanted = () => faceTracker.state === 'ready' && needFace();

function renderFaceStatus() {
  const msg = {
    off: needFace() ? '' : 'ปรับรูปหน้า/ตา/ปาก หรือสติกเกอร์ ระบบจะโหลดตัวจับใบหน้า (ครั้งแรก ~10 MB)',
    loading: '⏳ กำลังโหลดระบบจับใบหน้า…',
    ready: getLayer('cam')?.stream ? (faceTracker.face ? '✅ เจอใบหน้าแล้ว' : '👀 กำลังหาใบหน้า — หันหน้าเข้ากล้อง') : 'เปิดกล้องในแท็บ “ฉาก” ก่อน',
    error: '⚠️ โหลดระบบจับใบหน้าไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่',
  }[faceTracker.state];
  $('faceStatus').textContent = msg;
}
function ensureFace() {
  store.set('face', faceCfg);
  if (needFace() && (faceTracker.state === 'off' || faceTracker.state === 'error')) {
    faceTracker.load().catch(() => {}).finally(renderFaceStatus);
  }
  renderFaceStatus();
}

// แท็บย่อย: หมวดบิวตี้ + ฟิลเตอร์ + สติกเกอร์
const BEAUTY_TABS = [...BEAUTY_GROUPS.map((g) => ({ id: g.id, name: g.name })), { id: 'filter', name: 'ฟิลเตอร์' }, { id: 'sticker', name: 'สติกเกอร์' }];
let beautyTab = store.get('beautyTab', 'skin');
let beautyItem = null;

function renderBeauty() {
  $('beautyTabs').innerHTML = '';
  for (const t of BEAUTY_TABS) {
    const b = document.createElement('button');
    b.textContent = t.name;
    b.className = t.id === beautyTab ? 'active' : '';
    b.onclick = () => {
      beautyTab = t.id;
      store.set('beautyTab', t.id);
      beautyItem = null;
      renderBeauty();
    };
    $('beautyTabs').append(b);
  }
  const group = BEAUTY_GROUPS.find((g) => g.id === beautyTab);
  $('filterPane').hidden = beautyTab !== 'filter';
  $('stickerPane').hidden = beautyTab !== 'sticker';
  $('beautyItems').hidden = !group;
  $('beautySliderRow').hidden = !group;
  $('beautyColors').hidden = true;
  if (!group) return;
  if (!beautyItem || !group.items.includes(beautyItem)) beautyItem = group.items[0];

  $('beautyItems').innerHTML = '';
  for (const it of group.items) {
    const b = document.createElement('button');
    b.className = 'beauty-item' + (it === beautyItem ? ' active' : '') + (beautyGet(it) ? ' on' : '');
    b.innerHTML = `<span class="bi-icon">${it.icon}</span><span class="bi-label">${esc(it.label)}</span>`;
    b.onclick = () => {
      beautyItem = it;
      renderBeauty();
    };
    $('beautyItems').append(b);
  }
  const s = $('beautySlider');
  s.min = beautyItem.min ?? 0;
  s.max = 100;
  s.value = beautyGet(beautyItem);
  s.classList.toggle('bipolar', (beautyItem.min ?? 0) < 0);
  $('beautyItemName').textContent = beautyItem.label;
  $('beautyValue').textContent = s.value;

  if (beautyItem.colors) {
    const list = beautyItem.colors === 'lipColor' ? LIP_COLORS : BLUSH_COLORS;
    const box = $('beautyColors');
    box.hidden = false;
    box.innerHTML = '';
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'swatch' + (faceCfg[beautyItem.colors] === c ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => {
        faceCfg[beautyItem.colors] = c;
        if (!beautyGet(beautyItem)) beautySet(beautyItem, 40); // เลือกสีแล้วเปิดให้เลย
        ensureFace();
        renderBeauty();
      };
      box.append(b);
    }
  }
}
$('beautySlider').oninput = () => {
  beautySet(beautyItem, +$('beautySlider').value);
  $('beautyValue').textContent = $('beautySlider').value;
  // จุดบอกว่าเปิดใช้อยู่ ใต้ไอคอน
  [...$('beautyItems').children].forEach((b, i) => {
    const it = BEAUTY_GROUPS.find((g) => g.id === beautyTab).items[i];
    b.classList.toggle('on', !!beautyGet(it));
  });
  renderStyles();
  ensureFace();
};

// สไตล์สำเร็จรูป
function renderStyles() {
  const box = $('beautyStyles');
  box.innerHTML = '';
  for (const [id, st] of Object.entries(BEAUTY_STYLES)) {
    const b = document.createElement('button');
    b.textContent = st.name;
    b.className = faceCfg.style === id ? 'active' : '';
    b.onclick = () => applyBeautyStyle(id);
    box.append(b);
  }
}
function applyBeautyStyle(id) {
  const st = BEAUTY_STYLES[id];
  for (const it of BEAUTY_GROUPS.flatMap((g) => g.items)) beautySet(it, st ? st.v[it.key] || 0 : 0);
  faceCfg.style = id;
  ensureFace();
  renderStyles();
  renderBeauty();
}
$('beautyReset').onclick = () => applyBeautyStyle('');

function renderStickers() {
  const box = $('stickerChips');
  box.innerHTML = '';
  for (const [id, st] of [['', { name: 'ไม่ใส่' }], ...Object.entries(STICKERS)]) {
    const b = document.createElement('button');
    b.textContent = st.name;
    b.className = faceCfg.sticker === id ? 'active' : '';
    b.onclick = () => {
      faceCfg.sticker = id;
      renderStickers();
      ensureFace();
    };
    box.append(b);
  }
}

// ค่าจากเวอร์ชันก่อน (หน้าเรียวแยก) ยังใช้ได้ เพราะใช้ key เดียวกัน (slim)
renderStyles();
renderBeauty();
renderStickers();
ensureFace();
setInterval(() => faceTracker.state === 'ready' && renderFaceStatus(), 1000);

// ---------- พื้นหลัง: ต้นฉบับ / ตัดภาพ / เบลอ / รูป ----------
const bgSeg = new BgSegmenter();
const bgCfg = Object.assign({ mode: 'off', blur: 60, image: 'neonroom' }, store.get('bg', {}));
const bgBlurCanvas = document.createElement('canvas');
const bgBlurCtx = bgBlurCanvas.getContext('2d');
let bgCustomImg = null;

// เรียกทุกเฟรมจาก drawLayerContent ของกล้อง
function backgroundFor(v) {
  if (bgCfg.mode === 'off' || bgSeg.state !== 'ready') return null;
  const mask = bgSeg.update(v);
  if (!mask) return null;
  if (bgCfg.mode === 'blur') {
    // ย่อภาพให้เล็ก (ยิ่งเบลอมากยิ่งเล็ก) + เบลอ แล้วให้การ์ดจอขยายกลับ = เบลอเนียนและเบา
    const bw = Math.round(200 - bgCfg.blur * 1.5);
    const bh = Math.max(2, Math.round((bw * v.videoHeight) / v.videoWidth));
    if (bgBlurCanvas.width !== bw || bgBlurCanvas.height !== bh) Object.assign(bgBlurCanvas, { width: bw, height: bh });
    bgBlurCtx.filter = `blur(${1 + bgCfg.blur / 30}px)`;
    bgBlurCtx.drawImage(v, 0, 0, bw, bh);
    return { mode: 'blur', mask, source: bgBlurCanvas, static: false };
  }
  if (bgCfg.mode === 'image') {
    const src = bgCfg.image === 'custom' ? bgCustomImg : bgPresetImage(bgCfg.image);
    if (!src) return null;
    return { mode: 'image', mask, source: src, static: true };
  }
  return { mode: 'remove', mask };
}

function setBg(patch) {
  Object.assign(bgCfg, patch);
  store.set('bg', { mode: bgCfg.mode, blur: bgCfg.blur, image: bgCfg.image });
  if (bgCfg.mode !== 'off' && (bgSeg.state === 'off' || bgSeg.state === 'error')) {
    bgSeg.load().catch(() => {}).finally(renderBg);
  }
  renderBg();
}

function renderBg() {
  const grid = $('bgGrid');
  grid.innerHTML = '';
  const tile = (active, html, onclick, thumb) => {
    const b = document.createElement('button');
    b.className = 'bg-tile' + (active ? ' active' : '') + (thumb ? ' thumb' : '');
    if (thumb) b.style.backgroundImage = `url(${thumb})`;
    b.innerHTML = html;
    b.onclick = onclick;
    grid.append(b);
  };
  tile(bgCfg.mode === 'off', '<span>⊘</span>ต้นฉบับ', () => setBg({ mode: 'off' }));
  tile(bgCfg.mode === 'remove', '<span>👤</span>ตัดภาพ', () => setBg({ mode: 'remove' }));
  tile(bgCfg.mode === 'blur', '<span>💧</span>เบลอ', () => setBg({ mode: 'blur' }));
  tile(bgCfg.mode === 'image' && bgCfg.image === 'custom', bgCustomImg ? '<em>รูปของฉัน</em>' : '<span>＋</span>กำหนดเอง', () => (bgCustomImg ? setBg({ mode: 'image', image: 'custom' }) : $('bgFile').click()), bgCustomImg && bgCustomImg.src);
  for (const [id, p] of Object.entries(BG_PRESETS)) {
    tile(bgCfg.mode === 'image' && bgCfg.image === id, `<em>${esc(p.name)}</em>`, () => setBg({ mode: 'image', image: id }), bgThumb(id));
  }
  $('bgBlurRow').hidden = bgCfg.mode !== 'blur';
  $('bgBlur').value = bgCfg.blur;
  $('bgBlurVal').textContent = bgCfg.blur;
  $('bgChange').hidden = !bgCustomImg;
  const st = { off: '', loading: '⏳ กำลังโหลดระบบแยกพื้นหลัง…', ready: getLayer('cam')?.stream ? '✅ แยกพื้นหลังอยู่' : 'เปิดกล้องในแท็บ “ฉาก” ก่อน', error: '⚠️ โหลดระบบแยกพื้นหลังไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่' }[bgSeg.state];
  $('bgStatus').textContent = bgCfg.mode === 'off' ? '' : st;
}
const bgThumbs = {};
function bgThumb(id) {
  if (!bgThumbs[id]) {
    const c = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
    c.getContext('2d').drawImage(bgPresetImage(id), 0, 0, 160, 90);
    bgThumbs[id] = c.toDataURL('image/jpeg', 0.8);
  }
  return bgThumbs[id];
}
$('bgBlur').oninput = () => {
  bgCfg.blur = +$('bgBlur').value;
  $('bgBlurVal').textContent = bgCfg.blur;
  store.set('bg', { mode: bgCfg.mode, blur: bgCfg.blur, image: bgCfg.image });
};
$('bgChange').onclick = () => $('bgFile').click();
$('bgFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const blob = await normalizeImage(f);
  await loadCustomBg(blob);
  idb('put', 'bg-custom', { kind: 'bg', blob });
  setBg({ mode: 'image', image: 'custom' });
};
async function loadCustomBg(blob) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  if (bgCustomImg) URL.revokeObjectURL(bgCustomImg.src);
  bgCustomImg = img;
}
idb('get', 'bg-custom').then(async (it) => {
  if (it && it.blob) await loadCustomBg(it.blob).catch(() => {});
  renderBg();
});
setBg({});
setInterval(() => bgCfg.mode !== 'off' && renderBgStatus(), 1500);
function renderBgStatus() {
  if (bgSeg.state === 'ready') $('bgStatus').textContent = getLayer('cam')?.stream ? '✅ แยกพื้นหลังอยู่' : 'เปิดกล้องในแท็บ “ฉาก” ก่อน';
}

// ---------- กรอบกล้อง (แบบ "ลักษณะที่แสดง") ----------
function renderFrames() {
  const cam = getLayer('cam');
  const cur = (cam && cam.frame) || store.get('camFrame', 'none');
  const grid = $('frameGrid');
  grid.innerHTML = '';
  for (const [id, name] of Object.entries(FRAMES)) {
    const b = document.createElement('button');
    b.className = 'frame-tile' + (cur === id ? ' active' : '');
    b.title = name;
    const c = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 160, 90);
    gr.addColorStop(0, '#1c2130');
    gr.addColorStop(1, '#0c0f16');
    g.fillStyle = gr;
    g.fillRect(0, 0, 160, 90);
    if (id === 'none') {
      g.strokeStyle = '#6b7385'; g.lineWidth = 3;
      g.beginPath(); g.arc(80, 45, 16, 0, 7); g.moveTo(69, 34); g.lineTo(91, 56); g.stroke();
    } else {
      drawFrame(g, id, 12, 10, 136, 70, (q) => { q.beginPath(); q.roundRect(12, 10, 136, 70, 6); }, 1);
    }
    b.append(c);
    const label = document.createElement('span');
    label.textContent = name;
    b.append(label);
    b.onclick = () => {
      store.set('camFrame', id);
      const l = getLayer('cam');
      if (l) {
        l.frame = id;
        saveLayout();
        if (selected === l) renderLayerPanel();
      }
      renderFrames();
    };
    grid.append(b);
  }
}
renderFrames();

// ---------- แท็บแผงตั้งค่า ----------
function showTab(name) {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', b.dataset.tab === name);
  });
  document.querySelectorAll('.tabpanel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  store.set('tab', name);
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
showTab(store.get('tab', 'scene'));

$('srcWeb').onclick = () => {
  $('webDetails').open = true;
  $('webUrl').focus();
  $('webDetails').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ---------- เสียง: ดู mixer.js ----------

// ---------- ส่งสตรีม ----------
let ws;
let recorder = null; // MediaRecorder: ทำงานเมื่อกำลังไลฟ์ และ/หรือ กำลังอัดไฟล์
let isLive = false;
let isRec = false;
let sessionUp = false; // Helper ตอบ 'started' แล้ว
let liveStart = 0;
let recStart = 0;
let clock = null;
let slowSince = 0;

function connect() {
  ws = new WebSocket(H.ws + '/studio');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { $('conn').textContent = 'พร้อมไลฟ์'; $('conn').classList.add('on'); };
  ws.onclose = () => {
    $('conn').textContent = 'ไม่ได้เชื่อมต่อ';
    $('conn').classList.remove('on');
    if (recorder) stopPipeline('การเชื่อมต่อกับเซิร์ฟเวอร์หลุด');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}

function handle(m) {
  switch (m.type) {
    case 'started':
      sessionUp = true;
      if (m.live) toast('เริ่มไลฟ์แล้ว');
      renderChips(m.dests);
      break;
    case 'live':
      if (m.on) {
        toast('เริ่มไลฟ์แล้ว');
        renderChips(m.dests || []);
      }
      break;
    case 'record':
      if (m.on) {
        isRec = true;
        recStart = Date.now();
        $('recFileNow').textContent = baseName(m.file);
      } else {
        isRec = false;
        if (m.error) liveAlert('danger', '⛔ อัดไฟล์หยุด', m.error, 'rec');
        if (m.saved) {
          toast(`บันทึกไฟล์แล้ว (${fmtBytes(m.bytes)}) — ดูได้ที่ “อัดไฟล์” ในแท็บคุณภาพ`);
          loadRecordings();
        }
      }
      updateOutputUi();
      break;
    case 'stats': {
      $('stFps').textContent = Math.round(m.fps);
      // บิตเรตจริงที่ส่งออก = ผลรวมของทุกปลายทางที่ออนไลน์
      const out = (m.dests || []).reduce((sum, d) => sum + (d.kbps || 0), 0);
      $('stKbps').textContent = out ? Math.round(out).toLocaleString() : '–';
      $('stSpeed').textContent = m.speed.toFixed(2) + 'x';
      $('stDrop').textContent = m.drop;
      if (isLive) {
        renderChips(m.dests);
        watchDests(m.dests);
      }
      if (m.rec) $('recSize').textContent = fmtBytes(m.rec.bytes);
      advise(m);
      break;
    }
    case 'log':
      appendLog(m.line);
      if (/overflow|dropping/i.test(m.line)) showAdvice('ปลายทางบางช่องรับข้อมูลไม่ทัน (เน็ตอัปโหลดไม่พอ) — ลดบิตเรตหรือจำนวนปลายทาง');
      break;
    case 'error':
      toast(m.message);
      if (!sessionUp) stopPipeline();
      else if (isLive) {
        // เริ่มไลฟ์ระหว่างอัดไม่สำเร็จ → อัดต่อ
        isLive = false;
        updateOutputUi();
      }
      break;
    case 'stopped':
      // หยุดเองไม่ต้องเตือน · หยุดเพราะปัญหา (ตัวเข้ารหัสดับ ฯลฯ) = เตือนแรง
      if (recorder && !userStopping && (isLive || isRec)) liveAlert('danger', isLive ? '⛔ ไลฟ์หยุดทั้งหมด' : '⛔ อัดไฟล์หยุด', m.reason || 'ตัวส่งไลฟ์หยุดทำงาน — กดเริ่มใหม่', 'all');
      stopPipeline(userStopping ? '' : m.reason);
      break;
  }
}

// ---------- แจ้งเตือนเมื่อช่องทางไหนไลฟ์หลุด ----------
let userStopping = false;
const destPrev = {}; // name → { state, downAt }
function watchDests(list) {
  for (const d of list || []) {
    const p = destPrev[d.name] || { state: 'connecting' };
    const down = d.state === 'error' || d.state === 'reconnecting' || d.state === 'failed';
    if (p.state === 'live' && down) {
      destPrev[d.name] = { state: d.state, downAt: Date.now() };
      liveAlert('danger', `🔴 ${d.name} ไลฟ์หลุด`, 'กำลังต่อใหม่อัตโนมัติ… ถ้าหลุดนาน ให้เช็กเน็ตหรือ Stream Key', d.name);
      continue;
    }
    if (d.state === 'live' && p.state !== 'live') {
      if (p.downAt) {
        const sec = Math.round((Date.now() - p.downAt) / 1000);
        liveAlert('ok', `🟢 ${d.name} กลับมาออนไลน์แล้ว`, `หลุดไป ${sec} วินาที`, d.name);
      }
      destPrev[d.name] = { state: 'live' };
      continue;
    }
    destPrev[d.name] = { ...p, state: d.state };
  }
}

// แถบแจ้งเตือนใต้แถบบน + เสียง + แจ้งเตือนของ Windows (ถ้าอนุญาต)
function liveAlert(kind, title, detail, key) {
  const stack = $('alertStack');
  // แจ้งเตือนเดิมของช่องเดียวกันถูกแทนที่ (เช่น "หลุด" → "กลับมาแล้ว")
  stack.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'live-alert ' + kind;
  el.dataset.key = key;
  el.innerHTML = `<div><b>${esc(title)}</b><span>${esc(detail)}</span></div><button class="icon-btn" aria-label="ปิด">✕</button>`;
  el.querySelector('button').onclick = () => el.remove();
  stack.append(el);
  if (kind === 'ok') setTimeout(() => el.remove(), 8000);
  appendLog(`${title} — ${detail}`);
  beep(kind === 'ok' ? [880, 1320] : [660, 440, 660]);
  try {
    if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || kind !== 'ok')) {
      new Notification(title, { body: detail, tag: 'yoddoy-' + key, icon: document.querySelector('link[rel=icon]')?.href });
    }
  } catch {}
}
function beep(freqs) {
  try {
    const t0 = actx.currentTime;
    freqs.forEach((f, i) => {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
      o.connect(g).connect(actx.destination); // ออกลำโพงเท่านั้น ไม่เข้าเสียงไลฟ์
      o.start(t0 + i * 0.18);
      o.stop(t0 + i * 0.18 + 0.18);
    });
  } catch {}
}

// ---------- ยอดคนดู YouTube (YouTube Data API v3) ----------
$('ytApiKey').value = store.get('ytApiKey', '');
$('viewerOnScreen').checked = store.get('viewerOnScreen', false);
$('ytApiKey').onchange = () => { store.set('ytApiKey', $('ytApiKey').value.trim()); pollViewers(); };
$('viewerOnScreen').onchange = () => store.set('viewerOnScreen', $('viewerOnScreen').checked);
async function pollViewers() {
  const key = $('ytApiKey').value.trim();
  const id = youtubeId($('chatYoutube').value);
  if (!key || !id) {
    delete viewerData.youtube;
    $('viewerStatus').textContent = key ? 'ใส่ลิงก์ไลฟ์ YouTube ในช่องด้านล่าง' : '';
    return renderViewers();
  }
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,statistics&id=${id}&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    const it = j.items && j.items[0];
    if (!it) throw new Error('ไม่พบวิดีโอนี้');
    const live = it.liveStreamingDetails || {};
    viewerData.youtube = { viewers: +(live.concurrentViewers || 0), likes: +(it.statistics?.likeCount || 0), live: !!live.concurrentViewers, at: Date.now() };
    $('viewerStatus').textContent = live.concurrentViewers ? `อัปเดต ${new Date().toLocaleTimeString('th-TH')}` : 'ไลฟ์นี้ยังไม่ออนแอร์ หรือจบแล้ว';
  } catch (e) {
    delete viewerData.youtube;
    $('viewerStatus').textContent = '⚠️ ดึงยอดคนดูไม่ได้: ' + e.message;
  }
  renderViewers();
}
function renderViewers() {
  const y = viewerData.youtube;
  $('viewerStats').innerHTML = y ? `<span class="chip viewer">YouTube · 👁 ${y.viewers.toLocaleString()} คนดู · ❤ ${y.likes.toLocaleString()}</span>` : '';
}
$('chatYoutube').addEventListener('change', pollViewers);
setInterval(pollViewers, 30000); // โควตาฟรี 10,000/วัน · ครั้งละ 1 หน่วย
pollViewers();

// ---------- ป้ายชื่อขึ้นจอ ----------
function sendShout() {
  const name = $('shoutName').value.trim();
  if (!name) return $('shoutName').focus();
  queueShout(name, $('shoutType').value);
  $('shoutName').value = '';
  $('shoutName').focus();
}
$('shoutGo').onclick = sendShout;
$('shoutName').addEventListener('keydown', (e) => e.key === 'Enter' && sendShout());

function appendLog(line) {
  const log = $('log');
  log.textContent += new Date().toLocaleTimeString('th-TH') + '  ' + line + '\n';
  if (log.textContent.length > 20000) log.textContent = log.textContent.slice(-15000);
  log.scrollTop = log.scrollHeight;
}

function renderChips(list) {
  const label = { connecting: 'กำลังเชื่อมต่อ', reconnecting: 'กำลังต่อใหม่', live: 'ออนไลน์', error: 'หลุด · กำลังต่อใหม่', failed: 'หลุด' };
  $('destStatus').innerHTML = list.map((d) => {
    const extra = [d.state === 'live' && d.kbps ? `${Math.round(d.kbps).toLocaleString()} kbps` : '', d.reconnects ? `ต่อใหม่ ${d.reconnects} ครั้ง` : ''].filter(Boolean).join(' · ');
    return `<span class="chip ${d.state}">${esc(d.name)} · ${label[d.state] || d.state}${extra ? ' · ' + extra : ''}</span>`;
  }).join('');
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


// ---------- หน้าต่างภาพสะอาดสำหรับ TikTok LIVE Studio / OBS (Window capture) ----------
let outputWin = null;
$('btnOutput').onclick = () => {
  if (outputWin && !outputWin.closed) return outputWin.focus();
  // ขนาดหน้าต่างตามแนวภาพ: ด้านยาว ~ 80% ของความสูงจอ
  const aspect = canvas.width / canvas.height;
  const maxH = Math.round(screen.availHeight * 0.8);
  const h = aspect >= 1 ? Math.round(Math.min(maxH, (screen.availWidth * 0.6) / aspect)) : maxH;
  const w = Math.round(h * aspect);
  outputWin = window.open('output.html', 'yoddoy-output', `popup=yes,width=${w},height=${h}`);
  if (!outputWin) toast('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป — อนุญาตป๊อปอัปสำหรับเว็บนี้แล้วกดอีกครั้ง');
};

function pickMime() {
  const opts = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((t) => MediaRecorder.isTypeSupported(t));
}

const baseName = (p) => String(p || '').split(/[\\/]/).pop();
const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round((b || 0) / 1e6) + ' MB');
const hhmmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
};
const recSupported = () => H && !window.versionLess(H.version, '1.5.0');

// ปลายทางที่จะไลฟ์ (null = ยังไม่พร้อม พร้อมบอกเหตุผลแล้ว)
function liveDestinations() {
  const active = dests.filter((d) => d.on);
  if (!active.length) {
    showTab('dest');
    toast('เพิ่มปลายทางอย่างน้อย 1 ช่อง');
    return null;
  }
  const missing = active.find((d) => !d.url || !d.key);
  if (missing) {
    showTab('dest');
    toast(`${PLATFORMS[missing.platform].name}: ใส่ Server URL และ Stream Key ให้ครบ`);
    return null;
  }
  return active.map((d) => ({ name: PLATFORMS[d.platform].name, url: d.url, key: d.key }));
}

function helperReady() {
  if (!H) {
    showHelperMissing();
    $('helperCard').scrollIntoView({ behavior: 'smooth' });
    toast('ต้องติดตั้งและเปิด Yoddoy Helper บนเครื่องนี้ก่อน');
    return false;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('ยังไม่ได้เชื่อมต่อ Yoddoy Helper');
    return false;
  }
  return true;
}

// เริ่มส่งภาพ+เสียงไป Helper (ใช้ร่วมกันทั้งไลฟ์และอัดไฟล์)
async function startPipeline({ destinations, record }) {
  calc();
  await actx.resume();
  sessionUp = false;
  setTickFps(plan.fps);
  const video = canvas.captureStream(plan.fps).getVideoTracks()[0];
  const stream = new MediaStream([video, mixOut.stream.getAudioTracks()[0]]);
  recorder = new MediaRecorder(stream, {
    mimeType: pickMime(),
    // ส่งภายในเครื่องแบบคุณภาพเผื่อไว้ ~1.6 เท่า แล้วค่อยบีบที่ FFmpeg (สูงเกินไปทำให้เบราว์เซอร์เข้ารหัสหนักโดยไม่จำเป็น)
    videoBitsPerSecond: Math.max(5e6, plan.videoKbps * 1600),
    audioBitsPerSecond: 192000,
  });
  // ส่ง Blob ตรง ๆ: WebSocket รับประกันลำดับ (ถ้า await arrayBuffer() ก่อน ชิ้นที่เล็กกว่าอาจแซงคิว → วิดีโอเพี้ยน/หลุด)
  recorder.ondataavailable = (e) => {
    if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  recorder.onerror = (e) => {
    appendLog('MediaRecorder error: ' + ((e.error && e.error.message) || 'unknown'));
    toast('เบราว์เซอร์หยุดบันทึกภาพ — กดเริ่มใหม่');
  };
  ws.send(JSON.stringify({
    type: 'start',
    width: plan.width, height: plan.height, fps: plan.fps,
    videoKbps: plan.videoKbps, audioKbps: plan.audioKbps,
    encoder: $('encoder').value,
    latency: $('latency').value,
    delaySec: delaySec(),
    destinations: destinations || [],
    record: !!record,
  }));
  recorder.start(RECORDER_SLICE[$('latency').value] || 250);
  clearInterval(clock);
  clock = setInterval(updateClock, 1000);
}

function beginLiveUi() {
  userStopping = false;
  for (const k of Object.keys(destPrev)) delete destPrev[k];
  $('alertStack').innerHTML = '';
  // ขอสิทธิ์แจ้งเตือนของ Windows ไว้เตือนตอนไลฟ์หลุด (ถามครั้งเดียว)
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  isLive = true;
  liveStart = Date.now();
}

async function startLive() {
  const list = liveDestinations();
  if (!list || !helperReady()) return;
  beginLiveUi();
  if (recorder) {
    // กำลังอัดอยู่ → เริ่มไลฟ์ต่อจากภาพเดิม ไม่ต้องเริ่มใหม่
    ws.send(JSON.stringify({ type: 'golive', destinations: list, delaySec: delaySec() }));
  } else {
    const record = $('recWithLive').checked && recSupported();
    if (record) { isRec = true; recStart = Date.now(); }
    await startPipeline({ destinations: list, record });
  }
  updateOutputUi();
}

function stopLive() {
  userStopping = true;
  $('alertStack').innerHTML = '';
  if (isRec) {
    // อัดไฟล์อยู่ → หยุดแค่ไลฟ์ อัดต่อ
    ws.send(JSON.stringify({ type: 'endlive' }));
    isLive = false;
    $('destStatus').innerHTML = '';
    updateOutputUi();
    toast('หยุดไลฟ์แล้ว — ยังอัดไฟล์อยู่');
    userStopping = false;
    return;
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  stopPipeline('หยุดไลฟ์แล้ว');
}

async function startRec() {
  if (!helperReady()) return;
  if (!recSupported()) {
    $('helperCard').hidden = false;
    $('helperUpdate').hidden = false;
    $('helperDesktop').hidden = true;
    return toast('การอัดไฟล์ต้องใช้ Yoddoy Helper 1.5.0 ขึ้นไป — ดาวน์โหลดเวอร์ชันใหม่ด้านบน');
  }
  isRec = true;
  recStart = Date.now();
  if (recorder) ws.send(JSON.stringify({ type: 'record', on: true }));
  else {
    userStopping = false;
    await startPipeline({ destinations: [], record: true });
  }
  updateOutputUi();
}

function stopRec() {
  if (!recorder) return;
  if (isLive) {
    ws.send(JSON.stringify({ type: 'record', on: false }));
    isRec = false;
    updateOutputUi();
    return;
  }
  userStopping = true;
  ws.send(JSON.stringify({ type: 'stop' }));
  stopPipeline('');
}

function stopPipeline(reason) {
  const was = !!recorder;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  isLive = false;
  isRec = false;
  sessionUp = false;
  clearInterval(clock);
  updateOutputUi();
  showAdvice('');
  if (reason && was) toast(reason);
  setTickFps(30);
}

function updateClock() {
  $('liveTime').textContent = hhmmss(Date.now() - liveStart);
  $('recTime').textContent = hhmmss(Date.now() - recStart);
}

function updateOutputUi() {
  $('liveBadge').hidden = !isLive;
  $('recBadge').hidden = !isRec;
  $('btnLive').textContent = isLive ? 'หยุดไลฟ์' : 'เริ่มไลฟ์';
  $('btnLive').classList.toggle('live', isLive);
  $('btnRec').classList.toggle('on', isRec);
  $('btnRec').title = isRec ? 'หยุดอัดไฟล์' : 'อัดไฟล์ MP4 (ไม่ต้องไลฟ์ก็ได้)';
  $('btnRec').setAttribute('aria-label', $('btnRec').title);
  $('btnRec').querySelector('span').textContent = isRec ? 'หยุดอัด' : 'อัด';
  $('recNow').hidden = !isRec;
  if (!isRec) $('recSize').textContent = '';
  if (!isLive) $('destStatus').innerHTML = '';
  updateClock();
  lockSettings();
}

function lockSettings() {
  // ภาพ/บิตเรตเปลี่ยนไม่ได้ระหว่างส่ง · ปลายทางล็อกเฉพาะตอนไลฟ์
  for (const id of ['orient', 'manual', 'res', 'fps', 'vkbps', 'akbps', 'encoder', 'upload', 'btnSpeed', 'latency']) $(id).disabled = !!recorder;
  for (const id of ['btnAdd', 'delaySec']) $(id).disabled = isLive;
  $('destList').querySelectorAll('input,button').forEach((el) => (el.disabled = isLive));
}

// ---------- ไฟล์ที่อัดไว้ ----------
$('recWithLive').checked = store.get('recWithLive', false);
$('recWithLive').onchange = () => store.set('recWithLive', $('recWithLive').checked);
async function loadRecordings() {
  if (!H || !recSupported()) {
    $('recList').innerHTML = '';
    $('recDir').textContent = H ? 'ต้องอัปเดต Yoddoy Helper เป็น 1.5.0 ขึ้นไป' : 'ต้องเปิด Yoddoy Helper';
    return;
  }
  try {
    const j = await (await fetch(H.base + '/api/recordings')).json();
    $('recDir').textContent = 'เก็บไว้ที่ ' + j.dir;
    $('recList').innerHTML = '';
    for (const f of j.files.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'rec-row';
      row.innerHTML = '<span class="rec-name"></span><span class="muted small"></span><button class="btn small">เปิด</button>';
      row.querySelector('.rec-name').textContent = f.name.replace(/^Yoddoy-|\.mp4$/g, '').replace('_', ' ');
      row.querySelector('.muted').textContent = fmtBytes(f.bytes);
      row.querySelector('button').onclick = () => openRecFolder(f.name);
      $('recList').append(row);
    }
    if (!j.files.length) $('recList').innerHTML = '<p class="muted small">ยังไม่มีไฟล์</p>';
  } catch {}
}
function openRecFolder(name) {
  if (!H) return;
  fetch(H.base + '/api/recordings/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || '' }) }).catch(() => {});
}
$('recOpen').onclick = () => openRecFolder('');

$('btnLive').onclick = () => (isLive ? stopLive() : startLive());
$('btnRec').onclick = () => (isRec ? stopRec() : startRec());

window.addEventListener('beforeunload', (e) => {
  if (recorder) e.preventDefault();
});

renderDests();
calc();
window.helper.then((h) => {
  H = h;
  if (!h) return showHelperMissing();
  if (window.versionLess(h.version, window.HELPER_MIN_VERSION)) {
    $('helperCard').hidden = false;
    $('helperDesktop').hidden = true;
    $('helperUpdate').hidden = false;
    $('helperVer').textContent = h.version || 'เก่า';
    $('helperUpdateLink').href = window.HELPER_DOWNLOAD;
  }
  connect();
  loadEncoders();
  loadRecordings();
});
// ติดตั้ง Helper เสร็จแล้วกลับมาที่แท็บนี้ → ลองหาใหม่อัตโนมัติ
window.addEventListener('focus', async () => {
  if (H || window.IS_MOBILE) return;
  const h = await findHelper();
  if (h) location.reload();
});
