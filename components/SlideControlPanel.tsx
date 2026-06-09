"use client";

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";
import { addSlideRequest } from "@/lib/session-storage";

interface SlideControlPanelProps {
  sessionId: string;
  nextRequestCount: number;
  prevRequestCount: number;
}

export function SlideControlPanel({
  sessionId,
  nextRequestCount,
  prevRequestCount,
}: SlideControlPanelProps) {
  const [isRequesting, setIsRequesting] = useState(false);

  const handleSlideRequest = async (type: "next" | "prev") => {
    setIsRequesting(true);

    const request = {
      id: uuidv4(),
      sessionId,
      type,
      timestamp: Date.now(),
    };

    if (isSupabaseConfigured) {
      await supabase!.channel(`slides:${sessionId}`).send("broadcast" as any, {
        event: "slide_request",
        payload: request,
      });
    }

    addSlideRequest(sessionId, request);
    setIsRequesting(false);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h3 className="font-semibold text-gray-800 mb-3 text-center">슬라이드 컨트롤 요청</h3>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => handleSlideRequest("prev")}
          disabled={isRequesting}
          className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg transition font-semibold text-sm"
        >
          ← 이전
        </button>
        <button
          onClick={() => handleSlideRequest("next")}
          disabled={isRequesting}
          className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg transition font-semibold text-sm"
        >
          다음 →
        </button>
      </div>
      <div className="text-xs text-gray-600 text-center space-y-1">
        <p>다음: <span className="font-bold text-blue-600">{nextRequestCount}</span></p>
        <p>이전: <span className="font-bold text-blue-600">{prevRequestCount}</span></p>
      </div>
    </div>
  );
}
