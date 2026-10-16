// 효과음·배경음악 — 음원 파일 없이 Web Audio 로 합성한다(설계서 §5, 라이브 광장 13단계 목록).
// 발표 화면에서만 쓴다. 브라우저는 사용자가 한 번 누르기 전엔 소리를 막으므로 첫 클릭 때 resume.

export type SfxName =
  | "pop" | "hatch" | "enter" | "lvup" | "blip" | "start" | "stamp"
  | "out" | "correct" | "win" | "coin" | "step";

const NOTE: Record<string, number> = {
  G4: 392, Ab4: 415.3, A4: 440, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.5,
};

// 배경음악: 96BPM 8분음표, C → G → Am → F
const CHORDS = [
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
];
const STEP_SEC = 60 / 96 / 2;

export class SoundFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musTimer: ReturnType<typeof setInterval> | null = null;
  private musStep = 0;
  private musNext = 0;
  sfxOn: boolean;
  musicOn: boolean;

  constructor(opts: { sfx: boolean; music: boolean }) {
    this.sfxOn = opts.sfx;
    this.musicOn = opts.music;
  }

  /** 사용자 클릭 안에서 불러야 소리가 난다. */
  unlock() {
    const Ctx = typeof window !== "undefined"
      ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
    if (!Ctx) return;
    if (!this.ctx) {
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 0.55;
      this.sfxGain.connect(this.master);
      this.musGain = ctx.createGain();
      this.musGain.gain.value = 0.16;
      this.musGain.connect(this.master);
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.musicOn) this.startMusic();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  dispose() {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
  }

  private tone(type: OscillatorType, freq: number, t: number, dur: number, vol = 0.5, toFreq?: number, out?: GainNode | null) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, vol: number, hp = 0, out?: GainNode | null) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = s;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(out ?? this.sfxGain!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  private seq(type: OscillatorType, notes: number[], gap: number, dur: number, vol = 0.4) {
    const t0 = this.ctx!.currentTime;
    notes.forEach((f, i) => this.tone(type, f, t0 + i * gap, dur, vol));
  }

  /** variant: blip 은 "o" | "x" | "가위" | "바위" | "보" */
  play(name: SfxName, variant?: string) {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    switch (name) {
      case "pop": this.tone("sine", 650, t, 0.09, 0.45, 950); break;
      case "hatch": this.seq("triangle", [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 0.07, 0.16); break;
      case "enter": this.tone("sine", NOTE.G5, t, 0.12, 0.35); this.tone("sine", NOTE.C6, t + 0.1, 0.18, 0.35); break;
      case "lvup": this.seq("square", [NOTE.G4, NOTE.B4, NOTE.D5, NOTE.G5, NOTE.B5], 0.07, 0.12, 0.22); break;
      case "blip": {
        const f = { o: 880, x: 440, 가위: 660, 바위: 392, 보: 988 }[variant ?? "o"] ?? 880;
        this.tone("square", f, t, 0.08, 0.2);
        break;
      }
      case "start": this.seq("square", [NOTE.C5, NOTE.C5, NOTE.C6], 0.16, 0.13, 0.25); break;
      case "stamp": this.tone("sine", 140, t, 0.35, 0.8, 50); this.noise(t, 0.2, 0.4); break;
      case "out": this.tone("sawtooth", 420, t, 0.45, 0.25, 90); this.noise(t, 0.25, 0.15, 800); break;
      case "correct": this.seq("triangle", [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5], 0.08, 0.18, 0.45); break;
      case "win": {
        const melody = [NOTE.C5, NOTE.C5, NOTE.C5, NOTE.C5, NOTE.Ab4, NOTE.Bb4, NOTE.C5, NOTE.Bb4, NOTE.C5];
        const times = [0, 0.12, 0.24, 0.36, 0.6, 0.84, 1.08, 1.26, 1.38];
        const lens = [0.1, 0.1, 0.1, 0.22, 0.22, 0.22, 0.16, 0.1, 0.6];
        melody.forEach((f, i) => {
          this.tone("square", f, t + times[i], lens[i], 0.18);
          this.tone("triangle", f / 2, t + times[i], lens[i], 0.3);
        });
        break;
      }
      case "coin": this.tone("square", NOTE.B5, t, 0.07, 0.2); this.tone("square", NOTE.E6, t + 0.07, 0.25, 0.2); break;
      case "step": this.tone("square", 260 + Math.random() * 160, t, 0.05, 0.12); break;
    }
  }

  private startMusic() {
    if (!this.ctx || this.musTimer) return;
    this.musNext = this.ctx.currentTime + 0.1;
    this.musStep = 0;
    this.musTimer = setInterval(() => this.scheduleMusic(), 60);
  }

  private stopMusic() {
    if (this.musTimer) clearInterval(this.musTimer);
    this.musTimer = null;
  }

  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    while (this.musNext < ctx.currentTime + 0.2) {
      const step = this.musStep % 8;
      const chord = CHORDS[Math.floor(this.musStep / 8) % CHORDS.length];
      const t = this.musNext;
      if (step === 0) this.tone("triangle", chord[0] / 4, t, STEP_SEC * 6, 0.5, undefined, this.musGain);
      if (step % 2 === 0) this.tone("square", chord[(step / 2) % 3] * 2, t, STEP_SEC * 0.9, 0.18, undefined, this.musGain);
      if (step === 3 || step === 7) this.tone("triangle", chord[2] * 4, t, STEP_SEC * 0.8, 0.12, undefined, this.musGain);
      if (step % 2 === 1) this.noise(t, 0.04, 0.12, 8000, this.musGain);
      this.musNext += STEP_SEC;
      this.musStep++;
    }
  }
}
