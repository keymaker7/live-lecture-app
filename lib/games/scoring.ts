// 채점·판정 — 순수 함수만(시간·난수는 밖에서 넣는다). 단위 시험: tests/unit/scoring.test.ts
// 점수표 설계서 §6-1, 판정 규칙 §4.

import type { QuizQuestion } from "./quiz-parse";

export interface ScoreRules {
  /** 모든 게임: 참가만 해도 */
  join: number;
  /** OX·객관식·단답 정답 */
  correct: number;
  /** OX·객관식 빨리 낸 순 보너스 최대(제한 시간 안에서 선형) */
  speedMax: number;
  /** 단답 1·2·3등 추가 */
  shortRank: [number, number, number];
  /** 서바이벌 퀴즈: 문제 하나 살아남을 때마다 / 우승 */
  surviveQuestion: number;
  surviveWin: number;
  /** 가위바위보: 한 판 살아남을 때마다 / 우승 */
  rpsRound: number;
  rpsWin: number;
  /** 달리기 1·2·3등 / 완주 */
  runRank: [number, number, number];
  runFinish: number;
}

export const DEFAULT_RULES: ScoreRules = {
  join: 2,
  correct: 10,
  speedMax: 5,
  shortRank: [10, 6, 3],
  surviveQuestion: 5,
  surviveWin: 30,
  rpsRound: 5,
  rpsWin: 30,
  runRank: [30, 20, 10],
  runFinish: 5,
};

/** 발표자가 게임 탭에서 바꾼 숫자 — 0~100 정수만, 빠진 칸은 기본값 */
export function sanitizeRules(input: unknown): ScoreRules {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : d;
  };
  const tri = (v: unknown, d: [number, number, number]): [number, number, number] => {
    const a = Array.isArray(v) ? v : [];
    return [n(a[0], d[0]), n(a[1], d[1]), n(a[2], d[2])];
  };
  const D = DEFAULT_RULES;
  return {
    join: n(src.join, D.join),
    correct: n(src.correct, D.correct),
    speedMax: n(src.speedMax, D.speedMax),
    shortRank: tri(src.shortRank, D.shortRank),
    surviveQuestion: n(src.surviveQuestion, D.surviveQuestion),
    surviveWin: n(src.surviveWin, D.surviveWin),
    rpsRound: n(src.rpsRound, D.rpsRound),
    rpsWin: n(src.rpsWin, D.rpsWin),
    runRank: tri(src.runRank, D.runRank),
    runFinish: n(src.runFinish, D.runFinish),
  };
}

/** 마감 뒤 이만큼까지는 들어온 답을 인정(전송 지연) — 넘으면 무효 */
export const LATE_GRACE_MS = 1500;
/** 단답은 문제당 3번까지 */
export const SHORT_MAX_ATTEMPTS = 3;
/** 달리기: 초당 최대 걸음 */
export const MAX_STEPS_PER_SEC = 8;

// ───────── 공통 ─────────

export const clampMs = (ms: unknown, limitMs: number) => {
  const n = Number(ms);
  return Number.isFinite(n) ? Math.max(0, Math.min(limitMs, Math.round(n))) : limitMs;
};

/** 발표자가 받은 시각이 마감 + 1.5초를 넘으면 무효 */
export const isLate = (receivedAt: number, deadlineAt: number, graceMs = LATE_GRACE_MS) => receivedAt > deadlineAt + graceMs;

/** 정답일 때만: 0ms 면 +speedMax, 제한 시간 끝이면 0 (선형, 반올림) */
export function speedBonus(rules: ScoreRules, clientMs: number, limitMs: number): number {
  if (limitMs <= 0) return 0;
  const ratio = 1 - clampMs(clientMs, limitMs) / limitMs;
  return Math.round(rules.speedMax * ratio);
}

/** 단답 비교: 공백·문장부호 제거 + 영문 소문자 */
export function normalizeShort(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export function isShortCorrect(input: string, answers: string[]): boolean {
  const n = normalizeShort(input);
  return n.length > 0 && answers.some((a) => normalizeShort(a) === n);
}

// ───────── 퀴즈 답 받기 ─────────

export interface AnswerRec {
  pid: string;
  /** OX·객관식: 보기 번호, 단답: 마지막으로 낸 글자 */
  choice: number | string;
  clientMs: number;
  seq: number;
  receivedAt: number;
  attempts: number;
  /** 단답만 — 맞힌 순간 고정 */
  correct?: boolean;
}

export interface AnswerInput {
  pid: string;
  choice: unknown;
  clientMs: unknown;
  seq: unknown;
}

export type AcceptResult = { ok: true; rec: AnswerRec } | { ok: false; reason: "late" | "duplicate" | "invalid" | "closed" | "done" | "out" };

/**
 * 답 하나를 받는다. book 은 이 문제의 pid → 답(호출한 쪽이 고친 결과를 그대로 쓴다).
 * - 마감 + 1.5초 넘으면 무효
 * - 같은 pid 의 같은(또는 더 옛) seq 는 다시 보낸 것 → 무시. OX·객관식은 더 새 seq 면 답 바꾸기.
 * - 단답은 3번까지, 맞히면 그 뒤로는 무시
 */
export function acceptAnswer(
  book: Map<string, AnswerRec>,
  q: QuizQuestion,
  input: AnswerInput,
  receivedAt: number,
  deadlineAt: number,
  limitMs: number
): AcceptResult {
  if (isLate(receivedAt, deadlineAt)) return { ok: false, reason: "late" };
  const seq = Number(input.seq);
  if (!Number.isInteger(seq) || seq < 0) return { ok: false, reason: "invalid" };
  const prev = book.get(input.pid);
  if (prev && seq <= prev.seq) return { ok: false, reason: "duplicate" };
  const clientMs = clampMs(input.clientMs, limitMs);

  if (q.kind === "short") {
    const text = String(input.choice ?? "").trim().slice(0, 40);
    if (!text) return { ok: false, reason: "invalid" };
    if (prev?.correct) return { ok: false, reason: "done" };
    if (prev && prev.attempts >= SHORT_MAX_ATTEMPTS) return { ok: false, reason: "done" };
    const rec: AnswerRec = {
      pid: input.pid, choice: text, clientMs, seq, receivedAt,
      attempts: (prev?.attempts ?? 0) + 1, correct: isShortCorrect(text, q.answers),
    };
    book.set(input.pid, rec);
    return { ok: true, rec };
  }

  const choice = Number(input.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return { ok: false, reason: "invalid" };
  const rec: AnswerRec = { pid: input.pid, choice, clientMs, seq, receivedAt, attempts: (prev?.attempts ?? 0) + 1 };
  book.set(input.pid, rec);
  return { ok: true, rec };
}

export function isRecCorrect(q: QuizQuestion, rec: AnswerRec | undefined): boolean {
  if (!rec) return false;
  if (q.kind === "short") return !!rec.correct;
  return rec.choice === q.answer;
}

/** 단답 정답자 순서 — 폰이 잰 시간 → 받은 시각 → pid */
export function shortWinners(q: QuizQuestion, book: Map<string, AnswerRec>): AnswerRec[] {
  return [...book.values()]
    .filter((r) => isRecCorrect(q, r))
    .sort((a, b) => a.clientMs - b.clientMs || a.receivedAt - b.receivedAt || (a.pid < b.pid ? -1 : 1));
}

export interface QuestionScore {
  pid: string;
  answered: boolean;
  correct: boolean;
  points: number;
  clientMs: number;
  /** 단답 1·2·3등이면 1·2·3 */
  rank?: number;
}

/** 점수전 한 문제 채점 — 답한 사람만 결과가 나온다. */
export function scoreQuestion(q: QuizQuestion, book: Map<string, AnswerRec>, rules: ScoreRules): QuestionScore[] {
  const limitMs = q.limitSec * 1000;
  const ranks = new Map<string, number>();
  if (q.kind === "short") shortWinners(q, book).slice(0, 3).forEach((r, i) => ranks.set(r.pid, i + 1));
  return [...book.values()].map((r) => {
    const correct = isRecCorrect(q, r);
    let points = 0;
    if (correct) {
      points += rules.correct;
      if (q.kind === "short") {
        const rank = ranks.get(r.pid);
        if (rank) points += rules.shortRank[rank - 1];
      } else {
        points += speedBonus(rules, r.clientMs, limitMs);
      }
    }
    return { pid: r.pid, answered: true, correct, points, clientMs: r.clientMs, rank: ranks.get(r.pid) };
  });
}

// ───────── 서바이벌 ─────────

export interface SurvivalJudge {
  alive: string[];
  out: string[];
  /** 전원 탈락 → 이번 문제 무효, 모두 부활 */
  void: boolean;
}

/**
 * 서바이벌 한 문제 판정. alive = null 이면 첫 문제 → 이 문제에 답한 사람만 참가.
 * 틀리거나 안 낸 사람 탈락. 아무도 안 남으면 무효(살아 있던 사람 그대로).
 */
export function judgeSurvival(q: QuizQuestion, book: Map<string, AnswerRec>, alive: string[] | null): SurvivalJudge {
  const pool = alive ?? [...book.keys()];
  const survivors = pool.filter((pid) => isRecCorrect(q, book.get(pid)));
  if (survivors.length === 0) return { alive: [...pool], out: [], void: true };
  const keep = new Set(survivors);
  return { alive: survivors, out: pool.filter((p) => !keep.has(p)), void: false };
}

// ───────── 가위바위보 ─────────

export type Hand = "가위" | "바위" | "보";
export const HANDS: Hand[] = ["가위", "바위", "보"];
const BEATS: Record<Hand, Hand> = { 가위: "보", 바위: "가위", 보: "바위" };

export function toHand(v: unknown): Hand | null {
  return HANDS.includes(v as Hand) ? (v as Hand) : null;
}

export function rpsOutcome(player: Hand, host: Hand): "win" | "draw" | "lose" {
  if (player === host) return "draw";
  return BEATS[player] === host ? "win" : "lose";
}

/** 발표자가 "랜덤"을 고르면 — rng 는 밖에서(시험에선 고정값) */
export function randomHand(rng: () => number): Hand {
  return HANDS[Math.min(2, Math.floor(rng() * 3))];
}

/**
 * 가위바위보 한 판. alive = null 이면 첫 판 → 낸 사람만 참가.
 * 강사에게 지거나 안 낸 사람 감옥, 비기거나 이기면 생존. 아무도 안 남으면 무효.
 */
export function judgeRps(throws: Map<string, Hand>, hostHand: Hand, alive: string[] | null): SurvivalJudge {
  const pool = alive ?? [...throws.keys()];
  const survivors = pool.filter((pid) => {
    const h = throws.get(pid);
    return !!h && rpsOutcome(h, hostHand) !== "lose";
  });
  if (survivors.length === 0) return { alive: [...pool], out: [], void: true };
  const keep = new Set(survivors);
  return { alive: survivors, out: pool.filter((p) => !keep.has(p)), void: false };
}

// ───────── 달리기 ─────────

export interface StepBudget {
  /** 아직 쓸 수 있는 걸음 */
  bank: number;
  /** 마지막으로 계산한 시각 */
  at: number;
}

/** GO 순간 — 첫 묶음 전송 지연까지 감안해 1초어치(8걸음)를 미리 준다 */
export function newStepBudget(goAt: number): StepBudget {
  return { bank: MAX_STEPS_PER_SEC, at: goAt };
}

/**
 * 폰이 묶어 보낸 걸음 수 중 인정할 만큼. 초당 8걸음씩 쌓이는 통장에서 꺼내 쓴다
 * (묶음이 늦게·몰려 와도 정직한 탭은 다 인정, 매크로는 초당 8걸음으로 잘림). 통장은 5초어치까지.
 * GO 전에 받은 건 0.
 */
export function acceptSteps(budget: StepBudget, count: unknown, receivedAt: number, goAt: number): number {
  if (receivedAt < goAt) return 0;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const since = Math.max(budget.at, goAt);
  budget.bank = Math.min(MAX_STEPS_PER_SEC * 5, budget.bank + ((receivedAt - since) / 1000) * MAX_STEPS_PER_SEC);
  budget.at = Math.max(budget.at, receivedAt);
  const ok = Math.min(n, Math.floor(budget.bank));
  budget.bank -= ok;
  return ok;
}

/** 묶음 간격 = max(1, ceil(인원/15))초 — 인원과 상관없이 초당 약 15건(60명 4초).
 *  처음엔 /25 였는데 60명 실측에서 막판 묶음 + 전원 방송이 겹쳐 1초 106건 — 한도 100 밑으로 여유를 둔다. */
export const stepBatchMs = (people: number) => Math.max(1, Math.ceil(people / 15)) * 1000;

/**
 * 골인 시간(GO 부터 ms) — 폰이 잰 값을 쓴다(묶음 도착 시각은 60명이면 3초까지 늦어 등수가 뒤바뀐다).
 * 믿을 수 없는 값은 발표자가 잰 시간으로: 초당 8걸음으로도 불가능하게 빠르거나(GO 때 미리 주는 8걸음 감안),
 * 발표자가 받은 시각보다 늦은 값(폰 시계는 방송을 받은 뒤 시작하니 발표자 쪽보다 길 수 없다).
 */
export function finishTime(goal: number, clientMs: unknown, hostElapsedMs: number): number {
  const host = Math.max(0, Math.round(hostElapsedMs));
  const c = Number(clientMs);
  if (clientMs === undefined || clientMs === null || !Number.isFinite(c)) return host;
  const minMs = Math.max(0, ((goal - MAX_STEPS_PER_SEC) / MAX_STEPS_PER_SEC) * 1000);
  if (c < minMs || c > host + LATE_GRACE_MS) return host;
  return Math.round(c);
}

export interface RunnerResult {
  pid: string;
  steps: number;
  finishedAt: number | null;
  /** GO 부터 골인까지(ms) — 있으면 이걸로 등수 */
  finishMs?: number | null;
}

const runKey = (r: RunnerResult) => r.finishMs ?? Number.POSITIVE_INFINITY;

/** 달리기 점수: 골인 시간 1·2·3등 + 완주 + 참가(걸음 1 이상) */
export function scoreRun(runners: RunnerResult[], goal: number, rules: ScoreRules): Map<string, number> {
  const pts = new Map<string, number>();
  const finished = runners.filter((r) => r.finishedAt !== null && r.steps >= goal)
    .sort((a, b) => runKey(a) - runKey(b) || a.finishedAt! - b.finishedAt! || (a.pid < b.pid ? -1 : 1));
  for (const r of runners) if (r.steps > 0) pts.set(r.pid, rules.join);
  finished.forEach((r, i) => {
    pts.set(r.pid, (pts.get(r.pid) ?? 0) + rules.runFinish + (i < 3 ? rules.runRank[i] : 0));
  });
  return pts;
}

// ───────── 순위 ─────────

export interface StandingInput {
  pid: string;
  points: number;
  correct: number;
  answered: number;
  totalMs: number;
  joinedAt: number;
}

/**
 * 동점이면: 정답 수 많은 사람 → 평균 응답 시간 빠른 사람 → 먼저 참가한 사람 (§6-1).
 * 답한 적 없는 사람의 평균 시간은 맨 뒤로.
 */
export function rankStandings<T extends StandingInput>(list: T[]): Array<T & { rank: number }> {
  const avg = (s: StandingInput) => (s.answered > 0 ? s.totalMs / s.answered : Number.POSITIVE_INFINITY);
  const sorted = [...list].sort((a, b) =>
    b.points - a.points ||
    b.correct - a.correct ||
    avg(a) - avg(b) ||
    a.joinedAt - b.joinedAt ||
    (a.pid < b.pid ? -1 : 1)
  );
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}
