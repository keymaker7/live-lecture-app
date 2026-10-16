// P4 게이트 e2e — 점수 규칙 바꾸기, 종합 순위(▲), 폰 순위, 왕관·메달, CSV 2종, 참가 토큰(사칭 차단),
// DB 저장 → 다른 브라우저 프로필에서 🔑 발표자 링크로 열어 순위 복원.
// 실시간 통신은 실제 Supabase. DB 함수 호출(/rest/v1/rpc/*)만 가로채서 PGlite(메모리 Postgres + 마이그레이션 전부)로 답한다
// — 운영 DB 에는 새 마이그레이션이 없다(적용은 리뷰 뒤).
// 사용: LL_RESULTS_DB=1 로 서버를 띄운다 → BASE=http://localhost:3031 node tests/p4-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { freshDb, rpcAs } from "./p4-db.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium, devices } = await import(PW);
const BASE = process.env.BASE || "http://localhost:3031";
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
function isExternalNoise(t) {
  return t.includes("ERR_BLOCKED_BY_CLIENT") || (t.includes("docs.google.com") && t.includes("report-only"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryWait = (p) => p.then(() => true).catch(() => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `p4-${name}.png`) });
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const cfg = await (await fetch(`${BASE}/api/config`)).json();
check("서버 설정: 결과 DB 저장 켜짐(LL_RESULTS_DB=1)", cfg.resultsDb === true, JSON.stringify({ resultsDb: cfg.resultsDb }));

// ── DB(PGlite) + 가로채기 ──
const db = await freshDb();
const rpcLog = [];
const routeDb = async (ctx) => {
  await ctx.route("**/rest/v1/rpc/**", async (route) => {
    const req = route.request();
    const fn = new URL(req.url()).pathname.split("/").pop();
    const args = JSON.parse(req.postData() || "{}");
    const r = await rpcAs(db, fn, args);
    rpcLog.push({ fn, ok: !r.error, data: typeof r.data === "object" ? "(json)" : r.data });
    if (r.error) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: r.error.message }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r.data) });
  });
};

// 연수는 운영 DB 에 예전 함수로 만들어진다(v2 가 운영에 없어 서버가 예전 함수로 다시) → PGlite 에도 같은 "예전 연수"를 둔다
const r = await fetch(`${BASE}/api/rooms`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ slideUrl: "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit", title: "THOR P4 순위 e2e", hostKeyHash: "a".repeat(64) }),
});
const { roomId } = await r.json();
console.log("room", roomId);
await db.query("INSERT INTO lecture_rooms (id, title, slide_url, slide_type) VALUES ($1, 'THOR P4 순위 e2e', 'https://x', 'google')", [roomId]);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const watch = (page, who) => {
  page.on("console", (m) => { if (m.type() === "error" && !isExternalNoise(m.text())) errors.push(`${who}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${who} pageerror: ${String(e).slice(0, 160)}`));
};
const hostInit = () => { try { localStorage.setItem("ll:debug", "1"); localStorage.setItem("ll:sfx", "off"); } catch {} };

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
await hostCtx.addInitScript(hostInit);
await routeDb(hostCtx);
const host = await hostCtx.newPage();
watch(host, "발표자");
await host.goto(`${BASE}/presenter?room=${roomId}`);
await host.waitForFunction(() => (window.__llStats?.sent?.["host-rejoined"] || 0) >= 1, null, { timeout: 15000 });
await host.click(".update-notice button", { timeout: 3000 }).catch(() => {}); // 새 버전 안내 닫기

const NAMES = ["하나", "두리", "세찌"];
const phones = [];
// 폰이 실제로 받은 실시간 메시지(웹소켓 프레임) — 참가 확인(acks)·순위 방송에 토큰이 섞이지 않았나 본다
const frames = [];
for (const nick of NAMES) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  const p = await ctx.newPage();
  watch(p, nick);
  p.on("websocket", (ws) => ws.on("framereceived", (f) => { const t = String(f.payload); if (t.includes("room-state")) frames.push(t); }));
  await p.goto(`${BASE}/join/${roomId}`);
  await p.fill("#nickname", nick);
  await p.click("button:has-text('캐릭터 고르기')");
  await p.click("button:has-text('건너뛰기')");
  await p.waitForSelector(".audience-screen");
  phones.push(p);
}
await tryWait(host.waitForFunction(() => document.querySelector(".topbar-count")?.textContent?.includes("3"), null, { timeout: 10000 }));
const [p1, p2, p3] = phones;
const pids = await Promise.all(phones.map((p) => p.evaluate((k) => localStorage.getItem(k), `ll:pid:${roomId}`)));
const toks = await Promise.all(phones.map((p) => p.evaluate((k) => localStorage.getItem(k), `ll:tok:${roomId}`)));
const snap = () => host.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `ll:host:${roomId}`);
const waitSnap = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const s = await snap();
    if (fn(s) || Date.now() > end) return s;
    await sleep(200);
  }
};
const s0 = await waitSnap((s) => s?.participants?.length === 3 && s.participants.every((x) => x.th));
check("참가: 폰마다 토큰 해시(th)만 받음 — 토큰 자체는 발표자 기록에 없음",
  pids.every((pid, i) => s0?.participants?.find((x) => x.pid === pid)?.th === sha(toks[i])) && !JSON.stringify(s0).includes(toks[0]),
  `th ${s0?.participants?.filter((x) => x.th).length}/3`);

const ctl = (label) => host.click(`.gm-controls button:has-text("${label}")`);
const openDockGame = async () => {
  if (!(await host.locator(".dock-body").count())) await host.click(".dock-toggle");
  await host.click(".dock-tab:has-text('게임')");
};
const closeDock = async () => { if (await host.locator(".dock-body").count()) await host.click(".dock-toggle"); };

// ───────── 1. 점수 규칙 바꾸기 → 퀴즈 ─────────
await openDockGame();
await host.click(".gd-rules summary");
await host.fill("input[aria-label='OX·객관식 정답 / 빠르기 최대 correct']", "20");
check("점수 규칙: 바꾸면 '(바꿈)' 표시", ((await host.textContent(".gd-rules summary")) || "").includes("바꿈"));
await host.fill(".gd-text", "OX | 물은 100도에서 끓는다 | O\n객관식 | 2+3은? | 4, 5, 6, 7 | 2");
await host.fill(".gd-name", "P4 퀴즈");
await host.click("button:has-text('퀴즈 시작')");
await closeDock();
await ctl("첫 문제 공개");
await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-btn.ox.o", { timeout: 6000 }))));
await p1.click(".pg-btn.ox.o");
await p2.click(".pg-btn.ox.o");
await p3.click(".pg-btn.ox.x");
await sleep(800);
await ctl("지금 마감");
await ctl("정답 공개");
await tryWait(p1.waitForSelector(".pg-result.ok", { timeout: 6000 }));
await ctl("다음 문제");
await Promise.all(phones.map((p) => tryWait(p.waitForFunction(() => document.querySelectorAll(".pg-btn.mc").length === 4, null, { timeout: 6000 }))));
await p1.click(".pg-btn.mc >> nth=1");
await p2.click(".pg-btn.mc >> nth=0");
await p3.click(".pg-btn.mc >> nth=0");
await sleep(800);
await ctl("지금 마감");
await ctl("정답 공개");
await sleep(1200);
await ctl("결과 보기");
check("퀴즈 결과 화면: 문제별 정답률 막대 2개", await tryWait(host.waitForFunction(() => document.querySelectorAll(".gm-rate").length === 2, null, { timeout: 6000 })),
  ((await host.locator(".gm-rates").textContent().catch(() => "")) || "").replace(/\s+/g, " "));
await shot(host, "quiz-result-rates");
const s1 = await waitSnap((s) => s?.games?.length >= 1);
const q = s1?.games?.[0];
const qp = pids.map((pid) => q?.points?.[pid] ?? 0);
check("바꾼 규칙(정답 +20) 적용: 하나 2문제 42~52점, 두리 22~27, 세찌 2", qp[0] >= 42 && qp[0] <= 52 && qp[1] >= 22 && qp[1] <= 27 && qp[2] === 2, JSON.stringify(qp));
check("게임 기록에 퀴즈 통계(정답 수·답한 수) 포함", q?.stats?.[pids[0]]?.correct === 2 && q?.stats?.[pids[0]]?.answered === 2, JSON.stringify(q?.stats?.[pids[0]]));
const rank1 = await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-rank", { timeout: 6000 })).then(() => p.textContent(".pg-rank").catch(() => ""))));
check("폰 게임 끝: '전체 N위' — 하나 1위·두리 2위·세찌 3위", rank1[0].includes("전체 1위") && rank1[1].includes("전체 2위") && rank1[2].includes("전체 3위"), rank1.join(" / "));
await shot(p1, "phone-finish-rank");
await host.click(".gm-popup").catch(() => {});
await ctl("닫기");
await tryWait(p1.waitForSelector(".audience-tabs", { timeout: 6000 }));
const head1 = await p1.textContent(".audience-rank");
check("폰 위쪽 'Lv · 점수 · 순위'", /Lv\.\d+ · \d+점 · 1위/.test(head1 || ""), head1);

// DB 저장(예전 연수 → claim → 저장)
const db1 = await tryWait(host.waitForFunction(() => document.querySelector(".gd-db")?.textContent?.includes("DB 저장됨") || !document.querySelector(".gd-db"), null, { timeout: 8000 }));
const hk = await host.evaluate((k) => localStorage.getItem(k), `ll:hk:${roomId}`);
const roomRow = (await db.query("SELECT host_key_hash FROM lecture_rooms WHERE id = $1", [roomId])).rows[0];
const saved1 = (await db.query("SELECT game_id, results FROM lecture_game_results WHERE room_id = $1", [roomId])).rows;
check("DB: 예전 연수라 첫 저장 때 이 PC 비밀값 해시 등록(claim) → 1판 저장", db1 && roomRow?.host_key_hash === sha(hk) && saved1.length === 1 && saved1[0].game_id === q.id,
  `claim ${roomRow?.host_key_hash === sha(hk)} · 행 ${saved1.length} · 호출 ${rpcLog.map((x) => `${x.fn}:${x.data}`).join(",")}`);
check("DB 묶음에 참가 토큰·해시 없음", !JSON.stringify(saved1[0]?.results ?? {}).match(/"th"|"tok"/) && !toks.some((t) => JSON.stringify(saved1).includes(t)));

// ───────── 2. 가위바위보 — 세찌 역전(▲) ─────────
await openDockGame();
await host.click("button:has-text('가위바위보')");
await closeDock();
await Promise.all(phones.map((p) => tryWait(p.waitForFunction(() => document.querySelectorAll(".pg-grid.three .pg-btn").length === 3, null, { timeout: 6000 }))));
await p1.click(".pg-btn:has-text('보')");
await p2.click(".pg-btn:has-text('보')");
await p3.click(".pg-btn:has-text('바위')");
await tryWait(host.waitForFunction(() => document.querySelector(".gm-rps .gm-tally")?.textContent?.includes("3명"), null, { timeout: 6000 }));
await host.click(".gm-controls button:has-text('✌️ 가위')");
check("가위바위보: 세찌 혼자 이겨 우승", await tryWait(p3.waitForSelector(".pg-center h2:has-text('우승')", { timeout: 10000 })));
const rank2 = await Promise.all(phones.map((p) => tryWait(p.waitForFunction(() => /전체 \d위/.test(document.querySelector(".pg-rank")?.textContent || "") && !document.querySelector(".pg-rank").textContent.includes("총 2점") , null, { timeout: 6000 })).then(() => p.textContent(".pg-rank").catch(() => ""))));
check("폰: 세찌 '전체 2위 (▲1)', 두리 '3위 (▼1)'", rank2[2].includes("전체 2위 (▲1)") && rank2[1].includes("전체 3위 (▼1)"), rank2.join(" / "));
await shot(p3, "phone-rank-up");
await host.click(".gm-popup").catch(() => {});
await ctl("닫기");

// ───────── 3. 🏆 종합 순위판 + 왕관·메달 ─────────
await host.click(".topbar-rank");
await host.waitForSelector(".rb-card", { timeout: 4000 });
await sleep(600);
const board = await host.evaluate(() => ({
  meta: document.querySelector(".rb-meta")?.textContent,
  pod: [...document.querySelectorAll(".rb-podium .gm-pod:not(.empty)")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
}));
await shot(host, "rank-board");
check("종합 순위판: 참가 3명 · 게임 2판", board.meta === "참가 3명 · 게임 2판", board.meta);
// 시상대는 2·1·3 순으로 놓인다
check("종합 순위판: 1위 하나, 2위 세찌 ▲1, 3위 두리 ▼1", board.pod[1]?.includes("하나") && board.pod[0]?.includes("세찌") && board.pod[0]?.includes("▲1") && board.pod[2]?.includes("두리") && board.pod[2]?.includes("▼1"), board.pod.join(" | "));
await host.click(".rb-close");
const medals = await host.evaluate((ps) => ps.map((pid) => document.querySelector(`.pz-ch[data-pid="${pid}"] .pz-medal`)?.textContent || ""), pids);
check("순위판 뒤 광장: 하나 👑 · 세찌 🥈 · 두리 🥉", medals[0] === "👑" && medals[2] === "🥈" && medals[1] === "🥉", medals.join(" "));
await host.evaluate(() => { localStorage.setItem("ll:view", "plaza"); });
await host.click("button:has-text('광장')");
await sleep(1200);
await shot(host, "plaza-medals");

// ───────── 4. 참가 토큰 — 남의 pid 사칭 차단 ─────────
const bcast = (event, payload) => fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
  method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ topic: `slides-cmd:${roomId}`, event, payload, private: false }] }),
});
const before = await snap();
const chatsBefore = before.participants.find((x) => x.pid === pids[0]).chats;
const dropBefore = await host.evaluate(() => window.__llStats?.recv?.["token-mismatch"] || 0);
await bcast("chat", { pid: pids[0], nickname: "하나", message: "나 하나 아님", tok: "0".repeat(32) });
await bcast("chat", { pid: pids[0], nickname: "하나", message: "토큰도 없음" });
await bcast("join-room", { pid: pids[0], nickname: "해커", th: sha("x") });
await bcast("reaction", { pid: pids[1], nickname: "두리", emoji: "👍", tok: toks[0] }); // 남의 토큰
await tryWait(host.waitForFunction((n) => (window.__llStats?.recv?.["token-mismatch"] || 0) >= n + 4, dropBefore, { timeout: 8000 }));
await bcast("chat", { pid: pids[0], nickname: "하나", message: "진짜 하나", tok: toks[0] }); // 맞는 토큰은 받음
const after = await waitSnap((s) => s.participants.find((x) => x.pid === pids[0]).chats > chatsBefore, 8000);
const a1 = after.participants.find((x) => x.pid === pids[0]);
const dropAfter = await host.evaluate(() => window.__llStats?.recv?.["token-mismatch"] || 0);
check("사칭 4건(틀린 토큰·토큰 없음·다른 해시로 재참가·남의 토큰) 전부 버림", dropAfter - dropBefore === 4 && a1.nickname === "하나", `버림 ${dropAfter - dropBefore} · 이름 ${a1.nickname}`);
check("맞는 토큰의 명령은 받음(채팅 +1)", a1.chats === chatsBefore + 1, `${chatsBefore} → ${a1.chats}`);
const withAcks = frames.filter((f) => f.includes('"acks"')).length;
const withRanks = frames.filter((f) => f.includes('"ranks"')).length;
const leaked = frames.filter((f) => toks.some((t) => f.includes(t)) || toks.some((t) => f.includes(sha(t)))).length;
check("폰이 받은 방송(참가 확인 acks·순위 ranks)에 토큰·토큰 해시 없음", withAcks > 0 && withRanks > 0 && leaked === 0, `프레임 ${frames.length} · acks ${withAcks} · ranks ${withRanks} · 섞인 것 ${leaked}`);

// ───────── 5. 📊 CSV 2종 ─────────
await openDockGame();
const dl = async (label, file) => {
  const wait = host.waitForEvent("download", { timeout: 8000 });
  await host.click(`.gd-results button:has-text('${label}')`);
  const d = await wait;
  const to = path.join(OUT, file);
  await d.saveAs(to);
  return { name: d.suggestedFilename(), text: fs.readFileSync(to, "utf8") };
};
const csvP = await dl("참가자별.csv", "p4-참가자별.csv");
const csvG = await dl("게임별.csv", "p4-게임별.csv");
const pl = csvP.text.replace(/^﻿/, "").trim().split("\r\n");
check("참가자별.csv: 파일 이름·BOM·머리줄", csvP.name === "참가자별.csv" && csvP.text.charCodeAt(0) === 0xfeff && pl[0] === "닉네임,캐릭터,총점,순위,1. P4 퀴즈,2. 가위바위보,퀴즈 정답률(%),평균 응답 시간(초),채팅 수,반응 수,질문 수", pl[0]);
check("참가자별.csv: 1위 하나(정답률 100, 채팅 1) · 2위 세찌 · 3위 두리", pl[1]?.startsWith("하나,") && pl[1].split(",")[3] === "1" && pl[1].split(",")[6] === "100" && pl[1].split(",")[8] === "1" && pl[2]?.startsWith("세찌,") && pl[3]?.startsWith("두리,"), pl.slice(1).join(" | "));
const gl = csvG.text.replace(/^﻿/, "").trim().split("\r\n");
check("게임별.csv: 퀴즈 문제 2줄(정답률 67·33) + 가위바위보 1줄(1등 세찌)", gl.length === 4 && gl[1].includes("퀴즈 OX") && gl[1].includes(",67,") && gl[2].includes("퀴즈 객관식") && gl[2].includes(",33,") && gl[3].endsWith(",세찌"), gl.slice(1).join(" | "));
await closeDock();

// ───────── 6. 다른 브라우저 프로필에서 🔑 발표자 링크로 → DB 에서 순위 복원 ─────────
await openDockGame();
await hostCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
await host.click(".gd-results button:has-text('발표자 링크')");
await sleep(300);
const link = await host.evaluate(() => navigator.clipboard.readText());
check("🔑 발표자 링크 복사: /presenter?room=…#hk=비밀값", link === `${BASE}/presenter?room=${roomId}#hk=${hk}`, link.replace(hk, "<hk>"));
const dbCount = (await db.query("SELECT count(*)::int AS n FROM lecture_game_results WHERE room_id = $1", [roomId])).rows[0].n;
check("DB 에 2판 저장됨", dbCount === 2, String(dbCount));
const standA = await host.evaluate(() => [...document.querySelectorAll(".rb-card")].length);
await host.close(); // 발표 PC 를 옮긴다(앞 PC 창 닫기)
await sleep(1500);

const otherCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); // 다른 프로필 = 빈 localStorage
await otherCtx.addInitScript(hostInit);
await routeDb(otherCtx);
const host2 = await otherCtx.newPage();
watch(host2, "다른PC");
await host2.goto(link);
await host2.waitForFunction(() => (window.__llStats?.sent?.["host-rejoined"] || 0) >= 1, null, { timeout: 20000 });
await host2.click(".update-notice button", { timeout: 3000 }).catch(() => {});
const hashGone = await host2.evaluate(() => window.location.hash === "");
const hk2 = await host2.evaluate((k) => localStorage.getItem(k), `ll:hk:${roomId}`);
check("다른 PC: 주소의 #hk= 를 저장하고 주소에서 지움", hashGone && hk2 === hk, `hash 지움 ${hashGone}`);
await tryWait(host2.waitForFunction(() => window.__llStats && document.querySelector(".topbar-rank"), null, { timeout: 5000 }));
await sleep(2500);
await host2.click(".topbar-rank");
await host2.waitForSelector(".rb-card", { timeout: 4000 });
const board2 = await host2.evaluate(() => ({
  meta: document.querySelector(".rb-meta")?.textContent,
  pod: [...document.querySelectorAll(".rb-podium .gm-pod:not(.empty)")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
}));
await shot(host2, "restored-rank-board");
check("다른 PC: DB 에서 종합 순위 복원 — 게임 2판, 하나·세찌·두리 같은 점수", board2.meta?.includes("게임 2판") && JSON.stringify(board2.pod.map((t) => t.replace(/[▲▼–]\d*/g, "").trim())) === JSON.stringify(board.pod.map((t) => t.replace(/[▲▼–]\d*/g, "").trim())),
  `${board2.meta} · ${board2.pod.join(" | ")}`);
await host2.click(".rb-close");
await host2.click(".dock-toggle");
await host2.click(".dock-tab:has-text('게임')");
const restoredText = await host2.textContent(".gd-db");
check("다른 PC: 'DB 에서 2판 복원' 표시", (restoredText || "").includes("2판 복원"), restoredText);

// 폰들은 새 발표자에게 다시 붙는다(host-rejoined)
const reacked = await tryWait(host2.waitForFunction(() => document.querySelector(".topbar-count")?.textContent?.includes("3"), null, { timeout: 15000 }));
check("다른 PC: 폰 3대 자동 재접속", reacked);
check("콘솔 오류 0", errors.length === 0, errors.slice(0, 4).join(" | "));

fs.writeFileSync(path.join(OUT, "p4-e2e.json"), JSON.stringify({ roomId, pids, results, rpcLog, errors, standA }, null, 2));
await browser.close();
const fails = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
