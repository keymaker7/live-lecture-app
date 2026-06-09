"use client";

import { Question } from "@/types";
import { motion, AnimatePresence } from "framer-motion";

interface QuestionsPanelProps {
  questions: Question[];
  onMarkAnswered: (questionId: string) => void;
}

export function QuestionsPanel({ questions, onMarkAnswered }: QuestionsPanelProps) {
  const unanswered = questions.filter((q) => !q.isAnswered);
  const answered = questions.filter((q) => q.isAnswered);

  return (
    <div className="bg-gray-800 rounded-lg p-4 max-h-96 overflow-y-auto">
      <h3 className="text-lg font-bold text-white mb-3">
        질문 큐 ({unanswered.length}/{questions.length})
      </h3>

      {unanswered.length === 0 && answered.length === 0 ? (
        <p className="text-gray-400 text-sm">질문이 없습니다</p>
      ) : null}

      <div>
        <h4 className="text-sm font-semibold text-yellow-400 mb-2">
          {unanswered.length > 0 ? "답변 대기 중" : "모두 답변 완료!"}
        </h4>
        <AnimatePresence>
          {unanswered.map((question) => (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-gray-700 p-3 rounded-lg mb-2 border-l-4 border-yellow-400"
            >
              <p className="text-xs text-gray-400 mb-1">
                {question.nickname} •{" "}
                {new Date(question.timestamp).toLocaleTimeString()}
              </p>
              <p className="text-sm text-white mb-2">{question.text}</p>
              <button
                onClick={() => onMarkAnswered(question.id)}
                className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition"
              >
                ✓ 답변 완료
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {answered.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-600">
          <h4 className="text-sm font-semibold text-green-400 mb-2">
            답변 완료 ({answered.length})
          </h4>
          <AnimatePresence>
            {answered.map((question) => (
              <motion.div
                key={question.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                className="bg-gray-700 p-2 rounded-lg mb-1 opacity-50 border-l-4 border-green-400"
              >
                <p className="text-xs text-gray-500 line-through">{question.text}</p>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
