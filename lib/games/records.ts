// 끝난 게임 기록 → 종합 순위, DB 저장 묶음(설계서 §6). 순수 함수만. 단위 시험: tests/unit/records.test.ts

import type { GameState, PlayerStat, QuestionLog } from "./host-game";
import { rankStandings } from "./scoring";

/** 끝난 게임 한 판 — 결과 화면·CSV·DB 저장 */
export interface GameRecord {
  id: string;
  type: GameState["type"];
  title: string;
  mode?: GameState["mode"];
  startedAt: number;
  endedAt: number;
  /** 이번 게임 점수 */
  points: Record<string, number>;
  winners: string[];
  players: string[];
  /** 퀴즈 정답 수·답한 수·응답 시간 합(동점 처리·CSV) */
  stats?: Record<string, PlayerStat>;
  log: QuestionLog[];
  /** DB 에 저장됐나(안 됐으면 다음에 다시) */
  saved?: boolean;
}

export interface Person {
  pid: string;
  nickname: string;
  character: string;
  joinedAt: number;
}

export interface Standing extends Person {
  points: number;
  correct: number;
  answered: number;
  totalMs: number;
  /** 게임에 참가한 판 수 */
  played: number;
  rank: number;
  /** 마지막 게임 전 순위 — 게임이 1판뿐이거나 그때 없던 사람은 null */
  prevRank: number | null;
  /** 오른 칸 수(+ 오름, - 내림) — prevRank 가 없으면 0 */
  delta: number;
}

function totals(people: Person[], games: GameRecord[]) {
  const map = new Map<string, Omit<Standing, "rank" | "prevRank" | "delta">>();
  for (const p of people) map.set(p.pid, { ...p, points: 0, correct: 0, answered: 0, totalMs: 0, played: 0 });
  for (const g of games) {
    for (const pid of new Set([...g.players, ...Object.keys(g.points)])) {
      let row = map.get(pid);
      if (!row) {
        // 기록엔 있는데 참가자 목록엔 없는 사람(이론상 없음) — 이름 없이라도 순위엔 넣는다
        row = { pid, nickname: "?", character: "", joinedAt: Number.MAX_SAFE_INTEGER, points: 0, correct: 0, answered: 0, totalMs: 0, played: 0 };
        map.set(pid, row);
      }
      row.points += g.points[pid] ?? 0;
      row.played += 1;
      const st = g.stats?.[pid];
      if (st) {
        row.correct += st.correct;
        row.answered += st.answered;
        row.totalMs += st.totalMs;
      }
    }
  }
  return [...map.values()];
}

/**
 * 종합 순위 — 모든 게임 누적. 동점은 정답 수 → 평균 응답 시간 → 먼저 참가.
 * 순위 변화(▲)는 마지막 게임 직전 순위와 비교한다.
 */
export function computeStandings(people: Person[], games: GameRecord[]): Standing[] {
  const now = rankStandings(totals(people, games));
  if (games.length < 2) return now.map((s) => ({ ...s, prevRank: null, delta: 0 }));
  const before = new Map(rankStandings(totals(people, games.slice(0, -1))).map((s) => [s.pid, s.rank]));
  return now.map((s) => {
    const pr = before.get(s.pid) ?? null;
    return { ...s, prevRank: pr, delta: pr !== null ? pr - s.rank : 0 };
  });
}

/** 폰에 보내는 순위 — pid → [총점, 순위, 오른 칸] (게임이 끝날 때만 바뀐다) */
export type AudienceRanks = Record<string, [number, number, number]>;

export function audienceRanks(rows: Standing[]): AudienceRanks {
  const out: AudienceRanks = {};
  for (const r of rows) out[r.pid] = [r.points, r.rank, r.delta];
  return out;
}

// ───────── DB 저장 묶음 ─────────

export interface ResultPlayer {
  pid: string;
  nick: string;
  char: string;
  joinedAt: number;
  pts: number;
  c: number;
  a: number;
  ms: number;
}

export interface ResultPayload {
  v: 1;
  id: string;
  type: GameRecord["type"];
  title: string;
  mode?: GameRecord["mode"];
  startedAt: number;
  endedAt: number;
  winners: string[];
  players: ResultPlayer[];
  log: QuestionLog[];
}

const MAX_PLAYERS = 400;

/** 끝난 게임 1판 → DB 에 넣을 묶음(참가 토큰 같은 비밀값은 넣지 않는다). 256KB 한참 아래. */
export function toResultPayload(rec: GameRecord, people: Map<string, Person>): ResultPayload {
  const pids = [...new Set([...rec.players, ...Object.keys(rec.points)])].slice(0, MAX_PLAYERS);
  return {
    v: 1,
    id: rec.id,
    type: rec.type,
    title: rec.title.slice(0, 60),
    mode: rec.mode,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    winners: rec.winners.slice(0, 50),
    players: pids.map((pid) => {
      const p = people.get(pid);
      const st = rec.stats?.[pid];
      return {
        pid,
        nick: (p?.nickname ?? "?").slice(0, 30),
        char: (p?.character ?? "").slice(0, 40),
        joinedAt: p?.joinedAt ?? rec.startedAt,
        pts: rec.points[pid] ?? 0,
        c: st?.correct ?? 0,
        a: st?.answered ?? 0,
        ms: st?.totalMs ?? 0,
      };
    }),
    log: rec.log.slice(0, 200).map((l) => ({ ...l, text: l.text.slice(0, 300), answerText: l.answerText.slice(0, 200) })),
  };
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * DB 에서 읽은 결과들 → 게임 기록 + 참가자(다른 PC 에서 발표자 링크로 열었을 때 순위 복원).
 * 모양이 이상한 줄은 버린다(DB 는 발표자만 쓰지만, 읽는 쪽도 믿지 않는다).
 */
export function fromResultPayloads(rows: unknown[]): { games: GameRecord[]; people: Person[] } {
  const games: GameRecord[] = [];
  const people = new Map<string, Person>();
  for (const raw of rows) {
    const r = raw as Partial<ResultPayload> | null;
    if (!r || r.v !== 1 || !isStr(r.id, 64) || !isStr(r.title, 60)) continue;
    if (r.type !== "quiz" && r.type !== "rps" && r.type !== "run") continue;
    if (!Array.isArray(r.players)) continue;
    const points: Record<string, number> = {};
    const stats: Record<string, PlayerStat> = {};
    const players: string[] = [];
    for (const pl of r.players.slice(0, MAX_PLAYERS)) {
      if (!pl || !isStr(pl.pid, 64) || !pl.pid) continue;
      players.push(pl.pid);
      points[pl.pid] = num(pl.pts);
      stats[pl.pid] = { correct: num(pl.c), answered: num(pl.a), totalMs: num(pl.ms) };
      const joinedAt = num(pl.joinedAt);
      const known = people.get(pl.pid);
      // 이름·캐릭터는 가장 나중 게임 것으로, 참가 시각은 가장 이른 것으로
      people.set(pl.pid, {
        pid: pl.pid,
        nickname: isStr(pl.nick, 30) && pl.nick ? pl.nick : known?.nickname ?? "?",
        character: isStr(pl.char, 40) ? pl.char : known?.character ?? "",
        joinedAt: known ? Math.min(known.joinedAt, joinedAt) : joinedAt,
      });
    }
    games.push({
      id: r.id,
      type: r.type,
      title: r.title,
      mode: r.mode === "survival" || r.mode === "score" ? r.mode : undefined,
      startedAt: num(r.startedAt),
      endedAt: num(r.endedAt),
      points,
      winners: Array.isArray(r.winners) ? r.winners.filter((w): w is string => isStr(w, 64)) : [],
      players,
      stats,
      log: Array.isArray(r.log) ? (r.log as QuestionLog[]) : [],
      saved: true,
    });
  }
  games.sort((a, b) => a.endedAt - b.endedAt);
  return { games, people: [...people.values()] };
}
