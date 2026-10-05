export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function fmtTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// localStorage can throw (private mode, quota, disabled storage) — never let it break the app.
export const store = {
  get(key, fallback = null) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
  },
};

// A damped spring (px and px/s) for UI motion that has weight and keeps momentum.
export class Spring {
  constructor(value = 0, { stiffness = 80, damping = 15, mass = 1 } = {}) {
    Object.assign(this, { value, target: value, velocity: 0, stiffness, damping, mass });
  }

  // Advances by dt seconds; returns true once settled on the target.
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += (force / this.mass) * h;
      this.value += this.velocity * h;
    }
    const settled = Math.abs(this.velocity) < 4 && Math.abs(this.value - this.target) < 0.4;
    if (settled) {
      this.value = this.target;
      this.velocity = 0;
    }
    return settled;
  }
}

export class Emitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }

  emit(event, ...args) {
    this.#handlers.get(event)?.forEach((fn) => fn(...args));
  }
}

// Tiny element builder: h('div', { class: 'x', onclick }, child, 'text').
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
