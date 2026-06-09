import { v4 as uuidv4 } from "uuid";

export interface PollOption {
  text: string;
  votes: number;
}

export interface RoomPoll {
  id: string;
  question: string;
  options: PollOption[];
  voters: Set<string>;
  active: boolean;
  createdAt: number;
}

export interface RoomQuestion {
  id: string;
  text: string;
  nickname: string;
  timestamp: number;
  answered: boolean;
}

export interface FocusBucket {
  time: number;
  count: number;
}

export interface Room {
  id: string;
  title: string;
  slideUrl: string;
  slideType: string;
  embedUrl: string | null;
  canvaDesignId: string | null;
  canvaViewUrl: string | null;
  createdAt: number;
  participants: Map<string, { id: string; nickname: string; joinedAt: number }>;
  reactionStats: Record<string, number>;
  recentChats: Array<{ message: string; nickname: string; id: string; timestamp: number }>;
  allChats: Array<{ message: string; nickname: string; id: string; timestamp: number }>;
  allReactions: Array<{ emoji: string; nickname: string; id: string; timestamp: number }>;
  allPolls: Array<Record<string, unknown>>;
  poll: RoomPoll | null;
  questions: RoomQuestion[];
  slideRequests: { next: number; prev: number };
  focusTimeline: FocusBucket[];
}

const FOCUS_BUCKET_MS = 30000;

const globalStore = globalThis as typeof globalThis & { __slidesRooms?: Map<string, Room> };

function getRooms() {
  if (!globalStore.__slidesRooms) globalStore.__slidesRooms = new Map();
  return globalStore.__slidesRooms;
}

export function createRoom(data: {
  title: string;
  slideUrl: string;
  slideType: string;
  embedUrl?: string | null;
  canvaDesignId?: string | null;
  canvaViewUrl?: string | null;
}): Room {
  const roomId = uuidv4().slice(0, 8);
  const room: Room = {
    id: roomId,
    title: data.title || "연수",
    slideUrl: data.slideUrl,
    slideType: data.slideType,
    embedUrl: data.embedUrl ?? null,
    canvaDesignId: data.canvaDesignId ?? null,
    canvaViewUrl: data.canvaViewUrl ?? null,
    createdAt: Date.now(),
    participants: new Map(),
    reactionStats: {},
    recentChats: [],
    allChats: [],
    allReactions: [],
    allPolls: [],
    poll: null,
    questions: [],
    slideRequests: { next: 0, prev: 0 },
    focusTimeline: [],
  };
  getRooms().set(roomId, room);
  return room;
}

export function getRoom(roomId: string) {
  return getRooms().get(roomId);
}

export function getFocusBucket(room: Room) {
  const now = Date.now();
  const key = Math.floor(now / FOCUS_BUCKET_MS) * FOCUS_BUCKET_MS;
  let bucket = room.focusTimeline.find((b) => b.time === key);
  if (!bucket) {
    bucket = { time: key, count: 0 };
    room.focusTimeline.push(bucket);
    if (room.focusTimeline.length > 120) room.focusTimeline.shift();
  }
  return bucket;
}

export function getRoomState(room: Room) {
  return {
    poll: room.poll
      ? {
          id: room.poll.id,
          question: room.poll.question,
          options: room.poll.options.map((o) => ({ text: o.text, votes: o.votes })),
          active: room.poll.active,
        }
      : null,
    questions: room.questions,
    slideRequests: { ...room.slideRequests },
    focusTimeline: [...room.focusTimeline],
    participantCount: room.participants.size,
    reactionStats: { ...room.reactionStats },
  };
}

export function serializeRoom(room: Room) {
  return {
    id: room.id,
    title: room.title,
    slideType: room.slideType,
    embedUrl: room.embedUrl,
    canvaDesignId: room.canvaDesignId,
    canvaViewUrl: room.canvaViewUrl,
    slideUrl: room.slideUrl,
    ...getRoomState(room),
  };
}
