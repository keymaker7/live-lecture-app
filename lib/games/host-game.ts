// 게임 진행(발표자 브라우저만) — 상태는 전부 JSON 으로 저장 가능한 값, 시간·난수는 deps 로 받는다.
// 채점·판정은 scoring.ts 의 순수 함수에 맡긴다. 단위 시험: tests/unit/host-game.test.ts

import type { QuizQuestion } from "./quiz-parse";
import {
  DEFAULT_RULES, LATE_GRACE_MS, acceptAnswer, acceptSteps, isLate, isRecCorrect, judgeRps, judgeSurvival,
  finishTime, newStepBudget, randomHand, scoreQuestion, scoreRun, shortWinners, stepBatchMs, toHand,
  type AnswerRec, type Hand, type ScoreRules, type StepBudget,
} from "./scoring";

export type GameType = "quiz" | "rps" | "run";
export type QuizMode = "score" | "survival";
/** ready: 시작 화면 · open: 답 받는 중 · closed: 마감(정답 공개 전) · revealed: 판정 끝 · countdown: 달리기 3·2·1 / 가위바위보 공개 카운트 · running · finished */
export type GamePhase = "ready" | "open" | "closed" | "revealed" | "countdown" | "running" | "finished";

export interface PlayerStat {
  correct: number;
  answered: number;
  totalMs: number;
}

export interface QuestionLog {
  no: number;
  kind: QuizQuestion["kind"];
  text: string;
  answerText: string;
  answered: number;
  correct: number;
  firstPid: string | null;
  void?: boolean;
}

export interface RunnerState {
  steps: number;
  finishedAt: number | null;
  /** GO 부터 골인까지(ms, 폰이 잰 값을 검사해서) — 등수 기준 */
  finishMs?: number | null;
  lane: number;
  budget: StepBudget;
  seq: number;
}

export interface GameState {
  id: string;
  type: GameType;
  title: string;
  phase: GamePhase;
  startedAt: number;
  endedAt: number | null;
  /** 이번 게임 점수 */
  points: Record<string, number>;
  /** 게임에 한 번이라도 참여한 사람(참가 +2) — 들어온 순서 */
  players: string[];
  stats: Record<string, PlayerStat>;
  /** 서바이벌·가위바위보: 살아 있는 사람(null = 아직 첫 문제/첫 판 전) */
  alive: string[] | null;
  jail: string[];
  winners: string[];
  /** 마지막 판정 — 폰에 보여 줄 것 */
  reveal: { key: string; res: Record<string, [0 | 1, number]>; void: boolean } | null;

  // quiz
  mode?: QuizMode;
  questions?: QuizQuestion[];
  qi?: number;
  openAt?: number | null;
  deadlineAt?: number | null;
  book?: Record<string, AnswerRec>;
  log?: QuestionLog[];

  // rps
  round?: number;
  throws?: Record<string, { hand: Hand; seq: number }>;
  hostHand?: Hand | null;
  revealAt?: number | null;

  // run
  goal?: number;
  limitSec?: number;
  goAt?: number | null;
  endAt?: number | null;
  runners?: Record<string, RunnerState>;
  finishOrder?: string[];
  finishAt?: number | null;
  batchMs?: number;
}

/** 폰에 보내는 게임 화면 — 폰이 실제로 쓰는 것만 */
export interface AudienceGame {
  id: string;
  type: GameType;
  mode?: QuizMode;
  phase: GamePhase;
  title: string;
  q?: { no: number; total: number; kind: QuizQuestion["kind"]; text: string; options: string[]; limitMs: number };
  round?: number;
  run?: { goal: number; batchMs: number; limitSec: number };
  out?: string[];
  reveal?: GameState["reveal"];
  pts?: Record<string, number>;
  winners?: string[];
}

export type GameEffect =
  | { t: "start"; type: GameType }
  | { t: "open"; no: number }
  | { t: "answer"; pid: string; zone: string }
  | { t: "close" }
  | { t: "reveal"; key: string; correct: string[]; wrong: string[]; out: string[]; void: boolean }
  | { t: "rps-count"; hand: Hand }
  | { t: "go" }
  | { t: "step"; pid: string; steps: number }
  | { t: "goal"; pid: string; rank: number }
  | { t: "finish"; winners: string[]; top: Array<{ pid: string; points: number }> };

export interface GameDeps {
  now: () => number;
  rng: () => number;
  rules?: ScoreRules;
  onEffect?: (e: GameEffect) => void;
}

const RPS_COUNT_MS = 3 * 380;
const RUN_COUNTDOWN_MS = 3000;
const RUN_RESULT_DELAY_MS = 2500;

export class HostGame {
  constructor(public s: GameState, private deps: GameDeps) {}

  private get rules() { return this.deps.rules ?? DEFAULT_RULES; }
  private fx(e: GameEffect) { this.deps.onEffect?.(e); }

  private base(type: GameType, id: string, title: string): GameState {
    return {
      id, type, title, phase: "ready", startedAt: this.deps.now(), endedAt: null,
      points: {}, players: [], stats: {}, alive: null, jail: [], winners: [], reveal: null,
    };
  }

  static quiz(deps: GameDeps, id: string, title: string, questions: QuizQuestion[], mode: QuizMode): HostGame {
    const g = new HostGame({} as GameState, deps);
    g.s = { ...g.base("quiz", id, title), mode, questions, qi: -1, openAt: null, deadlineAt: null, book: {}, log: [] };
    g.fx({ t: "start", type: "quiz" });
    return g;
  }

  static rps(deps: GameDeps, id: string, title = "가위바위보"): HostGame {
    const g = new HostGame({} as GameState, deps);
    g.s = { ...g.base("rps", id, title), round: 0, throws: {}, hostHand: null, revealAt: null };
    g.fx({ t: "start", type: "rps" });
    return g;
  }

  static run(deps: GameDeps, id: string, goal: number, limitSec: number, people: number, title = "달리기"): HostGame {
    const g = new HostGame({} as GameState, deps);
    g.s = {
      ...g.base("run", id, title),
      goal: Math.max(10, Math.min(300, Math.round(goal) || 50)),
      limitSec: Math.max(10, Math.min(300, Math.round(limitSec) || 60)),
      goAt: null, endAt: null, runners: {}, finishOrder: [], finishAt: null, batchMs: stepBatchMs(people),
    };
    g.fx({ t: "start", type: "run" });
    return g;
  }

  private addPlayer(pid: string) {
    if (!this.s.players.includes(pid)) this.s.players.push(pid);
    if (!this.s.stats[pid]) this.s.stats[pid] = { correct: 0, answered: 0, totalMs: 0 };
  }

  private give(pid: string, pts: number) {
    if (pts) this.s.points[pid] = (this.s.points[pid] ?? 0) + pts;
  }

  get question(): QuizQuestion | null {
    const s = this.s;
    return s.type === "quiz" && s.questions && s.qi !== undefined && s.qi >= 0 ? s.questions[s.qi] ?? null : null;
  }

  get isLastQuestion() {
    return this.s.type === "quiz" && (this.s.qi ?? -1) >= (this.s.questions?.length ?? 0) - 1;
  }

  // ───────── 퀴즈 ─────────

  /** 다음 문제 공개. 마감 시각은 폰에 실제로 방송된 순간(markBroadcast)부터 잰다. */
  openQuestion(): boolean {
    const s = this.s;
    if (s.type !== "quiz" || s.phase === "finished" || s.phase === "open") return false;
    if ((s.qi ?? -1) + 1 >= (s.questions?.length ?? 0)) return false;
    s.qi = (s.qi ?? -1) + 1;
    s.phase = "open";
    s.openAt = null;
    s.deadlineAt = null;
    s.book = {};
    s.reveal = null;
    this.fx({ t: "open", no: s.qi + 1 });
    return true;
  }

  /** 방송이 나간 순간 — 열린 문제의 시계를 이때부터, 달리기 GO 도 이때부터 3초. */
  markBroadcast(now: number) {
    const s = this.s;
    if (s.type === "quiz" && s.phase === "open" && s.openAt == null) {
      s.openAt = now;
      s.deadlineAt = now + (this.question?.limitSec ?? 10) * 1000;
    }
    if (s.type === "run" && s.phase === "countdown" && s.goAt == null) {
      s.goAt = now + RUN_COUNTDOWN_MS;
      s.endAt = s.goAt + (s.limitSec ?? 60) * 1000;
    }
  }

  answer(pid: string, payload: Record<string, unknown>, receivedAt: number): boolean {
    const s = this.s;
    if (s.type === "rps") return this.throwHand(pid, payload, receivedAt);
    const q = this.question;
    if (s.type !== "quiz" || !q || (s.phase !== "open" && s.phase !== "closed")) return false;
    if (payload.gid !== s.id || Number(payload.qno) !== (s.qi ?? 0) + 1) return false;
    if (s.mode === "survival" && s.alive && !s.alive.includes(pid)) return false; // 감옥
    if (s.mode === "survival" && !s.alive && (s.qi ?? 0) > 0) return false; // 첫 문제에 안 낸 사람
    // 마감 시각이 아직 없으면(방송 전) 받을 일이 없지만, 혹시 오면 지금부터 제한 시간
    const deadline = s.deadlineAt ?? receivedAt + q.limitSec * 1000;
    const book = new Map(Object.entries(s.book ?? {}));
    const r = acceptAnswer(book, q, { pid, choice: payload.choice, clientMs: payload.clientMs, seq: payload.seq }, receivedAt, deadline, q.limitSec * 1000);
    if (!r.ok) return false;
    s.book = Object.fromEntries(book);
    this.addPlayer(pid);
    const zone = q.kind === "short" ? (r.rec.correct ? "ok" : "") : String(r.rec.choice);
    this.fx({ t: "answer", pid, zone });
    return true;
  }

  /** 지금 각 보기에 몇 명 — "지금 O 18 : X 14" */
  tally(): number[] {
    const q = this.question;
    if (!q || q.kind === "short") return [];
    const counts = q.options.map(() => 0);
    for (const r of Object.values(this.s.book ?? {})) if (typeof r.choice === "number") counts[r.choice]++;
    return counts;
  }

  /** 단답 정답자 순서(실시간) */
  shortOrder(): string[] {
    const q = this.question;
    if (!q || q.kind !== "short") return [];
    return shortWinners(q, new Map(Object.entries(this.s.book ?? {}))).map((r) => r.pid);
  }

  /** 마감 — 제한 시간이 끝나고 1.5초(전송 지연) 기다린 뒤, 또는 발표자가 일찍 닫을 때. */
  closeQuestion(): boolean {
    if (this.s.type !== "quiz" || this.s.phase !== "open") return false;
    this.s.phase = "closed";
    this.fx({ t: "close" });
    return true;
  }

  /** 정답 공개 → 판정·점수 */
  reveal(): boolean {
    const s = this.s;
    const q = this.question;
    if (s.type !== "quiz" || !q || (s.phase !== "closed" && s.phase !== "open")) return false;
    s.phase = "revealed";
    const book = new Map(Object.entries(s.book ?? {}));
    const key = q.kind === "short" ? q.answers[0] : q.options[q.answer];
    const res: Record<string, [0 | 1, number]> = {};
    const correctPids: string[] = [];
    const wrongPids: string[] = [];

    for (const r of book.values()) {
      const ok = isRecCorrect(q, r);
      const st = this.s.stats[r.pid] ?? { correct: 0, answered: 0, totalMs: 0 };
      st.answered++;
      st.totalMs += r.clientMs;
      if (ok) st.correct++;
      this.s.stats[r.pid] = st;
      (ok ? correctPids : wrongPids).push(r.pid);
    }

    let out: string[] = [];
    let isVoid = false;
    if (s.mode === "survival") {
      const j = judgeSurvival(q, book, s.alive);
      isVoid = j.void;
      out = j.out;
      if (!j.void) {
        for (const pid of j.alive) { this.give(pid, this.rules.surviveQuestion); res[pid] = [1, this.rules.surviveQuestion]; }
        for (const pid of j.out) res[pid] = [0, 0];
        s.jail = [...s.jail, ...j.out];
      } else {
        for (const pid of j.alive) res[pid] = [0, 0];
      }
      s.alive = j.alive;
    } else {
      for (const sc of scoreQuestion(q, book, this.rules)) {
        this.give(sc.pid, sc.points);
        res[sc.pid] = [sc.correct ? 1 : 0, sc.points];
      }
    }

    const winners = q.kind === "short" ? shortWinners(q, book) : [...book.values()].filter((r) => isRecCorrect(q, r)).sort((a, b) => a.clientMs - b.clientMs);
    s.log = [...(s.log ?? []), {
      no: (s.qi ?? 0) + 1, kind: q.kind, text: q.text, answerText: q.kind === "short" ? q.answers.join(", ") : key,
      answered: book.size, correct: correctPids.length, firstPid: winners[0]?.pid ?? null, void: isVoid || undefined,
    }];
    s.reveal = { key, res, void: isVoid };
    this.fx({ t: "reveal", key, correct: correctPids, wrong: wrongPids, out, void: isVoid });
    return true;
  }

  /** 다음 — 문제가 남았고 (서바이벌이면 2명 이상 살아 있으면) 다음 문제, 아니면 끝. */
  next(): boolean {
    const s = this.s;
    if (s.type === "quiz") {
      if (s.phase !== "revealed") return false;
      const survivalOver = s.mode === "survival" && s.alive !== null && s.alive.length <= 1;
      if (this.isLastQuestion || survivalOver) return this.finish();
      return this.openQuestion();
    }
    if (s.type === "rps") return this.rpsOpen();
    return false;
  }

  // ───────── 가위바위보 ─────────

  /** 새 판 — 폰에서 손을 낼 수 있게 */
  rpsOpen(): boolean {
    const s = this.s;
    if (s.type !== "rps" || s.phase === "finished" || s.phase === "open" || s.phase === "countdown") return false;
    if (s.alive && s.alive.length <= 1) return this.finish();
    s.round = (s.round ?? 0) + 1;
    s.throws = {};
    s.hostHand = null;
    s.revealAt = null;
    s.reveal = null;
    s.phase = "open";
    this.fx({ t: "open", no: s.round });
    return true;
  }

  private throwHand(pid: string, payload: Record<string, unknown>, receivedAt: number): boolean {
    const s = this.s;
    if (s.phase !== "open" && s.phase !== "countdown") return false;
    if (payload.gid !== s.id || Number(payload.round) !== s.round) return false;
    if (s.phase === "countdown" && s.revealAt != null && isLate(receivedAt, s.revealAt)) return false;
    if (s.alive && !s.alive.includes(pid)) return false;
    if (!s.alive && (s.round ?? 1) > 1) return false;
    const hand = toHand(payload.choice);
    const seq = Number(payload.seq);
    if (!hand || !Number.isInteger(seq)) return false;
    const prev = s.throws?.[pid];
    if (prev && seq <= prev.seq) return false;
    s.throws = { ...(s.throws ?? {}), [pid]: { hand, seq } };
    this.addPlayer(pid);
    this.fx({ t: "answer", pid, zone: hand });
    return true;
  }

  /** "공개" — 강사 손(또는 랜덤) 정하고 가위·바위·보 카운트(0.38초 간격) 뒤 판정 */
  rpsReveal(choice: Hand | "random"): boolean {
    const s = this.s;
    if (s.type !== "rps" || s.phase !== "open") return false;
    s.hostHand = choice === "random" ? randomHand(this.deps.rng) : choice;
    s.revealAt = this.deps.now() + RPS_COUNT_MS;
    s.phase = "countdown";
    this.fx({ t: "rps-count", hand: s.hostHand });
    return true;
  }

  private rpsJudge() {
    const s = this.s;
    const throws = new Map(Object.entries(s.throws ?? {}).map(([p, t]) => [p, t.hand]));
    const j = judgeRps(throws, s.hostHand!, s.alive);
    const res: Record<string, [0 | 1, number]> = {};
    if (!j.void) {
      for (const pid of j.alive) { this.give(pid, this.rules.rpsRound); res[pid] = [1, this.rules.rpsRound]; }
      for (const pid of j.out) res[pid] = [0, 0];
      s.jail = [...s.jail, ...j.out];
    } else {
      for (const pid of j.alive) res[pid] = [0, 0];
    }
    s.alive = j.alive;
    s.phase = "revealed";
    s.reveal = { key: s.hostHand!, res, void: j.void };
    this.fx({ t: "reveal", key: s.hostHand!, correct: j.void ? [] : j.alive, wrong: j.out, out: j.out, void: j.void });
    if (!j.void && j.alive.length === 1) this.finish(); // 생존자 1명이면 자동 종료
  }

  // ───────── 달리기 ─────────

  /** 3·2·1·GO! — GO 시각은 방송이 나간 순간 + 3초 */
  runStart(): boolean {
    const s = this.s;
    if (s.type !== "run" || s.phase !== "ready") return false;
    s.phase = "countdown";
    s.goAt = null;
    return true;
  }

  steps(pid: string, payload: Record<string, unknown>, receivedAt: number): number {
    const s = this.s;
    if (s.type !== "run" || (s.phase !== "countdown" && s.phase !== "running") || s.goAt == null) return 0;
    if (payload.gid !== s.id) return 0;
    if (receivedAt < s.goAt) return 0; // 카운트다운 중 탭 무효
    if (s.endAt != null && receivedAt > s.endAt + LATE_GRACE_MS) return 0;
    const seq = Number(payload.seq);
    let r = s.runners![pid];
    if (!r) {
      r = { steps: 0, finishedAt: null, lane: Object.keys(s.runners!).length, budget: newStepBudget(s.goAt), seq: -1 };
      s.runners![pid] = r;
      this.addPlayer(pid);
    }
    if (!Number.isInteger(seq) || seq <= r.seq || r.finishedAt != null) return 0;
    r.seq = seq;
    const ok = acceptSteps(r.budget, payload.count, receivedAt, s.goAt);
    if (!ok) return 0;
    r.steps = Math.min(s.goal!, r.steps + ok);
    this.fx({ t: "step", pid, steps: r.steps });
    if (r.steps >= s.goal!) {
      r.finishedAt = receivedAt;
      r.finishMs = finishTime(s.goal!, payload.finishMs, receivedAt - s.goAt);
      // 골인 시간 순으로 끼워 넣는다(먼저 들어온 묶음이 늘 먼저 골인한 건 아니다)
      const order = [...(s.finishOrder ?? [])];
      const t = r.finishMs;
      let at = order.findIndex((other) => (s.runners![other].finishMs ?? Number.POSITIVE_INFINITY) > t);
      if (at < 0) at = order.length;
      order.splice(at, 0, pid);
      s.finishOrder = order;
      this.fx({ t: "goal", pid, rank: at + 1 });
    }
    return ok;
  }

  /** 상위 5명 전광판 */
  runBoard(n = 5): Array<{ pid: string; steps: number }> {
    const rs = Object.entries(this.s.runners ?? {});
    return rs
      .map(([pid, r]) => ({ pid, steps: r.steps, fin: r.finishMs ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => b.steps - a.steps || a.fin - b.fin)
      .slice(0, n)
      .map(({ pid, steps }) => ({ pid, steps }));
  }

  // ───────── 공통 ─────────

  /** 시간에 따라 넘어가는 것(마감·카운트·골인 뒤 결과) — 발표자가 250ms 마다 부른다. 바뀌었으면 true */
  tick(now: number): boolean {
    const s = this.s;
    if (s.type === "quiz" && s.phase === "open" && s.deadlineAt != null && now > s.deadlineAt + LATE_GRACE_MS) {
      return this.closeQuestion();
    }
    if (s.type === "rps" && s.phase === "countdown" && s.revealAt != null && now > s.revealAt + LATE_GRACE_MS) {
      this.rpsJudge();
      return true;
    }
    if (s.type === "run") {
      if (s.phase === "countdown" && s.goAt != null && now >= s.goAt) {
        s.phase = "running";
        this.fx({ t: "go" });
        return true;
      }
      if (s.phase === "running") {
        const total = Object.keys(s.runners ?? {}).length;
        const done = (s.finishOrder ?? []).length;
        const over = (s.endAt != null && now >= s.endAt) || done >= 3 || (total > 0 && done === total);
        if (over && s.finishAt == null) s.finishAt = now + RUN_RESULT_DELAY_MS;
        if (s.finishAt != null && now >= s.finishAt) return this.finish();
      }
    }
    return false;
  }

  /** 게임 끝 — 우승 보너스, 참가 +2, 결과 */
  finish(): boolean {
    const s = this.s;
    if (s.phase === "finished") return false;
    const r = this.rules;
    if (s.type === "quiz" && s.mode === "survival" && s.alive && s.alive.length > 0 && (s.qi ?? -1) >= 0) {
      s.winners = [...s.alive];
      for (const pid of s.winners) this.give(pid, r.surviveWin);
    }
    if (s.type === "rps" && s.alive && s.alive.length > 0 && (s.round ?? 0) > 0) {
      s.winners = [...s.alive];
      for (const pid of s.winners) this.give(pid, r.rpsWin);
    }
    if (s.type === "run") {
      const runners = Object.entries(s.runners ?? {}).map(([pid, x]) => ({ pid, steps: x.steps, finishedAt: x.finishedAt, finishMs: x.finishMs }));
      for (const [pid, pts] of scoreRun(runners, s.goal!, r)) this.give(pid, pts);
      s.winners = (s.finishOrder ?? []).slice(0, 1);
    } else {
      for (const pid of s.players) this.give(pid, r.join);
    }
    if (s.type === "quiz" && s.mode !== "survival") {
      const best = Object.entries(s.points).sort((a, b) => b[1] - a[1]);
      s.winners = best.length ? [best[0][0]] : [];
    }
    s.phase = "finished";
    s.endedAt = this.deps.now();
    const top = Object.entries(s.points).map(([pid, points]) => ({ pid, points })).sort((a, b) => b.points - a.points).slice(0, 10);
    this.fx({ t: "finish", winners: s.winners, top });
    return true;
  }

  audience(): AudienceGame {
    const s = this.s;
    const v: AudienceGame = { id: s.id, type: s.type, phase: s.phase, title: s.title };
    if (s.type === "quiz") {
      v.mode = s.mode;
      const q = this.question;
      if (q) {
        v.q = {
          no: (s.qi ?? 0) + 1, total: s.questions?.length ?? 0, kind: q.kind, text: q.text,
          options: q.kind === "short" ? [] : q.options, limitMs: q.limitSec * 1000,
        };
      }
    }
    if (s.type === "rps") v.round = s.round;
    if (s.type === "run") v.run = { goal: s.goal!, batchMs: s.batchMs!, limitSec: s.limitSec! };
    if (s.jail.length) v.out = s.jail;
    if (s.reveal && (s.phase === "revealed" || s.phase === "finished")) v.reveal = s.reveal;
    if (s.phase === "revealed" || s.phase === "finished") v.pts = s.points;
    if (s.phase === "finished") v.winners = s.winners;
    return v;
  }
}
