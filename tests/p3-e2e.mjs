// P3 게이트 e2e — 가짜 폰 3대(실제 참가 화면, Playwright 크롬)로 게임 5종(OX·객관식·단답·가위바위보·달리기)
// + 서바이벌 퀴즈를 끝까지. 실제 Supabase 사용. 사용: 서버를 먼저 띄운다 → node tests/p3-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium, devices } = await import(PW);
const BASE = process.env.BASE || "http://localhost:3030";
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
// 구글 슬라이드 iframe 이 내는 것(광고·로깅 차단, report-only CSP 보고)은 앱 오류가 아니라 뺀다.
function isExternalNoise(t) {
  return t.includes("ERR_BLOCKED_BY_CLIENT") || (t.includes("docs.google.com") && t.includes("report-only"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryWait = (p) => p.then(() => true).catch(() => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `p3-${name}.png`) });

const r = await fetch(`${BASE}/api/rooms`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ slideUrl: "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit", title: "THOR P3 게임 e2e" }),
});
const { roomId } = await r.json();
console.log("room", roomId);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const watch = (page, who) => {
  page.on("console", (m) => { if (m.type() === "error" && !isExternalNoise(m.text())) errors.push(`${who}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${who} pageerror: ${String(e).slice(0, 160)}`));
};

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await hostCtx.addInitScript(() => { try { localStorage.setItem("ll:debug", "1"); localStorage.setItem("ll:sfx", "off"); } catch {} });
const host = await hostCtx.newPage();
watch(host, "발표자");
await host.goto(`${BASE}/presenter?room=${roomId}`);
await host.waitForFunction(() => (window.__llStats?.sent?.["host-rejoined"] || 0) >= 1, null, { timeout: 15000 });

const NAMES = ["하나", "두리", "세찌"];
const phones = [];
for (const nick of NAMES) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  const p = await ctx.newPage();
  watch(p, nick);
  await p.goto(`${BASE}/join/${roomId}`);
  await p.fill("#nickname", nick);
  await p.click("button:has-text('캐릭터 고르기')");
  await p.click("button:has-text('건너뛰기')");
  await p.waitForSelector(".audience-screen");
  phones.push(p);
}
await tryWait(host.waitForFunction(() => document.querySelector(".topbar-count")?.textContent?.includes("3"), null, { timeout: 10000 }));
check("폰 3대 참가", ((await host.textContent(".topbar-count")) || "").includes("3"));
const [p1, p2, p3] = phones;

const snap = () => host.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `ll:host:${roomId}`);
// 발표자 저장은 2초 모아서 — n번째 게임 기록이 저장될 때까지 기다린다
const snapGames = async (n) => {
  for (let i = 0; i < 40; i++) {
    const s = await snap();
    if ((s?.games?.length ?? 0) >= n) return s;
    await sleep(200);
  }
  return snap();
};
const pidOf = async (p) => p.evaluate((k) => localStorage.getItem(k), `ll:pid:${roomId}`);
const pids = await Promise.all(phones.map(pidOf));
const ctl = (label) => host.click(`.gm-controls button:has-text("${label}")`);
const waitCtl = (label, ms = 8000) => tryWait(host.waitForSelector(`.gm-controls button:has-text("${label}")`, { timeout: ms }));
const openDockGame = async () => {
  if (!(await host.locator(".dock-body").count())) await host.click(".dock-toggle");
  await host.click(".dock-tab:has-text('게임')");
};

// ───────── 1~3. 퀴즈 점수전: OX · 객관식 · 단답 ─────────
await openDockGame();
await host.fill(".gd-text", "OX | 물은 100도에서 끓는다 | O\n객관식 | 2+3은? | 4, 5, 6, 7 | 2\n단답 | 세종대왕이 만든 글자는? | 한글, 훈민정음");
await host.fill(".gd-name", "e2e 퀴즈");
check("퀴즈 세트 읽기", ((await host.textContent(".gd-status")) || "").includes("문제 3개"));
await host.click("button:has-text('퀴즈 시작')");
await host.click(".dock-toggle"); // 도구 접기
const plazaOn = await tryWait(host.waitForFunction(() => document.querySelector(".pz-root")?.getAttribute("data-mode") === "plaza", null, { timeout: 5000 }));
check("게임 시작 → 광장 게임 화면 자동 전환", plazaOn);
check("폰: 곧 시작 화면", await tryWait(p1.waitForSelector(".pg-center h2:has-text('e2e 퀴즈')", { timeout: 6000 })));

// OX
await ctl("첫 문제 공개");
const oxShown = await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-btn.ox.o", { timeout: 6000 }))));
check("OX: 폰 3대 큰 버튼", oxShown.every(Boolean));
await shot(p1, "phone-ox");
await p1.click(".pg-btn.ox.o");
await p2.click(".pg-btn.ox.x");
await p3.click(".pg-btn.ox.x");
await sleep(300);
await p3.click(".pg-btn.ox.o"); // 마감 전 답 바꾸기
const tallyOk = await tryWait(host.waitForFunction(() => document.querySelector(".gm-tally")?.textContent?.includes("O 2 : X 1"), null, { timeout: 6000 }));
check("OX: 발표 화면 '지금 O 2 : X 1' (답 바꾸기 반영)", tallyOk, (await host.textContent(".gm-tally")) || "");
await shot(host, "host-ox");
const zonesOk = await host.evaluate(() => document.querySelectorAll(".pz-zone").length >= 3);
check("OX: 광장 O·X 구역 + 관중석", zonesOk);
await ctl("지금 마감");
check("OX: 폰 마감 표시", await tryWait(p1.waitForSelector(".pg-result.wait", { timeout: 5000 })));
await ctl("정답 공개");
const stamp = await tryWait(host.waitForSelector(".gm-stamp:has-text('정답: O')", { timeout: 4000 }));
check("OX: 판정 도장", stamp);
const r1 = await tryWait(p1.waitForSelector(".pg-result.ok", { timeout: 6000 }));
const r2 = await tryWait(p2.waitForSelector(".pg-result.no", { timeout: 6000 }));
check("OX: 폰 결과(정답/땡)", r1 && r2, `${await p1.textContent(".pg-result").catch(() => "")} / ${await p2.textContent(".pg-result").catch(() => "")}`);

// 객관식
await ctl("다음 문제");
check("객관식: 폰 보기 4개", await tryWait(p1.waitForFunction(() => document.querySelectorAll(".pg-btn.mc").length === 4, null, { timeout: 6000 })));
await shot(p2, "phone-mc");
await p1.click(".pg-btn.mc >> nth=1");
await p2.click(".pg-btn.mc >> nth=1");
await p3.click(".pg-btn.mc >> nth=0");
await tryWait(host.waitForFunction(() => document.querySelector(".gm-tally")?.textContent?.includes("② 2"), null, { timeout: 6000 }));
await shot(host, "host-mc");
await ctl("지금 마감");
await ctl("정답 공개");
check("객관식: 판정", await tryWait(p3.waitForSelector(".pg-result.no", { timeout: 6000 })) && await tryWait(p2.waitForSelector(".pg-result.ok", { timeout: 6000 })));

// 단답
await ctl("다음 문제");
check("단답: 폰 입력칸", await tryWait(p1.waitForSelector(".pg-short input", { timeout: 6000 })));
await p2.fill(".pg-short input", "훈민 정음!");
await p2.click(".pg-short button");
await sleep(400);
await p1.fill(".pg-short input", "한글");
await p1.click(".pg-short button");
await p3.fill(".pg-short input", "몰라");
await p3.click(".pg-short button");
const orderOk = await tryWait(host.waitForFunction(() => {
  const items = [...document.querySelectorAll(".gm-order-item")].map((e) => e.textContent);
  return items.length === 2 && items[0].includes("두리") && items[1].includes("하나");
}, null, { timeout: 6000 }));
check("단답: 정답자 순서 실시간(두리 → 하나)", orderOk, (await host.locator(".gm-order").textContent().catch(() => "")) || "");
await shot(host, "host-short");
await ctl("지금 마감");
await ctl("정답 공개");
await sleep(1500);
await ctl("결과 보기");
const popup = await tryWait(host.waitForSelector(".gm-popup", { timeout: 6000 }));
check("퀴즈 끝: 결과 시상대", popup);
await shot(host, "host-quiz-result");
const fin = await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-points", { timeout: 6000 }))));
const finTexts = await Promise.all(phones.map((p) => p.textContent(".pg-points").catch(() => "")));
const s1 = await snapGames(1);
const quizRec = s1?.games?.[0];
const phonePts = finTexts.map((t) => Number((t || "").replace(/\D/g, "")));
const hostPts = pids.map((pid) => quizRec?.points?.[pid] ?? 0);
check("퀴즈 끝: 폰 '이번 게임 +N점' = 발표자 기록", fin.every(Boolean) && JSON.stringify(phonePts) === JSON.stringify(hostPts), `폰 ${phonePts} / 발표자 ${hostPts}`);
// 점수 규칙 확인: 하나 = OX 정답(10+빠르기) + 객관식 정답(10+빠르기) + 단답 2등(10+6) + 참가 2
const [a, b, c] = hostPts;
check("퀴즈 점수 규칙 범위", a >= 10 + 10 + 16 + 2 && a <= 15 + 15 + 16 + 2 && b >= 10 + 20 + 2 && b <= 15 + 20 + 2 && c >= 10 + 2 && c <= 15 + 2, `하나 ${a} · 두리 ${b} · 세찌 ${c}`);
check("퀴즈 기록: 문제별 정답 수", JSON.stringify(quizRec?.log?.map((l) => [l.answered, l.correct])) === JSON.stringify([[3, 2], [3, 2], [3, 2]]), JSON.stringify(quizRec?.log?.map((l) => [l.answered, l.correct])));
await host.click(".gm-popup");
await ctl("닫기");
check("닫기 → 폰 원래 화면", await tryWait(p1.waitForSelector(".audience-tabs", { timeout: 6000 })));
check("닫기 → 발표 화면 원래 보기", await tryWait(host.waitForFunction(() => document.querySelector(".pz-root")?.getAttribute("data-mode") !== "plaza" || localStorage.getItem("ll:view") === "plaza", null, { timeout: 5000 })));

// ───────── 4. 가위바위보 ─────────
await openDockGame();
await host.click("button:has-text('가위바위보')");
await host.click(".dock-toggle");
check("가위바위보: 폰 손 버튼 3개", await tryWait(p1.waitForFunction(() => document.querySelectorAll(".pg-grid.three .pg-btn").length === 3, null, { timeout: 6000 })));
await p1.click(".pg-btn:has-text('바위')");
await p2.click(".pg-btn:has-text('가위')");
await p3.click(".pg-btn:has-text('보')");
await tryWait(host.waitForFunction(() => document.querySelector(".gm-rps .gm-tally")?.textContent?.includes("3명"), null, { timeout: 6000 }));
await shot(host, "host-rps");
await host.click(".gm-controls button:has-text('✌️ 가위')");
const judged = await tryWait(p3.waitForSelector(".pg-jail, .pg-result.no", { timeout: 8000 }));
check("가위바위보 1판: 보 낸 세찌 감옥", judged);
check("가위바위보 1판: 바위 이김·가위 비김 생존", await tryWait(p1.waitForSelector(".pg-result.ok", { timeout: 4000 })) && await tryWait(p2.waitForSelector(".pg-result.ok", { timeout: 4000 })));
await host.waitForTimeout(800);
await shot(host, "host-rps-judge");
await ctl("다음 판");
await tryWait(p1.waitForFunction(() => document.querySelector(".pg-meta")?.textContent?.includes("2판"), null, { timeout: 6000 }));
await p1.click(".pg-btn:has-text('보')");
await p2.click(".pg-btn:has-text('가위')");
await sleep(1200);
await host.click(".gm-controls button:has-text('✌️ 가위')");
check("가위바위보 2판: 1명 남아 자동 종료 — 두리 우승", await tryWait(p2.waitForSelector(".pg-center h2:has-text('우승')", { timeout: 10000 })));
const s2 = await snapGames(2);
const rpsRec = s2?.games?.[1];
check("가위바위보 점수: 두리 5+5+30+2, 하나 5+2, 세찌 2", rpsRec?.points?.[pids[1]] === 42 && rpsRec?.points?.[pids[0]] === 7 && rpsRec?.points?.[pids[2]] === 2, JSON.stringify(pids.map((p) => rpsRec?.points?.[p])));
await host.waitForSelector(".gm-popup", { timeout: 4000 }).catch(() => {});
await host.click(".gm-popup").catch(() => {});
await ctl("닫기");

// ───────── 5. 달리기 ─────────
await openDockGame();
await host.fill(".gd-start input[type=number] >> nth=0", "10");
await host.fill(".gd-start input[type=number] >> nth=1", "20");
await host.click("button:has-text('달리기')");
await host.click(".dock-toggle");
check("달리기: 폰 준비 화면", await tryWait(p1.waitForSelector(".pg-center h2:has-text('달리기')", { timeout: 6000 })));
await ctl("3·2·1 출발");
check("달리기: 폰 카운트다운", await tryWait(p1.waitForSelector(".pg-countdown", { timeout: 6000 })));
await shot(p1, "phone-run-countdown");
// 카운트다운 중 탭은 막혀 있음
const disabledDuring = await p1.locator(".pg-run").isDisabled();
check("달리기: 카운트다운 중 버튼 잠김", disabledDuring);
await Promise.all(phones.map((p) => tryWait(p.waitForSelector(".pg-run:not([disabled])", { timeout: 6000 }))));
const tapper = async (p, n, gap) => { for (let i = 0; i < n; i++) { await p.locator(".pg-run").dispatchEvent("pointerdown").catch(() => {}); await sleep(gap); } };
await Promise.all([tapper(p1, 11, 150), tapper(p2, 11, 190), tapper(p3, 11, 230)]);
await shot(host, "host-run");
const runDone = await tryWait(host.waitForSelector(".gm-popup", { timeout: 15000 }));
check("달리기: 3명 골인 → 2.5초 뒤 결과", runDone);
await shot(host, "host-run-result");
const s3 = await snapGames(3);
const runRec = s3?.games?.[2];
const rp = pids.map((p) => runRec?.points?.[p]);
check("달리기 점수: 1·2·3등 37·27·17", JSON.stringify([...rp].sort((x, y) => y - x)) === JSON.stringify([37, 27, 17]), JSON.stringify(rp));
await host.click(".gm-popup").catch(() => {});
await ctl("닫기");

// ───────── 서바이벌 퀴즈(감옥) ─────────
await openDockGame();
await host.fill(".gd-text", "OX | 해는 동쪽에서 뜬다 | O\nOX | 고래는 물고기다 | X");
await host.check(".gd-start input[type=radio] >> nth=1");
await host.click("button:has-text('퀴즈 시작')");
await host.click(".dock-toggle");
await ctl("첫 문제 공개");
await tryWait(p1.waitForSelector(".pg-btn.ox.o", { timeout: 6000 }));
await p1.click(".pg-btn.ox.o");
await p2.click(".pg-btn.ox.x");
await sleep(1200);
await ctl("지금 마감");
await ctl("정답 공개");
check("서바이벌: 틀린 두리 감옥", await tryWait(p2.waitForSelector(".pg-jail", { timeout: 6000 })));
await host.waitForTimeout(900);
await shot(host, "host-survival-jail");
const jailVisible = await host.evaluate(() => !!document.querySelector(".pz-zone-jail"));
check("서바이벌: 광장에 감옥", jailVisible);
await ctl("결과 보기"); // 1명 남음 → 끝
check("서바이벌: 하나 우승", await tryWait(p1.waitForSelector(".pg-center h2:has-text('우승')", { timeout: 6000 })));
await host.click(".gm-popup").catch(() => {});
await ctl("닫기");

// ───────── 누적 ─────────
await sleep(2500);
const s4 = await snap();
const totals = pids.map((pid) => s4.participants.find((x) => x.pid === pid)?.score);
const expect = pids.map((pid) => s4.games.reduce((sum, g) => sum + (g.points[pid] ?? 0), 0));
check("참가자 누적 점수 = 게임별 점수 합(4판)", s4.games.length === 4 && JSON.stringify(totals) === JSON.stringify(expect), `${totals} / ${expect}`);
check("콘솔 오류 0", errors.length === 0, errors.slice(0, 4).join(" | "));

fs.writeFileSync(path.join(OUT, "p3-e2e.json"), JSON.stringify({ roomId, pids, results, games: s4.games, totals, errors }, null, 2));
await browser.close();
const fails = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
