"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";
import { HostLock, type HostStatus, type RequestState, type TakeoverPrompt } from "@/lib/realtime/host-lock";
import { countMessage } from "@/lib/realtime/stats";
import { bumpMyActivity, hostTabId, readJSON, stablePid, stableToken, writeJSON } from "@/lib/realtime/storage";
import { sha256Hex } from "@/lib/realtime/sha256";
import { loadHostKey } from "@/lib/realtime/host-key";
import { resolveCharacter } from "@/lib/plaza/characters";
import { HostGame, type AudienceGame, type GameEffect, type GameState } from "@/lib/games/host-game";
import type { QuizQuestion } from "@/lib/games/quiz-parse";
import { sanitizeRules } from "@/lib/games/scoring";
import {
  audienceRanks, computeStandings, fromResultPayloads, toResultPayload,
  type AudienceRanks, type GameRecord, type Person, type Standing,
} from "@/lib/games/records";
import { loadResults, saveResult, type SaveOutcome } from "@/lib/games/results-db";

export type { GameRecord, Standing } from "@/lib/games/records";

// 통신 구조 (설계서 §2)
//   slides-room:{roomId}  공용 — 발표자만 보낸다. 폰은 듣기만: room-state(묶어서 초당 최대 1회), host-rejoined
//   slides-cmd:{roomId}   명령 — 발표자 탭만 구독. 폰은 구독 없이 httpSend(REST)로 보낸다.
// 채팅·반응은 다시 방송하지 않는다(발표 화면이 명령 채널에서 바로 받아 그린다).

export interface ActiveVideo {
  videoId: string;
  url: string;
  start: number;
  end: number;
  nickname: string;
}

export interface RoomState {
  poll: {
    id: string;
    question: string;
    options: Array<{ text: string; votes: number }>;
    active: boolean;
  } | null;
  questions: Array<{
    id: string;
    text: string;
    nickname: string;
    timestamp: number;
    answered: boolean;
  }>;
  slideRequests: { next: number; prev: number };
  focusTimeline: Array<{ time: number; count: number }>;
  participantCount: number;
  reactionStats: Record<string, number>;
  videoChatEnabled: boolean;
  activeVideo: ActiveVideo | null;
}

export interface Participant {
  pid: string;
  nickname: string;
  /** 동물 캐릭터 id (public/characters) */
  character: string;
  joinedAt: number;
  /** 마지막 활동(입장·채팅·반응·질문·투표) — 5분 넘으면 광장에서 💤 */
  lastActive: number;
  online: boolean;
  chats: number;
  reactions: number;
  questions: number;
  votes: number;
  /** 게임 누적 점수(끝난 게임만) */
  score?: number;
  /** 게임별 점수 — 게임 id → 점수 */
  games?: Record<string, number>;
  /** 퀴즈 누적: 정답 수·답한 수·응답 시간 합(동점 처리·CSV) */
  quiz?: { correct: number; answered: number; totalMs: number };
  /** 참가 토큰의 해시 — 폰이 참가할 때 보낸다. 그 뒤 이 pid 로 온 명령은 토큰이 맞아야 받는다(사칭 방지, 설계서 §6-5) */
  th?: string;
}

export interface JoinAck {
  pid: string;
  ok: boolean;
  nickname?: string;
  character?: string;
  error?: string;
}

/** 폰에 보내는 상태 — 폰 화면이 실제로 쓰는 것만. 투표 수·질문 목록은 보내지 않는다. */
export interface AudienceState {
  poll: { id: string; question: string; options: Array<{ text: string }>; active: boolean } | null;
  participantCount: number;
  videoChatEnabled: boolean;
  /** 진행 중(또는 막 끝난) 게임 — 없으면 null */
  game: AudienceGame | null;
  /** 종합 순위 pid → [총점, 순위, 오른 칸] — 게임이 1판이라도 끝났을 때만(끝날 때만 바뀌어 방송이 늘지 않는다) */
  ranks?: AudienceRanks;
  acks?: JoinAck[];
}

/** 게임 결과 DB 저장 상태 — 발표자 게임 탭에 한 줄로 */
export interface ResultsDbStatus {
  state: SaveOutcome | "idle";
  unsaved: number;
  restored?: number;
}

type ChatItem = { message: string; nickname: string; id: string; timestamp: number; pid?: string };
type ReactionItem = { emoji: string; nickname: string; id: string; timestamp: number; pid?: string };

interface HostSnapshot {
  v: 1;
  savedAt: number;
  state: RoomState;
  participants: Participant[];
  pollVoters: string[];
  chats: ChatItem[];
  reactions: ReactionItem[];
  polls: Array<Record<string, unknown>>;
  game?: GameState | null;
  games?: GameRecord[];
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

type Handler = (data: unknown) => void;

const FOCUS_BUCKET_MS = 30000;
const HISTORY_MAX = 500;
// 1초 딱 맞추면 배달 지연 때문에 두 방송이 같은 1초 안에 들어온다(40명이면 82건) — 여유를 둔다.
const FLUSH_GAP_MS = 1250;
const FLUSH_BATCH_MS = 120;
const SAVE_DEBOUNCE_MS = 2000;
const JOIN_RETRY_MS = 5000;
// 발표자가 돌아왔을 때 폰들이 다시 들어오는 시간을 인원에 맞춰 흩는다(재입장 초당 약 7건 이하).
export const rejoinSpreadMs = (people: number) => Math.min(30000, Math.max(4000, people * 150));
/** 폰: host-rejoined 를 따르는 최소 간격 */
const REJOIN_MIN_GAP_MS = 30000;

const CMD_EVENTS = [
  "join-room", "leave-room", "reaction", "chat", "vote-poll",
  "submit-question", "slide-request", "video-request",
  "game-answer", "game-steps",
] as const;
const GAME_TICK_MS = 250;

const hostKey = (roomId: string) => `ll:host:${roomId}`;

function createEmptyState(): RoomState {
  return {
    poll: null,
    questions: [],
    slideRequests: { next: 0, prev: 0 },
    focusTimeline: [],
    participantCount: 0,
    reactionStats: {},
    videoChatEnabled: false,
    activeVideo: null,
  };
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** 닉네임이 겹치면 민수 → 민수(2) → 민수(3). 자기 자신(pid)은 빼고 본다. */
export function uniqueNickname(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}(${n})`;
    if (!set.has(candidate)) return candidate;
  }
}

export function useSlidesRealtime(roomId: string, role: "presenter" | "audience") {
  const handlersRef = useRef<Record<string, Handler[]>>({});
  // 참가자 ID(폰)·탭 ID(발표자)는 처음 그릴 때 한 번만 정한다(서버 렌더에선 빈 값).
  const [tabId] = useState(() =>
    role === "presenter" && typeof window !== "undefined" ? hostTabId(roomId) : uuidv4()
  );
  const [pid] = useState(() => (role === "audience" && typeof window !== "undefined" ? stablePid(roomId) : ""));
  // 폰: 참가 토큰(이 폰만 아는 비밀값). 발표자: 결과 저장 비밀값(#hk= 링크로 왔으면 그걸 저장).
  const [tok] = useState(() => (role === "audience" && typeof window !== "undefined" ? stableToken(roomId) : ""));
  const [hostSecret] = useState(() => (role === "presenter" && typeof window !== "undefined" ? loadHostKey(roomId).hk : ""));
  const tokRef = useRef(tok);
  const tabIdRef = useRef(tabId);
  const pidRef = useRef(pid);
  const publicRef = useRef<RealtimeChannel | null>(null);
  const cmdRef = useRef<RealtimeChannel | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);
  // 넘겨받기 요청(Loki 🟡1): 진행 탭에 뜨는 [거절]/[넘기기] 안내 · 요청 탭의 진행 상황
  const [takeoverPrompt, setTakeoverPrompt] = useState<TakeoverPrompt | null>(null);
  const [requestState, setRequestState] = useState<RequestState>({ phase: "idle" });
  const [hostStatus, setHostStatus] = useState<HostStatus>(
    role === "presenter" && isSupabaseConfigured ? "deciding" : "active"
  );

  // ── 발표자 상태 ──
  const stateRef = useRef(createEmptyState());
  const participantsRef = useRef(new Map<string, Participant>());
  const pollVotersRef = useRef(new Set<string>());
  const allChatsRef = useRef<ChatItem[]>([]);
  const allReactionsRef = useRef<ReactionItem[]>([]);
  const allPollsRef = useRef<Array<Record<string, unknown>>>([]);
  const gameRef = useRef<HostGame | null>(null);
  const gamesRef = useRef<GameRecord[]>([]);
  const standingsRef = useRef<Standing[]>([]);
  const ranksRef = useRef<AudienceRanks | null>(null);
  /** 토큰을 한 번 확인한 pid → 그 토큰(매번 해시하지 않게) */
  const tokOkRef = useRef(new Map<string, string>());
  /** 아직 등록 안 된 pid 가 토큰을 붙여 보냈을 때 — 그 자리에서 등록하면서 해시를 묶는다 */
  const bindTokRef = useRef<{ pid: string; tok: string } | null>(null);
  const dbRef = useRef<ResultsDbStatus>({ state: "idle", unsaved: 0 });
  const savingRef = useRef(false);
  const statusRef = useRef<HostStatus>("deciding");
  const lockRef = useRef<HostLock | null>(null);
  const bufferedRef = useRef<Array<[string, Record<string, unknown>]>>([]);
  const pendingAcksRef = useRef<JoinAck[]>([]);
  const lastAudienceJsonRef = useRef("");
  const lastFlushAtRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 참가자 상태 ──
  const myNickRef = useRef("");
  const myCharRef = useRef("");
  const ackedRef = useRef(false);
  const joinRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVoteRef = useRef<{ pollId: string; optionIndex: number } | null>(null);
  /** 마지막으로 낸 게임 답 — 발표자가 새로고침하면 그대로(같은 seq) 다시 보낸다(발표자가 중복은 버림) */
  const lastGameAnswerRef = useRef<Record<string, unknown> | null>(null);


  const on = useCallback((event: string, fn: Handler) => {
    if (!handlersRef.current[event]) handlersRef.current[event] = [];
    handlersRef.current[event].push(fn);
  }, []);

  const off = useCallback((event: string, fn: Handler) => {
    if (!handlersRef.current[event]) return;
    handlersRef.current[event] = handlersRef.current[event].filter((h) => h !== fn);
  }, []);

  const emitLocal = useCallback((event: string, data: unknown) => {
    (handlersRef.current[event] || []).forEach((fn) => fn(data));
  }, []);

  // 게임 진행에 쓰는 시계·난수 — 연출 신호는 발표 화면(GameStage)으로 바로
  const gameDepsRef = useRef({
    now: () => Date.now(),
    rng: () => Math.random(),
    onEffect: (e: GameEffect) => (handlersRef.current["game-effect"] || []).forEach((fn) => fn(e)),
  });

  // ───────────────────────── 발표자 ─────────────────────────

  const onlineCount = useCallback(() => {
    let n = 0;
    participantsRef.current.forEach((p) => { if (p.online) n++; });
    return n;
  }, []);

  // 화면(React)에는 새 배열·객체로 넘긴다 — 같은 배열을 고쳐서 넘기면 React 가 바뀐 줄 몰라 다시 그리지 않는다
  // (예: 질문 「답변 완료」가 다른 화면 갱신이 있을 때까지 안 보임).
  const fullState = useCallback((): RoomState => {
    const s = stateRef.current;
    s.participantCount = onlineCount();
    return {
      ...s,
      poll: s.poll ? { ...s.poll, options: s.poll.options.map((o) => ({ ...o })) } : null,
      questions: s.questions.map((q) => ({ ...q })),
      slideRequests: { ...s.slideRequests },
      focusTimeline: s.focusTimeline.map((b) => ({ ...b })),
      reactionStats: { ...s.reactionStats },
    };
  }, [onlineCount]);

  const audienceState = useCallback((): AudienceState => {
    const poll = stateRef.current.poll;
    return {
      poll: poll ? { id: poll.id, question: poll.question, options: poll.options.map((o) => ({ text: o.text })), active: poll.active } : null,
      participantCount: onlineCount(),
      videoChatEnabled: stateRef.current.videoChatEnabled,
      game: gameRef.current ? gameRef.current.audience() : null,
      ...(ranksRef.current ? { ranks: ranksRef.current } : {}),
    };
  }, [onlineCount]);

  const saveNow = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (role !== "presenter" || statusRef.current !== "active") return;
    const snap: HostSnapshot = {
      v: 1,
      savedAt: Date.now(),
      state: stateRef.current,
      participants: [...participantsRef.current.values()],
      pollVoters: [...pollVotersRef.current],
      chats: allChatsRef.current.slice(-HISTORY_MAX),
      reactions: allReactionsRef.current.slice(-HISTORY_MAX),
      polls: allPollsRef.current,
      game: gameRef.current?.s ?? null,
      games: gamesRef.current,
    };
    if (!writeJSON(hostKey(roomId), snap)) {
      // 용량이 모자라면 기록을 줄여서 한 번 더
      writeJSON(hostKey(roomId), { ...snap, chats: snap.chats.slice(-100), reactions: snap.reactions.slice(-100) });
    }
  }, [role, roomId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  const restore = useCallback(() => {
    const snap = readJSON<HostSnapshot>(hostKey(roomId));
    if (!snap || snap.v !== 1) return false;
    stateRef.current = { ...createEmptyState(), ...snap.state };
    participantsRef.current = new Map(
      (snap.participants || []).map((p) => [p.pid, {
        ...p,
        character: resolveCharacter(p.character, p.nickname),
        lastActive: p.lastActive || p.joinedAt,
        online: false,
      }])
    );
    pollVotersRef.current = new Set(snap.pollVoters || []);
    allChatsRef.current = snap.chats || [];
    allReactionsRef.current = snap.reactions || [];
    allPollsRef.current = snap.polls || [];
    gamesRef.current = snap.games || [];
    gameRef.current = snap.game ? new HostGame(snap.game, gameDepsRef.current) : null;
    return true;
  }, [roomId]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (statusRef.current !== "active") return;
    const aud = audienceState();
    const json = JSON.stringify(aud);
    const acks = pendingAcksRef.current;
    if (json === lastAudienceJsonRef.current && acks.length === 0) return;
    pendingAcksRef.current = [];
    lastAudienceJsonRef.current = json;
    lastFlushAtRef.current = Date.now();
    const payload: AudienceState = acks.length ? { ...aud, acks } : aud;
    countMessage("sent", "room-state");
    void publicRef.current?.send({ type: "broadcast", event: "room-state", payload });
    // 문제·달리기 시계는 폰에 실제로 나간 이 순간부터 잰다
    gameRef.current?.markBroadcast(Date.now());
  }, [audienceState]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current || statusRef.current !== "active") return;
    const wait = Math.max(FLUSH_BATCH_MS, lastFlushAtRef.current + FLUSH_GAP_MS - Date.now());
    flushTimerRef.current = setTimeout(flush, wait);
  }, [flush]);

  /** 상태가 바뀌었다 — 발표 화면은 바로, 폰은 묶어서, 저장은 2초 모아서. */
  const changed = useCallback(() => {
    emitLocal("room-state", fullState());
    scheduleFlush();
    scheduleSave();
  }, [emitLocal, fullState, scheduleFlush, scheduleSave]);

  const getFocusBucket = useCallback(() => {
    const now = Date.now();
    const key = Math.floor(now / FOCUS_BUCKET_MS) * FOCUS_BUCKET_MS;
    let bucket = stateRef.current.focusTimeline.find((b) => b.time === key);
    if (!bucket) {
      bucket = { time: key, count: 0 };
      stateRef.current.focusTimeline.push(bucket);
      if (stateRef.current.focusTimeline.length > 120) stateRef.current.focusTimeline.shift();
    }
    return bucket;
  }, []);

  const sessionData = useCallback(() => ({
    roomId,
    chats: allChatsRef.current,
    reactions: allReactionsRef.current,
    questions: stateRef.current.questions,
    polls: allPollsRef.current,
    reactionStats: stateRef.current.reactionStats,
    focusTimeline: stateRef.current.focusTimeline,
    slideRequests: stateRef.current.slideRequests,
    participantCount: onlineCount(),
    participants: [...participantsRef.current.values()],
  }), [roomId, onlineCount]);

  /** 모르는 pid 가 명령을 보내면(발표자가 기록을 잃은 사이 들어온 사람) 그 자리에서 등록한다. */
  const participantFor = useCallback((pid: string, nickname: unknown): Participant | null => {
    if (!pid) return null;
    let p = participantsRef.current.get(pid);
    if (!p) {
      const base = str(nickname, 20) || "익명";
      const names = [...participantsRef.current.values()].map((x) => x.nickname);
      const nick = uniqueNickname(base, names);
      const now = Date.now();
      p = { pid, nickname: nick, character: resolveCharacter(null, nick), joinedAt: now, lastActive: now, online: true, chats: 0, reactions: 0, questions: 0, votes: 0 };
      const b = bindTokRef.current;
      if (b && b.pid === pid) {
        p.th = sha256Hex(b.tok);
        tokOkRef.current.set(pid, b.tok);
      }
      participantsRef.current.set(pid, p);
      pendingAcksRef.current.push({ pid, ok: true, nickname: p.nickname, character: p.character });
      emitLocal("participant-joined", { participant: p, isNew: true });
    } else if (!p.online) {
      p.online = true;
      emitLocal("participant-joined", { participant: p, isNew: false });
    }
    p.lastActive = Date.now();
    return p;
  }, [emitLocal]);

  /** 활동 수가 바뀐 참가자 — 광장 캐릭터 레벨·💤 갱신용(로컬만). */
  const touched = useCallback((p: Participant | null) => {
    if (p) emitLocal("participant-update", { ...p });
  }, [emitLocal]);

  /** 발표 화면용 게임 보기 — 상태 + 지금 집계 */
  const gameView = useCallback(() => {
    const g = gameRef.current;
    if (!g) return null;
    return {
      s: JSON.parse(JSON.stringify(g.s)) as GameState,
      tally: g.tally(),
      shortOrder: g.shortOrder(),
      runBoard: g.s.type === "run" ? g.runBoard(5) : [],
    };
  }, []);

  const people = useCallback((): Person[] =>
    [...participantsRef.current.values()].map((p) => ({ pid: p.pid, nickname: p.nickname, character: p.character, joinedAt: p.joinedAt })), []);

  /** 종합 순위 다시 계산 — 게임 기록이 바뀔 때만(끝남·복원). 폰에 보낼 순위도 이때만 바뀐다. */
  const recomputeStandings = useCallback(() => {
    const rows = computeStandings(people(), gamesRef.current);
    standingsRef.current = rows;
    ranksRef.current = gamesRef.current.length ? audienceRanks(rows) : null;
    emitLocal("standings", rows);
  }, [emitLocal, people]);

  const setDb = useCallback((next: Partial<ResultsDbStatus>) => {
    dbRef.current = { ...dbRef.current, ...next, unsaved: gamesRef.current.filter((g) => !g.saved).length };
    emitLocal("results-db", { ...dbRef.current });
  }, [emitLocal]);

  /** 끝난 게임 중 DB 에 아직 안 간 것을 차례로 저장(통신이 끊겼던 것도 다음 기회에) */
  const persistResults = useCallback(async () => {
    if (savingRef.current || role !== "presenter" || !hostSecret) return;
    savingRef.current = true;
    try {
      const map = new Map(people().map((p) => [p.pid, p]));
      for (const rec of gamesRef.current) {
        if (rec.saved) continue;
        const out = await saveResult(roomId, hostSecret, toResultPayload(rec, map));
        if (out === "saved") rec.saved = true;
        setDb({ state: out });
        if (out !== "saved") break; // 꺼짐·거절·통신 실패 — 다음 게임이 끝날 때 다시
      }
      saveNow();
    } finally {
      savingRef.current = false;
    }
  }, [hostSecret, people, role, roomId, saveNow, setDb]);

  /** 기록 1판을 참가자 누적(점수·게임별·퀴즈 통계)에 더한다 — 게임이 끝날 때, DB 에서 복원할 때 */
  const addToParticipants = useCallback((rec: GameRecord) => {
    for (const [pid, pts] of Object.entries(rec.points)) {
      const p = participantsRef.current.get(pid);
      if (!p) continue;
      p.score = (p.score ?? 0) + pts;
      p.games = { ...(p.games ?? {}), [rec.id]: pts };
    }
    for (const [pid, st] of Object.entries(rec.stats ?? {})) {
      const p = participantsRef.current.get(pid);
      if (!p) continue;
      const q = p.quiz ?? { correct: 0, answered: 0, totalMs: 0 };
      p.quiz = { correct: q.correct + st.correct, answered: q.answered + st.answered, totalMs: q.totalMs + st.totalMs };
    }
  }, []);

  /** 다른 PC(발표자 링크)나 기록을 잃은 브라우저 — DB 에 있는 끝난 게임으로 종합 순위를 되살린다 */
  const restoreFromDb = useCallback(async () => {
    if (role !== "presenter" || !hostSecret) return;
    const rows = await loadResults(roomId, hostSecret);
    if (!rows || statusRef.current !== "active") return;
    const { games, people: dbPeople } = fromResultPayloads(rows);
    const known = new Set(gamesRef.current.map((g) => g.id));
    const inDb = new Set(games.map((g) => g.id));
    gamesRef.current = gamesRef.current.map((g) => (inDb.has(g.id) && !g.saved ? { ...g, saved: true } : g));
    const added = games.filter((g) => !known.has(g.id));
    if (added.length) {
      for (const person of dbPeople) {
        if (participantsRef.current.has(person.pid)) continue;
        participantsRef.current.set(person.pid, {
          pid: person.pid, nickname: person.nickname, character: resolveCharacter(person.character, person.nickname),
          joinedAt: person.joinedAt, lastActive: person.joinedAt, online: false,
          chats: 0, reactions: 0, questions: 0, votes: 0,
        });
      }
      for (const g of added) addToParticipants(g);
      gamesRef.current = [...gamesRef.current, ...added].sort((a, b) => a.endedAt - b.endedAt);
      recomputeStandings();
      emitLocal("participants", [...participantsRef.current.values()].map((x) => ({ ...x })));
      emitLocal("games", [...gamesRef.current]);
      changed();
    }
    setDb({ state: "saved", restored: added.length });
    void persistResults();
  }, [addToParticipants, changed, emitLocal, hostSecret, persistResults, recomputeStandings, role, roomId, setDb]);

  /** 게임이 끝나면 한 번만: 참가자 누적 점수·게임별 점수·퀴즈 통계에 더하고 기록을 남긴다. */
  const recordIfFinished = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.s.phase !== "finished" || gamesRef.current.some((r) => r.id === g.s.id)) return;
    const s = g.s;
    const rec: GameRecord = {
      id: s.id, type: s.type, title: s.title, mode: s.mode, startedAt: s.startedAt, endedAt: s.endedAt ?? Date.now(),
      points: { ...s.points }, winners: [...s.winners], players: [...s.players],
      stats: JSON.parse(JSON.stringify(s.stats)), log: [...(s.log ?? [])], saved: false,
    };
    gamesRef.current.push(rec);
    addToParticipants(rec);
    recomputeStandings();
    emitLocal("game-recorded", rec);
    emitLocal("participants", [...participantsRef.current.values()].map((x) => ({ ...x })));
    void persistResults();
  }, [addToParticipants, emitLocal, persistResults, recomputeStandings]);

  const gameChanged = useCallback(() => {
    recordIfFinished();
    emitLocal("game", gameView());
    changed();
  }, [changed, emitLocal, gameView, recordIfFinished]);

  const handleGame = useCallback((event: string, payload: Record<string, unknown>, pid: string) => {
    const now = Date.now();
    const deps = gameDepsRef.current;
    const g = gameRef.current;
    const active = g && g.s.phase !== "finished";

    // 폰에서 온 것
    if (event === "game-answer" || event === "game-steps") {
      if (!g || !active) return;
      const p = participantFor(pid, payload.nickname);
      if (!p) return;
      const ok = event === "game-answer" ? g.answer(pid, payload, now) : g.steps(pid, payload, now) > 0;
      if (ok) gameChanged();
      return;
    }

    // 발표자 버튼
    const id = uuidv4().slice(0, 8);
    switch (event) {
      case "game-start-quiz": {
        if (active) return;
        const qs = (payload.questions as QuizQuestion[]) || [];
        if (!qs.length) return;
        gameRef.current = HostGame.quiz(deps, id, String(payload.title || "퀴즈").slice(0, 40), qs, payload.mode === "survival" ? "survival" : "score");
        break;
      }
      case "game-start-rps":
        if (active) return;
        gameRef.current = HostGame.rps(deps, id);
        gameRef.current.rpsOpen();
        break;
      case "game-start-run":
        if (active) return;
        gameRef.current = HostGame.run(deps, id, Number(payload.goal) || 50, Number(payload.limitSec) || 60, Math.max(1, onlineCount()));
        break;
      case "game-open":
        if (!g) return;
        if (g.s.type === "quiz") g.openQuestion(); else if (g.s.type === "rps") g.rpsOpen();
        break;
      case "game-close":
        g?.closeQuestion();
        break;
      case "game-reveal":
        if (!g) return;
        if (g.s.type === "quiz") g.reveal();
        else if (g.s.type === "rps") g.rpsReveal(payload.hand === "가위" || payload.hand === "바위" || payload.hand === "보" ? payload.hand : "random");
        break;
      case "game-next":
        g?.next();
        break;
      case "game-go":
        g?.runStart();
        break;
      case "game-finish":
        g?.finish();
        break;
      case "game-dismiss":
        if (g && g.s.phase !== "finished") g.finish();
        recordIfFinished();
        gameRef.current = null;
        break;
      default:
        return;
    }
    // 새 게임 — 발표자가 게임 탭에서 바꾼 점수 규칙(이 게임 상태에 같이 저장된다)
    if (event.startsWith("game-start-") && gameRef.current && gameRef.current !== g) {
      gameRef.current.s.rules = sanitizeRules(payload.rules);
    }
    gameChanged();
  }, [gameChanged, onlineCount, participantFor, recordIfFinished]);

  /**
   * 폰에서 온 명령이 진짜 그 pid 의 폰에서 왔나(설계서 §6-5). 참가 때 받은 토큰 해시(th)가 있으면
   * 이후 명령의 토큰(tok)이 맞아야 한다. 참가는 같은 해시여야 — 남의 pid 로 이름·캐릭터를 바꾸지 못하게.
   * 토큰 없이 만들어진 예전 기록(업데이트 전 폰)은 처음 온 토큰으로 묶는다.
   */
  const authorize = useCallback((event: string, pid: string, payload: Record<string, unknown>): boolean => {
    bindTokRef.current = null;
    const p = participantsRef.current.get(pid);
    if (event === "join-room") {
      const th = str(payload.th, 64);
      return !p?.th || th === p.th;
    }
    const tok = str(payload.tok, 64);
    if (!p) {
      if (tok) bindTokRef.current = { pid, tok };
      return true;
    }
    if (!p.th) {
      if (/^[0-9a-f]{32}$/.test(tok)) {
        p.th = sha256Hex(tok);
        tokOkRef.current.set(pid, tok);
      }
      return true;
    }
    if (!tok) return false;
    if (tokOkRef.current.get(pid) === tok) return true;
    if (sha256Hex(tok) !== p.th) return false;
    tokOkRef.current.set(pid, tok);
    return true;
  }, []);

  const handleCommand = useCallback(
    (event: string, payload: Record<string, unknown>, fromPhone = false) => {
      const state = stateRef.current;
      const pid = str(payload.peerId ?? payload.pid, 64);
      if (fromPhone && pid && !authorize(event, pid, payload)) {
        countMessage("recv", "token-mismatch");
        return;
      }

      if (event === "join-room") {
        const nickname = str(payload.nickname, 20);
        if (!pid) return;
        if (!nickname) {
          pendingAcksRef.current.push({ pid, ok: false, error: "닉네임을 입력해주세요." });
          scheduleFlush();
          return;
        }
        const existing = participantsRef.current.get(pid);
        const others = [...participantsRef.current.values()].filter((x) => x.pid !== pid).map((x) => x.nickname);
        const now = Date.now();
        const th = /^[0-9a-f]{64}$/.test(str(payload.th, 64)) ? str(payload.th, 64) : undefined;
        if (existing) {
          if (!existing.th && th) existing.th = th;
          // 같은 폰이 다시 들어옴 — 이름을 바꾼 게 아니면 그대로(민수(2)는 민수(2)로)
          const sameBase = existing.nickname === nickname || existing.nickname.replace(/\(\d+\)$/, "") === nickname;
          if (!sameBase) existing.nickname = uniqueNickname(nickname, others);
          if (payload.character) existing.character = resolveCharacter(payload.character, existing.nickname);
          existing.online = true;
          existing.lastActive = now;
        } else {
          const nick = uniqueNickname(nickname, others);
          participantsRef.current.set(pid, {
            pid, nickname: nick, character: resolveCharacter(payload.character, nick),
            joinedAt: now, lastActive: now, online: true,
            chats: 0, reactions: 0, questions: 0, votes: 0, th,
          });
        }
        const p = participantsRef.current.get(pid)!;
        pendingAcksRef.current = pendingAcksRef.current.filter((a) => a.pid !== pid);
        pendingAcksRef.current.push({ pid, ok: true, nickname: p.nickname, character: p.character });
        emitLocal("participant-joined", { participant: { ...p }, isNew: !existing });
        changed();
        return;
      }

      if (event === "leave-room") {
        const p = participantsRef.current.get(pid);
        if (p) {
          p.online = false;
          emitLocal("participant-left", { ...p });
        }
        changed();
        return;
      }

      if (event === "reaction") {
        const emoji = str(payload.emoji, 8);
        if (!emoji) return;
        const p = participantFor(pid, payload.nickname);
        if (p) p.reactions += 1;
        touched(p);
        state.reactionStats[emoji] = (state.reactionStats[emoji] || 0) + 1;
        getFocusBucket().count += 1;
        const item: ReactionItem = { emoji, nickname: p?.nickname ?? (str(payload.nickname, 20) || "익명"), id: uuidv4(), timestamp: Date.now(), pid };
        allReactionsRef.current.push(item);
        if (allReactionsRef.current.length > HISTORY_MAX * 2) allReactionsRef.current.splice(0, HISTORY_MAX);
        emitLocal("reaction", item);
        emitLocal("reaction-stats", { ...state.reactionStats });
        emitLocal("focus-update", [...state.focusTimeline]);
        scheduleSave();
        return;
      }

      if (event === "chat") {
        const message = str(payload.message, 200);
        if (!message) return;
        const p = participantFor(pid, payload.nickname);
        if (p) p.chats += 1;
        touched(p);
        const item: ChatItem = { message, nickname: p?.nickname ?? (str(payload.nickname, 20) || "익명"), id: uuidv4(), timestamp: Date.now(), pid };
        allChatsRef.current.push(item);
        if (allChatsRef.current.length > HISTORY_MAX * 2) allChatsRef.current.splice(0, HISTORY_MAX);
        emitLocal("chat", item);
        scheduleSave();
        return;
      }

      if (event === "create-poll") {
        const question = str(payload.question, 100);
        const options = ((payload.options as string[]) || []).map((t) => str(t, 50)).filter(Boolean).slice(0, 6);
        if (!question || options.length < 2) return;
        pollVotersRef.current = new Set();
        state.poll = { id: uuidv4(), question, options: options.map((text) => ({ text, votes: 0 })), active: true };
        changed();
        return;
      }

      if (event === "close-poll") {
        if (state.poll) {
          allPollsRef.current.push({ id: state.poll.id, question: state.poll.question, options: state.poll.options, closedAt: Date.now() });
          state.poll = { ...state.poll, active: false };
        }
        changed();
        return;
      }

      if (event === "vote-poll") {
        const optionIndex = Number(payload.optionIndex);
        if (!state.poll?.active || !pid || pollVotersRef.current.has(pid)) return;
        if (payload.pollId && payload.pollId !== state.poll.id) return; // 지난 투표에 대한 늦은 표
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= state.poll.options.length) return;
        pollVotersRef.current.add(pid);
        const p = participantFor(pid, payload.nickname);
        if (p) p.votes += 1;
        touched(p);
        state.poll = { ...state.poll, options: state.poll.options.map((o, i) => (i === optionIndex ? { ...o, votes: o.votes + 1 } : o)) };
        changed(); // 폰 상태는 그대로라 방송은 안 나간다(flush 가 같은 내용이면 건너뜀)
        return;
      }

      if (event === "submit-question") {
        const text = str(payload.text, 300);
        if (!text) return;
        const p = participantFor(pid, payload.nickname);
        if (p) p.questions += 1;
        touched(p);
        state.questions.push({ id: uuidv4(), text, nickname: p?.nickname ?? (str(payload.nickname, 20) || "익명"), timestamp: Date.now(), answered: false });
        if (p) emitLocal("question", { pid, nickname: p.nickname });
        changed();
        return;
      }

      if (event === "resolve-question") {
        const q = state.questions.find((x) => x.id === payload.questionId);
        if (q) q.answered = true;
        changed();
        return;
      }

      if (event === "slide-request") {
        const direction = payload.direction;
        if (direction === "next") state.slideRequests.next += 1;
        else if (direction === "prev") state.slideRequests.prev += 1;
        else return;
        emitLocal("slide-request-update", { ...state.slideRequests });
        scheduleSave();
        return;
      }

      if (event === "reset-slide-requests") {
        state.slideRequests = { next: 0, prev: 0 };
        emitLocal("slide-request-update", { ...state.slideRequests });
        scheduleSave();
        return;
      }

      if (event === "toggle-video-chat") {
        state.videoChatEnabled = !state.videoChatEnabled;
        if (!state.videoChatEnabled) state.activeVideo = null;
        changed();
        return;
      }

      if (event === "video-request") {
        if (!state.videoChatEnabled) return;
        const url = str(payload.url, 300);
        const start = Math.max(0, Number(payload.start) || 0);
        const end = Math.max(0, Number(payload.end) || 0);
        const videoId = extractYouTubeId(url);
        if (!videoId) return;
        const p = participantFor(pid, payload.nickname);
        state.activeVideo = { videoId, url, start, end, nickname: p?.nickname ?? (str(payload.nickname, 20) || "익명") };
        changed();
        return;
      }

      if (event === "clear-video") {
        state.activeVideo = null;
        changed();
        return;
      }

      // ───── 게임 (설계서 §4) — 판정은 발표자 브라우저만 ─────
      if (event.startsWith("game-")) handleGame(event, payload, pid);
    },
    [authorize, changed, emitLocal, getFocusBucket, participantFor, scheduleFlush, scheduleSave, touched, handleGame]
  );

  // ───────────────────────── 참가자 ─────────────────────────

  const audienceSend = useCallback(async (event: string, raw: Record<string, unknown>, retries = 2) => {
    const ch = cmdRef.current;
    if (!ch) return false;
    // 참가 땐 토큰의 해시만, 그 뒤 모든 명령엔 토큰을 붙인다(발표자가 해시로 확인 — 남의 pid 사칭 방지)
    const payload = event === "join-room" ? raw : { ...raw, tok: tokRef.current };
    for (let attempt = 0; attempt <= retries; attempt++) {
      countMessage("sent", event);
      try {
        await ch.httpSend(event, payload);
        return true;
      } catch {
        if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
      }
    }
    return false;
  }, []);

  const sendJoin = useCallback(() => {
    if (!myNickRef.current) return;
    void audienceSend("join-room", { pid: pidRef.current, nickname: myNickRef.current, character: myCharRef.current || undefined, th: sha256Hex(tokRef.current) });
  }, [audienceSend]);

  const startJoinRetry = useCallback(() => {
    if (joinRetryRef.current) clearInterval(joinRetryRef.current);
    joinRetryRef.current = setInterval(() => {
      if (ackedRef.current) {
        if (joinRetryRef.current) clearInterval(joinRetryRef.current);
        joinRetryRef.current = null;
        return;
      }
      sendJoin();
    }, JOIN_RETRY_MS);
  }, [sendJoin]);

  // ───────────────────────── 연결 ─────────────────────────

  useEffect(() => {
    if (!roomId) return;
    let disposed = false;

    if (!isSupabaseConfigured || !supabase) {
      // 실시간 서버 없이 혼자 — 처음부터 ready·active 로 시작한다(아래 useState 초기값)
      statusRef.current = "active";
      if (role === "presenter") emitLocal("room-state", fullState());
      return;
    }
    const sb = supabase;

    if (role === "presenter") {
      const publicCh = sb.channel(`slides-room:${roomId}`, { config: { broadcast: { self: false } } });
      const cmdCh = sb.channel(`slides-cmd:${roomId}`, {
        config: { broadcast: { self: false }, presence: { key: tabIdRef.current } },
      });
      publicRef.current = publicCh;
      cmdRef.current = cmdCh;

      const becomeActive = () => {
        restore();
        recomputeStandings();
        lastAudienceJsonRef.current = "";
        const buffered = bufferedRef.current;
        bufferedRef.current = [];
        buffered.forEach(([e, p]) => handleCommand(e, p, true));
        // 폰들에게 "발표자 돌아왔다" — 저장해 둔 pid·닉네임으로 다시 들어오고, 못 받은 표를 다시 보낸다.
        // 이것도 전원 방송 1회라, 다음 상태 방송은 1초 뒤로 민다(전원 방송은 초당 1회까지).
        countMessage("sent", "host-rejoined");
        void publicCh.send({
          type: "broadcast",
          event: "host-rejoined",
          payload: { at: Date.now(), spreadMs: rejoinSpreadMs(participantsRef.current.size) },
        });
        lastFlushAtRef.current = Date.now();
        changed();
        emitLocal("slide-request-update", { ...stateRef.current.slideRequests });
        emitLocal("reaction-stats", { ...stateRef.current.reactionStats });
        emitLocal("history", { chats: allChatsRef.current, reactions: allReactionsRef.current });
        emitLocal("participants", [...participantsRef.current.values()].map((x) => ({ ...x })));
        emitLocal("games", [...gamesRef.current]);
        emitLocal("game", gameView());
        // 다른 PC 에서 발표자 링크로 열었으면 DB 에서 순위 복원, 못 보낸 결과는 다시 저장
        void restoreFromDb();
      };

      // 게임 시계: 마감·카운트·골인 뒤 결과처럼 시간으로 넘어가는 것
      const gameTimer = setInterval(() => {
        const g = gameRef.current;
        if (!g || statusRef.current !== "active") return;
        if (g.tick(Date.now())) gameChanged();
      }, GAME_TICK_MS);

      const lock = new HostLock(roomId, tabIdRef.current, {
        onStatus: (s) => {
          statusRef.current = s;
          setHostStatus(s);
          if (s === "active") becomeActive();
          else if (s === "standby") bufferedRef.current = [];
        },
        onDemote: () => saveNow(),
        onPrompt: (p) => setTakeoverPrompt(p),
        onRequest: (r) => setRequestState(r),
      });
      lockRef.current = lock;
      lock.attach(cmdCh);

      CMD_EVENTS.forEach((event) => {
        cmdCh.on("broadcast", { event }, ({ payload }) => {
          countMessage("recv", event);
          const p = (payload || {}) as Record<string, unknown>;
          if (statusRef.current === "active") handleCommand(event, p, true);
          else if (statusRef.current === "deciding" && bufferedRef.current.length < 2000) bufferedRef.current.push([event, p]);
        });
      });

      let subscribed = 0;
      const onSub = (status: string) => {
        if (status !== "SUBSCRIBED" || disposed) return;
        subscribed++;
        if (subscribed === 2) {
          setReady(true);
          lock.start();
        }
      };
      publicCh.subscribe(onSub);
      cmdCh.subscribe(onSub);

      const onHide = () => saveNow();
      window.addEventListener("pagehide", onHide);

      return () => {
        disposed = true;
        clearInterval(gameTimer);
        window.removeEventListener("pagehide", onHide);
        saveNow();
        lock.dispose();
        lockRef.current = null;
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
        void sb.removeChannel(publicCh);
        void sb.removeChannel(cmdCh);
        publicRef.current = null;
        cmdRef.current = null;
        statusRef.current = "deciding";
      };
    }

    // audience
    const publicCh = sb.channel(`slides-room:${roomId}`, { config: { broadcast: { self: false } } });
    const cmdCh = sb.channel(`slides-cmd:${roomId}`); // 구독하지 않는다 — httpSend 전용
    publicRef.current = publicCh;
    cmdRef.current = cmdCh;
    const pid = pidRef.current;

    publicCh.on("broadcast", { event: "room-state" }, ({ payload }) => {
      countMessage("recv", "room-state");
      const s = (payload || {}) as AudienceState;
      const mine = s.acks?.find((a) => a.pid === pid);
      if (mine) {
        if (mine.ok) {
          ackedRef.current = true;
          if (mine.nickname) myNickRef.current = mine.nickname;
        }
        emitLocal("join-ack", mine);
      }
      emitLocal("room-state", s);
    });
    // host-rejoined 는 공용 채널이라 누구나 보낼 수 있다(Loki 🟢2) — 폰은 최소 4초에 흩고, 30초에 한 번만 따른다.
    // 30초 안에 또 오면 버리지 않고 "지난번 + 30초" 이후로 미룬다(강사가 연달아 새로고침해도 결국 다시 붙는다).
    let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRejoinAt = 0;
    publicCh.on("broadcast", { event: "host-rejoined" }, ({ payload }) => {
      countMessage("recv", "host-rejoined");
      const spread = Math.min(30000, Math.max(4000, Number((payload as { spreadMs?: number })?.spreadMs) || 4000));
      if (!myNickRef.current || rejoinTimer) return;
      const now = Date.now();
      const wait = Math.max(Math.random() * spread, lastRejoinAt + REJOIN_MIN_GAP_MS - now);
      lastRejoinAt = now + wait;
      rejoinTimer = setTimeout(() => {
        rejoinTimer = null;
        if (disposed) return;
        ackedRef.current = false;
        sendJoin();
        const v = lastVoteRef.current;
        if (v) void audienceSend("vote-poll", { pid, nickname: myNickRef.current, ...v });
        const a = lastGameAnswerRef.current;
        if (a) void audienceSend("game-answer", a);
        startJoinRetry();
      }, wait);
    });
    publicCh.subscribe((status) => {
      if (status === "SUBSCRIBED" && !disposed) setReady(true);
    });

    const leave = () => {
      if (!myNickRef.current) return;
      leaveBeacon(roomId, pid, tokRef.current);
    };
    window.addEventListener("pagehide", leave);

    return () => {
      disposed = true;
      if (rejoinTimer) clearTimeout(rejoinTimer);
      window.removeEventListener("pagehide", leave);
      leave();
      if (joinRetryRef.current) clearInterval(joinRetryRef.current);
      joinRetryRef.current = null;
      void sb.removeChannel(publicCh);
      void sb.removeChannel(cmdCh);
      publicRef.current = null;
      cmdRef.current = null;
    };
  }, [roomId, role, audienceSend, changed, emitLocal, fullState, gameChanged, gameView, handleCommand, recomputeStandings, restore, restoreFromDb, saveNow, sendJoin, startJoinRetry]);

  const emit = useCallback(
    async (event: string, data?: unknown, callback?: (res: unknown) => void) => {
      const payload = typeof data === "object" && data !== null ? { ...(data as Record<string, unknown>) } : {};

      if (role === "presenter") {
        if (statusRef.current !== "active") return;
        if (event === "presenter-join") {
          // 화면이 듣기 시작한 뒤 — 지금 상태와 기록을 한 번 더 내려준다.
          lastAudienceJsonRef.current = "";
          changed();
          emitLocal("slide-request-update", { ...stateRef.current.slideRequests });
          emitLocal("reaction-stats", { ...stateRef.current.reactionStats });
          emitLocal("history", { chats: allChatsRef.current, reactions: allReactionsRef.current });
          emitLocal("participants", [...participantsRef.current.values()].map((x) => ({ ...x })));
          emitLocal("games", [...gamesRef.current]);
          emitLocal("game", gameView());
          emitLocal("standings", standingsRef.current);
          emitLocal("results-db", { ...dbRef.current });
          return;
        }
        if (event === "get-session-data") {
          callback?.(sessionData());
          return;
        }
        handleCommand(event, { ...payload, peerId: tabIdRef.current });
        return;
      }

      // audience
      const pid = pidRef.current;
      if (event === "join-room") {
        const nickname = str(payload.nickname, 20);
        myNickRef.current = nickname;
        myCharRef.current = str(payload.character, 40);
        ackedRef.current = false;
        if (callback) {
          const once: Handler = (res) => {
            off("join-ack", once);
            callback(res);
          };
          on("join-ack", once);
        }
        sendJoin();
        startJoinRetry();
        return;
      }
      if (event === "get-session-data") return;
      if (event === "vote-poll") {
        lastVoteRef.current = { pollId: String(payload.pollId || ""), optionIndex: Number(payload.optionIndex) };
      }
      // 폰 위쪽 Lv — 내가 보낸 활동을 폰이 직접 센다(발표자에게 물으면 방송이 늘어난다)
      const actField = event === "chat" ? "chats" : event === "reaction" ? "reactions" : event === "submit-question" ? "questions" : event === "vote-poll" ? "votes" : null;
      if (actField) emitLocal("my-activity", bumpMyActivity(roomId, actField));
      if (event === "game-answer" || event === "game-steps") {
        // seq 는 시각(ms) — 폰을 새로고침해도 늘 커진다
        const msg = { ...payload, pid, nickname: myNickRef.current, seq: Date.now() };
        if (event === "game-answer") lastGameAnswerRef.current = msg;
        return audienceSend(event, msg, event === "game-answer" ? 3 : 2);
      }
      const important = event !== "chat" && event !== "reaction";
      await audienceSend(event, { ...payload, pid, nickname: myNickRef.current || payload.nickname }, important ? 3 : 1);
    },
    [role, roomId, audienceSend, changed, emitLocal, gameView, handleCommand, off, on, sendJoin, sessionData, startJoinRetry]
  );

  const setInitialState = useCallback((state: Partial<RoomState>) => {
    // 저장해 둔 발표자 상태가 있으면 그게 더 최신이다 — 빈 값으로 덮지 않는다.
    if (readJSON(hostKey(roomId))) return;
    stateRef.current = { ...stateRef.current, ...state };
  }, [roomId]);

  /** [여기서 진행 요청] — 진행 중인 탭이 거절하지 않으면 넘겨받는다(넘겨받으면 becomeActive 가 앞 탭이 막 저장한 상태를 읽는다) */
  const takeover = useCallback(() => {
    lockRef.current?.requestTakeover();
  }, []);
  /** 진행 탭: 넘겨받기 요청에 답 */
  const answerTakeover = useCallback((ok: boolean) => {
    lockRef.current?.answerTakeover(ok);
  }, []);

  /** 결과 내보내기(CSV)·순위판용 — 지금 기록 그대로 */
  const getResults = useCallback(() => ({
    standings: standingsRef.current,
    games: [...gamesRef.current],
    participants: [...participantsRef.current.values()].map((p) => ({ ...p })),
  }), []);

  return {
    on, off, emit, ready, setInitialState,
    clientId: role === "audience" ? pid : tabId,
    hostStatus, takeover, takeoverPrompt, requestState, answerTakeover,
    getResults,
    /** 발표자 비밀값(🔑 발표자 링크 복사용) — 폰에선 빈 값 */
    hostSecret,
  };
}

/** 창을 닫을 때 — fetch keepalive 로 퇴장 알림(실패해도 그만). */
function leaveBeacon(roomId: string, pid: string, tok: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  countMessage("sent", "leave-room");
  try {
    void fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `slides-cmd:${roomId}`, event: "leave-room", payload: { pid, tok }, private: false }] }),
    }).catch(() => {});
  } catch { /* 무시 */ }
}
