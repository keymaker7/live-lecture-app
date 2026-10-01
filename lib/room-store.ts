import { v4 as uuidv4 } from "uuid";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

// 연수 정보는 DB(lecture_rooms)에 저장한다.
// 서버 메모리만 쓰던 때는 Vercel 서버가 바뀌거나 식으면 연수가 사라져서,
// 만든 컴퓨터 말고는 「연수를 찾을 수 없습니다」가 떴다.
// 메모리는 같은 서버가 다시 받을 때 DB를 덜 부르는 캐시로만 남긴다.
// 공개(anon) 키뿐이라 표는 잠가 두고 create_lecture_room / get_lecture_room 함수로만 다룬다.
let db: SupabaseClient | null | undefined;
function getDb(): SupabaseClient | null {
  if (db !== undefined) return db;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return db;
}

function blankRoom(data: {
  id: string;
  title: string;
  slideUrl: string;
  slideType: string;
  embedUrl?: string | null;
  canvaDesignId?: string | null;
  canvaViewUrl?: string | null;
  createdAt?: number;
}): Room {
  return {
    id: data.id,
    title: data.title || "연수",
    slideUrl: data.slideUrl,
    slideType: data.slideType,
    embedUrl: data.embedUrl ?? null,
    canvaDesignId: data.canvaDesignId ?? null,
    canvaViewUrl: data.canvaViewUrl ?? null,
    createdAt: data.createdAt ?? Date.now(),
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
}

export async function createRoom(data: {
  title: string;
  slideUrl: string;
  slideType: string;
  embedUrl?: string | null;
  canvaDesignId?: string | null;
  canvaViewUrl?: string | null;
}): Promise<Room> {
  const room = blankRoom({ ...data, id: uuidv4().replace(/-/g, "").slice(0, 8) });
  const client = getDb();
  if (client) {
    const { error } = await client.rpc("create_lecture_room", {
      p_id: room.id,
      p_title: room.title,
      p_slide_url: room.slideUrl,
      p_slide_type: room.slideType,
      p_embed_url: room.embedUrl,
      p_canva_design_id: room.canvaDesignId,
      p_canva_view_url: room.canvaViewUrl,
    });
    // 저장이 안 되면 다른 컴퓨터에서 못 연다 — 조용히 넘기지 않고 실패로 돌려준다.
    if (error) throw new Error(`연수 저장 실패: ${error.message}`);
  }
  getRooms().set(room.id, room);
  return room;
}

export async function getRoom(roomId: string): Promise<Room | undefined> {
  const cached = getRooms().get(roomId);
  if (cached) return cached;
  const client = getDb();
  if (!client || !/^[0-9a-f]{8}$/.test(roomId)) return undefined;
  const { data, error } = await client.rpc("get_lecture_room", { p_id: roomId });
  if (error) {
    console.error("[room-store] 연수 읽기 실패", error.message);
    return undefined;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const room = blankRoom({
    id: row.id as string,
    title: row.title as string,
    slideUrl: row.slide_url as string,
    slideType: row.slide_type as string,
    embedUrl: (row.embed_url as string | null) ?? null,
    canvaDesignId: (row.canva_design_id as string | null) ?? null,
    canvaViewUrl: (row.canva_view_url as string | null) ?? null,
    createdAt: Date.parse(row.created_at as string) || Date.now(),
  });
  getRooms().set(room.id, room);
  return room;
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
