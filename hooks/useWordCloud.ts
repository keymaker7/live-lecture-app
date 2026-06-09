"use client";

import { useMemo } from "react";
import { ChatMessage } from "@/types";

interface WordData {
  text: string;
  value: number;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "한국",
  "좋아",
  "네",
  "감",
  "거",
  "등",
  "것",
  "수",
  "어",
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
  "와",
  "으로",
  "에서",
  "에",
  "들",
  "해",
  "게",
  "했",
  "같",
  "보",
  "그",
  "있",
  "하",
  "쿠",
  "않",
  "하",
  "너",
  "저",
  "우리",
  "저희",
  "너희",
  "그들",
  "그녀",
  "그",
  "그것",
  "이것",
  "그거",
  "이거",
  "여기",
  "거기",
  "어디",
  "지금",
  "오늘",
  "내일",
  "어제",
  "언제",
  "어떻게",
  "어디",
  "뭐",
  "뭘",
  "뭐하",
  "뭐야",
]);

export function useWordCloud(messages: ChatMessage[]): WordData[] {
  return useMemo(() => {
    const wordCounts = new Map<string, number>();

    messages.forEach((msg) => {
      // Extract words (simple split on spaces and punctuation)
      const words = msg.message
        .toLowerCase()
        .split(/[\s\p{P}]+/u)
        .filter(
          (word) =>
            word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)
        );

      words.forEach((word) => {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      });
    });

    // Convert to array and sort by frequency
    const sortedWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30); // Top 30 words

    return sortedWords.map(([text, value]) => ({ text, value }));
  }, [messages]);
}
