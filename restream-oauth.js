// เชื่อม Restream (OAuth ทางการของ Restream) — ทำงานบนเว็บออนไลน์ (Vercel) เพราะต้องเก็บรหัสลับของแอป (Client Secret)
// ไว้ฝั่งเซิร์ฟเวอร์เท่านั้น · ตั้งค่าใน Vercel → Settings → Environment Variables:
//   RESTREAM_CLIENT_ID, RESTREAM_CLIENT_SECRET (จาก developers.restream.io → Applications)
// Redirect URI ในแอป Restream: https://yoddoych.vercel.app/oauth/restream/callback
//
// /oauth/restream/start?origin=…   → ไปหน้าขออนุญาตของ Restream
// /oauth/restream/callback           → แลกโค้ดเป็นโทเคน แล้วส่งกลับหน้าสตูดิโอ (postMessage) — ไม่เก็บโทเคนไว้ที่เซิร์ฟเวอร์
// POST /oauth/restream/refresh       → ต่ออายุโทเคน (โทเคนหมดอายุทุก 1 ชม.)
// /oauth/restream/api?path=…         → ส่งต่อคำขอไป api.restream.io เฉพาะเส้นทางที่อนุญาต
const https = require('https');
const crypto = require('crypto');

const API = 'api.restream.io';
const CLIENT_ID = () => process.env.RESTREAM_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.RESTREAM_CLIENT_SECRET || '';
// เส้นทาง API ที่หน้าเว็บเรียกได้ (โปรไฟล์ · คีย์สตรีม · ช่อง · ชื่อไลฟ์)
const ALLOWED_PATHS = /^(user\/(profile|streamKey|channel|channel\/\d+|channel-meta\/\d+)|platform\/all)$/;

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: API, path, method, headers, timeout: 15000 }, (r) => {
      const parts = [];
      r.on('data', (c) => parts.push(c));
      r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'] || 'application/json', body: Buffer.concat(parts) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

function tokenRequest(fields) {
  const body = new URLSearchParams(fields).toString();
  const basic = Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64');
  return request('POST', '/oauth/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    Authorization: 'Basic ' + basic,
  }, body);
}

async function readBody(req, max = 8192) {
  let s = '';
  for await (const c of req) if ((s += c).length > max) throw new Error('too large');
  return s;
}

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

function page(res, status, title, script) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yoddoy × Restream</title>
<body style="font-family:system-ui,'Noto Sans Thai',sans-serif;background:#0b0d12;color:#eceff5;display:grid;place-items:center;min-height:90vh;text-align:center">
<div><h2>${title}</h2><p style="color:#8d96a7">ปิดหน้าต่างนี้ได้</p></div>${script ? `<script>${script}</script>` : ''}</body>`);
}

// originAllowed: เว็บที่อนุญาตให้รับโทเคน/เรียก API (ใช้ชุดเดียวกับ server.js)
function create(originAllowed) {
  function cors(req, res) {
    const o = req.headers.origin;
    if (o && originAllowed(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  }
  const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
  const selfUrl = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/oauth\/restream\//, '');
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (route === 'status') return json(res, 200, { configured: !!(CLIENT_ID() && CLIENT_SECRET()) });

    if (route === 'start') {
      if (!CLIENT_ID() || !CLIENT_SECRET()) return page(res, 503, 'ยังไม่ได้ตั้งค่าแอป Restream บนเซิร์ฟเวอร์ (RESTREAM_CLIENT_ID / RESTREAM_CLIENT_SECRET)');
      const origin = url.searchParams.get('origin') || '';
      if (!originAllowed(origin)) return page(res, 400, 'หน้าเว็บนี้ไม่ได้รับอนุญาต');
      const state = crypto.randomBytes(16).toString('hex');
      // จำ state + หน้าที่ขอไว้ในคุกกี้ (กันคนอื่นปลอมคำตอบ — CSRF)
      res.setHeader('Set-Cookie', `rs_state=${encodeURIComponent(state + '|' + origin)}; Path=/oauth/restream; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
      const to = `https://${API}/login?` + new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID(), redirect_uri: selfUrl(req) + '/oauth/restream/callback', state });
      return res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }).end();
    }

    if (route === 'callback') {
      const [state, origin] = String(cookies(req).rs_state || '').split('|');
      res.setHeader('Set-Cookie', 'rs_state=; Path=/oauth/restream; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      if (url.searchParams.get('error')) return page(res, 400, 'ยกเลิกการเชื่อมต่อ Restream แล้ว');
      if (!state || state !== url.searchParams.get('state') || !originAllowed(origin)) return page(res, 400, 'คำขอหมดอายุหรือไม่ถูกต้อง — ลองกดเชื่อมต่อใหม่');
      try {
        const r = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: selfUrl(req) + '/oauth/restream/callback', code: url.searchParams.get('code') || '' });
        const t = JSON.parse(r.body.toString() || '{}');
        if (r.status !== 200 || !t.access_token) return page(res, 502, 'Restream ไม่ยอมให้เชื่อมต่อ — ลองใหม่อีกครั้ง');
        const payload = { type: 'restream-auth', access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
        // ส่งโทเคนกลับไปเฉพาะหน้าที่ขอ (origin ตรงเป๊ะ) แล้วปิดหน้าต่าง
        return page(res, 200, 'เชื่อมต่อ Restream แล้ว ✅',
          `try{window.opener&&window.opener.postMessage(${JSON.stringify(payload)},${JSON.stringify(origin)})}catch(e){};setTimeout(function(){window.close()},800)`);
      } catch {
        return page(res, 502, 'ติดต่อ Restream ไม่ได้ — ลองใหม่อีกครั้ง');
      }
    }

    if (route === 'refresh' && req.method === 'POST') {
      if (!originAllowed(req.headers.origin || '')) return json(res, 403, { error: 'origin' });
      try {
        const { refresh } = JSON.parse(await readBody(req));
        const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: String(refresh || '') });
        const t = JSON.parse(r.body.toString() || '{}');
        if (r.status !== 200 || !t.access_token) return json(res, 401, { error: 'refresh failed' });
        return json(res, 200, { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
      } catch {
        return json(res, 502, { error: 'refresh error' });
      }
    }

    if (route === 'api') {
      if (!originAllowed(req.headers.origin || '')) return json(res, 403, { error: 'origin' });
      const p = url.searchParams.get('path') || '';
      if (!ALLOWED_PATHS.test(p) || !['GET', 'PATCH'].includes(req.method)) return json(res, 400, { error: 'path' });
      const auth = String(req.headers.authorization || '');
      if (!/^Bearer [\w.-]+$/.test(auth)) return json(res, 401, { error: 'token' });
      try {
        const body = req.method === 'PATCH' ? await readBody(req) : undefined;
        const r = await request(req.method, '/v2/' + p, { Authorization: auth, 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, body);
        return res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' }).end(r.body);
      } catch {
        return json(res, 502, { error: 'restream unreachable' });
      }
    }

    return json(res, 404, { error: 'not found' });
  };
}

module.exports = { create, _test: { ALLOWED_PATHS } };
