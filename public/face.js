// จับใบหน้า (MediaPipe Face Landmarker) → หน้าเรียว + สติกเกอร์ติดหน้า
// โหลดโมเดลเฉพาะตอนเปิดใช้ (≈ 10 MB ครั้งแรก แล้วเบราว์เซอร์แคชไว้)
const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// จุดบนใบหน้าที่ใช้ (ดัชนีของ MediaPipe face mesh 468 จุด) · ซ้าย/ขวา = ซ้าย/ขวาของภาพกล้อง
const LM = { top: 10, chin: 152, nose: 1, l: 234, r: 454, lEyeO: 33, lEyeI: 133, rEyeO: 263, rEyeI: 362, lCheek: 50, rCheek: 280, lJaw: 172, rJaw: 397, lMid: 132, rMid: 361 };

class FaceTracker {
  constructor() {
    this.state = 'off'; // off | loading | ready | error
    this.face = null; // จุดบนใบหน้าล่าสุด (ทำให้นิ่งแล้ว) พิกัด 0–1 ของภาพกล้อง
    this.lastTime = -1;
    this.missed = 0;
  }

  async load() {
    if (this.state !== 'off' && this.state !== 'error') return this.ready;
    this.state = 'loading';
    this.ready = (async () => {
      const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const make = (delegate) => vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      try {
        this.landmarker = await make('GPU');
      } catch {
        this.landmarker = await make('CPU'); // การ์ดจอบางรุ่นใช้ GPU delegate ไม่ได้
      }
      this.state = 'ready';
    })().catch((e) => {
      this.state = 'error';
      this.error = e;
      throw e;
    });
    return this.ready;
  }

  // เรียกทุกเฟรม: คืนจุดบนใบหน้า หรือ null ถ้าไม่เจอหน้า
  update(video) {
    if (this.state !== 'ready' || !video.videoWidth) return this.face;
    if (video.currentTime === this.lastTime) return this.face; // เฟรมเดิม ไม่ต้องตรวจซ้ำ
    this.lastTime = video.currentTime;
    let res;
    try {
      res = this.landmarker.detectForVideo(video, performance.now());
    } catch {
      return this.face;
    }
    const pts = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!pts) {
      if (++this.missed > 5) this.face = null; // หายไปหลายเฟรม → เลิกวาด
      return this.face;
    }
    this.missed = 0;
    // ทำให้นิ่ง: ผสมกับตำแหน่งเดิม (กันสติกเกอร์สั่น)
    const next = {};
    for (const [k, i] of Object.entries(LM)) {
      const p = pts[i];
      const prev = this.face && this.face[k];
      next[k] = prev ? { x: prev.x + (p.x - prev.x) * 0.55, y: prev.y + (p.y - prev.y) * 0.55 } : { x: p.x, y: p.y };
    }
    this.face = next;
    return next;
  }
}

// ค่าที่ส่งให้ shader หน้าเรียว (พิกัด texture 0–1 ของภาพกล้อง)
function slimWarp(face, video, amount) {
  if (!face || amount <= 0) return null;
  const aspect = video.videoWidth / video.videoHeight;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const c1 = mid(face.lMid, face.lJaw);
  const c2 = mid(face.rMid, face.rJaw);
  const k = 0.2 * amount; // ดึงแก้ม/กรามเข้าหาจมูก สูงสุด ~20% ของระยะ
  const toward = (c) => ({ x: c.x + (face.nose.x - c.x) * k, y: c.y + (face.nose.y - c.y) * k * 0.4 });
  const faceW = Math.hypot((face.r.x - face.l.x) * aspect, face.r.y - face.l.y); // หน่วย = ความสูงภาพ
  return { c1, m1: toward(c1), c2, m2: toward(c2), radius: faceW * 0.42, aspect };
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
