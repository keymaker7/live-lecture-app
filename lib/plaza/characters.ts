import data from "@/public/characters/characters.json";

// 캐릭터 53장(동물 50 + 알 2 + 강사 로봇). 그림은 public/characters/*.webp (높이 400px, 투명 배경).
export interface CharacterInfo {
  id: string;
  name: string;
  kind: "animal" | "egg" | "host";
  file: string;
  w: number;
  h: number;
}

export const CHARACTERS = data as CharacterInfo[];
export const ANIMALS = CHARACTERS.filter((c) => c.kind === "animal");
const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

export const EGG = byId.get("e01_egg")!;
export const EGG_CRACK = byId.get("e02_egg_crack")!;
export const TEACHER = byId.get("h01_teacher")!;

export function characterById(id: string | undefined | null): CharacterInfo | undefined {
  return id ? byId.get(id) : undefined;
}

/** 안 고르면 닉네임으로 정한다(FNV-1a) — 같은 닉네임은 늘 같은 동물. */
export function characterForNickname(nickname: string): CharacterInfo {
  let h = 0x811c9dc5;
  for (let i = 0; i < nickname.length; i++) {
    h ^= nickname.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ANIMALS[(h >>> 0) % ANIMALS.length];
}

/** 참가자가 보낸 값이 진짜 동물 id 일 때만 쓰고, 아니면 닉네임으로. */
export function resolveCharacter(requested: unknown, nickname: string): string {
  const c = typeof requested === "string" ? byId.get(requested) : undefined;
  return c && c.kind === "animal" ? c.id : characterForNickname(nickname).id;
}

/** 레벨 = 1 + floor(활동점수/3) — 채팅 1, 반응 0.5, 질문 2, 투표 1 (설계서 §3-3) */
export function activityLevel(p: { chats: number; reactions: number; questions: number; votes: number }): number {
  const points = p.chats + p.reactions * 0.5 + p.questions * 2 + p.votes;
  return 1 + Math.floor(points / 3);
}
