"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Script from "next/script";
import Link from "next/link";
import { useSlidesRealtime } from "@/hooks/useSlidesRealtime";
import {
  saveSession,
  searchSessions,
  deleteSession,
  extractKeywords,
  getCachedRoom,
} from "@/lib/session-store-client";

interface RoomData {
  id: string;
  title: string;
  slideType: string;
  embedUrl?: string | null;
  canvaDesignId?: string | null;
  canvaViewUrl?: string | null;
  slideUrl: string;
  participantCount?: number;
  reactionStats?: Record<string, number>;
  focusTimeline?: Array<{ time: number; count: number }>;
}

interface PresentPageProps {
  roomId: string;
}

export function PresentPage({ roomId }: PresentPageProps) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slideReady, setSlideReady] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackDesc, setFallbackDesc] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [participantCount, setParticipantCount] = useState(0);
  const [reactionStats, setReactionStats] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Array<{ id: string; emoji: string; nickname: string; left: number; bottom: number }>>([]);
  const [chats, setChats] = useState<Array<{ id: string; message: string; nickname: string; timestamp: number }>>([]);
  const [activityLog, setActivityLog] = useState<Array<{ nickname: string; message: string; timestamp: number }>>([]);
  const [allChats, setAllChats] = useState<Array<{ message: string }>>([]);
  const [poll, setPoll] = useState<{
    id: string;
    question: string;
    options: Array<{ text: string; votes: number }>;
    active: boolean;
  } | null>(null);
  const [questions, setQuestions] = useState<Array<{ id: string; text: string; nickname: string; timestamp: number; answered: boolean }>>([]);
  const [slideReq, setSlideReq] = useState({ next: 0, prev: 0 });
  const [focusTimeline, setFocusTimeline] = useState<Array<{ time: number; count: number }>>([]);
  const [qrCollapsed, setQrCollapsed] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState("poll");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [timerMin, setTimerMin] = useState(5);
  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [showTimerBadge, setShowTimerBadge] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [copyLabel, setCopyLabel] = useState("링크 복사");
  const [saveLabel, setSaveLabel] = useState("세션 저장");

  const wordCanvasRef = useRef<HTMLCanvasElement>(null);
  const focusCanvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvaContainerRef = useRef<HTMLDivElement>(null);

  const { on, emit, ready, setInitialState } = useSlidesRealtime(roomId, "presenter");

  const fmtTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const renderWordCloud = useCallback(() => {
    const canvas = wordCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const keywords = extractKeywords(allChats, 20);
    if (!keywords.length) {
      ctx.fillStyle = "#9898b0";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("채팅이 쌓이면 표시됩니다", canvas.width / 2, canvas.height / 2);
      return;
    }
    const max = keywords[0].count;
    const colors = ["#c4b5fd", "#86efac", "#fca5a5", "#fbbf24", "#38bdf8", "#c084fc"];
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    keywords.forEach((kw, i) => {
      const size = 12 + (kw.count / max) * 22;
      ctx.font = `bold ${size}px sans-serif`;
      const w = ctx.measureText(kw.word).width;
      const h = size;
      let x = 0, y = 0, ok = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        x = Math.random() * (canvas.width - w - 10) + 5;
        y = Math.random() * (canvas.height - h - 10) + h;
        ok = !placed.some((p) => Math.abs(p.x - x) < p.w + 4 && Math.abs(p.y - y) < p.h + 4);
        if (ok) break;
      }
      if (!ok) return;
      placed.push({ x, y, w, h });
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillText(kw.word, x, y);
    });
  }, [allChats]);

  const renderFocusChart = useCallback(() => {
    const canvas = focusCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!focusTimeline.length) {
      ctx.fillStyle = "#9898b0";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("반응이 쌓이면 표시됩니다", w / 2, h / 2);
      return;
    }
    const data = focusTimeline.slice(-20);
    const max = Math.max(...data.map((d) => d.count), 1);
    const pad = 20;
    const chartW = w - pad * 2;
    const chartH = h - pad * 2;
    ctx.strokeStyle = "#fce7f3";
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
    ctx.strokeStyle = "#c4b5fd";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = pad + (i / Math.max(data.length - 1, 1)) * chartW;
      const y = h - pad - (d.count / max) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [focusTimeline]);

  useEffect(() => { renderWordCloud(); }, [allChats, renderWordCloud, dockTab]);
  useEffect(() => { renderFocusChart(); }, [focusTimeline, renderFocusChart, dockTab]);

  useEffect(() => {
    document.body.className = "present-page";
    return () => {
      document.body.className = "";
    };
  }, []);

  useEffect(() => {
    (async () => {
      let roomData: RoomData | null = null;
      try {
        const res = await fetch(`/api/rooms/${roomId}`);
        if (res.ok) roomData = await res.json();
      } catch { /* fallback */ }
      if (!roomData) roomData = getCachedRoom(roomId) as RoomData | null;
      if (!roomData) {
        alert("연수를 찾을 수 없습니다.");
        window.location.href = "/";
        return;
      }
      setRoom(roomData);
      setParticipantCount(roomData.participantCount || 0);
      setReactionStats(roomData.reactionStats || {});
      setFocusTimeline(roomData.focusTimeline || []);
      setInitialState({
        participantCount: roomData.participantCount || 0,
        reactionStats: roomData.reactionStats || {},
        focusTimeline: roomData.focusTimeline || [],
      });

      const qrRes = await fetch(`/api/rooms/${roomId}/qr`);
      if (qrRes.ok) {
        const qr = await qrRes.json();
        setJoinUrl(qr.joinUrl);
        setQrDataUrl(qr.qrDataUrl);
      }
      setLoading(false);
    })();
  }, [roomId, setInitialState]);

  useEffect(() => {
    if (!ready || !room) return;
    emit("presenter-join", { roomId });

    on("reaction", (data) => {
      const r = data as { id: string; emoji: string; nickname: string };
      const left = Math.random() * 22 + 2;   // 2%~24% (leftmost quarter)
      const bottom = Math.random() * 40 + 8;  // 8%~48%
      setReactions((prev) => [...prev.slice(-5), { ...r, left, bottom }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 3000);
      setActivityLog((prev) => [{ nickname: r.nickname, message: r.emoji, timestamp: Date.now() }, ...prev].slice(0, 50));
    });
    on("chat", (data) => {
      const c = data as { id: string; message: string; nickname: string; timestamp: number };
      setChats((prev) => [...prev.slice(-4), c]);
      setTimeout(() => setChats((prev) => prev.filter((x) => x.id !== c.id)), 6000);
      setActivityLog((prev) => [{ nickname: c.nickname, message: c.message, timestamp: c.timestamp }, ...prev].slice(0, 30));
    });
    on("participant-count", (n) => setParticipantCount(n as number));
    on("reaction-stats", (s) => setReactionStats(s as Record<string, number>));
    on("focus-update", (d) => setFocusTimeline(d as typeof focusTimeline));
    on("wordcloud-update", (d) => setAllChats(d as Array<{ message: string }>));
    on("slide-request-update", (d) => setSlideReq(d as typeof slideReq));
    on("room-state", (state) => {
      const s = state as {
        poll?: typeof poll;
        questions?: typeof questions;
        slideRequests?: typeof slideReq;
        focusTimeline?: typeof focusTimeline;
        participantCount?: number;
        reactionStats?: Record<string, number>;
      };
      if (s.poll !== undefined) setPoll(s.poll);
      if (s.questions) setQuestions(s.questions);
      if (s.slideRequests) setSlideReq(s.slideRequests);
      if (s.focusTimeline) setFocusTimeline(s.focusTimeline);
      if (s.participantCount !== undefined) setParticipantCount(s.participantCount);
      if (s.reactionStats) setReactionStats(s.reactionStats);
    });
  }, [ready, room, roomId, emit, on]);

  useEffect(() => {
    if (!room || room.slideType !== "canva" || !room.canvaDesignId) return;
    const t = setTimeout(() => {
      if (canvaContainerRef.current && !canvaContainerRef.current.querySelector("iframe")) {
        setShowFallback(true);
        setFallbackDesc("캔바 공유 > Embed > 공개 임베드를 확인하세요.");
        setSlideReady(true);
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [room]);

  useEffect(() => {
    if (timerRunning && timerRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimerRemaining((prev) => {
          if (prev <= 1) {
            setTimerRunning(false);
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerRemaining]);

  useEffect(() => {
    setTimerSec(timerRemaining);
  }, [timerRemaining]);

  const loadIframe = (src: string) => {
    setSlideReady(false);
    setShowFallback(false);
    setTimeout(() => setSlideReady(true), 6000);
  };

  if (loading || !room) {
    return <div className="slide-loading">슬라이드를 불러오는 중...</div>;
  }

  const slideTypeLabel = room.slideType === "canva" ? "Canva" : room.slideType === "google" ? "Google" : "Embed";
  const sessions = searchSessions(sessionSearch);

  return (
    <>
      {room.slideType === "canva" && room.canvaDesignId && (
        <Script
          src="https://sdk.canva.com/v1/embed.js"
          onLoad={() => {
            setSlideReady(true);
            if (window.Canva?.Embed?.init) window.Canva.Embed.init();
          }}
          onError={() => {
            setShowFallback(true);
            setFallbackDesc("캔바 SDK를 불러올 수 없습니다.");
          }}
        />
      )}

      <div className="present-layout">
        <aside className="overlay-panel">
          <div className="reaction-stream">
            {reactions.map((r) => (
              <div
                key={r.id}
                className="floating-emoji"
                title={r.nickname}
                style={{ left: `${r.left}%`, bottom: `${r.bottom}%` }}
              >{r.emoji}</div>
            ))}
          </div>
          <div className="chat-stream">
            {chats.map((c) => (
              <div key={c.id} className="chat-bubble">
                <div className="chat-nickname">{c.nickname}</div>
                <div className="chat-message">{c.message}</div>
              </div>
            ))}
          </div>
          <div className="reaction-stats-bar">
            {Object.entries(reactionStats).sort((a, b) => b[1] - a[1]).map(([e, c]) => (
              <span key={e} className="stat-chip">{e} {c}</span>
            ))}
          </div>
        </aside>

        <main className="slide-area">
          {room.slideType === "canva" && room.canvaDesignId ? (
            <div ref={canvaContainerRef} className="canva-container">
              <div
                className="canva-embed"
                data-design-id={room.canvaDesignId}
                data-height-ratio="0.5625"
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ) : room.embedUrl ? (
            <iframe
              src={room.embedUrl}
              className={slideReady ? "" : "hidden"}
              allowFullScreen
              allow="autoplay; fullscreen"
              onLoad={() => { setSlideReady(true); loadIframe(room.embedUrl!); }}
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          ) : null}

          {!slideReady && !showFallback && <div className="slide-loading">슬라이드를 불러오는 중...</div>}

          {showFallback && (
            <div className="slide-fallback">
              <div className="fallback-card">
                <p className="fallback-title">슬라이드를 여기에 표시할 수 없습니다</p>
                <p className="fallback-desc">{fallbackDesc}</p>
                <a className="btn-primary" href={room.canvaViewUrl || room.slideUrl} target="_blank" rel="noopener">새 탭에서 슬라이드 열기</a>
              </div>
            </div>
          )}

          {poll?.active && (
            <div className="poll-overlay">
              <div className="poll-overlay-card">
                <h3>{poll.question}</h3>
                <div className="poll-bars">
                  {poll.options.map((o, i) => {
                    const max = Math.max(...poll.options.map((x) => x.votes), 1);
                    const pct = Math.round((o.votes / max) * 100);
                    return (
                      <div key={i} className="poll-bar-row">
                        <span className="poll-bar-label">{o.text}</span>
                        <div className="poll-bar-track"><div className="poll-bar-fill" style={{ width: `${pct}%` }} /></div>
                        <span className="poll-bar-count">{o.votes}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className={`qr-panel ${qrCollapsed ? "collapsed" : ""}`}>
          <button className="qr-toggle" onClick={() => setQrCollapsed(!qrCollapsed)}>{qrCollapsed ? "▶" : "◀"}</button>
          <div className="qr-content">
            <h3>참여하기</h3>
            <div className="qr-code-wrap">
              {qrDataUrl && <img src={qrDataUrl} alt="QR 코드" />}
            </div>
            <p className="qr-hint">QR을 스캔하여 참여하세요</p>
            <div className="participant-badge">
              <span className="participant-icon">👥</span>
              <span>{participantCount}</span>명 접속 중
            </div>
            <button className="btn-copy" onClick={async () => {
              try {
                await navigator.clipboard.writeText(joinUrl);
                setCopyLabel("복사됨!");
                setTimeout(() => setCopyLabel("링크 복사"), 2000);
              } catch { prompt("링크 복사:", joinUrl); }
            }}>{copyLabel}</button>
            <p className="join-url">{joinUrl}</p>
          </div>
        </aside>

        <aside className={`activity-panel ${activityCollapsed ? "collapsed" : ""}`}>
          <button className="activity-toggle" onClick={() => setActivityCollapsed(!activityCollapsed)}>💬</button>
          <div className="activity-content">
            <h4>채팅·이모지 로그</h4>
            <div className="activity-list">
              {activityLog.map((a, i) => (
                <div key={i} className="activity-item">
                  <span className="activity-time">{new Date(a.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="activity-nick">{a.nickname}</span>
                  <span className="activity-msg">{a.message}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="control-dock">
        <button className="dock-toggle" onClick={() => setDockOpen(!dockOpen)}>
          {dockOpen ? "🛠️ 도구 ▼" : "🛠️ 도구 ▲"}
        </button>
        {dockOpen && (
          <div className="dock-body">
            <div className="dock-tabs">
              {[
                ["poll", "📊 투표"], ["questions", "🙋 질문"], ["timer", "⏱️ 타이머"],
                ["analytics", "📈 분석"], ["slides", "📱 슬라이드"], ["session", "🗃️ 세션"],
              ].map(([id, label]) => (
                <button key={id} className={`dock-tab ${dockTab === id ? "active" : ""}`} onClick={() => setDockTab(id)}>{label}</button>
              ))}
            </div>

            {dockTab === "poll" && (
              <div className="dock-panel active">
                <input type="text" placeholder="투표 질문" maxLength={100} value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} />
                <div className="poll-options-input">
                  {pollOptions.map((opt, i) => (
                    <input key={i} type="text" className="poll-opt" placeholder={`선택지 ${i + 1}`} maxLength={50} value={opt}
                      onChange={(e) => { const n = [...pollOptions]; n[i] = e.target.value; setPollOptions(n); }} />
                  ))}
                </div>
                {pollOptions.length < 6 && (
                  <button className="btn-sm" onClick={() => setPollOptions([...pollOptions, ""])}>+ 선택지</button>
                )}
                <div className="dock-actions">
                  <button className="btn-primary btn-sm" onClick={() => {
                    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
                    if (!pollQuestion.trim() || opts.length < 2) { alert("질문과 선택지 2개 이상을 입력하세요."); return; }
                    emit("create-poll", { question: pollQuestion, options: opts });
                  }}>투표 시작</button>
                  <button className="btn-ghost btn-sm" onClick={() => emit("close-poll")}>투표 종료</button>
                </div>
              </div>
            )}

            {dockTab === "questions" && (
              <div className="dock-panel active">
                <div className="question-list">
                  {!questions.length ? <p className="empty-msg">등록된 질문이 없습니다.</p> : (
                    [...questions.filter((q) => !q.answered), ...questions.filter((q) => q.answered)].map((q) => (
                      <div key={q.id} className={`question-item ${q.answered ? "answered" : ""}`}>
                        <div className="q-meta"><span className="q-nick">{q.nickname}</span></div>
                        <div className="q-text">{q.text}</div>
                        {q.answered ? <span className="q-done">✅ 답변 완료</span> : (
                          <button className="btn-sm btn-resolve" onClick={() => emit("resolve-question", { questionId: q.id })}>답변 완료</button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {dockTab === "timer" && (
              <div className="dock-panel active">
                <div className="timer-display">{fmtTimer(timerSec)}</div>
                <input type="number" min={1} max={120} value={timerMin} onChange={(e) => setTimerMin(Number(e.target.value))} />
                <div className="dock-actions">
                  <button className="btn-primary btn-sm" onClick={() => {
                    if (!timerRunning) {
                      const rem = timerRemaining <= 0 ? timerMin * 60 : timerRemaining;
                      setTimerRemaining(rem);
                      setTimerRunning(true);
                      setShowTimerBadge(true);
                    }
                  }}>시작</button>
                  <button className="btn-ghost btn-sm" onClick={() => setTimerRunning(false)}>정지</button>
                  <button className="btn-ghost btn-sm" onClick={() => { setTimerRunning(false); setTimerRemaining(timerMin * 60); }}>리셋</button>
                </div>
              </div>
            )}

            {dockTab === "analytics" && (
              <div className="dock-panel active">
                <div className="chart-row">
                  <div className="chart-box">
                    <h5>📝 워드클라우드</h5>
                    <canvas ref={wordCanvasRef} width={280} height={160} />
                  </div>
                  <div className="chart-box">
                    <h5>🎯 집중도 (반응/30초)</h5>
                    <canvas ref={focusCanvasRef} width={280} height={160} />
                  </div>
                </div>
              </div>
            )}

            {dockTab === "slides" && (
              <div className="dock-panel active">
                <div className="slide-req-display">
                  <div className="slide-req-item">⏭ 다음 요청: <strong>{slideReq.next}</strong></div>
                  <div className="slide-req-item">⏮ 이전 요청: <strong>{slideReq.prev}</strong></div>
                </div>
                <button className="btn-ghost btn-sm" onClick={() => emit("reset-slide-requests")}>요청 초기화</button>
              </div>
            )}

            {dockTab === "session" && (
              <div className="dock-panel active">
                <div className="dock-actions">
                  <button className="btn-primary btn-sm" onClick={() => {
                    emit("get-session-data", {}, (data) => {
                      if (!data) return;
                      saveSession({ ...data as object, roomId, title: room.title });
                      setSaveLabel("저장됨!");
                      setTimeout(() => setSaveLabel("세션 저장"), 2000);
                    });
                  }}>{saveLabel}</button>
                </div>
                <input type="text" placeholder="저장된 세션 검색..." value={sessionSearch} onChange={(e) => setSessionSearch(e.target.value)} />
                <div className="session-list">
                  {!sessions.length ? <p className="empty-msg">저장된 세션이 없습니다.</p> : sessions.map((s) => (
                    <div key={s.roomId} className="session-item">
                      <div className="session-item-title">{s.title || s.roomId}</div>
                      <button className="btn-sm btn-delete-session" onClick={() => deleteSession(s.roomId)}>삭제</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <header className="present-topbar">
        <span className="present-title">{room.title}</span>
        <span className="slide-type-badge">{slideTypeLabel}</span>
        <span className="topbar-count">👥 {participantCount}</span>
        {showTimerBadge && <span className="timer-badge">⏱️ {fmtTimer(timerSec)}</span>}
        <div className="topbar-actions">
          <button className="btn-ghost" onClick={() => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
          }}>전체화면</button>
          <Link href="/" className="btn-ghost">종료</Link>
        </div>
      </header>
    </>
  );
}

declare global {
  interface Window {
    Canva?: { Embed?: { init: () => void } };
  }
}
