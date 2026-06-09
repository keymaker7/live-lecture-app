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
    if (!question.trim()) { setError("질문을 입력해주세요"); return; }
    const filledOptions = options.filter((o) => o.trim());
    if (filledOptions.length < 2) { setError("선택지 2개 이상 필요합니다"); return; }

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
      await supabase!.channel(`polls:${sessionId}`).send("broadcast" as never, {
        event: "poll_created",
        payload: poll,
      });
    }

    onPollCreated(poll);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-pink-100/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="pastel-card p-6 max-w-md w-full">
        <h2 className="text-xl font-extrabold mb-4 text-[#4c4f69]">📊 투표 생성</h2>
        <label className="block text-sm font-semibold text-gray-500 mb-2">질문</label>
        <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="투표 질문" className="pastel-input mb-4" />
        <label className="block text-sm font-semibold text-gray-500 mb-2">선택지</label>
        {options.map((option, idx) => (
          <input key={idx} type="text" value={option} onChange={(e) => handleOptionChange(idx, e.target.value)} placeholder={`선택지 ${idx + 1}`} className="pastel-input mb-2 !py-2" />
        ))}
        {error && <p className="text-red-300 text-sm mb-3 font-semibold">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="pastel-btn-sm flex-1 py-2">취소</button>
          <button onClick={handleCreatePoll} className="pastel-btn flex-1 py-2 text-sm">생성 ✨</button>
        </div>
      </div>
    </div>
  );
}
