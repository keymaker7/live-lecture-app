// 퀴즈 세트 — 한 줄에 한 문제 (설계서 §4-2)
//   OX | 지구는 태양 주위를 돈다 | O
//   객관식 | 우리나라 수도는? | 서울, 부산, 대구, 광주 | 1
//   단답 | 세종대왕이 만든 글자는? | 한글, 훈민정음
// 맨 끝에 "| 20초" 를 붙이면 그 문제만 제한 시간을 바꾼다(5~120초). # 으로 시작하는 줄은 메모.

export type QuizKind = "ox" | "mc" | "short";

export interface QuizQuestion {
  kind: QuizKind;
  text: string;
  /** 객관식 보기(2~4개). OX 는 ["O","X"] */
  options: string[];
  /** OX: 0=O 1=X, 객관식: 0부터 보기 번호. 단답은 -1 */
  answer: number;
  /** 단답 정답 후보(쉼표로 여러 개) */
  answers: string[];
  limitSec: number;
}

export interface QuizParseResult {
  questions: QuizQuestion[];
  errors: Array<{ line: number; message: string }>;
}

export const DEFAULT_LIMIT_SEC: Record<QuizKind, number> = { ox: 10, mc: 15, short: 20 };
export const MAX_QUESTIONS = 50;

const KIND_ALIASES: Record<string, QuizKind> = {
  ox: "ox", "o/x": "ox", 오엑스: "ox",
  객관식: "mc", 선택: "mc", mc: "mc", 사지선다: "mc",
  단답: "short", 단답형: "short", 주관식: "short", short: "short", 빨리맞히기: "short",
};

const O_WORDS = new Set(["o", "ㅇ", "오", "○", "⭕", "0", "맞다", "참"]);
const X_WORDS = new Set(["x", "ㅌ", "엑스", "✕", "×", "❌", "✖", "틀리다", "거짓"]);

function splitList(s: string): string[] {
  return s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
}

export function parseQuizSet(text: string): QuizParseResult {
  const questions: QuizQuestion[] = [];
  const errors: QuizParseResult["errors"] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (!line || line.startsWith("#")) return;
    const parts = line.split("|").map((p) => p.trim());

    let limitSec: number | null = null;
    const lastPart = parts[parts.length - 1];
    const timeMatch = /^(\d{1,3})\s*(초|s|sec)?$/i.exec(lastPart);
    if (parts.length >= 4 && timeMatch && (timeMatch[2] || parts.length >= 5 || KIND_ALIASES[parts[0].toLowerCase().replace(/\s/g, "")] !== "mc")) {
      limitSec = Number(timeMatch[1]);
      parts.pop();
    }
    if (limitSec !== null && (limitSec < 5 || limitSec > 120)) {
      errors.push({ line: no, message: "제한 시간은 5~120초" });
      return;
    }

    const kind = KIND_ALIASES[parts[0].toLowerCase().replace(/\s/g, "")];
    if (!kind) {
      errors.push({ line: no, message: "맨 앞은 OX / 객관식 / 단답 중 하나" });
      return;
    }
    const q = (parts[1] || "").slice(0, 200);
    if (!q) {
      errors.push({ line: no, message: "문제가 비어 있음" });
      return;
    }

    if (kind === "ox") {
      if (parts.length !== 3) {
        errors.push({ line: no, message: "OX | 문제 | O 또는 X" });
        return;
      }
      const a = parts[2].toLowerCase();
      const answer = O_WORDS.has(a) ? 0 : X_WORDS.has(a) ? 1 : -1;
      if (answer < 0) {
        errors.push({ line: no, message: "OX 정답은 O 또는 X" });
        return;
      }
      questions.push({ kind, text: q, options: ["O", "X"], answer, answers: [], limitSec: limitSec ?? DEFAULT_LIMIT_SEC.ox });
      return;
    }

    if (kind === "mc") {
      if (parts.length !== 4) {
        errors.push({ line: no, message: "객관식 | 문제 | 보기1, 보기2, … | 정답 번호" });
        return;
      }
      const options = splitList(parts[2]).map((o) => o.slice(0, 40));
      if (options.length < 2 || options.length > 4) {
        errors.push({ line: no, message: "보기는 2~4개(쉼표로 구분)" });
        return;
      }
      const n = Number(parts[3].replace(/[번①②③④]/g, (c) => ({ "①": "1", "②": "2", "③": "3", "④": "4" }[c] ?? "")));
      if (!Number.isInteger(n) || n < 1 || n > options.length) {
        errors.push({ line: no, message: `정답 번호는 1~${options.length}` });
        return;
      }
      questions.push({ kind, text: q, options, answer: n - 1, answers: [], limitSec: limitSec ?? DEFAULT_LIMIT_SEC.mc });
      return;
    }

    // 단답
    if (parts.length !== 3) {
      errors.push({ line: no, message: "단답 | 문제 | 정답(여러 개면 쉼표)" });
      return;
    }
    const answers = splitList(parts[2]).map((a) => a.slice(0, 40));
    if (!answers.length) {
      errors.push({ line: no, message: "정답이 비어 있음" });
      return;
    }
    questions.push({ kind, text: q, options: [], answer: -1, answers, limitSec: limitSec ?? DEFAULT_LIMIT_SEC.short });
  });

  if (questions.length > MAX_QUESTIONS) {
    errors.push({ line: 0, message: `한 세트는 ${MAX_QUESTIONS}문제까지 — 앞의 ${MAX_QUESTIONS}개만 씀` });
    questions.length = MAX_QUESTIONS;
  }
  return { questions, errors };
}

/** 세트를 다시 한 줄 형식으로 — 내보내기·편집칸 채우기 */
export function formatQuizSet(questions: QuizQuestion[]): string {
  return questions.map((q) => {
    const t = q.limitSec !== DEFAULT_LIMIT_SEC[q.kind] ? ` | ${q.limitSec}초` : "";
    if (q.kind === "ox") return `OX | ${q.text} | ${q.answer === 0 ? "O" : "X"}${t}`;
    if (q.kind === "mc") return `객관식 | ${q.text} | ${q.options.join(", ")} | ${q.answer + 1}${t}`;
    return `단답 | ${q.text} | ${q.answers.join(", ")}${t}`;
  }).join("\n");
}
