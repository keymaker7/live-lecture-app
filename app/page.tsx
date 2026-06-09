"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-emerald-50 px-4">
      <div className="text-center max-w-2xl w-full">
        <div className="text-5xl mb-3">🌸</div>
        <h1 className="text-4xl font-extrabold text-[#4c4f69] mb-2">슬라이드 연수 ✨</h1>
        <p className="text-lg text-gray-500 mb-10">
          구글 슬라이드 · 캔바를 공유하고, QR로 모두를 초대해요
        </p>

        <div className="grid md:grid-cols-2 gap-5">
          <Link href="/presenter">
            <div className="bg-white/90 border-2 border-pink-100 rounded-2xl shadow-lg shadow-purple-100 p-8 hover:shadow-xl hover:scale-[1.02] transition cursor-pointer">
              <div className="text-4xl mb-3">🎤</div>
              <h2 className="text-xl font-bold text-[#4c4f69] mb-2">발표자 모드</h2>
              <p className="text-gray-500 text-sm mb-4">
                슬라이드를 공유하고 실시간 반응을 확인하세요
              </p>
              <span className="inline-block bg-gradient-to-r from-pink-300 to-purple-300 text-white font-bold py-2 px-6 rounded-xl">
                ▶ 연수 시작
              </span>
            </div>
          </Link>

          <div className="bg-white/90 border-2 border-pink-100 rounded-2xl shadow-lg shadow-purple-100 p-8">
            <div className="text-4xl mb-3">📱</div>
            <h2 className="text-xl font-bold text-[#4c4f69] mb-2">참가자 모드</h2>
            <p className="text-gray-500 text-sm mb-4">
              QR을 스캔하고 이모지·채팅으로 참여하세요
            </p>
            <span className="inline-block bg-gray-200 text-gray-500 font-bold py-2 px-6 rounded-xl">
              QR 스캔 필요
            </span>
          </div>
        </div>

        <div className="mt-10 p-6 bg-white/80 border-2 border-pink-100 rounded-2xl shadow-md text-left">
          <h3 className="text-base font-bold text-[#4c4f69] mb-3">기능</h3>
          <ul className="text-gray-500 text-sm space-y-1.5">
            <li>📊 실시간 투표 · 막대 차트</li>
            <li>🙋 질문 큐 · 답변 완료 체크</li>
            <li>😊 이모지 반응 · 💬 채팅</li>
            <li>📝 워드클라우드 · 🎯 집중도 차트</li>
            <li>⏱️ 타이머 · 📱 슬라이드 요청</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
