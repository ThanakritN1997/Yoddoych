// ---------- บีบอัดภาพรอบเดียวด้วยการ์ดจอผ่าน Chrome (WebCodecs) ----------
// เดิม: Chrome บีบ (MediaRecorder) → Helper ถอด+บีบซ้ำ = งานหนัก 2 รอบ ภาพเสียรายละเอียด 2 ครั้ง
// ใหม่: Chrome บีบ H.264 ด้วยการ์ดจอที่บิตเรตจริงที่จะส่ง → ห่อเป็น Matroska ส่งให้ Helper → Helper แค่ส่งต่อ (ไม่บีบซ้ำ)
// เสียง: Opus → Helper แปลงเป็น AAC (งานเบามาก)
// ใช้หน้าตาเหมือน MediaRecorder (state, stop, ondataavailable, onerror) เพื่อใช้กับโค้ดส่งไลฟ์เดิมได้เลย

// ----- ตัวเขียน Matroska แบบสตรีม (ไม่ต้องรู้ขนาดล่วงหน้า) -----
const MKV = (() => {
  const enc = new TextEncoder();
  const idBytes = (id) => {
    const out = [];
    while (id > 0) { out.unshift(id & 0xff); id = Math.floor(id / 256); }
    return out;
  };
  const sizeBytes = (n) => {
    // ความยาวแบบ EBML vint (สั้นที่สุดที่พอ)
    for (let len = 1; len <= 8; len++) {
      if (n < 2 ** (7 * len) - 1) {
        const out = new Array(len);
        let v = n;
        for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
        out[0] |= 0x80 >> (len - 1);
        return out;
      }
    }
    throw new Error('size too big');
  };
  const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]; // ขนาดไม่ทราบ (สตรีมไม่จบ)
  const cat = (parts) => {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const el = (id, data) => {
    const d = data instanceof Uint8Array ? data : new Uint8Array(data);
    return cat([new Uint8Array(idBytes(id)), new Uint8Array(sizeBytes(d.length)), d]);
  };
  const uint = (id, v) => {
    const b = [];
    do { b.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
    return el(id, b);
  };
  const float = (id, v) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    return el(id, b);
  };
  const str = (id, s) => el(id, enc.encode(s));
  const master = (id, children) => el(id, cat(children));
  const open = (id) => cat([new Uint8Array(idBytes(id)), new Uint8Array(UNKNOWN)]);

  function header({ width, height, avcC, hevc, audio }) {
    const ebml = master(0x1a45dfa3, [
      uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8),
      str(0x4282, 'matroska'), uint(0x4287, 4), uint(0x4285, 2),
    ]);
    const info = master(0x1549a966, [uint(0x2ad7b1, 1000000), str(0x4d80, 'Yoddoy'), str(0x5741, 'Yoddoy Studio')]);
    const video = master(0xae, [
      uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, hevc ? 'V_MPEGH/ISO/HEVC' : 'V_MPEG4/ISO/AVC'), el(0x63a2, avcC),
      master(0xe0, [uint(0xb0, width), uint(0xba, height)]),
    ]);
    const aud = master(0xae, [
      uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), str(0x86, 'A_OPUS'), el(0x63a2, audio.opusHead),
      uint(0x56aa, 6500000), uint(0x56bb, 80000000), // CodecDelay / SeekPreRoll (ns) ตามที่ Opus ใน Matroska กำหนด
      master(0xe1, [float(0xb5, audio.sampleRate), uint(0x9f, audio.channels)]),
    ]);
    return cat([ebml, open(0x18538067), info, master(0x1654ae6b, [video, aud])]);
  }
  const cluster = (ms) => cat([open(0x1f43b675), uint(0xe7, ms)]);
  function block(track, relMs, key, data) {
    const head = new Uint8Array(4);
    head[0] = 0x80 | track;
    new DataView(head.buffer).setInt16(1, relMs);
    head[3] = key ? 0x80 : 0;
    return el(0xa3, cat([head, data]));
  }
  function opusHead(channels, sampleRate) {
    const b = new Uint8Array(19);
    b.set(enc.encode('OpusHead'));
    const v = new DataView(b.buffer);
    b[8] = 1;
    b[9] = channels;
    v.setUint16(10, 312, true); // pre-skip
    v.setUint32(12, sampleRate, true);
    v.setInt16(16, 0, true);
    b[18] = 0;
    return b;
  }
  return { header, cluster, block, opusHead };
})();

// ----- ตัวบีบอัด -----
const AVC_CODECS = (w, h, fps) => {
  // ระดับ H.264 ที่พอสำหรับความละเอียด/เฟรมเรต (สูงไว้ก่อน ไม่งั้นการ์ดจอบางรุ่นปฏิเสธ)
  const big = w * h * fps > 1920 * 1080 * 30;
  return big ? ['avc1.64002A', 'avc1.640033', 'avc1.4D402A'] : ['avc1.640028', 'avc1.64002A', 'avc1.4D4028'];
};

// H.265 (HEVC): คมกว่า H.264 มากที่บิตเรตเท่ากัน · YouTube รับได้ (Enhanced RTMP) · ช่องอื่น Helper แปลงเป็น H.264 ให้
const HEVC_CODECS = ['hvc1.1.6.L123.B0', 'hev1.1.6.L123.B0', 'hvc1.1.6.L120.B0'];

async function wcVideoConfig({ width, height, fps, kbps, hevc }) {
  if (!('VideoEncoder' in window) || !('MediaStreamTrackProcessor' in window) || !('AudioEncoder' in window)) return null;
  for (const codec of hevc ? HEVC_CODECS : AVC_CODECS(width, height, fps)) {
    for (const bitrateMode of ['constant', 'variable']) {
      // ตัวบีบของการ์ดจอผ่าน Chrome ใช้บิตจริงต่ำกว่าที่ตั้ง ~9% (วัดแล้ว) → ตั้งเผื่อให้ได้บิตเต็มตามแผน (ภาพคมขึ้น ไม่เกินเพดานแพลตฟอร์ม)
      const cfg = {
        codec, width, height, framerate: fps, bitrate: Math.round(kbps * 1000 * 1.08), bitrateMode,
        hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime',
        ...(hevc ? { hevc: { format: 'hevc' } } : { avc: { format: 'avc' } }),
      };
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s.supported) return s.config;
      } catch {}
    }
  }
  return null;
}

class WcRecorder {
  // opts: { videoTrack, audioTrack, width, height, fps, kbps, gopSec, config, audioKbps }
  constructor(opts) {
    this.o = opts;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
    this.stats = { dropped: 0, encoded: 0 };
  }

  emit(bytes) {
    if (this.ondataavailable) this.ondataavailable({ data: bytes });
  }

  fail(err) {
    if (this.state === 'inactive') return;
    this.stop();
    if (this.onerror) this.onerror({ error: err });
  }

  async start() {
    const o = this.o;
    this.state = 'recording';
    this.base = null; // เวลาเริ่ม (µs) ของสตรีม
    this.headerSent = false;
    this.pendingAudio = [];
    this.clusterMs = -1;
    this.frameNo = 0;
    const gop = Math.max(1, Math.round(o.fps * o.gopSec));

    this.venc = new VideoEncoder({
      output: (chunk, meta) => this.onVideo(chunk, meta),
      error: (e) => this.fail(e),
    });
    this.venc.configure(o.config);

    const settings = o.audioTrack.getSettings();
    this.audioParams = { sampleRate: settings.sampleRate || 48000, channels: Math.min(2, settings.channelCount || 2) };
    this.aenc = new AudioEncoder({
      output: (chunk) => this.onAudio(chunk),
      error: (e) => this.fail(e),
    });
    this.aenc.configure({ codec: 'opus', sampleRate: this.audioParams.sampleRate, numberOfChannels: this.audioParams.channels, bitrate: (o.audioKbps || 160) * 1000 });

    // อ่านเฟรมภาพจากแคนวาส (ตามจังหวะ fps ที่ตั้ง) → บีบ · ตัวบีบค้าง > 3 เฟรม = ข้ามเฟรมนี้ (ไม่ให้ดีเลย์สะสม)
    this.vreader = new MediaStreamTrackProcessor({ track: o.videoTrack }).readable.getReader();
    (async () => {
      while (this.state === 'recording') {
        const { value: frame, done } = await this.vreader.read().catch(() => ({ done: true }));
        if (done || !frame) break;
        if (this.state !== 'recording' || this.venc.state !== 'configured') { frame.close(); break; }
        // นาฬิกาของภาพ (เริ่มที่ 0) กับเสียง (นับตั้งแต่เปิดหน้า) คนละฐานกัน → แปลงเป็นเวลาเดียวกัน (performance.now) ตอนได้เฟรมแรก
        if (this.vOff === undefined) this.vOff = performance.now() * 1000 - frame.timestamp;
        if (this.venc.encodeQueueSize > 3) {
          this.stats.dropped++;
          frame.close();
          continue;
        }
        const key = this.frameNo % gop === 0;
        this.frameNo++;
        try { this.venc.encode(frame, { keyFrame: key }); } catch (e) { frame.close(); this.fail(e); break; }
        frame.close();
      }
    })();

    this.areader = new MediaStreamTrackProcessor({ track: o.audioTrack }).readable.getReader();
    (async () => {
      while (this.state === 'recording') {
        const { value: data, done } = await this.areader.read().catch(() => ({ done: true }));
        if (done || !data) break;
        if (this.state !== 'recording' || this.aenc.state !== 'configured') { data.close(); break; }
        if (this.aOff === undefined) this.aOff = performance.now() * 1000 - data.timestamp;
        try { this.aenc.encode(data); } catch (e) { data.close(); this.fail(e); break; }
        data.close();
      }
    })();
  }

  onVideo(chunk, meta) {
    if (this.state !== 'recording') return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    if (!this.headerSent) {
      const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (!desc || chunk.type !== 'key') return; // รอเฟรมหลักแรก (มีข้อมูลตั้งค่าตัวถอดรหัส)
      this.base = chunk.timestamp + this.vOff;
      this.emit(MKV.header({
        width: this.o.width, height: this.o.height, hevc: /^h(vc|ev)1/.test(this.o.config.codec),
        avcC: new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength)),
        audio: { ...this.audioParams, opusHead: MKV.opusHead(this.audioParams.channels, this.audioParams.sampleRate) },
      }));
      this.headerSent = true;
      for (const a of this.pendingAudio.splice(0)) this.writeBlock(2, a.ts, true, a.data);
    }
    this.stats.encoded++;
    this.writeBlock(1, chunk.timestamp + this.vOff, chunk.type === 'key', data);
  }

  onAudio(chunk) {
    if (this.state !== 'recording') return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    // เสียงมาเร็วกว่าภาพเฉลี่ย ~20ms (วัดจากไฟล์จริง: จอขาว + เสียงพร้อมกัน หลายรอบ) → เลื่อนเสียงให้ตรงกัน
    const ts = chunk.timestamp + (this.aOff || 0) + 20000;
    if (!this.headerSent) {
      this.pendingAudio.push({ ts, data });
      if (this.pendingAudio.length > 50) this.pendingAudio.shift();
      return;
    }
    this.writeBlock(2, ts, true, data);
  }

  writeBlock(track, tsUs, key, data) {
    if (this.base === null || tsUs < this.base) return; // เสียงก่อนภาพแรก → ทิ้ง
    let ms = Math.round((tsUs - this.base) / 1000);
    this.lastMs = this.lastMs || {};
    if (track === 1) {
      // ภาพ: จัดเวลาให้ลงช่องเฟรม (เช่นทุก 16.67ms ที่ 60fps) — เวลาจับภาพจริงแกว่ง 15–18ms ทำให้บางเฟรมชนช่องเดียวกัน
      // แพลตฟอร์มที่คาดหวังเฟรมสม่ำเสมออาจตัดเฟรมทิ้ง/ภาพสะดุด · คลาดไม่เกินครึ่งเฟรม (~8ms) ภาพ-เสียงยังตรงกัน
      const step = 1000 / this.o.fps;
      let q = Math.round(ms / step);
      if (this.lastQ !== undefined && q <= this.lastQ) q = this.lastQ + 1;
      this.lastQ = q;
      ms = Math.round(q * step);
    } else if (this.lastMs[track] !== undefined && ms <= this.lastMs[track]) {
      ms = this.lastMs[track] + 1; // เสียง: เวลาต้องเพิ่มขึ้นเสมอ
    }
    this.lastMs[track] = ms;
    // คลัสเตอร์ใหม่ทุกเฟรมหลักของภาพ (ปลายทางที่ต่อกลางสตรีมเริ่มได้ทันที) หรือเมื่อเวลาห่างเกินช่วงที่เก็บได้
    if (this.clusterMs < 0 || (track === 1 && key) || ms - this.clusterMs > 30000 || ms - this.clusterMs < -30000) {
      this.clusterMs = ms;
      this.emit(MKV.cluster(ms));
    }
    this.emit(MKV.block(track, ms - this.clusterMs, key, data));
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    try { this.vreader && this.vreader.cancel(); } catch {}
    try { this.areader && this.areader.cancel(); } catch {}
    try { this.venc && this.venc.state !== 'closed' && this.venc.close(); } catch {}
    try { this.aenc && this.aenc.state !== 'closed' && this.aenc.close(); } catch {}
  }
}

window.wcVideoConfig = wcVideoConfig;
window.WcRecorder = WcRecorder;
