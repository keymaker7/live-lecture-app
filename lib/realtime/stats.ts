// 실시간 메시지 계수기 — 부하 시험에서 초당 메시지 수를 재려고 둔다.
// 합계만 세고, localStorage["ll:debug"]="1" 일 때만 시각 기록을 남긴다(최대 50,000건).

type Dir = "sent" | "recv";

export interface RealtimeStats {
  sent: Record<string, number>;
  recv: Record<string, number>;
  log: Array<[number, Dir, string]>;
  /** 메시지가 아닌 표시(예: 방송 문지기가 미룬 횟수) — 초당 메시지 계산에 안 섞이게 따로 */
  notes?: Record<string, number>;
}

declare global {
  interface Window {
    __llStats?: RealtimeStats;
  }
}

let logging: boolean | undefined;

export function countMessage(dir: Dir, event: string) {
  if (typeof window === "undefined") return;
  const s = (window.__llStats ??= { sent: {}, recv: {}, log: [] });
  s[dir][event] = (s[dir][event] || 0) + 1;
  if (logging === undefined) {
    try { logging = localStorage.getItem("ll:debug") === "1"; } catch { logging = false; }
  }
  if (logging && s.log.length < 50000) s.log.push([Date.now(), dir, event]);
}

/** 메시지가 아닌 것을 센다(시각 기록 없음) */
export function countNote(name: string) {
  if (typeof window === "undefined") return;
  const s = (window.__llStats ??= { sent: {}, recv: {}, log: [] });
  s.notes = s.notes ?? {};
  s.notes[name] = (s.notes[name] || 0) + 1;
}
