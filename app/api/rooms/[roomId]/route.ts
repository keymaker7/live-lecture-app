import { NextRequest, NextResponse } from "next/server";
import { getRoom, serializeRoom } from "@/lib/room-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: "연수를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json(serializeRoom(room));
}
