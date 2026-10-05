import { DEFAULT_PALETTE, toHex } from './palette.js';
import { settings } from './settings.js';
import { clamp, h, lerp } from './util.js';

const VERT = `attribute vec2 p; varying vec2 vUv;
void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

// Five soft color fields drifting on Lissajous paths, blended by normalized
// gaussian weights — a living mesh gradient tinted by the album art.
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCol[5];
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((vUv.x - .5) * aspect, vUv.y - .5);
  float t = uTime;
  p += .075 * vec2(sin(p.y * 3.3 + t * .7), cos(p.x * 2.9 - t * .6));
  vec3 col = vec3(0.);
  float ws = 0.;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(.6 * aspect * sin(t * (.13 + .037 * fi) + fi * 1.9), .45 * cos(t * (.11 + .029 * fi) + fi * 2.6));
    float d = length(p - c);
    float w = exp(-d * d * (1.6 + .3 * fi));
    col += uCol[i] * w;
    ws += w;
  }
  col /= max(ws, 1e-3);
  // Fall off into shadow between the color fields for depth.
  col *= mix(.32, 1., smoothstep(.04, .9, ws));
  float l = dot(col, vec3(.299, .587, .114));
  col = mix(vec3(l), col, 1.06);
  float v = smoothstep(1.35, .2, length(vec2((vUv.x - .5) * aspect * .85, vUv.y - .45)));
  col *= mix(.55, 1.05, v);
  gl_FragColor = vec4(col, 1.);
}`;

export class Background {
  constructor(root) {
    this.root = root;
    this.canvas = h('canvas', { class: 'bg-gl' });
    this.artLayer = h('div', { class: 'bg-art' });
    root.append(this.canvas, this.artLayer, h('div', { class: 'bg-tint' }), h('div', { class: 'bg-dim' }), h('div', { class: 'bg-vignette' }), h('div', { class: 'bg-grain' }));
    this.cur = DEFAULT_PALETTE.aurora.map((c) => c.slice());
    this.from = this.cur.map((c) => c.slice());
    this.to = this.from;
    this.mixStart = -1e9;
    this.time = Math.random() * 60;
    this.last = 0;
    this.running = false;
    this.initGL();
    this.applyTint(this.to);
    settings.on('change', () => this.sync());
    document.addEventListener('visibilitychange', () => this.sync());
    addEventListener('resize', () => this.resize());
    this.sync();
  }

  initGL() {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.uRes = gl.getUniformLocation(prog, 'uRes');
      this.uTime = gl.getUniformLocation(prog, 'uTime');
      this.uCol = gl.getUniformLocation(prog, 'uCol');
      this.gl = gl;
    } catch (err) {
      console.warn('Aurora background unavailable:', err);
      return;
    }
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
      this.sync();
    });
    this.resize();
  }

  resize() {
    if (!this.gl) return;
    // Render small and let CSS upscale: the gradient is soft, so this is free quality.
    const w = Math.max(160, Math.round(innerWidth * 0.33));
    const ht = Math.max(100, Math.round(innerHeight * 0.33));
    this.canvas.width = w;
    this.canvas.height = ht;
    this.gl.viewport(0, 0, w, ht);
    this.draw();
  }

  sync() {
    const root = document.documentElement;
    const motion = settings.get('bgMotion');
    root.style.setProperty('--bg-spin', `${Math.round(140 / Math.max(motion, 0.05))}s`);
    root.dataset.bgStill = String(motion === 0 || settings.get('lowPower'));
    const want = Boolean(this.gl) && settings.get('bgStyle') === 'aurora' && !settings.get('lowPower') && !document.hidden;
    root.dataset.gl = want ? 'on' : 'off';
    if (want && !this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    } else if (!want) {
      this.running = false;
    }
  }

  frame = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = now - this.last;
    const motion = settings.get('bgMotion');
    const mixing = now - this.mixStart < 2000;
    // ~30fps is plenty for slow drift; when still, only redraw during color fades.
    if (dt < 32 || (motion === 0 && !mixing && dt < 1000)) return;
    this.last = now;
    this.time += Math.min(dt, 100) * 0.001 * motion * 0.8;
    this.stepColors(now);
    this.draw();
  };

  stepColors(now) {
    const k = clamp((now - this.mixStart) / 1800, 0, 1);
    const e = k * k * (3 - 2 * k);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) this.cur[i][j] = lerp(this.from[i][j], this.to[i][j], e);
  }

  draw() {
    const gl = this.gl;
    if (!gl) return;
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, this.time);
    gl.uniform3fv(this.uCol, this.cur.flat());
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setPalette(palette) {
    if (!palette?.aurora) return;
    this.from = this.cur.map((c) => c.slice());
    this.to = palette.aurora.map((c) => c.slice());
    this.mixStart = performance.now();
    this.applyTint(this.to);
    if (!this.running) {
      this.cur = this.to.map((c) => c.slice());
      this.draw();
    }
  }

  applyTint(colors) {
    const root = document.documentElement;
    colors.forEach((c, i) => root.style.setProperty(`--c${i}`, toHex(c.map((v) => v * 255))));
  }

  // Blurred, slowly rotating copies of the artwork. Blur, tone and a feathered round
  // edge are baked into small canvases once, so animating them costs only a transform.
  setArt(img) {
    const set = h('div', { class: 'art-set' });
    for (const size of [220, 160]) {
      const c = h('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.filter = `blur(${Math.round(size / 14)}px) saturate(140%) brightness(78%)`;
      const pad = size * 0.12;
      g.drawImage(img, -pad, -pad, size + pad * 2, size + pad * 2);
      g.filter = 'none';
      g.globalCompositeOperation = 'destination-in';
      const r = size / 2;
      const feather = g.createRadialGradient(r, r, r * 0.35, r, r, r);
      feather.addColorStop(0, '#000');
      feather.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = feather;
      g.fillRect(0, 0, size, size);
      set.append(c);
    }
    const old = [...this.artLayer.children];
    this.artLayer.append(set);
    requestAnimationFrame(() => requestAnimationFrame(() => set.classList.add('is-on')));
    setTimeout(() => old.forEach((el) => el.remove()), 1800);
  }
}
