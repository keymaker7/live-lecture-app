"use client";

import { useWordCloud } from "@/hooks/useWordCloud";
import { ChatMessage } from "@/types";

interface WordCloudWidgetProps {
  messages: ChatMessage[];
}

export function WordCloudWidget({ messages }: WordCloudWidgetProps) {
  const words = useWordCloud(messages);

  if (words.length === 0) {
    return (
      <div className="bg-gradient-to-br from-pink-500 to-pink-600 text-white p-4 rounded-lg shadow-lg">
        <h3 className="font-bold text-sm mb-3">단어 클라우드</h3>
        <div className="h-32 flex items-center justify-center text-xs opacity-70">
          대화가 없습니다
        </div>
      </div>
    );
  }

  // Find max value for scaling
  const maxValue = Math.max(...words.map((w) => w.value));

  return (
    <div className="bg-gradient-to-br from-pink-500 to-pink-600 text-white p-4 rounded-lg shadow-lg">
      <h3 className="font-bold text-sm mb-3">단어 클라우드</h3>
      <div className="flex flex-wrap gap-2 h-32 overflow-hidden">
        {words.map((word) => {
          const size = 10 + (word.value / maxValue) * 18; // 10px to 28px
          return (
            <span
              key={word.text}
              className="opacity-90 whitespace-nowrap"
              style={{ fontSize: `${size}px`, fontWeight: word.value > 3 ? "bold" : "normal" }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
