"use client";

import { useMemo, useRef, useState } from "react";
import { parseQuizSet } from "@/lib/games/quiz-parse";
import { DEFAULT_RULES, sanitizeRules, type ScoreRules } from "@/lib/games/scoring";
import { csvBlobText, gamesCsv, participantsCsv } from "@/lib/games/export-csv";
import { characterById } from "@/lib/plaza/characters";
import { presenterLink } from "@/lib/realtime/host-key";
import { readJSON, writeJSON } from "@/lib/realtime/storage";
import type { GameRecord, Participant, ResultsDbStatus, Standing } from "@/hooks/useSlidesRealtime";

// 발표자 도구 "🎮 게임" 탭 — 퀴즈 세트 편집(한 줄 형식)·저장·내보내기/불러오기, 게임 시작 (설계서 §4-2)
// + 점수 규칙 숫자 바꾸기(§6-1), 📊 결과 내보내기 CSV 2종(§6-3), 🔑 발표자 링크(§6-4)

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
  roomId: string;
  hostSecret: string;
  getResults: () => { standings: Standing[]; games: GameRecord[]; participants: Participant[] };
  dbStatus: ResultsDbStatus;
}

const RULES_KEY = "ll:rules";

/** 한 칸짜리 숫자 / 1·2·3등 세 칸 — 규칙 표의 이름 그대로 */
const RULE_FIELDS: Array<{ label: string; keys: Array<keyof ScoreRules | [keyof ScoreRules, number]> }> = [
  { label: "모든 게임 참가", keys: ["join"] },
  { label: "OX·객관식 정답 / 빠르기 최대", keys: ["correct", "speedMax"] },
  { label: "단답 1·2·3등 추가", keys: [["shortRank", 0], ["shortRank", 1], ["shortRank", 2]] },
  { label: "서바이벌 생존 / 우승", keys: ["surviveQuestion", "surviveWin"] },
  { label: "가위바위보 생존 / 우승", keys: ["rpsRound", "rpsWin"] },
  { label: "달리기 1·2·3등 / 완주", keys: [["runRank", 0], ["runRank", 1], ["runRank", 2], "runFinish"] },
];

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http(사내망 주소)에선 clipboard 가 막혀 있다 — 옛 방식으로
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

const DB_TEXT: Record<ResultsDbStatus["state"], string> = {
  idle: "결과는 이 PC 에 저장 중",
  off: "결과는 이 PC 에 저장 중(DB 저장 꺼짐)",
  saved: "✓ 게임 결과 DB 저장됨",
  denied: "⚠ DB 저장 안 됨 — 이 연수를 만든 PC 의 🔑 발표자 링크로 열어 주세요",
  error: "DB 저장 실패 — 다음 게임이 끝날 때 다시 시도해요",
};

export function GameDock({ emit, gameActive, roomId, hostSecret, getResults, dbStatus }: GameDockProps) {
  const [rules, setRules] = useState<ScoreRules>(() => sanitizeRules(readJSON(RULES_KEY)));
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

  const flash = (m: string, ms = 2500) => { setMsg(m); setTimeout(() => setMsg(""), ms); };

  const ruleValue = (k: keyof ScoreRules | [keyof ScoreRules, number]) =>
    Array.isArray(k) ? (rules[k[0]] as number[])[k[1]] : (rules[k] as number);
  const setRule = (k: keyof ScoreRules | [keyof ScoreRules, number], v: string) => {
    const next = JSON.parse(JSON.stringify(rules)) as Record<string, unknown>;
    if (Array.isArray(k)) (next[k[0]] as number[])[k[1]] = Number(v);
    else next[k] = Number(v);
    const clean = sanitizeRules(next);
    setRules(clean);
    writeJSON(RULES_KEY, clean);
  };
  const resetRules = () => { setRules(DEFAULT_RULES); writeJSON(RULES_KEY, DEFAULT_RULES); flash("기본 점수 규칙으로 돌렸어요"); };
  const changedRules = JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES);

  const exportResults = (which: "people" | "games") => {
    const { standings, games, participants } = getResults();
    if (!games.length) { flash("아직 끝난 게임이 없어요"); return; }
    const byPid = new Map(participants.map((p) => [p.pid, p]));
    if (which === "people") {
      const csv = participantsCsv(standings, games, (pid) => byPid.get(pid), (id) => characterById(id)?.name ?? "");
      download("참가자별.csv", csvBlobText(csv));
    } else {
      const csv = gamesCsv(games, (pid) => byPid.get(pid)?.nickname ?? "?");
      download("게임별.csv", csvBlobText(csv));
    }
  };

  const copyPresenterLink = async () => {
    if (!hostSecret) return;
    const ok = await copyText(presenterLink(roomId, hostSecret));
    flash(ok ? "🔑 발표자 링크 복사됨 — 다른 PC 에서 열면 이어서 진행·순위 복원. 참가자에게 보내지 마세요" : "복사하지 못했어요", 5000);
  };

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
          onClick={() => emit("game-start-quiz", { questions: parsed.questions, mode, title: name.trim() || "퀴즈", rules })}
        >▶ 퀴즈 시작</button>
        <span className="gd-sep" />
        <button className="btn-primary btn-sm" disabled={gameActive} onClick={() => emit("game-start-rps", { rules })}>✊ 가위바위보</button>
        <span className="gd-sep" />
        <label>목표 <input type="number" min={10} max={300} value={goal} onChange={(e) => setGoal(Number(e.target.value))} /> 걸음</label>
        <label>제한 <input type="number" min={10} max={300} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /> 초</label>
        <button className="btn-primary btn-sm" disabled={gameActive} onClick={() => emit("game-start-run", { goal, limitSec: limit, rules })}>🏃 달리기</button>
      </div>
      {gameActive && <p className="gd-msg">게임 진행 중 — 화면 아래 버튼으로 진행하고, 끝나면 [닫기]</p>}
      <details className="gd-rules">
        <summary>⚙️ 점수 규칙{changedRules ? " (바꿈)" : ""} — 다음에 시작하는 게임부터</summary>
        <div className="gd-rules-grid">
          {RULE_FIELDS.map((f) => (
            <label key={f.label}>
              <span>{f.label}</span>
              {f.keys.map((k) => (
                <input key={String(k)} type="number" min={0} max={100} value={ruleValue(k)} onChange={(e) => setRule(k, e.target.value)} aria-label={`${f.label} ${String(k)}`} />
              ))}
            </label>
          ))}
        </div>
        <button className="btn-sm" onClick={resetRules} disabled={!changedRules}>기본값으로</button>
      </details>
      <div className="gd-row gd-results">
        <span>📊 결과 내보내기</span>
        <button className="btn-sm" onClick={() => exportResults("people")}>참가자별.csv</button>
        <button className="btn-sm" onClick={() => exportResults("games")}>게임별.csv</button>
        <span className="gd-sep" />
        <button className="btn-sm" onClick={copyPresenterLink} disabled={!hostSecret}>🔑 발표자 링크 복사</button>
        <span className={`gd-db ${dbStatus.state}`}>
          {DB_TEXT[dbStatus.state]}
          {dbStatus.unsaved > 0 && dbStatus.state !== "off" && dbStatus.state !== "idle" ? ` · 못 보낸 결과 ${dbStatus.unsaved}판` : ""}
          {dbStatus.restored ? ` · DB 에서 ${dbStatus.restored}판 복원` : ""}
        </span>
      </div>
    </div>
  );
}
