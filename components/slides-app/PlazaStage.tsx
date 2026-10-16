"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { PlazaEngine, type PlazaMember, type PlazaMode } from "@/lib/plaza/engine";
import { Confetti } from "@/lib/plaza/confetti";
import { SoundFx } from "@/lib/plaza/sound";
import { ANIMALS, activityLevel } from "@/lib/plaza/characters";
import type { Participant } from "@/hooks/useSlidesRealtime";

type Handler = (data: unknown) => void;

interface PlazaStageProps {
  on: (event: string, fn: Handler) => void;
  off: (event: string, fn: Handler) => void;
  title: string;
  mode: PlazaMode;
  sfx: boolean;
  music: boolean;
  /** 게임 화면(GameStage)이 같은 엔진·소리·꽃가루를 쓰도록 넘겨준다 */
  handleRef?: MutableRefObject<PlazaHandle | null>;
}

export interface PlazaHandle {
  engine: PlazaEngine;
  confetti: Confetti;
  sound: SoundFx;
}

declare global {
  interface Window {
    __plaza?: PlazaHandle & { addFake: (n: number) => void };
  }
}

const toMember = (p: Participant): PlazaMember => ({
  pid: p.pid,
  nickname: p.nickname,
  character: p.character,
  level: activityLevel(p),
  lastActive: p.lastActive || p.joinedAt,
});

/** 발표 화면 위 캐릭터 광장 — 엔진은 React 밖에서 돌고, 여기선 사건만 넘겨준다. */
export function PlazaStage({ on, off, title, mode, sfx, music, handleRef: outRef }: PlazaStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PlazaHandle | null>(null);

  useEffect(() => {
    if (!rootRef.current || !canvasRef.current) return;
    const confetti = new Confetti(canvasRef.current);
    const sound = new SoundFx({ sfx, music });
    const engine = new PlazaEngine(rootRef.current, { sound, confetti });
    const handle = { engine, confetti, sound };
    handleRef.current = handle;
    if (outRef) outRef.current = handle;

    // 브라우저는 사용자가 한 번 눌러야 소리를 낸다
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock);
    const onResize = () => confetti.resize();
    window.addEventListener("resize", onResize);

    let debug = false;
    try { debug = localStorage.getItem("ll:debug") === "1"; } catch { /* 없음 */ }
    if (debug) {
      // 성능 시험용 — 가짜 참가자를 화면에만 넣는다(통신 없음)
      window.__plaza = {
        ...handle,
        addFake: (n: number) => {
          const now = Date.now();
          for (let i = 0; i < n; i++) {
            const c = ANIMALS[i % ANIMALS.length];
            engine.upsert({ pid: `fake-${i}`, nickname: `${c.name}${i + 1}`, character: c.id, level: 1 + (i % 7), lastActive: now });
          }
        },
      };
    }

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("resize", onResize);
      engine.destroy();
      confetti.dispose();
      sound.dispose();
      handleRef.current = null;
      if (outRef) outRef.current = null;
      if (window.__plaza?.engine === engine) delete window.__plaza;
    };
    // 소리 설정은 아래 effect 가 따로 맞춘다 — 엔진은 한 번만 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { handleRef.current?.engine.setMode(mode); }, [mode]);
  useEffect(() => { handleRef.current?.engine.setTitle(title); }, [title]);
  useEffect(() => { handleRef.current?.sound.setSfx(sfx); }, [sfx]);
  useEffect(() => { handleRef.current?.sound.setMusic(music); }, [music]);

  useEffect(() => {
    const eng = () => handleRef.current?.engine;
    const onList: Handler = (d) => eng()?.sync((d as Participant[]).filter((p) => p.online).map(toMember));
    const onJoined: Handler = (d) => {
      const { participant, isNew } = d as { participant: Participant; isNew: boolean };
      eng()?.upsert(toMember(participant), { hatch: isNew });
    };
    const onLeft: Handler = (d) => eng()?.remove((d as Participant).pid);
    const onUpdate: Handler = (d) => {
      const p = d as Participant;
      if (p.online) eng()?.upsert(toMember(p));
    };
    const onChat: Handler = (d) => {
      const c = d as { pid?: string; message: string };
      if (c.pid) eng()?.say(c.pid, c.message);
    };
    const onReaction: Handler = (d) => {
      const r = d as { pid?: string; emoji: string };
      if (r.pid) eng()?.react(r.pid, r.emoji);
    };
    const onQuestion: Handler = (d) => eng()?.ask((d as { pid: string }).pid);
    const pairs: Array<[string, Handler]> = [
      ["participants", onList], ["participant-joined", onJoined], ["participant-left", onLeft],
      ["participant-update", onUpdate], ["chat", onChat], ["reaction", onReaction], ["question", onQuestion],
    ];
    pairs.forEach(([e, fn]) => on(e, fn));
    return () => pairs.forEach(([e, fn]) => off(e, fn));
  }, [on, off]);

  return (
    <>
      <div ref={rootRef} aria-hidden="true" />
      <canvas ref={canvasRef} className="pz-confetti" aria-hidden="true" />
    </>
  );
}
