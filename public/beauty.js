// ฟิลเตอร์กล้อง + หน้าเนียน ประมวลผลด้วย WebGL (การ์ดจอ)
// หน้าเนียน = bilateral filter (เบลอเฉพาะพื้นที่สีใกล้กัน ขอบตา/คิ้ว/ปากยังคม) ผสมเฉพาะบริเวณที่เป็นสีผิว
const FX_PRESETS = {
  normal: { name: 'ปกติ', bright: 0, contrast: 0, sat: 0, warm: 0, sepia: 0, vignette: 0 },
  vivid: { name: 'สดใส', bright: 0.05, contrast: 0.12, sat: 0.35, warm: 0.05, sepia: 0, vignette: 0 },
  soft: { name: 'ละมุน', bright: 0.08, contrast: -0.15, sat: -0.1, warm: 0.1, sepia: 0, vignette: 0.1 },
  warm: { name: 'อบอุ่น', bright: 0.03, contrast: 0.05, sat: 0.1, warm: 0.4, sepia: 0, vignette: 0 },
  cool: { name: 'เย็น', bright: 0.02, contrast: 0.05, sat: 0, warm: -0.4, sepia: 0, vignette: 0 },
  vintage: { name: 'วินเทจ', bright: 0, contrast: -0.1, sat: -0.2, warm: 0.15, sepia: 0.45, vignette: 0.5 },
  mono: { name: 'ขาวดำ', bright: 0, contrast: 0.18, sat: -1, warm: 0, sepia: 0, vignette: 0.2 },
};

// ลบพื้นหลังสี (chroma key) สำหรับเลเยอร์ URL/วิดเจ็ต — ตัดเฉพาะส่วนที่สีใกล้สีคีย์ ขอบนุ่ม
class ChromaKey {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    this.gl = gl;
    if (!gl) return;
    const vs = `attribute vec2 p; varying vec2 uv; uniform vec4 rect;
      void main(){ vec2 t = vec2(p.x*0.5+0.5, 0.5 - p.y*0.5); uv = rect.xy + t * rect.zw; gl_Position = vec4(p,0.,1.); }`;
    const fs = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform vec3 key; uniform float sim, soft;
      vec2 chroma(vec3 c){ return vec2(dot(c, vec3(-.169,-.331,.5)), dot(c, vec3(.5,-.419,-.081))); }
      void main(){
        vec3 c = texture2D(tex, uv).rgb;
        // ระยะห่างสี: ใช้ทั้งสี (chroma) และความสว่าง เพื่อคีย์สีดำ/ขาวได้ด้วย
        float d = length(chroma(c) - chroma(key)) * 2. + abs(dot(c - key, vec3(.299,.587,.114))) * .8;
        float a = smoothstep(sim, sim + soft, d);
        // ลดสีคีย์ที่เลอะขอบ (spill)
        vec3 outc = mix(c, c - key * (1. - a) * .5, 1. - a);
        gl_FragColor = vec4(clamp(outc, 0., 1.), a);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = {};
    for (const n of ['rect', 'key', 'sim', 'soft']) this.u[n] = gl.getUniformLocation(prog, n);
  }

  // ตัดส่วน (sx,sy,sw,sh) ของวิดีโอ แล้วลบสี key [r,g,b 0–1] · sim = ความกว้างช่วงสีที่ลบ (0–1)
  process(video, sx, sy, sw, sh, key, sim) {
    const gl = this.gl;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!gl || !vw) return null;
    const scale = Math.min(1, 1280 / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform4f(this.u.rect, sx / vw, sy / vh, sw / vw, sh / vh);
    gl.uniform3f(this.u.key, key[0], key[1], key[2]);
    gl.uniform1f(this.u.sim, 0.05 + sim * 0.45);
    gl.uniform1f(this.u.soft, 0.08);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

class CameraFX {
  constructor() {
    this.params = { smooth: 0.4, glow: 0.2, mirror: true, ...FX_PRESETS.normal };
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    this.gl = gl;
    if (!gl) return;

    const vs = `attribute vec2 p; varying vec2 uv; uniform float mirror;
      void main(){ uv = vec2(mirror > 0.5 ? 1.0 - (p.x*0.5+0.5) : p.x*0.5+0.5, 0.5 - p.y*0.5); gl_Position = vec4(p,0.,1.); }`;
    const fs = `precision mediump float;
      varying vec2 uv; uniform sampler2D tex; uniform vec2 px;
      uniform float smoothAmt, glow, bright, contrast, sat, warm, sepia, vignette;
      // หน้าเรียว: ดันแก้ม/กราม 2 จุด (c → m) แบบ local translation warp ภายในรัศมี wr
      uniform float warpOn, wr, aspect; uniform vec2 c1, m1, c2, m2;
      vec2 warp(vec2 t, vec2 c, vec2 m){
        vec2 A = vec2(aspect, 1.);
        vec2 pc = (t - c) * A;
        float d2 = dot(pc, pc), R2 = wr * wr;
        if (d2 >= R2) return t;
        vec2 mc = (m - c) * A;
        float k = (R2 - d2) / (R2 - d2 + dot(mc, mc));
        return t - k * k * (m - c);
      }
      float skin(vec3 c){
        float y = dot(c, vec3(.299,.587,.114));
        float cb = (c.b - y) * .564 + .5;
        float cr = (c.r - y) * .713 + .5;
        return smoothstep(.27,.32,cb) * (1. - smoothstep(.49,.54,cb)) * smoothstep(.50,.54,cr) * (1. - smoothstep(.67,.72,cr));
      }
      void main(){
        vec2 t = uv;
        if (warpOn > .5) { t = warp(t, c1, m1); t = warp(t, c2, m2); }
        vec3 c = texture2D(tex, t).rgb;
        float m = skin(c);
        if (smoothAmt > 0.01) {
          vec3 sum = vec3(0.); float ws = 0.;
          float spread = 1. + smoothAmt * 2.5;
          float colorK = mix(80., 8., smoothAmt); // ยิ่งปรับมาก ยิ่งยอมเบลอรอยที่สีต่างมากขึ้น
          for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
            vec2 o = vec2(float(i), float(j));
            vec3 s = texture2D(tex, t + o * px * spread).rgb;
            vec3 d = s - c;
            float w = exp(-dot(o,o) / 18. - dot(d,d) * colorK);
            sum += s * w; ws += w;
          }
          c = mix(c, sum / ws, clamp(m * smoothAmt * 1.3, 0., 1.));
        }
        // ผิวสว่าง: screen blend เฉพาะผิว
        c = mix(c, 1. - (1. - c) * (1. - c * .5), m * glow * .8);
        c += bright * .3;
        c = (c - .5) * (1. + contrast) + .5;
        float g = dot(c, vec3(.299,.587,.114));
        c = mix(vec3(g), c, 1. + sat);
        c.r += warm * .08; c.b -= warm * .08;
        vec3 sp = vec3(dot(c, vec3(.393,.769,.189)), dot(c, vec3(.349,.686,.168)), dot(c, vec3(.272,.534,.131)));
        c = mix(c, sp, sepia);
        c *= 1. - vignette * smoothstep(.35, .8, distance(uv, vec2(.5)));
        gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
      }`;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = {};
    for (const n of ['px', 'mirror', 'smoothAmt', 'glow', 'bright', 'contrast', 'sat', 'warm', 'sepia', 'vignette', 'warpOn', 'wr', 'aspect', 'c1', 'm1', 'c2', 'm2']) this.u[n] = gl.getUniformLocation(prog, n);
    this.warp = null;
  }

  // ตั้งค่าหน้าเรียวของเฟรมนี้ (จาก slimWarp() ใน face.js) หรือ null = ปิด
  setWarp(w) {
    this.warp = w;
  }

  // คืน canvas ที่ประมวลผลแล้ว (ย่อไม่เกิน 1280 กว้าง เพื่อให้ลื่น)
  process(video) {
    const gl = this.gl;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!gl || !vw) return null;
    const scale = Math.min(1, 1280 / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    const p = this.params;
    gl.uniform2f(this.u.px, 1 / w, 1 / h);
    gl.uniform1f(this.u.mirror, p.mirror ? 1 : 0);
    gl.uniform1f(this.u.smoothAmt, p.smooth);
    gl.uniform1f(this.u.glow, p.glow);
    for (const k of ['bright', 'contrast', 'sat', 'warm', 'sepia', 'vignette']) gl.uniform1f(this.u[k], p[k]);
    const wp = this.warp;
    gl.uniform1f(this.u.warpOn, wp ? 1 : 0);
    if (wp) {
      gl.uniform1f(this.u.wr, wp.radius);
      gl.uniform1f(this.u.aspect, wp.aspect);
      gl.uniform2f(this.u.c1, wp.c1.x, wp.c1.y);
      gl.uniform2f(this.u.m1, wp.m1.x, wp.m1.y);
      gl.uniform2f(this.u.c2, wp.c2.x, wp.c2.y);
      gl.uniform2f(this.u.m2, wp.m2.x, wp.m2.y);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
