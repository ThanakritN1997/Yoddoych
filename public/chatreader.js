// ---------- อ่านแชท (รวมแชททุกช่อง + อ่านออกเสียง) ----------
// แหล่งแชท (ทางการทั้งหมด):
//   Restream (ถ้าเชื่อมไว้) → YouTube, Facebook, Twitch, Kick, X ฯลฯ ผ่าน Restream Chat API ช่องเดียว
//   ไม่ได้เชื่อม Restream → YouTube (YouTube Data API + API Key) และ Twitch (แชทสาธารณะ ไม่ต้องล็อกอิน)
//   TikTok: ยังไม่มีช่องทางทางการให้อ่านแชท (Restream ก็ไม่รองรับ)
// เสียงอ่านออกลำโพงเครื่องนี้ (ไม่เข้าเสียงไลฟ์)
const CR_PLATFORMS = {
  youtube: { name: 'YouTube', color: '#ff4e45' },
  facebook: { name: 'Facebook', color: '#4f8cff' },
  twitch: { name: 'Twitch', color: '#a970ff' },
  kick: { name: 'Kick', color: '#53fc18' },
  other: { name: 'อื่น ๆ (Restream)', color: '#8d96a7' },
};
// eventSourceId ของ Restream → แพลตฟอร์ม
const RS_SOURCE = { 2: 'twitch', 13: 'youtube', 19: 'facebook', 20: 'facebook', 29: 'kick' };

const cr = Object.assign({
  on: false, rate: 1.1, volume: 0.9, readName: true, voice: '', maxLen: 120,
  sources: { youtube: true, facebook: true, twitch: true, kick: true, other: true },
}, store.get('chatReader', {}));
cr.sources = Object.assign({ youtube: true, facebook: true, twitch: true, kick: true, other: true }, cr.sources);
const saveCr = () => store.set('chatReader', cr);
const crStatus = {}; // แหล่ง → ข้อความสถานะ
const seen = new Set();

// ---------- เสียงอ่าน ----------
const speakQueue = [];
let speaking = false;
function thaiVoice() {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => v.voiceURI === cr.voice) || vs.find((v) => /^th/i.test(v.lang)) || null;
}
function cleanText(t) {
  return String(t || '')
    .replace(/https?:\/\/\S+/g, ' ลิงก์ ')
    .replace(/(.)\1{3,}/gu, '$1$1$1') // 5555555 → 555 · !!!!!! → !!!
    .replace(/[\p{Extended_Pictographic}‍️]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cr.maxLen);
}
function speakNext() {
  if (speaking || !speakQueue.length) return;
  const text = speakQueue.shift();
  const u = new SpeechSynthesisUtterance(text);
  const v = thaiVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'th-TH';
  u.rate = cr.rate;
  u.volume = cr.volume;
  speaking = true;
  u.onend = u.onerror = () => { speaking = false; speakNext(); };
  speechSynthesis.speak(u);
}
function say(text) {
  if (!text) return;
  speakQueue.push(text);
  while (speakQueue.length > 6) speakQueue.shift(); // แชทมาเร็วเกิน → ข้ามข้อความเก่า อ่านของใหม่ทัน
  speakNext();
}

// ---------- รับข้อความ ----------
function onChat(platform, author, text, id) {
  if (!text) return;
  const key = platform + ':' + (id || author + text);
  if (seen.has(key)) return; // กันซ้ำ
  seen.add(key);
  if (seen.size > 2000) seen.clear();
  addFeed(platform, author, text);
  if (!cr.on || !cr.sources[platform]) return;
  if (/^[!/]/.test(text.trim())) return; // คำสั่งบอท
  const body = cleanText(text);
  if (!body) return;
  say(cr.readName && author ? `${cleanText(author).slice(0, 30)} บอกว่า ${body}` : body);
}

function addFeed(platform, author, text) {
  const p = CR_PLATFORMS[platform] || CR_PLATFORMS.other;
  const row = document.createElement('div');
  row.className = 'cr-msg' + (cr.sources[platform] ? '' : ' muted-src');
  row.innerHTML = '<span class="cr-tag"></span><b></b><span></span>';
  row.querySelector('.cr-tag').textContent = p.name.split(' ')[0];
  row.querySelector('.cr-tag').style.background = p.color;
  row.querySelector('b').textContent = author || '';
  row.querySelector('span:last-child').textContent = text;
  const feed = $('crFeed');
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.append(row);
  while (feed.childElementCount > 80) feed.firstChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
  $('crEmpty').hidden = true;
}

function setStatus(src, text) {
  crStatus[src] = text;
  $('crStatus').innerHTML = Object.values(crStatus).filter(Boolean).map((t) => `<div>${esc(t)}</div>`).join('');
}

// ---------- แหล่ง: Restream (รวมทุกช่อง) ----------
let rsWs = null;
let rsWsTimer = null;
async function connectRestreamChat() {
  clearTimeout(rsWsTimer);
  if (rsWs) { rsWs.onclose = null; rsWs.close(); rsWs = null; }
  if (typeof rs === 'undefined' || !rs) return setStatus('rs', '');
  let token;
  try { token = await rsToken(); } catch { return setStatus('rs', ''); }
  const ws = new WebSocket('wss://chat.api.restream.io/ws?accessToken=' + encodeURIComponent(token));
  rsWs = ws;
  const openedAt = Date.now();
  ws.onopen = () => setStatus('rs', '🟢 Restream: รับแชท YouTube / Facebook / Twitch / Kick ที่เชื่อมใน Restream');
  ws.onmessage = (e) => {
    let a;
    try { a = JSON.parse(e.data); } catch { return; }
    if (a.action !== 'event' || !a.payload) return;
    // ข้อความเก่าที่ส่งมาตอนเพิ่งต่อ → แสดงแต่ไม่อ่าน
    const old = a.timestamp && a.timestamp * 1000 < openedAt - 5000;
    const p = a.payload;
    const ev = p.eventPayload || {};
    const author = ev.author ? ev.author.displayName || ev.author.name || ev.author.username || '' : '';
    const platform = RS_SOURCE[p.eventSourceId] || 'other';
    if (old) return addFeed(platform, author, ev.text || '');
    onChat(platform, author, ev.text, p.eventIdentifier);
  };
  ws.onclose = () => {
    if (rsWs !== ws) return;
    setStatus('rs', '🟡 Restream: กำลังต่อแชทใหม่…');
    rsWsTimer = setTimeout(connectRestreamChat, 5000); // โทเคนหมดอายุ/เน็ตสะดุด → ต่อใหม่ (ขอโทเคนใหม่ให้เอง)
  };
}

// ---------- แหล่ง: Twitch (ตรง ไม่ต้องล็อกอิน) ----------
let twWs = null;
let twChannel = '';
function connectTwitch() {
  const ch = ($('chatTwitch').value || '').trim().toLowerCase().replace(/^#/, '').replace(/.*twitch\.tv\//, '').replace(/\W.*$/, '');
  if (ch === twChannel && twWs) return;
  if (twWs) { twWs.onclose = null; twWs.close(); twWs = null; }
  twChannel = ch;
  if (!ch || (typeof rs !== 'undefined' && rs)) return setStatus('tw', ''); // ต่อ Restream แล้ว → ใช้ทางนั้นแทน (กันอ่านซ้ำ)
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  twWs = ws;
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
    ws.send('JOIN #' + ch);
    setStatus('tw', `🟢 Twitch: #${ch}`);
  };
  ws.onmessage = (e) => {
    for (const line of String(e.data).split('\r\n')) {
      if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
      const m = line.match(/^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
      if (!m) continue;
      const tags = Object.fromEntries(m[1].split(';').map((kv) => kv.split('=')));
      onChat('twitch', tags['display-name'] || m[2], m[3], tags.id);
    }
  };
  ws.onclose = () => {
    if (twWs !== ws) return;
    twWs = null;
    setStatus('tw', '🟡 Twitch: กำลังต่อใหม่…');
    setTimeout(connectTwitch, 5000);
  };
}

// ---------- แหล่ง: YouTube (ตรง ด้วย API Key) ----------
// ใช้โควตา YouTube API (ฟรี 10,000 หน่วย/วัน · ครั้งละ 5 หน่วย) → ดึงเฉพาะตอนเปิดอ่านแชท YouTube และไม่ถี่กว่า 8 วินาที
let ytTimer = null;
let ytState = { video: '', chatId: '', page: '', first: true };
async function pollYouTube() {
  clearTimeout(ytTimer);
  const key = ($('ytApiKey').value || '').trim();
  const video = youtubeId($('chatYoutube').value);
  const useDirect = cr.on && cr.sources.youtube && key && video && !(typeof rs !== 'undefined' && rs);
  if (!useDirect) return setStatus('yt', key || video ? '' : '');
  if (video !== ytState.video) ytState = { video, chatId: '', page: '', first: true };
  let wait = 10000;
  try {
    if (!ytState.chatId) {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${video}&key=${encodeURIComponent(key)}`)).json();
      if (j.error) throw new Error(j.error.message);
      ytState.chatId = j.items?.[0]?.liveStreamingDetails?.activeLiveChatId || '';
      if (!ytState.chatId) throw new Error('ไลฟ์นี้ยังไม่เริ่ม หรือปิดแชทอยู่');
    }
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet,authorDetails&liveChatId=${ytState.chatId}&key=${encodeURIComponent(key)}${ytState.page ? '&pageToken=' + ytState.page : ''}`)).json();
    if (j.error) throw new Error(j.error.message);
    ytState.page = j.nextPageToken || '';
    for (const it of j.items || []) {
      const author = it.authorDetails?.displayName || '';
      const text = it.snippet?.displayMessage || '';
      if (ytState.first) addFeed('youtube', author, text); // ข้อความก่อนเปิด → แสดง ไม่อ่าน
      else onChat('youtube', author, text, it.id);
      seen.add('youtube:' + it.id);
    }
    ytState.first = false;
    wait = Math.max(8000, j.pollingIntervalMillis || 0);
    setStatus('yt', '🟢 YouTube: รับแชทอยู่ (ใช้โควตา API Key)');
  } catch (e) {
    ytState.chatId = '';
    wait = 30000;
    setStatus('yt', '⚠️ YouTube: ' + e.message);
  }
  ytTimer = setTimeout(pollYouTube, wait);
}

function refreshSources() {
  connectRestreamChat();
  connectTwitch();
  pollYouTube();
}

// ---------- หน้าตา ----------
function renderCr() {
  $('crOn').checked = cr.on;
  $('crReadName').checked = cr.readName;
  $('crRate').value = cr.rate;
  $('crVolume').value = Math.round(cr.volume * 100);
  $('crRateVal').textContent = cr.rate.toFixed(1) + 'x';
  $('crVolumeVal').textContent = Math.round(cr.volume * 100) + '%';
  $('crSources').innerHTML = '';
  for (const [id, p] of Object.entries(CR_PLATFORMS)) {
    const l = document.createElement('label');
    l.className = 'cr-src' + (cr.sources[id] ? ' on' : '');
    l.innerHTML = `<input type="checkbox" ${cr.sources[id] ? 'checked' : ''}><i style="background:${p.color}"></i>${esc(p.name)}`;
    l.querySelector('input').onchange = (e) => {
      cr.sources[id] = e.target.checked;
      saveCr();
      renderCr();
      if (id === 'youtube') pollYouTube();
    };
    $('crSources').append(l);
  }
  const tk = document.createElement('label');
  tk.className = 'cr-src disabled';
  tk.title = 'TikTok ยังไม่เปิดให้โปรแกรมอื่นอ่านแชทแบบทางการ';
  tk.innerHTML = '<input type="checkbox" disabled><i style="background:#25f4ee"></i>TikTok (ยังไม่รองรับ)';
  $('crSources').append(tk);
}
function renderVoices() {
  const vs = speechSynthesis.getVoices();
  const sel = $('crVoice');
  sel.innerHTML = '';
  const th = vs.filter((v) => /^th/i.test(v.lang));
  for (const v of [...th, ...vs.filter((v) => !/^th/i.test(v.lang))]) sel.add(new Option(`${v.name} (${v.lang})`, v.voiceURI));
  if (!vs.length) sel.add(new Option('เสียงเริ่มต้นของเครื่อง', ''));
  sel.value = cr.voice && vs.some((v) => v.voiceURI === cr.voice) ? cr.voice : (th[0]?.voiceURI || sel.options[0]?.value || '');
  $('crNoThai').hidden = !!th.length || !vs.length;
}
speechSynthesis.onvoiceschanged = renderVoices;

$('crOn').onchange = () => {
  cr.on = $('crOn').checked;
  saveCr();
  if (!cr.on) { speakQueue.length = 0; speechSynthesis.cancel(); speaking = false; }
  pollYouTube();
  toast(cr.on ? '🔊 เปิดอ่านแชทแล้ว' : 'ปิดอ่านแชทแล้ว');
};
$('crReadName').onchange = () => { cr.readName = $('crReadName').checked; saveCr(); };
$('crRate').oninput = () => { cr.rate = +$('crRate').value; saveCr(); renderCr(); };
$('crVolume').oninput = () => { cr.volume = $('crVolume').value / 100; saveCr(); renderCr(); };
$('crVoice').onchange = () => { cr.voice = $('crVoice').value; saveCr(); };
$('crTest').onclick = () => say((cr.readName ? 'Yoddoy_Fan บอกว่า ' : '') + 'สวัสดีครับ ไลฟ์วันนี้สนุกมาก');
$('crSkip').onclick = () => { speechSynthesis.cancel(); speaking = false; speakNext(); };
$('chatTwitch').addEventListener('change', connectTwitch);
$('chatYoutube').addEventListener('change', pollYouTube);
$('ytApiKey').addEventListener('change', pollYouTube);
// เชื่อม/ยกเลิก Restream → สลับแหล่งแชท
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'restream-auth') setTimeout(refreshSources, 1500); });
$('rsDisconnectBtn').addEventListener('click', () => setTimeout(refreshSources, 500));

// คีย์ลัด R = เปิด/ปิดอ่านแชท
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'r' && e.key !== 'R') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  $('crOn').checked = !cr.on;
  $('crOn').onchange();
});

renderCr();
renderVoices();
refreshSources();
