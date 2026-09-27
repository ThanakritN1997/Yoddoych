// ปุ่มเปิด/ปิดตัวรับการสะท้อนหน้าจอ iPhone — สั่งผ่าน Yoddoy Helper บนเครื่องนี้
(function () {
  const card = document.getElementById('mirrorCard');
  if (!card) return;
  const el = (id) => document.getElementById(id);
  const btn = el('btnMirror');
  const stateEl = el('mirrorState');
  const useBtn = el('btnUseMirror');
  let base = null;
  let st = null;
  let busy = false;

  function render() {
    if (!base) {
      // ไม่มี Helper → ปุ่มกลายเป็นลิงก์ดาวน์โหลด
      stateEl.textContent = 'ต้องติดตั้ง Yoddoy Helper';
      stateEl.className = 'mstate wait';
      btn.textContent = '⬇ ดาวน์โหลด Yoddoy Helper';
      btn.disabled = false;
      useBtn.hidden = true;
      return;
    }
    if (!st) return;
    const on = st.running || st.external;
    let text = 'ปิดอยู่';
    let cls = 'off';
    if (!st.installed) text = 'Helper ไม่มี UxPlay';
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
    if (!base) return;
    try {
      const r = await fetch(base + '/api/mirror');
      if (!r.ok) return;
      st = await r.json();
      render();
    } catch {}
  }

  btn.onclick = async () => {
    if (!base) return window.open(window.HELPER_DOWNLOAD, '_blank');
    const on = st && (st.running || st.external);
    busy = true;
    render();
    try {
      st = await fetch(base + (on ? '/api/mirror/stop' : '/api/mirror/start'), { method: 'POST' }).then((r) => r.json());
      if (st.error) alert(st.error);
    } catch {}
    busy = false;
    render();
  };

  // เลือกหน้าต่างภาพ iPhone มาใช้ → กดปุ่มแชร์จอของหน้านั้น ๆ
  useBtn.onclick = () => el(useBtn.dataset.target).click();

  if (window.IS_MOBILE) return; // มือถือเป็นเครื่องรับ AirPlay ไม่ได้
  card.hidden = false;
  window.helper.then((h) => {
    base = h && h.base;
    render();
    poll();
    setInterval(poll, 2000);
  });
})();
