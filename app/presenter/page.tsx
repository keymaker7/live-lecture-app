"use client";

import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import Link from "next/link";
import QRCode from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { ChatMessage, EmojiReaction } from "@/types";
import { endSession } from "@/lib/session-storage";
import { PollCreator } from "@/components/PollCreator";
import { PollWidget } from "@/components/PollWidget";
import { WordCloudWidget } from "@/components/WordCloudWidget";
import { EngagementChart } from "@/components/EngagementChart";
import { TimerWidget } from "@/components/TimerWidget";
import { QuestionsPanel } from "@/components/QuestionsPanel";
import { ParticipantCounter } from "@/components/ParticipantCounter";

export default function PresenterPage() {
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [showQRDropdown, setShowQRDropdown] = useState(false);
  const qrDropdownRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    reactions,
    polls,
    questions,
    slideRequests,
    participantCount,
    isConnected,
    markQuestionAnswered,
  } = useRealtimeMessages(sessionId, googleSlidesUrl);

  // Auto-fade chat messages after 3 seconds
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      setVisibleMessages((prev) => {
        const exists = prev.find((m) => m.id === latestMessage.id);
        // Keep max 5 messages
        const updated = exists ? prev : [...prev, latestMessage];
        return updated.slice(-5);
      });

      const timer = setTimeout(() => {
        setVisibleMessages((prev) =>
          prev.filter((m) => m.id !== latestMessage.id)
        );
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [messages]);

  // Auto-fade reactions after 2 seconds
  const [visibleReactions, setVisibleReactions] = useState<EmojiReaction[]>([]);

  useEffect(() => {
    if (reactions.length > 0) {
      const latestReaction = reactions[reactions.length - 1];
      setVisibleReactions((prev) => {
        const exists = prev.find((r) => r.id === latestReaction.id);
        // Keep max 5 reactions
        const updated = exists ? prev : [...prev, latestReaction];
        return updated.slice(-5);
      });

      const timer = setTimeout(() => {
        setVisibleReactions((prev) =>
          prev.filter((r) => r.id !== latestReaction.id)
        );
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [reactions]);

  // Close QR dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (qrDropdownRef.current && !qrDropdownRef.current.contains(event.target as Node)) {
        setShowQRDropdown(false);
      }
    };
    if (showQRDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showQRDropdown]);

  const nextRequests = slideRequests.filter((r) => r.type === "next").length;
  const prevRequests = slideRequests.filter((r) => r.type === "prev").length;

  const handleStartSession = async () => {
    if (!googleSlidesUrl.trim()) {
      alert("슬라이드 URL을 입력하세요");
      return;
    }
    let resolvedUrl = googleSlidesUrl.trim();
    if (resolvedUrl.includes("canva.link/")) {
      try {
        const res = await fetch(`/api/resolve-url?url=${encodeURIComponent(resolvedUrl)}`);
        const data = await res.json();
        if (data.resolved) resolvedUrl = data.resolved;
      } catch {}
    }
    setGoogleSlidesUrl(resolvedUrl);
    const newSessionId = uuidv4();
    setSessionId(newSessionId);
    setIsStarted(true);
  };

  const handleEndSession = () => {
    if (confirm("세션을 종료하시겠습니까? 모든 데이터가 저장됩니다.")) {
      endSession(sessionId);
      setIsStarted(false);
      setSessionId("");
    }
  };

  if (!isStarted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2 text-gray-800">
            Live Lecture
          </h1>
          <p className="text-gray-600 mb-6">
            구글 슬라이드 또는 캔바 URL을 입력하세요
          </p>
          <input
            type="text"
            placeholder="구글 슬라이드 / 캔바 URL (canva.link 포함)"
            value={googleSlidesUrl}
            onChange={(e) => setGoogleSlidesUrl(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") handleStartSession();
            }}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleStartSession}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition duration-200 mb-4"
          >
            연수 시작
          </button>
          <Link
            href="/sessions"
            className="block text-center text-blue-600 hover:underline text-sm"
          >
            지난 세션 보기
          </Link>
        </div>
      </div>
    );
  }

  // Extract embed URL from Google Slides or Canva share URL
  const getEmbedUrl = (url: string) => {
    const gMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (gMatch && url.includes("docs.google.com")) {
      return `https://docs.google.com/presentation/d/${gMatch[1]}/embed?start=false&loop=false&delayms=3000`;
    }
    if (url.includes("canva.com/design/")) {
      const base = url.split("?")[0].replace(/\/$/, "");
      const viewUrl = base.endsWith("/view") ? base : `${base}/view`;
      return `${viewUrl}?embed`;
    }
    if (url.includes("canva.com/")) {
      return url.includes("?") ? `${url}&embed=true` : `${url}?embed=true`;
    }
    return url;
  };

  const embedUrl = getEmbedUrl(googleSlidesUrl);
  const joinUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/join/${sessionId}`;
  const activePoll = polls.find((p) => p.isActive);

  return (
    <div className="relative w-screen h-screen bg-gray-900 text-white overflow-hidden">
      {/* Slides - Full screen background */}
      <div className="absolute inset-0">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            width="100vw"
            height="100vh"
            allowFullScreen
            allow="autoplay"
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <p className="text-xl text-gray-400">슬라이드 URL을 확인해주세요</p>
          </div>
        )}
      </div>

      {/* Top Control Bar - Fixed overlay */}
      <div className="fixed top-4 left-4 right-4 bg-gray-800 bg-opacity-90 rounded-lg shadow-lg p-3 flex gap-2 items-center justify-between z-40">
        <div className="flex gap-2">
          <button
            onClick={() => setShowPollCreator(true)}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
          >
            투표 생성
          </button>
          <button
            onClick={() => setShowTimer(!showTimer)}
            className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded transition"
          >
            타이머
          </button>
          <Link
            href="/sessions"
            className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded transition"
          >
            지난 세션
          </Link>
          <button
            onClick={handleEndSession}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
          >
            종료
          </button>
        </div>
        <div className="flex gap-2 items-center text-xs">
          <span className={isConnected ? "text-green-400" : "text-yellow-400"}>
            {isConnected ? "✓ 연결" : "◐ 로컬"}
          </span>
        </div>
      </div>

      {/* Top-Right QR Button + Dropdown */}
      <div className="fixed top-4 right-4 z-50" ref={qrDropdownRef}>
        <button
          onClick={() => setShowQRDropdown(!showQRDropdown)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-lg flex items-center gap-2"
        >
          👥 QR 참가
        </button>

        {/* QR Dropdown */}
        <AnimatePresence>
          {showQRDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-12 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-5 w-80"
            >
              {joinUrl && (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <div className="bg-white p-3 rounded-lg">
                      <QRCode value={joinUrl} size={220} />
                    </div>
                  </div>
                  <div className="text-center text-sm text-gray-300">
                    <p className="break-all mb-2">{joinUrl}</p>
                    <ParticipantCounter count={participantCount} />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Left-Bottom Chat Message Popup Stack */}
      <div className="fixed left-4 bottom-20 z-30 space-y-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {visibleMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="bg-gray-900 bg-opacity-90 border border-gray-600 p-4 rounded-xl text-base max-w-sm pointer-events-auto shadow-lg"
            >
              <p className="font-bold text-blue-300 text-sm">{msg.nickname}</p>
              <p className="text-white text-base mt-1">{msg.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Floating Emoji Reactions - Large, Float Up */}
      <div className="fixed inset-0 pointer-events-none z-20">
        <AnimatePresence>
          {visibleReactions.map((reaction) => (
            <motion.div
              key={reaction.id}
              initial={{ opacity: 1, y: 0, x: 0 }}
              animate={{ opacity: 0, y: -150, x: Math.random() * 100 - 50 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2 }}
              className="absolute text-6xl"
              style={{ left: `${20 + Math.random() * 20}%`, top: "50%" }}
            >
              {reaction.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Active Poll Overlay - Center Bottom */}
      {activePoll && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-30"
        >
          <PollWidget poll={activePoll} />
        </motion.div>
      )}

      {/* Timer Widget */}
      {showTimer && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-6 right-6 z-40"
        >
          <TimerWidget onClose={() => setShowTimer(false)} />
        </motion.div>
      )}

      {/* Poll Creator Modal */}
      <AnimatePresence>
        {showPollCreator && (
          <PollCreator
            sessionId={sessionId}
            onClose={() => setShowPollCreator(false)}
            onPollCreated={() => setShowPollCreator(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
