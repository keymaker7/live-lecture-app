"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";

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
}

type Handler = (data: unknown) => void;

const FOCUS_BUCKET_MS = 30000;

function createEmptyState(): RoomState {
  return {
    poll: null,
    questions: [],
    slideRequests: { next: 0, prev: 0 },
    focusTimeline: [],
    participantCount: 0,
    reactionStats: {},
  };
}

export function useSlidesRealtime(roomId: string, role: "presenter" | "audience") {
  const handlersRef = useRef<Record<string, Handler[]>>({});
  const clientIdRef = useRef(uuidv4());
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const stateRef = useRef(createEmptyState());
  const participantsRef = useRef(new Map<string, string>());
  const pollVotersRef = useRef(new Set<string>());
  const allChatsRef = useRef<Array<{ message: string; nickname: string; id: string; timestamp: number }>>([]);
  const allReactionsRef = useRef<Array<{ emoji: string; nickname: string; id: string; timestamp: number }>>([]);
  const allPollsRef = useRef<Array<Record<string, unknown>>>([]);
  const [ready, setReady] = useState(false);

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

  const broadcastState = useCallback(async () => {
    const state = { ...stateRef.current, participantCount: participantsRef.current.size };
    stateRef.current.participantCount = state.participantCount;
    emitLocal("room-state", state);
    if (channelRef.current) {
      await channelRef.current.send({
        type: "broadcast",
        event: "room-state",
        payload: state,
      });
    }
  }, [emitLocal]);

  const broadcast = useCallback(async (event: string, payload: unknown) => {
    emitLocal(event, payload);
    if (channelRef.current) {
      await channelRef.current.send({ type: "broadcast", event, payload });
    }
  }, [emitLocal]);

  const handlePresenterCommand = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const state = stateRef.current;

      if (event === "join-room") {
        const nickname = String(payload.nickname || "").trim().slice(0, 20);
        const peerId = String(payload.peerId || "");
        if (!nickname) {
          await broadcast("join-ack", { peerId, ok: false, error: "닉네임을 입력해주세요." });
          return;
        }
        participantsRef.current.set(peerId, nickname);
        await broadcast("participant-count", participantsRef.current.size);
        await broadcast("join-ack", { peerId, ok: true, nickname });
        await broadcastState();
        return;
      }

      if (event === "leave-room") {
        participantsRef.current.delete(String(payload.peerId || ""));
        await broadcast("participant-count", participantsRef.current.size);
        await broadcastState();
        return;
      }

      if (event === "reaction") {
        const emoji = String(payload.emoji || "");
        const nickname = String(payload.nickname || "익명");
        state.reactionStats[emoji] = (state.reactionStats[emoji] || 0) + 1;
        getFocusBucket().count += 1;
        const item = { emoji, nickname, id: uuidv4(), timestamp: Date.now() };
        allReactionsRef.current.push(item);
        await broadcast("reaction", item);
        await broadcast("reaction-stats", state.reactionStats);
        await broadcast("focus-update", state.focusTimeline);
        return;
      }

      if (event === "chat") {
        const message = String(payload.message || "").trim().slice(0, 200);
        const nickname = String(payload.nickname || "익명");
        if (!message) return;
        const item = { message, nickname, id: uuidv4(), timestamp: Date.now() };
        allChatsRef.current.push(item);
        await broadcast("chat", item);
        await broadcast("wordcloud-update", allChatsRef.current);
        return;
      }

      if (event === "create-poll") {
        const question = String(payload.question || "").trim();
        const options = (payload.options as string[] || []).map((t) => t.trim()).filter(Boolean);
        if (!question || options.length < 2) return;
        pollVotersRef.current = new Set();
        state.poll = {
          id: uuidv4(),
          question,
          options: options.map((text) => ({ text, votes: 0 })),
          active: true,
        };
        await broadcastState();
        return;
      }

      if (event === "close-poll") {
        if (state.poll) {
          allPollsRef.current.push({
            id: state.poll.id,
            question: state.poll.question,
            options: state.poll.options,
            closedAt: Date.now(),
          });
          state.poll = { ...state.poll, active: false };
        }
        await broadcastState();
        return;
      }

      if (event === "vote-poll") {
        const peerId = String(payload.peerId || "");
        const optionIndex = Number(payload.optionIndex);
        if (!state.poll?.active || pollVotersRef.current.has(peerId)) return;
        if (optionIndex < 0 || optionIndex >= state.poll.options.length) return;
        pollVotersRef.current.add(peerId);
        state.poll.options[optionIndex].votes += 1;
        await broadcastState();
        return;
      }

      if (event === "submit-question") {
        const text = String(payload.text || "").trim().slice(0, 300);
        const nickname = String(payload.nickname || "익명");
        if (!text) return;
        state.questions.push({
          id: uuidv4(),
          text,
          nickname,
          timestamp: Date.now(),
          answered: false,
        });
        await broadcastState();
        return;
      }

      if (event === "resolve-question") {
        const q = state.questions.find((x) => x.id === payload.questionId);
        if (q) q.answered = true;
        await broadcastState();
        return;
      }

      if (event === "slide-request") {
        const direction = payload.direction;
        if (direction === "next") state.slideRequests.next += 1;
        else if (direction === "prev") state.slideRequests.prev += 1;
        await broadcast("slide-request-update", { ...state.slideRequests });
        return;
      }

      if (event === "reset-slide-requests") {
        state.slideRequests = { next: 0, prev: 0 };
        await broadcast("slide-request-update", { ...state.slideRequests });
        return;
      }

      if (event === "get-session-data") {
        await broadcast("session-data", {
          peerId: payload.peerId,
          data: {
            roomId,
            chats: allChatsRef.current,
            reactions: allReactionsRef.current,
            questions: state.questions,
            polls: allPollsRef.current,
            reactionStats: state.reactionStats,
            focusTimeline: state.focusTimeline,
            slideRequests: state.slideRequests,
            participantCount: participantsRef.current.size,
          },
        });
      }
    },
    [broadcast, broadcastState, getFocusBucket, roomId]
  );

  useEffect(() => {
    if (!roomId) return;

    const clientId = clientIdRef.current;
    const channelName = `slides-room:${roomId}`;

    const setup = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setReady(true);
        if (role === "presenter") await broadcastState();
        return;
      }

      // self: false prevents Supabase from looping broadcasts back to the sender,
      // which would cause duplicate handler processing (chat/reaction appearing twice).
      const channel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      const audienceEvents = [
        "room-state", "reaction", "chat", "participant-count", "reaction-stats",
        "focus-update", "wordcloud-update", "slide-request-update",
        "join-ack", "session-data",
      ];
      const presenterCmdEvents = [
        "join-room", "leave-room", "reaction", "chat", "vote-poll",
        "submit-question", "slide-request",
      ];

      const handleBroadcast = (event: string, payload: unknown) => {
        if (role === "presenter" && presenterCmdEvents.includes(event)) {
          const p = payload as Record<string, unknown>;
          // If the payload already has an `id`, this is our own processed rebroadcast
          // coming back from Supabase — emit locally for display only, don't reprocess.
          if (typeof p.id === "string" && (event === "chat" || event === "reaction")) {
            emitLocal(event, payload);
            return;
          }
          handlePresenterCommand(event, payload as Record<string, unknown>);
          return;
        }
        if (role === "audience") {
          if (event === "join-ack" && (payload as { peerId: string }).peerId === clientId) {
            emitLocal("join-ack", payload);
          }
          if (event === "session-data" && (payload as { peerId: string }).peerId === clientId) {
            emitLocal("session-data", (payload as { data: unknown }).data);
          }
        }
        emitLocal(event, payload);
      };

      [...audienceEvents, ...presenterCmdEvents].forEach((event) => {
        channel.on("broadcast", { event }, ({ payload }) => handleBroadcast(event, payload));
      });

      await channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setReady(true);
          if (role === "presenter") {
            await broadcastState();
          }
        }
      });
    };

    setup();

    return () => {
      if (role === "audience" && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "leave-room",
          payload: { peerId: clientId },
        });
      }
      channelRef.current?.unsubscribe();
    };
  }, [roomId, role, broadcastState, handlePresenterCommand, emitLocal]);

  const emit = useCallback(
    async (event: string, data?: unknown, callback?: (res: unknown) => void) => {
      const clientId = clientIdRef.current;
      const payload = typeof data === "object" && data !== null ? { ...(data as object) } : {};

      if (role === "presenter") {
        if (event === "presenter-join") {
          await broadcastState();
          return;
        }
        if (["create-poll", "close-poll", "resolve-question", "reset-slide-requests", "get-session-data"].includes(event)) {
          const cmdPayload = { ...payload, peerId: clientId };
          await handlePresenterCommand(event, cmdPayload);
          if (event === "get-session-data") {
            callback?.({
              roomId,
              chats: allChatsRef.current,
              reactions: allReactionsRef.current,
              questions: stateRef.current.questions,
              polls: allPollsRef.current,
              reactionStats: stateRef.current.reactionStats,
              focusTimeline: stateRef.current.focusTimeline,
              slideRequests: stateRef.current.slideRequests,
              participantCount: participantsRef.current.size,
            });
          }
          return;
        }
      }

      if (role === "audience") {
        if (event === "join-room") {
          const joinPayload = data as { roomId: string; nickname: string };
          const once = (res: unknown) => {
            callback?.(res);
            const idx = (handlersRef.current["join-ack"] || []).indexOf(once as Handler);
            if (idx >= 0) handlersRef.current["join-ack"].splice(idx, 1);
          };
          on("join-ack", once as Handler);
          await broadcast("join-room", {
            nickname: joinPayload.nickname,
            peerId: clientId,
          });
          return;
        }
        if (event === "get-session-data") return;
      }

      const enriched = { ...(payload as object), peerId: clientId, nickname: (payload as { nickname?: string }).nickname };
      if (role === "presenter") {
        await handlePresenterCommand(event, enriched);
      } else {
        await broadcast(event, enriched);
      }
    },
    [role, broadcast, broadcastState, handlePresenterCommand, on, roomId]
  );

  const setInitialState = useCallback((state: Partial<RoomState>) => {
    stateRef.current = { ...stateRef.current, ...state };
  }, []);

  return { on, off, emit, ready, setInitialState, clientId: clientIdRef.current };
}
