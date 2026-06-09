"use client";

import { Poll } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface PollWidgetProps {
  poll: Poll;
}

export function PollWidget({ poll }: PollWidgetProps) {
  const totalVotes = Object.values(poll.votes).reduce((a, b) => a + b, 0);
  const data = poll.options.map((option, idx) => ({
    name: option,
    votes: poll.votes[idx] || 0,
  }));

  return (
    <div className="pastel-card p-4 w-80">
      <h3 className="font-bold text-sm text-[#4c4f69] mb-2 truncate">{poll.question}</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#fce7f3" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
          <Tooltip />
          <Bar dataKey="votes" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 mt-1 text-center">총 {totalVotes}명 투표</p>
    </div>
  );
}
