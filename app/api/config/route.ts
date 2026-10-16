import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return NextResponse.json({
    supabaseUrl: supabaseUrl || null,
    supabaseKey: supabaseKey || null,
    supabaseEnabled: !!(supabaseUrl && supabaseKey),
    realtimeMode: supabaseUrl && supabaseKey ? "supabase" : "broadcast",
    // 게임 결과 DB 저장 — 마이그레이션 20261016000000 을 운영 DB 에 적용한 뒤에만 켠다(LL_RESULTS_DB=1)
    resultsDb: !!(supabaseUrl && supabaseKey) && process.env.LL_RESULTS_DB === "1",
  });
}
