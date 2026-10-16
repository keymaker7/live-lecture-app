import { describe, expect, it } from "vitest";
import { HostGame, type GameEffect } from "../../lib/games/host-game";
import { parseQuizSet } from "../../lib/games/quiz-parse";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; }, add: (ms: number) => { t += ms; return t; } };
}

const SET = parseQuizSet("OX | 하늘은 파랗다 | O\n객관식 | 2+2? | 3, 4, 5 | 2\n단답 | 사과 영어로? | apple").questions;

function quiz(mode: "score" | "survival", c = clock()) {
  const fx: GameEffect[] = [];
  const g = HostGame.quiz({ now: c.now, rng: () => 0, onEffect: (e) => fx.push(e) }, "g1", "퀴즈", SET, mode);
  return { g, c, fx };
}

/** 문제 공개 → 방송 → 답들 → 마감 → 공개 */
function play(g: HostGame, c: ReturnType<typeof clock>, answers: Array<[string, number | string, number]>) {
  g.openQuestion();
  g.markBroadcast(c.now());
  const no = (g.s.qi ?? 0) + 1;
  answers.forEach(([pid, choice, ms]) => g.answer(pid, { gid: "g1", qno: no, choice, clientMs: ms, seq: no }, c.now() + ms));
  c.add((g.question!.limitSec * 1000) + 1501);
  expect(g.tick(c.now())).toBe(true); // 마감 + 1.5초 → 닫힘
  expect(g.s.phase).toBe("closed");
  g.reveal();
}

describe("퀴즈 점수전 — 틀려도 계속", () => {
  it("문제마다 정답 +10 + 빠르기, 단답 1·2·3등, 끝에 참가 +2", () => {
    const { g, c } = quiz("score");
    play(g, c, [["a", 0, 0], ["b", 1, 0], ["c", 0, 5000]]); // OX 10초: a 15, c 13, b 0
    expect(g.s.points).toEqual({ a: 15, c: 13 });
    g.next();
    play(g, c, [["a", 1, 15000], ["b", 1, 0]]); // 객관식 15초 정답 2번(index 1): a 10, b 15
    g.next();
    play(g, c, [["c", "Apple", 1000], ["a", "apple", 2000], ["b", "banana", 10]]); // 단답: c 20, a 16
    expect(g.next()).toBe(true); // 마지막 문제 → 끝
    expect(g.s.phase).toBe("finished");
    expect(g.s.points).toEqual({ a: 15 + 10 + 16 + 2, b: 15 + 2, c: 13 + 20 + 2 });
    expect(g.s.winners).toEqual(["a"]);
    expect(g.s.stats.a).toEqual({ correct: 3, answered: 3, totalMs: 17000 });
    expect(g.s.log?.map((l) => [l.no, l.answered, l.correct, l.firstPid])).toEqual([[1, 3, 2, "a"], [2, 2, 2, "b"], [3, 3, 2, "c"]]);
  });

  it("방송 전엔 시계가 안 간다 — 마감은 방송된 순간 + 제한 시간", () => {
    const { g, c } = quiz("score");
    g.openQuestion();
    c.add(5000);
    expect(g.tick(c.now())).toBe(false);
    g.markBroadcast(c.now());
    expect(g.s.deadlineAt).toBe(c.now() + 10000);
    g.markBroadcast(c.now() + 999); // 두 번째 방송은 시계를 다시 안 맞춘다
    expect(g.s.deadlineAt).toBe(c.now() + 10000);
  });

  it("마감 + 1.5초 넘어 온 답, 다른 문제·게임 번호의 답은 무효", () => {
    const { g, c } = quiz("score");
    g.openQuestion();
    g.markBroadcast(c.now());
    const dl = g.s.deadlineAt!;
    expect(g.answer("late", { gid: "g1", qno: 1, choice: 0, clientMs: 9999, seq: 1 }, dl + 1501)).toBe(false);
    expect(g.answer("ok", { gid: "g1", qno: 1, choice: 0, clientMs: 9999, seq: 1 }, dl + 1500)).toBe(true);
    expect(g.answer("x", { gid: "old", qno: 1, choice: 0, clientMs: 1, seq: 1 }, dl)).toBe(false);
    expect(g.answer("y", { gid: "g1", qno: 2, choice: 0, clientMs: 1, seq: 1 }, dl)).toBe(false);
  });

  it("같은 답 재전송은 한 번만 — 점수 두 번 안 줌", () => {
    const { g, c } = quiz("score");
    g.openQuestion();
    g.markBroadcast(c.now());
    const p = { gid: "g1", qno: 1, choice: 0, clientMs: 0, seq: 7 };
    expect(g.answer("a", p, c.now())).toBe(true);
    expect(g.answer("a", p, c.now() + 10)).toBe(false);
    g.closeQuestion();
    g.reveal();
    expect(g.s.points.a).toBe(15);
    expect(g.s.stats.a.answered).toBe(1);
  });

  it("지금 O : X 집계, 단답 정답자 순서", () => {
    const { g, c } = quiz("score");
    g.openQuestion(); g.markBroadcast(c.now());
    g.answer("a", { gid: "g1", qno: 1, choice: 0, clientMs: 1, seq: 1 }, c.now());
    g.answer("b", { gid: "g1", qno: 1, choice: 1, clientMs: 1, seq: 1 }, c.now());
    g.answer("c", { gid: "g1", qno: 1, choice: 0, clientMs: 1, seq: 1 }, c.now());
    expect(g.tally()).toEqual([2, 1]);
  });
});

describe("퀴즈 서바이벌", () => {
  it("살아남을 때마다 +5, 마지막 생존자 우승 +30, 참가 +2, 감옥", () => {
    const { g, c } = quiz("survival");
    play(g, c, [["a", 0, 1], ["b", 0, 1], ["c", 1, 1]]); // c 탈락
    expect(g.s.alive).toEqual(["a", "b"]);
    expect(g.s.jail).toEqual(["c"]);
    g.next();
    // 감옥에 간 c 는 답을 못 낸다
    play(g, c, [["a", 1, 1], ["b", 0, 1], ["c", 1, 1]]); // 객관식 정답 index1: a 생존, b 탈락
    expect(g.s.alive).toEqual(["a"]);
    expect(g.next()).toBe(true); // 1명 남음 → 끝
    expect(g.s.phase).toBe("finished");
    expect(g.s.winners).toEqual(["a"]);
    expect(g.s.points).toEqual({ a: 5 + 5 + 30 + 2, b: 5 + 2, c: 2 });
  });

  it("첫 문제에 안 낸 사람은 못 들어온다, 전원 탈락이면 무효·모두 부활", () => {
    const { g, c } = quiz("survival");
    play(g, c, [["a", 0, 1], ["b", 0, 1]]);
    g.next();
    g.openQuestion();
    play(g, c, [["a", 0, 1], ["b", 2, 1], ["new", 1, 1]]); // 둘 다 오답, new 는 참가 불가
    expect(g.s.book?.new).toBeUndefined();
    expect(g.s.reveal?.void).toBe(true);
    expect(g.s.alive).toEqual(["a", "b"]);
    expect(g.s.jail).toEqual([]);
  });
});

describe("가위바위보 — 강사와 대결", () => {
  it("판마다 +5, 1명 남으면 자동 종료 + 우승 +30 + 참가 +2", () => {
    const c = clock();
    const g = HostGame.rps({ now: c.now, rng: () => 0 }, "g1");
    g.rpsOpen();
    ["a", "b", "c"].forEach((p, i) => g.answer(p, { gid: "g1", round: 1, choice: ["바위", "가위", "보"][i], seq: 1 }, c.now()));
    g.rpsReveal("가위"); // a 이김, b 비김, c 짐
    c.add(3 * 380 + 1501);
    g.tick(c.now());
    expect(g.s.alive).toEqual(["a", "b"]);
    expect(g.s.jail).toEqual(["c"]);
    g.next();
    g.answer("a", { gid: "g1", round: 2, choice: "보", seq: 2 }, c.now());
    g.answer("b", { gid: "g1", round: 2, choice: "가위", seq: 2 }, c.now());
    g.answer("c", { gid: "g1", round: 2, choice: "바위", seq: 2 }, c.now()); // 감옥 — 무시
    g.rpsReveal("random"); // rng 0 → 가위: a(보) 짐, b(가위) 비김
    expect(g.s.hostHand).toBe("가위");
    c.add(3 * 380 + 1501);
    g.tick(c.now());
    expect(g.s.phase).toBe("finished");
    expect(g.s.winners).toEqual(["b"]);
    expect(g.s.points).toEqual({ a: 5 + 2, b: 5 + 5 + 30 + 2, c: 2 });
  });

  it("0명 남으면 그 판 무효", () => {
    const c = clock();
    const g = HostGame.rps({ now: c.now, rng: () => 0 }, "g1");
    g.rpsOpen();
    g.answer("a", { gid: "g1", round: 1, choice: "보", seq: 1 }, c.now());
    g.answer("b", { gid: "g1", round: 1, choice: "보", seq: 1 }, c.now());
    g.rpsReveal("가위");
    c.add(3000);
    g.tick(c.now());
    expect(g.s.reveal?.void).toBe(true);
    expect(g.s.alive).toEqual(["a", "b"]);
    expect(g.s.points).toEqual({});
  });

  it("공개 카운트가 끝나고 1.5초 넘어 낸 손은 무효", () => {
    const c = clock();
    const g = HostGame.rps({ now: c.now, rng: () => 0 }, "g1");
    g.rpsOpen();
    g.rpsReveal("바위");
    const at = g.s.revealAt!;
    expect(g.answer("late", { gid: "g1", round: 1, choice: "보", seq: 1 }, at + 1501)).toBe(false);
    expect(g.answer("ok", { gid: "g1", round: 1, choice: "보", seq: 1 }, at + 1500)).toBe(true);
  });
});

describe("달리기", () => {
  it("3·2·1 중 탭 무효, 초당 8걸음 상한, 3명 골인 2.5초 뒤 결과, 점수", () => {
    const c = clock();
    const g = HostGame.run({ now: c.now, rng: () => 0 }, "g1", 20, 60, 10);
    expect(g.s.batchMs).toBe(1000);
    g.runStart();
    g.markBroadcast(c.now());
    const go = g.s.goAt!;
    expect(go).toBe(c.now() + 3000);
    expect(g.steps("a", { gid: "g1", count: 5, seq: 1 }, go - 1)).toBe(0); // 카운트다운 중
    c.set(go);
    g.tick(c.now());
    expect(g.s.phase).toBe("running");
    let seq = 2;
    for (let s = 1; s <= 3; s++) {
      c.set(go + s * 1000);
      for (const p of ["a", "b", "c", "d"]) g.steps(p, { gid: "g1", count: p === "d" ? 2 : 8, seq: seq }, c.now() + (p.charCodeAt(0) - 97));
      seq++;
    }
    // a·b·c 는 1초 16(첫 묶음) + 8 → 20 골인(2초째), d 는 6걸음
    expect(g.s.finishOrder).toEqual(["a", "b", "c"]);
    expect(g.steps("cheat", { gid: "g1", count: 999, seq: 99 }, go + 1000)).toBe(16);
    g.tick(c.now());
    expect(g.s.phase).toBe("running");
    c.add(2500);
    expect(g.tick(c.now())).toBe(true);
    expect(g.s.phase).toBe("finished");
    expect(g.s.points).toEqual({ a: 2 + 5 + 30, b: 2 + 5 + 20, c: 2 + 5 + 10, d: 2, cheat: 2 });
    expect(g.s.winners).toEqual(["a"]);
  });

  it("제한 시간이 끝나면 골인 못 해도 결과", () => {
    const c = clock();
    const g = HostGame.run({ now: c.now, rng: () => 0 }, "g1", 300, 10, 3);
    g.runStart();
    g.markBroadcast(c.now());
    c.set(g.s.goAt!);
    g.tick(c.now());
    g.steps("a", { gid: "g1", count: 8, seq: 1 }, c.add(1000));
    c.set(g.s.endAt!);
    g.tick(c.now());
    c.add(2500);
    g.tick(c.now());
    expect(g.s.phase).toBe("finished");
    expect(g.s.points).toEqual({ a: 2 });
  });
});

describe("폰에 보내는 화면", () => {
  it("문제 공개 중엔 정답을 싣지 않는다", () => {
    const { g, c } = quiz("score");
    g.openQuestion();
    g.markBroadcast(c.now());
    const v = g.audience();
    expect(v.q).toMatchObject({ no: 1, total: 3, kind: "ox", options: ["O", "X"], limitMs: 10000 });
    expect(JSON.stringify(v)).not.toContain("answer");
    expect(v.reveal).toBeUndefined();
    g.closeQuestion();
    g.reveal();
    expect(g.audience().reveal?.key).toBe("O");
  });
  it("저장했다 되살려도 이어서 진행(JSON 왕복)", () => {
    const { g, c } = quiz("score");
    play(g, c, [["a", 0, 0]]);
    const back = new HostGame(JSON.parse(JSON.stringify(g.s)), { now: c.now, rng: () => 0 });
    expect(back.next()).toBe(true);
    back.markBroadcast(c.now());
    expect(back.answer("a", { gid: "g1", qno: 2, choice: 1, clientMs: 0, seq: 2 }, c.now())).toBe(true);
  });
});
