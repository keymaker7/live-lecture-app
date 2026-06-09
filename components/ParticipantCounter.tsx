"use client";

import { motion } from "framer-motion";

interface ParticipantCounterProps {
  count: number;
}

export function ParticipantCounter({ count }: ParticipantCounterProps) {
  return (
    <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center py-2">
      <p className="text-xs text-gray-400 font-semibold">👥 참여 중</p>
      <motion.div key={count} initial={{ scale: 1.2 }} animate={{ scale: 1 }} className="text-2xl font-extrabold text-purple-400">
        {count}명
      </motion.div>
    </motion.div>
  );
}
