// สตูดิโอไลฟ์: รับวิดีโอจากเบราว์เซอร์ (WebM ผ่าน WebSocket) → FFmpeg เข้ารหัสครั้งเดียว → ส่ง RTMP/RTMPS ไปทุกแพลตฟอร์มพร้อมกัน
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
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

function videoArgs(enc, kbps, fps) {
  const b = `${kbps}k`;
  const buf = `${kbps * 2}k`;
  const gop = String(fps * 2); // keyframe ทุก 2 วินาที ตามที่ YouTube/Facebook/TikTok กำหนด
  const common = ['-b:v', b, '-maxrate', b, '-bufsize', buf, '-g', gop, '-keyint_min', gop, '-pix_fmt', 'yuv420p'];
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-profile:v', 'high', '-forced-idr', '1', ...common];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', '-profile:v', 'high', ...common];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-rc', 'cbr', '-profile:v', 'high', ...common];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high', '-sc_threshold', '0', '-x264-params', 'nal-hrd=cbr', ...common];
  }
}

// เครื่องหมายพิเศษของ tee muxer ต้อง escape
const teeEscape = (s) => s.replace(/[\\|[\]]/g, (c) => '\\' + c);

function buildArgs(cfg) {
  const { width, height, fps, videoKbps, audioKbps, encoder } = cfg;
  const outputs = cfg.destinations.map((d) => `[f=flv:onfail=ignore:flvflags=no_duration_filesize]${teeEscape(d.target)}`).join('|');
  return [
    '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '1',
    '-thread_queue_size', '1024', '-fflags', '+genpts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
    '-fps_mode', 'cfr',
    ...videoArgs(encoder, videoKbps, fps),
    '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ar', '48000', '-ac', '2',
    '-f', 'tee', '-use_fifo', '1',
    // คิวแยกต่อปลายทาง: ปลายทางไหนช้า/หลุดจะไม่ฉุดตัวอื่น และจะพยายามต่อใหม่เองทุก 3 วินาที
    '-fifo_options', 'attempt_recovery=1:recover_any_error=1:recovery_wait_time=3:drop_pkts_on_overflow=1:queue_size=120',
    outputs,
  ];
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
function attach() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  wss.on('connection', (ws) => {
    let ff = null;
    let secrets = [];
    let dests = [];
    const hide = (line) => secrets.reduce((s, k) => (k ? s.split(k).join('••••') : s), line);
    const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

    function stop(reason) {
      if (!ff) return;
      try { ff.stdin.end(); } catch {}
      const p = ff;
      ff = null;
      setTimeout(() => p.kill('SIGKILL'), 3000);
      send({ type: 'stopped', reason });
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (ff && ff.stdin.writable) ff.stdin.write(data);
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'start') {
        if (ff) stop('restart');
        const enabled = (msg.destinations || []).filter((d) => d.url);
        if (!enabled.length) return send({ type: 'error', message: 'ยังไม่ได้ใส่ปลายทางที่จะไลฟ์' });
        const bad = enabled.find((d) => !/^rtmps?:\/\/[^\s]+$/i.test(String(d.url).trim()));
        if (bad) return send({ type: 'error', message: `${bad.name}: Server URL ต้องขึ้นต้นด้วย rtmp:// หรือ rtmps://` });
        const encs = detectEncoders().map((e) => e.id);
        const cfg = {
          width: Math.min(3840, Math.max(320, msg.width | 0)) & ~1,
          height: Math.min(3840, Math.max(320, msg.height | 0)) & ~1,
          fps: [24, 25, 30, 50, 60].includes(msg.fps) ? msg.fps : 30,
          videoKbps: Math.min(20000, Math.max(300, msg.videoKbps | 0)),
          audioKbps: [96, 128, 160, 192].includes(msg.audioKbps) ? msg.audioKbps : 160,
          encoder: encs.includes(msg.encoder) ? msg.encoder : encs[0] || 'libx264',
          destinations: enabled.map((d) => ({ name: d.name, target: joinUrl(d.url, d.key) })),
        };
        secrets = enabled.map((d) => String(d.key || '').trim()).filter((k) => k.length > 3);
        // match = URL ที่ซ่อนคีย์แล้ว ใช้จับว่าข้อความ error ของ FFmpeg เป็นของปลายทางไหน
        dests = cfg.destinations.map((d) => ({ name: d.name, state: 'connecting', match: hide(d.target), lastError: 0 }));
        const publicDests = () => dests.map(({ name, state }) => ({ name, state }));

        const proc = spawn(FFMPEG, buildArgs(cfg), { windowsHide: true });
        ff = proc;
        proc.stdin.on('error', () => {});
        const started = Date.now();
        const num = (line, key) => {
          const m = line.match(new RegExp(key + '=\\s*([\\d.]+)'));
          return m ? parseFloat(m[1]) : 0;
        };
        let buf = '';
        proc.stderr.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split(/\r|\n/);
          buf = lines.pop();
          for (const raw of lines) {
            const line = hide(raw.trim());
            if (!line) continue;
            if (line.startsWith('frame=')) {
              const now = Date.now();
              for (const d of dests) {
                // FIFO ลองต่อใหม่ทุก 3 วินาที → ถ้าไม่มี error ของปลายทางนี้เกิน 8 วินาที ถือว่าออนไลน์
                if (d.state === 'failed') continue;
                if (now - d.lastError < 8000) d.state = 'error';
                else if (now - started > 5000) d.state = 'live';
              }
              send({ type: 'stats', fps: num(line, 'fps'), kbps: num(line, 'bitrate'), dup: num(line, 'dup'), drop: num(line, 'drop'), speed: num(line, 'speed'), dests: publicDests() });
              continue;
            }
            const slave = line.match(/Slave muxer #(\d+) failed/);
            if (slave && dests[+slave[1]]) dests[+slave[1]].state = 'failed';
            if (/error|failed/i.test(line)) dests.forEach((d) => line.includes(d.match) && (d.lastError = Date.now()));
            send({ type: 'log', line });
          }
        });
        proc.on('exit', (code) => {
          if (ff !== proc) return;
          ff = null;
          send({ type: 'stopped', reason: code === 0 ? 'จบการไลฟ์' : `FFmpeg หยุดทำงาน (code ${code})` });
        });
        proc.on('error', (e) => send({ type: 'error', message: 'เปิด FFmpeg ไม่ได้: ' + e.message }));
        send({ type: 'started', encoder: cfg.encoder, dests: publicDests() });
      }

      if (msg.type === 'stop') stop('หยุดไลฟ์แล้ว');
    });

    ws.on('close', () => stop('ปิดหน้าสตูดิโอ'));
  });

  return wss;
}

// ---------- HTTP API ----------
async function handleApi(req, res) {
  const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
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

module.exports = { attach, handleApi, detectEncoders };
