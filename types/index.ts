export interface ChatMessage {
  id: string;
  sessionId: string;
  nickname: string;
  message: string;
  timestamp: number;
}

export interface EmojiReaction {
  id: string;
  sessionId: string;
  nickname: string;
  emoji: string;
  timestamp: number;
}

export interface Poll {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  votes: Record<string, number>; // option index -> vote count
  createdAt: number;
  isActive: boolean;
}

export interface Question {
  id: string;
  sessionId: string;
  nickname: string;
  text: string;
  timestamp: number;
  isAnswered: boolean;
}

export interface SlideControlRequest {
  id: string;
  sessionId: string;
  type: "next" | "prev";
  timestamp: number;
}

export interface SessionRecord {
  sessionId: string;
  startTime: number;
  endTime?: number;
  slidesUrl: string;
  messages: ChatMessage[];
  reactions: EmojiReaction[];
  polls: Poll[];
  questions: Question[];
  slideRequests: SlideControlRequest[];
}

export type AllowedEmoji = "👏" | "❤️" | "😂" | "🤔" | "💡";
