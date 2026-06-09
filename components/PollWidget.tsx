"use client";

import { Poll } from "@/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

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
    <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-4 rounded-lg shadow-lg">
      <h3 className="font-bold text-sm mb-2 truncate">{poll.question}</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${value} votes`, "Votes"]}
            contentStyle={{ backgroundColor: "rgba(0,0,0,0.7)", border: "none", borderRadius: "4px" }}
          />
          <Bar dataKey="votes" fill="#fbbf24" />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs mt-2 opacity-90">총 {totalVotes}명 투표</p>
    </div>
  );
}
