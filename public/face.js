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
