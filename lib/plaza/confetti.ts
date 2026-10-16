// 꽃가루 + 불꽃 — canvas 하나(설계서 §5). 입자가 있을 때만 그리고, 없으면 rAF 를 멈춘다.

const COLORS = ["#ffd84d", "#ff7eb3", "#7ec8ff", "#8dffb0", "#ff4d6d", "#c39bff", "#ffffff"];
const EMOJI = ["🌸", "🌼", "✨", "🎉", "💛"];
const FIRE = ["#fff3a0", "#ffd84d", "#ff9f43", "#ff7eb3", "#7ec8ff", "#8dffb0"];

interface Paper {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; flip: number; vf: number;
  w: number; h: number; color: string; emoji?: string; life: number;
}
interface Spark {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number;
}

export class Confetti {
  private ctx: CanvasRenderingContext2D | null;
  private papers: Paper[] = [];
  private sparks: Spark[] = [];
  private raf = 0;
  private last = 0;
  private W = 0;
  private H = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** 좌우 아래에서 90개씩 쏘고, 위에서 70개 떨어진다. */
  burst() {
    const { W, H } = this;
    for (const side of [0, 1]) {
      for (let i = 0; i < 90; i++) {
        const dir = side === 0 ? 1 : -1;
        const speed = 700 + Math.random() * 600;
        const ang = (-Math.PI / 2) + dir * (0.15 + Math.random() * 0.45);
        this.papers.push(this.paper(side === 0 ? 0 : W, H, Math.cos(ang) * speed, Math.sin(ang) * speed));
      }
    }
    for (let i = 0; i < 70; i++) this.papers.push(this.paper(Math.random() * W, -20 - Math.random() * 200, (Math.random() - 0.5) * 80, 80 + Math.random() * 120));
    this.kick();
  }

  /** 불꽃 한 송이 — 레벨업·생존자 점프 등. */
  fireworks(x: number, y: number, n = 36) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const v = 120 + Math.random() * 220;
      const max = 0.7 + Math.random() * 0.5;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color: FIRE[i % FIRE.length], r: 2 + Math.random() * 2 });
    }
    this.kick();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.papers = [];
    this.sparks = [];
  }

  private paper(x: number, y: number, vx: number, vy: number): Paper {
    const emoji = Math.random() < 0.08 ? EMOJI[Math.floor(Math.random() * EMOJI.length)] : undefined;
    return {
      x, y, vx, vy, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 10,
      flip: Math.random() * Math.PI, vf: 4 + Math.random() * 8, w: 7 + Math.random() * 7, h: 10 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)], emoji, life: 6,
    };
  }

  private kick() {
    if (this.raf || !this.ctx) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const ctx = this.ctx!;
    const dt = Math.min((now - this.last) / 1000, 0.034);
    this.last = now;
    ctx.clearRect(0, 0, this.W, this.H);

    this.papers = this.papers.filter((p) => {
      p.vy += 900 * dt;
      p.vx *= 1 - 1.6 * dt;
      if (p.vy > 160) p.vy = 160 + (p.vy - 160) * (1 - 3 * dt); // 공기 저항 — 천천히 팔랑
      p.x += (p.vx + Math.sin(p.flip) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > this.H + 40) return false;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life);
      if (p.emoji) {
        ctx.font = "20px sans-serif";
        ctx.fillText(p.emoji, -10, 8);
      } else {
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
      return true;
    });

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.sparks = this.sparks.filter((s) => {
      s.vy += 260 * dt;
      s.vx *= 1 - 1.2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) return false;
      ctx.globalAlpha = s.life / s.max;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.restore();

    if (this.papers.length || this.sparks.length) this.raf = requestAnimationFrame(this.tick);
    else this.raf = 0;
  };
}
