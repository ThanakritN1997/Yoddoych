// ---------- ฉาก (Scenes) ----------
// ฉาก = การจัดวางเลเยอร์ (แสดง/ซ่อน ตำแหน่ง ขนาด ลำดับ) + ฉากหลังสำเร็จรูป (เริ่มเร็ว ๆ นี้/พักเดี๋ยวมา/จบไลฟ์) + ปิดไมค์หรือไม่
// แก้เลเยอร์ระหว่างอยู่ฉากไหน → จำไว้ในฉากนั้น · กด 1–9 สลับฉาก · สลับแบบเฟดนุ่ม ๆ
const CARD_STYLES = {
  soon: { name: 'เริ่มเร็ว ๆ นี้', c: ['#2a1060', '#7c5cff', '#ff4d8d'], emoji: '⏳', title: 'กำลังจะเริ่มไลฟ์', sub: 'รอสักครู่นะ กดติดตามไว้ได้เลย' },
  brb: { name: 'พักเดี๋ยวมา', c: ['#062a33', '#0e7490', '#22d3ee'], emoji: '☕', title: 'พักแป๊บ เดี๋ยวมา', sub: 'อย่าเพิ่งไปไหนนะ' },
  end: { name: 'จบไลฟ์', c: ['#3a0d1f', '#f97316', '#ff4d8d'], emoji: '❤️', title: 'ขอบคุณที่รับชม', sub: 'แล้วพบกันใหม่ไลฟ์หน้า' },
  plain: { name: 'ข้อความเรียบ ๆ', c: ['#0b0d12', '#1e2330', '#323a49'], emoji: '', title: 'Yoddoy Live', sub: '' },
};
const sid = () => 's' + Math.random().toString(36).slice(2, 9);
const DEFAULT_SCENES = () => [
  { id: sid(), name: 'ไลฟ์หลัก', card: null, muteMic: false, layout: {} },
  { id: sid(), name: 'เริ่มเร็ว ๆ นี้', card: { style: 'soon', title: CARD_STYLES.soon.title, sub: CARD_STYLES.soon.sub, countdown: 5, autoNext: true }, muteMic: true, layout: {} },
  { id: sid(), name: 'พักเดี๋ยวมา', card: { style: 'brb', title: CARD_STYLES.brb.title, sub: CARD_STYLES.brb.sub, countdown: 0 }, muteMic: true, layout: {} },
  { id: sid(), name: 'จบไลฟ์', card: { style: 'end', title: CARD_STYLES.end.title, sub: CARD_STYLES.end.sub, countdown: 0 }, muteMic: false, layout: {} },
];
const sceneState = Object.assign({ list: null, active: null, trans: 400 }, store.get('scenes', {}));
if (!Array.isArray(sceneState.list) || !sceneState.list.length) sceneState.list = DEFAULT_SCENES();
if (!sceneState.list.some((s) => s.id === sceneState.active)) sceneState.active = sceneState.list[0].id;
const curScene = () => sceneState.list.find((s) => s.id === sceneState.active);
const saveScenes = () => store.set('scenes', sceneState);

const lid = (l) => l.uid || l.sid;
const SNAP_KEYS = ['visible', 'x', 'y', 'w', 'pa', 'preset', 'opacity', 'shape', 'frame', 'camAspect', 'userFit'];
let sceneApplying = false;
let sceneStartAt = performance.now();

// เก็บสภาพเลเยอร์ตอนนี้ลงฉากปัจจุบัน (เรียกจาก saveLayout)
function sceneCapture() {
  if (sceneApplying) return;
  const s = curScene();
  const live = new Set();
  layers.forEach((l, order) => {
    const id = lid(l);
    live.add(id);
    const e = { order };
    for (const k of SNAP_KEYS) e[k] = l[k] ?? null;
    s.layout[id] = e;
  });
  // ลบเลเยอร์ URL ที่ปิดไปแล้ว (มีแค่รอบนี้) · เลเยอร์อื่นเก็บไว้ เผื่อเปิดกล้อง/จอใหม่ภายหลัง
  for (const id of Object.keys(s.layout)) if (id.startsWith('w:') && !live.has(id)) delete s.layout[id];
  saveScenes();
}

function applyEntry(l, e) {
  for (const k of SNAP_KEYS) if (e[k] !== null && e[k] !== undefined) l[k] = e[k];
  if (l.preset && hasContent(l) && (l.kind === 'image' || l.video?.videoWidth)) applyPreset(l, l.preset);
}

// ใช้ฉากกับเลเยอร์เดียว (ตอนเปิดกล้อง/จอ หรือโหลดรูปกลับมา)
// userAdded = ผู้ใช้เพิ่งเปิดเอง → ถ้าฉากนี้ยังไม่เคยจำเลเยอร์นี้ ให้แสดงและจำไว้
function sceneApplyLayer(l, userAdded) {
  const s = curScene();
  const e = s.layout[lid(l)];
  sceneApplying = true;
  if (e) applyEntry(l, e);
  else if (!userAdded && s.card) l.visible = false;
  sceneApplying = false;
  if (!e && userAdded) sceneCapture();
}

// ---------- เปลี่ยนฉาก ----------
const transCanvas = document.createElement('canvas');
const transCtx = transCanvas.getContext('2d');
let transStart = 0;
let transMs = 0;
function switchScene(id, opts = {}) {
  const next = sceneState.list.find((s) => s.id === id);
  if (!next) return;
  if (next.id === sceneState.active && !opts.force) return;
  // ภาพเฟรมสุดท้ายของฉากเดิม → ค่อย ๆ จางออกทับฉากใหม่
  if (sceneState.trans > 0 && !opts.instant) {
    transCanvas.width = canvas.width;
    transCanvas.height = canvas.height;
    transCtx.drawImage(canvas, 0, 0);
    transStart = performance.now();
    transMs = sceneState.trans;
  }
  sceneState.active = next.id;
  sceneStartAt = performance.now();
  sceneApplying = true;
  for (const l of layers) {
    const e = next.layout[lid(l)];
    if (e) applyEntry(l, e);
    else if (next.card) l.visible = false;
  }
  layers.sort((a, b) => (next.layout[lid(a)]?.order ?? layers.indexOf(a)) - (next.layout[lid(b)]?.order ?? layers.indexOf(b)));
  sceneApplying = false;
  sceneCapture();
  saveLayout();
  if (typeof setSceneMicMute === 'function') setSceneMicMute(next.muteMic);
  renderLayerPanel();
  renderScenes();
}

function drawTransition() {
  if (!transMs) return;
  const t = (performance.now() - transStart) / transMs;
  if (t >= 1 || transCanvas.width !== canvas.width || transCanvas.height !== canvas.height) {
    transMs = 0;
    return;
  }
  ctx2d.save();
  ctx2d.globalAlpha = 1 - t * t * (3 - 2 * t); // smoothstep
  ctx2d.drawImage(transCanvas, 0, 0);
  ctx2d.restore();
}

// ---------- ฉากหลังสำเร็จรูป ----------
function countdownLeft(s) {
  if (!s.card?.countdown) return null;
  return Math.max(0, s.card.countdown * 60 - (performance.now() - sceneStartAt) / 1000);
}
let autoNextFired = null;
function drawSceneCard(W, H) {
  const s = curScene();
  const card = s.card;
  if (!card) return;
  const st = CARD_STYLES[card.style] || CARD_STYLES.plain;
  const now = performance.now() / 1000;
  const g = ctx2d;
  const m = Math.min(W, H);

  // พื้นหลังไล่สีที่ค่อย ๆ หมุน
  const a = now * 0.25;
  const gr = g.createLinearGradient(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H, W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H);
  gr.addColorStop(0, st.c[0]);
  gr.addColorStop(0.55, st.c[1]);
  gr.addColorStop(1, st.c[2]);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // วงกลมฟุ้ง ๆ ลอยช้า ๆ
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    const x = W * (0.5 + 0.42 * Math.sin(now * 0.13 * (1 + i * 0.17) + i * 2.1));
    const y = H * (0.5 + 0.42 * Math.cos(now * 0.11 * (1 + i * 0.13) + i * 1.3));
    const r = m * (0.18 + 0.08 * Math.sin(i * 3.7));
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,.16)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  // จบไลฟ์: หัวใจลอยขึ้น
  if (card.style === 'end') {
    g.save();
    g.font = `${Math.round(m * 0.05)}px ${UI_FONT}`;
    g.textAlign = 'center';
    for (let i = 0; i < 14; i++) {
      const p = (now * 0.08 + i / 14) % 1;
      g.globalAlpha = Math.sin(p * Math.PI) * 0.7;
      g.fillText('❤', W * ((i * 0.618) % 1), H * (1.05 - p * 1.1) );
    }
    g.restore();
  }

  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = m * 0.02;
  g.fillStyle = '#fff';
  let y = H * 0.4;
  if (st.emoji) {
    g.font = `${Math.round(m * 0.11)}px ${UI_FONT}`;
    g.fillText(st.emoji, W / 2, y - m * 0.15 + Math.sin(now * 2.4) * m * 0.012);
  }
  g.font = `800 ${Math.round(m * 0.085)}px ${UI_FONT}`;
  g.fillText(card.title || '', W / 2, y, W * 0.9);
  if (card.sub) {
    g.globalAlpha = 0.85;
    g.font = `500 ${Math.round(m * 0.04)}px ${UI_FONT}`;
    g.fillText(card.sub, W / 2, y + m * 0.085, W * 0.9);
    g.globalAlpha = 1;
  }
  const left = countdownLeft(s);
  if (left !== null) {
    const text = left > 0 ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'เริ่มแล้ว!';
    const cy = y + m * 0.22;
    g.font = `800 ${Math.round(m * 0.1)}px ${UI_FONT}`;
    const tw = Math.max(g.measureText('00:00').width, g.measureText(text).width) + m * 0.08;
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath();
    g.roundRect(W / 2 - tw / 2, cy - m * 0.075, tw, m * 0.15, m * 0.04);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(text, W / 2, cy + m * 0.004);
    // หมดเวลา → ไปฉากถัดไปเอง (ฉากแรกที่ไม่มีฉากหลังสำเร็จรูป)
    if (left <= 0 && card.autoNext && autoNextFired !== sceneStartAt) {
      autoNextFired = sceneStartAt;
      const main = sceneState.list.find((x) => !x.card);
      if (main) setTimeout(() => switchScene(main.id), 1200);
    }
  }
  g.restore();
}

// ---------- หน้าตาแผงฉาก ----------
const sceneThumbs = {}; // id → canvas (ภาพย่อ ไม่บันทึก)
function renderScenes() {
  const grid = $('sceneGrid');
  grid.innerHTML = '';
  sceneState.list.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'scene-btn' + (s.id === sceneState.active ? ' active' : '');
    const th = sceneThumbs[s.id] || (sceneThumbs[s.id] = document.createElement('canvas'));
    th.className = 'scene-thumb';
    b.append(th);
    const label = document.createElement('span');
    label.className = 'scene-label';
    label.innerHTML = `${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}<span></span>${s.muteMic ? '<em title="ปิดไมค์ในฉากนี้">🔇</em>' : ''}`;
    label.querySelector('span').textContent = s.name;
    b.append(label);
    if (!th.width) paintThumbPlaceholder(th, s);
    b.onclick = () => switchScene(s.id);
    grid.append(b);
  });
  renderSceneEditor();
}
function paintThumbPlaceholder(th, s) {
  th.width = 160;
  th.height = 90;
  const g = th.getContext('2d');
  const st = s.card && (CARD_STYLES[s.card.style] || CARD_STYLES.plain);
  const gr = g.createLinearGradient(0, 0, 160, 90);
  gr.addColorStop(0, st ? st.c[0] : '#0e1117');
  gr.addColorStop(1, st ? st.c[2] : '#1e2330');
  g.fillStyle = gr;
  g.fillRect(0, 0, 160, 90);
  g.font = '28px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(st ? st.emoji || '🖼️' : '🎬', 80, 45);
}
// ภาพย่อของฉากที่เปิดอยู่: อัปเดตทุก 1 วินาที
setInterval(() => {
  const th = sceneThumbs[sceneState.active];
  if (!th || document.hidden || $('sceneGrid').closest('[hidden]')) return;
  const h = Math.round((160 * canvas.height) / canvas.width);
  if (th.width !== 160 || th.height !== h) Object.assign(th, { width: 160, height: h });
  th.getContext('2d').drawImage(canvas, 0, 0, 160, h);
}, 1000);

function renderSceneEditor() {
  const s = curScene();
  $('sceneEditName').textContent = s.name;
  $('sceneName').value = s.name;
  $('sceneCardStyle').value = s.card ? s.card.style : '';
  $('sceneCardBox').hidden = !s.card;
  if (s.card) {
    $('sceneTitle').value = s.card.title || '';
    $('sceneSub').value = s.card.sub || '';
    $('sceneCountdown').value = s.card.countdown || 0;
    $('sceneAutoNext').checked = !!s.card.autoNext;
    $('sceneAutoNextRow').hidden = !s.card.countdown;
  }
  $('sceneMuteMic').checked = !!s.muteMic;
  $('sceneDelete').disabled = sceneState.list.length <= 1;
  $('sceneTrans').value = String(sceneState.trans);
}

const editScene = (fn) => {
  fn(curScene());
  saveScenes();
  renderScenes();
};
$('sceneName').oninput = () => {
  curScene().name = $('sceneName').value.slice(0, 30) || 'ฉาก';
  saveScenes();
  // ไม่วาดแผงใหม่ทั้งหมด (ช่องพิมพ์จะหลุดโฟกัส) — แก้แค่ชื่อบนปุ่ม
  const i = sceneState.list.indexOf(curScene());
  const el = $('sceneGrid').children[i]?.querySelector('.scene-label span');
  if (el) el.textContent = curScene().name;
  $('sceneEditName').textContent = curScene().name;
};
$('sceneCardStyle').onchange = () => editScene((s) => {
  const style = $('sceneCardStyle').value;
  if (!style) s.card = null;
  else {
    const st = CARD_STYLES[style];
    const old = s.card;
    const keepText = old && (old.title !== CARD_STYLES[old.style]?.title);
    s.card = { style, title: keepText ? old.title : st.title, sub: keepText ? old.sub : st.sub, countdown: old?.countdown || 0, autoNext: old?.autoNext || false };
  }
  sceneStartAt = performance.now();
  delete sceneThumbs[s.id];
});
$('sceneTitle').oninput = () => { curScene().card.title = $('sceneTitle').value; saveScenes(); };
$('sceneSub').oninput = () => { curScene().card.sub = $('sceneSub').value; saveScenes(); };
$('sceneCountdown').onchange = () => editScene((s) => {
  s.card.countdown = Math.min(180, Math.max(0, Math.round(+$('sceneCountdown').value || 0)));
  sceneStartAt = performance.now();
});
$('sceneAutoNext').onchange = () => editScene((s) => (s.card.autoNext = $('sceneAutoNext').checked));
$('sceneRestart').onclick = () => { sceneStartAt = performance.now(); autoNextFired = null; };
$('sceneMuteMic').onchange = () => {
  editScene((s) => (s.muteMic = $('sceneMuteMic').checked));
  if (typeof setSceneMicMute === 'function') setSceneMicMute(curScene().muteMic);
};
$('sceneTrans').onchange = () => { sceneState.trans = +$('sceneTrans').value; saveScenes(); };
$('sceneAdd').onclick = () => {
  const cur = curScene();
  const s = { id: sid(), name: 'ฉาก ' + (sceneState.list.length + 1), card: null, muteMic: false, layout: JSON.parse(JSON.stringify(cur.layout)) };
  sceneState.list.push(s);
  saveScenes();
  switchScene(s.id, { instant: true });
  $('sceneEdit').open = true;
  $('sceneName').select();
};
$('sceneDelete').onclick = () => {
  if (sceneState.list.length <= 1) return;
  const s = curScene();
  if (!confirm(`ลบฉาก “${s.name}” ?`)) return;
  const i = sceneState.list.indexOf(s);
  sceneState.list.splice(i, 1);
  delete sceneThumbs[s.id];
  switchScene(sceneState.list[Math.max(0, i - 1)].id, { force: true });
};

// คีย์ลัด 1–9 = สลับฉาก
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  const n = e.key >= '1' && e.key <= '9' ? +e.key - 1 : -1;
  if (n < 0 || !sceneState.list[n]) return;
  e.preventDefault();
  switchScene(sceneState.list[n].id);
});

renderScenes();
if (typeof setSceneMicMute === 'function') setSceneMicMute(curScene().muteMic);
