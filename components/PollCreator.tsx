"use client";

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Poll } from "@/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";

interface PollCreatorProps {
  sessionId: string;
  onClose: () => void;
  onPollCreated: (poll: Poll) => void;
}

export function PollCreator({ sessionId, onClose, onPollCreated }: PollCreatorProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [error, setError] = useState("");

  const handleOptionChange = (idx: number, value: string) => {
    const newOptions = [...options];
    newOptions[idx] = value;
    setOptions(newOptions);
  };

  const handleCreatePoll = async () => {
    setError("");

    if (!question.trim()) {
      setError("질문을 입력해주세요");
      return;
    }

    const filledOptions = options.filter((o) => o.trim());
    if (filledOptions.length < 2) {
      setError("최소 2개 이상의 선택지가 필요합니다");
      return;
    }

    const poll: Poll = {
      id: uuidv4(),
      sessionId,
      question,
      options: filledOptions,
      votes: Object.fromEntries(filledOptions.map((_, i) => [i, 0])),
      createdAt: Date.now(),
      isActive: true,
    };

    if (isSupabaseConfigured) {
      await supabase!.channel(`polls:${sessionId}`).send("broadcast" as any, {
        event: "poll_created",
        payload: poll,
      });
    }

    onPollCreated(poll);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl p-6 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">투표 생성</h2>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            질문
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="투표 질문을 입력하세요"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            선택지 (최대 4개)
          </label>
          {options.map((option, idx) => (
            <input
              key={idx}
              type="text"
              value={option}
              onChange={(e) => handleOptionChange(idx, e.target.value)}
              placeholder={`선택지 ${idx + 1}`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ))}
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            onClick={handleCreatePoll}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold"
          >
            생성
          </button>
        </div>
      </div>
    </div>
  );
}
