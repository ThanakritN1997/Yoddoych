// ---------- เชื่อม Restream → คุมไลฟ์ TikTok (และช่องอื่นใน Restream) จาก Yoddoy ----------
// ใช้ระบบเชื่อมต่อทางการของ Restream: ได้คีย์สตรีมอัตโนมัติ · เปิด/ปิดช่อง (เช่น TikTok) · ตั้งชื่อไลฟ์
// กด "เริ่มไลฟ์" ใน Yoddoy → ส่งภาพเข้า Restream → Restream ไลฟ์ไปทุกช่องที่เปิดไว้ · กด "หยุดไลฟ์" = หยุดทุกช่อง
const RS_SITE = 'https://yoddoych.vercel.app'; // ตัวเชื่อม Restream อยู่บนเว็บออนไลน์ (เก็บรหัสลับของแอปไว้ฝั่งเซิร์ฟเวอร์)
const RS_BASE = location.origin === RS_SITE ? '' : RS_SITE;
let rs = store.get('restream', null); // { access, refresh, exp } — เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น
let rsRefreshing = null;
let rsPlatforms = {};

function rsDisconnect(msg) {
  rs = null;
  store.set('restream', null);
  $('rsBox').hidden = true;
  $('rsConnect').hidden = false;
  $('rsStatus').textContent = msg || '';
}

// โทเคนหมดอายุทุก 1 ชม. → ต่ออายุให้เอง (ทีละครั้ง เพราะโทเคนเก่าจะใช้ไม่ได้ทันทีที่ต่ออายุ)
async function rsToken() {
  if (!rs) throw new Error('ยังไม่ได้เชื่อมต่อ Restream');
  if (Date.now() < rs.exp - 60000) return rs.access;
  rsRefreshing = rsRefreshing || (async () => {
    const r = await fetch(RS_BASE + '/oauth/restream/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: rs.refresh }) });
    if (!r.ok) {
      rsDisconnect('การเชื่อมต่อ Restream หมดอายุ — กดเชื่อมต่อใหม่');
      throw new Error('expired');
    }
    rs = await r.json();
    store.set('restream', rs);
  })().finally(() => (rsRefreshing = null));
  await rsRefreshing;
  return rs.access;
}

async function rsApi(path, method = 'GET', body) {
  const r = await fetch(RS_BASE + '/oauth/restream/api?path=' + encodeURIComponent(path), {
    method,
    headers: { Authorization: 'Bearer ' + (await rsToken()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    rsDisconnect('การเชื่อมต่อ Restream หมดอายุ — กดเชื่อมต่อใหม่');
    throw new Error('expired');
  }
  if (!r.ok) throw new Error('Restream ตอบกลับผิดพลาด (' + r.status + ')');
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ใส่คีย์สตรีมของ Restream ลงปลายทางให้อัตโนมัติ
function rsApplyKey(key) {
  let d = dests.find((x) => x.platform === 'restream');
  if (!d) {
    d = { platform: 'restream', url: PLATFORMS.restream.url, key: '', on: true };
    dests.push(d);
  }
  if (!d.url) d.url = PLATFORMS.restream.url;
  d.key = key;
  saveDests();
  renderDests();
  calc();
}

function renderRsChannels(list) {
  const box = $('rsChannels');
  box.innerHTML = '';
  if (!list.length) box.innerHTML = '<p class="muted small">ยังไม่มีช่องใน Restream — เพิ่มที่ restream.io → Add Channel</p>';
  for (const c of list) {
    const row = document.createElement('label');
    row.className = 'rs-ch' + (c.active ? ' on' : '');
    const plat = rsPlatforms[c.streamingPlatformId] || '';
    row.innerHTML = '<input type="checkbox"><span class="rs-name"></span><span class="muted small"></span>';
    row.querySelector('input').checked = !!c.active;
    row.querySelector('.rs-name').textContent = c.displayName || 'ช่อง ' + c.id;
    row.querySelector('.muted').textContent = plat;
    row.querySelector('input').onchange = async (e) => {
      const on = e.target.checked;
      try {
        await rsApi('user/channel/' + c.id, 'PATCH', { active: on });
        c.active = on;
        row.classList.toggle('on', on);
        toast(`${c.displayName || plat}: ${on ? 'เปิด — ไลฟ์ไปช่องนี้ด้วย' : 'ปิดแล้ว'}`);
      } catch (err) {
        e.target.checked = !on;
        toast('เปลี่ยนช่องไม่สำเร็จ: ' + err.message);
      }
    };
    box.append(row);
  }
}

async function rsSync() {
  if (!rs) return;
  $('rsConnect').hidden = true;
  $('rsBox').hidden = false;
  $('rsStatus').textContent = 'กำลังโหลดข้อมูลจาก Restream…';
  try {
    const [profile, channels, sk] = await Promise.all([rsApi('user/profile'), rsApi('user/channel'), rsApi('user/streamKey')]);
    try {
      const plats = await rsApi('platform/all');
      rsPlatforms = Object.fromEntries((plats || []).map((p) => [p.id, p.name]));
    } catch {}
    window.rsChannels = channels || [];
    renderRsChannels(window.rsChannels);
    if (sk && sk.streamKey) rsApplyKey(sk.streamKey);
    $('rsStatus').textContent = `เชื่อมต่อแล้ว: ${profile?.username || 'Restream'} · ใส่คีย์ในปลายทาง “Restream” ให้แล้ว`;
  } catch (e) {
    if (rs) $('rsStatus').textContent = '⚠️ ' + e.message;
  }
}

$('rsConnect').onclick = async () => {
  try {
    const st = await (await fetch(RS_BASE + '/oauth/restream/status')).json();
    if (!st.configured) {
      $('rsSetup').open = true;
      return toast('ยังไม่ได้ตั้งค่าแอป Restream บนเว็บ — ดูขั้นตอนด้านล่าง');
    }
  } catch {
    return toast('ติดต่อเว็บ yoddoych.vercel.app ไม่ได้ — ตรวจอินเทอร์เน็ต');
  }
  const w = window.open(RS_BASE + '/oauth/restream/start?origin=' + encodeURIComponent(location.origin), 'restream-auth', 'popup=yes,width=520,height=760');
  if (!w) toast('เบราว์เซอร์บล็อกป๊อปอัป — อนุญาตป๊อปอัปแล้วกดอีกครั้ง');
};
window.addEventListener('message', (e) => {
  if (e.origin !== (RS_BASE || location.origin)) return; // รับเฉพาะจากตัวเชื่อมของเราเอง
  const m = e.data;
  if (!m || m.type !== 'restream-auth' || !m.access) return;
  rs = { access: m.access, refresh: m.refresh, exp: m.exp };
  store.set('restream', rs);
  toast('เชื่อมต่อ Restream แล้ว');
  rsSync();
});
$('rsRefresh').onclick = rsSync;
$('rsDisconnectBtn').onclick = () => {
  if (!confirm('ยกเลิกการเชื่อมต่อ Restream บนเครื่องนี้?')) return;
  rsDisconnect('ยกเลิกการเชื่อมต่อแล้ว (ถอนสิทธิ์ถาวรได้ที่ restream.io → Settings → Apps)');
};
$('rsTitleSave').onclick = async () => {
  const title = $('rsTitle').value.trim();
  if (!title) return $('rsTitle').focus();
  store.set('rsTitle', title);
  const active = (window.rsChannels || []).filter((c) => c.active);
  if (!active.length) return toast('ยังไม่ได้เปิดช่องไหนใน Restream');
  const results = await Promise.allSettled(active.map((c) => rsApi('user/channel-meta/' + c.id, 'PATCH', { title })));
  const bad = results.map((r, i) => (r.status === 'rejected' ? active[i].displayName || rsPlatforms[active[i].streamingPlatformId] : null)).filter(Boolean);
  toast(bad.length ? `อัปเดตชื่อไม่ได้: ${bad.join(', ')} (บางแพลตฟอร์มต้องตั้งชื่อในแอปเอง)` : `อัปเดตชื่อไลฟ์แล้ว ${active.length} ช่อง`);
};
$('rsTitle').value = store.get('rsTitle', '');

// ---------- ยอดคนดูแบบเรียลไทม์ของทุกช่องใน Restream (Restream Streaming Updates) ----------
const normPlatform = (name) => {
  const n = String(name || '');
  for (const p of ['YouTube', 'TikTok', 'Facebook', 'Twitch', 'Kick', 'Instagram', 'LinkedIn', 'Trovo', 'DLive', 'Rumble']) if (n.toLowerCase().includes(p.toLowerCase())) return p;
  if (/^x\b|twitter/i.test(n)) return 'X';
  return n || 'ช่อง';
};
let rsStatusWs = null;
let rsStatusTimer = null;
async function connectRsStatus() {
  clearTimeout(rsStatusTimer);
  if (rsStatusWs) { rsStatusWs.onclose = null; rsStatusWs.close(); rsStatusWs = null; }
  for (const k of Object.keys(viewerData)) if (k.startsWith('rs:')) delete viewerData[k];
  renderViewers();
  if (!rs) return;
  let token;
  try { token = await rsToken(); } catch { return; }
  const ws = new WebSocket('wss://streaming.api.restream.io/ws?accessToken=' + encodeURIComponent(token));
  rsStatusWs = ws;
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const key = 'rs:' + m.channelId;
    if (m.action === 'updateStatuses') {
      if (!m.online) delete viewerData[key];
      else {
        const ch = (window.rsChannels || []).find((c) => c.id === m.channelId);
        viewerData[key] = { platform: normPlatform(rsPlatforms[m.platformId]), name: ch ? ch.displayName : '', viewers: m.viewers ?? 0, at: Date.now() };
      }
      renderViewers();
    } else if (m.action === 'deleteOutgoing') {
      delete viewerData[key];
      renderViewers();
    }
  };
  ws.onclose = () => {
    if (rsStatusWs !== ws) return;
    rsStatusTimer = setTimeout(connectRsStatus, 5000); // โทเคนหมดอายุ/เน็ตสะดุด → ต่อใหม่ด้วยโทเคนใหม่
  };
}
// ยอดเก่าค้างเกิน 3 นาที (ช่องหยุดรายงาน) → เอาออก
setInterval(() => {
  let changed = false;
  for (const [k, d] of Object.entries(viewerData)) if (k.startsWith('rs:') && Date.now() - d.at > 180000) { delete viewerData[k]; changed = true; }
  if (changed) renderViewers();
}, 30000);

if (rs) rsSync().then(connectRsStatus);
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'restream-auth') setTimeout(connectRsStatus, 1500); });
$('rsDisconnectBtn').addEventListener('click', () => setTimeout(connectRsStatus, 300));
