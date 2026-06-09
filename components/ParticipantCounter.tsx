"use client";

import { motion } from "framer-motion";

interface ParticipantCounterProps {
  count: number;
}

export function ParticipantCounter({ count }: ParticipantCounterProps) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="bg-gradient-to-br from-green-500 to-green-600 text-white p-4 rounded-lg shadow-lg text-center"
    >
      <p className="text-xs opacity-80">현재 참가자</p>
      <motion.div
        key={count}
        initial={{ scale: 1.2 }}
        animate={{ scale: 1 }}
        className="text-3xl font-bold"
      >
        {count}명
      </motion.div>
    </motion.div>
  );
}
