// 60명 달리기 부하 — 가짜 참가자 N명(기본 60, node + supabase-js, 실제 Supabase) + 실제 발표자 화면(Playwright 크롬)
// Ironman 실측 스크립트(iron-run60)를 가져온 것. 달리기 한 판 동안 아무 1초 창(미끄럼 창)의 최고 건수가 LIMIT(기본 100) 이하인지 본다.
// 사용: 서버를 먼저 띄운다(npm run build && npx next start --port 3030) → N=60 node tests/run60-load.mjs
// 결과: tests/out/run60-result.json · run60-host.png, 콘솔 요약.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { createClient } = await import(path.join(ROOT, "node_modules/@supabase/supabase-js/dist/index.mjs"));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium } = await import(PW);

const BASE = process.env.BASE || "http://localhost:3030";
const N = Number(process.env.N || 60);
const ACTIVITY_SEC = Number(process.env.ACTIVITY_SEC || 60);
// 40명 시험은 80(안전선), 60·80명 시험은 Supabase 무료 한도 100 으로 본다(Ironman 10/16 기준).
const LIMIT_PER_SEC = Number(process.env.LIMIT || 100);
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").trim().split("\n")
    .filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);

// 구글 슬라이드 iframe 이 내는 것(광고·로깅 차단, report-only CSP 보고)은 앱 오류가 아니라 뺀다.
function isExternalNoise(t) {
  return t.includes("ERR_BLOCKED_BY_CLIENT") || (t.includes("docs.google.com") && t.includes("report-only"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = []; // [ms, who, dir, event]
const mark = (who, dir, event) => log.push([Date.now(), who, dir, event]);
const phases = [];
const phase = (name) => { phases.push({ name, at: Date.now() }); console.log(`\n▶ ${name} (+${((Date.now() - T0) / 1000).toFixed(1)}s)`); };
const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// ── 연수 준비 ──
let roomId = process.argv[2];
if (!roomId) {
  const r = await fetch(`${BASE}/api/rooms`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slideUrl: "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit", title: "THOR P1 부하시험" }),
  });
  roomId = (await r.json()).roomId;
}
console.log("room", roomId);

// ── 가짜 폰 ──
const NAMES = ["민수", "민수", "민수", "지우", "서연", "하준", "도윤", "서윤", "시우", "하은", "지호", "수아", "예준", "지아", "주원", "윤서", "건우", "채원", "우진", "지유",
  "선우", "다은", "연우", "수빈", "유준", "예은", "정우", "소율", "승우", "예린", "지환", "하린", "현우", "가은", "준서", "서아", "도현", "아린", "은우", "나은"];

class Phone {
  constructor(i) {
    this.i = i;
    this.pid = crypto.randomUUID();
    this.nick = NAMES[i % NAMES.length];
    this.name = null; // 발표자가 돌려준 이름
    this.acked = false;
    this.ackAt = 0;
    this.sent = { chats: 0, reactions: 0, questions: 0, votes: 0 };
    this.poll = null;
    this.voted = false;
    this.connect();
  }
  connect() {
    this.sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    this.pub = this.sb.channel(`slides-room:${roomId}`, { config: { broadcast: { self: false } } });
    this.cmd = this.sb.channel(`slides-cmd:${roomId}`);
    this.pub.on("broadcast", { event: "room-state" }, ({ payload }) => {
      mark("phone", "recv", "room-state");
      const mine = payload.acks?.find((a) => a.pid === this.pid);
      if (mine?.ok) { this.acked = true; this.name = mine.nickname; this.ackAt = Date.now(); }
      if (payload.poll !== undefined) this.poll = payload.poll?.active ? payload.poll : null;
      if (payload.game !== undefined) { this.game = payload.game; this.onGame?.(payload.game); }
    });
    this.pub.on("broadcast", { event: "host-rejoined" }, ({ payload }) => {
      mark("phone", "recv", "host-rejoined");
      if (!this.joinedOnce) return;
      this.acked = false;
      const spread = Math.min(30000, Math.max(4000, Number(payload?.spreadMs) || 4000)); // 훅과 같은 규칙
      setTimeout(() => this.join(), Math.random() * spread);
    });
    this.subscribed = new Promise((res) => this.pub.subscribe((s) => s === "SUBSCRIBED" && res()));
  }
  async send(event, payload, retries = 2) {
    for (let a = 0; a <= retries; a++) {
      mark("phone", "sent", event);
      try { await this.cmd.httpSend(event, { pid: this.pid, nickname: this.name || this.nick, ...payload }); return true; }
      catch { await sleep(500 * (a + 1) ** 2); }
    }
    return false;
  }
  async join() {
    this.joinedOnce = true;
    await this.send("join-room", {});
    clearInterval(this.retry);
    this.retry = setInterval(() => { if (this.acked) clearInterval(this.retry); else this.send("join-room", {}); }, 5000);
  }
  async chat(n) { if (await this.send("chat", { message: `안녕하세요 ${this.i}-${n}` }, 1)) this.sent.chats++; }
  async react() { if (await this.send("reaction", { emoji: ["👍", "❤️", "😂", "👏", "🔥"][Math.floor(Math.random() * 5)] }, 1)) this.sent.reactions++; }
  async question() { if (await this.send("submit-question", { text: `질문 있어요 ${this.i}` }, 3)) this.sent.questions++; }
  async vote() {
    if (!this.poll || this.voted) return;
    this.voted = true;
    if (await this.send("vote-poll", { pollId: this.poll.id, optionIndex: this.i % this.poll.options.length }, 3)) this.sent.votes++;
  }
  async reconnect() { // 폰 새로고침 흉내 — 같은 pid 로 다시 접속·입장
    clearInterval(this.retry);
    await this.sb.removeAllChannels();
    this.acked = false;
    this.connect();
    await this.subscribed;
    await this.join();
  }
  async close() { clearInterval(this.retry); await this.sb.removeAllChannels(); }
}

// ── 초당 메시지 감시 ──
let stopReason = "";
// 평균은 구간 전체로, 최고치는 "아무 1초 창"(미끄럼 창)으로 잰다 — 1초 칸 경계에 걸쳐 숨는 몰림까지 잡는다.
const perSecond = (from, to) => {
  const rows = log.filter(([t]) => t >= from && t < to).sort((a, b) => a[0] - b[0]);
  const secs = Math.max(1, (to - from) / 1000);
  let sent = 0, recv = 0;
  for (const r of rows) r[2] === "sent" ? sent++ : recv++;
  let peak = { sent: 0, recv: 0, total: 0, at: 0 };
  let j = 0, ws = 0, wr = 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i][2] === "sent" ? ws++ : wr++;
    while (rows[i][0] - rows[j][0] >= 1000) { rows[j][2] === "sent" ? ws-- : wr--; j++; }
    if (ws + wr > peak.total) peak = { sent: ws, recv: wr, total: ws + wr, at: +((rows[j][0] - from) / 1000).toFixed(1) };
  }
  return { secs: +secs.toFixed(1), sent, recv, avgSent: +(sent / secs).toFixed(1), avgRecv: +(recv / secs).toFixed(1), avgTotal: +((sent + recv) / secs).toFixed(1), peak };
};
let hostLogCursor = 0;
const pullHostLog = async (page) => {
  const rows = await page.evaluate((from) => (window.__llStats?.log || []).slice(from), hostLogCursor).catch(() => []);
  hostLogCursor += rows.length;
  for (const [t, dir, ev] of rows) log.push([t, "host", dir, ev]);
};
const watch = (getPages) => setInterval(async () => {
  for (const p of getPages()) if (p && !p.isClosed()) await pullHostLog(p);
  const now = Date.now();
  const w = perSecond(now - 3000, now - 500).peak;
  if (w.total > LIMIT_PER_SEC && !stopReason) {
    stopReason = `초당 ${w.total}건(보냄 ${w.sent}·받음 ${w.recv}) — 한도 ${LIMIT_PER_SEC} 초과`;
    console.log("⛔ " + stopReason);
  }
}, 1000);

// ── 발표자 ──
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("ll:debug", "1"); } catch {} });
const host = await ctx.newPage();
const consoleErrors = [];
// 구글 슬라이드 iframe 안 광고·로깅 요청이 헤드리스 크롬에서 막히는 것(ERR_BLOCKED_BY_CLIENT)은 앱 오류가 아니라 뺀다.
let ignoredErrors = 0;
host.on("console", (m) => {
  if (m.type() !== "error") return;
  if (isExternalNoise(m.text())) { ignoredErrors++; return; }
  consoleErrors.push(m.text().slice(0, 200));
});
host.on("pageerror", (e) => consoleErrors.push("pageerror " + String(e).slice(0, 200)));
let hostPages = [host];
const watcher = watch(() => hostPages);

const hostActive = async (page) => page.waitForFunction(() => (window.__llStats?.sent?.["host-rejoined"] || 0) >= 1, null, { timeout: 15000 });
const snapshot = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `ll:host:${roomId}`);
const topCount = (page) => page.evaluate(() => Number((document.querySelector(".topbar-count")?.textContent || "").replace(/\D/g, "")) || 0);

phase("발표자 화면 열기");
await host.goto(`${BASE}/presenter?room=${roomId}`);
await hostActive(host);
check("발표자 탭 진행(active) 상태", true);

const phones = Array.from({ length: N }, (_, i) => new Phone(i));
await Promise.all(phones.map((p) => p.subscribed));

phase(`참가 ${N}명 (0.25초 간격)`);
const joinStart = Date.now();
for (const p of phones) { void p.join(); await sleep(250); }
const joinDeadline = Date.now() + 20000;
while (phones.some((p) => !p.acked) && Date.now() < joinDeadline) await sleep(200);
const acked = phones.filter((p) => p.acked).length;
check(`${N}명 참가 확인(ack)`, acked === N, `${acked}/${N}, 마지막 ack ${((Math.max(...phones.map((p) => p.ackAt)) - joinStart) / 1000).toFixed(1)}초`);
const minsu = phones.filter((p) => p.nick === "민수").map((p) => p.name).sort();
const expectMinsu = minsu.map((_, i) => (i === 0 ? "민수" : `민수(${i + 1})`)).sort();
check("닉네임 중복 구분", minsu.length >= 3 && JSON.stringify(minsu) === JSON.stringify(expectMinsu), minsu.join(", "));
await sleep(1500);
check("발표 화면 인원", (await topCount(host)) === N, `${await topCount(host)}명`);

// ───────── Ironman: 60명 달리기 부하 (폰 규칙 그대로 흉내: 초당 최대 8걸음, 첫 묶음 0~간격 무작위, 골인 즉시 전송) ─────────
const GOAL = Number(process.env.GOAL || 200);
Phone.prototype.onGame = function (g) {
  this.game = g;
  // 실제 폰(PhoneGame.tsx)은 finished 화면에 [달려!] 버튼이 없어 더 못 누른다 → 걸음 수가 안 늘어 묶음도 안 나간다. 똑같이 멈춘다.
  if (g && g.type === "run" && g.phase === "finished" && this.goGid === g.id && !this.done) {
    this.done = true; clearInterval(this.batchT); clearInterval(this.tapT);
    this.stoppedByFinish = true;
  }
  if (g && g.type === "run" && g.phase === "countdown" && this.goGid !== g.id) {
    this.goGid = g.id;
    this.goAt = Date.now() + 3000;
    this.total = 0; this.sentTotal = 0; this.done = false;
    this.rate = 5 + Math.random() * 3; // 초당 5~8번 누름
    const batchMs = g.run?.batchMs || 1000;
    const tick = () => {
      if (this.done) return;
      const now = Date.now();
      if (now < this.goAt) return;
      this.total = Math.min(GOAL, Math.floor(((now - this.goAt) / 1000) * this.rate));
      if (this.total >= GOAL && !this.done) {
        this.done = true;
        clearInterval(this.batchT); clearInterval(this.tapT);
        void this.send("game-steps", { gid: g.id, total: GOAL, finishMs: now - this.goAt }, 1);
      }
    };
    this.tapT = setInterval(tick, 100);
    const flush = () => { if (this.done || this.total <= this.sentTotal) return; this.sentTotal = this.total; void this.send("game-steps", { gid: g.id, total: this.total }, 1); };
    setTimeout(() => { if (this.done) return; flush(); this.batchT = setInterval(flush, batchMs); }, (this.goAt - Date.now()) + Math.random() * batchMs);
    setTimeout(() => { this.done = true; clearInterval(this.batchT); clearInterval(this.tapT); }, 3000 + (g.run?.limitSec || 60) * 1000 + 2000);
  }
};
for (const p of phones) if (p.game) p.onGame(p.game);

phase(`달리기 ${N}명 (목표 ${GOAL}걸음)`);
if (!(await host.locator(".dock-body").count())) await host.click(".dock-toggle");
await host.click(".dock-tab:has-text('게임')");
await host.fill("label:has-text('목표') input", String(GOAL));
await host.click("button:has-text('🏃 달리기')");
await host.click(".dock-toggle");
await sleep(2500);
const raceFrom = Date.now();
await host.click('.gm-controls button:has-text("3·2·1 출발")');
const deadline = Date.now() + 75000;
while (Date.now() < deadline) {
  await sleep(2000);
  if (phones.every((p) => p.done)) break;
}
await sleep(4000);
await pullHostLog(host);
const raceTo = Date.now();
const finished = phones.filter((p) => p.sentTotal >= GOAL || p.done).length;
const r = perSecond(raceFrom, raceTo);
const batchMs = phones[0].game?.run?.batchMs;
console.log(`\n달리기 구간: 묶음 간격 ${batchMs}ms · 평균 보냄 ${r.avgSent} · 받음 ${r.avgRecv} · 합 ${r.avgTotal}/초 | 최고 1초 ${r.peak.total}(보냄 ${r.peak.sent}·받음 ${r.peak.recv}) @${r.peak.at}s`);
const hostSnap = await snapshot(host);
const hostGateWaits = await host.evaluate(() => window.__llStats?.notes?.["gate-wait"] || 0).catch(() => -1);
console.log(`방송 문지기가 미룬 횟수: ${hostGateWaits}`);
const runRec = (hostSnap?.games || []).find((x) => x.type === "run");
check("달리기 기록 저장됨", !!runRec, runRec ? `골인 ${Object.keys(runRec.points || {}).length}명에 점수` : "기록 없음");
check(`달리기 1초 최고 ${LIMIT_PER_SEC}건 이하`, r.peak.total <= LIMIT_PER_SEC && !stopReason, `${r.peak.total}건 ${stopReason}`);
const evCount = {};
for (const [t, who, dir, ev] of log) if (t >= raceFrom && t < raceTo) evCount[`${who}.${dir}.${ev}`] = (evCount[`${who}.${dir}.${ev}`] || 0) + 1;
console.log("이벤트별:", evCount);
await host.screenshot({ path: path.join(OUT, "run60-host.png") });
clearInterval(watcher);
for (const p of phones) await p.close().catch(() => {});
await browser.close();
const pass = results.filter((x) => x.pass).length;
fs.writeFileSync(path.join(OUT, "run60-result.json"), JSON.stringify({ N, batchMs, race: r, gateWaits: hostGateWaits, results, evCount }, null, 2));
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
