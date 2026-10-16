import { EGG, EGG_CRACK, TEACHER, characterById, characterForNickname, type CharacterInfo } from "./characters";
import type { SoundFx } from "./sound";
import type { Confetti } from "./confetti";

// 캐릭터 광장 엔진 (설계서 §3) — React 밖에서 requestAnimationFrame + transform 으로 직접 움직인다.
// React 는 "누가 있나"만 알려 준다(upsert/remove/sync). 사용자 글자는 전부 textContent 로만 넣는다.

export type PlazaMode = "walk" | "plaza" | "hidden";

/** 게임 구역 — 좌표는 광장 크기에 대한 비율(0~1) */
export interface GameZone {
  key: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** 구역 색(반투명 배경) */
  color?: string;
  /** 크게 깔리는 글자(O, X, ①, ✌️ …) */
  label?: string;
  /** 보기 글자(발표자가 쓴 것 — textContent) */
  sub?: string;
}

export interface GameLayout {
  zones: GameZone[];
  /** 관중석 — 안 낸 사람 */
  audience: GameZone;
  /** 탈락자 감옥(서바이벌·가위바위보) */
  jail?: GameZone;
  /** 달리기 트랙 */
  track?: { x0: number; x1: number; y0: number; y1: number; lanes: number };
}

export interface PlazaMember {
  pid: string;
  nickname: string;
  character: string;
  level: number;
  lastActive: number;
}

interface Actor {
  m: PlazaMember;
  info: CharacterInfo;
  el: HTMLDivElement;
  body: HTMLDivElement;
  img: HTMLImageElement;
  halo: HTMLDivElement;
  name: HTMLDivElement;
  lv: HTMLSpanElement;
  zzz: HTMLSpanElement;
  bubble: HTMLDivElement | null;
  bubbleW: number;
  bubbleUntil: number;
  nameW: number;
  nameShift: number;
  x: number; y: number; tx: number; ty: number;
  speed: number;
  restUntil: number;
  facing: 1 | -1;
  phase: number;
  jumpAt: number;
  hatching: boolean;
  sleeping: boolean;
  shown: boolean;
  z: number;
  k: number;
  /** 게임 중 가 있을 구역(null = 자유) */
  zone: string | null;
  /** 새 구역으로 5배 속도로 달려가는 중 */
  rush: boolean;
  /** 달리기 트랙 위치(진행 비율·레인, 레인 -1 = 작은 점) */
  run: { ratio: number; lane: number } | null;
  scaleMul: number;
  /** 고정 난수(작은 점 레인 위치 등) */
  seed: number;
}

const WALK_MAX = 60;
const SLEEP_MS = 5 * 60 * 1000;
const JUMP_MS = 450;
const NOTICE_MAX = 3;
const NOTICE_MS = 3600;
// 프레임 사이 최대 시간 — 탭을 다녀와도 순간이동하지 않을 만큼만 자른다.
// 너무 작으면 프레임이 느린 PC(초당 15~30)에서 걷기가 그만큼 느려진다(0.034 일 때 15fps 에서 절반 속도).
const DT_MAX = 0.1;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function haloClass(level: number) {
  if (level >= 6) return "pz-halo h-rainbow";
  if (level >= 4) return "pz-halo h-gold";
  if (level >= 2) return "pz-halo h-white";
  return "pz-halo";
}

export class PlazaEngine {
  private actors = new Map<string, Actor>();
  /** 종합 순위 1·2·3등 — 순위판을 연 뒤로 광장에서도 왕관·메달 (pid → 1|2|3) */
  private medals = new Map<string, number>();
  private mode: PlazaMode = "walk";
  private W = 0;
  private H = 0;
  private rect = { left: 0, top: 0 };
  private base = 100;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver | null = null;
  private notices: HTMLDivElement;
  private more: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private teacher: HTMLDivElement;
  private sleepTimer: ReturnType<typeof setInterval>;
  private visDirty = true;
  private layout: GameLayout | null = null;
  private zoneLayer: HTMLDivElement;
  private zoneEls = new Map<string, HTMLDivElement>();
  /** 측정용 — 지금까지 그린 프레임 수 */
  frames = 0;

  constructor(
    private root: HTMLElement,
    private opts: { sound?: SoundFx | null; confetti?: Confetti | null } = {}
  ) {
    root.classList.add("pz-root");
    // 광장 배경(밤하늘·별·잔디·무대)은 CSS, 별 36개만 여기서
    const sky = document.createElement("div");
    sky.className = "pz-sky";
    for (let i = 0; i < 36; i++) {
      const s = document.createElement("i");
      s.style.left = `${rand(2, 98)}%`;
      s.style.top = `${rand(4, 92)}%`;
      s.style.animationDelay = `${rand(0, 3).toFixed(2)}s`;
      sky.appendChild(s);
    }
    root.appendChild(sky);
    const spot = document.createElement("div");
    spot.className = "pz-spot";
    root.appendChild(spot);
    this.titleEl = document.createElement("div");
    this.titleEl.className = "pz-title";
    root.appendChild(this.titleEl);

    this.teacher = document.createElement("div");
    this.teacher.className = "pz-teacher";
    const timg = document.createElement("img");
    timg.src = TEACHER.file;
    timg.alt = "";
    timg.draggable = false;
    const tname = document.createElement("div");
    tname.className = "pz-name pz-name-host";
    tname.textContent = "강사";
    this.teacher.append(timg, tname);
    root.appendChild(this.teacher);

    this.zoneLayer = document.createElement("div");
    this.zoneLayer.className = "pz-zones";
    root.appendChild(this.zoneLayer);

    this.more = document.createElement("div");
    this.more.className = "pz-more";
    root.appendChild(this.more);

    this.notices = document.createElement("div");
    this.notices.className = "pz-notices";
    document.body.appendChild(this.notices);

    for (const c of [EGG, EGG_CRACK]) new Image().src = c.file;

    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(root);
    this.measure();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.sleepTimer = setInterval(() => this.checkSleep(), 10000);
    this.setMode("walk");
  }

  // ───────── 바깥에서 부르는 것 ─────────

  setMode(mode: PlazaMode) {
    const prev = this.mode;
    this.mode = mode;
    this.root.dataset.mode = mode;
    if (mode === "hidden") {
      this.stop();
      return;
    }
    this.measure();
    if (prev !== mode) for (const a of this.actors.values()) this.placeRandom(a);
    this.visDirty = true;
    this.start();
  }

  setTitle(text: string) {
    this.titleEl.textContent = text;
  }

  /** 지금 있는 사람 전체(발표자 새로고침 뒤 등) — 알 연출 없이 바로 동물로. */
  sync(list: PlazaMember[]) {
    const keep = new Set(list.map((m) => m.pid));
    for (const pid of [...this.actors.keys()]) if (!keep.has(pid)) this.remove(pid);
    for (const m of list) this.upsert(m, { hatch: false });
  }

  upsert(m: PlazaMember, o: { hatch?: boolean } = {}) {
    const a = this.actors.get(m.pid);
    if (!a) {
      this.create(m, !!o.hatch);
      return;
    }
    const prevLevel = a.m.level;
    a.m = { ...m };
    if (a.name.lastChild) a.name.lastChild.textContent = m.nickname;
    if (!a.hatching && a.info.id !== m.character) this.setSprite(a, characterById(m.character) ?? characterForNickname(m.nickname));
    if (m.level !== prevLevel) {
      a.lv.textContent = `Lv.${m.level}`;
      a.halo.className = haloClass(m.level);
      if (m.level > prevLevel) this.levelUp(a);
    }
    if (a.sleeping && Date.now() - m.lastActive < SLEEP_MS) this.wake(a);
    this.visDirty = true;
  }

  remove(pid: string) {
    const a = this.actors.get(pid);
    if (!a) return;
    a.el.remove();
    this.actors.delete(pid);
    this.resize();
    this.visDirty = true;
  }

  /** 채팅 = 머리 위 말풍선. 1.2초 멈춤 + 점프 + 팝. */
  say(pid: string, text: string) {
    const a = this.actors.get(pid);
    if (!a) return;
    this.wake(a);
    a.m.lastActive = Date.now();
    if (!a.bubble) {
      a.bubble = document.createElement("div");
      a.bubble.className = "pz-bubble";
      a.el.appendChild(a.bubble);
    }
    a.bubble.textContent = text;
    a.bubble.style.display = "";
    a.bubbleW = a.bubble.offsetWidth; // 말풍선이 생길 때 한 번만 잰다
    const now = performance.now();
    a.bubbleUntil = now + Math.min(12000, 4500 + text.length * 120);
    a.restUntil = Math.max(a.restUntil, now + 1200);
    a.jumpAt = now;
    a.el.classList.add("pz-speaking");
    this.opts.sound?.play("pop");
    this.visDirty = true;
  }

  /** 이모지 반응 = 머리 위로 떠오름. */
  react(pid: string, emoji: string) {
    const a = this.actors.get(pid);
    if (!a) return;
    this.wake(a);
    a.m.lastActive = Date.now();
    this.floatAbove(a, emoji, "pz-float", 1700);
  }

  /** 질문 = 머리 위 ❓ 2초. */
  ask(pid: string) {
    const a = this.actors.get(pid);
    if (!a) return;
    this.wake(a);
    a.m.lastActive = Date.now();
    this.floatAbove(a, "❓", "pz-ask", 2000);
  }

  /** 상단 알림 — 최대 3개, 3.6초. */
  notify(text: string) {
    while (this.notices.childElementCount >= NOTICE_MAX) this.notices.firstElementChild?.remove();
    const n = document.createElement("div");
    n.className = "pz-notice";
    n.textContent = text;
    this.notices.appendChild(n);
    setTimeout(() => n.remove(), NOTICE_MS);
  }

  count() {
    return this.actors.size;
  }

  // ───────── 게임 (설계서 §4) ─────────

  /** 게임 구역을 깐다(null = 원래 광장). 모두 관중석에서 시작. */
  setLayout(layout: GameLayout | null) {
    this.layout = layout;
    this.zoneLayer.replaceChildren();
    this.zoneEls.clear();
    this.root.classList.toggle("pz-game", !!layout);
    if (layout) {
      const add = (z: GameZone, cls: string) => {
        const el = document.createElement("div");
        el.className = cls;
        el.dataset.key = z.key;
        el.style.left = `${z.x0 * 100}%`;
        el.style.width = `${(z.x1 - z.x0) * 100}%`;
        el.style.top = `${z.y0 * 100}%`;
        el.style.height = `${(z.y1 - z.y0) * 100}%`;
        if (z.color) el.style.setProperty("--zc", z.color);
        if (z.label) {
          const big = document.createElement("span");
          big.className = "pz-zone-big";
          big.textContent = z.label;
          el.appendChild(big);
        }
        if (z.sub) {
          const sub = document.createElement("span");
          sub.className = "pz-zone-sub";
          sub.textContent = z.sub;
          el.appendChild(sub);
        }
        this.zoneLayer.appendChild(el);
        this.zoneEls.set(z.key, el);
      };
      for (const z of layout.zones) add(z, "pz-zone");
      add({ ...layout.audience, label: undefined, sub: "관중석" }, "pz-zone pz-zone-aud");
      if (layout.jail) add({ ...layout.jail, key: "jail", label: undefined, sub: "🔒 탈락자 감옥" }, "pz-zone pz-zone-jail");
      if (layout.track) {
        const t = layout.track;
        const el = document.createElement("div");
        el.className = "pz-track";
        el.style.left = `${t.x0 * 100 - 3}%`;
        el.style.width = `${(t.x1 - t.x0) * 100 + 6}%`;
        el.style.top = `${t.y0 * 100}%`;
        el.style.height = `${(t.y1 - t.y0) * 100}%`;
        el.style.setProperty("--lanes", String(t.lanes));
        const start = document.createElement("span");
        start.className = "pz-track-start";
        start.textContent = "START";
        const fin = document.createElement("span");
        fin.className = "pz-track-finish";
        fin.textContent = "🏁 FINISH";
        el.append(start, fin);
        this.zoneLayer.appendChild(el);
      }
    }
    for (const a of this.actors.values()) {
      a.run = null;
      this.assignActor(a, layout ? "audience" : null, layout ? { gray: true } : undefined);
    }
    this.resize();
  }

  /** 게임 중 자리: 답 구역 key / "audience"(안 낸 사람, 흑백 0.6배) / "wait"(참가했지만 아직 안 냄) / "jail"(0.5배) */
  assign(pid: string, key: string | null, o?: { gray?: boolean }) {
    const a = this.actors.get(pid);
    if (a) this.assignActor(a, key, o);
  }

  private assignActor(a: Actor, key: string | null, o?: { gray?: boolean }) {
    const changed = a.zone !== key;
    a.zone = key;
    const gray = !!o?.gray && key === "audience";
    a.el.classList.toggle("pz-gray", gray);
    a.el.classList.toggle("pz-jailed", key === "jail");
    a.scaleMul = key === "jail" ? 0.5 : gray ? 0.6 : 1;
    if (changed) {
      a.rush = !!this.layout;
      a.restUntil = 0;
      this.pickTarget(a);
    }
  }

  /** 달리기 위치 — ratio 0~1, lane 0~9 (그 밖은 -1 → 작은 점) */
  runPos(pid: string, ratio: number, lane: number) {
    const a = this.actors.get(pid);
    if (!a) return;
    if (!a.run) {
      a.zone = "track";
      a.el.classList.remove("pz-gray", "pz-jailed");
    }
    a.run = { ratio: clamp(ratio, 0, 1), lane };
    a.scaleMul = lane >= 0 ? 0.8 : 0.42;
  }

  /** 판정: 탈락자 쓰러짐 */
  fall(pids: string[]) {
    for (const pid of pids) {
      const a = this.actors.get(pid);
      if (!a) continue;
      a.el.classList.add("pz-fall");
      setTimeout(() => a.el.classList.remove("pz-fall"), 1600);
    }
  }

  /** 판정: 생존자 점프 + 불꽃(앞의 8명만 불꽃 — 성능) */
  cheer(pids: string[]) {
    const now = performance.now();
    pids.forEach((pid, i) => {
      const a = this.actors.get(pid);
      if (!a) return;
      a.jumpAt = now + i * 30;
      if (i < 8) this.opts.confetti?.fireworks(this.rect.left + a.x, this.rect.top + a.y - this.base * a.k * 0.7, 18);
    });
  }

  /** 이긴 구역 반짝 */
  flashZone(key: string) {
    const el = this.zoneEls.get(key);
    if (!el) return;
    el.classList.remove("pz-zone-win");
    void el.offsetWidth;
    el.classList.add("pz-zone-win");
  }

  /** 종합 순위 1·2·3등에게 왕관·은·동 메달(머리 위). 빈 배열이면 다 뗀다. */
  setMedals(top3: string[]) {
    const next = new Map(top3.slice(0, 3).map((pid, i) => [pid, i + 1]));
    for (const [pid, a] of this.actors) {
      const want = next.get(pid) ?? 0;
      if ((this.medals.get(pid) ?? 0) === want) continue;
      a.body.querySelector(".pz-medal")?.remove();
      if (want) this.putMedal(a.body, want);
    }
    this.medals = next;
  }

  private putMedal(body: HTMLDivElement, rank: number) {
    const m = document.createElement("span");
    m.className = `pz-medal r${rank}`;
    m.textContent = ["👑", "🥈", "🥉"][rank - 1];
    body.appendChild(m);
  }

  /** 머리 위 표시(✓, O, 손 모양 등) */
  badge(pid: string, text: string) {
    const a = this.actors.get(pid);
    if (a) this.floatAbove(a, text, "pz-badge", 2500);
  }

  destroy() {
    this.stop();
    clearInterval(this.sleepTimer);
    this.ro?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.notices.remove();
    this.root.replaceChildren();
    this.root.classList.remove("pz-root");
    this.actors.clear();
  }

  // ───────── 안쪽 ─────────

  private create(m: PlazaMember, hatch: boolean) {
    const info = characterById(m.character) ?? characterForNickname(m.nickname);
    const el = document.createElement("div");
    el.className = "pz-ch";
    el.dataset.pid = m.pid;
    const body = document.createElement("div");
    body.className = "pz-body";
    const halo = document.createElement("div");
    halo.className = haloClass(m.level);
    const img = document.createElement("img");
    img.className = "pz-sprite";
    img.alt = "";
    img.draggable = false;
    const shadow = document.createElement("div");
    shadow.className = "pz-shadow";
    body.append(shadow, halo, img);
    const name = document.createElement("div");
    name.className = "pz-name";
    const lv = document.createElement("span");
    lv.className = "pz-lv";
    lv.textContent = `Lv.${m.level}`;
    const zzz = document.createElement("span");
    zzz.className = "pz-zzz";
    zzz.textContent = "💤";
    const nick = document.createElement("span");
    nick.textContent = m.nickname;
    name.append(zzz, lv, nick);
    el.append(body, name);
    this.root.appendChild(el);
    const medal = this.medals.get(m.pid);
    if (medal) this.putMedal(body, medal);

    const a: Actor = {
      m: { ...m }, info, el, body, img, halo, name, lv, zzz,
      bubble: null, bubbleW: 0, bubbleUntil: 0, nameW: 0, nameShift: 0,
      x: 0, y: 0, tx: 0, ty: 0, speed: rand(28, 55), restUntil: 0, facing: 1, phase: rand(0, 6),
      jumpAt: -1e9, hatching: false, sleeping: false, shown: true, z: -1, k: 1,
      zone: null, rush: false, run: null, scaleMul: 1, seed: Math.random(),
    };
    this.actors.set(m.pid, a);
    if (this.layout) a.zone = "audience"; // 게임 중에 들어온 사람은 관중석부터
    this.placeRandom(a);
    if (this.layout) this.assignActor(a, "audience", { gray: true });
    this.resize();
    a.nameW = name.offsetWidth;

    if (hatch) {
      a.hatching = true;
      this.setSprite(a, EGG);
      img.classList.add("pz-egg");
      a.restUntil = Infinity;
      setTimeout(() => { if (this.actors.get(m.pid) === a) this.setSprite(a, EGG_CRACK); }, 1200);
      setTimeout(() => {
        if (this.actors.get(m.pid) !== a) return;
        img.classList.remove("pz-egg");
        a.hatching = false;
        this.setSprite(a, characterById(a.m.character) ?? info);
        a.restUntil = performance.now() + 600;
        a.jumpAt = performance.now();
        this.floatAbove(a, "✨", "pz-sparkle", 900);
        this.opts.sound?.play("hatch");
        this.notify(`🐣 새 친구 ${a.m.nickname} 님 도착!`);
      }, 1800);
    } else {
      this.setSprite(a, info);
    }
    this.visDirty = true;
  }

  private setSprite(a: Actor, info: CharacterInfo) {
    a.info = info;
    a.img.src = info.file;
    this.sizeActor(a);
  }

  private sizeActor(a: Actor) {
    const h = Math.round(this.base);
    const w = Math.round((h * a.info.w) / a.info.h);
    a.body.style.width = `${w}px`;
    a.body.style.height = `${h}px`;
    a.body.style.left = `${-w / 2}px`;
  }

  /** 인원에 맞춰 기본 크기를 다시 정한다(인원이 바뀔 때만 — 레이아웃 비용). */
  private resize() {
    const n = Math.max(1, this.mode === "walk" ? Math.min(this.actors.size, WALK_MAX) : this.actors.size);
    let base: number;
    if (this.mode === "walk") base = clamp(this.H * 0.55, 44, 100);
    else base = clamp(Math.sqrt((this.W * this.H * 0.6) / n) * 0.72, 80, 150);
    if (Math.abs(base - this.base) < 2) return;
    this.base = base;
    for (const a of this.actors.values()) this.sizeActor(a);
    const th = Math.round(Math.max(base * 1.6, this.H * 0.2));
    this.teacher.style.height = `${th}px`;
  }

  private measure() {
    const r = this.root.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.rect = { left: r.left, top: r.top };
    this.resize();
  }

  /** 걸어다닐 수 있는 칸 [xMin,xMax]×[yMin,yMax] — y 는 발 위치. */
  private area() {
    if (this.layout) return { x0: 24, x1: this.W - 24, y0: this.H * 0.34, y1: this.H - 26 };
    if (this.mode === "walk") return { x0: 40, x1: this.W - 40, y0: this.H * 0.6, y1: this.H - 22 };
    return { x0: 60, x1: this.W - 60, y0: this.H * 0.44, y1: this.H - 34 };
  }

  /** 게임 구역의 실제 픽셀 칸(발 위치 기준 — 위아래 여백을 조금 둔다) */
  private zoneRect(key: string | null) {
    const L = this.layout;
    if (!L) return null;
    const z = key === "jail" ? L.jail : key === "audience" || key === "wait" || !key ? L.audience : L.zones.find((x) => x.key === key);
    if (!z) return null;
    const padX = Math.min(40, (z.x1 - z.x0) * this.W * 0.12);
    return {
      x0: z.x0 * this.W + padX, x1: z.x1 * this.W - padX,
      y0: z.y0 * this.H + Math.min(this.base * 0.9, (z.y1 - z.y0) * this.H * 0.5), y1: z.y1 * this.H - 22,
    };
  }

  private inTeacherZone(x: number, y: number) {
    return this.mode === "plaza" && Math.abs(x - this.W / 2) < this.W * 0.13 && y < this.H * 0.56;
  }

  private pickTarget(a: Actor) {
    if (a.run) return; // 트랙 위치는 runPos 가 정한다
    const zr = this.zoneRect(a.zone);
    if (zr) {
      a.tx = rand(zr.x0, Math.max(zr.x0, zr.x1));
      a.ty = rand(zr.y0, Math.max(zr.y0, zr.y1));
      return;
    }
    const r = this.area();
    for (let i = 0; i < 8; i++) {
      a.tx = rand(r.x0, r.x1);
      a.ty = rand(r.y0, r.y1);
      if (!this.inTeacherZone(a.tx, a.ty)) break;
    }
    if (a.sleeping) {
      a.tx = a.x < this.W / 2 ? r.x0 + rand(0, 30) : r.x1 - rand(0, 30);
    }
  }

  private placeRandom(a: Actor) {
    this.pickTarget(a);
    a.x = a.tx;
    a.y = a.ty;
    this.pickTarget(a);
  }

  private wake(a: Actor) {
    if (!a.sleeping) return;
    a.sleeping = false;
    a.el.classList.remove("pz-sleep");
    a.speed = rand(28, 55);
    this.pickTarget(a);
  }

  private checkSleep() {
    const now = Date.now();
    for (const a of this.actors.values()) {
      if (!a.sleeping && !a.hatching && now - a.m.lastActive > SLEEP_MS) {
        a.sleeping = true;
        a.el.classList.add("pz-sleep");
        a.speed = 12;
        this.pickTarget(a);
      }
    }
  }

  private levelUp(a: Actor) {
    a.jumpAt = performance.now();
    this.floatAbove(a, `LEVEL UP! Lv.${a.m.level}`, "pz-lvup", 1800);
    this.opts.sound?.play("lvup");
    if (a.shown && this.mode !== "hidden") {
      this.opts.confetti?.fireworks(this.rect.left + a.x, this.rect.top + a.y - this.base * a.k * 0.7, 28);
    }
  }

  private floatAbove(a: Actor, text: string, cls: string, ms: number) {
    const f = document.createElement("div");
    f.className = cls;
    f.textContent = text;
    f.style.bottom = `${Math.round(this.base * a.k + 8)}px`;
    a.el.appendChild(f);
    setTimeout(() => f.remove(), ms);
  }

  /** 산책로는 60명까지만 그린다 — 최근에 활동한 사람부터. 나머지는 "+N명". */
  private updateVisibility() {
    this.visDirty = false;
    const list = [...this.actors.values()];
    let hidden = 0;
    if (this.mode === "walk" && list.length > WALK_MAX) {
      list.sort((p, q) => q.m.lastActive - p.m.lastActive);
      list.forEach((a, i) => {
        const show = i < WALK_MAX || a.bubbleUntil > performance.now();
        if (!show) hidden++;
        if (show !== a.shown) {
          a.shown = show;
          a.el.style.display = show ? "" : "none";
        }
      });
    } else {
      for (const a of list) if (!a.shown) { a.shown = true; a.el.style.display = ""; }
    }
    this.more.textContent = hidden > 0 ? `+${hidden}명` : "";
    this.more.style.display = hidden > 0 ? "" : "none";
  }

  private start() {
    if (this.raf || this.mode === "hidden" || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, DT_MAX); // 탭을 다녀와도 순간이동하지 않게
    this.last = now;
    this.frames++;
    if (this.visDirty) this.updateVisibility();

    const r = this.area();
    const span = Math.max(1, r.y1 - r.y0);
    const depthLo = this.mode === "walk" ? 0.85 : 0.7;
    const depthHi = this.mode === "walk" ? 1.0 : 1.15;
    const tBreath = now / 1000;

    for (const a of this.actors.values()) {
      if (!a.shown) continue;
      let moving = false;
      if (a.run && this.layout?.track) {
        // 달리기: 진행 비율로 x, 레인으로 y — 사이는 부드럽게 따라간다
        const t = this.layout.track;
        const lanes = Math.max(1, t.lanes);
        const laneH = ((t.y1 - t.y0) * this.H) / lanes;
        a.tx = (t.x0 + (t.x1 - t.x0) * a.run.ratio) * this.W;
        a.ty = a.run.lane >= 0 ? t.y0 * this.H + laneH * (a.run.lane + 0.85) : t.y0 * this.H + laneH * (0.4 + a.seed * (lanes - 0.6));
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const f = Math.min(1, dt * 6);
        a.x += dx * f;
        a.y += dy * f;
        if (Math.abs(dx) > 0.8) { moving = true; a.facing = dx > 0 ? 1 : -1; }
      } else if (now >= a.restUntil) {
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy);
        // 게임 답 구역으로 갈 때는 화면 폭의 60%/초 — 어느 구역이든 2초 안에 도착(평소 걸음은 그대로)
        const step = (a.rush ? Math.max(a.speed * 5, this.W * 0.6) : a.speed) * dt;
        if (dist <= step) {
          a.x = a.tx;
          a.y = a.ty;
          a.rush = false;
          if (Math.random() < 0.4) a.restUntil = now + rand(1000, 4000);
          this.pickTarget(a);
        } else {
          a.x += (dx / dist) * step;
          a.y += (dy / dist) * step;
          if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
          moving = true;
        }
      }
      // 화면 밖으로 나가지 않게 매 프레임 가둔다(창 크기가 바뀐 뒤 등)
      a.x = clamp(a.x, r.x0, r.x1);
      a.y = clamp(a.y, r.y0, r.y1);

      const depth = depthLo + ((a.y - r.y0) / span) * (depthHi - depthLo);
      const k = depth * (a.sleeping ? 0.6 : 1) * a.scaleMul;
      a.k = k;
      let bob: number;
      let tilt: number;
      if (moving) {
        a.phase += dt * a.speed * 0.28;
        bob = Math.abs(Math.sin(a.phase)) * 0.07;
        tilt = Math.sin(a.phase) * 5;
      } else {
        bob = Math.sin(tBreath * 2.2 + a.phase) * 0.015;
        tilt = 0;
      }
      const jt = now - a.jumpAt;
      const jump = jt < JUMP_MS ? Math.sin((Math.PI * jt) / JUMP_MS) * 24 * k : 0;

      a.el.style.transform = `translate3d(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px,0)`;
      a.body.style.transform = `translateY(${(-jump).toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${(k * a.facing).toFixed(3)},${(k * (1 + bob)).toFixed(3)})`;

      const speaking = a.bubbleUntil > now;
      const z = speaking ? 100000 : Math.round(a.y);
      if (z !== a.z) {
        a.z = z;
        a.el.style.zIndex = String(z);
      }

      // 이름표가 화면 끝에서 잘리지 않게 옆으로 민다
      const half = a.nameW / 2;
      const ns = a.x - half < 4 ? 4 - (a.x - half) : a.x + half > this.W - 4 ? this.W - 4 - (a.x + half) : 0;
      if (Math.abs(ns - a.nameShift) > 0.5) {
        a.nameShift = ns;
        a.name.style.transform = `translateX(calc(-50% + ${ns.toFixed(1)}px))`;
      }

      if (a.bubble) {
        if (speaking) {
          const bw = a.bubbleW;
          let shift = 0;
          if (a.x - bw / 2 < 6) shift = 6 - (a.x - bw / 2);
          else if (a.x + bw / 2 > this.W - 6) shift = this.W - 6 - (a.x + bw / 2);
          const lift = this.base * k + 14 + jump;
          a.bubble.style.transform = `translate(${(-bw / 2 + shift).toFixed(1)}px,${(-lift).toFixed(1)}px) translateY(-100%)`;
          a.bubble.style.setProperty("--tail", `${(bw / 2 - shift).toFixed(1)}px`);
        } else if (a.bubble.style.display !== "none") {
          a.bubble.style.display = "none";
          a.el.classList.remove("pz-speaking");
          this.visDirty = true;
        }
      }
    }
  };
}
