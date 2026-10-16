// 발표자 비밀값(host key) — 결과를 DB 에 저장·복원할 자격 (설계서 §6-4).
// 연수를 만든 브라우저 localStorage 에만 있다. DB 에는 해시만. 참가자 QR 에는 없다.
// 다른 PC: 🔑 발표자 링크(/presenter?room=…#hk=비밀값) — # 뒤는 서버로 안 가서 접속 기록에 안 남는다.

import { randomSecret, sha256Hex } from "./sha256";
import { readText, writeText } from "./storage";

const key = (roomId: string) => `ll:hk:${roomId}`;
const VALID = /^[0-9a-f]{32}$/;

export function newHostKey(): string {
  return randomSecret();
}

export const hostKeyHash = (hk: string) => sha256Hex(hk);

/** 「종료」 — 공용 PC 에 발표자 자격이 남지 않게 */
export function clearHostKey(roomId: string) {
  try { localStorage.removeItem(key(roomId)); } catch { /* 없음 */ }
}

export function saveHostKey(roomId: string, hk: string) {
  if (VALID.test(hk)) writeText(key(roomId), hk);
}

/**
 * 이 PC 의 발표자 비밀값. 주소에 #hk= 가 있으면 그걸 저장하고 주소에서 지운다(화면 공유·북마크에 안 남게).
 * 없으면 새로 만든다 — 예전 연수(비밀값 없이 만든 것)는 처음 결과를 저장할 때 DB 에 등록한다.
 */
export function loadHostKey(roomId: string): { hk: string; fromLink: boolean } {
  let fromLink = false;
  try {
    const m = window.location.hash.match(/(?:^#|&)hk=([0-9a-f]{32})(?:&|$)/);
    if (m) {
      saveHostKey(roomId, m[1]);
      fromLink = true;
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(window.history.state, "", url);
    }
  } catch { /* 주소를 못 읽어도 진행 */ }
  const saved = readText(key(roomId));
  if (saved && VALID.test(saved)) return { hk: saved, fromLink };
  const hk = newHostKey();
  saveHostKey(roomId, hk);
  return { hk, fromLink };
}

export function presenterLink(roomId: string, hk: string): string {
  return `${window.location.origin}/presenter?room=${encodeURIComponent(roomId)}#hk=${hk}`;
}
