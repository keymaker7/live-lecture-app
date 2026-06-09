import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ lanIp: null, port: null, joinBase: null });
}
