// 📊 결과 내보내기 — 참가자별.csv · 게임별.csv (설계서 §6-3). 순수 함수. 단위 시험: tests/unit/records.test.ts
// 엑셀에서 한글이 안 깨지게 BOM 은 내려받을 때 붙인다(csvBlobText).

import type { GameRecord, Standing } from "./records";

const TYPE_LABEL: Record<GameRecord["type"], string> = { quiz: "퀴즈", rps: "가위바위보", run: "달리기" };
const KIND_LABEL: Record<string, string> = { ox: "OX", mc: "객관식", short: "단답" };

/**
 * 칸 하나. 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다.
 * 닉네임은 참가자가 쓴 글자라 = + - @ 로 시작하면 엑셀이 수식으로 실행한다 → 앞에 ' 를 붙여 글자로.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: unknown[]) => cells.map(csvCell).join(",");

export const gameLabel = (g: GameRecord, i: number) =>
  `${i + 1}. ${g.type === "quiz" ? `${g.title}${g.mode === "survival" ? "(서바이벌)" : ""}` : TYPE_LABEL[g.type]}`;

export interface ActivityCounts {
  chats: number;
  reactions: number;
  questions: number;
}

/** 참가자별: 닉네임, 캐릭터, 총점, 순위, 게임별 점수…, 퀴즈 정답률, 평균 응답 시간, 채팅·반응·질문 수 */
export function participantsCsv(
  standings: Standing[],
  games: GameRecord[],
  activity: (pid: string) => ActivityCounts | undefined,
  characterName: (id: string) => string,
): string {
  const head = ["닉네임", "캐릭터", "총점", "순위", ...games.map(gameLabel), "퀴즈 정답률(%)", "평균 응답 시간(초)", "채팅 수", "반응 수", "질문 수"];
  const lines = [row(head)];
  for (const s of standings) {
    const act = activity(s.pid);
    lines.push(row([
      s.nickname,
      characterName(s.character),
      s.points,
      s.rank,
      ...games.map((g) => (s.pid in g.points || g.players.includes(s.pid) ? g.points[s.pid] ?? 0 : "")),
      s.answered ? Math.round((s.correct / s.answered) * 100) : "",
      s.answered ? (s.totalMs / s.answered / 1000).toFixed(1) : "",
      act?.chats ?? 0,
      act?.reactions ?? 0,
      act?.questions ?? 0,
    ]));
  }
  return lines.join("\r\n") + "\r\n";
}

/** 게임별: 퀴즈는 문제마다 한 줄, 가위바위보·달리기는 게임마다 한 줄 */
export function gamesCsv(games: GameRecord[], nameOf: (pid: string) => string): string {
  const head = ["게임", "종류", "문제 번호", "문제", "정답", "참가 수", "정답 수", "정답률(%)", "1등"];
  const lines = [row(head)];
  games.forEach((g, i) => {
    const label = gameLabel(g, i);
    if (g.type === "quiz" && g.log.length) {
      for (const q of g.log) {
        lines.push(row([
          label,
          `퀴즈 ${KIND_LABEL[q.kind] ?? q.kind}`,
          q.no,
          q.text,
          q.void ? `${q.answerText} (전원 탈락 — 무효)` : q.answerText,
          q.answered,
          q.correct,
          q.answered ? Math.round((q.correct / q.answered) * 100) : "",
          q.firstPid ? nameOf(q.firstPid) : "",
        ]));
      }
      return;
    }
    lines.push(row([
      label,
      TYPE_LABEL[g.type],
      "",
      "",
      "",
      g.players.length,
      "",
      "",
      g.winners.map(nameOf).join(" · "),
    ]));
  });
  return lines.join("\r\n") + "\r\n";
}

/** 엑셀이 UTF-8 로 읽게 BOM */
export const csvBlobText = (csv: string) => `﻿${csv}`;
