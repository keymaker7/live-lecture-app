import { describe, expect, it } from "vitest";
import { parseQuizSet, formatQuizSet, type QuizQuestion } from "../../lib/games/quiz-parse";
import {
  DEFAULT_RULES, LATE_GRACE_MS, MAX_STEPS_PER_SEC, acceptAnswer, acceptSteps, isLate, isShortCorrect, judgeRps,
  judgeSurvival, newStepBudget, normalizeShort, randomHand, rankStandings, rpsOutcome, scoreQuestion, scoreRun,
  speedBonus, stepBatchMs, type AnswerRec, type Hand,
} from "../../lib/games/scoring";

const R = DEFAULT_RULES;
const OX: QuizQuestion = { kind: "ox", text: "지구는 태양 주위를 돈다", options: ["O", "X"], answer: 0, answers: [], limitSec: 10 };
const MC: QuizQuestion = { kind: "mc", text: "수도는?", options: ["서울", "부산", "대구", "광주"], answer: 0, answers: [], limitSec: 15 };
const SHORT: QuizQuestion = { kind: "short", text: "세종대왕이 만든 글자는?", options: [], answer: -1, answers: ["한글", "훈민정음"], limitSec: 20 };

function book(q: QuizQuestion, rows: Array<[string, number | string, number]>, deadline = 1_000_000) {
  const b = new Map<string, AnswerRec>();
  rows.forEach(([pid, choice, ms], i) => {
    const r = acceptAnswer(b, q, { pid, choice, clientMs: ms, seq: 1 }, deadline - 5000 + i, deadline, q.limitSec * 1000);
    expect(r.ok).toBe(true);
  });
  return b;
}

describe("퀴즈 세트 한 줄 형식", () => {
  it("설계서 예시 3줄을 그대로 읽는다", () => {
    const { questions, errors } = parseQuizSet(
      "OX | 지구는 태양 주위를 돈다 | O\n객관식 | 우리나라 수도는? | 서울, 부산, 대구, 광주 | 1\n단답 | 세종대왕이 만든 글자는? | 한글, 훈민정음"
    );
    expect(errors).toEqual([]);
    expect(questions.map((q) => q.kind)).toEqual(["ox", "mc", "short"]);
    expect(questions[0]).toMatchObject({ answer: 0, limitSec: 10 });
    expect(questions[1]).toMatchObject({ options: ["서울", "부산", "대구", "광주"], answer: 0, limitSec: 15 });
    expect(questions[2]).toMatchObject({ answers: ["한글", "훈민정음"], limitSec: 20 });
  });
  it("제한 시간 바꾸기·메모 줄·빈 줄", () => {
    const { questions, errors } = parseQuizSet("# 1교시\n\nOX | 물은 100도에서 끓는다 | ㅇ | 7초\n객관식 | 1+1? | 1, 2, 3 | 2 | 30\n단답 | 영어로 사과? | apple | 25초");
    expect(errors).toEqual([]);
    expect(questions.map((q) => q.limitSec)).toEqual([7, 30, 25]);
    expect(questions[1].answer).toBe(1);
  });
  it("틀린 줄은 줄 번호와 이유를 알려 주고 나머지는 읽는다", () => {
    const { questions, errors } = parseQuizSet("퀴즈 | 뭐지 | O\nOX | 문제 | 몰라\n객관식 | 보기 하나 | 가 | 1\n객관식 | q | 가, 나 | 3\n단답 | 문제\nOX | 정상 | X | 200초");
    expect(questions).toHaveLength(0);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("다시 한 줄 형식으로 내보내면 같은 세트", () => {
    const src = "OX | A | X\n객관식 | B | 가, 나, 다 | 3 | 20초\n단답 | C | 하나, 둘";
    const once = parseQuizSet(src).questions;
    expect(parseQuizSet(formatQuizSet(once)).questions).toEqual(once);
  });
});

describe("§6-1 점수표 — OX·객관식", () => {
  it("정답 +10, 빨리 낸 순 보너스 최대 +5 (제한 시간 안에서 선형)", () => {
    expect(speedBonus(R, 0, 10000)).toBe(5);
    expect(speedBonus(R, 5000, 10000)).toBe(3); // 2.5 → 반올림 3
    expect(speedBonus(R, 8000, 10000)).toBe(1);
    expect(speedBonus(R, 10000, 10000)).toBe(0);
    expect(speedBonus(R, 99999, 10000)).toBe(0); // 제한 시간으로 자름
    expect(speedBonus(R, -50, 10000)).toBe(5);
  });
  it("OX 채점: 정답만 점수, 오답 0", () => {
    const res = scoreQuestion(OX, book(OX, [["a", 0, 0], ["b", 0, 5000], ["c", 1, 100]]), R);
    const by = Object.fromEntries(res.map((r) => [r.pid, r.points]));
    expect(by).toEqual({ a: 15, b: 13, c: 0 });
  });
  it("객관식 채점", () => {
    const res = scoreQuestion(MC, book(MC, [["a", 0, 15000], ["b", 2, 1]]), R);
    expect(res.find((r) => r.pid === "a")).toMatchObject({ correct: true, points: 10 });
    expect(res.find((r) => r.pid === "b")).toMatchObject({ correct: false, points: 0 });
  });
});

describe("§6-1 점수표 — 단답", () => {
  it("정답 +10, 1·2·3등 추가 +10/+6/+3, 4등부터는 +10 만", () => {
    const b = book(SHORT, [["d", "한글", 4000], ["a", "훈민 정음!", 1000], ["b", "Hangul", 1500], ["c", "한글", 2000], ["e", "한 글", 3000]]);
    const by = Object.fromEntries(scoreQuestion(SHORT, b, R).map((r) => [r.pid, r.points]));
    expect(by).toEqual({ a: 20, c: 16, e: 13, d: 10, b: 0 });
  });
  it("정답 비교: 공백·문장부호 제거 + 영문 소문자", () => {
    expect(normalizeShort(" Apple! ")).toBe("apple");
    expect(isShortCorrect("훈민,정음.", ["한글", "훈민정음"])).toBe(true);
    expect(isShortCorrect("APPLE", ["apple"])).toBe(true);
    expect(isShortCorrect("", ["apple"])).toBe(false);
    expect(isShortCorrect("!!!", ["apple"])).toBe(false);
  });
  it("단답은 3번까지, 맞히면 그 뒤 무시", () => {
    const b = new Map<string, AnswerRec>();
    const send = (choice: string, seq: number) => acceptAnswer(b, SHORT, { pid: "p", choice, clientMs: 100 * seq, seq }, 0, 20000, 20000);
    expect(send("세종", 1).ok).toBe(true);
    expect(send("한자", 2).ok).toBe(true);
    expect(send("한글", 3).ok).toBe(true);
    expect(b.get("p")?.correct).toBe(true);
    expect(send("한글", 4)).toEqual({ ok: false, reason: "done" });
    const b2 = new Map<string, AnswerRec>();
    [1, 2, 3].forEach((seq) => acceptAnswer(b2, SHORT, { pid: "q", choice: "틀림", clientMs: 1, seq }, 0, 20000, 20000));
    expect(acceptAnswer(b2, SHORT, { pid: "q", choice: "한글", clientMs: 1, seq: 4 }, 0, 20000, 20000)).toEqual({ ok: false, reason: "done" });
  });
});

describe("마감 + 1.5초 무효", () => {
  it("마감 + 1500ms 까지는 받고, 1501ms 부터 무효", () => {
    expect(LATE_GRACE_MS).toBe(1500);
    expect(isLate(11500, 10000)).toBe(false);
    expect(isLate(11501, 10000)).toBe(true);
    const b = new Map<string, AnswerRec>();
    expect(acceptAnswer(b, OX, { pid: "a", choice: 0, clientMs: 9000, seq: 1 }, 11500, 10000, 10000).ok).toBe(true);
    expect(acceptAnswer(b, OX, { pid: "b", choice: 0, clientMs: 9000, seq: 1 }, 11501, 10000, 10000)).toEqual({ ok: false, reason: "late" });
  });
  it("폰이 잰 시간은 0~제한 시간으로 자른다", () => {
    const b = new Map<string, AnswerRec>();
    acceptAnswer(b, OX, { pid: "a", choice: 0, clientMs: 999999, seq: 1 }, 0, 10000, 10000);
    acceptAnswer(b, OX, { pid: "b", choice: 0, clientMs: -3, seq: 1 }, 0, 10000, 10000);
    acceptAnswer(b, OX, { pid: "c", choice: 0, clientMs: "abc", seq: 1 }, 0, 10000, 10000);
    expect([b.get("a")?.clientMs, b.get("b")?.clientMs, b.get("c")?.clientMs]).toEqual([10000, 0, 10000]);
  });
});

describe("같은 pid + 문제 중복 무시", () => {
  it("같은 seq 를 다시 보낸 것(재전송)은 한 번만 인정", () => {
    const b = new Map<string, AnswerRec>();
    expect(acceptAnswer(b, OX, { pid: "a", choice: 0, clientMs: 100, seq: 1 }, 0, 10000, 10000).ok).toBe(true);
    expect(acceptAnswer(b, OX, { pid: "a", choice: 0, clientMs: 100, seq: 1 }, 50, 10000, 10000)).toEqual({ ok: false, reason: "duplicate" });
    expect(acceptAnswer(b, OX, { pid: "a", choice: 1, clientMs: 900, seq: 0 }, 60, 10000, 10000)).toEqual({ ok: false, reason: "duplicate" });
    expect(b.size).toBe(1);
    expect(b.get("a")?.attempts).toBe(1);
  });
  it("마감 전 답 바꾸기(더 새 seq)는 바뀐다", () => {
    const b = new Map<string, AnswerRec>();
    acceptAnswer(b, OX, { pid: "a", choice: 0, clientMs: 100, seq: 1 }, 0, 10000, 10000);
    expect(acceptAnswer(b, OX, { pid: "a", choice: 1, clientMs: 3000, seq: 2 }, 3000, 10000, 10000).ok).toBe(true);
    expect(b.get("a")).toMatchObject({ choice: 1, clientMs: 3000 });
  });
  it("보기 밖 번호·이상한 seq 는 무효", () => {
    const b = new Map<string, AnswerRec>();
    expect(acceptAnswer(b, MC, { pid: "a", choice: 4, clientMs: 1, seq: 1 }, 0, 10000, 15000).ok).toBe(false);
    expect(acceptAnswer(b, MC, { pid: "a", choice: 1, clientMs: 1, seq: "x" }, 0, 10000, 15000).ok).toBe(false);
  });
});

describe("§6-1 서바이벌 퀴즈 판정", () => {
  it("첫 문제에 답한 사람만 참가, 틀린 사람 탈락", () => {
    const j = judgeSurvival(OX, book(OX, [["a", 0, 1], ["b", 1, 1], ["c", 0, 1]]), null);
    expect(j).toEqual({ alive: ["a", "c"], out: ["b"], void: false });
  });
  it("살아 있던 사람이 안 내면 탈락", () => {
    const j = judgeSurvival(OX, book(OX, [["a", 0, 1]]), ["a", "c"]);
    expect(j).toEqual({ alive: ["a"], out: ["c"], void: false });
  });
  it("전원 탈락이면 무효 — 모두 부활", () => {
    const j = judgeSurvival(OX, book(OX, [["a", 1, 1], ["c", 1, 1]]), ["a", "c"]);
    expect(j).toEqual({ alive: ["a", "c"], out: [], void: true });
  });
});

describe("§6-1 가위바위보 판정", () => {
  it("이기고 지고 비기고", () => {
    expect(rpsOutcome("바위", "가위")).toBe("win");
    expect(rpsOutcome("가위", "보")).toBe("win");
    expect(rpsOutcome("보", "바위")).toBe("win");
    expect(rpsOutcome("가위", "가위")).toBe("draw");
    expect(rpsOutcome("보", "가위")).toBe("lose");
  });
  it("지거나 안 낸 사람 감옥, 비기면 생존, 첫 판은 낸 사람만", () => {
    const throws = new Map<string, Hand>([["a", "바위"], ["b", "가위"], ["c", "보"]]);
    expect(judgeRps(throws, "가위", null)).toEqual({ alive: ["a", "b"], out: ["c"], void: false });
    expect(judgeRps(new Map([["a", "바위"]]), "가위", ["a", "b"])).toEqual({ alive: ["a"], out: ["b"], void: false });
  });
  it("0명이면 그 판 무효", () => {
    expect(judgeRps(new Map([["a", "보"]]), "가위", ["a", "b"])).toEqual({ alive: ["a", "b"], out: [], void: true });
  });
  it("랜덤 손은 주입한 난수로", () => {
    expect([0, 0.34, 0.67, 0.9999].map((x) => randomHand(() => x))).toEqual(["가위", "바위", "보", "보"]);
  });
});

describe("§6-1 달리기 + 초당 8걸음 상한", () => {
  it("1·2·3등 +30/+20/+10, 완주 +5, 참가 +2, 0걸음은 0점", () => {
    const pts = scoreRun([
      { pid: "c", steps: 50, finishedAt: 3000 }, { pid: "a", steps: 50, finishedAt: 1000 },
      { pid: "b", steps: 50, finishedAt: 2000 }, { pid: "d", steps: 50, finishedAt: 4000 },
      { pid: "e", steps: 12, finishedAt: null }, { pid: "f", steps: 0, finishedAt: null },
    ], 50, R);
    expect(Object.fromEntries(pts)).toEqual({ a: 37, b: 27, c: 17, d: 7, e: 2 });
  });
  it("매크로: 1초에 100번 보내도 8걸음(+GO 때 1초어치)까지만", () => {
    expect(MAX_STEPS_PER_SEC).toBe(8);
    const b = newStepBudget(0);
    expect(acceptSteps(b, 100, 1000, 0)).toBe(16);
    expect(acceptSteps(b, 100, 2000, 0)).toBe(8);
    expect(acceptSteps(b, 100, 3000, 0)).toBe(8);
  });
  it("정직한 초당 8걸음은 묶음이 늦게·몰려 와도 전부 인정", () => {
    const b = newStepBudget(0);
    // 1초마다 8걸음씩 보냈지만 2·3번째 묶음이 지연돼 한꺼번에 도착
    expect(acceptSteps(b, 8, 1000, 0)).toBe(8);
    expect(acceptSteps(b, 8, 2900, 0)).toBe(8);
    expect(acceptSteps(b, 8, 2950, 0)).toBe(8);
    expect(acceptSteps(b, 8, 4000, 0)).toBe(8);
  });
  it("GO 전에 받은 걸음은 0", () => {
    const b = newStepBudget(5000);
    expect(acceptSteps(b, 10, 4999, 5000)).toBe(0);
  });
  it("묶음 간격 = max(1, ceil(인원/25))초", () => {
    expect([1, 25, 26, 50, 51, 80].map(stepBatchMs)).toEqual([1000, 1000, 2000, 2000, 3000, 4000]);
  });
});

describe("동점 처리", () => {
  it("점수 → 정답 수 → 평균 응답 시간 → 먼저 참가", () => {
    const r = rankStandings([
      { pid: "late", points: 30, correct: 3, answered: 3, totalMs: 3000, joinedAt: 50 },
      { pid: "fewer", points: 30, correct: 2, answered: 3, totalMs: 300, joinedAt: 1 },
      { pid: "slow", points: 30, correct: 3, answered: 3, totalMs: 9000, joinedAt: 1 },
      { pid: "early", points: 30, correct: 3, answered: 3, totalMs: 3000, joinedAt: 10 },
      { pid: "top", points: 40, correct: 0, answered: 0, totalMs: 0, joinedAt: 99 },
      { pid: "none", points: 0, correct: 0, answered: 0, totalMs: 0, joinedAt: 0 },
    ]);
    expect(r.map((x) => x.pid)).toEqual(["top", "early", "late", "slow", "fewer", "none"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("답한 적 없는 사람의 평균 시간은 맨 뒤", () => {
    const r = rankStandings([
      { pid: "x", points: 2, correct: 0, answered: 0, totalMs: 0, joinedAt: 1 },
      { pid: "y", points: 2, correct: 0, answered: 2, totalMs: 20000, joinedAt: 2 },
    ]);
    expect(r[0].pid).toBe("y");
  });
});
