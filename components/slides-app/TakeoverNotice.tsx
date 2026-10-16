"use client";

import { useEffect, useState } from "react";
import type { RequestState, TakeoverPrompt } from "@/lib/realtime/host-lock";

// 발표자 탭 넘겨받기는 「요청」 — 진행 탭에서 거절할 수 있고, 20초 동안 거절이 없으면 넘어간다(Loki 리뷰 🟡1).

function useSecondsLeft(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

/** 진행 탭: 다른 창이 넘겨받으려 한다 */
export function TakeoverPromptBox({ prompt, onAnswer }: { prompt: TakeoverPrompt; onAnswer: (ok: boolean) => void }) {
  const left = useSecondsLeft(prompt.deadline);
  return (
    <div className="takeover-prompt" role="alertdialog" aria-label="진행 넘겨받기 요청">
      <p><b>다른 창이 이 연수의 진행을 넘겨받으려 합니다.</b></p>
      <p className="takeover-sub">내가 연 창이 아니면 [거절]을 누르세요. {left}초 뒤 자동으로 넘어갑니다.</p>
      <div className="takeover-actions">
        <button className="btn-primary takeover-deny" onClick={() => onAnswer(false)}>거절</button>
        <button className="btn-ghost takeover-grant" onClick={() => onAnswer(true)}>지금 넘기기</button>
      </div>
    </div>
  );
}

/** 보기 전용 탭: 요청 버튼과 진행 상황 */
export function StandbyBox({ request, onRequest }: { request: RequestState; onRequest: () => void }) {
  const left = useSecondsLeft(request.phase === "waiting" ? request.deadline : null);
  return (
    <div className="host-standby" role="alert">
      <p>이미 다른 창에서 이 연수를 진행 중입니다.</p>
      {request.phase === "waiting" ? (
        <p className="host-standby-sub">진행 중인 창에 요청했어요 — 그 창에서 거절하지 않으면 {left}초 뒤 이 창으로 넘어와요.</p>
      ) : (
        <p className="host-standby-sub">
          {request.phase === "denied" && "진행 중인 창에서 거절했어요. "}
          {request.phase === "busy" && "진행 중인 창이 다른 요청을 처리 중이에요. 잠시 뒤 다시 눌러 주세요. "}
          이 창은 보기 전용입니다. 여기서 이어서 진행하려면 아래 버튼을 누르세요(진행 중인 창에서 거절할 수 있어요).
        </p>
      )}
      <button className="btn-primary" disabled={request.phase === "waiting"} onClick={onRequest}>
        {request.phase === "waiting" ? "요청 보냄…" : "여기서 진행 요청"}
      </button>
    </div>
  );
}
