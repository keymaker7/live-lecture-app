"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { AllowedEmoji } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const ALLOWED_EMOJIS: AllowedEmoji[] = ["👏", "❤️", "😂", "🤔", "💡", "👍", "🔥", "🎉"];

export default function JoinPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [recentReactions, setRecentReactions] = useState<string[]>([]);
  const [currentPollVote, setCurrentPollVote] = useState<Record<string, number>>({});
  const [showQuestionInput, setShowQuestionInput] = useState(false);
  const [questionInput, setQuestionInput] = useState("");

  const { sendMessage, sendReaction, submitQuestion, votePoll, polls, isConnected } =
    useRealtimeMessages(sessionId);

  const messageInputRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const handleJoin = () => {
    if (!nickname.trim()) { alert("닉네임을 입력해주세요"); return; }
    setIsJoined(true);
    messageInputRef.current?.focus();
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !nickname.trim()) return;
    await sendMessage(nickname, chatInput);
    setChatInput("");
  };

  const handleEmojiClick = async (emoji: AllowedEmoji) => {
    await sendReaction(nickname, emoji);
    setRecentReactions((prev) => [...prev, emoji]);
    setTimeout(() => setRecentReactions((prev) => prev.slice(1)), 1500);
  };

  const handlePollVote = async (pollId: string, optionIndex: number) => {
    if (currentPollVote[pollId] !== undefined) return;
    await votePoll(pollId, optionIndex);
    setCurrentPollVote((prev) => ({ ...prev, [pollId]: optionIndex }));
  };

  const handleSubmitQuestion = async () => {
    if (!questionInput.trim()) return;
    await submitQuestion(nickname, questionInput);
    setQuestionInput("");
    setShowQuestionInput(false);
  };

  if (!isJoined) {
    return (
      <div className="pastel-page flex items-center justify-center px-4">
        <div className="pastel-card p-8 max-w-md w-full">
          <div className="text-4xl text-center mb-2">📱</div>
          <h1 className="text-2xl font-extrabold text-[#4c4f69] text-center mb-1">연수 참여 ✨</h1>
          <p className="text-gray-500 text-sm text-center mb-6">닉네임을 입력하고 참여하세요</p>
          <input
            type="text"
            placeholder="이름 또는 닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleJoin()}
            className="pastel-input mb-4"
            autoFocus
          />
          <button onClick={handleJoin} className="pastel-btn w-full py-3">참여하기 🎉</button>
          <p className={`text-xs text-center mt-4 font-semibold ${isConnected ? "text-emerald-400" : "text-amber-400"}`}>
            {isConnected ? "● 실시간 연결됨" : "◐ 로컬 모드"}
          </p>
        </div>
      </div>
    );
  }

  const activePoll = polls.find((p) => p.isActive);
  const alreadyVoted = activePoll ? currentPollVote[activePoll.id] !== undefined : false;

  return (
    <div className="flex flex-col h-screen pastel-page">
      <div className="bg-white/80 backdrop-blur border-b-2 border-pink-100 p-4 shadow-sm">
        <div className="flex justify-between items-center max-w-2xl mx-auto">
          <div>
            <h1 className="text-lg font-extrabold text-[#4c4f69]">🌸 연수 참여</h1>
            <p className="text-sm text-gray-500">안녕, <span className="font-bold text-purple-400">{nickname}</span>!</p>
          </div>
          <span className={`text-xs font-semibold ${isConnected ? "text-emerald-400" : "text-amber-400"}`}>
            {isConnected ? "● 연결됨" : "◐ 로컬"}
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4">
          {activePoll && (
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="pastel-card p-5">
              <h3 className="font-bold text-[#4c4f69] mb-2">📊 실시간 투표</h3>
              <p className="text-gray-600 mb-4">{activePoll.question}</p>
              {alreadyVoted ? (
                <div>
                  <p className="text-sm text-emerald-400 mb-3 font-semibold">✓ 투표 완료!</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={activePoll.options.map((opt, idx) => ({ name: opt, votes: activePoll.votes[idx] || 0 }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#fce7f3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <Tooltip />
                      <Bar dataKey="votes" fill="#c4b5fd" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="space-y-2">
                  {activePoll.options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePollVote(activePoll.id, idx)}
                      className="w-full px-4 py-3 pastel-card hover:border-purple-200 text-[#4c4f69] font-semibold text-sm transition"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          <div className="pastel-card p-5">
            <p className="text-gray-500 text-sm text-center mb-4">이모지로 반응해주세요 😊</p>
            <div className="grid grid-cols-4 gap-3">
              {ALLOWED_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiClick(emoji)}
                  className="text-3xl pastel-card py-3 hover:scale-110 transition active:scale-95"
                >
                  {emoji}
                </button>
              ))}
            </div>
            {recentReactions.length > 0 && (
              <div className="flex justify-center gap-2 mt-4">
                <AnimatePresence>
                  {recentReactions.map((emoji, idx) => (
                    <motion.div key={`${emoji}-${idx}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-2xl">
                      {emoji}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {showQuestionInput ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pastel-card p-5">
              <h3 className="font-bold text-[#4c4f69] mb-3">🙋 질문하기</h3>
              <input
                ref={questionInputRef}
                type="text"
                placeholder="질문을 입력하세요..."
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSubmitQuestion()}
                className="pastel-input mb-3"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleSubmitQuestion} disabled={!questionInput.trim()} className="pastel-btn flex-1 py-2 text-sm disabled:opacity-50">등록</button>
                <button onClick={() => { setShowQuestionInput(false); setQuestionInput(""); }} className="pastel-btn-sm flex-1">취소</button>
              </div>
            </motion.div>
          ) : (
            <button onClick={() => { setShowQuestionInput(true); setTimeout(() => questionInputRef.current?.focus(), 100); }} className="pastel-btn-sm w-full py-3">
              🙋 질문하기
            </button>
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur border-t-2 border-pink-100 p-4">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            ref={messageInputRef}
            type="text"
            placeholder="메시지 입력..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
            className="pastel-input flex-1 !py-2.5"
          />
          <button onClick={handleSendMessage} disabled={!chatInput.trim()} className="pastel-btn px-5 py-2.5 disabled:opacity-50">
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
