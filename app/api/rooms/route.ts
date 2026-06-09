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

  const room = createRoom({
    title: title || "연수",
    slideUrl,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl ?? null,
    canvaDesignId: parsed.designId ?? null,
    canvaViewUrl: parsed.viewUrl ?? null,
  });

  return NextResponse.json({
    roomId: room.id,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl,
    canvaDesignId: parsed.designId,
    canvaViewUrl: parsed.viewUrl,
  });
}
