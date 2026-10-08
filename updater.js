// อัปเดต Yoddoy Helper ในตัว: โหลดเฉพาะโฟลเดอร์ app (ไม่กี่ร้อย KB) จาก GitHub Releases แล้วรีสตาร์ตตัวเอง
// ไฟล์ข้อมูลเวอร์ชัน: releases/latest/download/latest.json
//   { version, app: { url, sha256 }, minFullVersion, fullUrl }
//   minFullVersion = เวอร์ชันต่ำสุดที่อัปเดตแบบเล็กได้ (ถ้าเปลี่ยนไฟล์โปรแกรมใหญ่ เช่น FFmpeg/UxPlay → ต้องโหลดตัวเต็ม)
// ขั้นตอน: โหลด → ตรวจ SHA-256 → แตกไฟล์ (tar.exe ของ Windows) → ตรวจเวอร์ชัน → สลับโฟลเดอร์ app → ออกด้วยรหัส 75
//          (YoddoyHelper.bat เห็นรหัส 75 = เปิดใหม่ในหน้าต่างเดิม)
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// YODDOY_UPDATE_MANIFEST: ใช้ทดสอบการอัปเดต (ยังต้องเป็นลิงก์ GitHub ตามเงื่อนไขด้านล่าง)
const MANIFEST_URL = process.env.YODDOY_UPDATE_MANIFEST || 'https://github.com/ThanakritN1997/Yoddoych/releases/latest/download/latest.json';
const ALLOWED_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com)$/i;
const RESTART_CODE = 75;
const APP_DIR = __dirname; // …\YoddoyHelper\app
const ROOT = path.dirname(APP_DIR);

const versionLess = (a, b) => {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
};

// GET แบบตามลิงก์ redirect ได้ เฉพาะ GitHub เท่านั้น
function get(url, maxBytes, redirects = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('ลิงก์ไม่ถูกต้อง')); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.test(u.hostname)) return reject(new Error('ลิงก์อัปเดตไม่ได้มาจาก GitHub'));
    const req = https.get(u, { headers: { 'User-Agent': 'YoddoyHelper' }, timeout: 30000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        return get(new URL(r.headers.location, u).href, maxBytes, redirects - 1).then(resolve, reject);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return reject(new Error('ดาวน์โหลดไม่สำเร็จ (HTTP ' + r.statusCode + ')'));
      }
      const parts = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) req.destroy(new Error('ไฟล์ใหญ่เกินกำหนด'));
        else parts.push(c);
      });
      r.on('end', () => resolve(Buffer.concat(parts)));
      r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('หมดเวลาเชื่อมต่อ')));
    req.on('error', reject);
  });
}

async function check(current) {
  const m = JSON.parse((await get(MANIFEST_URL, 64 * 1024)).toString('utf8'));
  return {
    current,
    latest: m.version,
    available: versionLess(current, m.version),
    // เวอร์ชันในเครื่องเก่ากว่าที่อัปเดตแบบเล็กรองรับ → ต้องโหลดตัวเต็ม
    needsFull: versionLess(current, m.minFullVersion),
    fullUrl: m.fullUrl,
    manifest: m,
  };
}

// คืนค่า { ok, version } แล้วผู้เรียกค่อยสั่งรีสตาร์ต (ให้ตอบหน้าเว็บก่อน)
async function apply(current) {
  // ทำงานเฉพาะใน Helper ที่ติดตั้งแล้ว (โฟลเดอร์ …\YoddoyHelper\app + มี runtime\node.exe) — ห้ามแตะโฟลเดอร์ซอร์สโค้ดตอนพัฒนา
  if (!process.env.HELPER || path.basename(APP_DIR).toLowerCase() !== 'app' || !fs.existsSync(path.join(ROOT, 'runtime', 'node.exe'))) {
    return { ok: false, message: 'อัปเดตอัตโนมัติใช้ได้เฉพาะ Yoddoy Helper ที่ติดตั้งจากไฟล์ zip' };
  }
  const c = await check(current);
  if (!c.available) return { ok: false, upToDate: true, message: `เป็นเวอร์ชันล่าสุดแล้ว (${current})` };
  if (c.needsFull) return { ok: false, needsFull: true, fullUrl: c.fullUrl, message: `เวอร์ชัน ${c.latest} เปลี่ยนไฟล์โปรแกรมหลัก — ต้องดาวน์โหลดตัวเต็มครั้งนี้` };
  const m = c.manifest;
  const zip = await get(m.app.url, 20 * 1024 * 1024);
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  if (hash !== String(m.app.sha256).toLowerCase()) throw new Error('ไฟล์อัปเดตไม่ตรงกับที่ประกาศไว้ (SHA-256) — ยกเลิกเพื่อความปลอดภัย');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yoddoy-update-'));
  const zipPath = path.join(work, 'app.zip');
  fs.writeFileSync(zipPath, zip);
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zipPath, '-C', work], { windowsHide: true });
  if (r.status !== 0) throw new Error('แตกไฟล์อัปเดตไม่ได้');
  const newApp = path.join(work, 'app');
  const pkg = JSON.parse(fs.readFileSync(path.join(newApp, 'package.json'), 'utf8'));
  if (pkg.version !== m.version || !fs.existsSync(path.join(newApp, 'server.js'))) throw new Error('ไฟล์อัปเดตไม่สมบูรณ์');

  // สลับโฟลเดอร์: app → app-old-<เวอร์ชันเดิม> (ลบตอนเปิดครั้งหน้า) · ใหม่ → app
  const old = path.join(ROOT, `app-old-${current}-${Date.now()}`);
  fs.renameSync(APP_DIR, old);
  try {
    fs.cpSync(newApp, APP_DIR, { recursive: true });
  } catch (e) {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.renameSync(old, APP_DIR); // คืนของเดิม
    throw new Error('ติดตั้งไฟล์ใหม่ไม่ได้: ' + e.message);
  }
  fs.rmSync(work, { recursive: true, force: true });
  return { ok: true, version: m.version, message: `อัปเดตเป็น ${m.version} แล้ว — กำลังเปิดใหม่` };
}

// เปิดครั้งใหม่: ลบโฟลเดอร์ app เก่าที่เหลือจากการอัปเดต
function cleanup() {
  try {
    for (const d of fs.readdirSync(ROOT)) if (/^app-old-/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  } catch {}
}

module.exports = { check, apply, cleanup, versionLess, RESTART_CODE };
