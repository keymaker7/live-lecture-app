"use client";

import { useMemo } from "react";
import { EmojiReaction } from "@/types";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface EngagementChartProps {
  reactions: EmojiReaction[];
}

export function EngagementChart({ reactions }: EngagementChartProps) {
  const data = useMemo(() => {
    // Group reactions by 10-second intervals
    const intervals = new Map<number, number>();

    reactions.forEach((reaction) => {
      const interval = Math.floor(reaction.timestamp / 10000);
      intervals.set(interval, (intervals.get(interval) || 0) + 1);
    });

    // Convert to sorted array
    return Array.from(intervals.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([interval, count], idx) => ({
        time: `${idx * 10}초`,
        engagement: count,
      }))
      .slice(-20); // Last 20 intervals
  }, [reactions]);

  if (data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white p-4 rounded-lg shadow-lg">
        <h3 className="font-bold text-sm mb-3">집중도 추이</h3>
        <div className="h-24 flex items-center justify-center text-xs opacity-70">
          반응이 없습니다
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white p-4 rounded-lg shadow-lg">
      <h3 className="font-bold text-sm mb-3">집중도 추이</h3>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${value} 반응`, "이모티콘"]}
            contentStyle={{ backgroundColor: "rgba(0,0,0,0.7)", border: "none", borderRadius: "4px" }}
          />
          <Line
            type="monotone"
            dataKey="engagement"
            stroke="#fbbf24"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
