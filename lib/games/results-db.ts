// 게임 결과 DB 저장·복원 (설계서 §6-4) — 게임이 끝날 때마다 1건, 진행 중엔 안 씀.
// 표는 잠겨 있고 함수(record_game_result · claim_room_host · get_room_results)로만. supabase/migrations/20261016000000_game_results.sql
// 운영 DB 에 마이그레이션을 적용하기 전엔 서버 설정 LL_RESULTS_DB 가 꺼져 있어 아예 부르지 않는다(없는 함수 404 방지).

import { supabase } from "@/lib/supabase-client";
import { hostKeyHash } from "@/lib/realtime/host-key";
import type { ResultPayload } from "./records";

let enabled: Promise<boolean> | null = null;

/** 서버 설정(/api/config 의 resultsDb) — 한 번만 묻는다 */
export function resultsDbEnabled(): Promise<boolean> {
  if (!supabase) return Promise.resolve(false);
  if (!enabled) {
    enabled = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.resultsDb === true)
      .catch(() => false);
  }
  return enabled;
}

/** saved: 저장됨 · denied: 이 PC 비밀값이 이 연수의 것이 아님 · error: 통신 실패(다음에 다시) · off: 저장 꺼짐 */
export type SaveOutcome = "saved" | "denied" | "error" | "off";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; ok: boolean }> {
  if (!supabase) return { data: null, ok: false };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return error ? { data: null, ok: false } : { data: data as T, ok: true };
  } catch {
    return { data: null, ok: false };
  }
}

export async function saveResult(roomId: string, hk: string, payload: ResultPayload): Promise<SaveOutcome> {
  if (!(await resultsDbEnabled())) return "off";
  const send = () => rpc<string>("record_game_result", { p_room: roomId, p_host_key: hk, p_payload: payload });
  let r = await send();
  if (!r.ok) return "error";
  if (r.data === "unclaimed") {
    // 예전 연수(비밀값 없이 만든 것) — 비어 있을 때만 이 PC 비밀값을 등록하고 다시
    const c = await rpc<boolean>("claim_room_host", { p_room: roomId, p_host_key_hash: hostKeyHash(hk) });
    if (!c.ok) return "error";
    if (c.data !== true) return "denied";
    r = await send();
    if (!r.ok) return "error";
  }
  if (r.data === "ok" || r.data === "duplicate") return "saved";
  if (r.data === "denied" || r.data === "unclaimed") return "denied";
  return "error";
}

/** 이 연수의 끝난 게임들(끝난 순). 비밀값이 안 맞거나 꺼져 있으면 null */
export async function loadResults(roomId: string, hk: string): Promise<unknown[] | null> {
  if (!(await resultsDbEnabled())) return null;
  const r = await rpc<{ ok?: boolean; games?: unknown[] }>("get_room_results", { p_room: roomId, p_host_key: hk });
  if (!r.ok || !r.data?.ok || !Array.isArray(r.data.games)) return null;
  return r.data.games;
}
