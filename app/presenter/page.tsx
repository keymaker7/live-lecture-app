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
import { TimerWidget } from "@/components/TimerWidget";
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
    participantCount,
    isConnected,
  } = useRealtimeMessages(sessionId, googleSlidesUrl);

  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [visibleReactions, setVisibleReactions] = useState<EmojiReaction[]>([]);

  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      setVisibleMessages((prev) => {
        const exists = prev.find((m) => m.id === latestMessage.id);
        return (exists ? prev : [...prev, latestMessage]).slice(-5);
      });
      const timer = setTimeout(() => {
        setVisibleMessages((prev) => prev.filter((m) => m.id !== latestMessage.id));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  useEffect(() => {
    if (reactions.length > 0) {
      const latestReaction = reactions[reactions.length - 1];
      setVisibleReactions((prev) => {
        const exists = prev.find((r) => r.id === latestReaction.id);
        return (exists ? prev : [...prev, latestReaction]).slice(-5);
      });
      const timer = setTimeout(() => {
        setVisibleReactions((prev) => prev.filter((r) => r.id !== latestReaction.id));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [reactions]);

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
      } catch { /* ignore */ }
    }
    setGoogleSlidesUrl(resolvedUrl);
    setSessionId(uuidv4());
    setIsStarted(true);
  };

  const handleEndSession = () => {
    if (confirm("세션을 종료하시겠습니까?")) {
      endSession(sessionId);
      setIsStarted(false);
      setSessionId("");
    }
  };

  if (!isStarted) {
    return (
      <div className="pastel-page flex items-center justify-center px-4">
        <div className="pastel-card p-8 max-w-md w-full">
          <div className="text-4xl text-center mb-2">🌸</div>
          <h1 className="text-2xl font-extrabold mb-1 text-[#4c4f69] text-center">슬라이드 연수 ✨</h1>
          <p className="text-gray-500 text-sm mb-6 text-center">
            구글 슬라이드 또는 캔바 URL을 입력하세요
          </p>
          <input
            type="text"
            placeholder="구글 슬라이드 / 캔바 URL"
            value={googleSlidesUrl}
            onChange={(e) => setGoogleSlidesUrl(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleStartSession()}
            className="pastel-input mb-4"
            autoFocus
          />
          <button onClick={handleStartSession} className="pastel-btn w-full py-3 mb-3">
            ▶ 연수 시작
          </button>
          <Link href="/sessions" className="block text-center text-purple-400 hover:text-purple-600 text-sm font-semibold">
            🗃️ 지난 세션 보기
          </Link>
        </div>
      </div>
    );
  }

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
    return url;
  };

  const embedUrl = getEmbedUrl(googleSlidesUrl);
  const joinUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/join/${sessionId}`;
  const activePoll = polls.find((p) => p.isActive);

  return (
    <div className="relative w-screen h-screen bg-slate-100 overflow-hidden">
      <div className="absolute inset-0">
        {embedUrl ? (
          <iframe src={embedUrl} width="100%" height="100%" allowFullScreen allow="autoplay" className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center pastel-page">
            <p className="text-gray-500">슬라이드 URL을 확인해주세요</p>
          </div>
        )}
      </div>

      {/* 상단 컨트롤 */}
      <div className="fixed top-4 left-4 right-4 pastel-overlay p-3 flex gap-2 items-center justify-between z-40">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowPollCreator(true)} className="pastel-btn-sm">📊 투표</button>
          <button onClick={() => setShowTimer(!showTimer)} className="pastel-btn-sm">⏱️ 타이머</button>
          <Link href="/sessions" className="pastel-btn-sm inline-block">🗃️ 세션</Link>
          <button onClick={handleEndSession} className="pastel-btn-sm !from-red-100 !to-pink-100 !text-red-400">종료</button>
        </div>
        <span className={`text-xs font-semibold ${isConnected ? "text-emerald-400" : "text-amber-400"}`}>
          {isConnected ? "● 연결됨" : "◐ 로컬"}
        </span>
      </div>

      {/* QR */}
      <div className="fixed top-20 right-4 z-50" ref={qrDropdownRef}>
        <button
          onClick={() => setShowQRDropdown(!showQRDropdown)}
          className="pastel-btn px-4 py-2 flex items-center gap-2 shadow-lg"
        >
          📱 QR 참가
        </button>
        <AnimatePresence>
          {showQRDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-12 right-0 pastel-overlay p-5 w-72"
            >
              <div className="flex justify-center mb-3">
                <div className="bg-white p-3 rounded-xl border-2 border-pink-100">
                  <QRCode value={joinUrl} size={200} />
                </div>
              </div>
              <p className="text-xs text-gray-500 break-all text-center mb-2">{joinUrl}</p>
              <ParticipantCounter count={participantCount} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 채팅 */}
      <div className="fixed left-4 bottom-20 z-30 space-y-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {visibleMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="pastel-chat max-w-xs pointer-events-auto"
            >
              <p className="font-bold text-purple-400 text-sm">{msg.nickname}</p>
              <p className="text-[#4c4f69] text-sm mt-1">{msg.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 이모지 */}
      <div className="fixed inset-0 pointer-events-none z-20">
        <AnimatePresence>
          {visibleReactions.map((reaction) => (
            <motion.div
              key={reaction.id}
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 0, y: -150, x: Math.random() * 80 - 40 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2 }}
              className="absolute text-6xl drop-shadow-lg"
              style={{ left: `${15 + Math.random() * 20}%`, top: "55%" }}
            >
              {reaction.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {activePoll && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30"
        >
          <PollWidget poll={activePoll} />
        </motion.div>
      )}

      {showTimer && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed bottom-6 right-6 z-40">
          <TimerWidget onClose={() => setShowTimer(false)} />
        </motion.div>
      )}

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
