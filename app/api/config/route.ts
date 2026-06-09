import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return NextResponse.json({
    supabaseUrl: supabaseUrl || null,
    supabaseKey: supabaseKey || null,
    supabaseEnabled: !!(supabaseUrl && supabaseKey),
    realtimeMode: supabaseUrl && supabaseKey ? "supabase" : "broadcast",
  });
}
