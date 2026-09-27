// ปุ่มเปิด/ปิดตัวรับการสะท้อนหน้าจอ iPhone (ใช้ได้เฉพาะบนคอมที่รันเซิร์ฟเวอร์)
(function () {
  const card = document.getElementById('mirrorCard');
  if (!card) return;
  const el = (id) => document.getElementById(id);
  const btn = el('btnMirror');
  const stateEl = el('mirrorState');
  const useBtn = el('btnUseMirror');
  let st = null;
  let busy = false;

  function render() {
    if (!st) return;
    const on = st.running || st.external;
    let text = 'ปิดอยู่';
    let cls = 'off';
    if (!st.installed) text = 'ยังไม่ได้ติดตั้ง UxPlay';
    else if (on && st.streaming) { text = `● ${st.device || 'iPhone'} กำลังสะท้อนหน้าจอ`; cls = 'ok'; }
    else if (on && st.connected) { text = `${st.device || 'iPhone'} กำลังเชื่อมต่อ…`; cls = 'wait'; }
    else if (on) { text = `รอ iPhone — เลือก “${st.name}” ในเมนูการสะท้อนหน้าจอ`; cls = 'wait'; }
    stateEl.textContent = text;
    stateEl.className = 'mstate ' + cls;
    btn.disabled = busy || !st.installed;
    btn.textContent = busy ? 'กำลังดำเนินการ…' : on ? '■ หยุดสะท้อนหน้าจอ' : '▶ เริ่มสะท้อนหน้าจอ';
    btn.classList.toggle('danger', on);
    btn.classList.toggle('primary', !on);
    useBtn.hidden = !(on && st.streaming);
  }

  async function poll() {
    try {
      const r = await fetch('/api/mirror');
      if (!r.ok) return; // เปิดจากมือถือ/เครื่องอื่น → ซ่อนการ์ดนี้
      st = await r.json();
      card.hidden = false;
      render();
    } catch {}
  }

  btn.onclick = async () => {
    const on = st && (st.running || st.external);
    busy = true;
    render();
    try {
      st = await fetch(on ? '/api/mirror/stop' : '/api/mirror/start', { method: 'POST' }).then((r) => r.json());
      if (st.error) alert(st.error);
    } catch {}
    busy = false;
    render();
  };

  // เลือกหน้าต่างภาพ iPhone มาใช้ → กดปุ่มแชร์จอของหน้านั้น ๆ
  useBtn.onclick = () => el(useBtn.dataset.target).click();

  poll();
  setInterval(poll, 2000);
})();
