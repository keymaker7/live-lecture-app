"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";
import { ChatMessage, EmojiReaction, Poll, Question, SlideControlRequest } from "@/types";
import {
  addChatMessage,
  addReaction,
  addPoll,
  updatePoll,
  addQuestion,
  addSlideRequest,
  getSession,
  createEmptySession,
  saveSession,
} from "@/lib/session-storage";

export function useRealtimeMessages(sessionId: string, slidesUrl: string = "") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<EmojiReaction[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [slideRequests, setSlideRequests] = useState<SlideControlRequest[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);

  // Initialize or load session from storage
  useEffect(() => {
    if (!sessionId) return;

    let session = getSession(sessionId);
    if (!session && slidesUrl) {
      session = createEmptySession(sessionId, slidesUrl);
      saveSession(session);
    }

    if (session) {
      setMessages(session.messages);
      setReactions(session.reactions);
      setPolls(session.polls);
      setQuestions(session.questions);
      setSlideRequests(session.slideRequests);
    }
  }, [sessionId, slidesUrl]);

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) {
      setIsConnected(false);
      return;
    }

    setIsConnected(true);

    // Subscribe to chat messages
    const messageChannel = supabase!.channel(`chat:${sessionId}`).on(
      "broadcast",
      { event: "message" },
      (payload) => {
        const newMsg = payload.payload as ChatMessage;
        setMessages((prev) => [...prev, newMsg]);
        addChatMessage(sessionId, newMsg);
      }
    );

    // Subscribe to emoji reactions
    const reactionChannel = supabase!.channel(`reactions:${sessionId}`).on(
      "broadcast",
      { event: "reaction" },
      (payload) => {
        const newReaction = payload.payload as EmojiReaction;
        setReactions((prev) => [...prev, newReaction]);
        addReaction(sessionId, newReaction);
      }
    );

    // Subscribe to polls
    const pollChannel = supabase!.channel(`polls:${sessionId}`)
      .on(
        "broadcast",
        { event: "poll_created" },
        (payload) => {
          const newPoll = payload.payload as Poll;
          setPolls((prev) => [...prev, newPoll]);
          addPoll(sessionId, newPoll);
        }
      )
      .on(
        "broadcast",
        { event: "poll_voted" },
        (payload) => {
          const updatedPoll = payload.payload as Poll;
          setPolls((prev) =>
            prev.map((p) => (p.id === updatedPoll.id ? updatedPoll : p))
          );
          updatePoll(sessionId, updatedPoll);
        }
      );

    // Subscribe to questions
    const questionChannel = supabase!.channel(`questions:${sessionId}`)
      .on(
        "broadcast",
        { event: "question_added" },
        (payload) => {
          const newQuestion = payload.payload as Question;
          setQuestions((prev) => [...prev, newQuestion]);
          addQuestion(sessionId, newQuestion);
        }
      )
      .on(
        "broadcast",
        { event: "question_answered" },
        (payload) => {
          const updatedQuestion = payload.payload as Question;
          setQuestions((prev) =>
            prev.map((q) => (q.id === updatedQuestion.id ? updatedQuestion : q))
          );
        }
      );

    // Subscribe to slide requests
    const slideChannel = supabase!.channel(`slides:${sessionId}`).on(
      "broadcast",
      { event: "slide_request" },
      (payload) => {
        const request = payload.payload as SlideControlRequest;
        setSlideRequests((prev) => [...prev, request]);
        addSlideRequest(sessionId, request);
      }
    );

    // Subscribe to participant count
    const countChannel = supabase!.channel(`presence:${sessionId}`)
      .on("presence", { event: "sync" }, () => {
        const state = countChannel.presenceState();
        setParticipantCount(Object.keys(state).length);
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        setParticipantCount((prev) => prev + newPresences.length);
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        setParticipantCount((prev) => Math.max(0, prev - leftPresences.length));
      });

    messageChannel.subscribe();
    reactionChannel.subscribe();
    pollChannel.subscribe();
    questionChannel.subscribe();
    slideChannel.subscribe();
    countChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        countChannel.track({ user: "participant" });
      }
    });

    return () => {
      messageChannel.unsubscribe();
      reactionChannel.unsubscribe();
      pollChannel.unsubscribe();
      questionChannel.unsubscribe();
      slideChannel.unsubscribe();
      countChannel.unsubscribe();
    };
  }, [sessionId]);

  const sendMessage = useCallback(
    async (nickname: string, message: string) => {
      if (!message.trim()) return;

      const chatMsg: ChatMessage = {
        id: Date.now().toString(),
        sessionId,
        nickname,
        message,
        timestamp: Date.now(),
      };

      if (isSupabaseConfigured) {
        await supabase!.channel(`chat:${sessionId}`).send({type:"broadcast",
          event: "message",
          payload: chatMsg,
        });
      } else {
        setMessages((prev) => [...prev, chatMsg]);
      }

      addChatMessage(sessionId, chatMsg);
    },
    [sessionId]
  );

  const sendReaction = useCallback(
    async (nickname: string, emoji: string) => {
      const reaction: EmojiReaction = {
        id: Date.now().toString(),
        sessionId,
        nickname,
        emoji,
        timestamp: Date.now(),
      };

      if (isSupabaseConfigured) {
        await supabase!.channel(`reactions:${sessionId}`).send({type:"broadcast",
          event: "reaction",
          payload: reaction,
        });
      } else {
        setReactions((prev) => [...prev, reaction]);
      }

      addReaction(sessionId, reaction);
    },
    [sessionId]
  );

  const submitQuestion = useCallback(
    async (nickname: string, text: string) => {
      if (!text.trim()) return;

      const question: Question = {
        id: Date.now().toString(),
        sessionId,
        nickname,
        text,
        timestamp: Date.now(),
        isAnswered: false,
      };

      if (isSupabaseConfigured) {
        await supabase!.channel(`questions:${sessionId}`).send({type:"broadcast",
          event: "question_added",
          payload: question,
        });
      }

      setQuestions((prev) => [...prev, question]);
      addQuestion(sessionId, question);
    },
    [sessionId]
  );

  const votePoll = useCallback(
    async (pollId: string, optionIndex: number) => {
      const poll = polls.find((p) => p.id === pollId);
      if (!poll) return;

      const updatedPoll = {
        ...poll,
        votes: {
          ...poll.votes,
          [optionIndex]: (poll.votes[optionIndex] || 0) + 1,
        },
      };

      if (isSupabaseConfigured) {
        await supabase!.channel(`polls:${sessionId}`).send({type:"broadcast",
          event: "poll_voted",
          payload: updatedPoll,
        });
      }

      setPolls((prev) =>
        prev.map((p) => (p.id === pollId ? updatedPoll : p))
      );
      updatePoll(sessionId, updatedPoll);
    },
    [sessionId, polls]
  );

  const markQuestionAnswered = useCallback(
    async (questionId: string) => {
      const question = questions.find((q) => q.id === questionId);
      if (!question) return;

      const updatedQuestion = { ...question, isAnswered: true };

      if (isSupabaseConfigured) {
        await supabase!.channel(`questions:${sessionId}`).send({type:"broadcast",
          event: "question_answered",
          payload: updatedQuestion,
        });
      }

      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? updatedQuestion : q))
      );
    },
    [sessionId, questions]
  );

  return {
    messages,
    reactions,
    polls,
    questions,
    slideRequests,
    participantCount,
    isConnected,
    sendMessage,
    sendReaction,
    submitQuestion,
    votePoll,
    markQuestionAnswered,
  };
}
