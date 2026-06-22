import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3030";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const joinUrl = `${proto}://${host}/join/${roomId}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#4c4f69", light: "#ffffff" },
    });
    return NextResponse.json({ joinUrl, qrDataUrl, lanIp: null, port: null });
  } catch {
    return NextResponse.json({ error: "QR 코드 생성 실패" }, { status: 500 });
  }
}
