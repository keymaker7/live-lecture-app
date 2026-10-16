"use client";

import { useEffect, useRef, useState } from "react";
import type { AudienceGame } from "@/lib/games/host-game";

// 참가자 폰 — 게임 중 큰 버튼 화면 (설계서 §4-1). 소리는 없고, 정답·탈락 때 짧게 진동(되는 기기만).

interface PhoneGameProps {
  game: AudienceGame;
  pid: string;
  emit: (event: string, data?: unknown) => Promise<unknown> | void;
}

const MC_COLORS = ["#ff6b6b", "#4dabf7", "#f2b705", "#40c057"];
const MC_LABELS = ["①", "②", "③", "④"];
const HANDS = [
  { key: "가위", emoji: "✌️" },
  { key: "바위", emoji: "✊" },
  { key: "보", emoji: "🖐" },
];

const buzz = (pattern: number | number[]) => {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 진동 없는 기기 */ }
};

export function PhoneGame({ game, pid, emit }: PhoneGameProps) {
  const g = game;
  const qKey = g.type === "quiz" ? `${g.id}:${g.q?.no ?? 0}` : g.type === "rps" ? `${g.id}:${g.round ?? 0}` : g.id;
  // 문제(판)를 받은 순간 — 폰이 재는 응답 시간의 시작
  const [openedAt, setOpenedAt] = useState<{ key: string; at: number }>({ key: "", at: 0 });
  const [choice, setChoice] = useState<{ key: string; value: number | string | null; tries: number; text: string }>({ key: "", value: null, tries: 0, text: "" });
  const [now, setNow] = useState(() => Date.now());
  const [input, setInput] = useState("");
  const buzzedRef = useRef("");

  // 달리기
  const [goAt, setGoAt] = useState<{ id: string; at: number }>({ id: "", at: 0 });
  const [steps, setSteps] = useState(0);
  const unsentRef = useRef(0);

  const open = g.phase === "open";
  if (open && openedAt.key !== qKey) setOpenedAt({ key: qKey, at: Date.now() });
  if (g.type === "run" && g.phase === "countdown" && goAt.id !== g.id) {
    setGoAt({ id: g.id, at: Date.now() + 3000 });
    setSteps(0);
  }
  const mine = choice.key === qKey ? choice : { key: qKey, value: null, tries: 0, text: "" };
  const jailed = !!g.out?.includes(pid);
  const res = g.reveal?.res?.[pid];

  // 남은 시간·카운트다운 화면용 시계
  useEffect(() => {
    if (g.phase === "finished") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [g.phase]);

  // 판정이 나오면 진동 한 번
  useEffect(() => {
    if (!g.reveal || buzzedRef.current === qKey + g.phase) return;
    if (g.phase !== "revealed" && g.phase !== "finished") return;
    buzzedRef.current = qKey + g.phase;
    if (g.reveal.void) return;
    if (res?.[0] === 1) buzz(60);
    else if (res) buzz([180, 80, 180]);
  }, [g.reveal, g.phase, qKey, res]);

  // 달리기: 누른 횟수를 묶어서 보낸다(묶음 간격은 발표자가 인원에 맞춰 정함)
  useEffect(() => {
    if (g.type !== "run" || !g.run || goAt.id !== g.id) return;
    const t = setInterval(() => {
      const n = unsentRef.current;
      if (n <= 0) return;
      unsentRef.current = 0;
      void emit("game-steps", { gid: g.id, count: n });
    }, g.run.batchMs);
    return () => clearInterval(t);
  }, [g.type, g.id, g.run, goAt.id, emit]);

  const clientMs = () => Math.max(0, Date.now() - (openedAt.key === qKey ? openedAt.at : Date.now()));

  const answer = (value: number | string) => {
    if (!open || jailed) return;
    if (g.type === "quiz" && g.q?.kind === "short") {
      const text = String(value).trim();
      if (!text || mine.tries >= 3) return;
      setChoice({ key: qKey, value: text, tries: mine.tries + 1, text });
      setInput("");
      void emit("game-answer", { gid: g.id, qno: g.q.no, choice: text, clientMs: clientMs() });
      return;
    }
    if (mine.value === value) return;
    setChoice({ key: qKey, value, tries: mine.tries + 1, text: "" });
    buzz(20);
    if (g.type === "quiz") void emit("game-answer", { gid: g.id, qno: g.q?.no, choice: value, clientMs: clientMs() });
    else void emit("game-answer", { gid: g.id, round: g.round, choice: value });
  };

  const left = g.type === "quiz" && open && g.q && openedAt.key === qKey
    ? Math.max(0, Math.ceil((openedAt.at + g.q.limitMs - now) / 1000)) : null;

  // ── 화면 ──
  let body: React.ReactNode;
  if (g.phase === "finished") {
    const pts = g.pts?.[pid] ?? 0;
    const won = g.winners?.includes(pid);
    body = (
      <div className="pg-center">
        <div className="pg-big">{won ? "🏆" : "🎉"}</div>
        <h2>{won ? "우승!" : "게임 끝!"}</h2>
        <p className="pg-points">이번 게임 +{pts}점</p>
        <p className="pg-sub">발표 화면에서 결과를 확인하세요</p>
      </div>
    );
  } else if (g.phase === "ready") {
    body = (
      <div className="pg-center">
        <div className="pg-big">{g.type === "quiz" ? "❓" : g.type === "rps" ? "✊" : "🏃"}</div>
        <h2>{g.title}</h2>
        <p className="pg-sub">{g.type === "run" ? "곧 출발해요! 출발하면 [달려!]를 마구 누르세요" : "곧 시작해요 — 화면을 봐 주세요"}</p>
      </div>
    );
  } else if (g.type === "run") {
    const toGo = goAt.id === g.id ? Math.ceil((goAt.at - now) / 1000) : 3;
    const goal = g.run?.goal ?? 50;
    const running = goAt.id === g.id && now >= goAt.at;
    const ended = goAt.id === g.id && now > goAt.at + (g.run?.limitSec ?? 60) * 1000;
    const done = steps >= goal;
    body = (
      <div className="pg-center">
        {!running && <div className="pg-countdown">{toGo > 0 ? toGo : "GO!"}</div>}
        <button
          className={`pg-run ${running && !done && !ended ? "" : "off"}`}
          disabled={!running || done || ended}
          onPointerDown={(e) => {
            e.preventDefault();
            if (!running || done || ended) return;
            unsentRef.current += 1;
            setSteps((n) => Math.min(goal, n + 1));
          }}
        >{done ? "🏁 골인!" : "달려!"}</button>
        <div className="pg-progress"><div style={{ width: `${(steps / goal) * 100}%` }} /></div>
        <p className="pg-sub">{steps} / {goal} 걸음</p>
      </div>
    );
  } else {
    // 퀴즈 · 가위바위보
    const header = g.type === "quiz"
      ? <p className="pg-meta">Q{g.q?.no}/{g.q?.total}{left !== null ? ` · ⏱ ${left}초` : ""}{g.mode === "survival" ? " · 서바이벌" : ""}</p>
      : <p className="pg-meta">가위바위보 {g.round}판</p>;
    let result: React.ReactNode = null;
    if ((g.phase === "revealed") && g.reveal) {
      if (g.reveal.void) result = <div className="pg-result void">😱 전원 탈락! 이번 문제는 무효, 모두 부활</div>;
      else if (res) result = <div className={`pg-result ${res[0] ? "ok" : "no"}`}>{res[0] ? `정답! +${res[1]}점` : jailed ? "탈락 — 감옥에서 구경해요" : "땡!"}<small>{g.type === "quiz" ? `정답: ${g.reveal.key}` : `강사: ${g.reveal.key}`}</small></div>;
      else result = <div className="pg-result">{g.type === "quiz" ? `정답: ${g.reveal.key}` : `강사: ${g.reveal.key}`}</div>;
    } else if (g.phase === "closed" || g.phase === "countdown") {
      result = <div className="pg-result wait">{g.type === "rps" ? "가위! 바위! 보!" : "마감! 정답 공개를 기다려요"}</div>;
    }

    let buttons: React.ReactNode = null;
    if (jailed) {
      buttons = <div className="pg-jail">🔒 감옥에서 구경 중 — 다음 게임에서 만나요</div>;
    } else if (g.type === "rps") {
      buttons = (
        <div className="pg-grid three">
          {HANDS.map((h) => (
            <button key={h.key} className={`pg-btn ${mine.value === h.key ? "picked" : ""}`} disabled={!open} onClick={() => answer(h.key)}>
              <span className="pg-emoji">{h.emoji}</span>{h.key}
            </button>
          ))}
        </div>
      );
    } else if (g.q?.kind === "ox") {
      buttons = (
        <div className="pg-grid two">
          {["O", "X"].map((o, i) => (
            <button key={o} className={`pg-btn ox ${i ? "x" : "o"} ${mine.value === i ? "picked" : ""}`} disabled={!open} onClick={() => answer(i)}>{o}</button>
          ))}
        </div>
      );
    } else if (g.q?.kind === "mc") {
      buttons = (
        <div className="pg-grid four">
          {g.q.options.map((o, i) => (
            <button key={i} className={`pg-btn mc ${mine.value === i ? "picked" : ""}`} style={{ background: MC_COLORS[i] }} disabled={!open} onClick={() => answer(i)}>
              <span className="pg-mc-no">{MC_LABELS[i]}</span>{o}
            </button>
          ))}
        </div>
      );
    } else if (g.q?.kind === "short") {
      buttons = (
        <form className="pg-short" onSubmit={(e) => { e.preventDefault(); answer(input); }}>
          <input value={input} maxLength={40} onChange={(e) => setInput(e.target.value)} placeholder="정답 입력" disabled={!open || mine.tries >= 3} autoComplete="off" />
          <button className="btn-primary" disabled={!open || mine.tries >= 3 || !input.trim()}>보내기</button>
          <p className="pg-sub">{mine.tries ? `보낸 답: ${mine.text} · ${3 - mine.tries}번 남음` : "3번까지 낼 수 있어요"}</p>
        </form>
      );
    }
    body = (
      <div className="pg-play">
        {header}
        {g.type === "quiz" && <h2 className="pg-q">{g.q?.text}</h2>}
        {buttons}
        {open && mine.value !== null && g.q?.kind !== "short" && <p className="pg-sub">보냈어요 · 마감 전엔 다른 걸 눌러 바꿀 수 있어요</p>}
        {result}
      </div>
    );
  }

  return <div className="pg">{body}</div>;
}
