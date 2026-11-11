// The marble head in the hero, redrawn as ink dots from a photograph.
// Dark parts of the stone get bigger dots. Dots settle into place on load,
// move away from the pointer, and a marking line passes over them now and then.

export async function mountBust(canvas, src) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  let dots = [], W = 0, H = 0, dpr = 1, step = 6;
  const mouse = { x: -9999, y: -9999 };

  function build() {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = box.width; H = box.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    step = W < 420 ? 5 : 6;
    const scale = Math.min(W / img.width, H / img.height);
    const bw = img.width * scale, bh = img.height * scale;
    const ox = (W - bw) / 2, oy = H - bh;
    const cols = Math.floor(bw / step), rows = Math.floor(bh / step);
    const off = new OffscreenCanvas(cols, rows).getContext("2d", { willReadFrequently: true });
    off.drawImage(img, 0, 0, cols, rows);
    const px = off.getImageData(0, 0, cols, rows).data;
    dots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        if (px[i + 3] < 110) continue;
        const dark = 1 - px[i] / 255;
        const size = 0.55 + Math.pow(dark, 1.25) * (step * 0.62);
        const hx = ox + (c + (r % 2 ? 0.5 : 0)) * step, hy = oy + r * step;
        const a = Math.random() * 6.283, d = 60 + Math.random() * 260;
        dots.push({ hx, hy, x: hx + Math.cos(a) * d, y: hy + Math.sin(a) * d, vx: 0, vy: 0, size, delay: Math.random() * 0.5 + (r / rows) * 0.5 });
      }
    }
    if (still) for (const p of dots) { p.x = p.hx; p.y = p.hy; }
  }

  let t0 = performance.now(), running = false, visible = true;
  function frame(now) {
    if (!visible) { running = false; return; }
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // the marking line: a band that travels down the head every nine seconds
    const band = still ? -999 : ((t % 9) / 2.6) * (H + 160) - 80;
    const ink = [], lit = [];
    for (const p of dots) {
      if (!still) {
        const k = Math.max(0, Math.min(1, (t - p.delay) / 1.1));
        const pull = 0.02 + 0.1 * k;
        let fx = (p.hx - p.x) * pull, fy = (p.hy - p.y) * pull;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 14400) { const f = (1 - d2 / 14400) * 2.4, d = Math.sqrt(d2) || 1; fx += (dx / d) * f; fy += (dy / d) * f; }
        p.vx = (p.vx + fx) * 0.8; p.vy = (p.vy + fy) * 0.8;
        p.x += p.vx; p.y += p.vy;
      }
      (Math.abs(p.hy - band) < 26 ? lit : ink).push(p);
    }
    ctx.fillStyle = "#0d0e10";
    ctx.beginPath();
    for (const p of ink) { ctx.moveTo(p.x + p.size, p.y); ctx.arc(p.x, p.y, p.size, 0, 6.283); }
    ctx.fill();
    ctx.fillStyle = "#12a543";
    ctx.beginPath();
    for (const p of lit) { const s = p.size * 1.25 + 0.4; ctx.moveTo(p.x + s, p.y); ctx.arc(p.x, p.y, s, 0, 6.283); }
    ctx.fill();
    if (still) { running = false; return; }
    requestAnimationFrame(frame);
  }
  const start = () => { if (!running) { running = true; requestAnimationFrame(frame); } };

  build(); start();
  new ResizeObserver(() => { build(); start(); }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(canvas);
  addEventListener("pointermove", (e) => {
    const b = canvas.getBoundingClientRect();
    mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top;
  }, { passive: true });
}
