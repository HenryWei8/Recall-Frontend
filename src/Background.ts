interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  opacity: number;
  hue: number;
  sat: number;
}

export class Background {
  private canvas: HTMLCanvasElement;
  private ctx   : CanvasRenderingContext2D;
  private pts   : Particle[] = [];
  private rafId = 0;
  private handleResize = () => this.resize();

  constructor() {
    this.canvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
    this.ctx    = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.handleResize);
    this.seed();
    this.frame();
  }

  private resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private seed() {
    const { innerWidth: W, innerHeight: H } = window;
    this.pts = Array.from({ length: 110 }, () => {
      const warm = Math.random() > 0.55;
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.11,
        vy: (Math.random() - 0.5) * 0.11,
        r: 0.35 + Math.random() * 1.55,
        opacity: 0.05 + Math.random() * 0.27,
        hue: warm ? 32 + Math.random() * 18 : 215 + Math.random() * 45,
        sat: warm ? 65 : 38,
      };
    });
  }

  private frame() {
    const { ctx, canvas: cv, pts } = this;
    const t = Date.now() / 14000;

    // slow-breathing radial gradient background
    const cx = cv.width  * (0.5 + 0.16 * Math.sin(t));
    const cy = cv.height * (0.5 + 0.11 * Math.cos(t * 0.75));
    const r  = Math.hypot(cv.width, cv.height) * 0.78;
    const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, '#0f0c1e');
    g.addColorStop(0.45, '#09070f');
    g.addColorStop(1, '#050408');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // secondary subtle glow (amber, opposite phase)
    const ax = cv.width  * (0.5 - 0.14 * Math.sin(t + 1.5));
    const ay = cv.height * (0.5 - 0.09 * Math.cos(t * 0.6 + 1));
    const ag = ctx.createRadialGradient(ax, ay, 0, ax, ay, cv.width * 0.55);
    ag.addColorStop(0, 'rgba(60,38,12,0.14)');
    ag.addColorStop(1, 'transparent');
    ctx.fillStyle = ag;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // particles
    for (const p of pts) {
      p.x = (p.x + p.vx + cv.width)  % cv.width;
      p.y = (p.y + p.vy + cv.height) % cv.height;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},${p.sat}%,75%,${p.opacity})`;
      ctx.fill();
    }

    this.rafId = requestAnimationFrame(() => this.frame());
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
  }
}
