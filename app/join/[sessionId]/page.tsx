"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { AllowedEmoji, Poll } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const ALLOWED_EMOJIS: AllowedEmoji[] = ["👏", "❤️", "😂", "🤔", "💡"];

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

  const {
    sendMessage,
    sendReaction,
    submitQuestion,
    votePoll,
    polls,
    isConnected,
  } = useRealtimeMessages(sessionId);

  const messageInputRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const handleJoin = () => {
    if (!nickname.trim()) {
      alert("Please enter your nickname");
      return;
    }
    setIsJoined(true);
    messageInputRef.current?.focus();
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !nickname.trim()) return;

    await sendMessage(nickname, chatInput);
    setChatInput("");
    messageInputRef.current?.focus();
  };

  const handleEmojiClick = async (emoji: AllowedEmoji) => {
    await sendReaction(nickname, emoji);

    setRecentReactions((prev) => [...prev, emoji]);
    setTimeout(() => {
      setRecentReactions((prev) => prev.slice(1));
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const handlePollVote = async (pollId: string, optionIndex: number) => {
    if (currentPollVote[pollId]) return; // Already voted

    await votePoll(pollId, optionIndex);
    setCurrentPollVote((prev) => ({ ...prev, [pollId]: optionIndex }));
  };

  const handleSubmitQuestion = async () => {
    if (!questionInput.trim() || !nickname.trim()) return;

    await submitQuestion(nickname, questionInput);
    setQuestionInput("");
    setShowQuestionInput(false);
    messageInputRef.current?.focus();
  };

  if (!isJoined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-purple-50 to-blue-100">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2 text-gray-800">
            Live Lecture
          </h1>
          <p className="text-gray-600 mb-6">입장할 닉네임을 입력해주세요</p>
          <input
            type="text"
            placeholder="Your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") handleJoin();
            }}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
            autoFocus
          />
          <button
            onClick={handleJoin}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg transition duration-200"
          >
            입장
          </button>
          <div className="mt-4 text-center">
            <p
              className={`text-sm ${
                isConnected ? "text-green-600" : "text-yellow-600"
              }`}
            >
              {isConnected ? "✓ 실시간 연결됨" : "◐ 로컬 모드"}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Session: {sessionId.substring(0, 8)}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activePoll = polls.find((p) => p.isActive);
  const alreadyVoted = activePoll ? currentPollVote[activePoll.id] !== undefined : false;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-md p-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Live Lecture</h1>
            <p className="text-sm text-gray-600">
              반가워요, <span className="font-semibold">{nickname}</span>!
            </p>
          </div>
          <div className="text-right">
            <p
              className={`text-sm font-semibold ${
                isConnected ? "text-green-600" : "text-yellow-600"
              }`}
            >
              {isConnected ? "✓ 연결됨" : "◐ 로컬 모드"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {/* Active Poll */}
          {activePoll && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-300 rounded-lg p-6 mb-6"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                실시간 투표
              </h3>
              <p className="text-gray-700 font-semibold mb-4">{activePoll.question}</p>

              {alreadyVoted ? (
                <div>
                  <p className="text-sm text-gray-600 mb-3">✓ 투표 완료했습니다</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart
                      data={activePoll.options.map((opt, idx) => ({
                        name: opt,
                        votes: activePoll.votes[idx] || 0,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="votes" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="space-y-2">
                  {activePoll.options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePollVote(activePoll.id, idx)}
                      className="w-full px-4 py-3 bg-white border-2 border-blue-300 hover:bg-blue-50 hover:border-blue-500 text-gray-800 rounded-lg transition font-semibold"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Emoji & Reaction Section */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <p className="text-gray-600 mb-4 text-center">
              이모티콘으로 반응해주세요
            </p>
            {/* Emoji Buttons */}
            <div className="flex justify-center gap-3 mb-6">
              {ALLOWED_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiClick(emoji)}
                  className="text-4xl hover:scale-125 transition transform duration-200 active:scale-100"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Recent Reactions Feedback */}
            {recentReactions.length > 0 && (
              <div className="flex justify-center gap-2">
                <AnimatePresence>
                  {recentReactions.map((emoji, idx) => (
                    <motion.div
                      key={`${emoji}-${idx}`}
                      initial={{ scale: 0, opacity: 1 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="text-3xl"
                    >
                      {emoji}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Question Input Section */}
          {showQuestionInput && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-300 rounded-lg p-6 mb-6"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-3">
                질문하기
              </h3>
              <input
                ref={questionInputRef}
                type="text"
                placeholder="질문을 입력해주세요..."
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSubmitQuestion();
                }}
                className="w-full px-4 py-3 border border-purple-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitQuestion}
                  disabled={!questionInput.trim()}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg transition font-semibold"
                >
                  제출
                </button>
                <button
                  onClick={() => {
                    setShowQuestionInput(false);
                    setQuestionInput("");
                  }}
                  className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition font-semibold"
                >
                  취소
                </button>
              </div>
            </motion.div>
          )}

          {!showQuestionInput && (
            <button
              onClick={() => {
                setShowQuestionInput(true);
                setTimeout(() => questionInputRef.current?.focus(), 100);
              }}
              className="w-full mb-6 px-4 py-3 bg-purple-100 hover:bg-purple-200 border-2 border-purple-300 text-purple-700 rounded-lg transition font-semibold"
            >
              ❓ 질문하기
            </button>
          )}
        </div>
      </div>

      {/* Chat Input Footer */}
      <div className="bg-white shadow-lg border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            ref={messageInputRef}
            type="text"
            placeholder="의견을 입력해주세요..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            onClick={handleSendMessage}
            disabled={!chatInput.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold py-3 px-6 rounded-lg transition duration-200"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
