"use client";

import { useMemo, useRef, useState } from "react";
import { parseQuizSet } from "@/lib/games/quiz-parse";
import { readJSON, writeJSON } from "@/lib/realtime/storage";

// 발표자 도구 "🎮 게임" 탭 — 퀴즈 세트 편집(한 줄 형식)·저장·내보내기/불러오기, 게임 시작 (설계서 §4-2)

interface QuizSet { name: string; text: string }

const SETS_KEY = "ll:quizsets";
const SAMPLE: QuizSet = {
  name: "예시 세트",
  text: [
    "OX | 지구는 태양 주위를 돈다 | O",
    "객관식 | 우리나라 수도는? | 서울, 부산, 대구, 광주 | 1",
    "단답 | 세종대왕이 만든 글자는? | 한글, 훈민정음",
  ].join("\n"),
};

interface GameDockProps {
  emit: (event: string, data?: unknown) => void;
  gameActive: boolean;
}

export function GameDock({ emit, gameActive }: GameDockProps) {
  const [sets, setSets] = useState<QuizSet[]>(() => {
    const saved = readJSON<QuizSet[]>(SETS_KEY);
    return saved && saved.length ? saved : [SAMPLE];
  });
  const [name, setName] = useState(() => sets[0]?.name ?? "새 세트");
  const [text, setText] = useState(() => sets[0]?.text ?? "");
  const [mode, setMode] = useState<"score" | "survival">("score");
  const [goal, setGoal] = useState(50);
  const [limit, setLimit] = useState(60);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseQuizSet(text), [text]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const save = () => {
    const n = name.trim() || "이름 없는 세트";
    const next = [{ name: n, text }, ...sets.filter((s) => s.name !== n)].slice(0, 30);
    setSets(next);
    setName(n);
    flash(writeJSON(SETS_KEY, next) ? "이 PC 에 저장했어요" : "저장하지 못했어요(저장 공간)");
  };

  const remove = () => {
    const next = sets.filter((s) => s.name !== name);
    setSets(next);
    writeJSON(SETS_KEY, next);
    flash("지웠어요");
  };

  const load = (n: string) => {
    const s = sets.find((x) => x.name === n);
    if (!s) return;
    setName(s.name);
    setText(s.text);
  };

  const exportTxt = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(name.trim() || "퀴즈").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importTxt = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) { flash("파일이 너무 커요"); return; }
    setText(await f.text());
    setName(f.name.replace(/\.txt$/i, ""));
    flash("불러왔어요 — [저장]을 누르면 이 PC 에 남아요");
  };

  return (
    <div className="dock-panel active gd">
      <div className="gd-row">
        <select value={sets.some((s) => s.name === name) ? name : ""} onChange={(e) => load(e.target.value)} aria-label="저장한 퀴즈 세트">
          <option value="" disabled>저장한 세트</option>
          {sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <input className="gd-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="세트 이름" />
        <button className="btn-sm" onClick={save}>저장</button>
        <button className="btn-sm" onClick={remove}>삭제</button>
        <button className="btn-sm" onClick={exportTxt}>내보내기</button>
        <button className="btn-sm" onClick={() => fileRef.current?.click()}>불러오기</button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => { void importTxt(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <textarea
        className="gd-text"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder={"한 줄에 한 문제\nOX | 문제 | O\n객관식 | 문제 | 보기1, 보기2, 보기3, 보기4 | 정답번호\n단답 | 문제 | 정답1, 정답2\n(끝에 | 20초 를 붙이면 제한 시간 변경)"}
      />
      <div className="gd-status">
        <span>문제 {parsed.questions.length}개</span>
        {parsed.errors.length > 0 && (
          <span className="gd-err">
            확인할 줄: {parsed.errors.slice(0, 3).map((e) => `${e.line}줄 ${e.message}`).join(" · ")}
            {parsed.errors.length > 3 ? ` 외 ${parsed.errors.length - 3}` : ""}
          </span>
        )}
        {msg && <span className="gd-msg">{msg}</span>}
      </div>
      <div className="gd-row gd-start">
        <label><input type="radio" checked={mode === "score"} onChange={() => setMode("score")} /> 점수전(틀려도 계속)</label>
        <label><input type="radio" checked={mode === "survival"} onChange={() => setMode("survival")} /> 서바이벌</label>
        <button
          className="btn-primary btn-sm"
          disabled={gameActive || parsed.questions.length === 0}
          onClick={() => emit("game-start-quiz", { questions: parsed.questions, mode, title: name.trim() || "퀴즈" })}
        >▶ 퀴즈 시작</button>
        <span className="gd-sep" />
        <button className="btn-primary btn-sm" disabled={gameActive} onClick={() => emit("game-start-rps")}>✊ 가위바위보</button>
        <span className="gd-sep" />
        <label>목표 <input type="number" min={10} max={300} value={goal} onChange={(e) => setGoal(Number(e.target.value))} /> 걸음</label>
        <label>제한 <input type="number" min={10} max={300} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /> 초</label>
        <button className="btn-primary btn-sm" disabled={gameActive} onClick={() => emit("game-start-run", { goal, limitSec: limit })}>🏃 달리기</button>
      </div>
      {gameActive && <p className="gd-msg">게임 진행 중 — 화면 아래 버튼으로 진행하고, 끝나면 [닫기]</p>}
    </div>
  );
}
