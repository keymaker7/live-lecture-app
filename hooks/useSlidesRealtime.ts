"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";
import { HostLock, type HostStatus } from "@/lib/realtime/host-lock";
import { countMessage } from "@/lib/realtime/stats";
import { hostTabId, readJSON, stablePid, writeJSON } from "@/lib/realtime/storage";

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
  joinedAt: number;
  online: boolean;
  chats: number;
  reactions: number;
  questions: number;
  votes: number;
}

export interface JoinAck {
  pid: string;
  ok: boolean;
  nickname?: string;
  error?: string;
}

/** 폰에 보내는 상태 — 폰 화면이 실제로 쓰는 것만. 투표 수·질문 목록은 보내지 않는다. */
export interface AudienceState {
  poll: { id: string; question: string; options: Array<{ text: string }>; active: boolean } | null;
  participantCount: number;
  videoChatEnabled: boolean;
  acks?: JoinAck[];
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
const REJOIN_SPREAD_MS = 4000;

const CMD_EVENTS = [
  "join-room", "leave-room", "reaction", "chat", "vote-poll",
  "submit-question", "slide-request", "video-request",
] as const;

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
  const tabIdRef = useRef(tabId);
  const pidRef = useRef(pid);
  const publicRef = useRef<RealtimeChannel | null>(null);
  const cmdRef = useRef<RealtimeChannel | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);
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
  const ackedRef = useRef(false);
  const joinRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVoteRef = useRef<{ pollId: string; optionIndex: number } | null>(null);


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
      (snap.participants || []).map((p) => [p.pid, { ...p, online: false }])
    );
    pollVotersRef.current = new Set(snap.pollVoters || []);
    allChatsRef.current = snap.chats || [];
    allReactionsRef.current = snap.reactions || [];
    allPollsRef.current = snap.polls || [];
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
      p = { pid, nickname: uniqueNickname(base, names), joinedAt: Date.now(), online: true, chats: 0, reactions: 0, questions: 0, votes: 0 };
      participantsRef.current.set(pid, p);
      pendingAcksRef.current.push({ pid, ok: true, nickname: p.nickname });
    } else if (!p.online) {
      p.online = true;
    }
    return p;
  }, []);

  const handleCommand = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      const state = stateRef.current;
      const pid = str(payload.peerId ?? payload.pid, 64);

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
        if (existing) {
          // 같은 폰이 다시 들어옴 — 이름을 바꾼 게 아니면 그대로(민수(2)는 민수(2)로)
          const sameBase = existing.nickname === nickname || existing.nickname.replace(/\(\d+\)$/, "") === nickname;
          if (!sameBase) existing.nickname = uniqueNickname(nickname, others);
          existing.online = true;
        } else {
          participantsRef.current.set(pid, {
            pid, nickname: uniqueNickname(nickname, others), joinedAt: Date.now(), online: true,
            chats: 0, reactions: 0, questions: 0, votes: 0,
          });
        }
        const p = participantsRef.current.get(pid)!;
        pendingAcksRef.current = pendingAcksRef.current.filter((a) => a.pid !== pid);
        pendingAcksRef.current.push({ pid, ok: true, nickname: p.nickname });
        emitLocal("participant-joined", p);
        changed();
        return;
      }

      if (event === "leave-room") {
        const p = participantsRef.current.get(pid);
        if (p) p.online = false;
        changed();
        return;
      }

      if (event === "reaction") {
        const emoji = str(payload.emoji, 8);
        if (!emoji) return;
        const p = participantFor(pid, payload.nickname);
        if (p) p.reactions += 1;
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
        state.poll = { ...state.poll, options: state.poll.options.map((o, i) => (i === optionIndex ? { ...o, votes: o.votes + 1 } : o)) };
        changed(); // 폰 상태는 그대로라 방송은 안 나간다(flush 가 같은 내용이면 건너뜀)
        return;
      }

      if (event === "submit-question") {
        const text = str(payload.text, 300);
        if (!text) return;
        const p = participantFor(pid, payload.nickname);
        if (p) p.questions += 1;
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
    },
    [changed, emitLocal, getFocusBucket, participantFor, scheduleFlush, scheduleSave]
  );

  // ───────────────────────── 참가자 ─────────────────────────

  const audienceSend = useCallback(async (event: string, payload: Record<string, unknown>, retries = 2) => {
    const ch = cmdRef.current;
    if (!ch) return false;
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
    void audienceSend("join-room", { pid: pidRef.current, nickname: myNickRef.current });
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
        lastAudienceJsonRef.current = "";
        const buffered = bufferedRef.current;
        bufferedRef.current = [];
        buffered.forEach(([e, p]) => handleCommand(e, p));
        // 폰들에게 "발표자 돌아왔다" — 저장해 둔 pid·닉네임으로 다시 들어오고, 못 받은 표를 다시 보낸다.
        // 이것도 전원 방송 1회라, 다음 상태 방송은 1초 뒤로 민다(전원 방송은 초당 1회까지).
        countMessage("sent", "host-rejoined");
        void publicCh.send({ type: "broadcast", event: "host-rejoined", payload: { at: Date.now() } });
        lastFlushAtRef.current = Date.now();
        changed();
        emitLocal("slide-request-update", { ...stateRef.current.slideRequests });
        emitLocal("reaction-stats", { ...stateRef.current.reactionStats });
        emitLocal("history", { chats: allChatsRef.current, reactions: allReactionsRef.current });
      };

      const lock = new HostLock(roomId, tabIdRef.current, {
        onStatus: (s) => {
          statusRef.current = s;
          setHostStatus(s);
          if (s === "active") becomeActive();
          else if (s === "standby") bufferedRef.current = [];
        },
        onDemote: () => saveNow(),
      });
      lockRef.current = lock;
      lock.attach(cmdCh);

      CMD_EVENTS.forEach((event) => {
        cmdCh.on("broadcast", { event }, ({ payload }) => {
          countMessage("recv", event);
          const p = (payload || {}) as Record<string, unknown>;
          if (statusRef.current === "active") handleCommand(event, p);
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
    publicCh.on("broadcast", { event: "host-rejoined" }, () => {
      countMessage("recv", "host-rejoined");
      if (!myNickRef.current) return;
      ackedRef.current = false;
      // 40명이 한꺼번에 몰리지 않게 0~4초 흩어서(재입장 초당 약 10건)
      setTimeout(() => {
        sendJoin();
        const v = lastVoteRef.current;
        if (v) void audienceSend("vote-poll", { pid, nickname: myNickRef.current, ...v });
      }, Math.random() * REJOIN_SPREAD_MS);
      startJoinRetry();
    });
    publicCh.subscribe((status) => {
      if (status === "SUBSCRIBED" && !disposed) setReady(true);
    });

    const leave = () => {
      if (!myNickRef.current) return;
      leaveBeacon(roomId, pid);
    };
    window.addEventListener("pagehide", leave);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", leave);
      leave();
      if (joinRetryRef.current) clearInterval(joinRetryRef.current);
      joinRetryRef.current = null;
      void sb.removeChannel(publicCh);
      void sb.removeChannel(cmdCh);
      publicRef.current = null;
      cmdRef.current = null;
    };
  }, [roomId, role, audienceSend, changed, emitLocal, fullState, handleCommand, restore, saveNow, sendJoin, startJoinRetry]);

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
      const important = event !== "chat" && event !== "reaction";
      await audienceSend(event, { ...payload, pid, nickname: myNickRef.current || payload.nickname }, important ? 3 : 1);
    },
    [role, audienceSend, changed, emitLocal, handleCommand, off, on, sendJoin, sessionData, startJoinRetry]
  );

  const setInitialState = useCallback((state: Partial<RoomState>) => {
    // 저장해 둔 발표자 상태가 있으면 그게 더 최신이다 — 빈 값으로 덮지 않는다.
    if (readJSON(hostKey(roomId))) return;
    stateRef.current = { ...stateRef.current, ...state };
  }, [roomId]);

  const takeover = useCallback(async () => {
    const lock = lockRef.current;
    if (!lock) return;
    await lock.takeover(); // 넘겨받으면 becomeActive 가 앞 탭이 막 저장한 상태를 읽는다
  }, []);

  return {
    on, off, emit, ready, setInitialState,
    clientId: role === "audience" ? pid : tabId,
    hostStatus, takeover,
  };
}

/** 창을 닫을 때 — fetch keepalive 로 퇴장 알림(실패해도 그만). */
function leaveBeacon(roomId: string, pid: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  countMessage("sent", "leave-room");
  try {
    void fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `slides-cmd:${roomId}`, event: "leave-room", payload: { pid }, private: false }] }),
    }).catch(() => {});
  } catch { /* 무시 */ }
}
