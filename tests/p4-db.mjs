// P4 마이그레이션 검사 — 진짜 Postgres(PGlite, 메모리)에 기존 + 새 마이그레이션을 깔고, 공개(anon) 역할로 함수를 부른다.
// 운영 DB 는 건드리지 않는다. 사용: node tests/p4-db.mjs
// PGlite 는 이 저장소 의존성이 아니다(새 라이브러리 금지) — 같은 SSD 의 classroom-rpg 것을 절대경로로 빌려 쓴다.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PGLITE = process.env.PGLITE || "/Volumes/ssd/dev/classroom-rpg/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(PGLITE);

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export async function freshDb() {
  const db = new PGlite();
  // 수파베이스의 공개 역할 흉내
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; GRANT USAGE ON SCHEMA public TO anon, authenticated;
    -- 수파베이스는 public 의 새 표·함수에 anon 권한을 기본으로 준다 — 마이그레이션의 REVOKE 가 실제로 막는지 보려면 똑같이
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql") && !x.startsWith("._")).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  return db;
}

/** anon 으로 함수 부르기 — PostgREST 처럼 결과 값 하나 */
export async function rpcAs(db, fn, args) {
  const names = Object.keys(args);
  const sql = `SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) AS r`;
  const vals = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
  await db.exec("SET ROLE anon");
  try {
    const res = await db.query(sql, vals);
    return { data: res.rows[0]?.r ?? null, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e.message || e) } };
  } finally {
    await db.exec("RESET ROLE");
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const db = await freshDb();
  const hk = "0123456789abcdef0123456789abcdef";
  const hkHash = sha(hk);
  const other = "fedcba9876543210fedcba9876543210";

  // 1. 새 연수 v2 + 기존 함수도 그대로
  let r = await rpcAs(db, "create_lecture_room_v2", { p_id: "aaaa0001", p_title: "새 연수", p_slide_url: "https://x", p_slide_type: "google", p_embed_url: null, p_canva_design_id: null, p_canva_view_url: null, p_host_key_hash: hkHash });
  check("create_lecture_room_v2: 비밀값 해시와 함께 만들기", !r.error, r.error?.message);
  r = await rpcAs(db, "create_lecture_room", { p_id: "bbbb0002", p_title: "옛 연수", p_slide_url: "https://x", p_slide_type: "google", p_embed_url: null, p_canva_design_id: null, p_canva_view_url: null });
  check("기존 create_lecture_room 도 그대로 동작(배포 중 옛 화면)", !r.error, r.error?.message);
  r = await rpcAs(db, "create_lecture_room_v2", { p_id: "cccc0003", p_title: "x", p_slide_url: "https://x", p_slide_type: "google", p_embed_url: null, p_canva_design_id: null, p_canva_view_url: null, p_host_key_hash: "not-a-hash" });
  check("v2: 해시 모양이 아니면 거절", !!r.error);
  r = await rpcAs(db, "get_lecture_room", { p_id: "aaaa0001" });
  check("get_lecture_room 은 계속 읽힘", !r.error, r.error?.message);
  const roomRow = await (async () => {
    await db.exec("SET ROLE anon");
    try { return (await db.query("SELECT * FROM public.get_lecture_room($1)", ["aaaa0001"])).rows[0]; } finally { await db.exec("RESET ROLE"); }
  })();
  const stored = (await db.query("SELECT host_key_hash FROM lecture_rooms WHERE id = 'aaaa0001'")).rows[0].host_key_hash;
  check("get_lecture_room: 해시 열은 비워서 돌려줌(표에는 그대로)", roomRow?.title === "새 연수" && roomRow?.slide_url === "https://x" && roomRow.host_key_hash === null && stored === hkHash, JSON.stringify({ title: roomRow?.title, hash: roomRow?.host_key_hash }));

  // 2. 표는 잠김
  await db.exec("SET ROLE anon");
  let blocked = false;
  try { await db.query("SELECT * FROM lecture_game_results"); } catch { blocked = true; }
  let blocked2 = false;
  try { await db.query("INSERT INTO lecture_game_results (room_id, game_id, game_type, title, results) VALUES ('aaaa0001','x','quiz','t','{}')"); } catch { blocked2 = true; }
  await db.exec("RESET ROLE");
  check("anon 은 결과 표를 직접 읽기·쓰기 못 함", blocked && blocked2);

  // 3. 저장
  const payload = (id, pts) => ({ v: 1, id, type: "quiz", title: "퀴즈", startedAt: 1760000000000, endedAt: 1760000060000 + pts, winners: ["p1"], players: [{ pid: "p1", nick: "하나", char: "a01", joinedAt: 1, pts, c: 1, a: 1, ms: 900 }], log: [] });
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: payload("g1", 30) });
  check("record_game_result: 맞는 비밀값 → ok", r.data === "ok", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: payload("g1", 30) });
  check("같은 게임 다시 → duplicate(재시도 안전, 두 줄 안 생김)", r.data === "duplicate", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: other, p_payload: payload("g2", 5) });
  check("틀린 비밀값 → denied", r.data === "denied", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hkHash, p_payload: payload("g2", 5) });
  check("해시를 비밀값처럼 보내도 denied(해시만 알아선 못 씀)", r.data === "denied", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "zzzz9999", p_host_key: hk, p_payload: payload("g2", 5) });
  check("없는 연수 → no-room", r.data === "no-room", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: { v: 1, id: "g'; drop", type: "quiz", players: [] } });
  check("이상한 게임 id → invalid", r.data === "invalid", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: { v: 1, id: "g9", type: "poker", players: [] } });
  check("이상한 종류 → invalid", r.data === "invalid", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: { ...payload("g8", 1), pad: "x".repeat(270000) } });
  check("256KB 넘는 묶음 → invalid", r.data === "invalid", JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: { ...payload("g7", 1), startedAt: 1e300, endedAt: -5 } });
  check("범위 밖 시각(1e300 등)도 예외 없이 저장(시각만 비움)", r.data === "ok" && !r.error, JSON.stringify(r));
  await db.query("DELETE FROM lecture_game_results WHERE game_id = 'g7'");
  r = await rpcAs(db, "record_game_result", { p_room: "aaaa0001", p_host_key: hk, p_payload: payload("g2", 5) });
  check("두 번째 게임 저장", r.data === "ok", JSON.stringify(r));

  // 4. 읽기
  r = await rpcAs(db, "get_room_results", { p_room: "aaaa0001", p_host_key: hk });
  const games = r.data?.games ?? [];
  check("get_room_results: 비밀값 맞으면 2판, 끝난 순", r.data?.ok === true && games.length === 2 && games[0].id === "g2" && games[1].id === "g1", JSON.stringify(games.map((g) => g.id)));
  r = await rpcAs(db, "get_room_results", { p_room: "aaaa0001", p_host_key: other });
  check("get_room_results: 비밀값 틀리면 ok:false, 내용 없음", r.data?.ok === false && !r.data.games, JSON.stringify(r.data));

  // 5. 예전 연수 등록
  r = await rpcAs(db, "record_game_result", { p_room: "bbbb0002", p_host_key: hk, p_payload: payload("g1", 1) });
  check("예전 연수(해시 없음) 저장 → unclaimed", r.data === "unclaimed", JSON.stringify(r));
  r = await rpcAs(db, "claim_room_host", { p_room: "bbbb0002", p_host_key_hash: hkHash });
  check("claim_room_host: 비어 있으면 등록 → true", r.data === true, JSON.stringify(r));
  r = await rpcAs(db, "claim_room_host", { p_room: "bbbb0002", p_host_key_hash: hkHash });
  check("같은 해시로 다시 claim → true(재시도 안전)", r.data === true, JSON.stringify(r));
  r = await rpcAs(db, "claim_room_host", { p_room: "bbbb0002", p_host_key_hash: sha(other) });
  check("다른 해시로 claim → false(빼앗기 불가)", r.data === false, JSON.stringify(r));
  r = await rpcAs(db, "claim_room_host", { p_room: "aaaa0001", p_host_key_hash: sha(other) });
  check("새 연수(v2)는 claim 으로 못 바꿈", r.data === false, JSON.stringify(r));
  r = await rpcAs(db, "record_game_result", { p_room: "bbbb0002", p_host_key: hk, p_payload: payload("g1", 1) });
  check("등록 뒤 저장 → ok", r.data === "ok", JSON.stringify(r));

  // 6. 연수당 300판 상한
  await db.exec(`INSERT INTO lecture_game_results (room_id, game_id, game_type, title, results)
                 SELECT 'bbbb0002', 'x' || i, 'rps', 't', '{}'::jsonb FROM generate_series(1, 299) i`);
  r = await rpcAs(db, "record_game_result", { p_room: "bbbb0002", p_host_key: hk, p_payload: payload("g301", 1) });
  check("한 연수 300판 넘으면 full", r.data === "full", JSON.stringify(r));

  r = await rpcAs(db, "_lecture_host_hash", { p_host_key: hk });
  check("내부 해시 함수는 anon 이 직접 못 부름", !!r.error, r.error?.message?.slice(0, 60));

  // 7. 앱의 SHA-256 과 DB 의 sha256 이 같은 값
  const dbHash = (await db.query("SELECT public._lecture_host_hash($1) AS h", [hk])).rows[0].h;
  check("DB 해시 = 앱 해시(node:crypto 기준)", dbHash === hkHash, dbHash);

  const out = path.join(ROOT, "tests/out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "p4-db.json"), JSON.stringify(results, null, 2));
  const fails = results.filter((x) => !x.pass).length;
  console.log(`\n${results.length - fails}/${results.length} 통과`);
  process.exit(fails ? 1 : 0);
}
