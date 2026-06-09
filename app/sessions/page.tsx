"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SessionRecord } from "@/types";
import { getCurrentSessions, searchSessions } from "@/lib/session-storage";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredSessions, setFilteredSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    const allSessions = getCurrentSessions()
      .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));
    setSessions(allSessions);
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      setFilteredSessions(searchSessions(searchQuery));
    } else {
      setFilteredSessions(sessions);
    }
  }, [searchQuery, sessions]);

  const handleClearSessions = () => {
    if (confirm("모든 세션을 삭제하시겠습니까?")) {
      localStorage.removeItem("lecture_sessions");
      setSessions([]);
      setFilteredSessions([]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white shadow-md p-6 border-b border-gray-200">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">지난 세션</h1>
            <p className="text-gray-600 mt-1">모든 강의 기록을 조회하고 검색합니다</p>
          </div>
          <Link
            href="/presenter"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
          >
            새 세션 시작
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="닉네임, 채팅 내용, 질문으로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stats */}
        {filteredSessions.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-gray-600 text-sm">총 세션</p>
              <p className="text-2xl font-bold text-blue-600">
                {filteredSessions.length}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-gray-600 text-sm">총 메시지</p>
              <p className="text-2xl font-bold text-green-600">
                {filteredSessions.reduce((sum, s) => sum + s.messages.length, 0)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-gray-600 text-sm">총 반응</p>
              <p className="text-2xl font-bold text-pink-600">
                {filteredSessions.reduce((sum, s) => sum + s.reactions.length, 0)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-gray-600 text-sm">총 질문</p>
              <p className="text-2xl font-bold text-purple-600">
                {filteredSessions.reduce((sum, s) => sum + s.questions.length, 0)}
              </p>
            </div>
          </div>
        )}

        {/* Sessions List */}
        {filteredSessions.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-600 text-lg">
              {sessions.length === 0
                ? "저장된 세션이 없습니다"
                : "검색 결과가 없습니다"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session) => {
              const duration = Math.round(
                ((session.endTime || Date.now()) - session.startTime) / 1000 / 60
              );
              const startDate = new Date(session.startTime).toLocaleString(
                "ko-KR"
              );

              return (
                <Link
                  key={session.sessionId}
                  href={`/sessions/${session.sessionId}`}
                  className="block"
                >
                  <div className="bg-white rounded-lg shadow hover:shadow-lg transition p-6 cursor-pointer border-l-4 border-blue-500">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">
                          {session.slidesUrl.includes("canva")
                            ? "Canva 프레젠테이션"
                            : "Google Slides"}
                        </h3>
                        <p className="text-sm text-gray-600">{startDate}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-700">
                          {duration}분
                        </p>
                        {session.endTime && (
                          <p className="text-xs text-gray-500">완료됨</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-600">메시지</p>
                        <p className="text-xl font-bold text-green-600">
                          {session.messages.length}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">반응</p>
                        <p className="text-xl font-bold text-pink-600">
                          {session.reactions.length}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">질문</p>
                        <p className="text-xl font-bold text-purple-600">
                          {session.questions.length}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">투표</p>
                        <p className="text-xl font-bold text-orange-600">
                          {session.polls.length}
                        </p>
                      </div>
                    </div>

                    {session.messages.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <p className="text-xs text-gray-600 mb-2">
                          참가자: {new Set(session.messages.map((m) => m.nickname)).size}명
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {Array.from(new Set(session.messages.map((m) => m.nickname)))
                            .slice(0, 5)
                            .map((name) => (
                              <span
                                key={name}
                                className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                              >
                                {name}
                              </span>
                            ))}
                          {new Set(session.messages.map((m) => m.nickname)).size > 5 && (
                            <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                              +
                              {new Set(session.messages.map((m) => m.nickname)).size - 5}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Actions */}
        {sessions.length > 0 && (
          <div className="mt-8 text-center">
            <button
              onClick={handleClearSessions}
              className="px-6 py-2 border border-red-300 text-red-600 hover:bg-red-50 rounded-lg transition text-sm"
            >
              모든 세션 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
