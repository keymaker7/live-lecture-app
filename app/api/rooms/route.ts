import { NextRequest, NextResponse } from "next/server";
import { parseSlideInput } from "@/lib/slides-parser";
import { createRoom } from "@/lib/room-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slideUrl, title } = body;
  if (!slideUrl) {
    return NextResponse.json({ error: "슬라이드 URL이 필요합니다." }, { status: 400 });
  }

  const parsed = await parseSlideInput(slideUrl);
  if (!parsed) {
    return NextResponse.json({ error: "슬라이드 URL을 인식할 수 없습니다." }, { status: 400 });
  }

  let room;
  try {
    room = await createRoom({
    title: title || "연수",
    slideUrl,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl ?? null,
    canvaDesignId: parsed.designId ?? null,
    canvaViewUrl: parsed.viewUrl ?? null,
    });
  } catch (e) {
    console.error("[rooms] 연수 만들기 실패", e);
    return NextResponse.json({ error: "연수를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  return NextResponse.json({
    roomId: room.id,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl,
    canvaDesignId: parsed.designId,
    canvaViewUrl: parsed.viewUrl,
  });
}
