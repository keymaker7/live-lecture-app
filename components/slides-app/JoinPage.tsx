"use client";

import { useState, useEffect, useRef } from "react";
import { useSlidesRealtime, type AudienceState, type JoinAck } from "@/hooks/useSlidesRealtime";
import { readText, writeText } from "@/lib/realtime/storage";
import { ANIMALS, characterById, characterForNickname } from "@/lib/plaza/characters";

const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🔥", "💡", "🎉"];

interface JoinPageProps {
  roomId: string;
}

export function JoinPage({ roomId }: JoinPageProps) {
  const [roomTitle, setRoomTitle] = useState("연수");
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  // 참가 2단계: 닉네임 → 캐릭터 고르기(안 고르면 닉네임으로 자동)
  const [step, setStep] = useState<"nick" | "pick">("nick");
  const [character, setCharacter] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinError, setJoinError] = useState("");
  const [activeTab, setActiveTab] = useState<"react" | "question" | "video">("react");
  const [participantCount, setParticipantCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [poll, setPoll] = useState<AudienceState["poll"]>(null);
  const [voted, setVoted] = useState(false);
  const pollIdRef = useRef("");
  const [myQuestions, setMyQuestions] = useState<string[]>([]);
  const [lastReactionAt, setLastReactionAt] = useState(0);
  const [sendLabel, setSendLabel] = useState("전송");
  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoStartMin, setVideoStartMin] = useState("");
  const [videoStart, setVideoStart] = useState("");
  const [videoEndMin, setVideoEndMin] = useState("");
  const [videoEnd, setVideoEnd] = useState("");
  const [videoSubmitLabel, setVideoSubmitLabel] = useState("영상 요청");

  const { on, emit, ready } = useSlidesRealtime(roomId, "audience");

  // 같은 연수에 다시 들어올 때 쓰던 닉네임을 채워 둔다(참가자 ID 는 훅이 기억).
  useEffect(() => {
    const saved = readText(`ll:nick:${roomId}`);
    const savedChar = readText(`ll:char:${roomId}`);
    // localStorage 는 브라우저에서만 읽혀 첫 렌더(서버)와 맞추려고 effect 에서 채운다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setNickname(saved);
    if (savedChar && characterById(savedChar)) setCharacter(savedChar);
  }, [roomId]);

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
      const s = state as Partial<AudienceState>;
      if (s.poll !== undefined) {
        const active = s.poll?.active ? s.poll : null;
        // 새 투표가 열리면 다시 투표할 수 있게
        if (active && active.id !== pollIdRef.current) {
          pollIdRef.current = active.id;
          setVoted(false);
        }
        setPoll(active);
      }
      if (s.participantCount !== undefined) setParticipantCount(s.participantCount);
      if (s.videoChatEnabled !== undefined) {
        setVideoChatEnabled(s.videoChatEnabled);
        if (!s.videoChatEnabled) setActiveTab((t) => t === "video" ? "react" : t);
      }
    });
    on("participant-count", (n) => setParticipantCount(n as number));
    // 발표자가 겹치는 닉네임을 민수(2)처럼 바꿔 줄 수 있다 — 받은 이름으로 표시
    on("join-ack", (res) => {
      const ack = res as JoinAck;
      if (ack.ok && ack.nickname) setDisplayName(ack.nickname);
      if (ack.ok && ack.character) setCharacter(ack.character);
      else if (!ack.ok) {
        setJoined(false);
        setJoinError(ack.error || "참여하지 못했습니다.");
      }
    });

    return () => {};
  }, [ready, on]);

  const toPick = () => {
    if (!nickname.trim()) {
      setJoinError("닉네임을 입력해주세요.");
      return;
    }
    setJoinError("");
    setStep("pick");
  };

  const handleJoin = (chosen: string) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setStep("nick");
      setJoinError("닉네임을 입력해주세요.");
      return;
    }
    const finalChar = chosen || characterForNickname(trimmed).id;
    setJoinError("");
    setDisplayName(trimmed);
    setCharacter(finalChar);
    setJoined(true);
    writeText(`ll:nick:${roomId}`, trimmed);
    if (chosen) writeText(`ll:char:${roomId}`, chosen);
    emit("join-room", { roomId, nickname: trimmed, character: chosen || undefined });
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
    emit("vote-poll", { optionIndex: index, pollId: poll.id });
    setVoted(true);
  };

  const submitVideoRequest = () => {
    if (!joined || !videoUrl.trim()) return;
    const start = (parseInt(videoStartMin) || 0) * 60 + (parseInt(videoStart) || 0);
    const end = (parseInt(videoEndMin) || 0) * 60 + (parseInt(videoEnd) || 0);
    emit("video-request", { url: videoUrl.trim(), start, end, nickname: displayName });
    setVideoUrl("");
    setVideoStartMin("");
    setVideoStart("");
    setVideoEndMin("");
    setVideoEnd("");
    setVideoSubmitLabel("요청 완료!");
    setTimeout(() => setVideoSubmitLabel("영상 요청"), 2000);
  };

  if (!joined && step === "pick") {
    return (
      <div className="join-page">
        <div className="join-screen pick-screen">
          <div className="join-card pick-card">
            <h1>내 캐릭터 고르기</h1>
            <p className="join-subtitle">{nickname.trim()} 님, 광장에서 걸어다닐 친구를 골라요</p>
            <div className="char-grid" role="radiogroup" aria-label="캐릭터">
              {ANIMALS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={character === c.id}
                  className={`char-cell ${character === c.id ? "selected" : ""}`}
                  onClick={() => setCharacter(c.id)}
                >
                  <img src={c.file} alt="" loading="lazy" draggable={false} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            <button className="btn-primary btn-large" onClick={() => handleJoin(character)} disabled={!character}>
              {character ? `${characterById(character)?.name ?? ""}(으)로 참여하기` : "캐릭터를 눌러 고르세요"}
            </button>
            <button className="btn-ghost btn-full pick-skip" onClick={() => handleJoin("")}>건너뛰기 (자동으로 정해요)</button>
            <button className="pick-back" onClick={() => setStep("nick")}>← 닉네임 다시 쓰기</button>
          </div>
        </div>
      </div>
    );
  }

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
              onKeyDown={(e) => e.key === "Enter" && toPick()}
            />
            <p className="nick-hint">실명 말고 별명도 좋아요</p>
            <button className="btn-primary btn-large" onClick={toPick}>다음 — 캐릭터 고르기</button>
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
          <span className="audience-nickname">
            {character && <img className="audience-char" src={characterById(character)?.file} alt="" />}
            {displayName}
          </span>
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
                  <span className="video-time-group">
                    <input
                      type="number"
                      className="video-time-input"
                      placeholder="분"
                      min={0}
                      value={videoStartMin}
                      onChange={(e) => setVideoStartMin(e.target.value)}
                    />
                    <span className="video-time-colon">:</span>
                    <input
                      type="number"
                      className="video-time-input"
                      placeholder="초"
                      min={0}
                      max={59}
                      value={videoStart}
                      onChange={(e) => setVideoStart(e.target.value)}
                    />
                  </span>
                  <span className="video-time-sep">~</span>
                  <span className="video-time-group">
                    <input
                      type="number"
                      className="video-time-input"
                      placeholder="분"
                      min={0}
                      value={videoEndMin}
                      onChange={(e) => setVideoEndMin(e.target.value)}
                    />
                    <span className="video-time-colon">:</span>
                    <input
                      type="number"
                      className="video-time-input"
                      placeholder="초"
                      min={0}
                      max={59}
                      value={videoEnd}
                      onChange={(e) => setVideoEnd(e.target.value)}
                    />
                  </span>
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
