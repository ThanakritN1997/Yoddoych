// Worker สำหรับ AI ใบหน้า + แยกพื้นหลัง (MediaPipe) — ทำงานแยกจากหน้าเว็บ
// เพื่อไม่ให้การประมวลผล ~20–30 ms ต่อเฟรมไปขวางการวาดภาพและการส่งวิดีโอไลฟ์ (สาเหตุภาพกระตุก/ข้อมูลไม่สม่ำเสมอ)
// เป็น classic worker (ไม่ใช่ module) เพราะตัวโหลด wasm ของ MediaPipe ต้องใช้ importScripts
let vision = null;
let files = null;
const tasks = {};

async function getVision(base) {
  if (!vision) {
    vision = await import(`${base}/vision_bundle.mjs`);
    files = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  }
  return vision;
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const v = await getVision(m.base);
      // ใน worker ต้องให้ OffscreenCanvas ไว้ใช้ GPU ไม่งั้น MediaPipe จะใช้ CPU (ช้ากว่าหลายเท่า)
      const make = (delegate) => {
        const canvas = delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
        return m.task === 'face'
          ? v.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: m.model, delegate }, canvas, runningMode: 'VIDEO', numFaces: 1 })
          : v.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: m.model, delegate }, canvas, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
      };
      const order = m.prefer === 'CPU' ? ['CPU', 'GPU'] : ['GPU', 'CPU'];
      let delegate = order[0];
      try {
        tasks[m.task] = await make(order[0]);
      } catch {
        delegate = order[1];
        tasks[m.task] = await make(order[1]); // การ์ดจอบางรุ่นใช้ GPU ใน worker ไม่ได้
      }
      postMessage({ type: 'ready', task: m.task, delegate });
    } catch (err) {
      postMessage({ type: 'error', task: m.task, message: String((err && err.message) || err) });
    }
    return;
  }

  if (m.type === 'frame') {
    const out = { type: 'result' };
    const transfer = [];
    try {
      if (m.face && tasks.face) {
        const r = tasks.face.detectForVideo(m.bitmap, m.ts);
        const p = r.faceLandmarks && r.faceLandmarks[0];
        out.hasFace = true;
        if (p) {
          const a = new Float32Array(p.length * 2);
          for (let i = 0; i < p.length; i++) {
            a[i * 2] = p[i].x;
            a[i * 2 + 1] = p[i].y;
          }
          out.face = a;
          transfer.push(a.buffer);
        }
      }
      if (m.seg && tasks.seg) {
        tasks.seg.segmentForVideo(m.bitmap, m.ts, (res) => {
          const masks = res.confidenceMasks;
          if (!masks || !masks.length) return;
          const mk = masks[masks.length - 1]; // ช่องสุดท้าย = ความมั่นใจว่าเป็น "คน"
          const f = mk.getAsFloat32Array();
          const u = new Uint8Array(f.length);
          for (let i = 0; i < f.length; i++) u[i] = f[i] * 255;
          out.mask = u;
          out.w = mk.width;
          out.h = mk.height;
          transfer.push(u.buffer);
        });
      }
    } catch (err) {
      out.error = String(err);
    }
    m.bitmap.close();
    postMessage(out, transfer);
  }
};
