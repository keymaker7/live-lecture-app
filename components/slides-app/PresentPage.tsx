"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Script from "next/script";
import Link from "next/link";
import { useSlidesRealtime } from "@/hooks/useSlidesRealtime";
import { getCachedRoom } from "@/lib/session-store-client";
import type { ActiveVideo } from "@/hooks/useSlidesRealtime";
import { PlazaStage, type PlazaHandle } from "@/components/slides-app/PlazaStage";
import { GameStage, type GameView } from "@/components/slides-app/GameStage";
import { GameDock } from "@/components/slides-app/GameDock";
import { RankBoard } from "@/components/slides-app/RankBoard";
import type { ResultsDbStatus, Standing } from "@/hooks/useSlidesRealtime";
import { readText, writeText } from "@/lib/realtime/storage";

type PlazaView = "walk" | "plaza";
// 앱이 크게 바뀌어 참가자 폰을 새로고침해야 할 때 올린다 — 발표 PC 마다 이 버전을 처음 열 때 한 번 안내
const APP_NOTICE_VERSION = "2026-10-16-plaza";
const pref = (key: string, fallback: string) => (typeof window === "undefined" ? fallback : readText(key) ?? fallback);

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
  const [chatBubbles, setChatBubbles] = useState<Array<{ id: string; nickname: string; message: string }>>([]);
  const [questionAlert, setQuestionAlert] = useState<{ nickname: string; text: string } | null>(null);
  const [activityLog, setActivityLog] = useState<Array<{ nickname: string; message: string; timestamp: number }>>([]);
  const [emojiLog, setEmojiLog] = useState<Array<{ nickname: string; emoji: string; timestamp: number }>>([]);
  const [poll, setPoll] = useState<{
    id: string;
    question: string;
    options: Array<{ text: string; votes: number }>;
    active: boolean;
  } | null>(null);
  const [questions, setQuestions] = useState<Array<{ id: string; text: string; nickname: string; timestamp: number; answered: boolean }>>([]);
  const [slideReq, setSlideReq] = useState({ next: 0, prev: 0 });
  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [activeVideo, setActiveVideo] = useState<ActiveVideo | null>(null);
  const [qrCollapsed, setQrCollapsed] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(true);
  const [emojiLogCollapsed, setEmojiLogCollapsed] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState("poll");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [timerMin, setTimerMin] = useState(5);
  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [showTimerBadge, setShowTimerBadge] = useState(false);
  const [copyLabel, setCopyLabel] = useState("링크 복사");
  // 광장 보기: 산책로(기본, 슬라이드 하단 띠) / 광장(전체 화면). 설정은 이 PC 에 기억.
  const [plazaView, setPlazaView] = useState<PlazaView>(() => (pref("ll:view", "walk") === "plaza" ? "plaza" : "walk"));
  const [bandHidden, setBandHidden] = useState(() => pref("ll:band", "on") === "off");
  const [sfxOn, setSfxOn] = useState(() => pref("ll:sfx", "on") === "on");
  const [musicOn, setMusicOn] = useState(() => pref("ll:mus", "off") === "on");
  // 게임 중이면 광장(게임 화면)으로 자동 전환, 닫으면 원래 보기로
  const [gameActive, setGameActive] = useState(false);
  const plazaRef = useRef<PlazaHandle | null>(null);
  // 게임 중엔 QR 패널이 오른쪽 답 구역을 가린다 — 시작 때 접고, 끝나면 원래대로
  const qrBeforeGameRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (gameActive) {
      if (qrBeforeGameRef.current === null) {
        setQrCollapsed((c) => { qrBeforeGameRef.current = c; return true; });
      }
    } else if (qrBeforeGameRef.current !== null) {
      setQrCollapsed(qrBeforeGameRef.current);
      qrBeforeGameRef.current = null;
    }
  }, [gameActive]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvaContainerRef = useRef<HTMLDivElement>(null);
  const prevQCountRef = useRef(0);

  const { on, off, emit, ready, setInitialState, hostStatus, takeover, getResults, hostSecret } = useSlidesRealtime(roomId, "presenter");
  // 종합 순위(게임이 끝날 때마다 다시 계산돼 온다)·DB 저장 상태
  const [standings, setStandings] = useState<Standing[]>([]);
  const [gamesCount, setGamesCount] = useState(0);
  const [rankOpen, setRankOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<ResultsDbStatus>({ state: "idle", unsaved: 0 });
  const [updateNotice, setUpdateNotice] = useState(() => pref("ll:notice", "") !== APP_NOTICE_VERSION);
  const closeUpdateNotice = () => { setUpdateNotice(false); writeText("ll:notice", APP_NOTICE_VERSION); };

  const openRankBoard = () => {
    setRankOpen(true);
    const h = plazaRef.current;
    // 순위판에 오른 1·2·3등은 그 뒤로 광장에서도 왕관·메달
    h?.engine.setMedals(standings.filter((x) => x.points > 0).slice(0, 3).map((x) => x.pid));
    if (gamesCount > 0) {
      h?.sound.play("win");
      [0, 700].forEach((ms) => setTimeout(() => h?.confetti.burst(), ms));
    }
  };

  const emitRef = useRef(emit);
  useEffect(() => { emitRef.current = emit; }, [emit]);

  const fmtTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

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
      setInitialState({
        participantCount: roomData.participantCount || 0,
        reactionStats: roomData.reactionStats || {},
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

    on("game", (v) => setGameActive(!!v && !!(v as GameView).s));
    on("standings", (rows) => {
      setStandings(rows as Standing[]);
      setGamesCount(getResults().games.length);
    });
    on("results-db", (d) => setDbStatus(d as ResultsDbStatus));

    // 발표자 탭을 새로고침했을 때 — 저장해 둔 채팅·이모지 기록으로 로그 패널을 다시 채운다.
    on("history", (data) => {
      const h = data as {
        chats: Array<{ nickname: string; message: string; timestamp: number }>;
        reactions: Array<{ nickname: string; emoji: string; timestamp: number }>;
      };
      setActivityLog(h.chats.slice(-30).reverse().map((c) => ({ nickname: c.nickname, message: c.message, timestamp: c.timestamp })));
      setEmojiLog(h.reactions.slice(-100).reverse().map((r) => ({ nickname: r.nickname, emoji: r.emoji, timestamp: r.timestamp })));
    });

    on("reaction", (data) => {
      const r = data as { id: string; emoji: string; nickname: string };
      const left = Math.random() * 22 + 2;   // 2%~24% (leftmost quarter)
      const bottom = Math.random() * 40 + 8;  // 8%~48%
      setReactions((prev) => [...prev.slice(-5), { ...r, left, bottom }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 3000);
      setEmojiLog((prev) => [{ nickname: r.nickname, emoji: r.emoji, timestamp: Date.now() }, ...prev].slice(0, 100));
    });
    on("chat", (data) => {
      const c = data as { id: string; message: string; nickname: string; timestamp: number };
      setActivityLog((prev) => [{ nickname: c.nickname, message: c.message, timestamp: c.timestamp }, ...prev].slice(0, 30));
      const bubble = { id: c.id || String(Date.now()), nickname: c.nickname, message: c.message };
      setChatBubbles((prev) => [...prev.slice(-4), bubble]);
      setTimeout(() => setChatBubbles((prev) => prev.filter((x) => x.id !== bubble.id)), 4000);
    });
    on("participant-count", (n) => setParticipantCount(n as number));
    on("reaction-stats", (s) => setReactionStats(s as Record<string, number>));
    on("slide-request-update", (d) => setSlideReq(d as typeof slideReq));
    on("room-state", (state) => {
      const s = state as {
        poll?: typeof poll;
        questions?: typeof questions;
        slideRequests?: typeof slideReq;
        participantCount?: number;
        reactionStats?: Record<string, number>;
        videoChatEnabled?: boolean;
        activeVideo?: ActiveVideo | null;
      };
      if (s.poll !== undefined) setPoll(s.poll);
      if (s.questions) {
        const prev = prevQCountRef.current;
        const next = s.questions.length;
        if (next > prev) {
          const latest = s.questions[next - 1];
          setQuestionAlert({ nickname: latest.nickname, text: latest.text });
          setTimeout(() => setQuestionAlert(null), 5000);
        }
        prevQCountRef.current = next;
        setQuestions(s.questions);
      }
      if (s.slideRequests) setSlideReq(s.slideRequests);
      if (s.participantCount !== undefined) setParticipantCount(s.participantCount);
      if (s.reactionStats) setReactionStats(s.reactionStats);
      if (s.videoChatEnabled !== undefined) setVideoChatEnabled(s.videoChatEnabled);
      if (s.activeVideo !== undefined) setActiveVideo(s.activeVideo ?? null);
    });
  }, [ready, room, roomId, emit, on, getResults]);

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

  useEffect(() => {
    if (!activeVideo) return;
    const duration = (activeVideo.end - activeVideo.start + 3) * 1000;
    const t = setTimeout(() => emitRef.current("clear-video"), duration);
    return () => clearTimeout(t);
  }, [activeVideo]);

  const loadIframe = (src: string) => {
    setSlideReady(false);
    setShowFallback(false);
    setTimeout(() => setSlideReady(true), 6000);
  };

  if (loading || !room) {
    return <div className="slide-loading">슬라이드를 불러오는 중...</div>;
  }

  const slideTypeLabel = room.slideType === "canva" ? "Canva" : room.slideType === "google" ? "Google" : "Embed";

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

      {/* 산책로 띠가 보일 때는 슬라이드를 띠 위 공간으로 줄여 가리지 않는다 */}
      <div className={`present-layout ${plazaView === "walk" && !bandHidden && !gameActive ? "with-band" : ""}`}>
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
          {/* 채팅은 캐릭터 머리 위 말풍선으로 — 띠를 숨겼을 때만 예전 말풍선 목록 */}
          {bandHidden && plazaView === "walk" && chatBubbles.length > 0 && (
            <div className="chat-stream">
              {chatBubbles.map((b) => (
                <div key={b.id} className="chat-bubble">
                  <div className="chat-nickname">{b.nickname}</div>
                  <div className="chat-message">{b.message}</div>
                </div>
              ))}
            </div>
          )}
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

          {activeVideo && (
            <div className="video-overlay">
              <iframe
                src={`https://www.youtube.com/embed/${activeVideo.videoId}?autoplay=1&start=${activeVideo.start}${activeVideo.end > activeVideo.start ? `&end=${activeVideo.end}` : ""}`}
                allow="autoplay; fullscreen"
                allowFullScreen
                title="영상 채팅"
              />
              <button className="video-close-btn" onClick={() => emit("clear-video")}>✕</button>
              <div className="video-requester">요청: {activeVideo.nickname}</div>
            </div>
          )}

          {questionAlert && (
            <div className="question-alert">
              <span className="question-alert-icon">🙋</span>
              <div className="question-alert-body">
                <div className="question-alert-nick">{questionAlert.nickname}</div>
                <div className="question-alert-text">{questionAlert.text}</div>
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

        <aside className={`activity-panel chat-log-panel ${activityCollapsed ? "collapsed" : ""}`}>
          <button className="activity-toggle" onClick={() => setActivityCollapsed(!activityCollapsed)}>💬</button>
          <div className="activity-content">
            <h4>채팅 로그</h4>
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

        <aside className={`activity-panel emoji-log-panel ${emojiLogCollapsed ? "collapsed" : ""}`}>
          <button className="activity-toggle" onClick={() => setEmojiLogCollapsed(!emojiLogCollapsed)}>😊</button>
          <div className="activity-content">
            <h4>이모지 로그</h4>
            <div className="activity-list">
              {emojiLog.map((e, i) => (
                <div key={i} className="activity-item">
                  <span className="activity-time">{new Date(e.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="activity-nick">{e.nickname}</span>
                  <span className="activity-msg">{e.emoji}</span>
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
                ["video", "🎬 영상"], ["game", "🎮 게임"],
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

            {dockTab === "game" && (
              <GameDock emit={emit} gameActive={gameActive} roomId={roomId} hostSecret={hostSecret} getResults={getResults} dbStatus={dbStatus} />
            )}

            {dockTab === "video" && (
              <div className="dock-panel active">
                <div className="video-toggle-row">
                  <span>영상 채팅 {videoChatEnabled ? "활성" : "비활성"}</span>
                  <button
                    className={`toggle-btn ${videoChatEnabled ? "active" : ""}`}
                    onClick={() => emit("toggle-video-chat")}
                  >{videoChatEnabled ? "ON" : "OFF"}</button>
                </div>
                {videoChatEnabled && (
                  <p className="video-chat-status">
                    {activeVideo
                      ? `재생 중: ${activeVideo.nickname}의 요청`
                      : "수강생이 영상 요청을 보낼 수 있습니다."}
                  </p>
                )}
                {activeVideo && (
                  <button className="btn-ghost btn-sm" onClick={() => emit("clear-video")}>영상 닫기</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <PlazaStage
        on={on}
        off={off}
        title={room.title}
        mode={gameActive || plazaView === "plaza" ? "plaza" : bandHidden ? "hidden" : "walk"}
        sfx={sfxOn}
        music={musicOn}
        handleRef={plazaRef}
      />
      <GameStage on={on} off={off} emit={emit} plaza={plazaRef} />
      {updateNotice && (
        <div className="update-notice" role="status">
          <span>📱 앱이 새로 바뀌었어요 — 시작 전에 참가자에게 <b>&ldquo;폰 새로고침 한 번&rdquo;</b>을 안내해 주세요. (무료 플랜은 60명까지 권장)</span>
          <button className="btn-sm" onClick={closeUpdateNotice}>확인</button>
        </div>
      )}
      {rankOpen && <RankBoard standings={standings} games={gamesCount} onClose={() => setRankOpen(false)} />}

      {hostStatus === "standby" && (
        <div className="host-standby" role="alert">
          <p>이미 다른 창에서 이 연수를 진행 중입니다.</p>
          <p className="host-standby-sub">이 창은 보기 전용입니다. 여기서 이어서 진행하려면 아래 버튼을 누르세요.</p>
          <button className="btn-primary" onClick={() => { void takeover(); }}>여기서 진행</button>
        </div>
      )}

      <header className="present-topbar">
        <span className="present-title">{room.title}</span>
        <span className="slide-type-badge">{slideTypeLabel}</span>
        {/* 무료 플랜 기준 60명까지 권장(keymaker 10/16 결정) — 넘으면 주황 표시 */}
        <span
          className={`topbar-count ${participantCount > 60 ? "over" : ""}`}
          title={participantCount > 60 ? "60명까지 권장 — 넘으면 실시간 연결이 불안정할 수 있어요" : "60명까지 권장"}
        >👥 {participantCount}{participantCount > 60 ? " · 60명까지 권장" : ""}</span>
        {showTimerBadge && <span className="timer-badge">⏱️ {fmtTimer(timerSec)}</span>}
        <button className="btn-ghost topbar-rank" onClick={() => (rankOpen ? setRankOpen(false) : openRankBoard())}>🏆 종합 순위</button>
        <div className="pz-controls">
          <button className={plazaView === "walk" ? "on" : ""} onClick={() => { setPlazaView("walk"); writeText("ll:view", "walk"); }}>🚶 산책로</button>
          <button className={plazaView === "plaza" ? "on" : ""} onClick={() => { setPlazaView("plaza"); writeText("ll:view", "plaza"); }}>🌳 광장</button>
          {plazaView === "walk" && (
            <button onClick={() => { const h = !bandHidden; setBandHidden(h); writeText("ll:band", h ? "off" : "on"); }}>
              {bandHidden ? "띠 보이기" : "띠 숨기기"}
            </button>
          )}
          <button className={sfxOn ? "on" : ""} onClick={() => { const v = !sfxOn; setSfxOn(v); writeText("ll:sfx", v ? "on" : "off"); }}>🔊 효과음</button>
          <button className={musicOn ? "on" : ""} onClick={() => { const v = !musicOn; setMusicOn(v); writeText("ll:mus", v ? "on" : "off"); }}>🎵 음악</button>
        </div>
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
