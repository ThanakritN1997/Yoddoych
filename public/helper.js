// หา "Yoddoy Helper" (โปรแกรมตัวช่วยบนเครื่องนี้ที่มี FFmpeg + UxPlay)
// - เปิดเว็บจากเครื่องที่รันเซิร์ฟเวอร์เอง (localhost) → ใช้ที่เดียวกัน
// - เปิดจากเว็บออนไลน์ (เช่น Vercel) → ลองต่อ Helper ที่ 127.0.0.1:47800
window.HELPER_PORT = 47800;
window.HELPER_MIN_VERSION = '1.5.1'; // 1.1 แก้ไลฟ์หลุด · 1.2 ดีเลย์ · 1.4 ข้อมูลช่วงเริ่มไลฟ์สม่ำเสมอขึ้น · 1.5 อัดไฟล์ MP4 · 1.5.1 ไลฟ์เสถียร/เสียงไม่แตก
window.versionLess = (a, b) => {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
};
window.HELPER_DOWNLOAD = 'https://github.com/ThanakritN1997/Yoddoych/releases/latest/download/YoddoyHelper-win64.zip';
window.IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

async function findHelper() {
  const onLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const bases = onLocal ? [location.origin, `http://127.0.0.1:${window.HELPER_PORT}`] : [`http://127.0.0.1:${window.HELPER_PORT}`];
  for (const base of bases) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(base + '/api/helper', { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return { base, ws: base.replace(/^http/, 'ws'), ...(await r.json()) };
    } catch {}
  }
  return null;
}
window.helper = window.IS_MOBILE ? Promise.resolve(null) : findHelper();
