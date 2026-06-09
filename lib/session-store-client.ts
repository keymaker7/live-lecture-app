const SESSION_KEY = "slides-live-sessions";

export interface SavedSession {
  roomId: string;
  title?: string;
  savedAt: number;
  chats?: Array<{ message: string; nickname: string; timestamp: number }>;
  questions?: Array<{ text: string; nickname: string }>;
  [key: string]: unknown;
}

export function loadSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(data: Record<string, unknown>) {
  const sessions = loadSessions();
  const roomId = data.roomId as string;
  const existing = sessions.findIndex((s) => s.roomId === roomId);
  const entry = { ...data, savedAt: Date.now() } as SavedSession;
  if (existing >= 0) sessions[existing] = entry;
  else sessions.unshift(entry);
  if (sessions.length > 50) sessions.length = 50;
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  return entry;
}

export function searchSessions(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return loadSessions();
  return loadSessions().filter((s) => {
    const blob = JSON.stringify(s).toLowerCase();
    return (s.title || "").toLowerCase().includes(q) || s.roomId.includes(q) || blob.includes(q);
  });
}

export function deleteSession(roomId: string) {
  const sessions = loadSessions().filter((s) => s.roomId !== roomId);
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
}

export function extractKeywords(
  messages: Array<{ message?: string } | string>,
  limit = 30
) {
  const stop = new Set([
    "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "으로", "에서",
    "하다", "있다", "없다", "the", "a", "an", "is", "are", "to", "of", "in", "and", "or", "it",
  ]);
  const freq: Record<string, number> = {};
  for (const msg of messages) {
    const text = (typeof msg === "string" ? msg : msg.message || "").toLowerCase();
    const tokens = text.match(/[\uac00-\ud7a3]+|[a-zA-Z]{2,}/g) || [];
    for (const t of tokens) {
      if (t.length < 2 || stop.has(t)) continue;
      freq[t] = (freq[t] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function cacheRoom(roomId: string, data: Record<string, unknown>) {
  localStorage.setItem(`slides-room:${roomId}`, JSON.stringify(data));
}

export function getCachedRoom(roomId: string) {
  try {
    const raw = localStorage.getItem(`slides-room:${roomId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
