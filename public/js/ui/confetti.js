/**
 * Lightweight confetti on the shared #fx-canvas: one canvas, one requestAnimationFrame loop that
 * stops itself once every particle has settled. No-ops under prefers-reduced-motion.
 * @module ui/confetti
 */
import { prefersReducedMotion } from './dom.js';

const DEFAULT_COLORS = ['#4f46e5', '#818cf8', '#2a78d6', '#eb6834', '#fab219', '#0ca30c', '#d13c2f'];
const GRAVITY = 0.32;
const DRAG = 0.985;
const MAX_PARTICLES = 600;

let canvas = null;
let ctx = null;
let particles = [];
let raf = 0;
let dpr = 1;
/** Pending delayed bursts (celebrate's centre shower), cancelled by stopConfetti(). */
const pending = new Set();

function ensureCanvas() {
  if (canvas?.isConnected) return true;
  canvas = document.getElementById('fx-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  ctx = canvas.getContext('2d');
  return Boolean(ctx);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick() {
  const hgt = window.innerHeight;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  particles = particles.filter((p) => p.life > 0 && p.y < hgt + 40);
  for (const p of particles) {
    p.vx *= DRAG;
    p.vy = p.vy * DRAG + GRAVITY * p.weight;
    p.x += p.vx + Math.sin(p.wobble) * 0.6;
    p.y += p.vy;
    p.wobble += p.wobbleSpeed;
    p.rot += p.spin;
    p.life -= 1;
    const alpha = Math.min(1, p.life / 30);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.wobble * 1.3));
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (particles.length) {
    raf = requestAnimationFrame(tick);
  } else {
    raf = 0;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    canvas.classList.remove('is-active');
  }
}

/**
 * Emit a burst of confetti.
 * @param {{x?: number, y?: number, count?: number, spread?: number, angle?: number,
 *   velocity?: number, colors?: string[]}} [opts] x/y in viewport px (default: centre);
 *   spread = cone width in degrees; angle = direction in degrees (90 = up).
 */
export function burst({
  x = window.innerWidth / 2, y = window.innerHeight / 2, count = 80, spread = 70,
  angle = 90, velocity = 11, colors = DEFAULT_COLORS,
} = {}) {
  if (prefersReducedMotion() || !ensureCanvas()) return;
  resize();
  canvas.classList.add('is-active');
  const room = Math.max(0, MAX_PARTICLES - particles.length);
  const n = Math.min(count, room);
  for (let i = 0; i < n; i++) {
    const dir = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const speed = velocity * (0.55 + Math.random() * 0.6);
    particles.push({
      x, y,
      vx: Math.cos(dir) * speed,
      vy: -Math.sin(dir) * speed,
      size: 6 + Math.random() * 6,
      color: colors[(Math.random() * colors.length) | 0],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.05 + Math.random() * 0.08,
      weight: 0.7 + Math.random() * 0.5,
      life: 150 + Math.random() * 60,
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

/**
 * Burst from the centre of an element.
 * @param {Element} el
 * @param {Parameters<typeof burst>[0]} [opts]
 */
export function burstFrom(el, opts = {}) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, ...opts });
}

/** Full-screen celebration: two side cannons plus a centre shower. */
export function celebrate() {
  if (prefersReducedMotion()) return;
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  burst({ x: 0, y: hgt * 0.7, angle: 60, spread: 50, count: 110, velocity: 17 });
  burst({ x: w, y: hgt * 0.7, angle: 120, spread: 50, count: 110, velocity: 17 });
  const t = setTimeout(() => {
    pending.delete(t);
    burst({ x: w / 2, y: hgt * 0.35, angle: 90, spread: 160, count: 120, velocity: 9 });
  }, 260);
  pending.add(t);
}

/** Stop every running or scheduled effect and clear the canvas (called on route changes). */
export function stopConfetti() {
  for (const t of pending) clearTimeout(t);
  pending.clear();
  particles = [];
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.classList.remove('is-active');
}
