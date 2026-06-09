"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { SessionRecord } from "@/types";
import { getSession } from "@/lib/session-storage";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const loadedSession = getSession(sessionId);
    setSession(loadedSession);
  }, [sessionId]);

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">세션을 찾을 수 없습니다</p>
          <Link href="/sessions" className="text-blue-600 hover:underline">
            세션 목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const duration = Math.round(
    ((session.endTime || Date.now()) - session.startTime) / 1000 / 60
  );
  const startDate = new Date(session.startTime).toLocaleString("ko-KR");

  // Statistics
  const uniqueParticipants = new Set(session.messages.map((m) => m.nickname)).size;
  const emojiStats = Array.from(
    new Map(
      session.reactions.map((r) => [
        r.emoji,
        (session.reactions.filter((x) => x.emoji === r.emoji) || []).length,
      ])
    ).entries()
  ).map(([emoji, count]) => ({ emoji, count }));

  const messageCounts = Array.from(
    new Map(
      session.messages.map((m) => [
        m.nickname,
        session.messages.filter((x) => x.nickname === m.nickname).length,
      ])
    ).entries()
  )
    .map(([nickname, count]) => ({ nickname, count }))
    .sort((a, b) => b.count - a.count);

  // Filtered messages
  const filteredMessages = session.messages.filter((m) =>
    m.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.nickname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-md p-6 border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">세션 상세 분석</h1>
            <p className="text-gray-600 mt-1">{startDate}</p>
            <p className="text-sm text-gray-600">
              {session.slidesUrl.includes("canva") ? "Canva" : "Google Slides"} •{" "}
              {duration}분
            </p>
          </div>
          <Link
            href="/sessions"
            className="text-blue-600 hover:underline font-semibold"
          >
            ← 목록으로
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        {/* Key Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">참가자</p>
            <p className="text-3xl font-bold text-blue-600">{uniqueParticipants}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">메시지</p>
            <p className="text-3xl font-bold text-green-600">
              {session.messages.length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">반응</p>
            <p className="text-3xl font-bold text-pink-600">
              {session.reactions.length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">질문</p>
            <p className="text-3xl font-bold text-purple-600">
              {session.questions.length}
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {/* Emoji Distribution */}
          {emojiStats.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                이모티콘 분포
              </h2>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={emojiStats}
                    dataKey="count"
                    nameKey="emoji"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {emojiStats.map((_, idx) => (
                      <Cell key={`cell-${idx}`} fill={["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8"][idx % 5]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Message Count by User */}
          {messageCounts.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                참가자별 메시지 수
              </h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={messageCounts.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="nickname" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Questions */}
        {session.questions.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              질문 목록 ({session.questions.length})
            </h2>
            <div className="space-y-3">
              {session.questions.map((q) => (
                <div
                  key={q.id}
                  className={`p-3 rounded-lg ${
                    q.isAnswered
                      ? "bg-green-50 border-l-4 border-green-500"
                      : "bg-yellow-50 border-l-4 border-yellow-500"
                  }`}
                >
                  <p className="text-xs text-gray-600 mb-1">
                    {q.nickname} • {new Date(q.timestamp).toLocaleTimeString()}
                  </p>
                  <p className="text-gray-800">{q.text}</p>
                  <p className="text-xs mt-1">
                    {q.isAnswered ? "✓ 답변 완료" : "⏳ 답변 대기 중"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Polls */}
        {session.polls.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              투표 결과 ({session.polls.length})
            </h2>
            <div className="space-y-6">
              {session.polls.map((poll) => {
                const totalVotes = Object.values(poll.votes).reduce(
                  (a, b) => a + b,
                  0
                );
                return (
                  <div key={poll.id} className="border-l-4 border-blue-500 pl-4">
                    <h3 className="font-semibold text-gray-800 mb-3">
                      {poll.question}
                    </h3>
                    <div className="space-y-2">
                      {poll.options.map((option, idx) => {
                        const votes = poll.votes[idx] || 0;
                        const percentage =
                          totalVotes > 0
                            ? Math.round((votes / totalVotes) * 100)
                            : 0;
                        return (
                          <div key={idx}>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{option}</span>
                              <span className="font-semibold">
                                {votes} ({percentage}%)
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-600 mt-2">총 {totalVotes}명 투표</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Chat Messages */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-gray-800">
              채팅 기록 ({filteredMessages.length}/{session.messages.length})
            </h2>
          </div>

          <input
            type="text"
            placeholder="닉네임 또는 메시지로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredMessages.length === 0 ? (
              <p className="text-gray-600 text-center py-4">
                {session.messages.length === 0 ? "메시지가 없습니다" : "검색 결과가 없습니다"}
              </p>
            ) : (
              filteredMessages.map((msg) => (
                <div key={msg.id} className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-semibold text-blue-600">
                      {msg.nickname}
                    </span>{" "}
                    • {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
                  <p className="text-gray-800">{msg.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
