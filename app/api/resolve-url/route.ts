import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "no url" }, { status: 400 });
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return NextResponse.json({ resolved: res.url });
  } catch {
    return NextResponse.json({ resolved: url });
  }
}
