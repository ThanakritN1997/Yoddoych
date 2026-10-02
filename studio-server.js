// สตูดิโอไลฟ์: รับวิดีโอจากเบราว์เซอร์ (WebM ผ่าน WebSocket) → FFmpeg เข้ารหัสครั้งเดียว → ตัวส่งต่อแยกต่อปลายทาง → RTMP/RTMPS ทุกแพลตฟอร์ม
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const FFMPEG_CANDIDATES = [process.env.FFMPEG, 'C:\\msys64\\ucrt64\\bin\\ffmpeg.exe', 'ffmpeg'].filter(Boolean);
const FFMPEG = FFMPEG_CANDIDATES.find((p) => p === 'ffmpeg' || fs.existsSync(p));

// ---------- ตรวจตัวเข้ารหัสที่ใช้ได้จริงบนเครื่องนี้ ----------
const ENCODERS = [
  { id: 'h264_nvenc', label: 'NVIDIA (NVENC) — การ์ดจอ' },
  { id: 'h264_qsv', label: 'Intel Quick Sync — การ์ดจอ' },
  { id: 'h264_amf', label: 'AMD (AMF) — การ์ดจอ' },
  { id: 'libx264', label: 'x264 — ซีพียู' },
];
let available = null;

function detectEncoders() {
  if (available) return available;
  available = ENCODERS.filter((e) => {
    const r = spawnSync(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30', '-frames:v', '3', '-c:v', e.id, '-f', 'null', '-'],
      { timeout: 15000, windowsHide: true },
    );
    return r.status === 0;
  });
  return available;
}

// โหมดดีเลย์: low = หน่วงน้อยสุด (keyframe ทุก 1 วิ, บัฟเฟอร์ 1 วิ, ไม่มี B-frame)
//             normal = สมดุล · stable = ภาพคมสุด/ทนเน็ตแกว่ง แต่หน่วงกว่า
const LATENCY = {
  low: { gopSec: 1, buf: 1, bframes: false },
  normal: { gopSec: 2, buf: 1.5, bframes: true },
  stable: { gopSec: 2, buf: 2, bframes: true },
};

function videoArgs(enc, kbps, fps, latency = 'normal') {
  const L = LATENCY[latency] || LATENCY.normal;
  const b = `${kbps}k`;
  const buf = `${Math.round(kbps * L.buf)}k`;
  const gop = String(fps * L.gopSec); // keyframe ทุก 1–2 วินาที ตามที่ YouTube/Facebook/TikTok กำหนด
  const common = ['-b:v', b, '-maxrate', b, '-bufsize', buf, '-g', gop, '-keyint_min', gop, '-pix_fmt', 'yuv420p'];
  const noB = L.bframes ? [] : ['-bf', '0'];
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', latency === 'stable' ? 'hq' : 'll', '-rc', 'cbr', '-profile:v', 'high', '-forced-idr', '1',
        ...(latency === 'low' ? ['-zerolatency', '1', '-delay', '0'] : []), ...noB, ...common];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', '-profile:v', 'high', ...(latency === 'low' ? ['-low_delay_brc', '1'] : []), ...noB, ...common];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', latency === 'stable' ? 'transcoding' : 'lowlatency', '-rc', 'cbr', '-profile:v', 'high', ...noB, ...common];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', ...(latency === 'stable' ? [] : ['-tune', 'zerolatency']), '-profile:v', 'high', '-sc_threshold', '0', '-x264-params', 'nal-hrd=cbr', ...noB, ...common];
  }
}

// ตัวเข้ารหัส: รับ WebM จากเบราว์เซอร์ → บีบอัดครั้งเดียว → MPEG-TS ออกทาง stdout
// (TS ต่อกลางสตรีมได้ทุกเมื่อ ตัวส่งต่อที่เริ่มใหม่จึงเริ่มอ่านได้ทันที)
function encoderArgs(cfg) {
  const { width, height, fps, videoKbps, audioKbps, encoder, latency } = cfg;
  return [
    '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '1',
    // โหมดดีเลย์ต่ำ: ไม่รอวิเคราะห์ input นาน (รูปแบบจากเบราว์เซอร์รู้อยู่แล้ว)
    // รูปแบบ input จากเบราว์เซอร์รู้อยู่แล้ว (WebM) → วิเคราะห์สั้น ๆ พอ
    // (ค่าเริ่มต้น 5 วินาทีทำให้วิดีโอค้างสะสมตอนเริ่ม แล้ว FFmpeg ต้องเร่งส่งไล่ตาม = ข้อมูลที่ส่งไลฟ์ไม่สม่ำเสมอช่วงแรก)
    ...(latency === 'low'
      ? ['-fflags', '+genpts+nobuffer', '-flags', 'low_delay', '-probesize', '256k', '-analyzeduration', '500000']
      : ['-fflags', '+genpts', '-probesize', '1M', '-analyzeduration', '1000000']),
    '-thread_queue_size', '1024', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
    '-fps_mode', 'cfr',
    ...videoArgs(encoder, videoKbps, fps, latency),
    '-bsf:v', 'dump_extra=freq=keyframe', // ใส่ SPS/PPS ทุก keyframe ให้ปลายทางที่ต่อใหม่ถอดรหัสได้
    '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ar', '48000', '-ac', '2',
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-muxpreload', '0', '-flush_packets', '1',
    'pipe:1',
  ];
}

// ตัวส่งต่อ 1 ตัวต่อ 1 ปลายทาง: ไม่บีบอัดซ้ำ (copy) แค่ห่อเป็น FLV แล้วส่ง RTMP
// หลุดเมื่อไหร่ → เปิดตัวใหม่ = เชื่อมต่อใหม่พร้อม header ครบ (ไม่ใช่ต่อสายเดิมกลางคัน)
function relayArgs(target) {
  return [
    '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '2',
    // วิเคราะห์สตรีมแค่ ~3 วินาที (ค่าเริ่มต้น 5) ให้ต่อใหม่ได้เร็วขึ้น — ต้องนานกว่าระยะ keyframe (2 วินาที)
    // เพราะตัวที่เริ่มกลางสตรีมต้องรอเจอ keyframe + SPS/PPS ก่อนจึงจะรู้รูปแบบวิดีโอ
    '-fflags', '+genpts+discardcorrupt', '-analyzeduration', '3000000', '-probesize', '4000000', '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy',
    '-f', 'flv', '-flvflags', 'no_duration_filesize', target,
  ];
}

// อัดไฟล์: รับ TS ชุดเดียวกับที่ส่งไลฟ์ → ห่อเป็น MP4 (ไม่บีบอัดซ้ำ ไม่กินเครื่องเพิ่ม)
// ใช้ MP4 แบบแบ่งท่อน (fragmented) → ถ้าเครื่องดับ/โปรแกรมปิดกลางคัน ไฟล์ส่วนที่อัดแล้วยังเปิดได้
const REC_DIR = path.join(os.homedir(), 'Videos', 'Yoddoy');
function recordArgs(file) {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt', '-analyzeduration', '3000000', '-probesize', '4000000', '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', // เสียง AAC ใน TS (ADTS) → รูปแบบที่ MP4 ต้องการ
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', file,
  ];
}
function recFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Yoddoy-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.mp4`;
}

function joinUrl(url, key) {
  url = String(url || '').trim();
  key = String(key || '').trim();
  if (!key) return url;
  return url.endsWith('/') ? url + key : url + '/' + key;
}

// ---------- ทดสอบความเร็วอัปโหลดอินเทอร์เน็ต ----------
function uploadOnce(bytes) {
  return new Promise((resolve, reject) => {
    const body = crypto.randomBytes(bytes);
    const req = https.request(
      { host: 'speed.cloudflare.com', path: '/__up', method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes }, timeout: 30000 },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

async function speedTest() {
  await uploadOnce(256 * 1024); // วอร์มอัปการเชื่อมต่อ
  const size = 6 * 1024 * 1024;
  const streams = 3;
  const t0 = process.hrtime.bigint();
  await Promise.all(Array.from({ length: streams }, () => uploadOnce(size)));
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  return { uploadMbps: +((size * streams * 8) / sec / 1e6).toFixed(1) };
}

// ---------- WebSocket /studio ----------
const RELAY_MAX_BUFFER = 8 * 1024 * 1024; // ปลายทางที่ค้างเกิน ~8MB (หลายวินาที) = เน็ตไม่พอ/ค้าง → ตัดแล้วต่อใหม่
const RELAY_RETRY_MS = [1000, 2000, 3000, 5000, 8000]; // หน่วงก่อนต่อใหม่ (เพิ่มขึ้นถ้าหลุดติดกัน)
const num = (line, key) => {
  const m = line.match(new RegExp(key + '=\\s*([\\d.]+)'));
  return m ? parseFloat(m[1]) : 0;
};
function eachLine(stream, fn) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r|\n/);
    buf = lines.pop();
    for (const l of lines) if (l.trim()) fn(l.trim());
  });
}

// ข้อความจากหน้าสตูดิโอ:
//   start   { ...ภาพ/บิตเรต, destinations[], record } → เปิดตัวเข้ารหัส + ไลฟ์ (ถ้ามีปลายทาง) + อัดไฟล์ (ถ้าเลือก)
//   golive  { destinations[], delaySec } → เริ่มไลฟ์ระหว่างที่กำลังอัดอยู่
//   endlive → หยุดไลฟ์ (ถ้ายังอัดอยู่ ตัวเข้ารหัสทำงานต่อ)
//   record  { on } → เริ่ม/หยุดอัดไฟล์ระหว่างไลฟ์
//   stop    → หยุดทั้งหมด
// ไม่มีทั้งไลฟ์และอัดไฟล์เหลืออยู่ → ปิดตัวเข้ารหัสเอง
function attach() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  wss.on('connection', (ws) => {
    let session = null;
    const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

    function stop(reason) {
      if (!session) return;
      const s = session;
      session = null;
      s.stopped = true;
      clearInterval(s.delayTimer);
      killRelays(s);
      stopRecording(s);
      try { s.encoder.stdin.end(); } catch {}
      setTimeout(() => s.encoder.kill('SIGKILL'), 3000);
      send({ type: 'stopped', reason });
    }

    function killRelays(s) {
      for (const r of s.relays) {
        clearTimeout(r.timer);
        r.dead = true;
        if (r.proc) r.proc.kill('SIGKILL');
      }
      s.relays = [];
      s.queue = [];
    }

    // ไม่มีอะไรใช้ตัวเข้ารหัสแล้ว → ปิด
    function stopIfIdle(s, reason) {
      if (!s.relays.length && !s.rec) stop(reason);
    }

    function startRelay(s, r) {
      if (s.stopped || r.dead) return;
      r.state = r.connects ? 'reconnecting' : 'connecting';
      r.connects++;
      r.bytes = 0;
      const proc = spawn(FFMPEG, relayArgs(r.target), { windowsHide: true });
      r.proc = proc;
      r.startedAt = Date.now();
      proc.stdin.on('error', () => {});
      eachLine(proc.stderr, (raw) => {
        const line = s.hide(raw);
        if (line.startsWith('frame=') || line.startsWith('size=')) {
          // มีสถิติไหลออก = ส่งถึงปลายทางแล้ว
          r.state = 'live';
          r.kbps = num(line, 'bitrate');
          if (Date.now() - r.startedAt > 20000) r.fails = 0; // ต่อได้นานพอ → รีเซ็ตตัวนับการหลุด
          return;
        }
        send({ type: 'log', line: `[${r.name}] ${line}` });
      });
      proc.on('exit', (code) => {
        if (r.proc !== proc) return;
        r.proc = null;
        if (s.stopped || r.dead) return;
        r.state = 'error';
        r.kbps = 0;
        const wait = RELAY_RETRY_MS[Math.min(r.fails, RELAY_RETRY_MS.length - 1)];
        r.fails++;
        send({ type: 'log', line: `[${r.name}] การเชื่อมต่อหลุด (code ${code}) — ต่อใหม่ใน ${wait / 1000} วินาที (ครั้งที่ ${r.connects})` });
        r.timer = setTimeout(() => startRelay(s, r), wait);
      });
    }

    // ตรวจปลายทาง → คืนข้อความผิดพลาด หรือ null
    function checkDests(list) {
      const bad = list.find((d) => !/^rtmps?:\/\/[^\s]+$/i.test(String(d.url).trim()));
      return bad ? `${bad.name}: Server URL ต้องขึ้นต้นด้วย rtmp:// หรือ rtmps://` : null;
    }

    function goLive(s, list, delaySec) {
      killRelays(s);
      s.delayMs = Math.min(300, Math.max(0, Number(delaySec) || 0)) * 1000; // หน่วงเพิ่มตั้งใจ สูงสุด 5 นาที
      const secrets = list.map((d) => String(d.key || '').trim()).filter((k) => k.length > 3);
      s.secrets = secrets;
      s.relays = list.map((d) => ({ name: d.name, target: joinUrl(d.url, d.key), state: 'connecting', connects: 0, fails: 0, kbps: 0, proc: null, timer: null }));
      s.relays.forEach((r) => startRelay(s, r));
    }

    function startRecording(s) {
      if (s.rec) return;
      try {
        fs.mkdirSync(REC_DIR, { recursive: true });
      } catch (e) {
        return send({ type: 'error', message: 'สร้างโฟลเดอร์เก็บไฟล์ไม่ได้: ' + e.message });
      }
      const file = path.join(REC_DIR, recFileName());
      const proc = spawn(FFMPEG, recordArgs(file), { windowsHide: true });
      const rec = { proc, file, bytes: 0, startedAt: Date.now() };
      s.rec = rec;
      proc.stdin.on('error', () => {});
      eachLine(proc.stderr, (line) => send({ type: 'log', line: `[อัดไฟล์] ${line}` }));
      proc.on('exit', (code) => {
        if (s.rec === rec) {
          // ตัวอัดดับเอง (ดิสก์เต็ม ฯลฯ) — ไลฟ์ยังไปต่อ
          s.rec = null;
          send({ type: 'record', on: false, file, error: `อัดไฟล์หยุดกะทันหัน (code ${code}) — ดิสก์อาจเต็ม` });
          if (!s.stopped) stopIfIdle(s, 'อัดไฟล์หยุดแล้ว');
          return;
        }
        send({ type: 'record', on: false, file, saved: true, bytes: rec.bytes, sec: Math.round((Date.now() - rec.startedAt) / 1000) });
      });
      send({ type: 'record', on: true, file });
    }

    function stopRecording(s) {
      const rec = s.rec;
      if (!rec) return;
      s.rec = null;
      try { rec.proc.stdin.end(); } catch {} // ปิดท่อ → FFmpeg เขียนท้ายไฟล์ให้ครบแล้วออกเอง
      setTimeout(() => rec.proc.exitCode === null && rec.proc.kill('SIGKILL'), 8000);
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const enc = session && session.encoder;
        if (enc && enc.stdin.writable) enc.stdin.write(data);
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'start') {
        if (session) stop('restart');
        const enabled = (msg.destinations || []).filter((d) => d.url);
        if (!enabled.length && !msg.record) return send({ type: 'error', message: 'ยังไม่ได้ใส่ปลายทางที่จะไลฟ์' });
        const err = checkDests(enabled);
        if (err) return send({ type: 'error', message: err });
        const encs = detectEncoders().map((e) => e.id);
        const cfg = {
          width: Math.min(3840, Math.max(320, msg.width | 0)) & ~1,
          height: Math.min(3840, Math.max(320, msg.height | 0)) & ~1,
          fps: [24, 25, 30, 50, 60].includes(msg.fps) ? msg.fps : 30,
          videoKbps: Math.min(20000, Math.max(300, msg.videoKbps | 0)),
          audioKbps: [96, 128, 160, 192].includes(msg.audioKbps) ? msg.audioKbps : 160,
          encoder: encs.includes(msg.encoder) ? msg.encoder : encs[0] || 'libx264',
          latency: LATENCY[msg.latency] ? msg.latency : 'normal',
        };
        const s = {
          stopped: false,
          relays: [],
          queue: [],
          secrets: [],
          delayMs: 0,
          rec: null,
          hide: (line) => s.secrets.reduce((acc, k) => acc.split(k).join('••••'), line),
        };
        s.publicDests = () => s.relays.map((r) => ({ name: r.name, state: r.state, kbps: r.kbps, reconnects: Math.max(0, r.connects - 1) }));

        s.encoder = spawn(FFMPEG, encoderArgs(cfg), { windowsHide: true });
        session = s;
        s.encoder.stdin.on('error', () => {});

        // แจกข้อมูลที่บีบอัดแล้วให้ทุกปลายทาง — ปลายทางที่ค้างจะไม่ฉุดตัวอื่น
        const distribute = (chunk) => {
          for (const r of s.relays) {
            if (!r.proc || !r.proc.stdin.writable) continue;
            if (r.proc.stdin.writableLength > RELAY_MAX_BUFFER) {
              send({ type: 'log', line: `[${r.name}] ส่งไม่ทัน (อัปโหลดไม่พอหรือปลายทางค้าง) — ตัดแล้วต่อใหม่` });
              r.proc.kill('SIGKILL');
              continue;
            }
            r.proc.stdin.write(chunk);
          }
        };
        s.encoder.stdout.on('data', (chunk) => {
          // ไฟล์อัด: ได้ภาพทันทีไม่หน่วง (ดีเลย์ตั้งใจมีผลกับไลฟ์เท่านั้น)
          if (s.rec && s.rec.proc.stdin.writable) {
            s.rec.bytes += chunk.length;
            s.rec.proc.stdin.write(chunk);
          }
          if (!s.relays.length) return;
          if (s.delayMs > 0) s.queue.push({ t: Date.now(), chunk });
          else distribute(chunk);
        });
        // หน่วงเวลาเพิ่ม: เก็บข้อมูลไว้ในคิว แล้วค่อยปล่อยเมื่อครบเวลา (ทุกปลายทางหน่วงเท่ากัน)
        s.delayTimer = setInterval(() => {
          const due = Date.now() - s.delayMs;
          while (s.queue.length && s.queue[0].t <= due) distribute(s.queue.shift().chunk);
        }, 50);

        eachLine(s.encoder.stderr, (raw) => {
          const line = s.hide(raw);
          if (line.startsWith('frame=')) {
            const rec = s.rec && { sec: Math.round((Date.now() - s.rec.startedAt) / 1000), bytes: s.rec.bytes };
            send({ type: 'stats', fps: num(line, 'fps'), kbps: 0, dup: num(line, 'dup'), drop: num(line, 'drop'), speed: num(line, 'speed'), dests: s.publicDests(), rec });
            return;
          }
          send({ type: 'log', line: `[encoder] ${line}` });
        });
        s.encoder.on('exit', (code) => {
          if (session !== s) return;
          stop(code === 0 ? 'จบการไลฟ์' : `ตัวเข้ารหัสหยุดทำงาน (code ${code}) — กดเริ่มไลฟ์ใหม่`);
        });
        s.encoder.on('error', (e) => send({ type: 'error', message: 'เปิด FFmpeg ไม่ได้: ' + e.message }));

        if (msg.record) startRecording(s);
        if (enabled.length) goLive(s, enabled, msg.delaySec);
        send({ type: 'started', encoder: cfg.encoder, latency: cfg.latency, delaySec: s.delayMs / 1000, live: enabled.length > 0, dests: s.publicDests() });
      }

      if (msg.type === 'golive' && session) {
        const enabled = (msg.destinations || []).filter((d) => d.url);
        if (!enabled.length) return send({ type: 'error', message: 'ยังไม่ได้ใส่ปลายทางที่จะไลฟ์' });
        const err = checkDests(enabled);
        if (err) return send({ type: 'error', message: err });
        goLive(session, enabled, msg.delaySec);
        send({ type: 'live', on: true, delaySec: session.delayMs / 1000, dests: session.publicDests() });
      }

      if (msg.type === 'endlive' && session) {
        killRelays(session);
        send({ type: 'live', on: false });
        stopIfIdle(session, 'หยุดไลฟ์แล้ว');
      }

      if (msg.type === 'record' && session) {
        if (msg.on) startRecording(session);
        else {
          stopRecording(session);
          stopIfIdle(session, 'หยุดอัดแล้ว');
        }
      }

      if (msg.type === 'stop') stop('หยุดไลฟ์แล้ว');
    });

    ws.on('close', () => stop('ปิดหน้าสตูดิโอ'));
  });

  return wss;
}

// ---------- โหลดรูปจากลิงก์แทนเบราว์เซอร์ (เว็บที่ไม่เปิด CORS) ----------
const IMAGE_MAX = 15 * 1024 * 1024;
const privateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.)/i.test(h);
function fetchImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('ลิงก์ไม่ถูกต้อง')); }
    if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return reject(new Error('ลิงก์ไม่อนุญาต'));
    const mod = u.protocol === 'https:' ? https : require('http');
    const req = mod.get(u, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 YoddoyHelper', Accept: 'image/*' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        return fetchImage(new URL(r.headers.location, u).href, redirects - 1).then(resolve, reject);
      }
      const type = String(r.headers['content-type'] || '');
      if (r.statusCode !== 200 || !type.startsWith('image/')) {
        r.resume();
        return reject(new Error('ลิงก์นี้ไม่ใช่ไฟล์รูป'));
      }
      const parts = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > IMAGE_MAX) req.destroy(new Error('รูปใหญ่เกิน 15MB'));
        else parts.push(c);
      });
      r.on('end', () => resolve({ type, body: Buffer.concat(parts) }));
      r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---------- HTTP API ----------
async function handleApi(req, res) {
  const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  if (req.url.startsWith('/api/image?') && req.method === 'GET') {
    try {
      const img = await fetchImage(new URL(req.url, 'http://x').searchParams.get('url'));
      return res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'no-store' }).end(img.body);
    } catch (e) {
      return json(400, { error: e.message });
    }
  }
  // ไฟล์ที่อัดไว้ล่าสุด
  if (req.url === '/api/recordings' && req.method === 'GET') {
    let files = [];
    try {
      files = fs.readdirSync(REC_DIR).filter((f) => /\.mp4$/i.test(f)).map((f) => {
        const st = fs.statSync(path.join(REC_DIR, f));
        return { name: f, bytes: st.size, mtime: st.mtimeMs };
      }).sort((a, b) => b.mtime - a.mtime).slice(0, 20);
    } catch {}
    return json(200, { dir: REC_DIR, files });
  }
  // เปิดโฟลเดอร์ไฟล์อัดใน Explorer — POST + JSON เท่านั้น (เว็บอื่นยิงมาแบบ <img>/ฟอร์มไม่ได้)
  if (req.url === '/api/recordings/open' && req.method === 'POST') {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'json only' });
    let body = '';
    for await (const c of req) if ((body += c).length > 4096) return json(413, {});
    let name = '';
    try { name = String(JSON.parse(body || '{}').name || ''); } catch {}
    try { fs.mkdirSync(REC_DIR, { recursive: true }); } catch {}
    const file = name && path.join(REC_DIR, path.basename(name));
    const args = file && fs.existsSync(file) ? ['/select,', file] : [REC_DIR];
    if (process.platform === 'win32') spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
    return json(200, { ok: true });
  }
  if (req.url === '/api/encoders') {
    return json(200, { ffmpeg: !!FFMPEG, encoders: detectEncoders() });
  }
  if (req.url === '/api/speedtest' && req.method === 'POST') {
    try {
      return json(200, await speedTest());
    } catch (e) {
      return json(502, { error: 'ทดสอบความเร็วไม่สำเร็จ: ' + e.message });
    }
  }
  return false;
}

module.exports = { attach, handleApi, detectEncoders, _test: { encoderArgs, relayArgs, recordArgs, REC_DIR, FFMPEG } };
