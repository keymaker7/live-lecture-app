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
          setMinutes((m) => {
            if (m === 0) {
              setIsRunning(false);
              return 0;
            }
            return m - 1;
          });
          return 59;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const handleSetTime = () => {
    const newMinutes = Math.max(0, Math.min(99, parseInt(inputMinutes) || 0));
    setMinutes(newMinutes);
    setSeconds(0);
    setIsRunning(false);
  };

  const displayTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      className="bg-gradient-to-br from-orange-500 to-red-600 text-white p-4 rounded-lg shadow-lg"
    >
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-sm">타이머</h3>
        <button
          onClick={onClose}
          className="text-xs opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>

      <div className="text-center mb-3">
        <div className="text-4xl font-mono font-bold">{displayTime}</div>
      </div>

      {!isRunning ? (
        <div className="flex gap-2 mb-2">
          <input
            type="number"
            min="0"
            max="99"
            value={inputMinutes}
            onChange={(e) => setInputMinutes(e.target.value)}
            className="flex-1 px-2 py-1 bg-white bg-opacity-20 text-white text-center rounded text-sm focus:outline-none"
            placeholder="분"
          />
          <button
            onClick={handleSetTime}
            className="px-2 py-1 bg-white bg-opacity-20 hover:bg-opacity-30 rounded text-xs font-semibold transition"
          >
            설정
          </button>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          onClick={() => setIsRunning(!isRunning)}
          className="flex-1 px-3 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded font-semibold text-sm transition"
        >
          {isRunning ? "중지" : "시작"}
        </button>
        <button
          onClick={() => {
            setIsRunning(false);
            setMinutes(parseInt(inputMinutes) || 5);
            setSeconds(0);
          }}
          className="flex-1 px-3 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded font-semibold text-sm transition"
        >
          리셋
        </button>
      </div>
    </motion.div>
  );
}
