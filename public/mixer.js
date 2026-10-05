// ---------- มิกเซอร์เสียง ----------
// ไมค์ → ตัดเสียงต่ำ → ประตูเสียง (noise gate) → ปรับเสียงให้สม่ำเสมอ (compressor) → ระดับ → ปิดเสียง ┐
// เสียงจอ/iPhone ─────────────────────────────────────────────── ระดับ → ปิดเสียง ┤
// เพลงพื้นหลัง ──────────────────────── ระดับ → ลดเสียงตอนพูด (ducking) → ปิดเสียง ┼→ รวม → ไลฟ์/ไฟล์อัด
// เอฟเฟกต์เสียง ─────────────────────────────────────────────── ระดับ → ปิดเสียง ┘
// เพลงและเอฟเฟกต์ส่งออกลำโพงด้วย (ปิดได้) · ไมค์และเสียงจอไม่ออกลำโพง (กันเสียงหอน)
// latencyHint 'playback' = บัฟเฟอร์เสียงใหญ่ขึ้น → ตอนเครื่องทำงานหนัก (เกม + ไลฟ์) เสียงไม่กระตุก/ไม่แตก
// 48 kHz ตรงกับที่ส่งไลฟ์ ไม่ต้องแปลงอัตราสุ่มซ้ำ
let actx;
try {
  actx = new AudioContext({ latencyHint: 'playback', sampleRate: 48000 });
} catch {
  actx = new AudioContext({ latencyHint: 'playback' });
}
const mixOut = actx.createMediaStreamDestination(); // มีแทร็กเสียงเสมอ (เงียบถ้าไม่มีแหล่ง) เพราะแพลตฟอร์มส่วนใหญ่ต้องการเสียง
const bus = actx.createGain();
// ตัวกันเสียงแตก (limiter): เสียงรวมดังเกิน → กดลงนุ่ม ๆ แทนที่จะแตกตอนเกินระดับสูงสุด
const limiter = actx.createDynamicsCompressor();
limiter.threshold.value = -3;
limiter.knee.value = 0;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.1;
bus.connect(limiter);
limiter.connect(mixOut);
const monitorBus = actx.createGain();
monitorBus.connect(actx.destination);

const mix = Object.assign({
  ns: true, gate: false, gateTh: -50, comp: false, duck: true, duckLevel: 30, monitor: true, musicMode: 'all',
}, store.get('mix', {}));
for (const k of ['mic', 'screen', 'music', 'sfx']) mix[k] = Object.assign({ vol: k === 'music' ? 35 : 100, mute: false }, mix[k]);
const saveMix = () => store.set('mix', mix);

function makeAnalyser() {
  const a = actx.createAnalyser();
  a.fftSize = 1024;
  a.buf = new Float32Array(a.fftSize);
  return a;
}
// ระดับเสียงเป็น dB (RMS)
function levelDb(a) {
  a.getFloatTimeDomainData(a.buf);
  let sum = 0;
  for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
  return 10 * Math.log10(sum / a.buf.length + 1e-12);
}

// ช่องเสียง: ระดับ → ปิดเสียง → (รวม + เครื่องวัด)
function channel(id) {
  const vol = actx.createGain();
  const mute = actx.createGain();
  const an = makeAnalyser();
  vol.connect(mute);
  mute.connect(bus);
  mute.connect(an);
  return { id, vol, mute, an };
}
const CH = { mic: channel('mic'), screen: channel('screen'), music: channel('music'), sfx: channel('sfx') };
CH.music.mute.connect(monitorBus);
CH.sfx.mute.connect(monitorBus);
const masterAn = makeAnalyser();
limiter.connect(masterAn);

// ไมค์: ตัดเสียงต่ำ (เสียงพัดลม/แอร์/กระแทกโต๊ะ) → gate → compressor
const micHp = actx.createBiquadFilter();
micHp.type = 'highpass';
micHp.frequency.value = 80;
const micPreAn = makeAnalyser();
const micGate = actx.createGain();
const micComp = actx.createDynamicsCompressor();
micComp.threshold.value = -26;
micComp.knee.value = 10;
micComp.ratio.value = 4;
micComp.attack.value = 0.004;
micComp.release.value = 0.2;
const micMakeup = actx.createGain();
micMakeup.gain.value = 1.6;
micHp.connect(micPreAn);
micHp.connect(micGate);
micComp.connect(micMakeup);
micMakeup.connect(CH.mic.vol);
function routeComp() {
  micGate.disconnect();
  micGate.connect(mix.comp ? micComp : CH.mic.vol);
}
routeComp();

// เพลง: ลดเสียงตอนพูด (ducking)
const musicDuck = actx.createGain();
musicDuck.connect(CH.music.vol);
const musicEl = new Audio();
musicEl.preload = 'auto';
actx.createMediaElementSource(musicEl).connect(musicDuck);

let sceneMicMute = false; // ฉาก "พักเดี๋ยวมา" ฯลฯ ปิดไมค์ให้
function applyMix() {
  for (const k of Object.keys(CH)) {
    CH[k].vol.gain.value = mix[k].vol / 100;
    const muted = mix[k].mute || (k === 'mic' && sceneMicMute);
    CH[k].mute.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
  }
  monitorBus.gain.value = mix.monitor ? 1 : 0;
  if (!mix.gate) micGate.gain.setTargetAtTime(1, actx.currentTime, 0.01);
  if (!mix.duck) musicDuck.gain.setTargetAtTime(1, actx.currentTime, 0.1);
  renderMixer();
}
function setSceneMicMute(on) {
  sceneMicMute = !!on;
  applyMix();
}

// ทำงานทุกเฟรม (เรียกจาก ticker ใน studio.js ซึ่งยังเดินแม้สลับไปแท็บอื่น)
let gateOpenUntil = 0;
let talkUntil = 0;
let gateOpen = true;
function audioTick() {
  if (!micSrc) return;
  const now = performance.now();
  const t = actx.currentTime;
  const pre = levelDb(micPreAn);
  if (mix.gate) {
    if (pre > mix.gateTh) gateOpenUntil = now + 250; // ค้างไว้ 0.25 วิ ไม่ให้ตัดท้ายคำ
    const open = now < gateOpenUntil;
    if (open !== gateOpen) micGate.gain.setTargetAtTime(open ? 1 : 0, t, open ? 0.004 : 0.06);
    gateOpen = open;
  }
  if (mix.duck) {
    const micLive = !(mix.mic.mute || sceneMicMute) && (!mix.gate || gateOpen);
    if (micLive && pre > Math.max(-42, mix.gate ? mix.gateTh : -42)) talkUntil = now + 700;
    const talking = now < talkUntil;
    musicDuck.gain.setTargetAtTime(talking ? mix.duckLevel / 100 : 1, t, talking ? 0.08 : 0.4);
  }
}

// ---------- แหล่งเสียง ----------
let micSrc = null;
let micStream = null;
let screenSrc = null;

function connectScreenAudio(stream) {
  if (screenSrc) screenSrc.disconnect();
  screenSrc = null;
  if (stream && stream.getAudioTracks().length) {
    screenSrc = actx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    screenSrc.connect(CH.screen.vol);
  }
  renderMixer();
}

async function openMic() {
  if (micSrc) micSrc.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micSrc = micStream = null;
  const id = $('micSelect').value;
  store.set('micId', id);
  renderMixer();
  if (!id) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: id === 'default' ? undefined : { exact: id }, echoCancellation: mix.ns, noiseSuppression: mix.ns, autoGainControl: false },
    });
    micSrc = actx.createMediaStreamSource(micStream);
    micSrc.connect(micHp);
    actx.resume();
    listDevices();
  } catch {
    toast('เปิดไมค์ไม่ได้');
  }
  renderMixer();
}
$('micSelect').onchange = openMic;

// ---------- หน้าตามิกเซอร์ ----------
const CH_INFO = {
  mic: { icon: '🎙️', name: 'ไมค์' },
  screen: { icon: '📱', name: 'เสียงจอ / iPhone' },
  music: { icon: '🎵', name: 'เพลงพื้นหลัง' },
  sfx: { icon: '🔔', name: 'เอฟเฟกต์เสียง' },
};
function renderMixer() {
  const box = $('mixer');
  if (!box.childElementCount) {
    box.innerHTML = Object.keys(CH_INFO).map((k) => `
      <div class="mix-row" data-ch="${k}">
        <span class="mix-icon">${CH_INFO[k].icon}</span>
        <div class="mix-main">
          <div class="mix-top"><b>${CH_INFO[k].name}</b><span class="mix-note muted small"></span><span class="mix-val muted small"></span></div>
          <div class="mix-meter"><div></div></div>
          <input type="range" min="0" max="200" aria-label="ระดับ ${CH_INFO[k].name}">
        </div>
        <button class="btn small mix-mute" aria-label="ปิดเสียง ${CH_INFO[k].name}">🔊</button>
      </div>`).join('') + `
      <div class="mix-row master">
        <span class="mix-icon">📡</span>
        <div class="mix-main"><div class="mix-top"><b>เสียงที่ออกไลฟ์</b></div><div class="mix-meter"><div id="masterMeter"></div></div></div>
      </div>`;
    box.querySelectorAll('[data-ch]').forEach((row) => {
      const k = row.dataset.ch;
      row.querySelector('input').oninput = (e) => {
        mix[k].vol = +e.target.value;
        saveMix();
        applyMix();
      };
      row.querySelector('.mix-mute').onclick = () => {
        mix[k].mute = !mix[k].mute;
        saveMix();
        applyMix();
      };
    });
  }
  box.querySelectorAll('[data-ch]').forEach((row) => {
    const k = row.dataset.ch;
    const muted = mix[k].mute || (k === 'mic' && sceneMicMute);
    row.querySelector('input').value = mix[k].vol;
    row.querySelector('.mix-val').textContent = mix[k].vol + '%';
    const b = row.querySelector('.mix-mute');
    b.textContent = muted ? '🔇' : '🔊';
    b.classList.toggle('danger', muted);
    row.classList.toggle('muted-ch', muted);
    const note = {
      mic: !micSrc ? 'ยังไม่ได้เลือกไมค์' : sceneMicMute && !mix.mic.mute ? 'ฉากนี้ปิดไมค์' : '',
      screen: !screenSrc ? 'ไม่มีเสียง (ติ๊ก “แชร์เสียง” ตอนเลือกจอ)' : '',
      music: '', sfx: '',
    }[k];
    row.querySelector('.mix-note').textContent = note;
  });
  $('mixNs').checked = mix.ns;
  $('mixGate').checked = mix.gate;
  $('mixGateTh').value = mix.gateTh;
  $('mixGateRow').hidden = !mix.gate;
  $('mixGateVal').textContent = mix.gateTh + ' dB';
  $('mixComp').checked = mix.comp;
  $('mixDuck').checked = mix.duck;
  $('mixDuckLevel').value = mix.duckLevel;
  $('mixDuckRow').hidden = !mix.duck;
  $('mixDuckVal').textContent = mix.duckLevel + '%';
  $('mixMonitor').checked = mix.monitor;
}

$('mixNs').onchange = () => { mix.ns = $('mixNs').checked; saveMix(); if (micSrc) openMic(); };
$('mixGate').onchange = () => { mix.gate = $('mixGate').checked; saveMix(); applyMix(); };
$('mixGateTh').oninput = () => { mix.gateTh = +$('mixGateTh').value; saveMix(); renderMixer(); };
$('mixComp').onchange = () => { mix.comp = $('mixComp').checked; saveMix(); routeComp(); };
$('mixDuck').onchange = () => { mix.duck = $('mixDuck').checked; saveMix(); applyMix(); };
$('mixDuckLevel').oninput = () => { mix.duckLevel = +$('mixDuckLevel').value; saveMix(); renderMixer(); };
$('mixMonitor').onchange = () => { mix.monitor = $('mixMonitor').checked; saveMix(); applyMix(); };

// เครื่องวัดระดับเสียง + ขีดเส้นระดับ gate
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
(function meters() {
  if (!document.hidden && $('masterMeter') && !$('mixer').closest('[hidden]')) {
    document.querySelectorAll('#mixer [data-ch]').forEach((row) => {
      const db = levelDb(CH[row.dataset.ch].an);
      const bar = row.querySelector('.mix-meter div');
      bar.style.width = dbToPct(db) + '%';
      bar.classList.toggle('hot', db > -6);
    });
    const m = levelDb(masterAn);
    $('masterMeter').style.width = dbToPct(m) + '%';
    $('masterMeter').classList.toggle('hot', m > -6);
    if (mix.gate && micSrc) {
      const pre = levelDb(micPreAn);
      $('gateMeter').style.width = dbToPct(pre) + '%';
      $('gateMeter').classList.toggle('open', gateOpen);
      $('gateMark').style.left = dbToPct(mix.gateTh) + '%';
    }
  }
  requestAnimationFrame(meters);
})();

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, first) => {
    const cur = sel.value || store.get(kind === 'audioinput' ? 'micId' : 'camId', '');
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

// ---------- เพลงพื้นหลัง ----------
const tracks = []; // { id, name, blob, url }
let trackIdx = -1;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function renderMusic() {
  const list = $('musicList');
  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track' + (i === trackIdx ? ' playing' : '');
    row.innerHTML = `<button class="track-play" aria-label="เล่น">${i === trackIdx && !musicEl.paused ? '⏸' : '▶'}</button><span class="track-name"></span><button class="icon-btn" aria-label="ลบเพลง">✕</button>`;
    row.querySelector('.track-name').textContent = t.name;
    row.querySelector('.track-play').onclick = () => (i === trackIdx ? toggleMusic() : playTrack(i));
    row.querySelector('.icon-btn').onclick = () => removeTrack(i);
    list.append(row);
  });
  $('musicEmpty').hidden = tracks.length > 0;
  $('musicCtl').hidden = !tracks.length;
  $('musicPlay').textContent = musicEl.paused ? '▶ เล่น' : '⏸ หยุด';
  $('musicMode').value = mix.musicMode;
  $('musicNow').textContent = trackIdx >= 0 && tracks[trackIdx] ? (musicEl.paused ? 'หยุดอยู่: ' : 'กำลังเล่น: ') + tracks[trackIdx].name : '';
}

function playTrack(i) {
  if (!tracks.length) return;
  trackIdx = (i + tracks.length) % tracks.length;
  musicEl.src = tracks[trackIdx].url;
  actx.resume();
  musicEl.play().catch(() => toast('เล่นไฟล์เพลงนี้ไม่ได้'));
}
function toggleMusic() {
  if (trackIdx < 0) return playTrack(0);
  actx.resume();
  if (musicEl.paused) musicEl.play().catch(() => {});
  else musicEl.pause();
}
function nextTrack() {
  if (!tracks.length) return;
  if (mix.musicMode === 'shuffle' && tracks.length > 1) {
    let n;
    do n = Math.floor(Math.random() * tracks.length);
    while (n === trackIdx);
    return playTrack(n);
  }
  playTrack(trackIdx + 1);
}
musicEl.onended = () => (mix.musicMode === 'one' ? playTrack(trackIdx) : nextTrack());
musicEl.onplay = musicEl.onpause = renderMusic;

function removeTrack(i) {
  const [t] = tracks.splice(i, 1);
  if (i === trackIdx) {
    musicEl.pause();
    musicEl.removeAttribute('src');
    trackIdx = -1;
  } else if (i < trackIdx) trackIdx--;
  URL.revokeObjectURL(t.url);
  idb('delete', 'music:' + t.id);
  renderMusic();
}
function addTrack(blob, name, id, save) {
  const t = { id: id || newId(), name, blob, url: URL.createObjectURL(blob) };
  tracks.push(t);
  if (save) idb('put', 'music:' + t.id, { kind: 'music', id: t.id, name, blob, order: Date.now() });
  return t;
}
$('musicFile').onchange = (e) => {
  for (const f of [...e.target.files]) addTrack(f, f.name.replace(/\.[^.]+$/, ''), null, true);
  e.target.value = '';
  renderMusic();
};
$('musicPlay').onclick = toggleMusic;
$('musicNext').onclick = nextTrack;
$('musicMode').onchange = () => { mix.musicMode = $('musicMode').value; saveMix(); };

// ---------- เอฟเฟกต์เสียง ----------
// เสียงสำเร็จรูปสังเคราะห์ขึ้นเอง (ไม่ใช้ไฟล์เสียงลิขสิทธิ์) + เพิ่มไฟล์เสียงของตัวเองได้
let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function noiseHit(out, t, { peak = 0.5, attack = 0.002, decay = 0.1, type = 'bandpass', freq = 1500, q = 1 } = {}) {
  const s = actx.createBufferSource();
  s.buffer = noise();
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = actx.createGain();
  env(g, t, peak, attack, decay);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 1.5, attack + decay + 0.05);
}
function tone(out, t, { freq, type = 'sine', peak = 0.3, attack = 0.005, decay = 0.5, to }) {
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  const g = actx.createGain();
  env(g, t, peak, attack, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}
const SFX = [
  { id: 'clap', icon: '👏', name: 'ปรบมือ', play(out, t) {
    // ฝูงคนปรบมือ: เสียงตบสั้น ๆ หลายร้อยครั้งแบบสุ่ม ค่อย ๆ เบาลงตอนท้าย
    for (let i = 0; i < 180; i++) {
      const at = t + Math.random() * 2.6;
      const fade = at - t > 1.8 ? 1 - (at - t - 1.8) / 0.8 : 1;
      noiseHit(out, at, { peak: 0.45 * fade + 0.01, decay: 0.03 + Math.random() * 0.04, freq: 900 + Math.random() * 1600, q: 0.8 });
    }
  } },
  { id: 'ding', icon: '✨', name: 'ติ๊ง', play(out, t) {
    tone(out, t, { freq: 1318, decay: 1.2, peak: 0.35 });
    tone(out, t, { freq: 2637, decay: 0.8, peak: 0.12 });
    tone(out, t + 0.12, { freq: 1760, decay: 1.4, peak: 0.3 });
  } },
  { id: 'horn', icon: '📯', name: 'แตร', play(out, t) {
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(out);
    [[0, 0.22], [0.3, 0.22], [0.6, 0.9]].forEach(([d, len]) => {
      for (const f of [466, 470, 587]) {
        const o = actx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.94, t + d);
        o.frequency.linearRampToValueAtTime(f, t + d + 0.05);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.03);
        g.gain.setValueAtTime(0.12, t + d + len - 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
        o.connect(g).connect(lp);
        o.start(t + d);
        o.stop(t + d + len + 0.05);
      }
    });
  } },
  { id: 'drum', icon: '🥁', name: 'กลองรัว', play(out, t) {
    // รัวสแนร์ดังขึ้นเรื่อย ๆ แล้วปิดด้วยฉาบ
    for (let i = 0; i < 34; i++) {
      const at = t + i * 0.045;
      noiseHit(out, at, { peak: 0.08 + (i / 34) * 0.3, decay: 0.07, freq: 2200, q: 0.6 });
      tone(out, at, { freq: 190, to: 140, peak: 0.05 + (i / 34) * 0.12, decay: 0.06, type: 'triangle' });
    }
    const end = t + 34 * 0.045 + 0.05;
    tone(out, end, { freq: 120, to: 45, peak: 0.6, decay: 0.4 });
    noiseHit(out, end, { peak: 0.35, decay: 1.6, type: 'highpass', freq: 5000, q: 0.5 });
  } },
  { id: 'wrong', icon: '❌', name: 'ผิดจ้า', play(out, t) {
    tone(out, t, { freq: 155, type: 'square', peak: 0.12, decay: 0.75, attack: 0.01 });
    tone(out, t, { freq: 160, type: 'square', peak: 0.12, decay: 0.75, attack: 0.01 });
  } },
  { id: 'boom', icon: '💥', name: 'ตู้ม', play(out, t) {
    tone(out, t, { freq: 90, to: 30, peak: 0.8, decay: 1.2, attack: 0.005 });
    noiseHit(out, t, { peak: 0.6, decay: 1.4, type: 'lowpass', freq: 350, q: 0.7 });
  } },
  { id: 'tada', icon: '🎉', name: 'ทาดา', play(out, t) {
    [[523, 0], [659, 0], [784, 0], [1047, 0.18], [784, 0.18], [659, 0.18]].forEach(([f, d]) => tone(out, t + d, { freq: f, type: 'triangle', peak: 0.12, decay: d ? 1.3 : 0.16 }));
  } },
  { id: 'pop', icon: '🫧', name: 'ป๊อป', play(out, t) {
    tone(out, t, { freq: 420, to: 1100, peak: 0.4, decay: 0.09, attack: 0.002 });
  } },
];
const customSfx = []; // { id, name, buffer }

function playSfx(p) {
  actx.resume();
  const t = actx.currentTime + 0.02;
  if (p.buffer) {
    const s = actx.createBufferSource();
    s.buffer = p.buffer;
    s.connect(CH.sfx.vol);
    s.start(t);
  } else p.play(CH.sfx.vol, t);
}
function renderSfx() {
  const box = $('sfxPads');
  box.innerHTML = '';
  for (const p of [...SFX, ...customSfx]) {
    const b = document.createElement('button');
    b.className = 'sfx-pad';
    b.innerHTML = `<span>${p.icon || '🔉'}</span><small></small>`;
    b.querySelector('small').textContent = p.name;
    b.onclick = () => {
      playSfx(p);
      b.classList.remove('hit');
      void b.offsetWidth;
      b.classList.add('hit');
    };
    if (p.buffer) {
      b.title = 'คลิกขวาเพื่อลบ';
      b.oncontextmenu = (e) => {
        e.preventDefault();
        if (!confirm(`ลบเสียง “${p.name}” ?`)) return;
        customSfx.splice(customSfx.indexOf(p), 1);
        idb('delete', 'sfx:' + p.id);
        renderSfx();
      };
    }
    box.append(b);
  }
}
async function addSfx(blob, name, id, save) {
  try {
    const buffer = await actx.decodeAudioData(await blob.arrayBuffer());
    const p = { id: id || newId(), name, buffer };
    customSfx.push(p);
    if (save) idb('put', 'sfx:' + p.id, { kind: 'sfx', id: p.id, name, blob, order: Date.now() });
  } catch {
    toast(`เปิดไฟล์เสียง ${name} ไม่ได้`);
  }
}
$('sfxFile').onchange = async (e) => {
  for (const f of [...e.target.files]) {
    if (f.size > 15e6) { toast(`${f.name} ใหญ่เกิน 15MB`); continue; }
    await addSfx(f, f.name.replace(/\.[^.]+$/, '').slice(0, 14), null, true);
  }
  e.target.value = '';
  renderSfx();
};

// โหลดเพลง/เสียงที่เคยเพิ่มไว้กลับมา
idb('all').then(async (items) => {
  const mine = (items || []).filter((x) => x && (x.kind === 'music' || x.kind === 'sfx') && x.blob).sort((a, b) => a.order - b.order);
  for (const it of mine) {
    if (it.kind === 'music') addTrack(it.blob, it.name, it.id, false);
    else await addSfx(it.blob, it.name, it.id, false);
  }
  renderMusic();
  renderSfx();
});

// คีย์ลัด M = ปิด/เปิดไมค์
document.addEventListener('keydown', (e) => {
  if (e.key !== 'm' && e.key !== 'M') return;
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  mix.mic.mute = !mix.mic.mute;
  saveMix();
  applyMix();
  toast(mix.mic.mute ? '🔇 ปิดไมค์' : '🎙️ เปิดไมค์');
});

renderMixer();
applyMix();
renderMusic();
renderSfx();
// เปิดไมค์ตัวเดิมให้อัตโนมัติ (ถ้าเคยอนุญาตแล้ว)
navigator.permissions?.query({ name: 'microphone' }).then((p) => {
  if (p.state === 'granted' && store.get('micId', '')) listDevices().then(() => $('micSelect').value && openMic());
}).catch(() => {});
