import type { RealtimeChannel } from "@supabase/supabase-js";

// 발표자 탭이 둘 열리면 둘 다 참가자 명령을 처리해 상태가 꼬인다.
// 같은 PC 는 BroadcastChannel, 다른 PC 는 명령 채널(slides-cmd, 발표자만 구독)의 Presence 로 서로를 본다.
// 규칙: activeAt 이 가장 큰 탭 하나만 진행(active). 뒤에 연 탭은 activeAt=0 으로 들어와 대기(standby)하고,
// [여기서 진행]을 누르면 activeAt 을 지금까지 본 값보다 크게 올려 넘겨받는다.

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

  constructor(
    private roomId: string,
    readonly tabId: string,
    private hooks: {
      onStatus: (s: HostStatus) => void;
      /** 넘겨주기 직전 — 지금 상태를 바로 저장해야 다음 탭이 이어받는다. */
      onDemote: () => void;
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

  /** [여기서 진행] — 앞 탭에 알리고, 앞 탭이 저장을 끝내면(최대 0.8초) 넘겨받는다.
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
