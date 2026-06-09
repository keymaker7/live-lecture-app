"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cacheRoom } from "@/lib/session-store-client";

export function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"url" | "canva">("url");
  const [slideUrl, setSlideUrl] = useState("");
  const [canvaEmbed, setCanvaEmbed] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [networkHint, setNetworkHint] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [netRes, cfgRes] = await Promise.all([
          fetch("/api/network"),
          fetch("/api/config"),
        ]);
        const net = await netRes.json();
        const cfg = await cfgRes.json();
        const parts: string[] = [];
        if (net.lanIp) parts.push(`모바일: http://${net.lanIp}:${net.port}`);
        if (cfg.supabaseEnabled) parts.push("☁️ Supabase 연결됨");
        else parts.push("💻 로컬 Socket.io 모드 (Supabase URL 설정 시 클라우드 배포 가능)");
        setNetworkHint(parts.join(" · "));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const getSlideInput = () => (activeTab === "canva" ? canvaEmbed.trim() : slideUrl.trim());

  const handleStart = async () => {
    const input = getSlideInput();
    if (!input) {
      setError(activeTab === "canva" ? "캔바 Embed HTML 코드를 붙여넣어주세요." : "슬라이드 URL을 입력해주세요.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideUrl: input, title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "연수 생성에 실패했습니다.");
        return;
      }
      cacheRoom(data.roomId, { ...data, title: title.trim() || "연수", slideUrl: input });
      router.push(`/presenter?room=${data.roomId}`);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page">
    <div className="home-container">
      <header className="home-header">
        <div className="logo">🌸</div>
        <h1>슬라이드 연수 ✨</h1>
        <p className="subtitle">구글 슬라이드 · 캔바를 공유하고, QR로 모두를 초대해요</p>
      </header>

      <main className="home-card">
        <div className="input-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === "url" ? "active" : ""}`}
            onClick={() => setActiveTab("url")}
          >
            URL 입력
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "canva" ? "active" : ""}`}
            onClick={() => setActiveTab("canva")}
          >
            캔바 Embed 코드
          </button>
        </div>

        <div className={`tab-panel ${activeTab === "url" ? "active" : ""}`} id="tab-url">
          <label htmlFor="slideUrl">슬라이드 URL</label>
          <input
            type="url"
            id="slideUrl"
            placeholder="https://docs.google.com/presentation/d/... 또는 Canva URL"
            autoComplete="off"
            value={slideUrl}
            onChange={(e) => setSlideUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
          />
          <p className="input-hint">캔바: 공유 링크 전체를 붙여넣으세요 (…/design/ID/…/view)</p>
        </div>

        <div className={`tab-panel ${activeTab === "canva" ? "active" : ""}`} id="tab-canva">
          <label htmlFor="canvaEmbed">캔바 Embed HTML 코드</label>
          <textarea
            id="canvaEmbed"
            rows={5}
            placeholder="공유 → Embed → HTML 코드를 붙여넣으세요"
            value={canvaEmbed}
            onChange={(e) => setCanvaEmbed(e.target.value)}
          />
          <p className="input-hint canva-guide">
            캔바에서 <strong>공유 → Embed → Embed(공개)</strong>를 선택한 뒤 HTML 코드를 복사하세요.
            비공개 디자인은 403 오류가 납니다.
          </p>
        </div>

        <label htmlFor="title">연수 제목 (선택)</label>
        <input
          type="text"
          id="title"
          placeholder="예: 2026 디지털 리터러시 연수"
          maxLength={50}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleStart()}
        />

        <button
          type="button"
          id="startBtn"
          className="btn-primary btn-large"
          onClick={handleStart}
          disabled={loading}
        >
          {loading ? "준비 중..." : "▶ 연수 시작"}
        </button>

        <p className={`error-msg ${error ? "" : "hidden"}`}>{error}</p>
        {networkHint && <p className="network-hint">{networkHint}</p>}
      </main>

      <footer className="home-footer">
        <div className="feature-list">
          <div className="feature"><span>📱</span> QR 코드로 간편 참여</div>
          <div className="feature"><span>😊</span> 실시간 이모지 반응</div>
          <div className="feature"><span>💬</span> 채팅 메시지 오버레이</div>
        </div>
      </footer>
    </div>
    </div>
  );
}
