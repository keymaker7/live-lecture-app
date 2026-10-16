import { describe, expect, it } from "vitest";
import { audienceRanks, computeStandings, fromResultPayloads, toResultPayload, type GameRecord, type Person } from "../../lib/games/records";
import { csvBlobText, csvCell, gamesCsv, participantsCsv } from "../../lib/games/export-csv";
import { DEFAULT_RULES, sanitizeRules } from "../../lib/games/scoring";

const people: Person[] = [
  { pid: "a", nickname: "하나", character: "a01", joinedAt: 1 },
  { pid: "b", nickname: "두리", character: "a02", joinedAt: 2 },
  { pid: "c", nickname: "세찌", character: "a03", joinedAt: 3 },
  { pid: "d", nickname: "=HYPERLINK(\"x\")", character: "a04", joinedAt: 4 },
];

const quiz: GameRecord = {
  id: "g1", type: "quiz", title: "예시 세트", mode: "score", startedAt: 100, endedAt: 200,
  points: { a: 30, b: 20, c: 2 }, winners: ["a"], players: ["a", "b", "c"],
  stats: { a: { correct: 2, answered: 2, totalMs: 3000 }, b: { correct: 1, answered: 2, totalMs: 5000 }, c: { correct: 0, answered: 2, totalMs: 8000 } },
  log: [
    { no: 1, kind: "ox", text: "물은 100도에서 끓는다", answerText: "O", answered: 3, correct: 2, firstPid: "a" },
    { no: 2, kind: "short", text: "세종대왕이, 만든 \"글자\"는?", answerText: "한글, 훈민정음", answered: 3, correct: 1, firstPid: "a" },
  ],
};
const run: GameRecord = {
  id: "g2", type: "run", title: "달리기", startedAt: 300, endedAt: 400,
  points: { c: 37, b: 27, a: 2 }, winners: ["c"], players: ["c", "b", "a"], log: [],
};

describe("종합 순위", () => {
  it("누적 점수 순, 게임 1판일 땐 변화 없음", () => {
    const s = computeStandings(people, [quiz]);
    expect(s.map((x) => [x.pid, x.points, x.rank, x.delta, x.prevRank])).toEqual([
      ["a", 30, 1, 0, null], ["b", 20, 2, 0, null], ["c", 2, 3, 0, null], ["d", 0, 4, 0, null],
    ]);
  });
  it("두 번째 게임 뒤 ▲▼ — 마지막 게임 직전 순위와 비교", () => {
    const s = computeStandings(people, [quiz, run]);
    // a 32, b 47, c 39 → b 1위(▲1), c 2위(▲1), a 3위(▼2)
    expect(s.map((x) => [x.pid, x.points, x.rank, x.delta])).toEqual([
      ["b", 47, 1, 1], ["c", 39, 2, 1], ["a", 32, 3, -2], ["d", 0, 4, 0],
    ]);
    expect(audienceRanks(s)).toEqual({ b: [47, 1, 1], c: [39, 2, 1], a: [32, 3, -2], d: [0, 4, 0] });
  });
  it("동점: 정답 수 → 평균 응답 시간 → 먼저 참가", () => {
    const tie: GameRecord = { ...quiz, points: { a: 10, b: 10, c: 10 }, stats: {
      a: { correct: 1, answered: 1, totalMs: 4000 }, b: { correct: 1, answered: 1, totalMs: 2000 }, c: { correct: 2, answered: 2, totalMs: 9000 },
    } };
    expect(computeStandings(people.slice(0, 3), [tie]).map((x) => x.pid)).toEqual(["c", "b", "a"]);
    const same: GameRecord = { ...run, points: { a: 5, b: 5 }, players: ["b", "a"] };
    expect(computeStandings(people.slice(0, 2), [same]).map((x) => x.pid)).toEqual(["a", "b"]); // 먼저 참가(joinedAt)
  });
});

describe("규칙 숫자 바꾸기", () => {
  it("0~100 정수만, 빠지거나 이상한 칸은 기본값", () => {
    expect(sanitizeRules(undefined)).toEqual(DEFAULT_RULES);
    const r = sanitizeRules({ correct: "20", speedMax: -3, join: 1000, shortRank: [5, "x"], runRank: "nope", rpsWin: 12.6 });
    expect(r.correct).toBe(20);
    expect(r.speedMax).toBe(0);
    expect(r.join).toBe(100);
    expect(r.shortRank).toEqual([5, DEFAULT_RULES.shortRank[1], DEFAULT_RULES.shortRank[2]]);
    expect(r.runRank).toEqual(DEFAULT_RULES.runRank);
    expect(r.rpsWin).toBe(13);
  });
});

describe("CSV 2종", () => {
  it("칸: 쉼표·따옴표·줄바꿈 감싸기, 수식 시작 글자는 ' 붙여 글자로", () => {
    expect(csvCell("민수")).toBe("민수");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('그 "말"')).toBe('"그 ""말"""');
    expect(csvCell("줄\n바꿈")).toBe('"줄\n바꿈"');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+82")).toBe("'+82");
    expect(csvCell("-3")).toBe("'-3");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
  });
  it("참가자별.csv", () => {
    const st = computeStandings(people, [quiz, run]);
    const csv = participantsCsv(st, [quiz, run], (pid) => (pid === "a" ? { chats: 3, reactions: 5, questions: 1 } : undefined), (id) => `동물${id}`);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("닉네임,캐릭터,총점,순위,1. 예시 세트,2. 달리기,퀴즈 정답률(%),평균 응답 시간(초),채팅 수,반응 수,질문 수");
    expect(lines[1]).toBe("두리,동물a02,47,1,20,27,50,2.5,0,0,0");
    expect(lines[3]).toBe("하나,동물a01,32,3,30,2,100,1.5,3,5,1");
    expect(lines[4]).toBe(`"'=HYPERLINK(""x"")",동물a04,0,4,,,,,0,0,0`); // 참가 안 한 게임은 빈칸
  });
  it("게임별.csv — 퀴즈는 문제마다, 나머지는 게임마다", () => {
    const names: Record<string, string> = { a: "하나", b: "두리", c: "세찌" };
    const csv = gamesCsv([quiz, run], (pid) => names[pid] ?? "?");
    const lines = csv.trim().split("\r\n");
    expect(lines).toEqual([
      "게임,종류,문제 번호,문제,정답,참가 수,정답 수,정답률(%),1등",
      "1. 예시 세트,퀴즈 OX,1,물은 100도에서 끓는다,O,3,2,67,하나",
      `1. 예시 세트,퀴즈 단답,2,"세종대왕이, 만든 ""글자""는?","한글, 훈민정음",3,1,33,하나`,
      "2. 달리기,달리기,,,,3,,,세찌",
    ]);
    expect(csvBlobText("x").charCodeAt(0)).toBe(0xfeff);
  });
});

describe("DB 저장 묶음", () => {
  it("저장 → 읽기 왕복하면 같은 순위(다른 PC 복원)", () => {
    const map = new Map(people.map((p) => [p.pid, p]));
    const rows = [toResultPayload(run, map), toResultPayload(quiz, map)].map((x) => JSON.parse(JSON.stringify(x)));
    const back = fromResultPayloads(rows);
    expect(back.games.map((g) => g.id)).toEqual(["g1", "g2"]); // 끝난 순
    expect(computeStandings(back.people, back.games).map((x) => [x.pid, x.points, x.rank, x.nickname]))
      .toEqual(computeStandings(people.slice(0, 3), [quiz, run]).map((x) => [x.pid, x.points, x.rank, x.nickname]));
  });
  it("비밀값(참가 토큰 해시)은 묶음에 없다", () => {
    const map = new Map(people.map((p) => [p.pid, { ...p, th: "f".repeat(64) }]));
    expect(JSON.stringify(toResultPayload(quiz, map))).not.toContain("fff");
  });
  it("모양이 이상한 줄은 버린다", () => {
    const back = fromResultPayloads([null, { v: 2 }, { v: 1, id: "x", title: "t", type: "hack", players: [] }, { v: 1, id: "y", title: "t", type: "rps", players: [{ pid: 5 }, { pid: "p", pts: "9" }] }]);
    expect(back.games).toHaveLength(1);
    expect(back.games[0].points).toEqual({ p: 0 });
  });
});
