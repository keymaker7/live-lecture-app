"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface TimerWidgetProps {
  onClose?: () => void;
}

export function TimerWidget({ onClose }: TimerWidgetProps) {
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [inputMinutes, setInputMinutes] = useState("5");

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSeconds((prev) => {
        if (prev === 0) {
          setMinutes((m) => { if (m === 0) { setIsRunning(false); return 0; } return m - 1; });
          return 59;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const displayTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="pastel-card p-4 w-52">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-sm text-[#4c4f69]">⏱️ 타이머</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
      <div className="text-3xl font-mono font-extrabold text-center text-purple-400 mb-3">{displayTime}</div>
      {!isRunning && (
        <div className="flex gap-2 mb-2">
          <input type="number" min="0" max="99" value={inputMinutes} onChange={(e) => setInputMinutes(e.target.value)} className="pastel-input flex-1 !py-1 text-center text-sm" />
          <button onClick={() => { setMinutes(Math.max(0, parseInt(inputMinutes) || 0)); setSeconds(0); }} className="pastel-btn-sm text-xs px-2">설정</button>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => setIsRunning(!isRunning)} className="pastel-btn-sm flex-1">{isRunning ? "정지" : "시작"}</button>
        <button onClick={() => { setIsRunning(false); setMinutes(parseInt(inputMinutes) || 5); setSeconds(0); }} className="pastel-btn-sm flex-1">리셋</button>
      </div>
    </motion.div>
  );
}
