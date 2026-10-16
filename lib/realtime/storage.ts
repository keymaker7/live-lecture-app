import { v4 as uuidv4 } from "uuid";
import { randomSecret } from "./sha256";

// localStorage 를 안전하게 — 사생활 보호 모드·용량 초과에서도 앱이 멈추지 않게 try/catch.

export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readText(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeText(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 진행 */ }
}

const memoryPids = new Map<string, string>();

/** 참가자 ID — 같은 폰·같은 연수면 새로고침해도 같은 값. */
export function stablePid(roomId: string): string {
  const key = `ll:pid:${roomId}`;
  const saved = readText(key);
  if (saved && /^[0-9a-f-]{8,64}$/.test(saved)) return saved;
  const pid = memoryPids.get(roomId) ?? uuidv4();
  memoryPids.set(roomId, pid);
  writeText(key, pid);
  return pid;
}

/** 발표자 탭 ID — 새로고침해도 같은 값(sessionStorage), 새 탭·탭 복제는 새 값.
 *  읽자마자 지우고 pagehide 때 다시 써 둔다 → 복제된 탭은 빈 sessionStorage 를 물려받는다. */
export function hostTabId(roomId: string): string {
  const key = `ll:tab:${roomId}`;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
  } catch { /* 없으면 새로 */ }
  if (!id || !/^[0-9a-f-]{8,64}$/.test(id)) id = uuidv4();
  const keep = () => { try { sessionStorage.setItem(key, id!); } catch { /* 무시 */ } };
  window.addEventListener("pagehide", keep);
  return id;
}

const memoryTokens = new Map<string, string>();

/** 참가 토큰 — 이 폰만 아는 비밀값(pid 와 함께 저장). 발표자에겐 해시만 알려 주고, 그 뒤 모든 명령에 붙인다. */
export function stableToken(roomId: string): string {
  const key = `ll:tok:${roomId}`;
  const saved = readText(key);
  if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  const tok = memoryTokens.get(roomId) ?? randomSecret();
  memoryTokens.set(roomId, tok);
  writeText(key, tok);
  return tok;
}

/** 폰이 직접 센 내 활동(채팅·반응·질문·투표) — 폰 위쪽 Lv 표시용. 발표자 쪽 Lv 와 같은 공식. */
export interface MyActivity { chats: number; reactions: number; questions: number; votes: number }

export function readMyActivity(roomId: string): MyActivity {
  const a = readJSON<MyActivity>(`ll:act:${roomId}`);
  return { chats: a?.chats ?? 0, reactions: a?.reactions ?? 0, questions: a?.questions ?? 0, votes: a?.votes ?? 0 };
}

export function bumpMyActivity(roomId: string, field: keyof MyActivity): MyActivity {
  const a = readMyActivity(roomId);
  a[field] += 1;
  writeJSON(`ll:act:${roomId}`, a);
  return a;
}
