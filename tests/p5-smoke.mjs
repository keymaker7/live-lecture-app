// P5 미리보기 스모크 — 연수 만들기 → 폰 2대 참가 → 게임 1판(OX 퀴즈) → 🏆 종합 순위판.
// 미리보기 주소는 Vercel 로그인 보호가 켜져 있어, 브라우저마다 공유 링크(?_vercel_share=…)를 먼저 열어 쿠키를 받는다.
// 사용: BASE=https://…vercel.app SHARE='https://…/?_vercel_share=…' node tests/p5-smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium, devices } = await import(PW);
const BASE = process.env.BASE;
const SHARE = process.env.SHARE;
if (!BASE) throw new Error("BASE 필요");
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const isExternalNoise = (t) => t.includes("ERR_BLOCKED_BY_CLIENT") || (t.includes("docs.google.com") && t.includes("report-only"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryWait = (p) => p.then(() => true).catch(() => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `p5-${name}.png`) });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const watch = (page, who) => {
  page.on("console", (m) => { if (m.type() === "error" && !isExternalNoise(m.text())) errors.push(`${who}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${who} pageerror: ${String(e).slice(0, 160)}`));
};
const unlock = async (page) => { if (SHARE) await page.goto(SHARE); };

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const host = await hostCtx.newPage();
await unlock(host);
watch(host, "발표자");
const cfg = await host.evaluate(async () => (await fetch("/api/config")).json());
check("미리보기: 실시간 켜짐 · 결과 DB 저장 꺼짐", cfg.supabaseEnabled === true && cfg.resultsDb === false, JSON.stringify({ supabase: cfg.supabaseEnabled, resultsDb: cfg.resultsDb }));

// 1. 연수 만들기
await host.goto(BASE + "/");
await host.fill("#slideUrl", "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit");
await host.fill("#title", "THOR P5 미리보기 스모크");
await host.click("#startBtn");
const made = await tryWait(host.waitForURL(/\/presenter\?room=/, { timeout: 20000 }));
const roomId = new URL(host.url()).searchParams.get("room");
check("연수 만들기", made && /^[0-9a-f]{8}$/.test(roomId || ""), roomId || "");
await host.waitForFunction(() => (window.__llStats?.sent?.["host-rejoined"] || 0) >= 1, null, { timeout: 20000 }).catch(() => {});
check("새 버전 안내 '폰 새로고침 한 번'", await tryWait(host.waitForSelector(".update-notice", { timeout: 5000 })));
await shot(host, "host-notice");
await host.click(".update-notice button").catch(() => {});

// 2. 폰 2대 참가 (QR 패널의 참가 주소 그대로)
const joinUrl = await host.textContent(".qr-panel .join-url, .qr-url").catch(() => null);
const phones = [];
for (const nick of ["하나", "두리"]) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  const p = await ctx.newPage();
  await unlock(p);
  watch(p, nick);
  await p.goto(`${BASE}/join/${roomId}`);
  await p.fill("#nickname", nick);
  await p.click("button:has-text('캐릭터 고르기')");
  await p.click("button:has-text('건너뛰기')");
  await p.waitForSelector(".audience-screen", { timeout: 15000 });
  phones.push(p);
}
const joined = await tryWait(host.waitForFunction(() => document.querySelector(".topbar-count")?.textContent?.includes("2"), null, { timeout: 15000 }));
check("폰 2대 참가 → 발표 화면 인원 2", joined, (await host.textContent(".topbar-count")) || "");
const [p1, p2] = phones;

// 3. 게임 1판 — OX 퀴즈
await host.click(".dock-toggle");
await host.click(".dock-tab:has-text('게임')");
await host.fill(".gd-text", "OX | 물은 100도에서 끓는다 | O");
await host.fill(".gd-name", "스모크 퀴즈");
await host.click("button:has-text('퀴즈 시작')");
await host.click(".dock-toggle");
await host.click('.gm-controls button:has-text("첫 문제 공개")');
const shown = await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-btn.ox.o", { timeout: 10000 }))));
check("폰 2대 OX 버튼", shown.every(Boolean));
await p1.click(".pg-btn.ox.o");
await p2.click(".pg-btn.ox.x");
await tryWait(host.waitForFunction(() => document.querySelector(".gm-tally")?.textContent?.includes("O 1 : X 1"), null, { timeout: 8000 }));
await host.click('.gm-controls button:has-text("지금 마감")');
await host.click('.gm-controls button:has-text("정답 공개")');
check("판정: 하나 정답 · 두리 땡", await tryWait(p1.waitForSelector(".pg-result.ok", { timeout: 8000 })) && await tryWait(p2.waitForSelector(".pg-result.no", { timeout: 8000 })));
await sleep(1000);
await host.click('.gm-controls button:has-text("결과 보기")');
check("결과 화면", await tryWait(host.waitForSelector(".gm-popup", { timeout: 8000 })));
const ranks = await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-rank", { timeout: 8000 })).then(() => p.textContent(".pg-rank").catch(() => ""))));
check("폰: 전체 1위 · 2위", ranks[0].includes("전체 1위") && ranks[1].includes("전체 2위"), ranks.join(" / "));
await shot(p1, "phone-rank");
await host.click(".gm-popup").catch(() => {});
await host.click('.gm-controls button:has-text("닫기")');

// 4. 종합 순위판
await host.click(".topbar-rank");
await host.waitForSelector(".rb-card", { timeout: 5000 }).catch(() => {});
await sleep(800);
const meta = await host.textContent(".rb-meta").catch(() => "");
const pod = await host.evaluate(() => [...document.querySelectorAll(".rb-podium .gm-pod:not(.empty)")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));
check("🏆 종합 순위판: 참가 2명 · 게임 1판, 1위 하나", meta === "참가 2명 · 게임 1판" && pod.some((t) => t.includes("하나") && t.includes("1")), `${meta} · ${pod.join(" | ")}`);
await shot(host, "rank-board");
check("콘솔 오류 0", errors.length === 0, errors.slice(0, 4).join(" | "));

// 5. 캔바 연수(시험용 주소는 환경 변수 CANVA_URL 로만) — 공유 열쇠가 든 퍼가기 주소로 뜨나.
// 따로 창에서: 캔바 안쪽 사용 통계 호출(/_ajax/ae/)은 캔바 공식 퍼가기 코드로도 403 이라 콘솔 검사에서 뺀다(응답으로 따로 셈).
if (process.env.CANVA_URL) {
  const cctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const cpage = await cctx.newPage();
  await unlock(cpage);
  const token = process.env.CANVA_URL.match(/design\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/)?.[1] || "";
  const made2 = await cpage.evaluate(async (u) => (await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slideUrl: u, title: "THOR 캔바 스모크" }) })).json(), process.env.CANVA_URL);
  const fails = [];
  let docStatus = 0;
  cpage.on("response", (r) => {
    if (/canva\.com\/design\/.+\/view\?embed/.test(r.url()) && r.request().resourceType() === "document") docStatus = r.status();
    if (r.status() >= 400 && /canva\.com/.test(r.url()) && !/\/_ajax\/ae\//.test(r.url())) fails.push(`${r.status()} ${r.url().split("?")[0].replace(token, "<열쇠>").slice(0, 80)}`);
  });
  await cpage.goto(`${BASE}/presenter?room=${made2.roomId}`);
  const ok = await tryWait(cpage.waitForSelector("iframe.canva-frame", { timeout: 15000 }));
  const src = ok ? await cpage.getAttribute("iframe.canva-frame", "src") : "";
  await sleep(6000);
  await shot(cpage, "canva");
  check("캔바 연수: 열쇠 든 퍼가기 주소 iframe · 문서 200 · 그 밖 4xx 0", ok && src.includes(`/${token}/view?embed`) && docStatus === 200 && fails.length === 0, `문서 ${docStatus} · 4xx ${fails.length} ${fails.join(" | ")}`);
}


fs.writeFileSync(path.join(OUT, "p5-smoke.json"), JSON.stringify({ base: BASE, roomId, joinUrl, results, errors }, null, 2));
await browser.close();
const fails = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
