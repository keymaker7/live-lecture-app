"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { GameLayout, GameZone } from "@/lib/plaza/engine";
import type { GameEffect, GameState, QuestionLog } from "@/lib/games/host-game";
import type { Participant } from "@/hooks/useSlidesRealtime";
import { characterById, characterForNickname, TEACHER } from "@/lib/plaza/characters";
import type { PlazaHandle } from "@/components/slides-app/PlazaStage";

type Handler = (data: unknown) => void;

export interface GameView {
  s: GameState;
  tally: number[];
  shortOrder: string[];
  runBoard: Array<{ pid: string; steps: number }>;
}

interface GameStageProps {
  on: (event: string, fn: Handler) => void;
  off: (event: string, fn: Handler) => void;
  emit: (event: string, data?: unknown) => void;
  plaza: MutableRefObject<PlazaHandle | null>;
}

interface Person { nickname: string; character: string; joinedAt: number }

const MC_COLORS = ["#ff6b6b", "#4dabf7", "#ffd43b", "#69db7c"];
const MC_LABELS = ["①", "②", "③", "④"];
const RPS_ZONES: Array<{ key: string; label: string; color: string }> = [
  { key: "가위", label: "✌️", color: "#ff922b" },
  { key: "바위", label: "✊", color: "#9775fa" },
  { key: "보", label: "🖐", color: "#51cf66" },
];
const HAND_EMOJI: Record<string, string> = { 가위: "✌️", 바위: "✊", 보: "🖐" };
const MEDAL = ["🥇", "🥈", "🥉"];

/** 게임 화면 배치 — 위 34%는 문제 카드, 아래 18%는 관중석, 서바이벌·가위바위보는 오른쪽에 감옥 */
function layoutFor(s: GameState): GameLayout {
  const jail = s.type === "rps" || s.mode === "survival";
  const right = jail ? 0.79 : 0.98;
  const audience: GameZone = { key: "audience", x0: 0.02, x1: right, y0: 0.82, y1: 0.995 };
  const jailZone: GameZone | undefined = jail ? { key: "jail", x0: 0.81, x1: 0.99, y0: 0.4, y1: 0.995 } : undefined;
  const cols = (items: Array<{ key: string; label: string; color: string; sub?: string }>): GameZone[] => {
    const w = (right - 0.02) / items.length;
    return items.map((it, i) => ({ key: it.key, x0: 0.02 + i * w + 0.004, x1: 0.02 + (i + 1) * w - 0.004, y0: 0.36, y1: 0.8, color: it.color, label: it.label, sub: it.sub }));
  };
  if (s.type === "run") return { zones: [], audience: { ...audience, x1: 0.98 }, track: { x0: 0.08, x1: 0.9, y0: 0.37, y1: 0.8, lanes: 10 } };
  if (s.type === "rps") return { zones: cols(RPS_ZONES), audience, jail: jailZone };
  const q = s.questions?.[s.qi ?? -1];
  if (!q) return { zones: [], audience, jail: jailZone };
  if (q.kind === "ox") return { zones: cols([{ key: "0", label: "O", color: "#4dabf7" }, { key: "1", label: "X", color: "#ff6b6b" }]), audience, jail: jailZone };
  if (q.kind === "mc") return { zones: cols(q.options.map((o, i) => ({ key: String(i), label: MC_LABELS[i], color: MC_COLORS[i], sub: o }))), audience, jail: jailZone };
  return { zones: [{ key: "ok", x0: 0.22, x1: right - 0.2, y0: 0.36, y1: 0.8, color: "#51cf66", label: "✓", sub: "정답자" }], audience, jail: jailZone };
}

const layoutKey = (s: GameState) => `${s.id}:${s.type}:${s.qi ?? ""}:${s.mode ?? ""}`;

export function GameStage({ on, off, emit, plaza }: GameStageProps) {
  const [view, setView] = useState<GameView | null>(null);
  const [stamp, setStamp] = useState<{ text: string; tone: string; id: number } | null>(null);
  const [rpsCount, setRpsCount] = useState("");
  const [popup, setPopup] = useState<{ title: string; top: Array<{ pid: string; points: number }>; rates?: QuestionLog[] } | null>(null);
  const [goalNote, setGoalNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const peopleRef = useRef(new Map<string, Person>());
  const [, setPeopleTick] = useState(0);
  const layoutKeyRef = useRef("");
  const lastStepSound = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const viewRef = useRef<GameView | null>(null);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const name = (pid: string) => peopleRef.current.get(pid)?.nickname ?? "?";
  const charFile = (pid: string) => {
    const p = peopleRef.current.get(pid);
    return (characterById(p?.character) ?? characterForNickname(p?.nickname ?? pid)).file;
  };
  const showStamp = (text: string, tone = "") => {
    const id = Date.now();
    setStamp({ text, tone, id });
    later(2200, () => setStamp((s) => (s?.id === id ? null : s)));
  };

  // 참가자 이름·캐릭터
  useEffect(() => {
    const put = (p: Participant) => peopleRef.current.set(p.pid, { nickname: p.nickname, character: p.character, joinedAt: p.joinedAt });
    const onList: Handler = (d) => { (d as Participant[]).forEach(put); setPeopleTick((n) => n + 1); };
    const onJoin: Handler = (d) => { put((d as { participant: Participant }).participant); setPeopleTick((n) => n + 1); };
    const onUpd: Handler = (d) => put(d as Participant);
    on("participants", onList);
    on("participant-joined", onJoin);
    on("participant-update", onUpd);
    return () => { off("participants", onList); off("participant-joined", onJoin); off("participant-update", onUpd); };
  }, [on, off]);

  // 게임 상태 → 광장 배치
  useEffect(() => {
    const apply = (v: GameView | null) => {
      viewRef.current = v;
      setView(v);
      const eng = plaza.current?.engine;
      if (!eng) return;
      if (!v || v.s.phase === "finished") {
        if (layoutKeyRef.current) {
          layoutKeyRef.current = "";
          eng.setLayout(null);
        }
        return;
      }
      const s = v.s;
      const key = layoutKey(s);
      if (key !== layoutKeyRef.current) {
        layoutKeyRef.current = key;
        eng.setLayout(layoutFor(s));
      }
      const jail = new Set(s.jail);
      const players = new Set(s.players);
      for (const pid of peopleRef.current.keys()) {
        if (s.type === "run") {
          const r = s.runners?.[pid];
          if (r) eng.runPos(pid, r.steps / (s.goal || 1), r.lane < 10 ? r.lane : -1);
          else eng.assign(pid, "audience", { gray: true });
          continue;
        }
        if (jail.has(pid)) { eng.assign(pid, "jail"); continue; }
        let zone: string | null = null;
        if (s.type === "quiz") {
          const rec = s.book?.[pid];
          const q = s.questions?.[s.qi ?? -1];
          if (rec && q) zone = q.kind === "short" ? (rec.correct ? "ok" : null) : String(rec.choice);
        } else if (s.type === "rps") {
          const t = s.throws?.[pid];
          if (t) zone = t.hand;
        }
        if (zone) eng.assign(pid, zone);
        else eng.assign(pid, players.has(pid) ? "wait" : "audience", { gray: !players.has(pid) });
      }
    };
    const onGame: Handler = (d) => apply(d as GameView | null);
    on("game", onGame);
    return () => off("game", onGame);
  }, [on, off, plaza]);

  // 한 번씩 일어나는 연출
  useEffect(() => {
    const onFx: Handler = (d) => {
      const e = d as GameEffect;
      const h = plaza.current;
      const snd = h?.sound;
      const eng = h?.engine;
      switch (e.t) {
        case "start":
          snd?.play("start");
          break;
        case "open":
          snd?.play("enter");
          break;
        case "answer":
          snd?.play("blip", e.zone === "0" ? "o" : e.zone === "1" ? "x" : e.zone);
          break;
        case "close":
          snd?.play("coin");
          break;
        case "reveal": {
          const v = viewRef.current;
          if (e.void) {
            showStamp("😱 전원 탈락! 이번 문제는 무효, 모두 부활", "void");
            snd?.play("out");
            break;
          }
          const isRps = v?.s.type === "rps";
          showStamp(isRps ? `${HAND_EMOJI[e.key] ?? ""} ${e.key}!` : `정답: ${e.key}`, "ok");
          snd?.play("stamp");
          if (v?.s.type === "quiz") {
            const q = v.s.questions?.[v.s.qi ?? -1];
            if (q && q.kind !== "short") eng?.flashZone(String(q.answer));
            else eng?.flashZone("ok");
          }
          later(500, () => {
            eng?.fall(e.out.length ? e.out : e.wrong);
            eng?.cheer(e.correct);
            if (e.correct.length) snd?.play("correct");
            if (e.out.length) later(250, () => snd?.play("out"));
          });
          break;
        }
        case "rps-count":
          ["가위!", "바위!", "보!"].forEach((w, i) => later(i * 380, () => { setRpsCount(w); snd?.play("blip", w.replace("!", "")); }));
          later(3 * 380, () => setRpsCount(""));
          break;
        case "go":
          showStamp("GO!", "go");
          snd?.play("start");
          break;
        case "step": {
          const t = performance.now();
          if (t - lastStepSound.current > 120) { lastStepSound.current = t; snd?.play("step"); }
          break;
        }
        case "goal":
          if (e.rank === 1) { showStamp(`🏁 1등 골인! ${name(e.pid)}`, "ok"); snd?.play("win"); h?.confetti.burst(); }
          else { setGoalNote(`${e.rank}등 골인 ${name(e.pid)}`); snd?.play("coin"); }
          eng?.cheer([e.pid]);
          break;
        case "finish": {
          const v = viewRef.current;
          later(400, () => {
            setPopup({ title: v?.s.title ?? "게임", top: e.top, rates: v?.s.type === "quiz" ? v.s.log : undefined });
            later(8000, () => setPopup(null)); // 결과 화면은 8초
            snd?.play("win");
            [0, 900, 1800].forEach((ms) => later(ms, () => h?.confetti.burst()));
            eng?.cheer(e.winners);
          });
          break;
        }
      }
    };
    on("game-effect", onFx);
    return () => off("game-effect", onFx);
    // showStamp·later·name 은 ref·setState 만 써서 매번 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, off, plaza]);

  // 남은 시간 표시용 시계(게임 중에만)
  useEffect(() => {
    if (!view || view.s.phase === "finished") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [view]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!view) return null;
  const s = view.s;
  const q = s.type === "quiz" ? s.questions?.[s.qi ?? -1] : undefined;
  const aliveCount = s.alive ? s.alive.length : null;
  const playersCount = s.players.length;
  const remain = (until?: number | null) => (until ? Math.max(0, Math.ceil((until - now) / 1000)) : null);

  // ── 위 카드 ──
  let card: React.ReactNode = null;
  if (s.type === "quiz") {
    const meta = `Q${(s.qi ?? -1) + 1}/${s.questions?.length ?? 0} · ${s.mode === "survival" ? (aliveCount !== null ? `생존 ${aliveCount}명` : "첫 문제에 답하면 참가!") : `참가 ${playersCount}명`}`;
    const t = s.phase === "open" ? remain(s.deadlineAt) : null;
    card = (
      <div className="gm-card">
        <div className="gm-meta">
          <span>{s.title} · {meta}</span>
          {q && q.kind !== "short" && s.phase !== "ready" && (
            <span className="gm-tally">지금 {q.options.map((o, i) => `${q.kind === "ox" ? o : MC_LABELS[i]} ${view.tally[i] ?? 0}`).join(" : ")}</span>
          )}
          {t !== null && <span className={`gm-timer ${t <= 3 ? "hurry" : ""}`}>⏱ {t}</span>}
          {s.phase === "closed" && <span className="gm-timer">마감</span>}
        </div>
        <div className="gm-question">{s.phase === "ready" ? "첫 문제를 공개하면 시작해요" : q?.text}</div>
        {q?.kind === "mc" && s.phase !== "ready" && (
          <div className="gm-options">
            {q.options.map((o, i) => <span key={i} style={{ background: MC_COLORS[i] }}>{MC_LABELS[i]} {o}</span>)}
          </div>
        )}
        {q?.kind === "short" && s.phase !== "ready" && (
          <div className="gm-order">
            <span className="gm-order-label">정답자 순서</span>
            {view.shortOrder.length === 0 && <span className="gm-order-empty">아직 없어요</span>}
            {view.shortOrder.slice(0, 8).map((pid, i) => (
              <span key={pid} className="gm-order-item">{MEDAL[i] ?? `${i + 1}.`} {name(pid)}</span>
            ))}
          </div>
        )}
      </div>
    );
  } else if (s.type === "rps") {
    card = (
      <div className="gm-card gm-rps">
        <img className="gm-teacher" src={TEACHER.file} alt="" />
        <div>
          <div className="gm-meta"><span>✊ 가위바위보 {s.round}판 · {aliveCount !== null ? `생존 ${aliveCount}명` : "첫 판에 내면 참가!"}</span></div>
          <div className="gm-question">
            {rpsCount || (s.hostHand && s.phase !== "open" ? `강사: ${HAND_EMOJI[s.hostHand]} ${s.hostHand}` : "폰에서 가위·바위·보 중 하나를 내세요")}
          </div>
          <div className="gm-tally">낸 사람 {Object.keys(s.throws ?? {}).length}명</div>
        </div>
      </div>
    );
  } else if (s.type === "run") {
    const toGo = s.phase === "countdown" ? remain(s.goAt) : null;
    const left = s.phase === "running" ? remain(s.endAt) : null;
    card = (
      <div className="gm-card gm-run">
        <div className="gm-meta">
          <span>🏃 달리기! 폰의 [달려!] 버튼 · 결승 {s.goal}걸음</span>
          {left !== null && <span className="gm-timer">⏱ {left}</span>}
          {goalNote && <span className="gm-tally">{goalNote}</span>}
        </div>
        <div className="gm-board">
          {view.runBoard.length === 0 && <span className="gm-order-empty">{s.phase === "ready" ? "출발 버튼을 누르면 3·2·1·GO!" : "누가 먼저 달릴까요?"}</span>}
          {view.runBoard.map((r, i) => (
            <span key={r.pid} className="gm-board-item">{MEDAL[i] ?? `${i + 1}.`} {name(r.pid)} {r.steps}/{s.goal}</span>
          ))}
        </div>
        {toGo !== null && toGo > 0 && <div className="gm-countdown">{toGo}</div>}
      </div>
    );
  }

  // ── 진행 버튼 ──
  const btn = (label: string, ev: string, data?: unknown, cls = "") => (
    <button key={label} className={`gm-btn ${cls}`} onClick={() => emit(ev, data)}>{label}</button>
  );
  const controls: React.ReactNode[] = [];
  if (s.phase === "finished") controls.push(btn("닫기", "game-dismiss", undefined, "primary"));
  else if (s.type === "quiz") {
    if (s.phase === "ready") controls.push(btn("▶ 첫 문제 공개", "game-open", undefined, "primary"));
    if (s.phase === "open") controls.push(btn("지금 마감", "game-close"));
    if (s.phase === "closed") controls.push(btn("정답 공개", "game-reveal", undefined, "primary"));
    if (s.phase === "revealed") {
      const over = (s.qi ?? 0) >= (s.questions?.length ?? 0) - 1 || (s.mode === "survival" && (aliveCount ?? 2) <= 1);
      controls.push(btn(over ? "🏆 결과 보기" : "다음 문제 ▶", "game-next", undefined, "primary"));
    }
  } else if (s.type === "rps") {
    if (s.phase === "open") {
      controls.push(<span key="l" className="gm-btn-label">강사 손 공개:</span>);
      (["가위", "바위", "보"] as const).forEach((h) => controls.push(btn(`${HAND_EMOJI[h]} ${h}`, "game-reveal", { hand: h })));
      controls.push(btn("🎲 랜덤", "game-reveal", { hand: "random" }, "primary"));
    }
    if (s.phase === "revealed") controls.push(btn("다음 판 ▶", "game-next", undefined, "primary"));
  } else if (s.type === "run") {
    if (s.phase === "ready") controls.push(btn("3·2·1 출발!", "game-go", undefined, "primary"));
  }
  if (s.phase !== "finished") controls.push(btn("게임 끝내기", "game-finish", undefined, "danger"));

  return (
    <>
      <div className="gm-top">{card}</div>
      {stamp && <div key={stamp.id} className={`gm-stamp ${stamp.tone}`}>{stamp.text}</div>}
      {rpsCount && <div className="gm-stamp count">{rpsCount}</div>}
      <div className="gm-controls">{controls}</div>
      {popup && (
        <div className="gm-popup" onClick={() => setPopup(null)}>
          <div className="gm-popup-card">
            <h2>🏆 {popup.title} 결과</h2>
            <div className="gm-podium">
              {[1, 0, 2].map((i) => {
                const t = popup.top[i];
                if (!t) return <div key={i} className="gm-pod empty" />;
                return (
                  <div key={t.pid} className={`gm-pod p${i + 1}`}>
                    <span className="gm-pod-medal">{["👑", "🥈", "🥉"][i]}</span>
                    <img src={charFile(t.pid)} alt="" />
                    <span className="gm-pod-name">{name(t.pid)}</span>
                    <span className="gm-pod-pts">+{t.points}점</span>
                    <div className="gm-pod-block">{i + 1}</div>
                  </div>
                );
              })}
            </div>
            {popup.top.length > 3 && (
              <ol className="gm-list" start={4}>
                {popup.top.slice(3, 10).map((t) => <li key={t.pid}><span>{name(t.pid)}</span><b>+{t.points}점</b></li>)}
              </ol>
            )}
            {popup.rates && popup.rates.length > 0 && (
              <div className="gm-rates">
                <h3>문제별 정답률 — 어디서 많이 틀렸나</h3>
                {popup.rates.map((l) => {
                  const pct = l.answered ? Math.round((l.correct / l.answered) * 100) : 0;
                  return (
                    <div key={l.no} className={`gm-rate ${pct < 50 ? "low" : ""}`} title={l.text}>
                      <span>Q{l.no}</span>
                      <span className="gm-rate-bar"><i style={{ width: `${pct}%` }} /></span>
                      <b>{l.void ? "무효" : `${pct}%`}</b>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="gm-popup-hint">화면을 누르면 닫혀요 · [닫기]로 게임을 마쳐요</p>
          </div>
        </div>
      )}
    </>
  );
}
