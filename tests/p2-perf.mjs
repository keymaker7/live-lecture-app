// P2 게이트 — 발표 화면 1920×1080, 가짜 60명(산책로)·150명(광장) 각각 5초 rAF 프레임 측정 → 평균 50fps 이상.
// 가짜 참가자는 화면 엔진에만 넣는다(window.__plaza.addFake, ll:debug=1 일 때만 열림) — 그리는 성능만 잰다.
// 사용: 서버를 먼저 띄운다(npx next start --port 3030) → node tests/p2-perf.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = process.env.PW_CORE || "/Volumes/ssd/dev/trade-game/node_modules/playwright-core/index.mjs";
const { chromium } = await import(PW);
const BASE = process.env.BASE || "http://localhost:3030";
const OUT = path.join(ROOT, "tests/out");
fs.mkdirSync(OUT, { recursive: true });
const HEADED = process.env.HEADED === "1";

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
// 구글 슬라이드 iframe 이 내는 것(광고·로깅 차단, report-only CSP 보고)은 앱 오류가 아니라 뺀다.
function isExternalNoise(t) {
  return t.includes("ERR_BLOCKED_BY_CLIENT") || (t.includes("docs.google.com") && t.includes("report-only"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch(`${BASE}/api/rooms`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ slideUrl: "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit", title: "THOR P2 광장 성능" }),
});
const { roomId } = await r.json();

// 헤드리스 크롬은 빈 페이지도 rAF 가 초당 15번 안팎으로 묶인다(실측) → 프레임 제한을 풀어 "초당 몇 프레임까지 그릴 수 있나"를 잰다.
// 실제 화면(vsync 60Hz)으로 재려면 HEADED=1 (창이 뜬다).
const UNCAP = ["--disable-gpu-vsync", "--disable-frame-rate-limit"];
const browser = await chromium.launch({
  channel: "chrome",
  headless: !HEADED,
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", ...(HEADED ? [] : UNCAP)],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem("ll:debug", "1"); localStorage.setItem("ll:view", "walk"); localStorage.setItem("ll:band", "on"); } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !isExternalNoise(m.text())) errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("pageerror " + String(e).slice(0, 160)));
await page.goto(`${BASE}/presenter?room=${roomId}`);
await page.waitForFunction(() => !!window.__plaza, null, { timeout: 15000 });
await sleep(2500);

// 5초 동안 rAF 를 직접 세고, 프레임 간격 분포와 엔진이 그린 프레임 수를 함께 본다.
const measure = () => page.evaluate(() => new Promise((resolve) => {
  const gaps = [];
  const e0 = window.__plaza.engine.frames;
  let last = performance.now();
  const t0 = last;
  let long = 0;
  const po = new PerformanceObserver((l) => { long += l.getEntries().length; });
  try { po.observe({ type: "longtask", buffered: false }); } catch {}
  const f = (now) => {
    gaps.push(now - last);
    last = now;
    if (now - t0 < 5000) requestAnimationFrame(f);
    else {
      po.disconnect();
      const secs = (now - t0) / 1000;
      gaps.shift();
      gaps.sort((a, b) => a - b);
      resolve({
        fps: +(gaps.length / secs).toFixed(1),
        engineFps: +((window.__plaza.engine.frames - e0) / secs).toFixed(1),
        p95ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
        maxms: +gaps[gaps.length - 1].toFixed(1),
        longTasks: long,
        actors: window.__plaza.engine.count(),
        shown: document.querySelectorAll(".pz-ch:not([style*='display: none'])").length,
      });
    }
  };
  requestAnimationFrame(f);
}));

// ── 산책로 60명 ──
await page.evaluate(() => window.__plaza.addFake(60));
await sleep(2000);
await page.evaluate(() => {
  const e = window.__plaza.engine;
  ["fake-3", "fake-17", "fake-30", "fake-44"].forEach((p, i) => e.say(p, ["안녕하세요! 오늘 연수 재밌어요", "질문 있어요 🙋", "와 대박", "캐릭터 귀엽다 ㅋㅋ"][i]));
  e.react("fake-8", "👏"); e.react("fake-21", "❤️");
});
const walk = await measure();
check("산책로 60명 평균 50fps 이상", walk.fps >= 50 && walk.engineFps >= 50, JSON.stringify(walk));
await page.evaluate(() => window.__plaza.engine.say("fake-12", "말풍선은 이렇게 보여요"));
await sleep(600);
await page.screenshot({ path: path.join(OUT, "p2-walk-60.png") });

// ── 광장 150명 ──
await page.click(".pz-controls button:has-text('광장')");
await page.evaluate(() => window.__plaza.addFake(150));
await sleep(2500);
await page.evaluate(() => {
  const e = window.__plaza.engine;
  ["fake-5", "fake-66", "fake-101", "fake-140"].forEach((p, i) => e.say(p, ["광장 최고!", "Lv.7 무지개 링 보여요?", "<b>태그</b>는 글자 그대로", "🐣 부화 구경 중"][i]));
  e.upsert({ pid: "new-1", nickname: "새친구", character: "a28_chick", level: 1, lastActive: Date.now() }, { hatch: true });
});
const plaza = await measure();
check("광장 150명 평균 50fps 이상", plaza.fps >= 50 && plaza.engineFps >= 50, JSON.stringify(plaza));
// 참고(게이트 아님): 엔진 한 프레임 계산 시간, 느린 PC 흉내(CPU 4배 느리게)에서의 광장 150명
const tickCost = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__plaza.engine;
  const orig = e.tick;
  const ms = [];
  e.tick = (now) => { const t = performance.now(); orig(now); ms.push(performance.now() - t); };
  setTimeout(() => {
    e.tick = orig;
    ms.sort((a, b) => a - b);
    resolve({ frames: ms.length, avgMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(2) });
  }, 3000);
}));
console.log("  엔진 계산 시간(광장 150명):", JSON.stringify(tickCost));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const slow = await measure();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
console.log("  CPU 4배 느리게, 광장 150명:", JSON.stringify(slow));
await page.evaluate(() => window.__plaza.confetti.burst());
await page.evaluate(() => { const e = window.__plaza.engine; e.say("fake-20", "레벨업!"); e.upsert({ pid: "fake-20", nickname: "판다21", character: "a06_panda", level: 9, lastActive: Date.now() }); });
await sleep(500);
await page.screenshot({ path: path.join(OUT, "p2-plaza-150.png") });

// 말풍선 XSS — 태그가 글자로 남는지
const tagLeak = await page.evaluate(() => document.querySelectorAll(".pz-bubble b").length);
check("말풍선 글자 태그 해석 안 함", tagLeak === 0);
// 화면 밖으로 안 나가는지 — 모든 캐릭터 발 위치가 광장 안
const outside = await page.evaluate(() => {
  const root = document.querySelector(".pz-root").getBoundingClientRect();
  let n = 0;
  document.querySelectorAll(".pz-ch").forEach((el) => {
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform);
    if (!m) return;
    const x = +m[1], y = +m[2];
    if (x < 0 || x > root.width || y < 0 || y > root.height) n++;
  });
  return n;
});
check("캐릭터 위치가 화면 안", outside === 0, `${outside}명 밖`);
// 창 크기 줄였다 늘려도 안 나가는지
await page.setViewportSize({ width: 1280, height: 720 });
await sleep(800);
const outside2 = await page.evaluate(() => {
  const root = document.querySelector(".pz-root").getBoundingClientRect();
  let n = 0;
  document.querySelectorAll(".pz-ch").forEach((el) => {
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform);
    if (m && (+m[1] < 0 || +m[1] > root.width || +m[2] < 0 || +m[2] > root.height)) n++;
  });
  return n;
});
check("창 1280×720 으로 줄여도 화면 안", outside2 === 0, `${outside2}명 밖`);
check("콘솔 오류 0", errors.length === 0, errors.slice(0, 3).join(" | "));

fs.writeFileSync(path.join(OUT, `p2-perf${HEADED ? "-headed" : ""}.json`), JSON.stringify({ roomId, mode: HEADED ? "headed vsync" : "headless uncapped", walk, plaza, tickCost, slowCpu4x: slow, results, errors }, null, 2));
await browser.close();
const fails = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
