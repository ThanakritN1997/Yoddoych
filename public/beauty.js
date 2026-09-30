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

    // uv = พิกัดในภาพกล้อง (กลับด้านกระจกแล้ว) · suv = พิกัดบนจอ (ไม่กลับด้าน ใช้กับรูปพื้นหลัง)
    const vs = `attribute vec2 p; varying vec2 uv; varying vec2 suv; uniform float mirror;
      void main(){ suv = vec2(p.x*0.5+0.5, 0.5 - p.y*0.5); uv = vec2(mirror > 0.5 ? 1.0 - suv.x : suv.x, suv.y); gl_Position = vec4(p,0.,1.); }`;
    // MAXW = จำนวนจุดดัดรูปหน้าสูงสุด · MAXR = บริเวณรีทัชเฉพาะจุด (ใต้ตา ร่องแก้ม คอนทัวร์ ไฮไลต์)
    const fs = `precision mediump float;
      #define MAXW 28
      #define MAXR 8
      varying vec2 uv; varying vec2 suv; uniform sampler2D tex; uniform vec2 px;
      // พื้นหลัง: bgMode 0 = ปิด, 1 = ตัดภาพ (โปร่งใส), 2 = เบลอ, 3 = รูป · maskTex = ความมั่นใจว่าเป็นคน · bgCover = ครอปรูปแบบ cover
      uniform sampler2D maskTex, bgTex; uniform float bgMode; uniform vec4 bgCover;
      uniform float smoothAmt, glow, bright, contrast, sat, warm, sepia, vignette;
      uniform float faceOn, aspect, foundation, teeth, eyeBright, lipAmt, blushAmt, needBlur;
      // จุดดัด: wp.xy = ศูนย์กลาง, wp.zw = จุดปลายทาง (ดัน) หรือ wp.z = อัตราขยาย (ขยาย/ย่อ) · wq.x = รัศมี, wq.y = ชนิด (1 ดัน, 2 ขยาย)
      uniform vec4 wp[MAXW]; uniform vec2 wq[MAXW];
      // รีทัช: rg.xy = ศูนย์กลาง, rg.z = รัศมี, rg.w = เพิ่มความเนียน · rgb2.x = เพิ่มความสว่าง (ติดลบ = เงา)
      uniform vec4 rg[MAXR]; uniform vec2 rgb2[MAXR];
      uniform vec4 mouthO, mouthI; uniform vec3 lipCol, blushCol; uniform vec3 eyeL, eyeR; uniform vec4 cheeks; uniform float cheekR;
      const vec3 LUM = vec3(.299,.587,.114);
      float skin(vec3 c){
        float y = dot(c, LUM);
        float cb = (c.b - y) * .564 + .5;
        float cr = (c.r - y) * .713 + .5;
        return smoothstep(.27,.32,cb) * (1. - smoothstep(.49,.54,cb)) * smoothstep(.50,.54,cr) * (1. - smoothstep(.67,.72,cr));
      }
      float circ(vec2 p, vec2 c, float r){ vec2 d = (p - c) * vec2(aspect, 1.); return 1. - smoothstep(r * .35, r, length(d)); }
      float ell(vec2 p, vec4 e){ vec2 d = (p - e.xy) / max(e.zw, vec2(1e-4)); return 1. - smoothstep(.7, 1., dot(d, d)); }
      void main(){
        vec2 A = vec2(aspect, 1.);
        vec2 t = uv;
        if (faceOn > .5) {
          for (int i = 0; i < MAXW; i++) {
            float ty = wq[i].y;
            if (ty < .5) continue;
            vec2 c = wp[i].xy;
            float R = wq[i].x, R2 = R * R;
            vec2 pc = (t - c) * A;
            float d2 = dot(pc, pc);
            if (d2 >= R2) continue;
            if (ty < 1.5) {
              vec2 mc = (wp[i].zw - c) * A;
              float k = (R2 - d2) / (R2 - d2 + dot(mc, mc));
              t -= k * k * (wp[i].zw - c);
            } else {
              float f = 1. - d2 / R2;
              t = c + (t - c) * (1. - wp[i].z * f * f);
            }
          }
        }
        vec3 c = texture2D(tex, t).rgb;
        float m = skin(c);
        float rSmooth = 0., rBright = 0.;
        if (faceOn > .5) for (int i = 0; i < MAXR; i++) {
          if (rg[i].z <= 0.) continue;
          float f = circ(t, rg[i].xy, rg[i].z);
          rSmooth += f * rg[i].w; rBright += f * rgb2[i].x;
        }
        if (needBlur > .5) {
          float amt = max(smoothAmt, foundation * .8);
          vec3 sum = vec3(0.); float ws = 0.;
          float spread = 1. + amt * 2.5 + rSmooth;
          float colorK = mix(80., 8., clamp(amt + rSmooth * .5, 0., 1.)); // ยิ่งปรับมาก ยิ่งยอมเบลอรอยที่สีต่างมากขึ้น
          for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
            vec2 o = vec2(float(i), float(j));
            vec3 s = texture2D(tex, t + o * px * spread).rgb;
            vec3 d = s - c;
            float w = exp(-dot(o,o) / 18. - dot(d,d) * colorK);
            sum += s * w; ws += w;
          }
          c = mix(c, sum / ws, clamp(m * (smoothAmt * 1.3 + foundation * .7) + rSmooth * m, 0., 1.));
        }
        // รองพื้น: ผิวเรียบสม่ำเสมอ สว่างขึ้นเล็กน้อย ลดความแดง
        c += m * foundation * vec3(.022, .028, .03);
        c.r -= m * foundation * .012;
        // ผิวสว่าง: screen blend เฉพาะผิว
        c = mix(c, 1. - (1. - c) * (1. - c * .5), m * glow * .8);
        if (faceOn > .5) {
          // ใต้ตา/ร่องแก้ม/ไฮไลต์ (+) · คอนทัวร์ (−)
          c += rBright * .12;
          // ตาสว่าง
          float em = max(circ(t, eyeL.xy, eyeL.z), circ(t, eyeR.xy, eyeR.z));
          c = mix(c, (c - .5) * 1.18 + .5 + .05, em * eyeBright);
          // ฟันขาว: ส่วนที่สว่างและสีจางภายในปาก
          float y = dot(c, LUM);
          float satu = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
          float tm = ell(t, mouthI) * smoothstep(.3, .5, y) * (1. - smoothstep(.18, .4, satu));
          c = mix(c, vec3(y * 1.06 + .05) * vec3(.98, 1., 1.04), tm * teeth);
          // ลิปสติก: บริเวณริมฝีปาก (ไม่รวมฟัน) ที่มีโทนแดง
          float lm = ell(t, mouthO) * (1. - tm) * smoothstep(.0, .07, c.r - c.g);
          c = mix(c, lipCol * (.3 + y * 1.35), lm * lipAmt * .75);
          // บลัชออน
          float bm = max(circ(t, cheeks.xy, cheekR), circ(t, cheeks.zw, cheekR)) * m;
          c = mix(c, c * mix(vec3(1.), blushCol * 1.35, .55), bm * blushAmt * .7);
        }
        // พื้นหลัง: ผสมคน (หน้ากาก) กับพื้นหลังใหม่ — ขอบนุ่มด้วย smoothstep
        float pm = 1.;
        if (bgMode > .5) {
          pm = smoothstep(.45, .78, texture2D(maskTex, uv).r);
          if (bgMode > 2.5) c = mix(texture2D(bgTex, suv * bgCover.xy + bgCover.zw).rgb, c, pm);
          else if (bgMode > 1.5) c = mix(texture2D(bgTex, uv).rgb, c, pm);
        }
        c += bright * .3;
        c = (c - .5) * (1. + contrast) + .5;
        float g = dot(c, LUM);
        c = mix(vec3(g), c, 1. + sat);
        c.r += warm * .08; c.b -= warm * .08;
        vec3 sp = vec3(dot(c, vec3(.393,.769,.189)), dot(c, vec3(.349,.686,.168)), dot(c, vec3(.272,.534,.131)));
        c = mix(c, sp, sepia);
        c *= 1. - vignette * smoothstep(.35, .8, distance(uv, vec2(.5)));
        gl_FragColor = vec4(clamp(c, 0., 1.), bgMode > .5 && bgMode < 1.5 ? pm : 1.);
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

    // 3 texture: 0 = ภาพกล้อง, 1 = หน้ากากคน, 2 = พื้นหลัง (เบลอ/รูป)
    const mkTex = (unit) => {
      const tx = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      return tx;
    };
    this.maskTex = mkTex(1);
    this.bgTex = mkTex(2);
    this.camTex = mkTex(0); // ผูกไว้ที่ unit 0 เป็นตัวสุดท้าย
    gl.uniform1i(gl.getUniformLocation(prog, 'tex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'maskTex'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'bgTex'), 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.bg = null;
    this.bgUploaded = null;
    this.u = {};
    for (const n of ['px', 'mirror', 'smoothAmt', 'glow', 'bright', 'contrast', 'sat', 'warm', 'sepia', 'vignette',
      'faceOn', 'aspect', 'foundation', 'teeth', 'eyeBright', 'lipAmt', 'blushAmt', 'needBlur',
      'wp', 'wq', 'rg', 'rgb2', 'mouthO', 'mouthI', 'lipCol', 'blushCol', 'eyeL', 'eyeR', 'cheeks', 'cheekR', 'bgMode', 'bgCover']) this.u[n] = gl.getUniformLocation(prog, n);
    this.face = null;
    this.wpBuf = new Float32Array(28 * 4);
    this.wqBuf = new Float32Array(28 * 2);
    this.rgBuf = new Float32Array(8 * 4);
    this.rgbBuf = new Float32Array(8 * 2);
  }

  // ตั้งค่าบิวตี้ใบหน้าของเฟรมนี้ (จาก buildFaceFx() ใน face.js) หรือ null = ไม่มีใบหน้า
  setFace(f) {
    this.face = f;
  }

  // พื้นหลังของเฟรมนี้: { mode: 'remove'|'blur'|'image', mask: {data,w,h}, source: canvas/รูป, static: true = รูปไม่เปลี่ยน (อัปโหลดครั้งเดียว) } หรือ null
  setBackground(b) {
    this.bg = b;
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
    const u = this.u;
    const bg = this.bg;
    const mode = bg && bg.mask ? { remove: 1, blur: 2, image: 3 }[bg.mode] || 0 : 0;
    gl.uniform1f(u.bgMode, mode);
    if (mode) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, bg.mask.w, bg.mask.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bg.mask.data);
      if (mode > 1 && bg.source && (!bg.static || this.bgUploaded !== bg.source)) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bg.source);
        this.bgUploaded = bg.static ? bg.source : null;
      }
      if (mode === 3 && bg.source) {
        // ครอปรูปแบบ cover ให้เต็มกรอบกล้อง
        const A = w / h;
        const I = (bg.source.naturalWidth || bg.source.width) / (bg.source.naturalHeight || bg.source.height);
        if (I > A) gl.uniform4f(u.bgCover, A / I, 1, (1 - A / I) / 2, 0);
        else gl.uniform4f(u.bgCover, 1, I / A, 0, (1 - I / A) / 2);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    const p = this.params;
    gl.uniform2f(u.px, 1 / w, 1 / h);
    gl.uniform1f(u.mirror, p.mirror ? 1 : 0);
    gl.uniform1f(u.smoothAmt, p.smooth);
    gl.uniform1f(u.glow, p.glow);
    for (const k of ['bright', 'contrast', 'sat', 'warm', 'sepia', 'vignette']) gl.uniform1f(u[k], p[k]);
    const f = this.face;
    const foundation = (f && f.foundation) || p.foundation || 0;
    gl.uniform1f(u.foundation, foundation);
    gl.uniform1f(u.aspect, vw / vh);
    gl.uniform1f(u.faceOn, f ? 1 : 0);
    const anyRegionSmooth = f && f.regions.some((r) => r.smooth > 0);
    gl.uniform1f(u.needBlur, p.smooth > 0.01 || foundation > 0.01 || anyRegionSmooth ? 1 : 0);
    if (f) {
      this.wpBuf.fill(0);
      this.wqBuf.fill(0);
      f.warps.slice(0, 28).forEach((wv, i) => {
        this.wpBuf.set([wv.c.x, wv.c.y, wv.m ? wv.m.x : wv.s, wv.m ? wv.m.y : 0], i * 4);
        this.wqBuf.set([wv.r, wv.m ? 1 : 2], i * 2);
      });
      this.rgBuf.fill(0);
      this.rgbBuf.fill(0);
      f.regions.slice(0, 8).forEach((r, i) => {
        this.rgBuf.set([r.c.x, r.c.y, r.r, r.smooth], i * 4);
        this.rgbBuf.set([r.bright, 0], i * 2);
      });
      gl.uniform4fv(u.wp, this.wpBuf);
      gl.uniform2fv(u.wq, this.wqBuf);
      gl.uniform4fv(u.rg, this.rgBuf);
      gl.uniform2fv(u.rgb2, this.rgbBuf);
      gl.uniform4fv(u.mouthO, f.mouthO);
      gl.uniform4fv(u.mouthI, f.mouthI);
      gl.uniform3fv(u.eyeL, f.eyeL);
      gl.uniform3fv(u.eyeR, f.eyeR);
      gl.uniform4fv(u.cheeks, f.cheeks);
      gl.uniform1f(u.cheekR, f.cheekR);
      gl.uniform3fv(u.lipCol, f.lipCol);
      gl.uniform3fv(u.blushCol, f.blushCol);
      gl.uniform1f(u.teeth, f.teeth);
      gl.uniform1f(u.eyeBright, f.eyeBright);
      gl.uniform1f(u.lipAmt, f.lipAmt);
      gl.uniform1f(u.blushAmt, f.blushAmt);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
