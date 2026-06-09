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
  const [activeTab, setActiveTab] = useState<"react" | "question" | "slide">("react");
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
      const s = state as { poll?: typeof poll; participantCount?: number };
      if (s.poll !== undefined) setPoll(s.poll?.active ? s.poll : null);
      if (s.participantCount !== undefined) setParticipantCount(s.participantCount);
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
    emit("join-room", { roomId, nickname: trimmed }, (res) => {
      const r = res as { ok?: boolean; error?: string; nickname?: string };
      if (!r?.ok) {
        setJoinError(r?.error || "참여에 실패했습니다.");
        return;
      }
      setJoined(true);
      setDisplayName(r.nickname || trimmed);
    });
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
          <button className={`aud-tab ${activeTab === "slide" ? "active" : ""}`} onClick={() => setActiveTab("slide")}>📱 슬라이드</button>
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
                placeholder="질문을 입력하세요..."
                maxLength={300}
                rows={3}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
              />
              <button className="btn-primary btn-sm" onClick={submitQuestion}>질문 등록</button>
              <div className="my-questions">
                {myQuestions.map((q, i) => (
                  <div key={i} className="my-q-item">✓ {q}</div>
                ))}
              </div>
            </div>
          )}
          {activeTab === "slide" && (
            <div className="aud-panel active">
              <p className="audience-guide">슬라이드 넘김을 요청하세요</p>
              <div className="slide-req-btns">
                <button className="btn-slide-req" onClick={() => emit("slide-request", { direction: "prev" })}>⏮ 이전 슬라이드</button>
                <button className="btn-slide-req" onClick={() => emit("slide-request", { direction: "next" })}>다음 슬라이드 ⏭</button>
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
