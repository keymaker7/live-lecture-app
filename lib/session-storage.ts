import {
  ChatMessage,
  EmojiReaction,
  Poll,
  Question,
  SessionRecord,
  SlideControlRequest,
} from "@/types";

const SESSION_STORAGE_KEY = "lecture_sessions";
const CURRENT_SESSION_KEY = "current_session_id";

export function getCurrentSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(SESSION_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveSession(session: SessionRecord): void {
  if (typeof window === "undefined") return;
  const sessions = getCurrentSessions();
  const index = sessions.findIndex((s) => s.sessionId === session.sessionId);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.push(session);
  }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export function getSession(sessionId: string): SessionRecord | null {
  if (typeof window === "undefined") return null;
  const sessions = getCurrentSessions();
  return sessions.find((s) => s.sessionId === sessionId) || null;
}

export function createEmptySession(
  sessionId: string,
  slidesUrl: string
): SessionRecord {
  return {
    sessionId,
    startTime: Date.now(),
    slidesUrl,
    messages: [],
    reactions: [],
    polls: [],
    questions: [],
    slideRequests: [],
  };
}

export function addChatMessage(
  sessionId: string,
  message: ChatMessage
): void {
  const session = getSession(sessionId);
  if (session) {
    session.messages.push(message);
    saveSession(session);
  }
}

export function addReaction(sessionId: string, reaction: EmojiReaction): void {
  const session = getSession(sessionId);
  if (session) {
    session.reactions.push(reaction);
    saveSession(session);
  }
}

export function addPoll(sessionId: string, poll: Poll): void {
  const session = getSession(sessionId);
  if (session) {
    session.polls.push(poll);
    saveSession(session);
  }
}

export function updatePoll(sessionId: string, poll: Poll): void {
  const session = getSession(sessionId);
  if (session) {
    const index = session.polls.findIndex((p) => p.id === poll.id);
    if (index >= 0) {
      session.polls[index] = poll;
      saveSession(session);
    }
  }
}

export function addQuestion(sessionId: string, question: Question): void {
  const session = getSession(sessionId);
  if (session) {
    session.questions.push(question);
    saveSession(session);
  }
}

export function updateQuestion(sessionId: string, question: Question): void {
  const session = getSession(sessionId);
  if (session) {
    const index = session.questions.findIndex((q) => q.id === question.id);
    if (index >= 0) {
      session.questions[index] = question;
      saveSession(session);
    }
  }
}

export function addSlideRequest(
  sessionId: string,
  request: SlideControlRequest
): void {
  const session = getSession(sessionId);
  if (session) {
    session.slideRequests.push(request);
    saveSession(session);
  }
}

export function endSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (session) {
    session.endTime = Date.now();
    saveSession(session);
  }
}

export function searchSessions(query: string): SessionRecord[] {
  if (typeof window === "undefined") return [];
  const sessions = getCurrentSessions();
  const lowerQuery = query.toLowerCase();

  return sessions.filter((session) => {
    const messageMatch = session.messages.some(
      (m) =>
        m.nickname.toLowerCase().includes(lowerQuery) ||
        m.message.toLowerCase().includes(lowerQuery)
    );
    const questionMatch = session.questions.some((q) =>
      q.text.toLowerCase().includes(lowerQuery)
    );
    const nickMatch = session.messages.some((m) =>
      m.nickname.toLowerCase().includes(lowerQuery)
    );

    return messageMatch || questionMatch || nickMatch;
  });
}
