import type { RealtimeChannel } from "@supabase/supabase-js";

// 발표자 탭이 둘 열리면 둘 다 참가자 명령을 처리해 상태가 꼬인다.
// 같은 PC 는 BroadcastChannel, 다른 PC 는 명령 채널(slides-cmd, 발표자만 구독)의 Presence 로 서로를 본다.
// 규칙: activeAt 이 가장 큰 탭 하나만 진행(active). 뒤에 연 탭은 activeAt=0 으로 들어와 대기(standby)하고,
// [여기서 진행]을 누르면 activeAt 을 지금까지 본 값보다 크게 올려 넘겨받는다.
//
// 넘겨받기는 「요청」이다(Loki 리뷰 🟡1 — 참가자가 /presenter?room= 주소만 열고 버튼 한 번으로 강사 화면을 밀어내던 것).
//   요청 탭 → host-req · 진행 탭은 바로 ack(마감 시각) + 화면에 [거절]/[지금 넘기기], 20초 동안 거절이 없으면 스스로 넘김
//   넘김(ok) 을 받은 요청 탭만 claim. 진행 탭이 아예 응답이 없으면(꺼짐·멈춤) 20초 뒤 요청 탭이 claim.
//   개발자가 host-takeover·presence 를 직접 보내는 것까지는 못 막는다(설계서 §6-5 한계 그대로).

export type HostStatus = "deciding" | "active" | "standby";

interface HostMeta {
  tab: string;
  activeAt: number;
}

// BroadcastChannel 은 탭 ID 대신 로드마다 새로 만드는 inst 로 자기 메시지를 거른다(새로고침 전후가 같은 탭 ID 라서).
type BcMessage =
  | { t: "hello"; inst: string }
  | { t: "here"; inst: string; activeAt: number }
  | { t: "takeover"; inst: string; activeAt: number }
  | { t: "saved"; inst: string };

const DECIDE_MS = 1200;
/** 진행 탭이 거절할 수 있는 시간 — 지나면 넘긴다 */
export const TAKEOVER_GRACE_MS = 20000;
/** 진행 탭의 ack 를 기다리는 시간 — 안 오면 진행 탭이 없거나 멈춘 것 */
const ACK_WAIT_MS = 3000;

/** 진행 탭 화면: 다른 창이 넘겨받으려 한다 */
export interface TakeoverPrompt { from: string; id: string; deadline: number }
/** 요청 탭 화면 */
export type RequestState =
  | { phase: "idle" }
  | { phase: "waiting"; deadline: number }
  | { phase: "denied" }
  | { phase: "busy" };

interface ReqMsg { from: string; id: string }
interface AckMsg { to: string; id: string; deadline: number }
interface AnswerMsg { to: string; id: string; ok: boolean; busy?: boolean }

export class HostLock {
  status: HostStatus = "deciding";
  private activeAt = 0;
  private maxSeen = 0;
  private bc: BroadcastChannel | null = null;
  private channel: RealtimeChannel | null = null;
  private decideTimer: ReturnType<typeof setTimeout> | null = null;
  private savedWaiter: (() => void) | null = null;
  /** 넘겨받는 중(takeover 대기)에 내건 값 — 이보다 작은 탭을 보고 물러서지 않게. */
  private pendingAt = 0;
  private inst = Math.random().toString(36).slice(2);
  /** 진행 탭: 지금 받은 요청 */
  private prompt: (TakeoverPrompt & { timer: ReturnType<typeof setTimeout> }) | null = null;
  /** 요청 탭: 내가 보낸 요청 */
  private myReq: { id: string; acked: boolean; timers: Array<ReturnType<typeof setTimeout>> } | null = null;

  constructor(
    private roomId: string,
    readonly tabId: string,
    private hooks: {
      onStatus: (s: HostStatus) => void;
      /** 넘겨주기 직전 — 지금 상태를 바로 저장해야 다음 탭이 이어받는다. */
      onDemote: () => void;
      /** 진행 탭 — 넘겨받기 요청이 왔다/끝났다(null) */
      onPrompt?: (p: TakeoverPrompt | null) => void;
      /** 요청 탭 — 내 요청의 상태 */
      onRequest?: (r: RequestState) => void;
    }
  ) {
    if (typeof BroadcastChannel !== "undefined") {
      this.bc = new BroadcastChannel(`ll-host-${roomId}`);
      this.bc.onmessage = (e) => this.onBc(e.data as BcMessage);
    }
  }

  /** subscribe 전에 불러야 Presence 가 켜진다. */
  attach(channel: RealtimeChannel) {
    this.channel = channel;
    channel.on("presence", { event: "sync" }, () => this.onPresence());
    channel.on("broadcast", { event: "host-takeover" }, ({ payload }) => {
      const p = payload as HostMeta;
      if (p.tab !== this.tabId) this.seeOther(p.activeAt);
    });
    channel.on("broadcast", { event: "host-req" }, ({ payload }) => this.onReq(payload as ReqMsg));
    channel.on("broadcast", { event: "host-req-ack" }, ({ payload }) => this.onAck(payload as AckMsg));
    channel.on("broadcast", { event: "host-req-answer" }, ({ payload }) => this.onAnswer(payload as AnswerMsg));
  }

  /** 명령 채널 구독이 끝난 뒤. 다른 진행 탭이 있는지 잠깐 보고 정한다. */
  start() {
    this.bc?.postMessage({ t: "hello", inst: this.inst } satisfies BcMessage);
    void this.channel?.track({ tab: this.tabId, activeAt: 0 } satisfies HostMeta);
    if (!this.channel) {
      this.claim();
      return;
    }
    this.decideTimer = setTimeout(() => {
      this.decideTimer = null;
      if (this.status !== "deciding") return;
      if (this.othersActive()) this.setStatus("standby");
      else this.claim();
    }, DECIDE_MS);
  }

  /**
   * [여기서 진행 요청] — 진행 중인 탭이 있으면 허락을 받고, 없으면 바로 넘겨받는다.
   * 진행 탭이 ack 를 보내면 그 탭의 답(거절/넘김, 20초 뒤 자동 넘김)을 기다린다.
   */
  requestTakeover() {
    if (this.status === "active" || this.myReq) return;
    if (!this.channel || !this.othersActive()) {
      void this.takeover();
      return;
    }
    const id = Math.random().toString(36).slice(2, 10);
    const req = { id, acked: false, timers: [] as Array<ReturnType<typeof setTimeout>> };
    this.myReq = req;
    this.hooks.onRequest?.({ phase: "waiting", deadline: Date.now() + TAKEOVER_GRACE_MS });
    void this.channel.send({ type: "broadcast", event: "host-req", payload: { from: this.tabId, id } satisfies ReqMsg });
    // ack 가 없으면 진행 탭이 꺼졌거나 멈춘 것 — 20초 뒤 넘겨받는다(그 사이 거절이 오면 취소)
    req.timers.push(setTimeout(() => {
      if (this.myReq !== req || req.acked) return;
      req.timers.push(setTimeout(() => {
        if (this.myReq === req && !req.acked) this.finishRequest(true);
      }, TAKEOVER_GRACE_MS - ACK_WAIT_MS));
    }, ACK_WAIT_MS));
  }

  /** 진행 탭: 요청에 답한다(거절 / 지금 넘기기) */
  answerTakeover(ok: boolean) {
    const p = this.prompt;
    if (!p) return;
    clearTimeout(p.timer);
    this.prompt = null;
    this.hooks.onPrompt?.(null);
    if (ok) this.hooks.onDemote(); // 넘기기 전에 지금 상태를 저장 — 넘겨받는 탭이 이어받는다
    void this.channel?.send({ type: "broadcast", event: "host-req-answer", payload: { to: p.from, id: p.id, ok } satisfies AnswerMsg });
  }

  private onReq(m: ReqMsg) {
    if (!m || m.from === this.tabId || this.status !== "active") return;
    if (this.prompt) {
      // 이미 다른 요청을 보여 주는 중 — 나중 요청은 "바쁨"으로 돌려보낸다(조용히 두면 그쪽이 20초 뒤 넘겨받는다)
      void this.channel?.send({ type: "broadcast", event: "host-req-answer", payload: { to: m.from, id: m.id, ok: false, busy: true } satisfies AnswerMsg });
      return;
    }
    const deadline = Date.now() + TAKEOVER_GRACE_MS;
    const timer = setTimeout(() => this.answerTakeover(true), TAKEOVER_GRACE_MS);
    this.prompt = { from: m.from, id: m.id, deadline, timer };
    this.hooks.onPrompt?.({ from: m.from, id: m.id, deadline });
    void this.channel?.send({ type: "broadcast", event: "host-req-ack", payload: { to: m.from, id: m.id, deadline } satisfies AckMsg });
  }

  private onAck(m: AckMsg) {
    const req = this.myReq;
    if (!m || m.to !== this.tabId || !req || req.id !== m.id) return;
    req.acked = true;
    this.hooks.onRequest?.({ phase: "waiting", deadline: m.deadline });
    // 진행 탭이 답을 약속했다. 마감 + 5초에도 답이 없고 진행 탭이 사라졌으면 넘겨받는다.
    req.timers.push(setTimeout(() => {
      if (this.myReq !== req) return;
      this.finishRequest(!this.othersActive());
    }, Math.max(0, m.deadline - Date.now()) + 5000));
  }

  private onAnswer(m: AnswerMsg) {
    const req = this.myReq;
    if (!m || m.to !== this.tabId || !req || req.id !== m.id) return;
    this.finishRequest(m.ok, m.busy);
  }

  private finishRequest(ok: boolean, busy = false) {
    const req = this.myReq;
    if (!req) return;
    req.timers.forEach(clearTimeout);
    this.myReq = null;
    if (ok) {
      this.hooks.onRequest?.({ phase: "idle" });
      void this.takeover();
    } else {
      this.hooks.onRequest?.({ phase: busy ? "busy" : "denied" });
    }
  }

  /** 넘겨받기 실행 — 앞 탭에 알리고, 앞 탭이 저장을 끝내면(최대 0.8초) 넘겨받는다.
   *  기다리는 동안은 deciding 이라 들어온 명령은 버리지 않고 모아 둔다. */
  async takeover(): Promise<void> {
    const at = Math.max(Date.now(), this.maxSeen + 1);
    this.maxSeen = at;
    this.pendingAt = at;
    this.setStatus("deciding");
    const waitSaved = new Promise<void>((resolve) => {
      this.savedWaiter = resolve;
      setTimeout(resolve, 800);
    });
    this.bc?.postMessage({ t: "takeover", inst: this.inst, activeAt: at } satisfies BcMessage);
    void this.channel?.send({
      type: "broadcast",
      event: "host-takeover",
      payload: { tab: this.tabId, activeAt: at } satisfies HostMeta,
    });
    await waitSaved;
    this.savedWaiter = null;
    this.pendingAt = 0;
    if (this.maxSeen > at) {
      this.setStatus("standby"); // 기다리는 사이 더 뒤의 탭이 넘겨받았다
      return;
    }
    this.claim(at);
  }

  dispose() {
    if (this.decideTimer) clearTimeout(this.decideTimer);
    if (this.prompt) clearTimeout(this.prompt.timer);
    this.myReq?.timers.forEach(clearTimeout);
    this.bc?.close();
    this.bc = null;
    void this.channel?.untrack();
  }

  private claim(at?: number) {
    if (this.decideTimer) {
      clearTimeout(this.decideTimer);
      this.decideTimer = null;
    }
    // 다른 PC 와 시계가 어긋나도 넘겨받을 수 있게, 지금까지 본 값보다 무조건 크게.
    this.activeAt = at ?? Math.max(Date.now(), this.maxSeen + 1);
    this.maxSeen = this.activeAt;
    void this.channel?.track({ tab: this.tabId, activeAt: this.activeAt } satisfies HostMeta);
    this.setStatus("active");
  }

  private setStatus(s: HostStatus) {
    if (this.status === s) return;
    if (s !== "active" && this.prompt) {
      clearTimeout(this.prompt.timer);
      this.prompt = null;
      this.hooks.onPrompt?.(null);
    }
    if (this.status === "active" && s === "standby") this.hooks.onDemote();
    this.status = s;
    this.hooks.onStatus(s);
  }

  private seeOther(activeAt: number) {
    if (activeAt > this.maxSeen) this.maxSeen = activeAt;
    if (activeAt <= 0) return;
    if (this.status === "deciding") {
      if (activeAt < this.pendingAt) return;
      this.setStatus("standby");
    } else if (this.status === "active" && activeAt > this.activeAt) this.setStatus("standby");
  }

  private othersActive(): boolean {
    return this.otherMetas().some((m) => m.activeAt > 0);
  }

  private otherMetas(): HostMeta[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<HostMeta>();
    const out: HostMeta[] = [];
    for (const [key, metas] of Object.entries(state)) {
      if (key === this.tabId) continue;
      for (const m of metas) out.push({ tab: m.tab, activeAt: Number(m.activeAt) || 0 });
    }
    return out;
  }

  private onPresence() {
    for (const m of this.otherMetas()) {
      if (m.activeAt > this.maxSeen) this.maxSeen = m.activeAt;
    }
    if (this.status === "deciding") return; // 정하는 건 타이머가
    if (this.status === "active") {
      const newer = this.otherMetas().some((m) => m.activeAt > this.activeAt);
      if (newer) this.setStatus("standby");
    }
  }

  private onBc(msg: BcMessage) {
    if (!msg || msg.inst === this.inst) return;
    if (msg.t === "hello" && this.status === "active") {
      this.bc?.postMessage({ t: "here", inst: this.inst, activeAt: this.activeAt } satisfies BcMessage);
    } else if (msg.t === "here") {
      this.seeOther(msg.activeAt);
    } else if (msg.t === "takeover") {
      const wasActive = this.status === "active";
      this.seeOther(msg.activeAt);
      if (wasActive) this.bc?.postMessage({ t: "saved", inst: this.inst } satisfies BcMessage);
    } else if (msg.t === "saved") {
      this.savedWaiter?.();
      this.savedWaiter = null;
    }
  }
}
