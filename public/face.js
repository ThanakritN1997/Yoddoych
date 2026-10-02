// จับใบหน้า (MediaPipe Face Landmarker) → หน้าเรียว + สติกเกอร์ติดหน้า
// โหลดโมเดลเฉพาะตอนเปิดใช้ (≈ 10 MB ครั้งแรก แล้วเบราว์เซอร์แคชไว้)
const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// จุดบนใบหน้าที่ใช้ (ดัชนีของ MediaPipe face mesh 468 จุด) · ซ้าย/ขวา = ซ้าย/ขวาของภาพกล้อง
const LM = {
  top: 10, chin: 152, nose: 1, bridge: 6, l: 234, r: 454,
  lEyeO: 33, lEyeI: 133, lEyeT: 159, lEyeB: 145, rEyeO: 263, rEyeI: 362, rEyeT: 386, rEyeB: 374,
  lBrow: 105, rBrow: 334, noseL: 129, noseR: 358,
  mL: 61, mR: 291, mT: 13, mB: 14, lipT: 0, lipB: 17,
  lCheek: 50, rCheek: 280, lJaw: 172, rJaw: 397, lMid: 132, rMid: 361, lJaw2: 58, rJaw2: 288, lFold: 205, rFold: 425,
};

// ---------- ตัวกลางคุยกับ vision-worker.js ----------
// หน้าเว็บส่งเฟรมย่อ (ImageBitmap) ให้ worker ทีละเฟรม ถ้า worker ยังทำงานเฟรมก่อนอยู่ = ข้ามไป (ไม่ต่อคิว)
// → การวาดภาพ/ส่งวิดีโอไม่ต้องรอ AI เลย แม้ AI จะช้ากว่าเฟรมเรตของไลฟ์ก็ตาม
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
// 1 worker ต่อ 1 งาน (ใบหน้า / พื้นหลัง) → ทำงานขนานกัน ไม่ต้องรอกันเอง
class VisionHub {
  constructor(task, inputW) {
    this.task = task;
    this.inputW = inputW; // ย่อเฟรมก่อนส่งเข้า AI (ใบหน้า 480 / พื้นหลัง 320 พอ)
    // ใช้ CPU เป็นหลัก: ระหว่างไลฟ์การ์ดจอยุ่งกับฟิลเตอร์+เข้ารหัสวิดีโอ วัดแล้ว CPU เร็วกว่า (หน้า 15.8 vs 6, พื้นหลัง 14 vs 10 ครั้ง/วินาที)
    // และ worker มีเธรดของตัวเอง จึงไม่ถ่วงหน้าเว็บ
    this.prefer = 'CPU';
    this.worker = null;
    this.busy = false;
    this.ready = false;
    this.loading = null;
    this.lastTime = -1;
    this.onResult = null;
  }
  load() {
    if (this.loading) return this.loading;
    this.worker = this.worker || new Worker('vision-worker.js');
    this.worker.onmessage = (e) => this.onMsg(e.data);
    this.worker.onerror = () => { this.busy = false; };
    this.loading = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
    this.worker.postMessage({ type: 'init', task: this.task, base: MP_BASE, model: this.task === 'face' ? MP_MODEL : SEG_MODEL, prefer: this.prefer });
    return this.loading;
  }
  // เรียกทุกเฟรม: ถ้า worker ว่างและเป็นเฟรมใหม่ → ส่งเข้าไปตรวจ, ถ้ายังไม่ว่าง → ข้าม (ไม่ต่อคิว)
  async request(v) {
    if (!this.ready || this.busy || !v || !v.videoWidth || v.currentTime === this.lastTime) return;
    this.lastTime = v.currentTime;
    this.busy = true;
    try {
      const w = Math.min(this.inputW, v.videoWidth);
      const h = Math.max(2, Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2);
      const bitmap = await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
      this.worker.postMessage({ type: 'frame', bitmap, ts: performance.now(), face: this.task === 'face', seg: this.task === 'seg' }, [bitmap]);
    } catch {
      this.busy = false;
    }
  }
  onMsg(m) {
    if (m.type === 'ready') {
      this.ready = true;
      this.delegate = m.delegate;
      this.pending.resolve();
    } else if (m.type === 'error') {
      this.loading = null; // ให้ลองโหลดใหม่ได้
      this.pending.reject(new Error(m.message));
    } else if (m.type === 'result') {
      this.busy = false;
      if (this.onResult) this.onResult(m);
    }
  }
}

class FaceTracker {
  constructor() {
    this.state = 'off'; // off | loading | ready | error
    this.face = null; // จุดบนใบหน้าล่าสุด (ทำให้นิ่งแล้ว) พิกัด 0–1 ของภาพกล้อง
    this.missed = 0;
    this.hub = new VisionHub('face', 480);
    this.hub.onResult = (m) => m.hasFace && this.ingest(m.face || null);
  }

  load() {
    if (this.state === 'loading' || this.state === 'ready') return this.ready;
    this.state = 'loading';
    this.ready = this.hub.load().then(
      () => { this.state = 'ready'; },
      (e) => { this.state = 'error'; this.error = e; throw e; },
    );
    return this.ready;
  }

  // เรียกทุกเฟรม: ขอให้ worker ตรวจเฟรมนี้ (ถ้าว่าง) แล้วคืนผลล่าสุดทันที ไม่รอ
  update(video) {
    if (this.state === 'ready') this.hub.request(video);
    return this.face;
  }

  ingest(arr) {
    if (!arr) {
      if (++this.missed > 5) this.face = null; // หายไปหลายเฟรม → เลิกวาด
      return;
    }
    this.missed = 0;
    // ทำให้นิ่ง: ผสมกับตำแหน่งเดิม (กันสติกเกอร์สั่น)
    const next = {};
    for (const [k, i] of Object.entries(LM)) {
      const x = arr[i * 2];
      const y = arr[i * 2 + 1];
      const prev = this.face && this.face[k];
      next[k] = prev ? { x: prev.x + (x - prev.x) * 0.6, y: prev.y + (y - prev.y) * 0.6 } : { x, y };
    }
    this.face = next;
  }
}

// ---------- แยกคนออกจากพื้นหลัง (MediaPipe Selfie Segmenter ใน worker) ----------
class BgSegmenter {
  constructor() {
    this.state = 'off';
    this.mask = null; // { data: Uint8Array, w, h }
    this.hub = new VisionHub('seg', 320);
    this.hub.onResult = (m) => m.mask && this.ingest(m.mask, m.w, m.h);
  }
  load() {
    if (this.state === 'loading' || this.state === 'ready') return this.ready;
    this.state = 'loading';
    this.ready = this.hub.load().then(
      () => { this.state = 'ready'; },
      (e) => { this.state = 'error'; throw e; },
    );
    return this.ready;
  }
  update(video) {
    if (this.state === 'ready') this.hub.request(video);
    return this.mask;
  }
  ingest(data, w, h) {
    if (!this.mask || this.mask.w !== w || this.mask.h !== h) {
      this.acc = new Float32Array(w * h);
      for (let i = 0; i < data.length; i++) this.acc[i] = data[i];
      this.mask = { data: new Uint8Array(w * h), w, h };
    }
    const acc = this.acc;
    const out = this.mask.data;
    for (let i = 0; i < data.length; i++) {
      acc[i] = acc[i] * 0.4 + data[i] * 0.6; // ลดขอบกะพริบระหว่างเฟรม
      out[i] = acc[i];
    }
  }
}

// ---------- รูปพื้นหลังสำเร็จรูป (วาดเองด้วย canvas) ----------
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const BG_PRESETS = {
  neonroom: { name: 'ห้องนีออน', draw(g, W, H, R) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#140a2e'); gr.addColorStop(1, '#2a0f3d'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1b1238'; g.fillRect(0, H * .72, W, H * .28);
    for (const [x, c] of [[.12, '#ff4fd8'], [.88, '#39d5ff']]) { g.shadowColor = c; g.shadowBlur = 40; g.strokeStyle = c; g.lineWidth = 10; g.beginPath(); g.moveTo(W * x, H * .08); g.lineTo(W * x, H * .7); g.stroke(); }
    g.shadowBlur = 30; g.shadowColor = '#ff4fd8'; g.strokeStyle = '#ffb3f1'; g.lineWidth = 6; g.strokeRect(W * .3, H * .15, W * .4, H * .28);
    g.shadowBlur = 0; g.fillStyle = '#261a4d'; for (let i = 0; i < 4; i++) g.fillRect(W * (.22 + i * .15), H * .5, W * .1, H * .22);
    g.fillStyle = 'rgba(57,213,255,.25)'; g.fillRect(0, H * .72, W, 4);
  } },
  sunset: { name: 'พระอาทิตย์ตก', draw(g, W, H) {
    const gr = g.createLinearGradient(0, 0, 0, H * .65); gr.addColorStop(0, '#2b1a55'); gr.addColorStop(.55, '#e8617a'); gr.addColorStop(1, '#ffc27a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const sg = g.createRadialGradient(W * .5, H * .62, 10, W * .5, H * .62, H * .3); sg.addColorStop(0, '#fff3c4'); sg.addColorStop(.3, '#ffd27a'); sg.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, H);
    const sea = g.createLinearGradient(0, H * .65, 0, H); sea.addColorStop(0, '#6b3a73'); sea.addColorStop(1, '#1d1636'); g.fillStyle = sea; g.fillRect(0, H * .65, W, H * .35);
    g.fillStyle = 'rgba(255,220,160,.5)'; for (let i = 0; i < 9; i++) g.fillRect(W * (.44 + Math.sin(i) * .04), H * (.68 + i * .03), W * (.12 - i * .01), 3);
  } },
  city: { name: 'เมืองกลางคืน', draw(g, W, H, R) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#050a1f'); gr.addColorStop(1, '#16224a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) { const x = R() * W, y = H * (.2 + R() * .5), r = 8 + R() * 38; const c = ['255,196,110', '255,120,160', '120,190,255'][i % 3]; const bg = g.createRadialGradient(x, y, 0, x, y, r); bg.addColorStop(0, `rgba(${c},.55)`); bg.addColorStop(1, `rgba(${c},0)`); g.fillStyle = bg; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.fillStyle = '#0a0f26'; let x = 0; while (x < W) { const bw = 40 + R() * 90, bh = H * (.25 + R() * .35); g.fillRect(x, H - bh, bw, bh); g.fillStyle = 'rgba(255,214,140,.7)'; for (let yy = H - bh + 12; yy < H - 10; yy += 18) for (let xx = x + 8; xx < x + bw - 8; xx += 14) if (R() > .55) g.fillRect(xx, yy, 5, 8); g.fillStyle = '#0a0f26'; x += bw + 4; }
  } },
  studio: { name: 'สตูดิโอ', draw(g, W, H) {
    const gr = g.createRadialGradient(W * .5, H * .45, H * .1, W * .5, H * .5, W * .7); gr.addColorStop(0, '#e9e4dc'); gr.addColorStop(1, '#8f877d'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } },
  pastel: { name: 'พาสเทล', draw(g, W, H) {
    g.fillStyle = '#fbe7f3'; g.fillRect(0, 0, W, H);
    for (const [x, y, r, c] of [[.2, .3, .45, '#ffc6e0'], [.8, .25, .4, '#c9d7ff'], [.6, .85, .5, '#d8f5e8'], [.1, .9, .35, '#fff0c2']]) { const b = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, W * r); b.addColorStop(0, c); b.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = b; g.fillRect(0, 0, W, H); }
  } },
  gaming: { name: 'เกมมิ่ง', draw(g, W, H) {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0b0620'); gr.addColorStop(1, '#1a0b3a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(160,90,255,.45)'; g.lineWidth = 2; const hz = H * .55;
    for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(W / 2 + i * 12, hz); g.lineTo(W / 2 + i * W * .12, H); g.stroke(); }
    for (let k = 0; k < 12; k++) { const y = hz + (H - hz) * Math.pow(k / 12, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const sg = g.createLinearGradient(0, hz - 4, 0, hz + 4); sg.addColorStop(0, 'rgba(0,229,255,0)'); sg.addColorStop(.5, '#00e5ff'); sg.addColorStop(1, 'rgba(0,229,255,0)'); g.fillStyle = sg; g.fillRect(0, hz - 4, W, 8);
    const sun = g.createLinearGradient(0, H * .15, 0, hz); sun.addColorStop(0, '#ff3ea5'); sun.addColorStop(1, '#ffb13e'); g.fillStyle = sun; g.beginPath(); g.arc(W / 2, hz, H * .28, Math.PI, 0); g.fill();
  } },
  forest: { name: 'ป่าแสงเช้า', draw(g, W, H, R) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#cfe8c8'); gr.addColorStop(1, '#2f5d3a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) { const x = R() * W, w = 20 + R() * 50; g.fillStyle = `rgba(30,60,35,${.35 + R() * .4})`; g.fillRect(x, 0, w, H); }
    g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(255,248,210,.08)'; g.beginPath(); g.moveTo(W * (.1 + i * .12), 0); g.lineTo(W * (.2 + i * .12), 0); g.lineTo(W * (.45 + i * .1), H); g.lineTo(W * (.3 + i * .1), H); g.fill(); } g.globalCompositeOperation = 'source-over';
  } },
  snow: { name: 'หิมะ', draw(g, W, H, R) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#9fb8d6'); gr.addColorStop(1, '#eef4fb'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5f7a99'; for (let i = 0; i < 9; i++) { const x = (i / 8) * W, h = H * (.3 + R() * .2); g.beginPath(); g.moveTo(x - 90, H * .75); g.lineTo(x, H * .75 - h); g.lineTo(x + 90, H * .75); g.fill(); }
    g.fillStyle = '#f7fbff'; g.fillRect(0, H * .75, W, H * .25);
    for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(255,255,255,${.5 + R() * .5})`; g.beginPath(); g.arc(R() * W, R() * H, 1 + R() * 3, 0, 7); g.fill(); }
  } },
  cozy: { name: 'ห้องอบอุ่น', draw(g, W, H) {
    g.fillStyle = '#e9dccb'; g.fillRect(0, 0, W, H);
    const lg = g.createLinearGradient(W * .55, 0, W * .95, H); lg.addColorStop(0, 'rgba(255,236,190,.85)'); lg.addColorStop(1, 'rgba(255,236,190,0)'); g.fillStyle = lg;
    for (let i = 0; i < 3; i++) g.fillRect(W * (.58 + i * .12), H * .1, W * .1, H * .5);
    g.fillStyle = '#b89a7a'; g.fillRect(0, H * .78, W, H * .22);
    g.fillStyle = '#7a5b43'; g.fillRect(W * .06, H * .45, W * .22, H * .33); g.fillStyle = '#3e6b4a'; g.beginPath(); g.ellipse(W * .17, H * .38, W * .07, H * .1, 0, 0, 7); g.fill();
  } },
};
const bgPresetCanvas = {};
function bgPresetImage(id) {
  if (!bgPresetCanvas[id]) {
    const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    BG_PRESETS[id].draw(c.getContext('2d'), c.width, c.height, seeded(Object.keys(BG_PRESETS).indexOf(id) * 7919 + 17));
    bgPresetCanvas[id] = c;
  }
  return bgPresetCanvas[id];
}

// ---------- กรอบกล้อง ----------
const FRAMES = {
  none: 'ไม่มี', glow: 'ไล่สีเรืองแสง', neon: 'นีออนชมพู', white: 'ขาว', gold: 'ทอง', hud: 'เกมมิ่ง HUD',
  rgb: 'RGB วิ่ง', cyber: 'ไซเบอร์', pastel: 'พาสเทลวิบวับ', fire: 'ไฟ', lime: 'เขียวนีออน',
};
// path(ctx) = วาดรูปทรงกรอบ (ตามรูปทรงกล้อง) · t = เวลา (วินาที) สำหรับกรอบที่เคลื่อนไหว
function drawFrame(ctx, id, x, y, w, h, path, t) {
  if (!id || id === 'none') return;
  const lw = Math.max(3, Math.min(w, h) * 0.014);
  const stroke = (style, width, blur, color) => {
    ctx.save();
    path(ctx);
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    if (blur) { ctx.shadowBlur = blur; ctx.shadowColor = color; }
    ctx.stroke();
    ctx.restore();
  };
  const corners = (len, width, color, blur) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    if (blur) { ctx.shadowBlur = blur; ctx.shadowColor = color; }
    const L = len;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + dy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * L, cy); ctx.stroke();
    }
    ctx.restore();
  };
  const star = (cx, cy, r, color) => {
    ctx.save(); ctx.fillStyle = color; ctx.shadowBlur = r * 2; ctx.shadowColor = color; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; const rr = i % 2 ? r * 0.3 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.fill(); ctx.restore();
  };
  const lin = (stops, x0 = x, y0 = y + h, x1 = x + w, y1 = y) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  };
  const m = Math.min(w, h);
  switch (id) {
    case 'glow': stroke(lin(['#7dd3fc', '#e9d5ff', '#fda4af']), lw, lw * 5, 'rgba(244,114,182,.85)'); break;
    case 'neon': stroke('#ff4d8d', lw, lw * 6, '#ff4d8d'); break;
    case 'white': stroke('#fff', lw, lw * 2, 'rgba(0,0,0,.35)'); break;
    case 'gold':
      stroke(lin(['#8a5a00', '#ffe27a', '#b87900', '#fff1b0']), lw * 0.6, 0);
      corners(m * 0.12, lw * 1.6, '#f5c542', lw * 2);
      break;
    case 'hud':
      stroke('rgba(0,229,255,.35)', lw * 0.4, 0);
      corners(m * 0.1, lw * 1.2, '#00e5ff', lw * 3);
      ctx.save(); ctx.fillStyle = '#00e5ff';
      for (let i = 1; i < 10; i++) ctx.fillRect(x + (w * i) / 10 - lw * 0.2, y + h - lw * 2.2, lw * 0.4, lw * 1.4);
      ctx.restore();
      break;
    case 'rgb': {
      const g = ctx.createConicGradient ? ctx.createConicGradient(t * 1.5, x + w / 2, y + h / 2) : null;
      if (g) { ['#ff004c', '#ffb300', '#3dff6e', '#00c8ff', '#b300ff', '#ff004c'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c)); stroke(g, lw * 1.1, lw * 4, 'rgba(180,120,255,.8)'); } else stroke('#b300ff', lw, lw * 4, '#b300ff');
      break;
    }
    case 'cyber': {
      stroke('#ff2fb2', lw * 0.9, lw * 4, '#ff2fb2');
      // เส้นในสีฟ้า: ย่อรูปทรงเดิมเข้ามา (path ถูกเก็บตามพิกัดที่แปลงแล้ว ตอน stroke จึงได้เส้นหนาปกติ)
      const cx = x + w / 2, cy = y + h / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(1 - (lw * 4.4) / w, 1 - (lw * 4.4) / h); ctx.translate(-cx, -cy);
      path(ctx);
      ctx.restore();
      ctx.save(); ctx.strokeStyle = '#2fe3ff'; ctx.lineWidth = lw * 0.5; ctx.shadowBlur = lw * 3; ctx.shadowColor = '#2fe3ff';
      ctx.stroke(); ctx.restore();
      break;
    }
    case 'pastel':
      stroke(lin(['#c4b5fd', '#f9a8d4', '#a5b4fc']), lw, lw * 3, 'rgba(196,181,253,.8)');
      for (const [sx, sy, k] of [[x + lw * 3, y + lw * 3, 1], [x + w - lw * 3, y + lw * 3, .7], [x + lw * 3, y + h - lw * 3, .7], [x + w - lw * 3, y + h - lw * 3, 1]]) star(sx, sy, lw * 2.4 * (0.85 + 0.15 * Math.sin(t * 3 + sx)) * k, '#fff');
      break;
    case 'fire': {
      const flick = 0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 5.3);
      stroke(lin(['#ff3d00', '#ffb300', '#ff6a00'], x, y + h, x, y), lw * 1.1, lw * 6 * flick, 'rgba(255,110,0,.9)');
      break;
    }
    case 'lime':
      stroke('rgba(163,230,53,.5)', lw * 0.5, 0);
      corners(m * 0.16, lw * 1.4, '#a3e635', lw * 4);
      break;
  }
}

// ---------- รายการปรับบิวตี้ (แบบแผงของ TikTok LIVE Studio) ----------
// min < 0 = ปรับได้สองทาง (เช่น คางสั้น ↔ ยาว) · face: true = ต้องจับใบหน้า
const BEAUTY_GROUPS = [
  { id: 'skin', name: 'ความงาม', items: [
    { key: 'smooth', label: 'ผิวเนียน', icon: '💧', fx: true },
    { key: 'foundation', label: 'รองพื้น', icon: '🧴' },
    { key: 'glow', label: 'ผิวสว่าง', icon: '✨', fx: true },
    { key: 'teeth', label: 'ฟันขาว', icon: '🦷', face: true },
    { key: 'eyeBright', label: 'ตาสว่าง', icon: '👁️', face: true },
    { key: 'underEye', label: 'ลบถุงใต้ตา', icon: '🌙', face: true },
    { key: 'folds', label: 'ลดร่องแก้ม', icon: '〰️', face: true },
    { key: 'contour', label: 'คอนทัวร์', icon: '🌗', face: true },
    { key: 'highlight', label: 'ไฮไลต์', icon: '💡', face: true },
  ] },
  { id: 'shape', name: 'รูปหน้า', items: [
    { key: 'slim', label: 'หน้าเรียว', icon: '🙂', face: true },
    { key: 'vshape', label: 'หน้าวี', icon: '🔻', face: true },
    { key: 'small', label: 'หน้าเล็ก', icon: '🤏', face: true },
    { key: 'cheekbone', label: 'โหนกแก้ม', icon: '◐', face: true },
    { key: 'jaw', label: 'กราม', icon: '🦴', face: true },
    { key: 'chin', label: 'คาง', icon: '⤓', face: true, min: -100 },
    { key: 'forehead', label: 'หน้าผาก', icon: '⤒', face: true, min: -100 },
  ] },
  { id: 'features', name: 'ตา·จมูก·ปาก', items: [
    { key: 'eyeSize', label: 'ตาโต', icon: '👀', face: true },
    { key: 'eyeDist', label: 'ระยะห่างตา', icon: '↔️', face: true, min: -100 },
    { key: 'eyeTilt', label: 'หางตา', icon: '↗️', face: true, min: -100 },
    { key: 'noseNarrow', label: 'จมูกเล็ก', icon: '👃', face: true },
    { key: 'noseLength', label: 'ความยาวจมูก', icon: '↕️', face: true, min: -100 },
    { key: 'mouthSize', label: 'ขนาดปาก', icon: '👄', face: true, min: -100 },
    { key: 'smile', label: 'มุมปากยิ้ม', icon: '😊', face: true },
    { key: 'browHeight', label: 'ความสูงคิ้ว', icon: '〽️', face: true, min: -100 },
  ] },
  { id: 'makeup', name: 'แต่งหน้า', items: [
    { key: 'lip', label: 'ลิปสติก', icon: '💄', face: true, colors: 'lipColor' },
    { key: 'blush', label: 'บลัชออน', icon: '🌸', face: true, colors: 'blushColor' },
  ] },
];
const LIP_COLORS = ['#d6284f', '#e2566e', '#c0392b', '#b5476b', '#ff6f91', '#8e2440'];
const BLUSH_COLORS = ['#ff7fa6', '#ff9a8b', '#f78fb3', '#e98a6a', '#ff6b81'];
const FACE_KEYS = BEAUTY_GROUPS.flatMap((g) => g.items).filter((i) => i.face).map((i) => i.key);

// สไตล์สำเร็จรูป (ค่าที่ไม่ได้ระบุ = 0)
const BEAUTY_STYLES = {
  natural: { name: 'ธรรมชาติ', v: { smooth: 40, foundation: 20, glow: 15, slim: 15, eyeSize: 10, teeth: 20, underEye: 30 } },
  sweet: { name: 'หวานใส', v: { smooth: 55, foundation: 35, glow: 25, slim: 30, vshape: 20, eyeSize: 25, noseNarrow: 20, lip: 35, blush: 35, teeth: 30, eyeBright: 30, underEye: 40 } },
  korean: { name: 'เกาหลี', v: { smooth: 60, foundation: 45, glow: 28, slim: 35, vshape: 30, small: 15, eyeSize: 20, noseNarrow: 25, lip: 25, blush: 20, underEye: 50, highlight: 30 } },
  sharp: { name: 'หล่อคม', v: { smooth: 35, foundation: 15, jaw: 20, contour: 40, highlight: 25, noseNarrow: 15, eyeBright: 25, teeth: 25, underEye: 35 } },
};

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// แปลงค่าบิวตี้ + จุดบนใบหน้า → ค่าที่ส่งให้ shader (พิกัด texture 0–1 ของภาพกล้อง, รัศมีหน่วย = ความสูงภาพ)
function buildFaceFx(face, video, cfg) {
  if (!face) return null;
  const v = (k) => (cfg[k] || 0) / 100;
  const aspect = video.videoWidth / video.videoHeight;
  const P = face;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const add = (a, d, k) => ({ x: a.x + d.x * k, y: a.y + d.y * k });
  const dH = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const faceW = dH(P.l, P.r);
  // ทิศ "ขึ้น" ของหัว (ในพิกัด texture) จากคาง → หน้าผาก
  const upA = { x: (P.top.x - P.chin.x) * aspect, y: P.top.y - P.chin.y };
  const upLen = Math.hypot(upA.x, upA.y) || 1;
  const up = { x: upA.x / upLen / aspect, y: upA.y / upLen }; // ยาว 1 หน่วยความสูง
  const eyeCL = mid(P.lEyeO, P.lEyeI);
  const eyeCR = mid(P.rEyeO, P.rEyeI);
  const eyeW = dH(P.lEyeO, P.lEyeI);
  const noseW = dH(P.noseL, P.noseR);
  const mouthW = dH(P.mL, P.mR);
  const mouthC = mid(P.mT, P.mB);

  const warps = [];
  const push = (c, m, r) => warps.push({ c, m, r }); // ดัน c → m
  const zoom = (c, s, r) => warps.push({ c, s, r }); // s > 0 ขยาย, s < 0 ย่อ
  const toward = (c, target, k) => lerp(c, target, k);

  if (v('slim')) for (const c of [mid(P.lMid, P.lJaw), mid(P.rMid, P.rJaw)]) push(c, { x: toward(c, P.nose, 0.2 * v('slim')).x, y: c.y + (P.nose.y - c.y) * 0.08 * v('slim') }, faceW * 0.42);
  if (v('vshape')) for (const c of [P.lJaw, P.rJaw]) push(c, toward(c, P.chin, 0.28 * v('vshape')), faceW * 0.3);
  if (v('jaw')) for (const c of [P.lJaw2, P.rJaw2]) push(c, toward(c, P.nose, 0.15 * v('jaw')), faceW * 0.26);
  if (v('cheekbone')) for (const c of [P.l, P.r]) push(c, toward(c, P.nose, 0.08 * v('cheekbone')), faceW * 0.3);
  if (v('small')) zoom(P.nose, -0.12 * v('small'), faceW * 0.8);
  if (v('chin')) push(P.chin, add(P.chin, up, -faceW * 0.12 * v('chin')), faceW * 0.3);
  if (v('forehead')) push(P.top, add(P.top, up, faceW * 0.1 * v('forehead')), faceW * 0.45);
  if (v('eyeSize')) for (const c of [eyeCL, eyeCR]) zoom(c, 0.28 * v('eyeSize'), eyeW * 1.15);
  if (v('eyeDist')) {
    push(eyeCL, lerp(eyeCL, eyeCR, -0.07 * v('eyeDist')), eyeW * 1.4);
    push(eyeCR, lerp(eyeCR, eyeCL, -0.07 * v('eyeDist')), eyeW * 1.4);
  }
  if (v('eyeTilt')) for (const c of [P.lEyeO, P.rEyeO]) push(c, add(c, up, eyeW * 0.22 * v('eyeTilt')), eyeW * 0.8);
  if (v('noseNarrow')) {
    for (const c of [P.noseL, P.noseR]) push(c, toward(c, P.nose, 0.3 * v('noseNarrow')), noseW * 0.6);
    zoom(P.nose, -0.12 * v('noseNarrow'), noseW * 0.55);
  }
  if (v('noseLength')) push(P.nose, add(P.nose, up, -noseW * 0.25 * v('noseLength')), noseW * 0.9);
  if (v('mouthSize')) zoom(mouthC, 0.22 * v('mouthSize'), mouthW * 0.75);
  if (v('smile')) for (const c of [P.mL, P.mR]) push(c, add(c, up, mouthW * 0.08 * v('smile')), mouthW * 0.35);
  if (v('browHeight')) for (const c of [P.lBrow, P.rBrow]) push(c, add(c, up, faceW * 0.04 * v('browHeight')), faceW * 0.2);

  // บริเวณรีทัช (เนียนขึ้น/สว่างขึ้น/เงา)
  const regions = [];
  const region = (c, r, smooth, bright) => regions.push({ c, r, smooth, bright });
  if (v('underEye')) for (const c of [eyeCL, eyeCR]) region(add(c, up, -eyeW * 0.75), eyeW * 1.05, 0.7 * v('underEye'), 0.45 * v('underEye'));
  if (v('folds')) for (const [n, m] of [[P.noseL, P.mL], [P.noseR, P.mR]]) region(mid(n, m), mouthW * 0.38, 0.8 * v('folds'), 0.2 * v('folds'));
  if (v('contour')) for (const [a, b] of [[P.lCheek, P.lJaw], [P.rCheek, P.rJaw]]) region(lerp(a, b, 0.55), faceW * 0.2, 0, -0.55 * v('contour'));
  if (v('highlight')) {
    region(P.bridge, noseW * 0.8, 0, 0.5 * v('highlight'));
    region(lerp(P.top, P.bridge, 0.35), faceW * 0.2, 0, 0.35 * v('highlight'));
  }

  // ปาก: วงรีรอบริมฝีปาก (นอก) และช่องปาก (ใน) หน่วยพิกัด texture
  const mx = Math.abs(P.mR.x - P.mL.x) / 2;
  const mouthO = [ (P.lipT.x + P.lipB.x) / 2, (P.lipT.y + P.lipB.y) / 2, mx * 1.08, Math.abs(P.lipB.y - P.lipT.y) / 2 * 1.2 ];
  const mouthI = [ mouthC.x, mouthC.y, mx * 0.82, Math.max(Math.abs(P.mB.y - P.mT.y) / 2 * 1.25, 0.002) ];
  const cheekL = lerp(P.lCheek, P.l, 0.25);
  const cheekR = lerp(P.rCheek, P.r, 0.25);
  return {
    warps,
    regions,
    foundation: v('foundation'),
    teeth: v('teeth'),
    eyeBright: v('eyeBright'),
    lipAmt: v('lip'),
    blushAmt: v('blush'),
    lipCol: hexRgb(cfg.lipColor || LIP_COLORS[0]),
    blushCol: hexRgb(cfg.blushColor || BLUSH_COLORS[0]),
    mouthO,
    mouthI,
    eyeL: [eyeCL.x, eyeCL.y, eyeW * 0.85],
    eyeR: [eyeCR.x, eyeCR.y, eyeW * 0.85],
    cheeks: [cheekL.x, cheekL.y, cheekR.x, cheekR.y],
    cheekR: faceW * 0.17,
  };
}

// ---------- สติกเกอร์ (วาดเองเป็น SVG) ----------
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}">${body}</svg>`;
const STICKERS = {
  bunny: {
    name: '🐰 หูกระต่าย', anchor: 'top', width: 1.25, lift: 0.08,
    svg: svg(260, 230, `
      <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#f1f1f4"/></linearGradient></defs>
      <g transform="rotate(-14 80 220)"><ellipse cx="80" cy="115" rx="38" ry="105" fill="url(#f)" stroke="#e7e2ea" stroke-width="3"/><ellipse cx="80" cy="125" rx="20" ry="80" fill="#ffb3c7"/></g>
      <g transform="rotate(14 180 220)"><ellipse cx="180" cy="115" rx="38" ry="105" fill="url(#f)" stroke="#e7e2ea" stroke-width="3"/><ellipse cx="180" cy="125" rx="20" ry="80" fill="#ffb3c7"/></g>
      <path d="M40 222 Q130 196 220 222" stroke="#ff8fb1" stroke-width="12" fill="none" stroke-linecap="round"/>`),
  },
  devil: {
    name: '😈 เขาปีศาจ', anchor: 'top', width: 1.15, lift: 0.02,
    svg: svg(260, 150, `
      <defs>
        <linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#7a0010"/><stop offset=".55" stop-color="#e0112b"/><stop offset="1" stop-color="#ff5a4f"/></linearGradient>
        <filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g filter="url(#g)">
        <path d="M58 145 C40 100 36 55 64 12 C66 60 90 95 104 140 Z" fill="url(#h)" stroke="#4a0008" stroke-width="3"/>
        <path d="M202 145 C220 100 224 55 196 12 C194 60 170 95 156 140 Z" fill="url(#h)" stroke="#4a0008" stroke-width="3"/>
        <path d="M64 30 C60 60 70 95 88 132" stroke="#ff9a8a" stroke-width="4" fill="none" opacity=".6"/>
        <path d="M196 30 C200 60 190 95 172 132" stroke="#ff9a8a" stroke-width="4" fill="none" opacity=".6"/>
      </g>`),
  },
  cat: {
    name: '🐱 หูแมว', anchor: 'top', width: 1.2, lift: 0.04,
    svg: svg(260, 130, `
      <path d="M30 128 L58 8 L118 104 Z" fill="#2b2b33" stroke="#15151a" stroke-width="4" stroke-linejoin="round"/>
      <path d="M52 112 L62 40 L98 100 Z" fill="#ff9fbf"/>
      <path d="M230 128 L202 8 L142 104 Z" fill="#2b2b33" stroke="#15151a" stroke-width="4" stroke-linejoin="round"/>
      <path d="M208 112 L198 40 L162 100 Z" fill="#ff9fbf"/>`),
  },
  crown: {
    name: '👑 มงกุฎ', anchor: 'top', width: 0.95, lift: 0.04,
    svg: svg(240, 150, `
      <defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".6" stop-color="#f5b400"/><stop offset="1" stop-color="#b87900"/></linearGradient></defs>
      <path d="M20 140 L12 40 L70 90 L120 12 L170 90 L228 40 L220 140 Z" fill="url(#c)" stroke="#8a5a00" stroke-width="4" stroke-linejoin="round"/>
      <rect x="20" y="118" width="200" height="22" rx="6" fill="#d99a00" stroke="#8a5a00" stroke-width="3"/>
      <circle cx="120" cy="104" r="13" fill="#e8174b"/><circle cx="66" cy="112" r="9" fill="#2f7cff"/><circle cx="174" cy="112" r="9" fill="#18c07a"/>
      <circle cx="12" cy="40" r="9" fill="#fff3b0"/><circle cx="120" cy="12" r="10" fill="#fff3b0"/><circle cx="228" cy="40" r="9" fill="#fff3b0"/>`),
  },
  hearts: {
    name: '😍 แว่นหัวใจ', anchor: 'eyes', width: 1.05, lift: 0,
    svg: svg(260, 110, `
      <path d="M70 100 C10 64 14 14 48 14 C62 14 70 26 70 34 C70 26 78 14 92 14 C126 14 130 64 70 100 Z" fill="#ff2e7e" stroke="#b3004d" stroke-width="5" opacity=".92"/>
      <path d="M190 100 C130 64 134 14 168 14 C182 14 190 26 190 34 C190 26 198 14 212 14 C246 14 250 64 190 100 Z" fill="#ff2e7e" stroke="#b3004d" stroke-width="5" opacity=".92"/>
      <path d="M112 40 Q130 28 148 40" stroke="#b3004d" stroke-width="7" fill="none" stroke-linecap="round"/>
      <ellipse cx="48" cy="36" rx="12" ry="7" fill="#fff" opacity=".6"/><ellipse cx="168" cy="36" rx="12" ry="7" fill="#fff" opacity=".6"/>`),
  },
  blush: {
    name: '🌸 แก้มชมพู', anchor: 'cheeks', width: 0.36, lift: 0,
    svg: svg(120, 80, `
      <defs><radialGradient id="b"><stop offset="0" stop-color="#ff5c8a" stop-opacity=".75"/><stop offset="1" stop-color="#ff5c8a" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="60" cy="40" rx="58" ry="36" fill="url(#b)"/>
      <path d="M40 34 l6 10 M56 30 l6 10 M72 34 l6 10" stroke="#ff3d73" stroke-width="4" stroke-linecap="round" opacity=".7"/>`),
  },
};

const stickerImages = {};
function stickerImage(id) {
  if (!stickerImages[id]) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(STICKERS[id].svg);
    stickerImages[id] = img;
  }
  return stickerImages[id];
}

// วาดสติกเกอร์บน ctx · map(p) = แปลงจุด 0–1 ของภาพกล้อง → พิกัดบน canvas ไลฟ์
function drawSticker(ctx, id, face, map) {
  const st = STICKERS[id];
  if (!st || !face) return;
  const img = stickerImage(id);
  if (!img.complete || !img.naturalWidth) return;
  const P = {};
  for (const k of Object.keys(face)) P[k] = map(face[k]);
  const faceW = Math.hypot(P.r.x - P.l.x, P.r.y - P.l.y);
  // มุมเอียงหัว จากตาซ้าย → ตาขวา (บนจอ) และทิศ "ขึ้น" ของหัว
  const eyeL = { x: (P.lEyeO.x + P.lEyeI.x) / 2, y: (P.lEyeO.y + P.lEyeI.y) / 2 };
  const eyeR = { x: (P.rEyeO.x + P.rEyeI.x) / 2, y: (P.rEyeO.y + P.rEyeI.y) / 2 };
  let angle = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  if (eyeR.x < eyeL.x) angle += Math.PI; // ภาพกลับด้านกระจก
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };
  const w = faceW * st.width;
  const h = w * (img.naturalHeight / img.naturalWidth);
  const place = (cx, cy, ww, hh, bottomAnchored) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(img, -ww / 2, bottomAnchored ? -hh : -hh / 2, ww, hh);
    ctx.restore();
  };
  if (st.anchor === 'top') {
    const lift = faceW * st.lift;
    place(P.top.x + up.x * lift, P.top.y + up.y * lift, w, h, true);
  } else if (st.anchor === 'eyes') {
    place((eyeL.x + eyeR.x) / 2, (eyeL.y + eyeR.y) / 2, w, h, false);
  } else if (st.anchor === 'cheeks') {
    place(P.lCheek.x, P.lCheek.y, w, h, false);
    place(P.rCheek.x, P.rCheek.y, w, h, false);
  }
}
