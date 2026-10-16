"use client";

import type { Standing } from "@/hooks/useSlidesRealtime";
import { characterById, characterForNickname } from "@/lib/plaza/characters";

// 🏆 종합 순위판 (설계서 §6-2) — 지금까지 끝난 게임 누적 TOP 10. 순위가 오르면 ▲.

interface RankBoardProps {
  standings: Standing[];
  games: number;
  onClose: () => void;
}

const charFile = (s: Standing) => (characterById(s.character) ?? characterForNickname(s.nickname)).file;

export function Delta({ d }: { d: number }) {
  if (!d) return <span className="rb-delta same">–</span>;
  return d > 0 ? <span className="rb-delta up">▲{d}</span> : <span className="rb-delta down">▼{-d}</span>;
}

export function RankBoard({ standings, games, onClose }: RankBoardProps) {
  const top = standings.slice(0, 10);
  return (
    <div className="rb-overlay" onClick={onClose} role="dialog" aria-label="종합 순위">
      <div className="rb-card" onClick={(e) => e.stopPropagation()}>
        <div className="rb-head">
          <h2>🏆 종합 순위</h2>
          <span className="rb-meta">참가 {standings.length}명 · 게임 {games}판</span>
          <button className="rb-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {games === 0 ? (
          <p className="rb-empty">아직 끝난 게임이 없어요 — 게임 탭에서 퀴즈·가위바위보·달리기를 해 보세요</p>
        ) : (
          <>
            <div className="gm-podium rb-podium">
              {[1, 0, 2].map((i) => {
                const s = top[i];
                if (!s) return <div key={i} className="gm-pod empty" />;
                return (
                  <div key={s.pid} className={`gm-pod p${i + 1}`}>
                    <span className="gm-pod-medal">{["👑", "🥈", "🥉"][i]}</span>
                    <img src={charFile(s)} alt="" />
                    <span className="gm-pod-name">{s.nickname}</span>
                    <span className="gm-pod-pts">{s.points}점 <Delta d={s.delta} /></span>
                    <div className="gm-pod-block">{s.rank}</div>
                  </div>
                );
              })}
            </div>
            {top.length > 3 && (
              <ol className="gm-list rb-list" start={4}>
                {top.slice(3).map((s) => (
                  <li key={s.pid}>
                    <span>{s.nickname}</span>
                    <b>{s.points}점</b>
                    <Delta d={s.delta} />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        <p className="gm-popup-hint">바깥을 누르면 닫혀요 · 1·2·3등은 광장에서도 왕관·메달을 달아요</p>
      </div>
    </div>
  );
}
