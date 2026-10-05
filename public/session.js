// ---------- เปิดเว็บครั้งหน้า: กลับมาเหมือนเดิม ----------
// กล้อง: เปิดให้เองถ้าเคยอนุญาตแล้ว · จอ/หน้าต่าง: เบราว์เซอร์บังคับให้กดเลือกเอง → มีปุ่ม "เปิดจอเดิม" 1 คลิก
// จอ iPhone (UxPlay): เปิดตัวรับภาพให้เองตั้งแต่โหลดหน้า รอแค่ต่อ iPhone แล้วกดปุ่ม
$('camSelect').addEventListener('change', () => store.set('camId', $('camSelect').value));

const isUxplayLabel = (s) => /direct3d|uxplay|pc-mirror/i.test(s || '');

async function restoreSession() {
  // กล้อง
  if (store.get('camOn', false) && !getLayer('cam')?.stream) {
    try {
      const p = await navigator.permissions.query({ name: 'camera' });
      if (p.state === 'granted') {
        await listDevices();
        await startCam();
      }
    } catch {}
  }
  // จอ/หน้าต่าง
  if (store.get('screenOn', false) && !getLayer('screen')?.stream) {
    const label = store.get('screenLabel', '');
    const iphone = isUxplayLabel(label);
    $('restoreWhat').textContent = iphone ? 'จอ iPhone (AirPlay)' : label ? `“${label.slice(0, 40)}”` : 'จอ/หน้าต่างเดิม';
    $('restoreBar').hidden = false;
    if (iphone) {
      const h = await window.helper;
      if (h) {
        try {
          const st = await (await fetch(h.base + '/api/mirror')).json();
          if (!st.running && !st.external) await fetch(h.base + '/api/mirror/start', { method: 'POST' });
          $('restoreHint').textContent = 'เปิดตัวรับภาพ PC-Mirror ให้แล้ว — ต่อ iPhone (ศูนย์ควบคุม → การสะท้อนหน้าจอ) แล้วกดปุ่มนี้';
        } catch {}
      }
    }
  }
}
$('restoreGo').onclick = () => {
  $('restoreBar').hidden = true;
  $('srcScreen').click(); // เปิดหน้าต่างเลือกจอ (ต้องมาจากการคลิกของผู้ใช้)
};
$('restoreSkip').onclick = () => {
  $('restoreBar').hidden = true;
  store.set('screenOn', false);
};

restoreSession();
