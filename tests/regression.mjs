// 기존 기능 회귀 목록(지시서 §1) — 실제 발표자 화면 + 실제 참가자 폰 화면(Playwright 크롬), 실제 Supabase.
// 사용: 서버를 먼저 띄운다(npx next start --port 3030) → node tests/regression.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium, devices } = await import(PW);
const { createClient } = await import(path.join(ROOT, "node_modules/@supabase/supabase-js/dist/index.mjs"));
const BASE = process.env.BASE || "http://localhost:3030";
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").trim().split("\n")
    .filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryWait = (p) => p.then(() => true).catch(() => false);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const host = await hostCtx.newPage();
const errors = [];
const watchErrors = (page, who) => {
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("ERR_BLOCKED_BY_CLIENT")) errors.push(`${who}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${who} pageerror: ${String(e).slice(0, 160)}`));
};
watchErrors(host, "발표자");

// 1. 연수 만들기
await host.goto(BASE + "/");
await host.fill("#slideUrl", "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit");
await host.fill("#title", "THOR 회귀시험");
await host.click("#startBtn");
const made = await tryWait(host.waitForURL(/\/presenter\?room=/, { timeout: 15000 }));
const roomId = new URL(host.url()).searchParams.get("room");
check("연수 만들기", made && /^[0-9a-f]{8}$/.test(roomId || ""), roomId || "");
await tryWait(host.waitForSelector(".present-title", { timeout: 10000 }));
check("발표 화면 제목", (await host.textContent(".present-title")) === "THOR 회귀시험");
await host.waitForFunction(() => document.querySelector(".host-standby") === null, null, { timeout: 5000 }).catch(() => {});
await sleep(1800); // 진행 탭 정하기(1.2초)

// 2. 연수 목록 화면
const listPage = await hostCtx.newPage();
watchErrors(listPage, "목록");
const listRes = await listPage.goto(BASE + "/sessions");
check("연수 목록 화면 열림", listRes?.ok() === true && (await listPage.locator("body").textContent() || "").length > 0);
await listPage.close();

// 3. QR·링크 참가
const qr = await (await fetch(`${BASE}/api/rooms/${roomId}/qr`)).json();
check("QR 만들기", typeof qr.qrDataUrl === "string" && qr.qrDataUrl.startsWith("data:image") && qr.joinUrl.includes(roomId), qr.joinUrl);
check("발표 화면 QR 표시", await host.locator(".qr-code-wrap img").isVisible());
const phoneCtx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
const phone = await phoneCtx.newPage();
watchErrors(phone, "폰");
await phone.goto(`${BASE}/join/${roomId}`);
await phone.waitForSelector("#nickname");
check("참가 화면 연수 제목", (await phone.textContent(".join-subtitle")) === "THOR 회귀시험");
await phone.fill("#nickname", "회귀폰");
await phone.click("button:has-text(\"참여하기\")");
const joined = await tryWait(phone.waitForSelector(".audience-screen", { timeout: 5000 }));
await tryWait(host.waitForFunction(() => document.querySelector(".topbar-count")?.textContent?.includes("1"), null, { timeout: 8000 }));
check("링크 참가 → 발표 화면 인원 1", joined && (await host.textContent(".topbar-count")) || "".includes("1"), (await host.textContent(".topbar-count")) || "");
await tryWait(phone.waitForFunction(() => document.querySelector(".audience-status")?.textContent?.includes("1명"), null, { timeout: 5000 }));
check("폰 화면 인원 표시", (await phone.textContent(".audience-status")) || "".includes("1명"), (await phone.textContent(".audience-status")) || "");

// 4. 채팅
await phone.fill(".chat-input-wrap input", "회귀 채팅 <b>굵게</b>");
await phone.click(".btn-send");
const bubble = await tryWait(host.waitForSelector(".chat-bubble .chat-message", { timeout: 6000 }));
check("채팅 → 발표 화면 말풍선", bubble && (await host.textContent(".chat-bubble .chat-message")) === "회귀 채팅 <b>굵게</b>");
check("채팅 글자 그대로(태그 해석 안 함)", (await host.locator(".chat-bubble b").count()) === 0);
await host.click(".chat-log-panel .activity-toggle");
check("채팅 로그", (await host.locator(".chat-log-panel .activity-item").count()) >= 1);
await host.click(".chat-log-panel .activity-toggle"); // 다시 접기

// 5. 이모지 반응
await phone.click(".emoji-btn >> nth=0");
const floated = await tryWait(host.waitForSelector(".floating-emoji", { timeout: 6000 }));
check("이모지 반응 → 떠오름", floated);
await host.click(".emoji-log-panel .activity-toggle");
check("이모지 로그", (await host.locator(".emoji-log-panel .activity-item").count()) >= 1);
await host.click(".emoji-log-panel .activity-toggle"); // 다시 접기

// 6. 투표 만들기·투표·마감 (2번 — 새 투표에 다시 투표되는지까지)
await host.click(".dock-toggle");
for (const [round, q] of [[1, "첫 투표"], [2, "두 번째 투표"]]) {
  await host.click(".dock-tab:has-text('투표')");
  await host.fill("input[placeholder='투표 질문']", q);
  await host.locator(".poll-opt").nth(0).fill("가");
  await host.locator(".poll-opt").nth(1).fill("나");
  await host.click("button:has-text('투표 시작')");
  const shown = await tryWait(phone.waitForSelector(`.poll-vote-panel h3:has-text('${q}')`, { timeout: 6000 }));
  check(`투표 ${round} → 폰에 표시`, shown);
  await phone.click(".poll-vote-btn >> nth=1");
  const counted = await tryWait(host.waitForFunction(() => document.querySelectorAll(".poll-bar-count")[1]?.textContent === "1", null, { timeout: 6000 }));
  check(`투표 ${round} → 발표 화면 집계`, counted);
  await host.click("button:has-text('투표 종료')");
  const closed = await tryWait(phone.waitForSelector(".poll-vote-panel", { state: "detached", timeout: 6000 }));
  check(`투표 ${round} 마감 → 폰에서 사라짐`, closed);
}

// 7. 질문 제출·해결
await phone.click(".aud-tab:has-text('질문')");
await phone.fill(".question-textarea", "회귀 질문입니다");
await phone.click("button:has-text('질문 등록')");
const alerted = await tryWait(host.waitForSelector(".question-alert-text:has-text('회귀 질문입니다')", { timeout: 6000 }));
check("질문 → 발표 화면 알림", alerted);
await host.click(".dock-tab:has-text('질문')");
await host.click(".btn-resolve");
check("질문 답변 완료", await tryWait(host.waitForSelector(".q-done", { timeout: 3000 })));

// 8. 타이머
await host.click(".dock-tab:has-text('타이머')");
await host.click(".dock-panel button:has-text('시작')");
const t1 = await host.textContent(".timer-badge");
await sleep(2200);
const t2 = await host.textContent(".timer-badge");
check("타이머 시작·줄어듦", !!t1 && !!t2 && t1 !== t2, `${t1} → ${t2}`);
await host.click(".dock-panel button:has-text('정지')");

// 9. 슬라이드 넘김 요청 (폰 화면엔 버튼이 없어 프로토콜로 보냄)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const cmd = sb.channel(`slides-cmd:${roomId}`);
await cmd.httpSend("slide-request", { pid: "reg-phone-2", nickname: "요청폰", direction: "next" });
await sleep(3500);
const snap = await host.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `ll:host:${roomId}`);
check("슬라이드 넘김 요청 수신", snap?.state?.slideRequests?.next === 1, JSON.stringify(snap?.state?.slideRequests));
await sb.removeAllChannels();

// 10. 영상 요청 on·off (분:초)
await host.click(".dock-tab:has-text('영상')");
await host.click(".toggle-btn");
const vtab = await tryWait(phone.waitForSelector(".aud-tab:has-text('영상')", { timeout: 6000 }));
check("영상 켜기 → 폰에 영상 탭", vtab);
await phone.click(".aud-tab:has-text('영상')");
await phone.fill(".video-url-input", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
const ti = phone.locator(".video-time-input");
await ti.nth(0).fill("1"); await ti.nth(1).fill("5"); await ti.nth(2).fill("1"); await ti.nth(3).fill("10");
await phone.click("button:has-text('영상 요청')");
const vid = await tryWait(host.waitForSelector(".video-overlay iframe", { timeout: 6000 }));
const src = vid ? await host.getAttribute(".video-overlay iframe", "src") : "";
check("영상 요청(1:05~1:10) → 발표 화면 재생", vid && src.includes("start=65") && src.includes("end=70"), src);
await host.click(".video-close-btn");
check("영상 닫기", await tryWait(host.waitForSelector(".video-overlay", { state: "detached", timeout: 4000 })));
await host.click(".dock-panel .toggle-btn");
check("영상 끄기 → 폰 영상 탭 사라짐", await tryWait(phone.waitForSelector(".aud-tab:has-text('영상')", { state: "detached", timeout: 6000 })));

// 11. 다른 PC 에서 연수 열기(lecture_rooms) — 같은 연수가 열리고, 진행 중이라 보기 전용 안내
const otherCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const other = await otherCtx.newPage();
watchErrors(other, "다른PC");
await other.goto(`${BASE}/presenter?room=${roomId}`);
const otherOk = await tryWait(other.waitForSelector(".present-title", { timeout: 10000 }));
check("다른 PC 에서 연수 열기", otherOk && (await other.textContent(".present-title")) === "THOR 회귀시험");
await host.screenshot({ path: path.join(OUT, "regression-host.png") });
await phone.screenshot({ path: path.join(OUT, "regression-phone.png") });

check("콘솔 오류 0", errors.length === 0, errors.slice(0, 3).join(" | "));
fs.writeFileSync(path.join(OUT, "regression-result.json"), JSON.stringify({ roomId, results, errors }, null, 2));
await browser.close();
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
