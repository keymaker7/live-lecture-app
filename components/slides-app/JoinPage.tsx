"use client";

import { useState, useEffect } from "react";
import { useSlidesRealtime } from "@/hooks/useSlidesRealtime";

const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🔥", "💡", "🎉"];

interface JoinPageProps {
  roomId: string;
}

export function JoinPage({ roomId }: JoinPageProps) {
  const [roomTitle, setRoomTitle] = useState("연수");
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [joinError, setJoinError] = useState("");
  const [activeTab, setActiveTab] = useState<"react" | "question" | "video">("react");
  const [participantCount, setParticipantCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [poll, setPoll] = useState<{
    id: string;
    question: string;
    options: Array<{ text: string; votes: number }>;
    active: boolean;
  } | null>(null);
  const [voted, setVoted] = useState(false);
  const [myQuestions, setMyQuestions] = useState<string[]>([]);
  const [lastReactionAt, setLastReactionAt] = useState(0);
  const [sendLabel, setSendLabel] = useState("전송");
  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoStart, setVideoStart] = useState("");
  const [videoEnd, setVideoEnd] = useState("");
  const [videoSubmitLabel, setVideoSubmitLabel] = useState("영상 요청");

  const { on, emit, ready } = useSlidesRealtime(roomId, "audience");

  useEffect(() => {
    document.body.className = "join-page";
    return () => {
      document.body.className = "";
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}`);
        if (!res.ok) {
          setJoinError("존재하지 않는 연수입니다.");
          return;
        }
        const room = await res.json();
        setRoomTitle(room.title || "연수");
      } catch {
        setJoinError("서버에 연결할 수 없습니다.");
      }
    })();
  }, [roomId]);

  useEffect(() => {
    if (!ready) return;

    on("room-state", (state) => {
      const s = state as { poll?: typeof poll; participantCount?: number; videoChatEnabled?: boolean };
      if (s.poll !== undefined) setPoll(s.poll?.active ? s.poll : null);
      if (s.participantCount !== undefined) setParticipantCount(s.participantCount);
      if (s.videoChatEnabled !== undefined) {
        setVideoChatEnabled(s.videoChatEnabled);
        if (!s.videoChatEnabled) setActiveTab((t) => t === "video" ? "react" : t);
      }
    });
    on("participant-count", (n) => setParticipantCount(n as number));

    return () => {};
  }, [ready, on]);

  const handleJoin = () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setJoinError("닉네임을 입력해주세요.");
      return;
    }
    setJoinError("");
    setDisplayName(trimmed);
    setJoined(true);
    emit("join-room", { roomId, nickname: trimmed });
  };

  const sendReaction = (emoji: string) => {
    if (!joined) return;
    const now = Date.now();
    if (now - lastReactionAt < 300) return;
    setLastReactionAt(now);
    emit("reaction", { emoji, nickname: displayName });
    if (navigator.vibrate) navigator.vibrate(30);
  };

  const sendChat = () => {
    if (!joined || !chatInput.trim()) return;
    emit("chat", { message: chatInput.trim(), nickname: displayName });
    setChatInput("");
    setSendLabel("전송됨");
    setTimeout(() => setSendLabel("전송"), 800);
  };

  const submitQuestion = () => {
    if (!joined || !questionInput.trim()) return;
    emit("submit-question", { text: questionInput.trim(), nickname: displayName });
    setMyQuestions((prev) => [questionInput.trim(), ...prev].slice(0, 5));
    setQuestionInput("");
  };

  const votePoll = (index: number) => {
    if (!poll?.active || voted) return;
    emit("vote-poll", { optionIndex: index });
    setVoted(true);
  };

  const submitVideoRequest = () => {
    if (!joined || !videoUrl.trim()) return;
    const start = parseInt(videoStart) || 0;
    const end = parseInt(videoEnd) || 0;
    emit("video-request", { url: videoUrl.trim(), start, end, nickname: displayName });
    setVideoUrl("");
    setVideoStart("");
    setVideoEnd("");
    setVideoSubmitLabel("요청 완료!");
    setTimeout(() => setVideoSubmitLabel("영상 요청"), 2000);
  };

  if (!joined) {
    return (
      <div className="join-page">
        <div className="join-screen">
          <div className="join-card">
            <div className="join-logo">📊</div>
            <h1>연수에 참여하기</h1>
            <p className="join-subtitle">{roomTitle}</p>
            <label htmlFor="nickname">닉네임</label>
            <input
              id="nickname"
              type="text"
              placeholder="이름 또는 닉네임"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <button className="btn-primary btn-large" onClick={handleJoin}>참여하기</button>
            {joinError && <p className="error-msg">{joinError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="audience-screen">
        <header className="audience-header">
          <span className="audience-nickname">{displayName}</span>
          <span className="audience-status">👥 {participantCount}명 · ● 연결됨</span>
        </header>

        {poll?.active && (
          <div className="poll-vote-panel">
            <h3>{poll.question}</h3>
            <div className="poll-vote-options">
              {poll.options.map((opt, i) => (
                <button key={i} className="poll-vote-btn" onClick={() => votePoll(i)} disabled={voted}>
                  {opt.text}
                </button>
              ))}
            </div>
            {voted && <p className="poll-voted-msg">투표 완료!</p>}
          </div>
        )}

        <nav className="audience-tabs">
          <button className={`aud-tab ${activeTab === "react" ? "active" : ""}`} onClick={() => setActiveTab("react")}>😊 반응</button>
          <button className={`aud-tab ${activeTab === "question" ? "active" : ""}`} onClick={() => setActiveTab("question")}>🙋 질문</button>
          {videoChatEnabled && (
            <button className={`aud-tab ${activeTab === "video" ? "active" : ""}`} onClick={() => setActiveTab("video")}>🎬 영상</button>
          )}
        </nav>

        <main className="audience-main">
          {activeTab === "react" && (
            <div className="aud-panel active">
              <div className="emoji-grid">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} className="emoji-btn" onClick={() => sendReaction(emoji)}>{emoji}</button>
                ))}
              </div>
            </div>
          )}
          {activeTab === "question" && (
            <div className="aud-panel active">
              <textarea
                className="question-textarea"
                placeholder="질문을 입력하세요..."
                maxLength={300}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
              />
              <button className="btn-primary btn-full" onClick={submitQuestion}>질문 등록</button>
              <div className="my-questions">
                {myQuestions.map((q, i) => (
                  <div key={i} className="my-q-item">✓ {q}</div>
                ))}
              </div>
            </div>
          )}
          {activeTab === "video" && videoChatEnabled && (
            <div className="aud-panel active">
              <div className="video-request-form">
                <input
                  type="url"
                  className="video-url-input"
                  placeholder="YouTube URL 입력..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <div className="video-time-inputs">
                  <input
                    type="number"
                    className="video-time-input"
                    placeholder="시작(초)"
                    min={0}
                    value={videoStart}
                    onChange={(e) => setVideoStart(e.target.value)}
                  />
                  <span className="video-time-sep">~</span>
                  <input
                    type="number"
                    className="video-time-input"
                    placeholder="끝(초)"
                    min={0}
                    value={videoEnd}
                    onChange={(e) => setVideoEnd(e.target.value)}
                  />
                </div>
                <button className="btn-primary btn-full" onClick={submitVideoRequest}>{videoSubmitLabel}</button>
              </div>
            </div>
          )}
        </main>

        <footer className="audience-footer">
          <div className="chat-input-wrap">
            <input
              type="text"
              placeholder="메시지 입력..."
              maxLength={200}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
            />
            <button className="btn-send" onClick={sendChat}>{sendLabel}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
